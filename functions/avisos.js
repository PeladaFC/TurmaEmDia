/* Turma em Dia · aviso da chamada no celular do professor (notificação push).
   Turma com "chamada obrigatória" (chamadaObrig), dias de aula e horário de início (hora):
   o servidor guarda uma cópia em agendaChamada/{eid}_{tid} (espelharTurma) e, a cada minuto, avisa os professores
   das turmas que começam naquele minuto (avisoChamada), se a chamada do dia ainda não foi feita.
   Os dois professores da turma recebem; quando um faz a chamada, o aviso some do app dos dois.
   O aparelho do professor fica em escolas/{eid}/equipe/{uid}.push (o servidor grava, pela ação "push" de professor.js). */
'use strict';
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const C = require('./calculo');

// agora em Recife: data, dia da semana (0 = domingo) e hora HH:MM
function agoraRecife(ms = Date.now()) {
  const d = new Date(ms - 3 * 36e5), iso = d.toISOString();
  return { data: iso.slice(0, 10), dia: d.getUTCDay(), hora: iso.slice(11, 16) };
}
const horaOk = h => typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

module.exports = (db, enviar) => {
  // enviar(tokens, mensagem) → [{ ok, codigo }]; nos testes vem de fora
  enviar = enviar || (async (tokens, msg) => {
    const r = await admin.messaging().sendEachForMulticast({ tokens, ...msg });
    return r.responses.map(x => ({ ok: x.success, codigo: x.error && x.error.code }));
  });

  async function espelhar(eid, tid, t) {
    const ref = db.doc(`agendaChamada/${eid}_${tid}`);
    if (!t || t.chamada === false || !t.chamadaObrig || !horaOk(t.hora) || !(t.dias || []).length) return ref.delete().catch(() => { });
    return ref.set({ eid, tid, nome: t.nome || 'Turma', hora: t.hora, dias: t.dias, pids: C.profsTurma(t) });
  }
  const espelharTurma = onDocumentWritten('escolas/{eid}/turmas/{tid}', ev =>
    espelhar(ev.params.eid, ev.params.tid, ev.data.after.exists ? ev.data.after.data() : null));

  // avisa as turmas que começam agora (uma vez por turma e dia)
  async function avisar(ms = Date.now()) {
    const a = agoraRecife(ms), q = await db.collection('agendaChamada').where('hora', '==', a.hora).get();
    let enviados = 0;
    for (const x of q.docs) {
      const g = x.data();
      if (!(g.dias || []).includes(a.dia) || !(g.pids || []).length) continue;
      const marca = db.doc(`escolas/${g.eid}/avisosChamada/${g.tid}_${a.data}`);
      if ((await marca.get()).exists) continue;
      if ((await db.doc(`escolas/${g.eid}/chamadas/${C.chaveChamada(g.tid, a.data)}`).get()).exists) continue;
      await marca.set({ em: ms });
      const eq = await db.collection(`escolas/${g.eid}/equipe`).where('pid', 'in', g.pids.slice(0, 10)).get();
      const donos = [];
      eq.docs.forEach(d => (d.data().push || []).forEach(tk => donos.push({ ref: d.ref, tk })));
      if (!donos.length) continue;
      // serve para o site (web push) e para os apps da Apple e do Android (o mesmo Firebase Cloud Messaging)
      const titulo = `Chamada: ${g.nome}`, corpo = `A aula começou (${g.hora.replace(':', 'h')}). Toque para fazer a chamada.`;
      const msg = { notification: { title: titulo, body: corpo }, data: { titulo, corpo, url: `./?chamada=${g.eid}.${g.tid}` },
        android: { priority: 'high', notification: { sound: 'default' } }, apns: { payload: { aps: { sound: 'default' } } },
        webpush: { headers: { Urgency: 'high', TTL: '3600' } } };
      const r = await enviar(donos.map(d => d.tk), msg);
      for (let i = 0; i < r.length; i++) {
        if (r[i].ok) { enviados++; continue; }
        // aparelho que não recebe mais: sai da lista
        if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r[i].codigo || '')) await donos[i].ref.update({ push: FieldValue.arrayRemove(donos[i].tk) }).catch(() => { });
      }
    }
    return { enviados };
  }
  const avisoChamada = onSchedule({ schedule: '* * * * *', timeZone: 'America/Recife', maxInstances: 1, timeoutSeconds: 50 }, async () => {
    try { await avisar(); } catch (e) { logger.error(e); }
  });
  return { espelharTurma, avisoChamada, interno: { espelhar, avisar, agoraRecife } };
};

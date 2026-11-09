/* Turma em Dia · excluir a escola (só quem criou; no app, depois de digitar "excluir").
   - Sem nenhum pagamento recebido pelo app: apaga tudo na hora.
   - Com pagamentos: encerra. Some da lista de todos, para de cobrar (plano, cartão) e de mandar avisos;
     os registros de pagamento e as notas ficam guardados pelo prazo da lei (5 anos) e depois são apagados (rotina diária). */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const CINCO_ANOS = 5 * 365.25 * 864e5;
const idOk = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x);

module.exports = (db, opcoes = {}) => {
  const erro = (m, http) => Object.assign(new Error(m), { http });
  const verificar = opcoes.verificar || (async t => admin.auth().verifyIdToken(t));
  const cancelarCartao = opcoes.cancelarCartao || (async () => { });
  const apagarTudo = opcoes.apagarTudo || (ref => db.recursiveDelete(ref));

  // tira a escola da lista de cada pessoa ligada a ela e desliga códigos e avisos de chamada
  async function desligar(eid, e) {
    const uids = new Set([...(e.admins || []), e.dono].filter(Boolean));
    for (const c of ['membros', 'equipe']) (await db.collection(`escolas/${eid}/${c}`).get()).docs.forEach(d => uids.add(d.id));
    for (const uid of uids) await db.doc(`users/${uid}`).set({ escolas: { [eid]: FieldValue.delete() } }, { merge: true }).catch(() => { });
    for (const d of (await db.collection('codigos').where('eid', '==', eid).get()).docs) await d.ref.delete();
    for (const d of (await db.collection('agendaChamada').where('eid', '==', eid).get()).docs) await d.ref.delete();
    await cancelarCartao(eid).catch(x => logger.warn('excluir escola: cartão', eid, x.message));
  }

  const excluirEscola = onRequest({ cors: true, maxInstances: 2, timeoutSeconds: 300 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const h = req.get('Authorization') || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
      if (!t) throw erro('Entre na sua conta.', 401);
      let u; try { u = await verificar(t); } catch (x) { throw erro('Entre na sua conta de novo.', 401); }
      const { eid, confirma } = req.body || {};
      if (!idOk(eid) || String(confirma || '').trim().toLowerCase() !== 'excluir') throw erro('Pedido inválido.', 400);
      const ref = db.doc(`escolas/${eid}`), s = await ref.get(), e = s.exists ? s.data() : null;
      if (!e || e.encerradaEm) throw erro('Essa escola não existe mais.', 404);
      if ((e.dono || (e.admins || [])[0]) !== u.uid) throw erro('Só quem criou a escola pode excluí-la.', 403);
      const pagos = await db.collection(`escolas/${eid}/cobrancas`).where('status', '==', 'approved').limit(1).get();
      await desligar(eid, e);
      if (pagos.empty) { await apagarTudo(ref); return res.json({ ok: true, apagada: true }); }
      await ref.set({ encerradaEm: Date.now(), encerradaPor: u.uid, apagarEm: Date.now() + CINCO_ANOS }, { merge: true });
      return res.json({ ok: true, apagada: false });
    } catch (x) { if (!x.http) logger.error(x); res.status(x.http || 500).json({ erro: x.http ? x.message : 'Algo deu errado. Tente de novo.' }); }
  });

  // rotina diária: escola encerrada há mais de 5 anos é apagada de vez
  async function limpar(agora = Date.now()) {
    let n = 0;
    for (const d of (await db.collection('escolas').where('apagarEm', '<', agora).get()).docs) { await apagarTudo(d.ref); n++; }
    return n;
  }
  return { excluirEscola, interno: { limpar, desligar } };
};

/* Turma em Dia · cópias públicas mantidas pelo servidor.
   profsPublico/{pid}: só o nome do(a) professor(a) e se o Pix dele(a) está ligado. As famílias leem esta
   cópia para mostrar "Professor(a)" e "Para Fulana" no Pix; telefone, chave Pix e conta ficam só com a escola.
   convitesProf/{e-mail}: de que escolas este e-mail é professor (área do professor, professor.js). */
'use strict';
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { FieldValue } = require('firebase-admin/firestore');
const chaveEmail = e => String(e || '').trim().toLowerCase().replace('@', '_at_').replace(/[^a-z0-9_-]/g, '_');

module.exports = db => {
  const espelharProf = onDocumentWritten('escolas/{eid}/professoras/{pid}', async ev => {
    const { eid, pid } = ev.params, d = ev.data.after.exists ? ev.data.after.data() : null, ref = db.doc(`escolas/${eid}/profsPublico/${pid}`);
    const antes = ev.data.before.exists ? ev.data.before.data() : null;
    // e-mail para entrar no app (área do professor): guarda o caminho e-mail → escola; trocou ou apagou, o acesso antigo acaba
    const e0 = String((antes && antes.emailApp) || '').toLowerCase(), e1 = String((d && d.emailApp) || '').toLowerCase();
    if (e0 !== e1) {
      if (e0) {
        await db.doc(`convitesProf/${chaveEmail(e0)}`).set({ [`${eid}_${pid}`]: FieldValue.delete() }, { merge: true });
        const eq = await db.collection(`escolas/${eid}/equipe`).where('pid', '==', pid).get();
        for (const x of eq.docs) { await x.ref.delete(); await db.doc(`users/${x.id}`).set({ escolas: { [eid]: FieldValue.delete() } }, { merge: true }).catch(() => { }); }
      }
      if (e1) await db.doc(`convitesProf/${chaveEmail(e1)}`).set({ [`${eid}_${pid}`]: { eid, pid, em: Date.now() } }, { merge: true });
    }
    if (!d) return ref.delete();
    return ref.set({ nome: d.nome || '', mpConectadoEm: d.mpConectadoEm || null });
  });
  return { espelharProf };
};

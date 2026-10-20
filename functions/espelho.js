/* Turma em Dia · cópias públicas mantidas pelo servidor.
   profsPublico/{pid}: só o nome do(a) professor(a) e se o Pix dele(a) está ligado. As famílias leem esta
   cópia para mostrar "Professor(a)" e "Para Fulana" no Pix; telefone, chave Pix e conta ficam só com a escola. */
'use strict';
const { onDocumentWritten } = require('firebase-functions/v2/firestore');

module.exports = db => {
  const espelharProf = onDocumentWritten('escolas/{eid}/professoras/{pid}', async ev => {
    const { eid, pid } = ev.params, d = ev.data.after.exists ? ev.data.after.data() : null, ref = db.doc(`escolas/${eid}/profsPublico/${pid}`);
    if (!d) return ref.delete();
    return ref.set({ nome: d.nome || '', mpConectadoEm: d.mpConectadoEm || null });
  });
  return { espelharProf };
};

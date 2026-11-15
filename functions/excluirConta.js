/* Turma em Dia · apagar a própria conta (qualquer pessoa: responsável, professor(a), administração ou quem ainda
   não está ligado a nenhuma escola). No app, depois de confirmar.
   - Quem criou uma escola que ainda existe não apaga a conta por aqui: primeiro exclui a escola (ou passa para outra pessoa).
   - Apaga o login, o perfil (users/{uid}), os pedidos para entrar em escolas e a ligação com cada escola
     (membros, vínculos, equipe, administração). Os cadastros que a escola fez (aluno, responsável, professor)
     continuam com a escola, que é quem decide sobre eles; a pessoa pode pedir a exclusão à escola. */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const idOk = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x);

module.exports = (db, opcoes = {}) => {
  const erro = (m, http) => Object.assign(new Error(m), { http });
  const verificar = opcoes.verificar || (async t => admin.auth().verifyIdToken(t));
  const apagarLogin = opcoes.apagarLogin || (async uid => admin.auth().deleteUser(uid));
  const apagarTudo = opcoes.apagarTudo || (ref => db.recursiveDelete(ref));

  // escolas ligadas à pessoa: as da lista dela e as em que ela tem pedido para entrar como professor(a)
  async function escolasDe(uid, u) {
    const ids = new Set(Object.keys(u.escolas || {}).filter(idOk));
    Object.keys(u.pedidosProf || {}).filter(idOk).forEach(e => ids.add(e));
    for (const d of (await db.collection('escolas').where('admins', 'array-contains', uid).get()).docs) ids.add(d.id);
    return [...ids];
  }

  async function apagar(uid) {
    const uref = db.doc(`users/${uid}`), us = await uref.get(), u = us.exists ? us.data() : {};
    const eids = await escolasDe(uid, u);
    // quem criou uma escola ativa precisa excluí-la antes
    for (const eid of eids) {
      const s = await db.doc(`escolas/${eid}`).get(), e = s.exists ? s.data() : null;
      if (e && !e.encerradaEm && (e.dono || (e.admins || [])[0]) === uid)
        throw erro(`Você criou a escola ${e.nome || ''}. Para apagar sua conta, exclua a escola antes (Ajustes da escola → Excluir escola).`.replace('  ', ' '), 409);
    }
    for (const eid of eids) {
      const base = `escolas/${eid}`, s = await db.doc(base).get(), e = s.exists ? s.data() : null;
      if (!e) continue;
      await apagarTudo(db.doc(`${base}/membros/${uid}`)).catch(() => { });
      for (const c of ['equipe', 'pedidosProf', 'pedidosFamilia']) await db.doc(`${base}/${c}/${uid}`).delete().catch(() => { });
      if ((e.admins || []).includes(uid)) await db.doc(base).update({ admins: FieldValue.arrayRemove(uid), [`adminsInfo.${uid}`]: FieldValue.delete() }).catch(x => logger.warn('excluir conta: admins', eid, x.message));
    }
    for (const d of (await db.collection('agendaChamada').where('uid', '==', uid).get().catch(() => ({ docs: [] }))).docs) await d.ref.delete().catch(() => { });
    for (const d of (await db.collection('erros').where('uid', '==', uid).get().catch(() => ({ docs: [] }))).docs) await d.ref.delete().catch(() => { });
    await apagarTudo(uref).catch(() => { });
    await apagarLogin(uid).catch(x => { if (x.code !== 'auth/user-not-found') throw x; });
    return { escolas: eids.length };
  }

  const excluirConta = onRequest({ cors: true, maxInstances: 2, timeoutSeconds: 120 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const h = req.get('Authorization') || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
      if (!t) throw erro('Entre na sua conta.', 401);
      let u; try { u = await verificar(t); } catch (x) { throw erro('Entre na sua conta de novo.', 401); }
      if (String((req.body || {}).confirma || '').trim().toLowerCase() !== 'apagar') throw erro('Pedido inválido.', 400);
      const r = await apagar(u.uid);
      logger.info('conta apagada', u.uid, r.escolas);
      return res.json({ ok: true });
    } catch (x) { if (!x.http) logger.error(x); res.status(x.http || 500).json({ erro: x.http ? x.message : 'Algo deu errado. Tente de novo.' }); }
  });

  return { excluirConta, interno: { apagar } };
};

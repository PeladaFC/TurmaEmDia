/* Turma em Dia · ações que precisam do servidor porque mexem em dados de outras pessoas:
   - adminConvite: quem criou a escola convida alguém para a administração pelo e-mail; só quem entra
     com aquele e-mail (confirmado) vê o convite e pode aceitar. Ninguém se coloca na administração sozinho.
   - eventoResposta: o responsável diz se o filho vai a um evento. Em evento pago pelo caixa da escola,
     a lista de quem é cobrado acompanha a resposta. Em evento em que a própria família faz a inscrição
     (cobranca 'familia'), ela também confirma "Já fiz a inscrição" (e pode desfazer o que ela mesma confirmou). */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const idOk = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x);
const chaveEmail = e => String(e || '').trim().toLowerCase().replace('@', '_at_').replace(/[^a-z0-9_-]/g, '_');
const VALIDADE = 7 * 864e5;

module.exports = db => {
  const erro = (m, http) => Object.assign(new Error(m), { http });
  const ler = async p => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
  async function usuario(req) {
    const h = req.get('Authorization') || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!t) throw erro('Entre na sua conta.', 401);
    try { return await admin.auth().verifyIdToken(t); } catch (e) { throw erro('Entre na sua conta de novo.', 401); }
  }
  const responder = fn => onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
    try { if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' }); res.json(await fn(await usuario(req), req.body || {})); }
    catch (e) { if (!e.http) logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.', codigo: e.codigo || null }); }
  });

  const adminConvite = responder(async (u, { acao, eid, nome, email }) => {
    if (acao === 'listar' || acao === 'aceitar' || acao === 'recusar') {
      if (!u.email) return { convites: [] };
      const k = chaveEmail(u.email), ref = db.doc(`convitesAdm/${k}`), todos = (await ref.get()).data() || {};
      const validos = Object.entries(todos).filter(([, c]) => c && c.expira > Date.now()).map(([e, c]) => ({ eid: e, nome: c.nome, escola: c.escola, porNome: c.porNome, expira: c.expira }));
      if (acao === 'listar') return { convites: validos, confirmado: !!u.email_verified };
      if (!idOk(eid) || !validos.some(c => c.eid === eid)) throw erro('Convite não encontrado ou vencido.', 404);
      if (acao === 'aceitar') {
        // só quem confirmou o e-mail: senão alguém poderia criar uma conta com o e-mail de outra pessoa
        if (!u.email_verified) throw Object.assign(erro('Confirme o seu e-mail antes de aceitar. Enviamos um link para ' + u.email + '.', 403), { codigo: 'confirmar-email' });
        const escRef = db.doc(`escolas/${eid}`), esc_ = (await escRef.get()).data();
        if (!esc_) throw erro('Escola não encontrada.', 404);
        await escRef.update({ admins: FieldValue.arrayUnion(u.uid), [`adminsInfo.${u.uid}`]: { nome: u.name || todos[eid].nome || '', email: u.email, em: Date.now(), convidadoPor: todos[eid].por || null }, [`convitesAdm.${k}`]: FieldValue.delete() });
        await db.doc(`users/${u.uid}`).set({ escolas: { [eid]: { nome: esc_.nome || 'Escola', papel: 'admin' } } }, { merge: true });
      } else await db.doc(`escolas/${eid}`).update({ [`convitesAdm.${k}`]: FieldValue.delete() }).catch(() => { });
      await ref.set({ [eid]: FieldValue.delete() }, { merge: true });
      return { ok: true };
    }
    // criar e cancelar: só quem criou a escola
    if (!idOk(eid)) throw erro('Pedido inválido.', 400);
    const escRef = db.doc(`escolas/${eid}`), esc_ = (await escRef.get()).data();
    if (!esc_ || esc_.dono !== u.uid) throw erro('Só quem criou a escola pode convidar para a administração.', 403);
    const em = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) || em.length > 120) throw erro('Confira o e-mail.', 400);
    const k = chaveEmail(em);
    if (acao === 'cancelar') {
      await escRef.update({ [`convitesAdm.${k}`]: FieldValue.delete() });
      await db.doc(`convitesAdm/${k}`).set({ [eid]: FieldValue.delete() }, { merge: true });
      return { ok: true };
    }
    if (acao !== 'criar') throw erro('Pedido inválido.', 400);
    const n = String(nome || '').trim().slice(0, 60); if (!n) throw erro('Digite o nome da pessoa.', 400);
    if (Object.entries(esc_.adminsInfo || {}).some(([uid, i]) => (esc_.admins || []).includes(uid) && String(i.email || '').toLowerCase() === em)) throw erro('Esta pessoa já faz parte da administração.', 409);
    const c = { nome: n, email: em, em: Date.now(), por: u.uid, porNome: u.name || '', escola: esc_.nome || '', expira: Date.now() + VALIDADE };
    await db.doc(`convitesAdm/${k}`).set({ [eid]: c }, { merge: true });
    await escRef.update({ [`convitesAdm.${k}`]: c });
    return { ok: true };
  });

  const eventoResposta = responder(async (u, { eid, xid, alid, st }) => {
    if (!idOk(eid) || !idOk(xid) || !idOk(alid) || !['interesse', 'nao', 'inscrito'].includes(st)) throw erro('Pedido inválido.', 400);
    const a = await ler(`escolas/${eid}/alunas/${alid}`);
    if (!a || !a.responsavelId || !(await db.doc(`escolas/${eid}/membros/${u.uid}/vinculos/${a.responsavelId}`).get()).exists) throw erro('Você só pode responder pelos seus filhos.', 403);
    const ref = db.doc(`escolas/${eid}/extras/${xid}`);
    await db.runTransaction(async t => {
      const x = (await t.get(ref)).data();
      if (!x || !(x.tipo === 'evento' || x.tipo === 'competicao') || !(x.semCobranca || x.cobranca === 'app')) throw erro('Evento não encontrado.', 404);
      if (!(x.convidados || []).includes(alid)) throw erro('Este evento não é para este aluno.', 403);
      const pag = (await t.get(db.doc(`escolas/${eid}/pagamentos/${alid}`))).data() || {}, pago = (((pag.extras || {})[xid]) || {}).s === 'pago';
      const atual = (x.part || {})[alid] || {}, fam = x.cobranca !== 'app'; // fora do Pix no app, a família se inscreve com a organização e confirma aqui
      if (st === 'inscrito' && !fam) throw erro('Pedido inválido.', 400);
      if (pago || (atual.st === 'inscrito' && !(fam && atual.quem === 'familia'))) throw erro('A inscrição já está confirmada. Para mudar, fale com a escola.', 409);
      const up = { [`part.${alid}`]: { st, em: Date.now(), por: u.uid, quem: 'familia' } };
      if (x.cobranca === 'app') up.alunas = st === 'interesse' ? FieldValue.arrayUnion(alid) : FieldValue.arrayRemove(alid);
      t.update(ref, up);
    });
    return { ok: true };
  });

  return { adminConvite, eventoResposta };
};

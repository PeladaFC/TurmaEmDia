/* Turma em Dia · professor(a) que pede para entrar numa escola com o código da escola.
   - codigoEscola: a administração vê (e o app cria na primeira vez) o código de 6 letras da escola.
     Fica em escolas/{eid}.codigoProf e no índice codigosEscola/{CODIGO} → { eid } (só o servidor lê e grava).
   - profPedir: quem fez o cadastro de professor(a) no app digita o código. A escola recebe o pedido
     em escolas/{eid}/pedidosProf/{uid}, com os dados do cadastro (nome, WhatsApp, e-mail, CPF, CREF, o que ensina).
   - profAprovar: a administração libera (liga a um professor já cadastrado ou cria um novo) ou recusa.
     Liberar é o mesmo que a escola pôr o e-mail no cadastro do professor (professoras/{pid}.emailApp):
     a área do professor (professor.js) e o espelho (espelho.js) seguem como sempre. Com o e-mail já confirmado,
     o acesso fica pronto na hora. */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const idOk = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x);
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I, que se confundem
const codigoNovo = () => Array.from({ length: 6 }, () => LETRAS[Math.floor(Math.random() * LETRAS.length)]).join('');
const codigoOk = c => typeof c === 'string' && new RegExp(`^[${LETRAS}]{6}$`).test(c);

module.exports = (db, opcoes = {}) => {
  const erro = (m, http) => Object.assign(new Error(m), { http });
  const ler = async p => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
  const verificar = opcoes.verificar || (async t => admin.auth().verifyIdToken(t));
  const pessoa = opcoes.pessoa || (async uid => { try { const r = await admin.auth().getUser(uid); return { email: r.email || '', verificado: !!r.emailVerified }; } catch (e) { return null; } });
  async function usuario(req) {
    const h = req.get('Authorization') || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!t) throw erro('Entre na sua conta.', 401);
    try { return await verificar(t); } catch (e) { throw erro('Entre na sua conta de novo.', 401); }
  }
  const responder = fn => onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
    try { if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' }); res.json(await fn(await usuario(req), req.body || {})); }
    catch (e) { if (!e.http) logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.' }); }
  });
  async function escolaAdm(u, eid) {
    if (!idOk(eid)) throw erro('Pedido inválido.', 400);
    const e = await ler(`escolas/${eid}`);
    if (!e || !(e.admins || []).includes(u.uid)) throw erro('Só a administração da escola pode fazer isso.', 403);
    return e;
  }

  // o código da escola (cria na primeira vez, sem repetir o de outra escola)
  async function codigoDa(eid, e) {
    if (codigoOk(e.codigoProf)) {
      const idx = await ler(`codigosEscola/${e.codigoProf}`);
      if (idx && idx.eid === eid) return e.codigoProf;
    }
    for (let i = 0; i < 20; i++) {
      const c = codigoNovo(), ref = db.doc(`codigosEscola/${c}`);
      const ok = await db.runTransaction(async tx => { if ((await tx.get(ref)).exists) return false; tx.set(ref, { eid, em: Date.now() }); return true; });
      if (!ok) continue;
      await db.doc(`escolas/${eid}`).set({ codigoProf: c }, { merge: true });
      return c;
    }
    throw erro('Não deu para criar o código agora. Tente de novo.', 503);
  }
  const codigoEscola = responder(async (u, { eid }) => ({ codigo: await codigoDa(eid, await escolaAdm(u, eid)) }));

  // professor(a) manda o pedido com o código
  const profPedir = responder(async (u, { codigo }) => {
    const c = String(codigo || '').trim().toUpperCase();
    if (!codigoOk(c)) throw erro('O código da escola tem 6 letras e números. Confira e tente de novo.', 400);
    const idx = await ler(`codigosEscola/${c}`), eid = idx && idx.eid;
    const e = idOk(eid) ? await ler(`escolas/${eid}`) : null;
    if (!e || e.encerradaEm || e.codigoProf !== c) throw erro('Não achamos uma escola com esse código. Confira com a escola.', 404);
    const usr = (await ler(`users/${u.uid}`)) || {}, p = usr.perfilProf;
    if (!p || !p.nome) throw erro('Antes, faça o seu cadastro de professor(a).', 400);
    if (await ler(`escolas/${eid}/equipe/${u.uid}`)) return { escola: e.nome || 'Escola', ja: true };
    const ref = db.doc(`escolas/${eid}/pedidosProf/${u.uid}`), antes = await ler(ref.path);
    if (antes && antes.recusadoEm && Date.now() - antes.recusadoEm < 7 * 864e5) throw erro('A escola recusou o seu pedido. Fale com a escola antes de pedir de novo.', 409);
    await ref.set({ nome: p.nome, email: String(u.email || '').toLowerCase(), telefone: p.telefone || '', cpf: p.cpf || '', cref: p.cref || null, ensina: p.ensina || null, nascimento: p.nascimento || null, em: Date.now(), recusadoEm: null });
    await db.doc(`users/${u.uid}`).set({ pedidosProf: { [eid]: { nome: e.nome || 'Escola', em: Date.now() } } }, { merge: true });
    return { escola: e.nome || 'Escola' };
  });

  // a escola libera (ligando a um professor já cadastrado, pid, ou criando um novo) ou recusa
  const profAprovar = responder(async (u, { eid, uid, ok, pid }) => {
    const e = await escolaAdm(u, eid);
    if (!idOk(uid)) throw erro('Pedido inválido.', 400);
    const ref = db.doc(`escolas/${eid}/pedidosProf/${uid}`), p = await ler(ref.path);
    if (!p || p.recusadoEm) throw erro('Esse pedido não existe mais.', 404);
    const quem = await pessoa(uid);
    if (!quem) { await ref.delete(); throw erro('Essa pessoa apagou a conta. O pedido foi tirado da lista.', 404); }
    const tirarDoPerfil = () => db.doc(`users/${uid}`).set({ pedidosProf: { [eid]: FieldValue.delete() } }, { merge: true }).catch(() => { });
    if (!ok) { await ref.set({ recusadoEm: Date.now() }, { merge: true }); await tirarDoPerfil(); return { ok: true }; }
    const email = String(quem.email || p.email || '').toLowerCase();
    if (!email) throw erro('Essa conta não tem e-mail. Peça para a pessoa entrar com e-mail e mandar o pedido de novo.', 400);
    const profs = (await db.collection(`escolas/${eid}/professoras`).get()).docs;
    const outro = profs.find(d => String(d.data().emailApp || '').toLowerCase() === email && d.id !== pid);
    if (outro) throw erro(`Este e-mail já está no cadastro de ${outro.data().nome || 'outro(a) professor(a)'}.`, 409);
    let id = pid;
    const dados = { emailApp: email };
    if (id) {
      if (!idOk(id) || !profs.some(d => d.id === id)) throw erro('Esse(a) professor(a) não está mais na escola.', 404);
      const atual = profs.find(d => d.id === id).data();
      if (!atual.telefone && p.telefone) dados.telefone = p.telefone;
    } else {
      id = db.collection(`escolas/${eid}/professoras`).doc().id;
      Object.assign(dados, { nome: p.nome, telefone: p.telefone || '', criadoEm: Date.now(), via: 'pedido' });
    }
    await db.doc(`escolas/${eid}/professoras/${id}`).set(dados, { merge: true });
    // e-mail já confirmado: o acesso fica pronto agora (o mesmo que a área do professor faz ao "vincular")
    if (quem.verificado) {
      const P = (await ler(`escolas/${eid}/professoras/${id}`)) || {};
      await db.doc(`escolas/${eid}/equipe/${uid}`).set({ pid: id, email, nome: P.nome || p.nome, em: Date.now() });
      await db.doc(`users/${uid}`).set({ escolas: { [eid]: { nome: e.nome || 'Escola', papel: 'professora', prof: P.nome || p.nome } } }, { merge: true });
      await db.doc(`escolas/${eid}/professoras/${id}`).set({ appUid: uid, appEm: Date.now() }, { merge: true });
    }
    await ref.delete(); await tirarDoPerfil();
    return { ok: true, pid: id, pronto: quem.verificado };
  });

  return { codigoEscola, profPedir, profAprovar, interno: { codigoDa, codigoOk } };
};

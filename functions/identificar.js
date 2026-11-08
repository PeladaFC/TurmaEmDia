/* Turma em Dia · responsável que chega sem código.
   Ele faz o cadastro (nome, WhatsApp, CPF; o e-mail vem da conta) e o app procura em todas as escolas:
   - e-mail confirmado igual ao do cadastro do responsável na escola: entra sozinho (vê os filhos daquela escola);
   - só o CPF ou o WhatsApp batem: a escola recebe um pedido ("Fulano diz ser responsável por Alice") e libera com um toque.
     (CPF e telefone não são confirmados no login: sem a escola aprovar, qualquer um poderia digitar os de outra pessoa.)
   Para achar rápido, cada cadastro de responsável fica num índice: idxResp/{e:email | c:cpf | t:telefone}.refs.{eid~rid}.
   Cada escola é separada: quem tem filhos em duas escolas vê as duas na lista de escolas. */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const C = require('./calculo');

const idOk = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x);
const chaves = r => {
  if (!r) return [];
  const e = String(r.email || '').trim().toLowerCase(), c = C.soDigitos(r.cpf), t = C.telNorm(r.telefone), out = [];
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) out.push('e:' + e.replace(/[\/.#$\[\]]/g, '_'));
  if (c.length === 11) out.push('c:' + c);
  if (t.length >= 10) out.push('t:' + t);
  return out;
};

module.exports = (db, opcoes = {}) => {
  const erro = (m, http) => Object.assign(new Error(m), { http });
  const ler = async p => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
  const verificar = opcoes.verificar || (async t => admin.auth().verifyIdToken(t));
  async function usuario(req) {
    const h = req.get('Authorization') || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!t) throw erro('Entre na sua conta.', 401);
    try { return await verificar(t); } catch (e) { throw erro('Entre na sua conta de novo.', 401); }
  }
  const responder = fn => onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
    try { if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' }); res.json(await fn(await usuario(req), req.body || {})); }
    catch (e) { if (!e.http) logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.' }); }
  });

  // índice: quando a escola grava um responsável, as chaves dele (e-mail, CPF, telefone) apontam para eid~rid
  async function indexar(eid, rid, antes, depois) {
    const ref = `${eid}~${rid}`, velhas = new Set(chaves(antes)), novas = new Set(chaves(depois));
    for (const k of velhas) if (!novas.has(k)) await db.doc(`idxResp/${k}`).set({ refs: { [ref]: FieldValue.delete() } }, { merge: true });
    for (const k of novas) if (!velhas.has(k)) await db.doc(`idxResp/${k}`).set({ refs: { [ref]: true } }, { merge: true });
  }
  const indexarResp = onDocumentWritten('escolas/{eid}/responsaveis/{rid}', ev =>
    indexar(ev.params.eid, ev.params.rid, ev.data.before.exists ? ev.data.before.data() : null, ev.data.after.exists ? ev.data.after.data() : null));
  // na primeira vez, indexa o que já existia
  async function indexarTudo() {
    if (await ler('servidor/idxResp')) return;
    for (const e of (await db.collection('escolas').get()).docs)
      for (const r of (await db.collection(`escolas/${e.id}/responsaveis`).get()).docs) await indexar(e.id, r.id, null, r.data());
    await db.doc('servidor/idxResp').set({ em: Date.now() });
  }

  async function ligar(uid, u, eid, rids, via, nome) {
    const esc = (await ler(`escolas/${eid}`)) || {};
    const mref = db.doc(`escolas/${eid}/membros/${uid}`);
    if (!(await mref.get()).exists) await mref.set({ nome: nome || u.name || '', email: u.email || '', em: Date.now(), via });
    let familia = '';
    for (const rid of rids) { await db.doc(`escolas/${eid}/membros/${uid}/vinculos/${rid}`).set({ em: Date.now(), via }, { merge: true }); familia = familia || ((await ler(`escolas/${eid}/responsaveis/${rid}`)) || {}).nome || ''; }
    await db.doc(`users/${uid}`).set({ escolas: { [eid]: { nome: esc.nome || 'Escola', papel: 'familia', familia } } }, { merge: true });
    return { eid, nome: esc.nome || 'Escola', familia };
  }

  // o responsável salva o cadastro e o app procura os filhos dele nas escolas
  const familiaIdentificar = responder(async (u, { nome, telefone, cpf }) => {
    const perfil = { nome: String(nome || u.name || '').trim().slice(0, 80), telefone: String(telefone || '').trim().slice(0, 30), cpf: C.soDigitos(cpf).slice(0, 11), email: u.email || '', em: Date.now() };
    if (nome !== undefined) await db.doc(`users/${u.uid}`).set({ perfil }, { merge: true });
    const p = nome !== undefined ? perfil : (((await ler(`users/${u.uid}`)) || {}).perfil || null);
    if (!p) return { escolas: [], pedidos: 0 };
    await indexarTudo();
    const confirmado = !!(u.email && u.email_verified);
    const porEmail = new Set(), porDoc = new Set();
    const ks = chaves({ email: u.email, cpf: p.cpf, telefone: p.telefone });
    for (const k of ks) {
      const refs = Object.keys(((await ler(`idxResp/${k}`)) || {}).refs || {});
      for (const r of refs) (k.startsWith('e:') && confirmado ? porEmail : porDoc).add(r);
    }
    const agrupa = set => { const m = {}; for (const r of set) { const [eid, rid] = r.split('~'); if (idOk(eid) && idOk(rid)) (m[eid] = m[eid] || []).push(rid); } return m; };
    const escolas = [], A = agrupa(porEmail), B = agrupa([...porDoc].filter(r => !porEmail.has(r)));
    for (const [eid, rids] of Object.entries(A)) {
      const ja = new Set((await db.collection(`escolas/${eid}/membros/${u.uid}/vinculos`).get()).docs.map(d => d.id));
      const novos = rids.filter(r => !ja.has(r)); if (!novos.length) continue;
      escolas.push(await ligar(u.uid, u, eid, novos, 'email', p.nome));
    }
    let pedidos = 0;
    for (const [eid, rids] of Object.entries(B)) {
      const ja = new Set((await db.collection(`escolas/${eid}/membros/${u.uid}/vinculos`).get()).docs.map(d => d.id));
      const recusados = new Set(((await ler(`escolas/${eid}/pedidosFamilia/${u.uid}`)) || {}).recusados || []);
      const novos = rids.filter(r => !ja.has(r) && !recusados.has(r)); if (!novos.length) continue;
      await db.doc(`escolas/${eid}/pedidosFamilia/${u.uid}`).set({ nome: p.nome, email: u.email || '', telefone: p.telefone, cpf: p.cpf, rids: novos, em: Date.now() }, { merge: true });
      pedidos++;
    }
    return { escolas, pedidos };
  });

  // a escola libera (ou recusa) o pedido de um responsável que chegou sem código
  const familiaAprovar = responder(async (u, { eid, uid, ok }) => {
    if (!idOk(eid) || !idOk(uid)) throw erro('Pedido inválido.', 400);
    const esc = await ler(`escolas/${eid}`);
    if (!esc || !(esc.admins || []).includes(u.uid)) throw erro('Só a administração da escola pode fazer isso.', 403);
    const ref = db.doc(`escolas/${eid}/pedidosFamilia/${uid}`), p = await ler(ref.path);
    if (!p || !(p.rids || []).length) throw erro('Esse pedido não existe mais.', 404);
    if (ok) {
      let pessoa = { uid, email: p.email, name: p.nome };
      try { const r = await admin.auth().getUser(uid); pessoa = { uid, email: r.email, name: r.displayName || p.nome }; } catch (e) { }
      await ligar(uid, pessoa, eid, p.rids, 'aprovado', p.nome);
      await ref.delete();
    } else await ref.set({ rids: [], recusados: FieldValue.arrayUnion(...p.rids) }, { merge: true });
    return { ok: true };
  });

  return { indexarResp, familiaIdentificar, familiaAprovar, interno: { indexar, indexarTudo, chaves } };
};

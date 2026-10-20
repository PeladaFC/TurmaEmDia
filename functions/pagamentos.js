/* Turma em Dia · Pix automático pelo Mercado Pago, com comissão da plataforma (split).
   Mesmo desenho do Pelada FC, adaptado para escola → responsável → alunas:
   - mpConectar: a administração da escola toca em "Conectar Mercado Pago"; o servidor devolve o
     endereço de autorização (OAuth), mostra os dados da conta ou desconecta. Para um(a) professor(a)
     que recebe as próprias turmas, gera um link (mpLigar) que a administração manda para ele(a).
   - mpRetorno: o Mercado Pago volta para cá com um código; o servidor troca pela chave da conta
     da escola e guarda em escolas/{eid}/segredos/mp.
   - criarPix: o responsável (ou a administração, "cobrar na hora") escolhe os itens que quer pagar,
     de um filho ou de vários. O servidor confere cada item, calcula o valor (nunca confia no app, e usa
     o mesmo calculo.js do app, com multa e juros), separa por quem recebe (escola ou professor) e cria
     um Pix para cada recebedor, guardados em escolas/{eid}/cobrancas/{chave}.
   - mpWebhook: o Mercado Pago avisa; o servidor busca o pagamento de novo e, se aprovado,
     dá baixa em cada item na ficha da aluna, em escolas/{eid}/pagamentos/{alid}.
   - vinculos: sugere juntar alunas cadastradas com o mesmo telefone ou CPF do responsável; ele decide.
   A aplicação do Mercado Pago é da plataforma (servidor/mp: clientId, clientSecret, comissao),
   a mesma do Pelada FC. Cada Pix leva application_fee, que o Mercado Pago separa sozinho. */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const C = require('./calculo');

const MP = 'https://api.mercadopago.com';
const REGIAO = 'southamerica-east1';
const projeto = () => process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
const BASE = () => `https://${REGIAO}-${projeto()}.cloudfunctions.net`;
const TAXA = 0.0099;            // taxa do Pix online no Mercado Pago (conferida em 10/10/2026)
const VALIDADE_H = 24;          // o QR vale por 24 horas
const COMISSAO_PADRAO = 0.01;   // comissão da plataforma, se servidor/mp não disser outra

function agoraRecife() { return new Date(Date.now() - 3 * 3600e3); }
const hojeRecife = () => agoraRecife().toISOString().slice(0, 10);
function isoRecife(ms) { const d = new Date(ms - 3 * 3600e3); return d.toISOString().slice(0, 19) + '.000-03:00'; }
const idOk = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x);
// só volta para o próprio app (GitHub Pages, domínio próprio cadastrado, ou teste local)
function voltaOk(u, extras) {
  try { const x = new URL(u); if (x.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(x.hostname)) return true;
    if (x.protocol !== 'https:') return false; if (/\.github\.io$/.test(x.hostname)) return true;
    return (extras || []).some(h => x.hostname === h); } catch (e) { return false; }
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paginaSimples = (titulo, texto) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)} · Turma em Dia</title>
<style>body{margin:0;font:17px/1.5 system-ui,sans-serif;background:#F6F3EE;color:#221D17;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}main{max-width:420px;background:#fff;border-radius:18px;padding:28px;border:1px solid #E4DDD2}h1{font-size:1.4rem;margin:0 0 8px;color:#8B6B47}</style></head>
<body><main><h1>${esc(titulo)}</h1><p>${texto}</p></main></body></html>`;

module.exports = db => {
  const erro = (m, http) => Object.assign(new Error(m), { http });
  const ler = async p => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
  const mapa = async p => Object.fromEntries((await db.collection(p).get()).docs.map(d => [d.id, d.data()]));

  async function plataforma() {
    const d = (await ler('servidor/mp')) || {};
    return { id: d.clientId || '', segredo: d.clientSecret || '', comissao: d.comissao != null ? Number(d.comissao) : COMISSAO_PADRAO, dominios: d.dominios || [] };
  }
  async function trocaOAuth(corpo) {
    const r = await fetch(MP + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) { logger.error('mp oauth', r.status, j.message || j.error); throw erro('O Mercado Pago não liberou a conta.', 502); }
    return { token: j.access_token, refresh: j.refresh_token || null, expira: Date.now() + (Number(j.expires_in) || 15552000) * 1000, mpUser: j.user_id != null ? String(j.user_id) : null };
  }
  // chave da conta de quem recebe: a escola (segredos/mp) ou um(a) professor(a) (segredos/mp_{pid});
  // renova sozinha quando falta menos de 15 dias (vale ~6 meses)
  const segredoDe = (eid, rec) => db.doc(`escolas/${eid}/segredos/${!rec || rec === 'escola' ? 'mp' : 'mp_' + rec}`);
  async function contaMP(eid, rec) {
    const ref = segredoDe(eid, rec), s = await ref.get();
    if (!s.exists || !s.data().token) return null;
    let d = s.data();
    if (d.refresh && d.expira && d.expira < Date.now() + 15 * 864e5) {
      try { const P = await plataforma(); const n = await trocaOAuth({ client_id: P.id, client_secret: P.segredo, grant_type: 'refresh_token', refresh_token: d.refresh }); await ref.set(n, { merge: true }); d = { ...d, ...n }; }
      catch (e) { logger.warn('renovar chave', eid, e.message); }
    }
    return d;
  }
  async function dadosConta(token) {
    try {
      const r = await fetch(MP + '/users/me', { headers: { Authorization: 'Bearer ' + token } }); if (!r.ok) return null;
      const u = await r.json(), id = u.identification || {}, n = String(id.number || '').replace(/\D/g, '');
      const doc = n.length === 11 ? `***.${n.slice(3, 6)}.${n.slice(6, 9)}-**` : n.length === 14 ? `**.***.${n.slice(5, 8)}/${n.slice(8, 12)}-**` : '';
      return { nome: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.nickname || '', doc, tipoDoc: id.type || '' };
    } catch (e) { return null; }
  }
  async function usuario(req) {
    const h = req.get('Authorization') || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!t) throw erro('Entre na sua conta.', 401);
    try { return await admin.auth().verifyIdToken(t); } catch (e) { throw erro('Entre na sua conta de novo.', 401); }
  }

  // permissão: administração, ou responsável ligado (membros/{uid}/vinculos/{rid})
  async function meusVinculos(eid, uid) { return new Set((await db.collection(`escolas/${eid}/membros/${uid}/vinculos`).get()).docs.map(d => d.id)); }
  // itens em aberto pedidos, calculados com os dados do banco (nunca confia no app)
  async function itensPedidos(eid, chaves, podeRid) {
    const pedidos = chaves.map(C.lerChave);
    if (pedidos.some(x => !x)) throw erro('Pedido inválido.', 400);
    const alids = [...new Set(pedidos.map(x => x.alid))];
    if (alids.length > 12) throw erro('Escolha no máximo 12 alunos por Pix.', 400);
    const [cfg, turmas, extras, grupos, acordos] = await Promise.all([ler(`escolas/${eid}/config/geral`), mapa(`escolas/${eid}/turmas`), mapa(`escolas/${eid}/extras`), mapa(`escolas/${eid}/grupos`), mapa(`escolas/${eid}/acordos`)]);
    const hoje = hojeRecife(), quer = new Set(chaves), itens = [], rids = new Set();
    for (const alid of alids) {
      const a = await ler(`escolas/${eid}/alunas/${alid}`);
      if (!a) throw erro('Aluno(a) não encontrado(a).', 404);
      if (!podeRid(a.responsavelId)) throw erro('Você só pode pagar as cobranças dos seus filhos.', 403);
      rids.add(a.responsavelId || '');
      // irmãs (mesmo responsável) entram no cálculo do desconto
      const irmas = a.responsavelId ? Object.fromEntries((await db.collection(`escolas/${eid}/alunas`).where('responsavelId', '==', a.responsavelId).get()).docs.map(d => [d.id, d.data()])) : {};
      const alunas = { ...irmas, [alid]: a };
      const pag = (await ler(`escolas/${eid}/pagamentos/${alid}`)) || {};
      for (const i of C.itensComEncargos({ alunas, turmas, extras, grupos, acordos, pag, cfg: cfg || {} }, alid, hoje)) if (quer.has(i.k) && !i.pago && i.v > 0) itens.push(i);
    }
    return { cfg: cfg || {}, itens, rids: [...rids] };
  }

  const criarPix = onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const u = await usuario(req);
      const { eid, itens: chaves } = req.body || {};
      if (!idOk(eid) || !Array.isArray(chaves) || !chaves.length || chaves.length > 80 || !chaves.every(k => typeof k === 'string' && k.length < 140)) return res.status(400).json({ erro: 'Pedido inválido.' });
      const escola = await ler(`escolas/${eid}`);
      if (!escola) return res.status(404).json({ erro: 'Escola não encontrada.' });
      const adm = (escola.admins || []).includes(u.uid);
      const meus = adm ? null : await meusVinculos(eid, u.uid);
      const { cfg, itens, rids } = await itensPedidos(eid, chaves, rid => adm || (rid && meus.has(rid)));
      if (!itens.length) return res.status(409).json({ erro: 'Esses itens já foram pagos ou não estão mais em aberto.' });
      // um Pix para cada recebedor (escola ou professor), com a parte de cada item que é dele
      const por = {};
      for (const i of itens) for (const [rec, v] of Object.entries(i.partes || { escola: i.v })) {
        const L = por[rec] = por[rec] || { rec, base: 0, itens: [] };
        L.base = C.r2(L.base + v); L.itens.push({ k: i.k, tipo: i.tipo, alid: i.alid, mes: i.mes || null, xid: i.xid || null, aid: i.aid || null, n: i.n || null, v: C.r2(v), total: i.v, recs: Object.keys(i.partes || { escola: 1 }), desc: i.desc, nome: i.nome });
      }
      const lotes = Object.values(por).sort((x, y) => (y.rec === 'escola') - (x.rec === 'escola') || x.rec.localeCompare(y.rec));
      const profs = await mapa(`escolas/${eid}/professoras`), nomeRec = r => r === 'escola' ? (escola.nome || 'a escola') : ((profs[r] || {}).nome || 'o(a) professor(a)');
      const contas = {};
      for (const L of lotes) contas[L.rec] = await contaMP(eid, L.rec);
      const sem = lotes.filter(L => !(contas[L.rec] && contas[L.rec].token));
      if (sem.length) return res.status(412).json({ erro: `${sem.map(L => nomeRec(L.rec)).join(' e ')} ainda não ligou o Pix no app. Fale com a escola.` });
      const P = await plataforma(), out = [];
      for (const L of lotes) out.push(await pixDoLote(eid, escola, u, L, contas[L.rec], cfg, rids, P, nomeRec(L.rec)));
      res.json({ lotes: out });
    } catch (e) { logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.' }); }
  });

  // cria (ou reaproveita) o Pix de um recebedor
  async function pixDoLote(eid, escola, u, L, conta, cfg, rids, P, nomeRec) {
    const com = conta.via === 'oauth' ? P.comissao : 0;
    const { valor, fee } = C.valorPix(L.base, cfg, TAXA, com);
    const chave = `${u.uid.slice(0, 20)}_${L.rec}_${C.chaveItens(L.itens.map(i => i.k))}`, cobRef = db.doc(`escolas/${eid}/cobrancas/${chave}`);
    const ant = (await cobRef.get()).data();
    if (ant && ant.status === 'pending' && ant.valor === valor && ant.expira > Date.now() + 10 * 60e3) return { ...ant, chave };
    // outro Pix ainda aberto desta pessoa, para o mesmo recebedor, com algum dos mesmos itens é cancelado, para ninguém pagar duas vezes
    const ks = new Set(L.itens.map(i => i.k));
    const outros = await db.collection(`escolas/${eid}/cobrancas`).where('uid', '==', u.uid).where('status', '==', 'pending').get();
    for (const o of outros.docs) {
      const c = o.data(); if (o.id === chave || (c.rec || 'escola') !== L.rec || !(c.expira > Date.now()) || !(c.itens || []).some(i => ks.has(i.k))) continue;
      const rc = await fetch(`${MP}/v1/payments/${c.mpId}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + conta.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) }).catch(() => null);
      if (rc && rc.ok) await o.ref.set({ status: 'cancelled', atualizadoEm: Date.now() }, { merge: true });
    }
    const expira = Date.now() + VALIDADE_H * 3600e3;
    const nomes = [...new Set(L.itens.map(i => i.nome))];
    const desc = `${escola.nome || 'Escola'} · ${nomes.join(', ')}`;
    const corpo = {
      transaction_amount: valor,
      description: desc.slice(0, 120),
      payment_method_id: 'pix',
      payer: { email: u.email || `responsavel-${u.uid.slice(0, 8)}@turmaemdia.app` },
      external_reference: `${eid}|${chave}`,
      notification_url: `${BASE()}/mpWebhook?e=${encodeURIComponent(eid)}&r=${encodeURIComponent(L.rec)}`,
      date_of_expiration: isoRecife(expira)
    };
    if (fee > 0) corpo.application_fee = fee;
    const r = await fetch(MP + '/v1/payments', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + conta.token, 'Content-Type': 'application/json', 'X-Idempotency-Key': `${eid}_${chave}_${Date.now()}` },
      body: JSON.stringify(corpo)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { logger.error('mp criar', L.rec, r.status, j); throw erro(r.status === 401 ? `A conta do Mercado Pago de ${nomeRec} precisa ser ligada de novo. Avise a escola.` : 'O Mercado Pago não aceitou o pedido agora. Tente de novo.', 502); }
    const td = (j.point_of_interaction || {}).transaction_data || {};
    const dado = {
      mpId: String(j.id), rec: L.rec, valor, base: L.base, fee, status: j.status || 'pending', qr: td.qr_code || '', qr64: td.qr_code_base64 || '', link: td.ticket_url || '',
      criadoEm: Date.now(), expira, uid: u.uid, rids, desc, itens: L.itens
    };
    await cobRef.set(dado);
    return { ...dado, chave };
  }

  // baixa de uma cobrança aprovada: grava cada item como pago na ficha da aluna (valor da dívida, sem a taxa)
  async function darBaixa(eid, cob, mpId) {
    const rec = cob.rec || 'escola';
    const val = v => ({ s: 'pago', d: hojeRecife(), v: C.r2(v), obs: 'Pix automático', via: 'pix', mp: String(mpId), rec });
    const porAluna = {};
    for (const i of cob.itens || []) (porAluna[i.alid] = porAluna[i.alid] || []).push(i);
    for (const [alid, its] of Object.entries(porAluna)) {
      const ref = db.doc(`escolas/${eid}/pagamentos/${alid}`);
      await db.runTransaction(async t => {
        const pag = (await t.get(ref)).data() || {}, up = {};
        for (const i of its) {
          if (i.tipo === 'x' && i.xid) { up.extras = up.extras || {}; up.extras[i.xid] = val(i.v); continue; }
          if (i.tipo === 'a') { const [aid, n] = String(i.k).split(':')[1].split('.'); up.acordos = up.acordos || {}; up.acordos[aid] = { ...(up.acordos[aid] || {}), [n]: val(i.v) }; continue; }
          if (i.tipo !== 'm' || !i.mes) continue;
          // mensalidade dividida entre recebedores: cada um recebe a sua parte; fica "paga" quando todos receberam
          const partes = { ...(((pag.mensPartes || {})[i.mes]) || {}), [rec]: val(i.v) };
          up.mensPartes = up.mensPartes || {}; up.mensPartes[i.mes] = { [rec]: val(i.v) };
          const recs = i.recs && i.recs.length ? i.recs : [rec];
          if (recs.every(r => C.stPag(partes[r]))) { up.mens = up.mens || {}; up.mens[i.mes] = { ...val(i.total || i.v), rec: recs.length > 1 ? 'dividido' : rec }; }
        }
        t.set(ref, up, { merge: true });
      });
    }
  }

  const mpWebhook = onRequest({ maxInstances: 5 }, async (req, res) => {
    try {
      const eid = String(req.query.e || ''), rec = String(req.query.r || 'escola');
      const id = String(req.query['data.id'] || (req.body && req.body.data && req.body.data.id) || (req.query.topic === 'payment' ? req.query.id : '') || '');
      if (!idOk(eid) || !idOk(rec) || !/^\d+$/.test(id)) return res.status(200).send('ok');
      const conta = await contaMP(eid, rec);
      if (!conta || !conta.token) return res.status(200).send('ok');
      // não confia no aviso: busca o pagamento de novo no Mercado Pago
      const r = await fetch(`${MP}/v1/payments/${id}`, { headers: { Authorization: 'Bearer ' + conta.token } });
      if (!r.ok) { logger.warn('mp buscar', r.status); return res.status(500).send('tente de novo'); }
      const p = await r.json();
      const [e2, chave] = String(p.external_reference || '').split('|');
      if (e2 !== eid || !chave || chave.includes('/')) return res.status(200).send('ok');
      const cobRef = db.doc(`escolas/${eid}/cobrancas/${chave}`), cob = (await cobRef.get()).data();
      if (!cob || (cob.rec || 'escola') !== rec) return res.status(200).send('ok');
      if (cob.mpId && cob.mpId !== String(p.id) && cob.status === 'approved') return res.status(200).send('ok');
      await cobRef.set({ status: p.status, mpId: String(p.id), atualizadoEm: Date.now() }, { merge: true });
      if (p.status === 'approved') { await darBaixa(eid, cob, p.id); logger.info('pago', eid, chave, p.id); }
      res.status(200).send('ok');
    } catch (e) { logger.error(e); res.status(200).send('ok'); }
  });

  /* Agrupar alunas pelo responsável. O responsável decide:
     - 'sugestoes': outros cadastros de responsável com o mesmo telefone ou CPF dos que já são dele
       (devolve só o nome do responsável e o primeiro nome das alunas);
     - 'vincular': junta um desses cadastros à conta dele, depois de conferir de novo o telefone ou CPF. */
  const vinculos = onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const u = await usuario(req);
      const { eid, acao, rid } = req.body || {};
      if (!idOk(eid)) return res.status(400).json({ erro: 'Pedido inválido.' });
      const meus = await meusVinculos(eid, u.uid);
      if (!meus.size) return res.status(403).json({ erro: 'Entre com o código da família primeiro.' });
      const mr = await Promise.all([...meus].map(r => ler(`escolas/${eid}/responsaveis/${r}`)));
      const tels = new Set(mr.map(x => C.telNorm((x || {}).telefone)).filter(t => t.length >= 10));
      const cpfs = new Set(mr.map(x => C.soDigitos((x || {}).cpf)).filter(c => c.length === 11));
      const casa = x => x && ((tels.size && tels.has(C.telNorm(x.telefone))) || (cpfs.size && cpfs.has(C.soDigitos(x.cpf))));
      const recusados = new Set((((await ler(`escolas/${eid}/membros/${u.uid}`)) || {}).recusados) || []);
      if (acao === 'vincular') {
        if (!idOk(rid)) return res.status(400).json({ erro: 'Pedido inválido.' });
        const x = await ler(`escolas/${eid}/responsaveis/${rid}`);
        if (!casa(x)) return res.status(403).json({ erro: 'Esse cadastro não tem o seu telefone nem o seu CPF.' });
        await db.doc(`escolas/${eid}/membros/${u.uid}/vinculos/${rid}`).set({ em: Date.now(), via: 'sugestao' });
        return res.json({ ok: true });
      }
      if (acao === 'recusar') {
        if (!idOk(rid)) return res.status(400).json({ erro: 'Pedido inválido.' });
        await db.doc(`escolas/${eid}/membros/${u.uid}`).set({ recusados: [...recusados, rid] }, { merge: true });
        return res.json({ ok: true });
      }
      const todos = await db.collection(`escolas/${eid}/responsaveis`).get(), out = [];
      for (const d of todos.docs) {
        if (meus.has(d.id) || recusados.has(d.id) || !casa(d.data())) continue;
        const al = await db.collection(`escolas/${eid}/alunas`).where('responsavelId', '==', d.id).get();
        if (al.empty) continue;
        out.push({ rid: d.id, responsavel: d.data().nome || '', alunas: al.docs.map(a => String(a.data().nome || '').split(' ')[0]), por: tels.has(C.telNorm(d.data().telefone)) ? 'telefone' : 'CPF' });
      }
      res.json({ sugestoes: out });
    } catch (e) { logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.' }); }
  });

  // conectar / ver / desconectar a conta do Mercado Pago da escola (só administração)
  const mpConectar = onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const u = await usuario(req);
      const { eid, acao, volta, pid } = req.body || {};
      if (!idOk(eid) || (pid != null && !idOk(pid))) return res.status(400).json({ erro: 'Pedido inválido.' });
      const escola = await ler(`escolas/${eid}`);
      if (!escola || !(escola.admins || []).includes(u.uid)) return res.status(403).json({ erro: 'Só a administração da escola pode fazer isso.' });
      if (pid) {
        const pRef = db.doc(`escolas/${eid}/professoras/${pid}`);
        if (!(await pRef.get()).exists) return res.status(404).json({ erro: 'Professor(a) não encontrado(a).' });
        if (acao === 'desconectar') {
          await segredoDe(eid, pid).delete();
          await pRef.set({ mpConectadoEm: null, mpConta: null, mpDesligadoEm: Date.now() }, { merge: true });
          return res.json({ ok: true });
        }
        if (acao === 'link') {
          const P = await plataforma();
          if (!P.id || !P.segredo) return res.status(503).json({ erro: 'O Pix automático ainda está sendo preparado. Tente mais tarde.' });
          const estado = require('crypto').randomBytes(18).toString('hex');
          await db.doc(`servidor/mp/estados/${estado}`).set({ eid, pid, uid: u.uid, criadoEm: Date.now(), validade: 7 * 864e5 });
          return res.json({ link: `${BASE()}/mpLigar?s=${estado}` });
        }
        return res.status(400).json({ erro: 'Pedido inválido.' });
      }
      if (acao === 'info') {
        const c = await contaMP(eid); if (!c || !c.token) return res.status(404).json({ erro: 'Nenhuma conta conectada.' });
        const conta = await dadosConta(c.token); if (conta) await db.doc(`escolas/${eid}/config/mp`).set({ conta }, { merge: true });
        return res.json({ conta });
      }
      if (acao === 'desconectar') {
        await segredoDe(eid, 'escola').delete();
        await db.doc(`escolas/${eid}/config/geral`).set({ mpConectadoEm: null }, { merge: true });
        await db.doc(`escolas/${eid}/config/mp`).set({ conta: null, confirmada: false }, { merge: true });
        return res.json({ ok: true });
      }
      const P = await plataforma();
      if (!P.id || !P.segredo) return res.status(503).json({ erro: 'O Pix automático ainda está sendo preparado. Tente mais tarde.' });
      if (!voltaOk(volta, P.dominios)) return res.status(400).json({ erro: 'Endereço do app não reconhecido.' });
      const estado = require('crypto').randomBytes(18).toString('hex');
      await db.doc(`servidor/mp/estados/${estado}`).set({ eid, uid: u.uid, volta, criadoEm: Date.now() });
      const q = new URLSearchParams({ client_id: P.id, response_type: 'code', platform_id: 'mp', state: estado, redirect_uri: BASE() + '/mpRetorno' });
      res.json({ url: 'https://auth.mercadopago.com.br/authorization?' + q });
    } catch (e) { logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.' }); }
  });

  // o Mercado Pago volta para cá depois que a administração autoriza
  const mpRetorno = onRequest({ maxInstances: 5 }, async (req, res) => {
    let destino = null;
    const volta = r => destino ? res.redirect(302, destino + (destino.includes('?') ? '&' : '?') + 'mp=' + r) : res.status(200).send(r === 'ok' ? 'Conta conectada. Volte para o app.' : 'Não deu para conectar. Volte para o app e tente de novo.');
    try {
      const code = String(req.query.code || ''), estado = String(req.query.state || '');
      if (!code || !/^[a-f0-9]{36}$/.test(estado)) return volta('erro');
      const eRef = db.doc(`servidor/mp/estados/${estado}`), e = (await eRef.get()).data();
      await eRef.delete().catch(() => { });
      if (!e || Date.now() - e.criadoEm > (e.validade || 30 * 60e3)) return volta('erro');
      destino = e.volta || null;
      const P = await plataforma();
      const n = await trocaOAuth({ client_id: P.id, client_secret: P.segredo, grant_type: 'authorization_code', code, redirect_uri: BASE() + '/mpRetorno' });
      if (e.pid) {
        // professor(a) ligou a própria conta pelo link que a escola mandou
        await segredoDe(e.eid, e.pid).set({ ...n, via: 'oauth', em: Date.now(), por: 'link' });
        const conta = await dadosConta(n.token), esc_ = (await ler(`escolas/${e.eid}`)) || {};
        await db.doc(`escolas/${e.eid}/professoras/${e.pid}`).set({ mpConectadoEm: Date.now(), mpConta: (conta && conta.nome) || null, mpDoc: (conta && conta.doc) || null }, { merge: true });
        logger.info('mp professor conectado', e.eid, e.pid, n.mpUser);
        return res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(paginaSimples('Conta ligada!', `A sua conta do Mercado Pago${conta && conta.nome ? ` (${esc(conta.nome)})` : ''} vai receber os pagamentos das suas turmas na ${esc(esc_.nome || 'escola')}. Pode fechar esta página.`));
      }
      await db.doc(`escolas/${e.eid}/segredos/mp`).set({ ...n, via: 'oauth', em: Date.now(), por: e.uid });
      const conta = await dadosConta(n.token);
      await db.doc(`escolas/${e.eid}/config/geral`).set({ mpConectadoEm: Date.now(), mpTaxaApp: P.comissao }, { merge: true });
      await db.doc(`escolas/${e.eid}/config/mp`).set({ conta: conta || null, confirmada: false }, { merge: true });
      logger.info('mp conectado', e.eid, n.mpUser);
      volta('ok');
    } catch (err) { logger.error(err); volta('erro'); }
  });

  // link que a escola manda para o(a) professor(a): leva direto para a autorização do Mercado Pago
  const mpLigar = onRequest({ maxInstances: 5 }, async (req, res) => {
    try {
      const estado = String(req.query.s || '');
      const e = /^[a-f0-9]{36}$/.test(estado) ? (await db.doc(`servidor/mp/estados/${estado}`).get()).data() : null;
      if (!e || !e.pid || Date.now() - e.criadoEm > (e.validade || 0)) return res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(paginaSimples('Link vencido', 'Peça um link novo para a escola.'));
      const P = await plataforma();
      const q = new URLSearchParams({ client_id: P.id, response_type: 'code', platform_id: 'mp', state: estado, redirect_uri: BASE() + '/mpRetorno' });
      res.redirect(302, 'https://auth.mercadopago.com.br/authorization?' + q);
    } catch (err) { logger.error(err); res.status(500).send('Tente de novo.'); }
  });

  return { criarPix, mpWebhook, mpConectar, mpRetorno, mpLigar, vinculos };
};

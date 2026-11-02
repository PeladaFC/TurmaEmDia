// Testes do cálculo e do fluxo do Pix (sem internet e sem Firebase): node teste.js
'use strict';
const assert = require('assert');
const Module = require('module');
const C = require('./calculo');

let n = 0; const t = async (nome, fn) => { await fn(); n++; console.log('✓', nome); };

/* ---------- banco de mentira (só o que o servidor usa) ---------- */
function bancoFalso() {
  const store = new Map();
  const merge = (a, b) => { const o = { ...(a || {}) }; for (const k in b) { const v = b[k]; o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' ? merge(o[k], v) : v; } return o; };
  // sentinelas do FieldValue (arrayUnion, arrayRemove, delete)
  const aplica = (alvo, d) => { for (const [k, v] of Object.entries(d)) { const ps = k.split('.'); let o = alvo; for (const x of ps.slice(0, -1)) o = o[x] = o[x] && typeof o[x] === 'object' ? o[x] : {}; const u = ps.at(-1);
    if (v && v.__fv === 'del') delete o[u]; else if (v && v.__fv === 'union') o[u] = [...new Set([...(o[u] || []), ...v.x])]; else if (v && v.__fv === 'remove') o[u] = (o[u] || []).filter(y => !v.x.includes(y));
    else if (v && typeof v === 'object' && !Array.isArray(v) && !v.__fv) { o[u] = o[u] && typeof o[u] === 'object' ? o[u] : {}; aplica(o[u], v); } else o[u] = v; } };
  const doc = p => ({ path: p, id: p.split('/').pop(),
    get: async () => ({ exists: store.has(p), data: () => store.get(p), id: p.split('/').pop(), ref: doc(p) }),
    set: async (d, o) => { if (o && o.merge) { const a = JSON.parse(JSON.stringify(store.get(p) || {})); aplica(a, d); store.set(p, a); } else store.set(p, JSON.parse(JSON.stringify(d))); },
    update: async d => { if (!store.has(p)) throw new Error('não existe ' + p); const a = JSON.parse(JSON.stringify(store.get(p))); aplica(a, d); store.set(p, a); },
    delete: async () => { store.delete(p); } });
  const col = (c, filtros = []) => ({
    where: (f, op, v) => col(c, [...filtros, [f, v, op]]),
    doc: id => doc(c + '/' + id),
    add: async d => { const id = 'n' + Math.random().toString(36).slice(2, 10); store.set(c + '/' + id, JSON.parse(JSON.stringify(d))); return { id }; },
    get: async () => { const docs = [...store.keys()].filter(k => k.split('/').slice(0, -1).join('/') === c && filtros.every(([f, v, op]) => op === 'array-contains-any' ? ((store.get(k) || {})[f] || []).some(x => v.includes(x)) : op === 'array-contains' ? ((store.get(k) || {})[f] || []).includes(v) : op === '>=' ? (store.get(k) || {})[f] >= v : (store.get(k) || {})[f] === v)).map(k => ({ id: k.split('/').pop(), data: () => store.get(k), ref: doc(k) })); return { docs, forEach: f => docs.forEach(f) }; } });
  const runTransaction = async fn => fn({ get: r => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d) });
  return { store, doc, collection: col, runTransaction, getAll: async (...refs) => Promise.all(refs.map(r => r.get())) };
}
/* ---------- firebase-functions e firebase-admin de mentira ---------- */
const original = Module._load;
Module._load = function (req, ...r) {
  if (req === 'firebase-functions/v2/https') return { onRequest: (o, h) => typeof o === 'function' ? o : h };
  if (req === 'firebase-functions/logger') return { info() { }, warn() { }, error() { } };
  if (req === 'firebase-functions/v2/firestore') return { onDocumentWritten: (p, h) => h };
  if (req === 'firebase-admin/firestore') return { FieldValue: { delete: () => ({ __fv: 'del' }), arrayUnion: (...x) => ({ __fv: 'union', x }), arrayRemove: (...x) => ({ __fv: 'remove', x }) } };
  // token "ok:uid" ou "ok:uid:v" (e-mail confirmado)
  if (req === 'firebase-admin') return { auth: () => ({ listUsers: async () => ({ users: [{ metadata: { creationTime: new Date(Date.now() - 5 * 864e5).toUTCString(), lastSignInTime: new Date(Date.now() - 864e5).toUTCString() } }, { metadata: { creationTime: new Date(Date.now() - 90 * 864e5).toUTCString() } }] }), verifyIdToken: async t => { if (!t.startsWith('ok:')) throw new Error('x'); const [, uid, v] = t.split(':'); return { uid, email: uid + '@x.com', email_verified: v === 'v', name: uid }; } }) };
  return original.call(this, req, ...r);
};
process.env.GCLOUD_PROJECT = 'escola-teste';
const resp = () => { const r = { code: 200, body: null, redirect: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.send = b => { r.body = b; return r; }; r.redirect = (c, u) => { r.code = c; r.redirect = u; return r; }; return r; };
const req = (body, token, query) => ({ method: 'POST', body, query: query || {}, get: h => h === 'Authorization' && token ? 'Bearer ' + token : '' });

(async () => {
  await t('o servidor usa exatamente o mesmo cálculo do app (calculo.js = regras.js)', () => {
    const fs = require('fs'), path = require('path');
    assert.strictEqual(fs.readFileSync(path.join(__dirname, 'calculo.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'regras.js'), 'utf8'), 'copie regras.js para functions/calculo.js');
  });
  /* ---------- cálculo ---------- */
  const H = '2026-10-15';
  const turmas = { t1: { nome: 'GR', preco: 200 }, t2: { nome: 'Artística', preco: 100 }, t3: { nome: 'Baby', preco: 120 } };
  const cfg = { descIrmas: 0.1, descMulti: 0.2, vencDia: 10 };
  const alunas = {
    a1: { nome: 'Sofia', responsavelId: 'r1', turmas: ['t1', 't2'], inicio: '2026-09', descMultiOk: true },   // 300 - 20% = 240 (desconto escolhido pela escola)
    a2: { nome: 'Helena', responsavelId: 'r1', turmas: ['t3'], inicio: '2026-09', descIrmaOk: true },        // 120 - 10% (irmã) = 108
    a3: { nome: 'Luíza', responsavelId: 'r2', turmas: ['t1'], inicio: '2026-11' },         // começa em novembro
    a4: { nome: 'Ana', responsavelId: 'r2', turmas: ['t1'], inicio: '2026-01', desc: { pct: 0.5 }, descIrmaOk: true },
    a5: { nome: 'Bia', responsavelId: 'r3', turmas: ['t1'], inicio: '2026-01', fim: '2026-09', ativa: false },
    a6: { nome: 'Duda', responsavelId: 'r3', turmas: ['t2'], inicio: '2026-01', desc: { isenta: true } },
    a7: { nome: 'Cora', responsavelId: 'r4', turmas: ['t1'], inicio: '2026-10', desc: { v: 150 } }
  };
  const grupos = { g1: { nome: 'Equipe', alunas: ['a1', 'a4'] } };
  const extras = {
    x1: { tipo: 'competicao', nome: 'Torneio', v: 85, venc: '2026-10-25', grupos: ['g1'] },
    x2: { tipo: 'taxa', nome: 'Federação', v: 40, venc: '2026-11-05', alunas: ['a2'] },
    x3: { tipo: 'evento', nome: 'Festival', v: 60, venc: '2026-12-01', turmas: ['t3'] }
  };
  const d = (pag) => ({ alunas, turmas, extras, grupos, pag: pag || {}, cfg });
  await t('mensalidade: soma turmas, desconto por mais de uma atividade e de irmã', () => {
    assert.strictEqual(C.mensalidade(alunas, 'a1', '2026-10', turmas, cfg).v, 240);
    const h = C.mensalidade(alunas, 'a2', '2026-10', turmas, cfg); assert.strictEqual(h.v, 108); assert.ok(h.irma);
  });
  await t('primeiro mês com desconto (matrícula depois do dia 15): só no mês de início', () => {
    const al = { ...alunas, a7: { ...alunas.a7, primeiroMes: { mes: '2026-10', tipo: 'metade', fator: 0.5 } } };
    assert.strictEqual(C.mensalidade(al, 'a7', '2026-10', turmas, cfg).v, 75); assert.strictEqual(C.mensalidade(al, 'a7', '2026-11', turmas, cfg).v, 150);
    const al2 = { ...alunas, a7: { ...alunas.a7, primeiroMes: { mes: '2026-10', tipo: 'valor', v: 40 } } };
    assert.strictEqual(C.mensalidade(al2, 'a7', '2026-10', turmas, cfg).v, 40);
    // entrou depois do vencimento: a primeira mensalidade vence depois da matrícula (sem multa), as outras no dia de sempre
    const al3 = { ...alunas, a7: { ...alunas.a7, vencPrimeiro: '2026-10-22' } };
    assert.strictEqual(C.itensAluna({ ...d(), alunas: al3 }, 'a7', H).find(i => i.k === 'm:2026-10:a7').venc, '2026-10-22');
    assert.strictEqual(C.vencAluna(al3.a7, '2026-11', cfg), '2026-11-10');
  });
  await t('nenhum desconto entra sozinho: sem a escola escolher, cobra cheio', () => {
    const sem = { ...alunas, a1: { ...alunas.a1, descMultiOk: false }, a2: { ...alunas.a2, descIrmaOk: false } };
    assert.strictEqual(C.mensalidade(sem, 'a1', '2026-10', turmas, cfg).v, 300);
    assert.strictEqual(C.mensalidade(sem, 'a2', '2026-10', turmas, cfg).v, 120);
  });
  await t('multa (até 2%) e juros (até 1% ao mês) só depois do vencimento; "sem multa e juros" vale até a data', () => {
    const c2 = { ...cfg, atraso: { ativo: true, multa: 5, juros: 3 } }; // acima da lei: o cálculo usa o limite
    const i = C.itensComEncargos({ ...d(), cfg: c2 }, 'a1', H).find(x => x.k === 'm:2026-09:a1'); // 35 dias de atraso
    assert.deepStrictEqual([i.enc.multa, i.enc.juros, i.v], [4.8, 2.8, 247.6]);
    assert.strictEqual(C.itensComEncargos({ ...d(), cfg: c2 }, 'a1', H).find(x => x.k === 'x:x1:a1').enc, undefined); // ainda não venceu
    const perd = C.itensComEncargos({ ...d({ semEncargos: { 'm_2026-09_a1': { ate: '2026-10-20' } } }), cfg: c2 }, 'a1', H).find(x => x.k === 'm:2026-09:a1');
    assert.strictEqual(perd.v, 240); assert.ok(perd.perdao);
    const venceu = C.itensComEncargos({ ...d({ semEncargos: { 'm_2026-09_a1': { ate: '2026-10-01' } } }), cfg: c2 }, 'a1', H).find(x => x.k === 'm:2026-09:a1');
    assert.strictEqual(venceu.v, 247.6);
  });
  await t('ativa só entre início e fim; ajuste individual (%, isenta, valor combinado)', () => {
    assert.strictEqual(C.mensalidade(alunas, 'a3', '2026-10', turmas, cfg), null);
    assert.strictEqual(C.mensalidade(alunas, 'a4', '2026-10', turmas, cfg).v, 100);
    assert.strictEqual(C.mensalidade(alunas, 'a4', '2026-11', turmas, cfg).v, 90); // agora é irmã de a3
    assert.strictEqual(C.mensalidade(alunas, 'a5', '2026-10', turmas, cfg), null);
    assert.strictEqual(C.mensalidade(alunas, 'a5', '2026-09', turmas, cfg).v, 200);
    assert.strictEqual(C.mensalidade(alunas, 'a6', '2026-10', turmas, cfg).v, 0);
    assert.strictEqual(C.mensalidade(alunas, 'a7', '2026-10', turmas, cfg).v, 150);
  });
  await t('itens da aluna: mensalidades em aberto desde o início + extras por grupo, turma e avulsa', () => {
    assert.deepStrictEqual(C.itensAluna(d(), 'a1', H).map(i => [i.k, i.v, i.venc]), [['m:2026-09:a1', 240, '2026-09-10'], ['m:2026-10:a1', 240, '2026-10-10'], ['x:x1:a1', 85, '2026-10-25']]);
    assert.deepStrictEqual(C.itensAluna(d(), 'a2', H).map(i => i.k), ['m:2026-09:a2', 'm:2026-10:a2', 'x:x2:a2', 'x:x3:a2']);
    assert.deepStrictEqual(C.itensAluna(d(), 'a6', H).map(i => i.k), []);
    assert.strictEqual(C.alvoExtra(extras.x3, alunas, grupos).size, 1);
    const pago = C.itensAluna(d({ mens: { '2026-09': { s: 'pago', v: 230, via: 'dinheiro' } } }), 'a1', H);
    assert.strictEqual(pago[0].v, 230); assert.ok(pago[0].pago);
    assert.strictEqual(C.status(pago[1], H), 'vencido'); assert.strictEqual(C.status(pago[2], H), 'aberto');
    // saiu do grupo depois de pagar: o pago continua aparecendo
    const g2 = { g1: { alunas: ['a4'] } };
    assert.ok(C.itensAluna({ ...d({ extras: { x1: { s: 'pago', v: 85 } } }), grupos: g2 }, 'a1', H).some(i => i.k === 'x:x1:a1' && i.pago));
    assert.deepStrictEqual(C.lerChave('m:2026-10:a1'), { tipo: 'm', mes: '2026-10', alid: 'a1' });
    assert.strictEqual(C.lerChave('m:2026-13:a1'), null); assert.strictEqual(C.lerChave('x:a/b:a1'), null);
    assert.deepStrictEqual(C.lerChave('a:ac1.2:a1'), { tipo: 'a', aid: 'ac1', n: 2, alid: 'a1' });
    // valor por atleta numa taxa
    assert.strictEqual(C.valorExtra({ v: 40, valores: { a2: 30 } }, 'a2'), 30); assert.strictEqual(C.valorExtra({ v: 40, valores: { a2: 30 } }, 'a1'), 40);
    assert.strictEqual(C.telNorm('+55 (81) 99999-0000'), C.telNorm('81999990000'));
  });
  await t('valor do Pix: com repasse a escola recebe cheio; sem repasse, valor da dívida', () => {
    const a = C.valorPix(433, { pixRepassa: true }, 0.0099, 0.01); assert.strictEqual(a.valor, 441.8); assert.strictEqual(a.fee, 4.42);
    const b = C.valorPix(80, { pixRepassa: false }, 0.0099, 0.01); assert.strictEqual(b.valor, 80); assert.strictEqual(b.fee, 0.8);
    assert.strictEqual(C.valorPix(80, { pixRepassa: true }, 0.0099, 0.01).valor, 81.63);
    assert.strictEqual(C.valorPix(80, {}, 0.0099, 0.01).valor, 80); // padrão: desligado
    // evento com a própria escolha: mensalidade 100 (escola não repassa) + inscrição 50 (evento repassa)
    const ex = { ev: { tipo: 'evento', pixRepassa: true }, tx: { tipo: 'taxa', evento: 'ev' }, av: { tipo: 'taxa' } };
    const its = [{ tipo: 'm', v: 100 }, { tipo: 'x', xid: 'ev', v: 50 }, { tipo: 'x', xid: 'tx', v: 20 }, { tipo: 'x', xid: 'av', v: 10 }];
    assert.strictEqual(C.baseRepasse(its, {}, ex), 70);
    assert.strictEqual(C.valorPix(180, {}, 0.0099, 0.01, 70).valor, C.r2(110 + Math.ceil(70 / (1 - 0.0199) * 100 - 1e-6) / 100));
    assert.strictEqual(C.baseRepasse(its, { pixRepassa: true }, { ev: { tipo: 'evento' }, tx: { tipo: 'taxa', evento: 'ev' }, av: { tipo: 'taxa' } }), 110);
    assert.strictEqual(C.chaveItens(['b', 'a']), C.chaveItens(['a', 'b']));
  });

  /* ---------- servidor ---------- */
  const db = bancoFalso(), S = db.store;
  const P = require('./pagamentos')(db);
  const realNow = Date.now; Date.now = () => Date.parse(H + 'T15:00:00Z'); // hoje no servidor = 15/10/2026
  S.set('servidor/mp', { clientId: '123', clientSecret: 's', comissao: 0.01 });
  S.set('escolas/e1', { nome: 'Escola Teste', admins: ['adm'] });
  S.set('escolas/e1/config/geral', cfg);
  S.set('escolas/e1/segredos/mp', { token: 'TOKEN-ESCOLA', via: 'oauth' });
  S.set('escolas/e1/responsaveis/r1', { nome: 'Patrícia', telefone: '(81) 99999-0001', cpf: '111.222.333-44' });
  S.set('escolas/e1/responsaveis/r1b', { nome: 'Patrícia Lins', telefone: '+55 81 999990001' });
  S.set('escolas/e1/responsaveis/r2', { nome: 'Roberto', telefone: '(81) 98888-0002' });
  S.set('escolas/e1/membros/mae', {}); S.set('escolas/e1/membros/mae/vinculos/r1', {});
  S.set('escolas/e1/membros/outro', {}); S.set('escolas/e1/membros/outro/vinculos/r2', {});
  for (const [k, v] of Object.entries(turmas)) S.set('escolas/e1/turmas/' + k, v);
  for (const [k, v] of Object.entries(alunas)) S.set('escolas/e1/alunas/' + k, v);
  for (const [k, v] of Object.entries(grupos)) S.set('escolas/e1/grupos/' + k, v);
  for (const [k, v] of Object.entries(extras)) S.set('escolas/e1/extras/' + k, v);
  S.set('escolas/e1/alunas/a8', { nome: 'Clara Lins', responsavelId: 'r1b', turmas: ['t2'], inicio: '2026-10' });
  const chamadas = []; let proximoId = 9001; const statusMP = {};
  global.fetch = async (url, o = {}) => {
    chamadas.push({ url, o });
    const ok = b => ({ ok: true, status: 200, json: async () => b });
    if (url.endsWith('/v1/payments') && o.method === 'POST') { const b = JSON.parse(o.body), id = proximoId++; statusMP[id] = { ...b, id, status: 'pending' }; return ok({ id, status: 'pending', point_of_interaction: { transaction_data: { qr_code: 'PIX-' + id, qr_code_base64: 'QR64', ticket_url: 'https://mp/' + id } } }); }
    const m = url.match(/\/v1\/payments\/(\d+)$/);
    if (m && o.method === 'PUT') { statusMP[m[1]].status = 'cancelled'; return ok(statusMP[m[1]]); }
    if (m) { assert.ok(/^Bearer TOKEN-/.test(o.headers.Authorization)); return statusMP[m[1]] ? ok(statusMP[m[1]]) : { ok: false, status: 404, json: async () => ({}) }; }
    throw new Error('url inesperada ' + url);
  };
  const tudoSofiaHelena = ['m:2026-09:a1', 'm:2026-10:a1', 'x:x1:a1', 'm:2026-09:a2', 'm:2026-10:a2'];

  await t('criarPix: só o responsável da aluna (ou a administração) pode pagar', async () => {
    let r = resp(); await P.criarPix(req({ eid: 'e1', itens: tudoSofiaHelena }), r); assert.strictEqual(r.code, 401);
    r = resp(); await P.criarPix(req({ eid: 'e1', itens: tudoSofiaHelena }, 'ok:outro'), r); assert.strictEqual(r.code, 403);
    r = resp(); await P.criarPix(req({ eid: 'e1', itens: ['m:2026-13:a1'] }, 'ok:mae'), r); assert.strictEqual(r.code, 400);
    r = resp(); await P.criarPix(req({ eid: 'e1/x', itens: tudoSofiaHelena }, 'ok:mae'), r); assert.strictEqual(r.code, 400);
    r = resp(); await P.criarPix(req({ eid: 'e1', itens: ['m:2026-10:a8'] }, 'ok:mae'), r); assert.strictEqual(r.code, 403); // ainda não juntou o outro cadastro
  });
  let cob1;
  await t('criarPix: um Pix com o que o responsável marcou, das duas filhas, valor calculado no servidor', async () => {
    const r = resp(); await P.criarPix(req({ eid: 'e1', itens: [...tudoSofiaHelena, 'x:x2:a2'], valor: 1 }, 'ok:mae'), r);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.lotes.length, 1); cob1 = r.body.lotes[0];
    assert.strictEqual(cob1.base, 240 + 240 + 85 + 108 + 108 + 40);
    const corpo = JSON.parse(chamadas.at(-1).o.body);
    assert.strictEqual(corpo.transaction_amount, cob1.valor); assert.strictEqual(corpo.application_fee, cob1.fee);
    assert.match(corpo.external_reference, /^e1\|mae_escola_[a-z0-9]+$/);
    assert.strictEqual(corpo.notification_url, 'https://southamerica-east1-escola-teste.cloudfunctions.net/mpWebhook?e=e1&r=escola');
    assert.match(corpo.description, /Sofia, Helena/);
  });
  await t('criarPix: pedir de novo devolve o mesmo QR; itens que se cruzam cancelam o Pix anterior', async () => {
    let antes = chamadas.length, r = resp(); await P.criarPix(req({ eid: 'e1', itens: [...tudoSofiaHelena, 'x:x2:a2'] }, 'ok:mae'), r);
    assert.strictEqual(r.body.lotes[0].mpId, cob1.mpId); assert.strictEqual(chamadas.length, antes);
    r = resp(); await P.criarPix(req({ eid: 'e1', itens: ['m:2026-09:a1', 'm:2026-10:a1', 'x:x1:a1'] }, 'ok:mae'), r); // só a Sofia
    assert.strictEqual(r.body.lotes[0].base, 565); assert.strictEqual(statusMP[cob1.mpId].status, 'cancelled');
    cob1 = r.body.lotes[0];
  });
  await t('webhook: aviso falso ou de outra escola não dá baixa', async () => {
    let r = resp(); await P.mpWebhook({ query: { e: 'e1', 'data.id': '123456' }, body: {} }, r); assert.strictEqual(r.code, 500);
    const ref = statusMP[cob1.mpId].external_reference;
    statusMP[cob1.mpId].status = 'approved'; statusMP[cob1.mpId].external_reference = 'outra|' + ref.split('|')[1];
    r = resp(); await P.mpWebhook({ query: { e: 'e1', 'data.id': cob1.mpId }, body: {} }, r); assert.strictEqual(r.code, 200);
    assert.ok(!S.has('escolas/e1/pagamentos/a1'));
    statusMP[cob1.mpId].external_reference = ref;
  });
  await t('webhook: Pix aprovado dá baixa em cada item na ficha da aluna, pelo valor da dívida', async () => {
    const r = resp(); await P.mpWebhook({ query: { e: 'e1', topic: 'payment', id: cob1.mpId }, body: {} }, r); assert.strictEqual(r.code, 200);
    const pg = S.get('escolas/e1/pagamentos/a1');
    assert.deepStrictEqual([pg.mens['2026-09'].v, pg.mens['2026-10'].via, pg.extras.x1.v], [240, 'pix', 85]);
    assert.ok(!S.has('escolas/e1/pagamentos/a2'));
    const it = C.itensAluna({ ...d(pg), alunas }, 'a1', H); assert.ok(it.every(i => i.pago));
  });
  await t('criarPix: o que já foi pago não entra de novo; nada em aberto → 409', async () => {
    let r = resp(); await P.criarPix(req({ eid: 'e1', itens: tudoSofiaHelena }, 'ok:mae'), r); assert.strictEqual(r.body.lotes[0].base, 216);
    r = resp(); await P.criarPix(req({ eid: 'e1', itens: ['m:2026-10:a1'] }, 'ok:mae'), r); assert.strictEqual(r.code, 409);
  });
  await t('vínculos: sugere o cadastro com o mesmo telefone; o responsável decide juntar', async () => {
    let r = resp(); await P.vinculos(req({ eid: 'e1', acao: 'sugestoes' }, 'ok:mae'), r);
    assert.deepStrictEqual(r.body.sugestoes, [{ rid: 'r1b', responsavel: 'Patrícia Lins', alunas: ['Clara'], por: 'telefone' }]);
    r = resp(); await P.vinculos(req({ eid: 'e1', acao: 'vincular', rid: 'r2' }, 'ok:mae'), r); assert.strictEqual(r.code, 403);
    r = resp(); await P.vinculos(req({ eid: 'e1', acao: 'vincular', rid: 'r1b' }, 'ok:mae'), r); assert.strictEqual(r.code, 200);
    r = resp(); await P.criarPix(req({ eid: 'e1', itens: ['m:2026-10:a8'] }, 'ok:mae'), r); assert.strictEqual(r.code, 200); assert.strictEqual(r.body.lotes[0].base, 100);
    r = resp(); await P.vinculos(req({ eid: 'e1', acao: 'sugestoes' }, 'ok:mae'), r); assert.deepStrictEqual(r.body.sugestoes, []);
  });
  await t('turma de professor(a): um Pix para cada recebedor; mensalidade dividida só fica paga quando os dois recebem', async () => {
    S.set('escolas/e1/turmas/t2', { ...turmas.t2, recebedor: 'p1' }); S.set('escolas/e1/professoras/p1', { nome: 'Juliana' });
    S.set('escolas/e1/alunas/a9', { nome: 'Lia', responsavelId: 'r1', turmas: ['t1', 't2'], inicio: '2026-10' }); // 200 escola + 100 Juliana
    let r = resp(); await P.criarPix(req({ eid: 'e1', itens: ['m:2026-10:a9'] }, 'ok:mae'), r);
    assert.strictEqual(r.code, 412); assert.match(r.body.erro, /Juliana/);
    S.set('escolas/e1/segredos/mp_p1', { token: 'TOKEN-JULIANA', via: 'oauth' });
    r = resp(); await P.criarPix(req({ eid: 'e1', itens: ['m:2026-10:a9'] }, 'ok:mae'), r);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body)); const [le, lj] = r.body.lotes;
    assert.deepStrictEqual([le.rec, le.base, lj.rec, lj.base], ['escola', 200, 'p1', 100]);
    const pj = chamadas.filter(c => c.url.endsWith('/v1/payments') && c.o.method === 'POST').at(-1);
    assert.strictEqual(pj.o.headers.Authorization, 'Bearer TOKEN-JULIANA'); assert.match(JSON.parse(pj.o.body).notification_url, /r=p1$/);
    statusMP[lj.mpId].status = 'approved';
    r = resp(); await P.mpWebhook({ query: { e: 'e1', r: 'p1', 'data.id': lj.mpId }, body: {} }, r);
    let pg = S.get('escolas/e1/pagamentos/a9'); assert.ok(pg.mensPartes['2026-10'].p1); assert.ok(!(pg.mens || {})['2026-10']);
    // aviso do Pix da Juliana chegando como se fosse da escola: ignorado
    statusMP[le.mpId].status = 'approved';
    r = resp(); await P.mpWebhook({ query: { e: 'e1', r: 'p1', 'data.id': le.mpId }, body: {} }, r); assert.ok(!(S.get('escolas/e1/pagamentos/a9').mens || {})['2026-10']);
    r = resp(); await P.mpWebhook({ query: { e: 'e1', r: 'escola', 'data.id': le.mpId }, body: {} }, r);
    pg = S.get('escolas/e1/pagamentos/a9'); assert.deepStrictEqual([pg.mens['2026-10'].v, pg.mens['2026-10'].rec], [300, 'dividido']);
    S.set('escolas/e1/turmas/t2', turmas.t2);
  });
  await t('professor(a): link para ligar a conta (7 dias) e desligar apaga a chave', async () => {
    let r = resp(); await P.mpConectar(req({ eid: 'e1', acao: 'link', pid: 'p1' }, 'ok:mae'), r); assert.strictEqual(r.code, 403);
    r = resp(); await P.mpConectar(req({ eid: 'e1', acao: 'link', pid: 'p1' }, 'ok:adm'), r); assert.match(r.body.link, /\/mpLigar\?s=[a-f0-9]{36}$/);
    const s = r.body.link.split('s=')[1]; r = resp(); await P.mpLigar({ query: { s } }, r); assert.match(r.redirect, /auth\.mercadopago\.com\.br\/authorization\?client_id=123/);
    r = resp(); await P.mpConectar(req({ eid: 'e1', acao: 'desconectar', pid: 'p1' }, 'ok:adm'), r); assert.strictEqual(r.code, 200);
    assert.ok(!S.has('escolas/e1/segredos/mp_p1')); assert.strictEqual(S.get('escolas/e1/professoras/p1').mpConectadoEm, null);
  });
  await t('evento pelo caixa da escola: só quem diz que vai é cobrado; a família não se inscreve sozinha', async () => {
    S.set('escolas/e1/extras/ev1', { tipo: 'evento', cobranca: 'app', nome: 'Copa', data: '2026-11-10', v: 70, venc: '2026-11-01', convidados: ['a1', 'a4'], alunas: [], part: {} });
    const A = require('./acoes')(db);
    let r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev1', alid: 'a4', st: 'interesse' }, 'ok:mae'), r); assert.strictEqual(r.code, 403); // filho de outra família
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev1', alid: 'a1', st: 'inscrito' }, 'ok:mae'), r); assert.strictEqual(r.code, 400);
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev1', alid: 'a1', st: 'interesse' }, 'ok:mae'), r); assert.strictEqual(r.code, 200);
    assert.deepStrictEqual(S.get('escolas/e1/extras/ev1').alunas, ['a1']); assert.ok(C.itensAluna({ ...d(), extras: { ev1: S.get('escolas/e1/extras/ev1') } }, 'a1', H).some(i => i.k === 'x:ev1:a1' && i.v === 70));
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev1', alid: 'a1', st: 'nao' }, 'ok:mae'), r); assert.deepStrictEqual(S.get('escolas/e1/extras/ev1').alunas, []);
  });
  await t('taxa dividida: ninguém é cobrado com as respostas abertas; fechou, cada participante paga o total dividido, igual para todos', async () => {
    const futuro = Date.now() + 864e5;
    S.set('escolas/e1/extras/rt1', { tipo: 'taxa', nome: 'Ônibus', v: 0, venc: '2026-11-15', convidados: ['a1', 'a2', 'a3'], alunas: [], grupos: [], turmas: [], part: {}, rateio: { total: 1000, prazoEm: futuro } });
    const A = require('./acoes')(db), it = id => C.itensAluna({ ...d(), extras: { rt1: S.get('escolas/e1/extras/rt1') } }, id, H).find(i => i.xid === 'rt1');
    let r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'rt1', alid: 'a1', st: 'interesse' }, 'ok:mae'), r); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'rt1', alid: 'a1', st: 'inscrito' }, 'ok:mae'), r); assert.strictEqual(r.code, 400);
    S.set('escolas/e1/extras/rt1', { ...S.get('escolas/e1/extras/rt1'), part: { a1: { st: 'interesse' }, a2: { st: 'interesse' }, a3: { st: 'interesse' } } });
    assert.strictEqual(it('a1'), undefined); // aberto: ninguém é cobrado
    S.set('escolas/e1/extras/rt1', { ...S.get('escolas/e1/extras/rt1'), rateio: { total: 1000, prazoEm: Date.now() - 1000 } });
    assert.deepStrictEqual([it('a1').v, it('a2').v], [333.34, 333.34]); // arredonda para cima: sobram 2 centavos no caixa
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'rt1', alid: 'a1', st: 'nao' }, 'ok:mae'), r); assert.strictEqual(r.code, 409); // fechou pelo horário
    assert.strictEqual(C.rateioCada(1000, 20), 50); assert.strictEqual(C.rateioCada(100, 0), 0);
    S.set('escolas/e1/extras/rt1', { ...S.get('escolas/e1/extras/rt1'), v: 500, alunas: ['a1', 'a2'], rateio: { total: 1000, prazoEm: futuro, fechadoEm: Date.now() } });
    assert.deepStrictEqual([it('a1').v, it('a3')], [500, undefined]); // a escola fechou: vale o que ficou gravado
    S.delete('escolas/e1/extras/rt1');
  });
  await t('evento em que a família se inscreve: ela confirma "Já fiz a inscrição" e pode desfazer só o que ela confirmou', async () => {
    S.set('escolas/e1/extras/ev2', { tipo: 'evento', cobranca: 'familia', semCobranca: true, nome: 'Festival', data: '2026-11-20', convidados: ['a1'], alunas: [], part: {} });
    const A = require('./acoes')(db);
    let r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev1', alid: 'a1', st: 'inscrito' }, 'ok:mae'), r); assert.strictEqual(r.code, 400); // no caixa da escola, não
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev2', alid: 'a1', st: 'inscrito' }, 'ok:mae'), r); assert.strictEqual(r.code, 200);
    assert.strictEqual(S.get('escolas/e1/extras/ev2').part.a1.st, 'inscrito');
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev2', alid: 'a1', st: 'interesse' }, 'ok:mae'), r); assert.strictEqual(r.code, 200);
    S.set('escolas/e1/extras/ev2', { ...S.get('escolas/e1/extras/ev2'), part: { a1: { st: 'inscrito', quem: 'escola' } } });
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev2', alid: 'a1', st: 'nao' }, 'ok:mae'), r); assert.strictEqual(r.code, 409); // a escola confirmou: só a escola muda
    // evento encerrado ou prazo passado: a família não responde mais
    S.set('escolas/e1/extras/ev3', { tipo: 'evento', cobranca: 'familia', semCobranca: true, nome: 'Copa velha', data: '2026-10-01', convidados: ['a1'], alunas: [], part: {} });
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev3', alid: 'a1', st: 'interesse' }, 'ok:mae'), r); assert.strictEqual(r.code, 409);
    S.set('escolas/e1/extras/ev4', { tipo: 'evento', cobranca: 'familia', semCobranca: true, nome: 'Copa nova', data: '2026-11-30', prazo: '2026-10-10', convidados: ['a1'], alunas: [], part: {} });
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev4', alid: 'a1', st: 'inscrito' }, 'ok:mae'), r); assert.strictEqual(r.code, 409);
  });
  await t('convite para a administração: só o dono convida; só o e-mail convidado, confirmado, aceita', async () => {
    S.set('escolas/e1', { ...S.get('escolas/e1'), dono: 'adm', admins: ['adm', 'adm2'], adminsInfo: {} });
    const A = require('./acoes')(db);
    let r = resp(); await A.adminConvite(req({ acao: 'criar', eid: 'e1', nome: 'Ana', email: 'nova@x.com' }, 'ok:adm2'), r); assert.strictEqual(r.code, 403); // não é o dono
    r = resp(); await A.adminConvite(req({ acao: 'criar', eid: 'e1', nome: 'Ana', email: 'nova@x.com' }, 'ok:adm'), r); assert.strictEqual(r.code, 200);
    r = resp(); await A.adminConvite(req({ acao: 'listar' }, 'ok:outra'), r); assert.deepStrictEqual(r.body.convites, []);
    r = resp(); await A.adminConvite(req({ acao: 'aceitar', eid: 'e1' }, 'ok:outra:v'), r); assert.strictEqual(r.code, 404);
    r = resp(); await A.adminConvite(req({ acao: 'aceitar', eid: 'e1' }, 'ok:nova'), r); assert.strictEqual(r.code, 403); assert.strictEqual(r.body.codigo, 'confirmar-email');
    r = resp(); await A.adminConvite(req({ acao: 'aceitar', eid: 'e1' }, 'ok:nova:v'), r); assert.strictEqual(r.code, 200);
    const e = S.get('escolas/e1'); assert.ok(e.admins.includes('nova')); assert.ok(!e.convitesAdm.nova_at_x_com); assert.strictEqual(S.get('users/nova').escolas.e1.papel, 'admin');
    r = resp(); await A.adminConvite(req({ acao: 'aceitar', eid: 'e1' }, 'ok:nova:v'), r); assert.strictEqual(r.code, 404); // convite já usado
  });
  await t('sem conta do Mercado Pago conectada → 412', async () => {
    S.delete('escolas/e1/segredos/mp'); const r = resp(); await P.criarPix(req({ eid: 'e1', itens: ['m:2026-10:a2'] }, 'ok:mae'), r); assert.strictEqual(r.code, 412);
  });
  await t('conectar: só a administração; volta só para o próprio app', async () => {
    let r = resp(); await P.mpConectar(req({ eid: 'e1', volta: 'https://x.github.io/escolinha/' }, 'ok:mae'), r); assert.strictEqual(r.code, 403);
    r = resp(); await P.mpConectar(req({ eid: 'e1', volta: 'https://golpe.com/' }, 'ok:adm'), r); assert.strictEqual(r.code, 400);
    r = resp(); await P.mpConectar(req({ eid: 'e1', volta: 'https://x.github.io/escolinha/' }, 'ok:adm'), r); assert.strictEqual(r.code, 200);
    assert.match(r.body.url, /^https:\/\/auth\.mercadopago\.com\.br\/authorization\?client_id=123&.*redirect_uri=https%3A%2F%2Fsouthamerica-east1-escola-teste\.cloudfunctions\.net%2FmpRetorno/);
  });
  /* ---------- notas fiscais da comissão ---------- */
  const N = require('./nfse')(db, P.interno, { lib: async () => ({ parsePfx: (b, senha) => { if (senha !== 'certa') throw new Error('x'); return { subject: 'EMPRESA DO DONO LTDA:11222333000181', expiresOn: new Date(Date.parse('2027-12-01')) }; } }) });
  const set9 = (k, v) => S.set('escolas/e9/' + k, v);
  S.set('escolas/e9', { nome: 'Ballet Arte', admins: ['adm9'] });
  set9('professoras/p1', { nome: 'Juliana Costa' });
  set9('segredos/nota_escola', { nome: 'Ballet Arte Ltda', doc: '11444777000161', tipoDoc: 'CNPJ', email: 'ballet@x.com' });
  set9('cobrancas/c1', { status: 'approved', rec: 'escola', fee: 1.5, pagoEm: Date.parse('2026-09-10T15:00:00Z') });
  set9('cobrancas/c2', { status: 'approved', rec: 'escola', fee: 2.25, pagoEm: Date.parse('2026-09-30T23:30:00Z') }); // 20h30 no Recife: ainda é setembro
  set9('cobrancas/c3', { status: 'approved', rec: 'p1', fee: 0.8, pagoEm: Date.parse('2026-09-12T15:00:00Z') });
  set9('cobrancas/c4', { status: 'pending', rec: 'escola', fee: 9, criadoEm: Date.parse('2026-09-12T15:00:00Z') });
  set9('cobrancas/c5', { status: 'approved', rec: 'escola', fee: 5, pagoEm: Date.parse('2026-10-01T04:00:00Z') }); // 1h de outubro no Recife
  await t('notas: comissão do mês por quem recebe (escola e professor com conta própria), pelo horário do Recife', async () => {
    const r = await P.interno.comissoesDoMes('2026-09'), L = r.linhas.filter(l => l.eid === 'e9');
    assert.deepStrictEqual(L.map(l => [l.gid, l.qtd, l.total, l.doc]), [['e9~escola', 2, 3.75, '11444777000161'], ['e9~p1', 1, 0.8, '']]);
    assert.strictEqual(L[1].grupo, 'Ballet Arte · Juliana Costa');
  });
  S.set('servidor/plataforma', { emails: ['dona@x.com'] });
  await t('nota da comissão: o dono configura pelo app (certificado, dados, ligar); a escola não', async () => {
    const pl = async (b, tok) => { const r = resp(); await N.notasPlataforma(req(b, tok), r); return r; };
    let r = await pl({ acao: 'donoEstado' }, 'ok:adm9:v'); assert.strictEqual(r.code, 403);
    r = await pl({ acao: 'donoCert', pfx: Buffer.alloc(900, 1).toString('base64'), senha: 'errada' }, 'ok:dona:v'); assert.strictEqual(r.code, 400);
    r = await pl({ acao: 'donoCert', pfx: Buffer.alloc(900, 1).toString('base64'), senha: 'certa' }, 'ok:dona:v'); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.cfg.cnpj, '11222333000181'); assert.ok(!JSON.stringify(r.body).includes('certa'));
    r = await pl({ acao: 'donoSalvar', cfg: { cnpj: '11222333000181', regime: 'simples', cTribNac: '', ligado: true } }, 'ok:dona:v'); assert.strictEqual(r.code, 412);
    r = await pl({ acao: 'donoSalvar', cfg: { cnpj: '11222333000181', regime: 'simples', cTribNac: '100501', pTrib: '6', serie: '901', ligado: true } }, 'ok:dona:v'); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.falta, []); const c = S.get('servidor/nfse'); assert.strictEqual(c.opSimpNac, '3'); assert.strictEqual(c.pTotTribSN, 6); assert.strictEqual(c.ligado, true);
    S.delete('servidor/nfse'); S.delete('servidor/nfse_cert'); // os testes seguintes partem sem configuração
  });
  await t('notas: relatório e dados do tomador só para a empresa do app', async () => {
    let r = resp(); await N.notasPlataforma(req({ acao: 'relatorio', mes: '2026-09' }, 'ok:adm9'), r); assert.strictEqual(r.code, 403);
    r = resp(); await N.notasPlataforma(req({ acao: 'relatorio', mes: '2026-09' }, 'ok:dona'), r); assert.strictEqual(r.code, 403); // e-mail ainda não confirmado
    r = resp(); await N.notasPlataforma(req({ acao: 'relatorio', mes: '2026-09' }, 'ok:dona:v'), r); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.ok(r.body.nfse.falta.includes('certificado digital A1')); assert.ok(r.body.linhas.some(l => l.gid === 'e9~p1' && !l.nota));
    r = resp(); await N.notasPlataforma(req({ acao: 'tomador', gid: 'e9~p1', nome: 'Juliana Costa', doc: '529.982.247-25' }, 'ok:dona:v'), r); assert.strictEqual(r.code, 200);
    assert.strictEqual(S.get('escolas/e9/segredos/nota_p1').doc, '52998224725');
    r = resp(); await N.notasPlataforma(req({ acao: 'tomador', gid: 'e9/x~p1', nome: 'X', doc: '52998224725' }, 'ok:dona:v'), r); assert.strictEqual(r.code, 404);
    r = resp(); await N.notasPlataforma(req({ acao: 'emitir', mes: '2026-09' }, 'ok:dona:v'), r); assert.strictEqual(r.code, 412); // sem configuração fiscal
  });
  await t('notas: a administração vê só as notas da própria escola', async () => {
    S.set('servidor/nfse/notas/2026-09_e9~escola', { mes: '2026-09', eid: 'e9', rec: 'escola', status: 'ok', valor: 3.75, chave: 'CH1', ambiente: 'restrita' });
    S.set('servidor/nfse/notas/2026-09_e9~p1', { mes: '2026-09', eid: 'e9', rec: 'p1', status: 'ok', valor: 0.8, chave: 'CH2', ambiente: 'restrita' });
    let r = resp(); await N.notaComissao(req({ eid: 'e9' }, 'ok:mae'), r); assert.strictEqual(r.code, 403);
    r = resp(); await N.notaComissao(req({ eid: 'e9' }, 'ok:adm9'), r); assert.strictEqual(r.code, 200);
    assert.deepStrictEqual(r.body.notas.map(n => [n.mes, n.valor, n.teste]), [['2026-09', 3.75, true]]);
  });
  await t('painel do dono: escolas por região, estado e cidade; contas, alunos e pagantes', async () => {
    assert.deepStrictEqual(N.interno.ondeFica({ cidade: 'Recife', uf: 'pe' }, []), { uf: 'PE', cidade: 'Recife', regiao: 'Nordeste', origem: 'ajustes' });
    assert.strictEqual(N.interno.ondeFica({}, [{ nome: 'Unidade Centro - Natal/RN' }]).cidade, 'Natal');
    assert.strictEqual(N.interno.ondeFica({}, [{ nome: 'Quadra do bairro' }]).regiao, 'Sem cidade informada');
    set9('config/geral', { cidade: 'João Pessoa', uf: 'PB', mpConectadoEm: 1 }); set9('alunas/x1', { nome: 'A' }); set9('alunas/x2', { nome: 'B', ativa: false }); set9('membros/f1', {});
    set9('cobrancas/c6', { status: 'approved', rec: 'escola', fee: 1, valor: 100, criadoEm: Date.now() - 864e5, pagoEm: Date.now() - 864e5 });
    let r = resp(); await N.notasPlataforma(req({ acao: 'painel' }, 'ok:adm9'), r); assert.strictEqual(r.code, 403);
    r = resp(); await N.notasPlataforma(req({ acao: 'painel' }, 'ok:dona:v'), r); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    const pb = r.body.cidades.find(c => c.nome === 'João Pessoa · PB');
    assert.deepStrictEqual([pb.escolas, pb.ativas, pb.alunos, pb.contas, pb.pagantes], [1, 1, 1, 2, 1]);
    assert.strictEqual(r.body.contas.total, 2); assert.ok(r.body.regioes.some(x => x.nome === 'Nordeste'));
  });
  await t('área do professor: só com o e-mail cadastrado e confirmado; vê só os alunos das turmas dele, sem dados da família; notas dele', async () => {
    const PR = require('./professor')(db), E = require('./espelho')(db), mes = H.slice(0, 7), set7 = (k, v) => S.set('escolas/e7/' + k, v);
    S.set('escolas/e7', { nome: 'Escola Sete', dono: 'dono7', admins: ['dono7'] }); set7('config/geral', { vencDia: 10 });
    set7('turmas/t1', { nome: 'Sub-11', professoraId: 'p1', recebedor: 'p1', preco: 200 }); set7('turmas/t2', { nome: 'Ballet', professoraId: 'p2', preco: 100 });
    set7('alunas/a1', { nome: 'Ana', turmas: ['t1'], responsavelId: 'r1', nascimento: '2016-03-01', inicio: '2026-01' });
    set7('alunas/a2', { nome: 'Bia', turmas: ['t2'], responsavelId: 'r2', inicio: '2026-01' });
    set7('alunas/a3', { nome: 'Caio', turmas: ['t1', 't2'], responsavelId: 'r3', inicio: '2026-01' });
    set7('responsaveis/r1', { nome: 'Mãe da Ana', telefone: '81999990001', cpf: '12345678901' });
    set7('pagamentos/a1', { mens: { [mes]: { s: 'pago', v: 200, via: 'pix', d: H } } });
    // a escola coloca o e-mail no cadastro do professor: o servidor guarda o caminho
    const P1 = { nome: 'Camila', emailApp: 'cam@x.com' }; set7('professoras/p1', P1);
    await E.espelharProf({ params: { eid: 'e7', pid: 'p1' }, data: { before: { exists: false }, after: { exists: true, data: () => P1 } } });
    assert.ok(S.get('convitesProf/cam_at_x_com')['e7_p1']);
    let r = resp(); await PR.professor(req({ acao: 'vincular' }, 'ok:cam'), r);
    assert.strictEqual(r.body.confirmar, true); assert.ok(!S.has('escolas/e7/equipe/cam'));
    r = resp(); await PR.professor(req({ acao: 'vincular' }, 'ok:outro:v'), r); assert.deepStrictEqual(r.body.escolas, []);
    r = resp(); await PR.professor(req({ acao: 'vincular' }, 'ok:cam:v'), r);
    assert.deepStrictEqual(r.body.escolas.map(e => e.eid), ['e7']); assert.strictEqual(S.get('escolas/e7/equipe/cam').pid, 'p1'); assert.strictEqual(S.get('users/cam').escolas.e7.papel, 'professora');
    // painel: Ana e Caio (turma dele); Bia não; nada da família
    r = resp(); await PR.professor(req({ acao: 'painel', eid: 'e7', mes }, 'ok:cam:v'), r); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.alunos.map(a => a.id), ['a1', 'a3']);
    // do responsável, só o nome e o WhatsApp (contato rápido do professor); nada de CPF nem do código do cadastro
    const txt = JSON.stringify(r.body); assert.ok(!/"r1"|12345678901|responsavelId|cpf/.test(txt), 'vazou dado da família');
    assert.deepStrictEqual(r.body.alunos[0].resp, { nome: 'Mãe da Ana', telefone: '81999990001' });
    const ana = r.body.alunos[0], caio = r.body.alunos[1];
    assert.deepStrictEqual([ana.mensal.st, ana.mensal.v], ['pago', 200]); assert.strictEqual(r.body.totais.recebido, 200);
    assert.strictEqual(caio.mensal.st, 'atrasado'); assert.ok(caio.mensal.v > 0 && caio.mensal.v < 300, 'parte do Caio: ' + caio.mensal.v);
    assert.deepStrictEqual(caio.turmas, ['t1']);
    // quem não é professor da escola não entra
    r = resp(); await PR.professor(req({ acao: 'painel', eid: 'e7' }, 'ok:outro:v'), r); assert.strictEqual(r.code, 403);
    // notas: só dos alunos das turmas dele; edita e apaga só as dele
    r = resp(); await PR.professor(req({ acao: 'nota', eid: 'e7', alid: 'a2', texto: 'x' }, 'ok:cam:v'), r); assert.strictEqual(r.code, 403);
    r = resp(); await PR.professor(req({ acao: 'nota', eid: 'e7', alid: 'a1', texto: 'Ótimo chute', tag: 'desempenho' }, 'ok:cam:v'), r); assert.strictEqual(r.code, 200);
    const nid = r.body.id; assert.strictEqual(S.get('escolas/e7/notasAlunos/' + nid).autorNome, 'Camila');
    set7('notasAlunos/adm1', { alid: 'a1', texto: 'Nota da escola', autorUid: 'dono7', autorNome: 'Dona', em: 1 });
    r = resp(); await PR.professor(req({ acao: 'notas', eid: 'e7', alid: 'a1' }, 'ok:cam:v'), r); assert.strictEqual(r.body.notas.length, 2);
    r = resp(); await PR.professor(req({ acao: 'nota', eid: 'e7', alid: 'a1', id: 'adm1', texto: 'mudei' }, 'ok:cam:v'), r); assert.strictEqual(r.code, 403);
    r = resp(); await PR.professor(req({ acao: 'apagarNota', eid: 'e7', alid: 'a1', id: 'adm1' }, 'ok:cam:v'), r); assert.strictEqual(r.code, 403);
    r = resp(); await PR.professor(req({ acao: 'nota', eid: 'e7', alid: 'a1', id: nid, texto: 'Ótimo chute de esquerda' }, 'ok:cam:v'), r); assert.strictEqual(r.code, 200);
    assert.ok(S.get('escolas/e7/notasAlunos/' + nid).editadoEm);
    // chamada: só nas turmas dele (ou em que é o segundo professor); fica registrado quem fez; frequência
    r = resp(); await PR.professor(req({ acao: 'chamada', eid: 'e7', tid: 't2', data: H }, 'ok:cam:v'), r); assert.strictEqual(r.code, 403);
    set7('turmas/t2', { nome: 'Ballet', professoraId: 'p2', professoraIds: ['p1'], preco: 100 });
    r = resp(); await PR.professor(req({ acao: 'chamada', eid: 'e7', tid: 't2', data: H }, 'ok:cam:v'), r); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.alunos.map(a => a.id).sort(), ['a2', 'a3']);
    r = resp(); await PR.professor(req({ acao: 'chamada', eid: 'e7', tid: 't1', data: '2099-01-01' }, 'ok:cam:v'), r); assert.strictEqual(r.code, 400);
    r = resp(); await PR.professor(req({ acao: 'salvarChamada', eid: 'e7', tid: 't1', data: H, pres: { a1: 'f', a3: 'p', a2: 'p', x: 'p' } }, 'ok:cam:v'), r); assert.strictEqual(r.code, 200);
    const ch = S.get(`escolas/e7/chamadas/t1_${H}`); assert.deepStrictEqual(ch.pres, { a1: 'f', a3: 'p' }); assert.deepStrictEqual([ch.por.nome, ch.por.papel, ch.editado], ['Camila', 'professor', null]);
    r = resp(); await PR.professor(req({ acao: 'salvarChamada', eid: 'e7', tid: 't1', data: H, pres: { a1: 'j', a3: 'p' } }, 'ok:cam:v'), r);
    assert.strictEqual(S.get(`escolas/e7/chamadas/t1_${H}`).por.nome, 'Camila'); assert.ok(S.get(`escolas/e7/chamadas/t1_${H}`).editado);
    r = resp(); await PR.professor(req({ acao: 'freq', eid: 'e7', alid: 'a1' }, 'ok:cam:v'), r); assert.deepStrictEqual(r.body.chamadas.map(c => c.pres.a1), ['j']);
    r = resp(); await PR.professor(req({ acao: 'painel', eid: 'e7', mes }, 'ok:cam:v'), r); assert.deepStrictEqual(r.body.chamadas.t1, [H]); assert.ok(r.body.alunos.some(a => a.id === 'a2'));
    const fr = C.freqAluno([{ data: '2026-10-01', pres: { a: 'p' } }, { data: '2026-10-03', pres: { a: 'f' } }, { data: '2026-10-05', pres: { a: 'j' } }, { data: '2026-10-08', pres: { a: 'f' } }], 'a');
    assert.deepStrictEqual([fr.p, fr.f, fr.j, fr.pct, fr.seguidas], [1, 2, 1, 33, 2]);
    // a escola troca o e-mail: o acesso antigo acaba
    const P1b = { nome: 'Camila', emailApp: 'novo@x.com' }; set7('professoras/p1', { ...P1b, appUid: 'cam' });
    await E.espelharProf({ params: { eid: 'e7', pid: 'p1' }, data: { before: { exists: true, data: () => P1 }, after: { exists: true, data: () => P1b } } });
    assert.ok(!S.has('escolas/e7/equipe/cam')); assert.ok(!(S.get('users/cam').escolas || {}).e7); assert.ok(!(S.get('convitesProf/cam_at_x_com') || {})['e7_p1']);
    r = resp(); await PR.professor(req({ acao: 'painel', eid: 'e7' }, 'ok:cam:v'), r); assert.strictEqual(r.code, 403);
  });
  /* ---------- nota fiscal da escola e dos professores para as famílias ---------- */
  const EMITIDAS = [];
  const libFalsa = async () => ({
    Ambiente: { Producao: 'P', ProducaoRestrita: 'R' },
    parsePfx: (buf, senha) => { if (senha !== 'certa') throw new Error('senha'); return { subject: 'CN=ESCOLINHA GOL LTDA:11444777000161', expiresOn: new Date(Date.now() + 300 * 864e5) }; },
    NfseClient: class { constructor(o) { this.o = o; } async emitir(p) { EMITIDAS.push(p); return { status: 'ok', nfse: { chaveAcesso: 'CH' + EMITIDAS.length, idDps: 'D' + EMITIDAS.length, xmlNfse: '<x/>' } }; }
      async cancelar() { return { status: 'ok' }; } async consultarAliquota() { return { aliquotas: { '060401': [{ aliquota: 5 }] } }; } async replayPendingEvents() { return []; } },
    gerarDanfse: async () => Buffer.from('%PDF'), parseNfseXml: x => x
  });
  const NF = require('./notaFamilia')(db, P.interno, { lib: libFalsa });
  const s8 = (k, v) => S.set('escolas/e8/' + k, v);
  S.set('escolas/e8', { nome: 'Escolinha Gol', admins: ['adm8'] }); s8('config/geral', { cidade: 'Recife', uf: 'PE' });
  s8('turmas/t1', { nome: 'Sub-9', preco: 150, nota: true }); s8('turmas/t2', { nome: 'Goleiros', preco: 100, recebedor: 'p8', nota: true }); s8('turmas/t3', { nome: 'Recreação', preco: 80, nota: false });
  s8('extras/x1', { tipo: 'taxa', nome: 'Uniforme', v: 90, nota: false }); s8('extras/x2', { tipo: 'evento', nome: 'Copa Recife', v: 60, nota: true }); s8('extras/x3', { tipo: 'taxa', nome: 'Rifa', v: 20 }); // sem marcar: não emite
  s8('responsaveis/r1', { nome: 'Kate Lima', cpf: '529.982.247-25', email: 'kate@x.com' }); s8('responsaveis/r2', { nome: 'Rui', cpf: '' });
  s8('alunas/a1', { nome: 'Davi Lima', responsavelId: 'r1', turmas: ['t1', 't2'], inicio: '2026-01' }); s8('alunas/a2', { nome: 'Leo', responsavelId: 'r2', turmas: ['t1'], inicio: '2026-01' });
  s8('professoras/p8', { nome: 'Rafa', emailApp: 'rafa@x.com' }); s8('equipe/rafa', { pid: 'p8' });
  s8('membros/kate/vinculos/r1', { em: 1 });
  const nf = async (body, tok) => { const r = resp(); await NF.notaFiscal(req({ eid: 'e8', ...body }, tok), r); return r; };
  const CFG = { cnpj: '11.444.777/0001-61', regime: 'simples', cTribNac: '060401', aliqIss: '5', pTrib: '6', modo: 'todas', ambiente: 'restrita' };
  await t('nota para famílias: só liga com certificado e dados completos; certificado com senha errada não entra', async () => {
    let r = await nf({ acao: 'salvar', cfg: { ...CFG, ligado: true } }, 'ok:adm8'); assert.strictEqual(r.code, 412); assert.match(r.body.erro, /certificado/);
    r = await nf({ acao: 'certificado', pfx: Buffer.alloc(900, 1).toString('base64'), senha: 'errada' }, 'ok:adm8'); assert.strictEqual(r.code, 400);
    r = await nf({ acao: 'certificado', pfx: Buffer.alloc(900, 1).toString('base64'), senha: 'certa' }, 'ok:adm8'); assert.strictEqual(r.code, 200); assert.strictEqual(r.body.cert.doc, '11444777000161');
    assert.ok(!JSON.stringify(r.body).includes('certa'), 'a senha nunca volta para o app');
    r = await nf({ acao: 'salvar', cfg: { ...CFG, regime: 'simples', aliqIss: '', ligado: true } }, 'ok:adm8'); assert.strictEqual(r.code, 412); assert.match(r.body.erro, /ISS/);
    r = await nf({ acao: 'salvar', cfg: { ...CFG, ligado: true } }, 'ok:adm8'); assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.deepStrictEqual(r.body.falta, []);
    r = await nf({ acao: 'aliquota', cTribNac: '060401' }, 'ok:adm8'); assert.strictEqual(r.body.aliquota, 5);
    r = await nf({ acao: 'estado' }, 'ok:kate'); assert.strictEqual(r.code, 400); // família não mexe na configuração
  });
  await t('nota no Pix: só o que tem nota ligada, sem multa e juros, no CPF do responsável; nunca duas vezes', async () => {
    const cob = { rec: 'escola', rids: ['r1'], status: 'pending', itens: [
      { k: 'm:2026-10:a1', tipo: 'm', alid: 'a1', mes: '2026-10', v: 153, desc: 'Mensalidade de outubro', detalhe: 'Sub-9', enc: { base: 150, multa: 3, juros: 0 } },
      { k: 'x:x1:a1', tipo: 'x', alid: 'a1', xid: 'x1', v: 90, desc: 'Uniforme' }, { k: 'x:x2:a1', tipo: 'x', alid: 'a1', xid: 'x2', v: 60, desc: 'Copa Recife' }] };
    assert.strictEqual(await NF.interno.aposPix('e8', 'c1', cob), 'ok');
    const p = EMITIDAS.at(-1); assert.strictEqual(p.valores.vServ, 210); assert.deepStrictEqual(p.tomador.documento, { CPF: '52998224725' });
    assert.strictEqual(p.emitente.regime.opSimpNac, '3'); assert.strictEqual(p.valores.pTotTribSN, 6); assert.strictEqual(p.servico.cTribNac, '060401');
    assert.ok(!/Uniforme/.test(p.servico.descricao) && /Copa Recife/.test(p.servico.descricao));
    assert.strictEqual(await NF.interno.aposPix('e8', 'c1', cob), 'pulou'); assert.strictEqual(EMITIDAS.length, 1);
    // padrão é desligado: taxa que a escola não ligou não entra
    assert.strictEqual(await NF.interno.aposPix('e8', 'c2b', { rec: 'escola', rids: ['r1'], itens: [{ k: 'x:x3:a1', tipo: 'x', alid: 'a1', xid: 'x3', v: 20 }] }), 'sem_itens');
    // só taxa sem nota: não emite nada
    assert.strictEqual(await NF.interno.aposPix('e8', 'c2', { rec: 'escola', rids: ['r1'], itens: [{ k: 'x:x1:a1', tipo: 'x', alid: 'a1', xid: 'x1', v: 90 }] }), 'sem_itens');
  });
  await t('nota: família que dispensou não recebe; "só quem pedir" emite só para quem pediu; sem CPF fica esperando', async () => {
    const cob = id => ({ rec: 'escola', rids: [id], itens: [{ k: 'x:x2:a1', tipo: 'x', alid: id === 'r1' ? 'a1' : 'a2', xid: 'x2', v: 60, desc: 'Copa' }] });
    let r = await nf({ acao: 'famPref', rid: 'r1', quer: false }, 'ok:kate'); assert.strictEqual(r.code, 200);
    assert.strictEqual(await NF.interno.aposPix('e8', 'c3', cob('r1')), 'familia_nao');
    await nf({ acao: 'salvar', cfg: { ...CFG, modo: 'pedido', ligado: true } }, 'ok:adm8');
    await nf({ acao: 'famPref', rid: 'r1', quer: true }, 'ok:kate');
    assert.strictEqual(await NF.interno.aposPix('e8', 'c4', cob('r1')), 'ok');
    assert.strictEqual(await NF.interno.aposPix('e8', 'c5', cob('r2')), 'nao_pediu');
    await nf({ acao: 'salvar', cfg: { ...CFG, modo: 'todas', ligado: true } }, 'ok:adm8');
    assert.strictEqual(await NF.interno.aposPix('e8', 'c6', cob('r2')), 'sem_dados');
    s8('responsaveis/r2', { nome: 'Rui Alves', cpf: '111.444.777-35' });
    r = await nf({ acao: 'retentar', nid: 'pix_c6' }, 'ok:adm8'); assert.strictEqual(r.body.status, 'ok'); assert.strictEqual(EMITIDAS.at(-1).tomador.nome, 'Rui Alves');
  });
  await t('nota no dinheiro: cada um emite a sua parte; professor sem certificado não emite', async () => {
    s8('pagamentos/a1', { mens: { '2026-09': { s: 'pago', d: '2026-10-10', v: 250, via: 'dinheiro' } } });
    const r = await nf({ acao: 'baixa', alid: 'a1', chaves: ['m:2026-09:a1'] }, 'ok:adm8');
    assert.deepStrictEqual(r.body.res, { escola: 'ok', p8: 'desligado' });
    assert.strictEqual(EMITIDAS.at(-1).valores.vServ, 150);
    let r2 = await nf({ acao: 'baixa', alid: 'a1', chaves: ['m:2026-09:a1'] }, 'ok:rafa:v'); assert.strictEqual(r2.code, 403);
    // o professor tem a configuração dele, separada da escola
    r2 = await nf({ acao: 'estado' }, 'ok:rafa:v'); assert.strictEqual(r2.body.papel, 'prof'); assert.ok(!r2.body.cert);
    S.set('escolas/e8/segredos/nfseCfg_p8', { ...CFG, cnpj: '11444777000161', ligado: true });
    // o professor decide a nota das turmas dele, independente da escola: a turma t2 tem nota ligada pela escola, mas vale a escolha dele
    S.set('escolas/e8/segredos/nfseCert_p8', { pfx: 'eA==', senha: 'certa', validade: Date.now() + 9e9 });
    r2 = await nf({ acao: 'estado' }, 'ok:rafa:v'); assert.deepStrictEqual(r2.body.meus.map(x => [x.id, x.nota]), [['t2', false]]);
    const itM = [{ k: 'm:2026-09:a1', tipo: 'm', alid: 'a1', mes: '2026-09', v: 100, desc: 'Mensalidade' }];
    assert.strictEqual(await NF.interno.emitir('e8', 'p8', { nid: 'p8a', rid: 'r1', itens: itM, origem: 'pix' }), 'sem_itens');
    r2 = await nf({ acao: 'salvar', cfg: { ...CFG, ligado: true, itens: { t2: true, t1: true } } }, 'ok:rafa:v'); assert.strictEqual(r2.code, 200, JSON.stringify(r2.body));
    assert.deepStrictEqual(S.get('escolas/e8/segredos/nfseCfg_p8').itens, { t2: true }); // t1 é da escola: o professor não mexe
    assert.strictEqual(await NF.interno.emitir('e8', 'p8', { nid: 'p8b', rid: 'r1', itens: itM, origem: 'pix' }), 'ok');
    assert.strictEqual(EMITIDAS.at(-1).valores.vServ, 100);
    S.delete('escolas/e8/segredos/nfseCert_p8'); // sem certificado, o professor não emite (nem se tiver ligado)
    assert.strictEqual(await NF.interno.emitir('e8', 'p8', { nid: 'x', rid: 'r1', itens: itM, origem: 'pix' }), 'sem_certificado');
  });
  await t('nota: a família vê e baixa só as próprias; a escola cancela', async () => {
    let r = await nf({ acao: 'famNotas' }, 'ok:kate'); assert.ok(r.body.notas.length >= 2); assert.ok(r.body.notas.every(n => n.rid === 'r1'));
    r = await nf({ acao: 'famPdf', nid: 'pix_c6' }, 'ok:kate'); assert.strictEqual(r.code, 404);
    r = await nf({ acao: 'famPdf', nid: 'pix_c1' }, 'ok:kate'); assert.strictEqual(r.code, 200); assert.ok(r.body.pdf);
    r = await nf({ acao: 'cancelar', nid: 'pix_c1', motivo: 'Emitida por engano' }, 'ok:rafa:v'); assert.strictEqual(r.code, 404);
    r = await nf({ acao: 'cancelar', nid: 'pix_c1', motivo: 'Emitida por engano' }, 'ok:adm8'); assert.strictEqual(r.body.status, 'cancelada');
    assert.strictEqual(await NF.interno.aposPix('e8', 'c1', { rec: 'escola', rids: ['r1'], itens: [] }), 'sem_itens');
  });

  /* ---------- cartão e boleto das famílias; plano da escola ---------- */
  await t('formas: valor do cartão e do boleto com a taxa repassada; sem repasse, o valor cheio', () => {
    assert.deepStrictEqual(C.valorForma(100, 'cartao', { pixRepassa: true }, 0.01), { valor: 106.37, fee: 1.06 });
    assert.deepStrictEqual(C.valorForma(100, 'boleto', { pixRepassa: true }, 0.01), { valor: 104.54, fee: 1.05 });
    assert.deepStrictEqual(C.valorForma(100, 'cartao', {}, 0.01), { valor: 100, fee: 1 });
    assert.strictEqual(C.valorForma(100, 'pix', { pixRepassa: true }, 0.01).valor, C.valorPix(100, { pixRepassa: true }, 0.0099, 0.01).valor);
  });
  await t('plano: faixa por alunos, anual = 10 meses, desconto do dono (% ou valor) e situação do atraso', () => {
    assert.deepStrictEqual([C.planoPara(30).id, C.planoPara(31).id, C.planoPara(250).id, C.planoPara(251).id], ['inicial', 'essencial', 'completo', 'grande']);
    assert.strictEqual(C.precoPlano(80, 'anual', {}, H).valor, 690);
    assert.strictEqual(C.precoPlano(80, 'mensal', { desconto: { pct: 50 } }, H).valor, 34.5);
    assert.strictEqual(C.precoPlano(80, 'mensal', { desconto: { pct: 50, ate: '2026-10-01' } }, H).valor, 69); // desconto vencido
    assert.strictEqual(C.precoPlano(80, 'anual', { desconto: { valor: 40 } }, H).valor, 400);
    const f = venc => C.situacaoPlano({ testeAte: venc }, H).fase;
    assert.deepStrictEqual([f('2026-10-20'), f('2026-10-10'), f('2026-10-09'), f('2026-09-15'), f('2026-09-14')], ['teste', 'aviso', 'leitura', 'leitura', 'suspensa']);
    assert.strictEqual(C.situacaoPlano({ testeAte: '2026-07-01' }, H).encerrar, true);
    assert.strictEqual(C.situacaoPlano({ testeAte: '2026-09-01', cortesiaAte: '2026-12-01' }, H).fase, 'cortesia');
    assert.strictEqual(C.maisMeses('2026-01-31', 1), '2026-02-28');
  });
  {
    const db2 = bancoFalso(), S2 = db2.store, P2 = require('./pagamentos')(db2);
    const CA = require('./cartao')(db2, P2.interno), AS = require('./assinatura')(db2, P2.interno);
    S2.set('servidor/mp', { clientId: '123', clientSecret: 's', comissao: 0.01, publicKey: 'APP_PUB' });
    S2.set('servidor/plataforma', { emails: ['dono@x.com'] });
    S2.set('escolas/e5', { nome: 'Escola Cinco', admins: ['adm5'] });
    S2.set('escolas/e5/config/geral', { vencDia: 10, pixRepassa: true, formas: { cartao: true, boleto: true, parcelado: true, maxParcelas: 3 } });
    S2.set('escolas/e5/segredos/mp', { token: 'TOKEN-E5', via: 'oauth' });
    S2.set('escolas/e5/turmas/t1', { nome: 'GR', preco: 100 });
    S2.set('escolas/e5/alunas/b1', { nome: 'Bia', responsavelId: 'q1', turmas: ['t1'], inicio: '2026-10' });
    S2.set('escolas/e5/membros/pai', {}); S2.set('escolas/e5/membros/pai/vinculos/q1', {});
    const pay = {}; let id2 = 5001, prer = null;
    global.fetch = async (url, o = {}) => {
      const ok = b => ({ ok: true, status: 200, json: async () => b }), b = o.body ? JSON.parse(o.body) : null;
      if (url.endsWith('/oauth/token')) return ok({ access_token: 'TOKEN-APP', expires_in: 21600 });
      if (url.endsWith('/v1/payments') && o.method === 'POST') { const id = id2++, st = b.payment_method_id === 'visa' ? (b.token === 'RUIM' ? 'rejected' : 'approved') : 'pending';
        pay[id] = { ...b, id, status: st, status_detail: b.token === 'RUIM' ? 'cc_rejected_insufficient_amount' : 'accredited', payment_type_id: b.payment_method_id === 'visa' ? 'credit_card' : b.payment_method_id === 'pix' ? 'bank_transfer' : 'ticket', installments: b.installments || 1, card: { last_four_digits: '4242' }, auth: o.headers.Authorization };
        return ok({ ...pay[id], transaction_details: { digitable_line: '2379-LINHA', external_resource_url: 'https://mp/boleto/' + id }, point_of_interaction: { transaction_data: { qr_code: 'PIX-' + id } } }); }
      const m = url.match(/\/v1\/payments\/(\d+)$/); if (m) return ok(pay[m[1]]);
      if (url.includes('/v1/customers/search')) return ok({ results: [] });
      if (url.endsWith('/v1/customers')) return ok({ id: 'CUST1' });
      if (url.endsWith('/v1/customers/CUST1/cards')) return ok({ id: 'CARD1', last_four_digits: '4242', payment_method: { id: 'visa', name: 'Visa' }, expiration_month: 8, expiration_year: 2030 });
      if (url.endsWith('/preapproval') && o.method === 'POST') { prer = { id: 'PRE1', status: 'authorized', auto_recurring: b.auto_recurring, summarized: { charged_quantity: 0 }, body: b, auth: o.headers.Authorization }; return ok(prer); }
      if (url.includes('/preapproval/PRE1')) { if (o.method === 'PUT') { if (b.status) prer.status = b.status; if (b.auto_recurring) prer.auto_recurring = { ...prer.auto_recurring, ...b.auto_recurring }; } return ok(prer); }
      throw new Error('url inesperada ' + url);
    };
    await t('pagar: sem a chave pública da conta, pede para a escola reconectar; com ela, devolve valor e parcelas', async () => {
      let r = resp(); await CA.pagar(req({ acao: 'preparar', eid: 'e5', itens: ['m:2026-10:b1'] }, 'ok:pai'), r);
      assert.strictEqual(r.code, 412); assert.strictEqual(r.body.codigo, 'reconectar');
      S2.set('escolas/e5/segredos/mp', { token: 'TOKEN-E5', via: 'oauth', publicKey: 'PUB-E5' });
      r = resp(); await CA.pagar(req({ acao: 'preparar', eid: 'e5', itens: ['m:2026-10:b1'] }, 'ok:pai'), r);
      assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.deepStrictEqual([r.body.publicKey, r.body.maxParcelas, r.body.valor], ['PUB-E5', 3, C.valorForma(r.body.base, 'cartao', { pixRepassa: true }, 0.01).valor]);
      r = resp(); await CA.pagar(req({ acao: 'preparar', eid: 'e5', itens: ['m:2026-10:b1'] }, 'ok:estranho'), r); assert.strictEqual(r.code, 403);
    });
    await t('pagar: cartão recusado explica o motivo; aprovado dá baixa na hora como Cartão em 3x, com a taxa do app, e guarda o cartão', async () => {
      let r = resp(); await CA.pagar(req({ acao: 'cartao', eid: 'e5', itens: ['m:2026-10:b1'], token: 'RUIM', metodo: 'visa', parcelas: 3 }, 'ok:pai'), r);
      assert.strictEqual(r.code, 402); assert.match(r.body.erro, /limite/); assert.ok(!S2.has('escolas/e5/pagamentos/b1'));
      r = resp(); await CA.pagar(req({ acao: 'cartao', eid: 'e5', itens: ['m:2026-10:b1'], token: 'TOK1', token2: 'TOK2', salvar: true, metodo: 'visa', parcelas: 9 }, 'ok:pai'), r);
      assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.parcelas, 3); // no máximo o que a escola liberou
      const p = Object.values(pay).at(-1); assert.strictEqual(p.application_fee, C.r2(p.transaction_amount * 0.01)); assert.strictEqual(p.auth, 'Bearer TOKEN-E5'); assert.strictEqual(p.binary_mode, true);
      const pg = S2.get('escolas/e5/pagamentos/b1').mens['2026-10']; assert.deepStrictEqual([pg.via, pg.parcelas, pg.v], ['cartao', 3, 100]);
      assert.deepStrictEqual([r.body.cartao.marca, r.body.cartao.fim, r.body.cartao.auto], ['Visa', '4242', false]);
      r = resp(); await CA.pagar(req({ acao: 'automatico', eid: 'e5', rec: 'escola', ligar: true }, 'ok:pai'), r); assert.strictEqual(r.code, 412); // sem a liberação do Mercado Pago
    });
    await t('pagar: boleto confere CPF e endereço e devolve a linha digitável', async () => {
      S2.set('escolas/e5/alunas/b2', { nome: 'Caio', responsavelId: 'q1', turmas: ['t1'], inicio: '2026-10' });
      let r = resp(); await CA.pagar(req({ acao: 'boleto', eid: 'e5', itens: ['m:2026-10:b2'], pagador: { nome: 'Pai', cpf: '123' } }, 'ok:pai'), r); assert.strictEqual(r.code, 400);
      r = resp(); await CA.pagar(req({ acao: 'boleto', eid: 'e5', itens: ['m:2026-10:b2'], pagador: { nome: 'Pedro Alves', cpf: '529.982.247-25', cep: '50000-000', rua: 'Rua A', numero: '10', bairro: 'Boa Vista', cidade: 'Recife', uf: 'PE' } }, 'ok:pai'), r);
      assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.boleto.linha, '2379-LINHA');
      const p = Object.values(pay).at(-1); assert.strictEqual(p.payment_method_id, 'bolbradesco'); assert.strictEqual(p.payer.address.federal_unit, 'PE');
      // pago: o aviso do Mercado Pago dá baixa como Boleto
      p.status = 'approved'; const w = resp(); await P2.mpWebhook({ query: { e: 'e5', r: 'escola', 'data.id': String(p.id) }, body: {} }, w);
      assert.strictEqual(S2.get('escolas/e5/pagamentos/b2').mens['2026-10'].via, 'boleto');
    });
    await t('plano: primeiro acesso cria 30 dias de teste; o teste é um por CPF/CNPJ', async () => {
      let r = resp(); await AS.plano(req({ acao: 'estado', eid: 'e5' }, 'ok:pai'), r); assert.strictEqual(r.code, 403);
      r = resp(); await AS.plano(req({ acao: 'estado', eid: 'e5' }, 'ok:adm5'), r);
      assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.plano.testeAte, '2026-11-14'); assert.strictEqual(r.body.situacao.fase, 'teste');
      assert.deepStrictEqual([r.body.alunos, r.body.mensal.valor, r.body.anual.valor, r.body.publicKey], [2, 39, 390, 'APP_PUB']);
      r = resp(); await AS.plano(req({ acao: 'documento', eid: 'e5', doc: '529.982.247-25' }, 'ok:adm5'), r); assert.strictEqual(r.body.aviso, null);
      S2.set('escolas/e6', { nome: 'Escola Seis', admins: ['adm6'] });
      r = resp(); await AS.plano(req({ acao: 'documento', eid: 'e6', doc: '52998224725' }, 'ok:adm6'), r);
      assert.match(r.body.aviso, /já usou/); assert.strictEqual(r.body.plano.testeAte, H);
    });
    await t('plano manual: a escola escolhe; só desce se os alunos couberem; o preço segue o plano escolhido', async () => {
      assert.strictEqual(S2.get('escolas/e5/config/plano').planoId, 'inicial');
      let r = resp(); await AS.plano(req({ acao: 'escolher', eid: 'e5', planoId: 'completo' }, 'ok:adm5'), r); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
      assert.deepStrictEqual([r.body.plano.planoId, r.body.mensal.valor], ['completo', 129]);
      for (let i = 0; i < 30; i++) S2.set('escolas/e5/alunas/z' + i, { nome: 'Z' + i, responsavelId: 'q9', turmas: ['t1'], inicio: '2026-09' });
      r = resp(); await AS.plano(req({ acao: 'escolher', eid: 'e5', planoId: 'inicial' }, 'ok:adm5'), r); assert.strictEqual(r.code, 409); assert.match(r.body.erro, /32 alunos/);
      for (let i = 0; i < 30; i++) S2.delete('escolas/e5/alunas/z' + i);
      r = resp(); await AS.plano(req({ acao: 'escolher', eid: 'e5', planoId: 'inicial' }, 'ok:adm5'), r); assert.strictEqual(r.body.mensal.valor, 39);
      r = resp(); await AS.plano(req({ acao: 'escolher', eid: 'e5', planoId: 'nada' }, 'ok:adm5'), r); assert.strictEqual(r.code, 400);
    });
    await t('plano: Pix na conta da empresa estende um mês a partir do vencimento; atraso de 6 dias trava (só leitura)', async () => {
      S2.set('escolas/e6/config/plano', { ...S2.get('escolas/e6/config/plano'), testeAte: '2026-10-09' });
      let r = resp(); await AS.plano(req({ acao: 'estado', eid: 'e6' }, 'ok:adm6'), r); assert.strictEqual(S2.get('escolas/e6/config/plano').bloqueio, 'leitura');
      r = resp(); await AS.plano(req({ acao: 'pix', eid: 'e6' }, 'ok:adm6'), r); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
      const p = pay[r.body.pix.mpId]; assert.strictEqual(p.auth, 'Bearer TOKEN-APP'); assert.strictEqual(p.application_fee, undefined); assert.strictEqual(p.transaction_amount, 39);
      p.status = 'approved'; const w = resp(); await AS.planoWebhook({ query: { e: 'e6', 'data.id': String(p.id) }, body: {} }, w);
      const pl = S2.get('escolas/e6/config/plano'); assert.deepStrictEqual([pl.pagoAte, pl.bloqueio, pl.fase], ['2026-11-09', null, 'ativo']);
      await AS.planoWebhook({ query: { e: 'e6', 'data.id': String(p.id) }, body: {} }, resp()); assert.strictEqual(S2.get('escolas/e6/config/plano').pagoAte, '2026-11-09'); // aviso repetido não soma de novo
    });
    await t('plano suspenso: a família não paga pelo app e recebe a mensagem de pausa', async () => {
      S2.set('escolas/e5/config/plano', { ...S2.get('escolas/e5/config/plano'), bloqueio: 'suspensa' });
      const r = resp(); await P2.criarPix(req({ eid: 'e5', itens: ['m:2026-11:b1'] }, 'ok:pai'), r);
      assert.strictEqual(r.code, 423); assert.strictEqual(r.body.erro, 'O acesso da escola ao app e seus serviços está pausado. Fale com a escola.');
      S2.set('escolas/e5/config/plano', { ...S2.get('escolas/e5/config/plano'), bloqueio: null });
    });
    await t('plano no cartão: assinatura começa no fim do teste; cada cobrança estende; preço segue a faixa e o desconto', async () => {
      let r = resp(); await AS.plano(req({ acao: 'cartao', eid: 'e5', token: 'CT1', marca: 'Visa', fim: '4242' }, 'ok:adm5'), r); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
      assert.strictEqual(prer.body.auto_recurring.start_date.slice(0, 10), '2026-11-14'); assert.strictEqual(prer.auth, 'Bearer TOKEN-APP');
      prer.summarized.charged_quantity = 1; await AS.interno.diario();
      assert.strictEqual(S2.get('escolas/e5/config/plano').pagoAte, '2026-12-14');
      r = resp(); await AS.plano(req({ acao: 'donoDesconto', eid: 'e5', pct: 50, motivo: 'parceria' }, 'ok:dono@x.com'), r); assert.strictEqual(r.code, 403); // e-mail não confirmado
    });
    await t('painel do dono: meses grátis e desconto por escola, com histórico; a assinatura pausa nos meses grátis', async () => {
      const dono = 'ok:dono:v';
      S2.set('servidor/plataforma', { emails: ['dono@x.com'] });
      let r = resp(); await AS.plano(req({ acao: 'donoEscolas' }, 'ok:adm5:v'), r); assert.strictEqual(r.code, 403);
      r = resp(); await AS.plano(req({ acao: 'donoDesconto', eid: 'e5', pct: 50, motivo: 'parceria' }, dono), r); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
      assert.strictEqual(prer.auto_recurring.transaction_amount, 19.5);
      const e5 = () => r.body.escolas.find(x => x.eid === 'e5'); assert.strictEqual(e5().valor, 19.5);
      r = resp(); await AS.plano(req({ acao: 'donoDesconto', eid: 'e5', valor: '25', ate: '2027-03-01' }, dono), r); assert.strictEqual(e5().valor, 25);
      r = resp(); await AS.plano(req({ acao: 'donoCortesia', eid: 'e5', meses: 3, motivo: 'indicação' }, dono), r);
      assert.strictEqual(e5().cortesiaAte, '2027-03-14'); assert.strictEqual(e5().fase, 'cortesia'); assert.strictEqual(prer.status, 'paused');
      assert.deepStrictEqual(e5().historico.map(h => h.txt.split(':')[0].split(',')[0]), ['Escola mudou para o plano Completo', 'Escola mudou para o plano Inicial', 'Desconto', 'Desconto', '3 meses grátis']);
      r = resp(); await AS.plano(req({ acao: 'donoTirarCortesia', eid: 'e5' }, dono), r); assert.strictEqual(prer.status, 'authorized');
    });
  }
  Date.now = realNow;
  console.log(`\n${n} testes passaram.`);
})().catch(e => { console.error('✗', e); process.exit(1); });

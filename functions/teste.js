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
    where: (f, op, v) => col(c, [...filtros, [f, v]]),
    get: async () => { const docs = [...store.keys()].filter(k => k.split('/').slice(0, -1).join('/') === c && filtros.every(([f, v]) => (store.get(k) || {})[f] === v)).map(k => ({ id: k.split('/').pop(), data: () => store.get(k), ref: doc(k) })); return { docs, forEach: f => docs.forEach(f) }; } });
  const runTransaction = async fn => fn({ get: r => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d) });
  return { store, doc, collection: col, runTransaction };
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
  await t('evento em que a família se inscreve: ela confirma "Já fiz a inscrição" e pode desfazer só o que ela confirmou', async () => {
    S.set('escolas/e1/extras/ev2', { tipo: 'evento', cobranca: 'familia', semCobranca: true, nome: 'Festival', data: '2026-11-20', convidados: ['a1'], alunas: [], part: {} });
    const A = require('./acoes')(db);
    let r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev1', alid: 'a1', st: 'inscrito' }, 'ok:mae'), r); assert.strictEqual(r.code, 400); // no caixa da escola, não
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev2', alid: 'a1', st: 'inscrito' }, 'ok:mae'), r); assert.strictEqual(r.code, 200);
    assert.strictEqual(S.get('escolas/e1/extras/ev2').part.a1.st, 'inscrito');
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev2', alid: 'a1', st: 'interesse' }, 'ok:mae'), r); assert.strictEqual(r.code, 200);
    S.set('escolas/e1/extras/ev2', { ...S.get('escolas/e1/extras/ev2'), part: { a1: { st: 'inscrito', quem: 'escola' } } });
    r = resp(); await A.eventoResposta(req({ eid: 'e1', xid: 'ev2', alid: 'a1', st: 'nao' }, 'ok:mae'), r); assert.strictEqual(r.code, 409); // a escola confirmou: só a escola muda
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
  const N = require('./nfse')(db, P.interno);
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
  await t('notas: relatório e dados do tomador só para a empresa do app', async () => {
    let r = resp(); await N.notasPlataforma(req({ acao: 'relatorio', mes: '2026-09' }, 'ok:adm9'), r); assert.strictEqual(r.code, 403);
    r = resp(); await N.notasPlataforma(req({ acao: 'relatorio', mes: '2026-09' }, 'ok:dona'), r); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.ok(r.body.nfse.falta.includes('certificado digital A1')); assert.ok(r.body.linhas.some(l => l.gid === 'e9~p1' && !l.nota));
    r = resp(); await N.notasPlataforma(req({ acao: 'tomador', gid: 'e9~p1', nome: 'Juliana Costa', doc: '529.982.247-25' }, 'ok:dona'), r); assert.strictEqual(r.code, 200);
    assert.strictEqual(S.get('escolas/e9/segredos/nota_p1').doc, '52998224725');
    r = resp(); await N.notasPlataforma(req({ acao: 'tomador', gid: 'e9/x~p1', nome: 'X', doc: '52998224725' }, 'ok:dona'), r); assert.strictEqual(r.code, 404);
    r = resp(); await N.notasPlataforma(req({ acao: 'emitir', mes: '2026-09' }, 'ok:dona'), r); assert.strictEqual(r.code, 412); // sem configuração fiscal
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
    r = resp(); await N.notasPlataforma(req({ acao: 'painel' }, 'ok:dona'), r); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    const pb = r.body.cidades.find(c => c.nome === 'João Pessoa · PB');
    assert.deepStrictEqual([pb.escolas, pb.ativas, pb.alunos, pb.contas, pb.pagantes], [1, 1, 1, 2, 1]);
    assert.strictEqual(r.body.contas.total, 2); assert.ok(r.body.regioes.some(x => x.nome === 'Nordeste'));
  });
  Date.now = realNow;
  console.log(`\n${n} testes passaram.`);
})().catch(e => { console.error('✗', e); process.exit(1); });

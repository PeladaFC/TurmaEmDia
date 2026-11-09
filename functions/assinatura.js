/* Turma em Dia · plano da escola (o que a escola paga para usar o app), na conta do Mercado Pago da empresa do app.
   O preço depende de quantos alunos ativos a escola tem (calculo.js: PLANOS, precoPlano). Anual = 10 meses.
   - 30 dias de teste, um por CPF/CNPJ (servidor/testes/{documento}). Escolas que já existiam ganham o teste a partir do primeiro acesso.
   - Pagamento: cartão de crédito digitado dentro do app (o número vai direto ao Mercado Pago; cobrança automática todo mês ou ano),
     ou Pix, mês a mês (ou o ano), pelo QR Code.
   - Atraso (calculo.js: situacaoPlano): até 5 dias, só aviso; de 6 a 30, só leitura (sem registrar dinheiro; as famílias seguem
     pagando pelo app e recebendo nota); mais de 30, suspensa (as famílias veem "O acesso da escola ao app e seus serviços está pausado.
     Fale com a escola."); 90 dias depois do vencimento, aviso de encerramento.
     O servidor grava escolas/{eid}/config/plano.bloqueio ('leitura' | 'suspensa' | null), que as regras do Firestore conferem.
   - Painel do dono: lista as escolas, dá meses grátis (cortesiaAte) e desconto ({ pct } ou { valor } por mês, com ou sem prazo).
   - Códigos de cortesia (servidor/cortesia/codigos/{CODIGO}): o dono cria um código com N meses grátis e um limite de escolas.
     A escola digita o código no passo do cartão: ganha os meses e não precisa do cartão até eles acabarem.
     Quando acabam sem cartão, a escola volta a ver o passo do cartão ao entrar (escolas/{eid}.cartaoPendente).
   Chave da conta da empresa: servidor/mp.accessToken, ou a da própria aplicação (client_credentials). Chave pública: servidor/mp.publicKey. */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const C = require('./calculo');

module.exports = (db, P) => {
  const { ler, erro, idOk, plataforma, BASE, MP, hojeRecife, isoRecife, trocaOAuth } = P;
  const planoRef = eid => db.doc(`escolas/${eid}/config/plano`);
  const segRef = eid => db.doc(`escolas/${eid}/segredos/plano`);
  const mesAtual = () => hojeRecife().slice(0, 7);
  const pedir = async (token, metodo, caminho, corpo, idem) => {
    const r = await fetch(MP + caminho, { method: metodo, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(idem ? { 'X-Idempotency-Key': idem } : {}) }, ...(corpo ? { body: JSON.stringify(corpo) } : {}) });
    const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j };
  };

  // chave da conta do Mercado Pago da empresa do app (guardada por algumas horas)
  async function tokenEmpresa() {
    const mp = (await ler('servidor/mp')) || {};
    if (mp.accessToken) return mp.accessToken;
    const c = (await ler('servidor/mp_empresa')) || {};
    if (c.token && c.expira > Date.now() + 3600e3) return c.token;
    const Pl = await plataforma(); if (!Pl.id || !Pl.segredo) throw erro('O pagamento do plano ainda está sendo preparado. Tente mais tarde.', 503);
    const n = await trocaOAuth({ client_id: Pl.id, client_secret: Pl.segredo, grant_type: 'client_credentials' });
    await db.doc('servidor/mp_empresa').set({ token: n.token, expira: n.expira, em: Date.now() });
    return n.token;
  }

  async function alunosAtivos(eid) {
    const mes = mesAtual(), s = await db.collection(`escolas/${eid}/alunas`).get();
    return s.docs.filter(d => { const a = d.data(); return a.ativa !== false && C.ativaNoMes(a, mes); }).length;
  }
  // cria o plano na primeira vez (teste de 30 dias a partir de hoje)
  async function garantir(eid) {
    const ref = planoRef(eid), s = await ref.get(); if (s.exists) return s.data();
    const hoje = hojeRecife(), p = { inicio: hoje, testeAte: C.maisDias(hoje, 30), ciclo: 'mensal', planoId: C.planoPara(await alunosAtivos(eid)).id, criadoEm: Date.now(), bloqueio: null };
    await ref.set(p); return p;
  }
  // grava a situação (e o bloqueio que as regras do Firestore conferem)
  async function gravar(eid, mudou) {
    const ref = planoRef(eid), atual = { ...((await ref.get()).data() || {}), ...mudou }, sit = C.situacaoPlano(atual, hojeRecife());
    await ref.set({ ...mudou, bloqueio: sit.bloqueio, fase: sit.fase, venc: sit.venc || null, atualizadoEm: Date.now() }, { merge: true });
    return { ...atual, bloqueio: sit.bloqueio, fase: sit.fase, venc: sit.venc };
  }
  // pagou um período: estende a partir do vencimento (ou de hoje, se a escola já estava suspensa)
  function estender(p, ciclo) {
    const hoje = hojeRecife(), venc = [p.testeAte || '', p.pagoAte || ''].sort().pop() || hoje;
    const base = venc < C.maisDias(hoje, -30) ? hoje : venc;
    return C.maisMeses(base, ciclo === 'anual' ? 12 : 1);
  }

  // confere a assinatura no cartão: cobranças novas, preço novo (mudou a faixa de alunos ou o desconto) e pausa nos meses grátis
  async function sincronizar(eid, p0) {
    const seg = (await segRef(eid).get()).data() || {}; let p = p0 || (await ler(`escolas/${eid}/config/plano`)) || {};
    const mudou = {};
    if (seg.preId) {
      try {
        const tok = await tokenEmpresa(), r = await pedir(tok, 'GET', `/preapproval/${seg.preId}`);
        if (r.ok) {
          const x = r.j, feitas = Number((x.summarized || {}).charged_quantity) || 0, antes = Number(seg.cobradas) || 0;
          if (feitas > antes) { let pa = p.pagoAte; for (let i = antes; i < feitas; i++) pa = estender({ ...p, pagoAte: pa }, p.ciclo); mudou.pagoAte = pa; await segRef(eid).set({ cobradas: feitas }, { merge: true }); }
          if (x.status === 'cancelled') { mudou.forma = null; mudou.cartao = null; await segRef(eid).set({ preId: null }, { merge: true }); }
          else {
            const hoje = hojeRecife(), n = await alunosAtivos(eid), preco = C.precoPlano(n, p.ciclo, p, hoje).valor, atual = Number((x.auto_recurring || {}).transaction_amount);
            if (preco > 0 && Math.abs(preco - atual) > 0.009) { const u = await pedir(tok, 'PUT', `/preapproval/${seg.preId}`, { auto_recurring: { transaction_amount: preco, currency_id: 'BRL' } }); if (u.ok) mudou.valorCartao = preco; }
            const gratis = (p.cortesiaAte || '') > hoje || preco === 0;
            if (gratis && x.status === 'authorized') { const u = await pedir(tok, 'PUT', `/preapproval/${seg.preId}`, { status: 'paused' }); if (u.ok) mudou.pausadoGratis = true; }
            if (!gratis && x.status === 'paused' && p.pausadoGratis) { const u = await pedir(tok, 'PUT', `/preapproval/${seg.preId}`, { status: 'authorized' }); if (u.ok) mudou.pausadoGratis = false; }
            if (x.next_payment_date) mudou.proxCobranca = String(x.next_payment_date).slice(0, 10);
          }
        }
      } catch (e) { logger.warn('plano sincronizar', eid, e.message); }
    }
    // Pix do plano ainda aberto: confere se pagou (caso o aviso do Mercado Pago não tenha chegado)
    if (p.pix && p.pix.mpId && p.pix.status === 'pending') {
      try { const tok = await tokenEmpresa(), r = await pedir(tok, 'GET', `/v1/payments/${p.pix.mpId}`); if (r.ok) { const k = await pixPago(eid, r.j); if (k) p = { ...p, ...k }; } } catch (e) { logger.warn('plano pix', eid, e.message); }
    }
    return gravar(eid, mudou);
  }
  // Pix do plano aprovado: estende uma vez só (escolas/{eid}/planoPag/{mpId})
  async function pixPago(eid, pag) {
    const [tipo, e2, ciclo] = String(pag.external_reference || '').split('|');
    if (tipo !== 'plano' || e2 !== eid) return null;
    const ref = db.doc(`escolas/${eid}/planoPag/${pag.id}`);
    if (pag.status !== 'approved') { if (['cancelled', 'rejected', 'expired'].includes(pag.status)) await planoRef(eid).set({ pix: null }, { merge: true }); return null; }
    let feito = false;
    await db.runTransaction(async t => { const s = await t.get(ref); if (s.exists) return; t.set(ref, { valor: pag.transaction_amount, ciclo, forma: 'pix', em: Date.now() }); feito = true; });
    if (!feito) return null;
    const p = (await ler(`escolas/${eid}/config/plano`)) || {}, pagoAte = estender(p, ciclo);
    return gravar(eid, { pagoAte, pix: null, ultimoPag: { em: Date.now(), valor: pag.transaction_amount, forma: 'pix', ciclo } });
  }

  async function publico(eid, p) {
    const hoje = hojeRecife(), n = await alunosAtivos(eid), sit = C.situacaoPlano(p, hoje), mp = (await ler('servidor/mp')) || {};
    return { plano: { ...p }, situacao: sit, alunos: n, mensal: C.precoPlano(n, 'mensal', p, hoje), anual: C.precoPlano(n, 'anual', p, hoje), publicKey: mp.publicKey || null };
  }

  /* ---------- dono do app ---------- */
  async function daEmpresa(u) {
    const em = String(u.email || '').toLowerCase(), d = (await ler('servidor/plataforma')) || {};
    if (!em || !(d.emails || []).map(x => String(x).toLowerCase().trim()).includes(em)) throw erro('Acesso só para a empresa do Turma em Dia.', 403);
    if (u.email_verified !== true) throw erro('Confirme o seu e-mail para abrir o painel do dono.', 403);
  }
  async function listaEscolas() {
    const hoje = hojeRecife(), out = [];
    for (const e of (await db.collection('escolas').get()).docs) {
      if (e.data().encerradaEm) continue; // escola encerrada: não cobra mais o plano
      const x = e.data(), [cfg, p] = await Promise.all([ler(`escolas/${e.id}/config/geral`), ler(`escolas/${e.id}/config/plano`)]);
      const n = await alunosAtivos(e.id), sit = C.situacaoPlano(p, hoje), pr = C.precoPlano(n, (p || {}).ciclo, p, hoje);
      out.push({ eid: e.id, nome: x.nome || 'Escola', cidade: (cfg || {}).cidade || '', uf: (cfg || {}).uf || '', criadaEm: x.criadaEm || null, alunos: n, pix: !!(cfg || {}).mpConectadoEm,
        fase: sit.fase, venc: sit.venc || null, atraso: sit.atraso || 0, forma: (p || {}).forma || null, ciclo: (p || {}).ciclo || 'mensal', plano: pr.plano.nome, cheio: pr.cheio, valor: pr.valor,
        desconto: (p || {}).desconto || null, cortesiaAte: (p || {}).cortesiaAte || null, cortesiaMotivo: (p || {}).cortesiaMotivo || '', historico: ((p || {}).historico || []).slice(-6) });
    }
    return out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  const dataOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const codRef = c => db.doc(`servidor/cortesia/codigos/${c}`);
  const normCod = c => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
  const codOk = c => /^[A-Z0-9-]{3,30}$/.test(c);
  async function listaCodigos() {
    const s = await db.collection('servidor/cortesia/codigos').get();
    return s.docs.map(d => ({ codigo: d.id, ...d.data() })).sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
  }

  const plano = onRequest({ cors: true, maxInstances: 5, timeoutSeconds: 120 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const u = await P.usuario(req), b = req.body || {};
      // ---- painel do dono ----
      if (String(b.acao || '').startsWith('dono')) {
        await daEmpresa(u);
        if (b.acao === 'donoEscolas') return res.json({ escolas: await listaEscolas() });
        if (b.acao === 'donoCodigos') return res.json({ codigos: await listaCodigos() });
        if (b.acao === 'donoCriarCodigo') {
          const c = normCod(b.codigo), meses = Math.round(Number(b.meses)), limite = Math.round(Number(b.limite));
          if (!codOk(c)) return res.status(400).json({ erro: 'O código usa de 3 a 30 letras, números ou traço.' });
          if (!(meses >= 1 && meses <= 36)) return res.status(400).json({ erro: 'Escolha de 1 a 36 meses.' });
          if (!(limite >= 1 && limite <= 1000)) return res.status(400).json({ erro: 'Escolha de 1 a 1000 escolas.' });
          if ((await codRef(c).get()).exists) return res.status(409).json({ erro: 'Esse código já existe. Escolha outro.' });
          await codRef(c).set({ meses, limite, usos: 0, escolas: [], motivo: String(b.motivo || '').trim().slice(0, 200), ativo: true, criadoEm: Date.now(), por: u.email });
          return res.json({ codigos: await listaCodigos() });
        }
        if (b.acao === 'donoDesativarCodigo') {
          const c = normCod(b.codigo); if (!codOk(c) || !(await codRef(c).get()).exists) return res.status(404).json({ erro: 'Código não encontrado.' });
          await codRef(c).set({ ativo: false }, { merge: true });
          return res.json({ codigos: await listaCodigos() });
        }
        if (!idOk(b.eid) || !(await db.doc(`escolas/${b.eid}`).get()).exists) return res.status(404).json({ erro: 'Escola não encontrada.' });
        const p = await garantir(b.eid), hoje = hojeRecife(), motivo = String(b.motivo || '').trim().slice(0, 200), hist = (p.historico || []).slice(-30);
        const reg = txt => [...hist, { em: Date.now(), por: u.email, txt, motivo }];
        if (b.acao === 'donoCortesia') {
          const meses = Math.round(Number(b.meses));
          if (!(meses >= 1 && meses <= 36)) return res.status(400).json({ erro: 'Escolha de 1 a 36 meses.' });
          // soma a partir do que a escola já tem (teste, pago ou meses grátis anteriores), ou de hoje
          const base = [hoje, p.testeAte || '', p.pagoAte || '', p.cortesiaAte || ''].sort().pop(), ate = C.maisMeses(base, meses);
          await gravar(b.eid, { cortesiaAte: ate, cortesiaMotivo: motivo, historico: reg(`${meses} ${meses === 1 ? 'mês grátis' : 'meses grátis'}, até ${ate}`) });
        } else if (b.acao === 'donoTirarCortesia') {
          await gravar(b.eid, { cortesiaAte: null, cortesiaMotivo: '', historico: reg('Meses grátis cancelados') });
        } else if (b.acao === 'donoDesconto') {
          const ate = b.ate ? String(b.ate) : null; if (ate && (!dataOk(ate) || ate < hoje)) return res.status(400).json({ erro: 'A data final precisa ser hoje ou depois.' });
          let d;
          if (b.valor != null && b.valor !== '') { const v = Math.round(Number(String(b.valor).replace(',', '.')) * 100) / 100; if (!(v >= 0 && v < 10000)) return res.status(400).json({ erro: 'Valor inválido.' }); d = { valor: v }; }
          else { const pct = Math.round(Number(b.pct)); if (!(pct >= 1 && pct <= 100)) return res.status(400).json({ erro: 'O desconto vai de 1% a 100%.' }); d = { pct }; }
          d = { ...d, ate, motivo, em: Date.now() };
          await gravar(b.eid, { desconto: d, historico: reg(`Desconto: ${d.valor != null ? 'R$ ' + d.valor.toFixed(2).replace('.', ',') + ' por mês' : d.pct + '%'}${ate ? ' até ' + ate : ', sem prazo'}`) });
        } else if (b.acao === 'donoTirarDesconto') {
          await gravar(b.eid, { desconto: null, historico: reg('Desconto retirado') });
        } else return res.status(400).json({ erro: 'Pedido inválido.' });
        await sincronizar(b.eid).catch(() => { });
        return res.json({ escolas: await listaEscolas() });
      }
      // ---- administração da escola ----
      const eid = b.eid; if (!idOk(eid)) return res.status(400).json({ erro: 'Pedido inválido.' });
      const escola = await ler(`escolas/${eid}`);
      if (!escola || !(escola.admins || []).includes(u.uid)) return res.status(403).json({ erro: 'Só a administração da escola pode fazer isso.' });
      let p = await garantir(eid);
      // escola que já tinha plano antes da escolha manual: fica no menor que cabe os alunos de hoje
      if (!p.planoId) p = await gravar(eid, { planoId: C.planoPara(await alunosAtivos(eid)).id });
      if (b.acao === 'estado') { p = await sincronizar(eid, p); return res.json(await publico(eid, p)); }
      // código de cortesia: meses grátis sem precisar do cartão (um código por escola; o código tem limite de escolas)
      if (b.acao === 'codigo') {
        const c = normCod(b.codigo);
        if (!codOk(c)) return res.status(400).json({ erro: 'Confira o código.' });
        if (p.cortesiaCodigo) return res.status(409).json({ erro: 'Esta escola já usou um código de cortesia.' });
        let meses = 0, motivo = '';
        await db.runTransaction(async t => {
          const s = await t.get(codRef(c)), x = s.exists ? s.data() : null;
          if (!x || !x.ativo) throw erro('Código não encontrado. Confira as letras e os números.', 404);
          if ((x.escolas || []).some(e => e.eid === eid)) throw erro('Esta escola já usou este código.', 409);
          if ((x.usos || 0) >= x.limite) throw erro('Este código já foi usado por todas as escolas que ele permite.', 409);
          meses = x.meses; motivo = x.motivo || '';
          t.set(codRef(c), { usos: (x.usos || 0) + 1, escolas: [...(x.escolas || []), { eid, nome: escola.nome || 'Escola', em: Date.now() }] }, { merge: true });
        });
        const hoje = hojeRecife(), base = [hoje, p.testeAte || '', p.pagoAte || '', p.cortesiaAte || ''].sort().pop(), ate = C.maisMeses(base, meses);
        p = await gravar(eid, { cortesiaAte: ate, cortesiaMotivo: `Código ${c}${motivo ? ' · ' + motivo : ''}`, cortesiaCodigo: c, cartaoPedido: false,
          historico: [...(p.historico || []).slice(-30), { em: Date.now(), por: u.email, txt: `Código ${c}: ${meses} ${meses === 1 ? 'mês grátis' : 'meses grátis'}, até ${ate}` }] });
        await db.doc(`escolas/${eid}`).set({ cartaoPendente: false }, { merge: true });
        return res.json(await publico(eid, p));
      }
      // a escola escolhe o plano; o novo vale a partir da próxima cobrança. Só desce se os alunos ativos couberem.
      if (b.acao === 'escolher') {
        const pl = C.PLANOS.find(x => x.id === b.planoId); if (!pl) return res.status(400).json({ erro: 'Plano inválido.' });
        const n = await alunosAtivos(eid);
        if (!C.cabePlano(pl, n)) return res.status(409).json({ erro: `A escola tem ${n} alunos ativos e o ${pl.nome} vai até ${pl.ate}. Desative alunos ou escolha um plano maior.` });
        p = await gravar(eid, { planoId: pl.id, historico: [...(p.historico || []).slice(-30), { em: Date.now(), por: u.email, txt: `Escola mudou para o plano ${pl.nome}` }] });
        p = await sincronizar(eid, p);
        return res.json(await publico(eid, p));
      }
      if (b.acao === 'documento') {
        const doc = C.soDigitos(b.doc);
        if (!(doc.length === 11 ? C.cpfValido(doc) : doc.length === 14)) return res.status(400).json({ erro: 'Confira o CPF ou CNPJ.' });
        const tRef = db.doc(`servidor/testes/docs/${doc}`), t = (await tRef.get()).data(), outra = t && t.eid !== eid;
        if (!t) await tRef.set({ eid, em: Date.now() });
        const masc = doc.length === 11 ? `***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**` : `**.***.${doc.slice(5, 8)}/${doc.slice(8, 12)}-**`;
        await segRef(eid).set({ doc }, { merge: true });
        // o teste grátis é um por CPF/CNPJ: se já foi usado em outra escola, o teste desta termina hoje
        const mud = { doc: masc, ...(outra && (p.testeAte || '') > hojeRecife() ? { testeAte: hojeRecife(), testeUsado: true } : {}) };
        p = await gravar(eid, mud);
        return res.json({ ...(await publico(eid, p)), aviso: outra ? 'Este CPF/CNPJ já usou o teste grátis em outra escola. Para continuar, escolha como pagar.' : null });
      }
      if (b.acao === 'ciclo') { if (!['mensal', 'anual'].includes(b.ciclo)) return res.status(400).json({ erro: 'Pedido inválido.' }); p = await gravar(eid, { ciclo: b.ciclo }); await sincronizar(eid).catch(() => { }); return res.json(await publico(eid, p)); }
      const hoje = hojeRecife(), n = await alunosAtivos(eid), ciclo = b.ciclo === 'anual' ? 'anual' : 'mensal', pr = C.precoPlano(n, ciclo, p, hoje);
      if (b.acao === 'pix') {
        if (!(pr.valor > 0)) return res.status(409).json({ erro: 'O plano está sem custo agora.' });
        if (p.pix && p.pix.status === 'pending' && p.pix.valor === pr.valor && p.pix.ciclo === ciclo && p.pix.expira > Date.now() + 10 * 60e3) return res.json({ pix: p.pix });
        const tok = await tokenEmpresa(), expira = Date.now() + 24 * 3600e3;
        const r = await pedir(tok, 'POST', '/v1/payments', { transaction_amount: pr.valor, description: `Turma em Dia · Plano ${pr.plano.nome} ${ciclo === 'anual' ? '(1 ano)' : '(1 mês)'} · ${escola.nome || ''}`.slice(0, 120),
          payment_method_id: 'pix', payer: { email: u.email || `escola-${eid.slice(0, 8)}@turmaemdia.app` }, external_reference: `plano|${eid}|${ciclo}`,
          notification_url: `${BASE()}/planoWebhook?e=${encodeURIComponent(eid)}`, date_of_expiration: isoRecife(expira) }, `plano_${eid}_${Date.now()}`);
        if (!r.ok) { logger.error('plano pix', r.status, JSON.stringify(r.j)); return res.status(502).json({ erro: 'O Mercado Pago não gerou o Pix agora. Tente de novo.' }); }
        const td = (r.j.point_of_interaction || {}).transaction_data || {};
        const pix = { mpId: String(r.j.id), valor: pr.valor, ciclo, status: 'pending', qr: td.qr_code || '', qr64: td.qr_code_base64 || '', expira, em: Date.now() };
        await planoRef(eid).set({ pix }, { merge: true });
        return res.json({ pix });
      }
      if (b.acao === 'cartao') {
        const tok = await tokenEmpresa(), seg = (await segRef(eid).get()).data() || {};
        if (!b.token) return res.status(400).json({ erro: 'Confira os dados do cartão.' });
        if (seg.preId) await pedir(tok, 'PUT', `/preapproval/${seg.preId}`, { status: 'cancelled' }).catch(() => null);
        // a primeira cobrança é no vencimento (fim do teste, ou do que já está pago); se já venceu, agora
        const venc = [p.testeAte || '', p.pagoAte || '', p.cortesiaAte || ''].sort().pop(), inicio = venc > hoje ? Date.parse(venc + 'T13:00:00Z') : Date.now() + 5 * 60e3;
        const corpo = { reason: `Turma em Dia · ${escola.nome || 'Escola'}`.slice(0, 120), external_reference: `plano|${eid}`, payer_email: u.email, card_token_id: String(b.token), status: 'authorized',
          back_url: 'https://www.turmaemdia.com.br/app/', auto_recurring: { frequency: ciclo === 'anual' ? 12 : 1, frequency_type: 'months', start_date: new Date(inicio).toISOString(), transaction_amount: pr.valor > 0 ? pr.valor : pr.cheio, currency_id: 'BRL' } };
        const r = await pedir(tok, 'POST', '/preapproval', corpo);
        if (!r.ok || !r.j.id) { logger.error('plano cartão', r.status, JSON.stringify(r.j)); return res.status(402).json({ erro: /card|token|cvv|security/i.test(JSON.stringify(r.j)) ? 'O cartão não foi aceito. Confira os dados ou use outro cartão.' : 'O Mercado Pago não aceitou o cartão agora. Tente de novo ou use o Pix.' }); }
        await segRef(eid).set({ preId: String(r.j.id), cobradas: 0 }, { merge: true });
        await db.doc(`escolas/${eid}`).set({ cartaoPendente: false }, { merge: true }); // cadastro da escola completo
        p = await gravar(eid, { forma: 'cartao', ciclo, cartao: { marca: String(b.marca || 'Cartão').slice(0, 30), fim: String(b.fim || '').replace(/\D/g, '').slice(-4) }, pausadoGratis: false, proxCobranca: new Date(inicio - 3 * 3600e3).toISOString().slice(0, 10) });
        p = await sincronizar(eid, p);
        return res.json(await publico(eid, p));
      }
      if (b.acao === 'tirarCartao') {
        const seg = (await segRef(eid).get()).data() || {};
        if (seg.preId) { const tok = await tokenEmpresa(); await pedir(tok, 'PUT', `/preapproval/${seg.preId}`, { status: 'cancelled' }).catch(() => null); }
        await segRef(eid).set({ preId: null }, { merge: true });
        p = await gravar(eid, { forma: null, cartao: null, proxCobranca: null });
        return res.json(await publico(eid, p));
      }
      res.status(400).json({ erro: 'Pedido inválido.' });
    } catch (e) { logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.' }); }
  });

  // aviso do Mercado Pago sobre o Pix do plano
  const planoWebhook = onRequest({ maxInstances: 5 }, async (req, res) => {
    try {
      const eid = String(req.query.e || ''), id = String(req.query['data.id'] || (req.body && req.body.data && req.body.data.id) || (req.query.topic === 'payment' ? req.query.id : '') || '');
      if (!idOk(eid) || !/^\d+$/.test(id)) return res.status(200).send('ok');
      const tok = await tokenEmpresa(), r = await pedir(tok, 'GET', `/v1/payments/${id}`);
      if (!r.ok) return res.status(500).send('tente de novo');
      await pixPago(eid, r.j);
      res.status(200).send('ok');
    } catch (e) { logger.error(e); res.status(200).send('ok'); }
  });

  // rotina diária: confere cartões e Pix e atualiza o bloqueio de todas as escolas que já têm plano
  async function diario() {
    let n = 0;
    for (const e of (await db.collection('escolas').get()).docs) {
      if (e.data().encerradaEm) continue; // escola encerrada: não cobra mais o plano
      try {
        const p = await ler(`escolas/${e.id}/config/plano`); if (!p) continue; await sincronizar(e.id, p); n++;
        // os meses grátis do código acabaram e a escola não tem cartão: volta a pedir o cartão ao entrar
        if (p.cortesiaCodigo && !p.forma && !p.cartaoPedido && (p.cortesiaAte || '') < hojeRecife()) {
          await db.doc(`escolas/${e.id}`).set({ cartaoPendente: true }, { merge: true }); await planoRef(e.id).set({ cartaoPedido: true }, { merge: true });
        }
      } catch (x) { logger.warn('plano diário', e.id, x.message); }
    }
    return n;
  }

  // escola excluída/encerrada: cancela o cartão do plano no Mercado Pago (para de cobrar)
  async function cancelarCartao(eid) {
    const seg = (await segRef(eid).get()).data() || {};
    if (seg.preId) { const tok = await tokenEmpresa(); await pedir(tok, 'PUT', `/preapproval/${seg.preId}`, { status: 'cancelled' }).catch(() => null); }
    await segRef(eid).set({ preId: null }, { merge: true });
  }
  return { plano, planoWebhook, interno: { diario, sincronizar, garantir, tokenEmpresa, cancelarCartao } };
};

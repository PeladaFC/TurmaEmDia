/* Turma em Dia · boleto e cartão de crédito das famílias, pelo Mercado Pago da escola (ou do professor), com a taxa do app.
   - pagar {acao:'preparar'}: confere os itens e devolve o valor, a chave pública da conta que recebe e o cartão salvo.
   - pagar {acao:'cartao'}: o app manda só o "token" do cartão (o número vai direto do celular para o Mercado Pago,
     nunca passa pelo nosso servidor). Paga à vista ou parcelado; se a família quiser, guarda o cartão na conta
     do Mercado Pago de quem recebe, para a próxima vez pedir só o código de segurança.
   - pagar {acao:'boleto'}: gera o boleto (vence em 3 dias); a baixa vem pelo aviso do Mercado Pago (mpWebhook).
   - pagar {acao:'esquecer'}: apaga o cartão salvo. {acao:'automatico'}: liga/desliga a cobrança automática
     (só quando o Mercado Pago liberar "Pagamentos automáticos": servidor/mp.automatico = true).
   - cobrarAutomatico(hoje): na rotina diária, paga sozinho, no cartão salvo, o que venceu de quem ligou a cobrança automática. */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const C = require('./calculo');

// recusa do cartão, em português (status_detail do Mercado Pago)
const RECUSA = {
  cc_rejected_insufficient_amount: 'O cartão não tem limite para este valor.',
  cc_rejected_bad_filled_security_code: 'O código de segurança está errado.',
  cc_rejected_bad_filled_date: 'A validade do cartão está errada.',
  cc_rejected_bad_filled_card_number: 'Confira o número do cartão.',
  cc_rejected_bad_filled_other: 'Confira os dados do cartão.',
  cc_rejected_call_for_authorize: 'O banco pediu para autorizar este pagamento. Ligue para o banco do cartão e tente de novo.',
  cc_rejected_card_disabled: 'O cartão está bloqueado. Fale com o banco do cartão.',
  cc_rejected_duplicated_payment: 'Este pagamento já foi feito agora há pouco.',
  cc_rejected_max_attempts: 'Muitas tentativas com este cartão. Tente outro cartão ou o Pix.',
  cc_rejected_high_risk: 'O Mercado Pago recusou por segurança. Tente outro cartão ou o Pix.',
  cc_rejected_blacklist: 'O Mercado Pago recusou por segurança. Tente outro cartão ou o Pix.',
  cc_rejected_card_error: 'O cartão não foi aceito. Tente outro cartão ou o Pix.'
};
const recusa = d => RECUSA[d] || 'O cartão foi recusado. Tente outro cartão ou o Pix.';

module.exports = (db, P) => {
  const { ler, erro, idOk, plataforma, contaMP, meusVinculos, itensPedidos, lotesDe, aprovado, pausada, PAUSA, motivoMP, BASE, MP, isoRecife, hojeRecife } = P;
  const mpPedir = async (token, metodo, caminho, corpo, idem) => {
    const r = await fetch(MP + caminho, { method: metodo, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(idem ? { 'X-Idempotency-Key': idem } : {}) }, ...(corpo ? { body: JSON.stringify(corpo) } : {}) });
    const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j };
  };
  const cartaoRef = (eid, uid, rec) => db.doc(`escolas/${eid}/cartoes/${uid.slice(0, 40)}_${rec}`);

  // itens, recebedor e conta, conferidos de novo (nunca confia no app)
  async function preparar(u, eid, chaves, forma) {
    if (!idOk(eid) || !Array.isArray(chaves) || !chaves.length || chaves.length > 80 || !chaves.every(k => typeof k === 'string' && k.length < 140)) throw erro('Pedido inválido.', 400);
    const escola = await ler(`escolas/${eid}`); if (!escola) throw erro('Escola não encontrada.', 404);
    if (await pausada(eid)) throw Object.assign(erro(PAUSA, 423), { codigo: 'pausada' });
    const adm = (escola.admins || []).includes(u.uid), meus = adm ? null : await meusVinculos(eid, u.uid);
    const { cfg, itens, rids, extras } = await itensPedidos(eid, chaves, rid => adm || (rid && meus.has(rid)));
    if (!itens.length) throw erro('Esses itens já foram pagos ou não estão mais em aberto.', 409);
    const f = cfg.formas || {};
    if (forma === 'boleto' && f.boleto !== true) throw erro('A escola não aceita boleto.', 403);
    if (forma === 'cartao' && f.cartao !== true) throw erro('A escola não aceita cartão.', 403);
    const lotes = lotesDe(itens, cfg, extras);
    if (lotes.length > 1) throw erro('Essas cobranças vão para contas diferentes. No cartão ou no boleto, pague as de um recebedor por vez (ou use o Pix).', 409);
    const L = lotes[0], conta = await contaMP(eid, L.rec);
    if (!conta || !conta.token) throw erro('Quem recebe ainda não ligou o Mercado Pago no app. Fale com a escola.', 412);
    const P_ = await plataforma(), com = conta.via === 'oauth' ? P_.comissao : 0;
    const { valor, fee } = C.valorForma(L.base, forma, cfg, com, L.baseRep);
    return { escola, cfg, L, conta, valor, fee, rids, f, plat: P_ };
  }
  const maxParc = f => f.parcelado === true ? Math.max(1, Math.min(12, Number(f.maxParcelas) || 1)) : 1;
  const descDe = (escola, L) => `${escola.nome || 'Escola'} · ${[...new Set(L.itens.map(i => i.nome))].join(', ')}`.slice(0, 120);

  // outro Pix ou boleto ainda aberto, desta pessoa, com algum dos mesmos itens: cancela, para ninguém pagar duas vezes
  async function cancelarOutros(eid, uid, L, conta, exceto) {
    const ks = new Set(L.itens.map(i => i.k));
    const outros = await db.collection(`escolas/${eid}/cobrancas`).where('uid', '==', uid).where('status', '==', 'pending').get();
    for (const o of outros.docs) {
      const c = o.data(); if (o.id === exceto || (c.rec || 'escola') !== L.rec || !(c.itens || []).some(i => ks.has(i.k))) continue;
      const rc = await mpPedir(conta.token, 'PUT', `/v1/payments/${c.mpId}`, { status: 'cancelled' }).catch(() => null);
      if (rc && rc.ok) await o.ref.set({ status: 'cancelled', atualizadoEm: Date.now() }, { merge: true });
    }
  }

  // cliente da família na conta do Mercado Pago de quem recebe (para guardar o cartão)
  async function cliente(conta, u) {
    const email = u.email || `responsavel-${u.uid.slice(0, 8)}@turmaemdia.app`;
    const b = await mpPedir(conta.token, 'GET', `/v1/customers/search?email=${encodeURIComponent(email)}`);
    const achou = b.ok && (b.j.results || [])[0]; if (achou) return achou.id;
    const c = await mpPedir(conta.token, 'POST', '/v1/customers', { email, first_name: String(u.name || '').split(' ')[0] || undefined });
    if (!c.ok || !c.j.id) throw new Error('cliente ' + c.status);
    return c.j.id;
  }
  async function guardarCartao(eid, u, rec, conta, token) {
    const cid = await cliente(conta, u);
    const r = await mpPedir(conta.token, 'POST', `/v1/customers/${cid}/cards`, { token });
    if (!r.ok || !r.j.id) throw new Error('cartão ' + r.status);
    const ant = (await cartaoRef(eid, u.uid, rec).get()).data();
    if (ant && ant.cardId && ant.cardId !== String(r.j.id)) await mpPedir(conta.token, 'DELETE', `/v1/customers/${ant.cid}/cards/${ant.cardId}`).catch(() => null);
    const pm = r.j.payment_method || {};
    const d = { uid: u.uid, rec, cid: String(cid), cardId: String(r.j.id), metodo: pm.id || null, bin: r.j.first_six_digits || null, marca: pm.name || pm.id || 'Cartão', fim: r.j.last_four_digits || '', validade: r.j.expiration_month && r.j.expiration_year ? `${String(r.j.expiration_month).padStart(2, '0')}/${String(r.j.expiration_year).slice(-2)}` : '', auto: !!(ant && ant.auto), em: Date.now() };
    await cartaoRef(eid, u.uid, rec).set(d);
    return d;
  }
  const cartaoPublico = d => d ? { rec: d.rec, cardId: d.cardId, metodo: d.metodo, bin: d.bin || null, marca: d.marca, fim: d.fim, validade: d.validade, auto: !!d.auto } : null;

  // cobra no cartão; registra a cobrança e, se aprovado, dá baixa na hora
  async function cobrarCartao(eid, u, prep, b) {
    const { escola, L, conta, valor, fee, rids, f } = prep;
    const parcelas = Math.max(1, Math.min(maxParc(f), parseInt(b.parcelas, 10) || 1));
    const chave = `${u.uid.slice(0, 20)}_${L.rec}_c${C.chaveItens(L.itens.map(i => i.k))}_${Date.now().toString(36)}`;
    const salvo = b.cardId ? (await cartaoRef(eid, u.uid, L.rec).get()).data() : null;
    if (b.cardId && !(salvo && salvo.cardId === String(b.cardId))) throw erro('Esse cartão não está mais salvo. Digite o cartão de novo.', 409);
    const doc = C.soDigitos(b.doc);
    const corpo = {
      transaction_amount: valor, token: String(b.token || ''), description: descDe(escola, L), installments: parcelas,
      payment_method_id: String((salvo && salvo.metodo) || b.metodo || ''), ...(b.emissor ? { issuer_id: String(b.emissor) } : {}),
      payer: salvo ? { type: 'customer', id: salvo.cid } : { email: u.email || `responsavel-${u.uid.slice(0, 8)}@turmaemdia.app`, ...(doc.length === 11 || doc.length === 14 ? { identification: { type: doc.length === 11 ? 'CPF' : 'CNPJ', number: doc } } : {}) },
      external_reference: `${eid}|${chave}`, notification_url: `${BASE()}/mpWebhook?e=${encodeURIComponent(eid)}&r=${encodeURIComponent(L.rec)}`,
      binary_mode: true, statement_descriptor: String(escola.nome || 'TURMA EM DIA').normalize('NFD').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 13).toUpperCase() || 'TURMA EM DIA',
      ...(fee > 0 ? { application_fee: fee } : {})
    };
    if (!corpo.token || !corpo.payment_method_id) throw erro('Confira os dados do cartão.', 400);
    const cobRef = db.doc(`escolas/${eid}/cobrancas/${chave}`);
    const r = await mpPedir(conta.token, 'POST', '/v1/payments', corpo, `${eid}_${chave}`);
    if (!r.ok) { logger.error('mp cartão', L.rec, r.status, JSON.stringify(r.j)); throw erro(motivoMP(r.status, r.j, 'quem recebe').replace('deste Pix', 'deste pagamento'), 502); }
    const p = r.j;
    const dado = { mpId: String(p.id), rec: L.rec, forma: 'cartao', parcelas, valor, base: L.base, fee, status: p.status || 'rejected', detalhe: p.status_detail || null,
      fim: (p.card || {}).last_four_digits || (salvo && salvo.fim) || null, criadoEm: Date.now(), uid: u.uid, rids, desc: corpo.description, itens: L.itens, ...(b.auto ? { auto: true } : {}) };
    await cobRef.set(dado);
    if (p.status === 'approved') {
      await cobRef.set({ pagoEm: Date.parse(p.date_approved || '') || Date.now() }, { merge: true });
      await aprovado(eid, chave, { ...dado, status: 'pending' }, p);
      await cancelarOutros(eid, u.uid, L, conta, chave).catch(() => { });
    }
    return { chave, p, dado };
  }

  const pagar = onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const u = await P.usuario(req), b = req.body || {}, eid = b.eid;
      if (b.acao === 'esquecer' || b.acao === 'automatico') {
        const rec = b.rec || 'escola'; if (!idOk(eid) || !idOk(rec)) return res.status(400).json({ erro: 'Pedido inválido.' });
        const ref = cartaoRef(eid, u.uid, rec), d = (await ref.get()).data(); if (!d) return res.status(404).json({ erro: 'Nenhum cartão salvo.' });
        if (b.acao === 'automatico') {
          const plat = (await ler('servidor/mp')) || {}, cfg = (await ler(`escolas/${eid}/config/geral`)) || {};
          if (b.ligar && !(plat.automatico === true && (cfg.formas || {}).recorrente === true)) return res.status(412).json({ erro: 'A cobrança automática ainda não está disponível nesta escola.' });
          await ref.set({ auto: !!b.ligar, autoEm: Date.now() }, { merge: true });
          return res.json({ cartao: cartaoPublico({ ...d, auto: !!b.ligar }) });
        }
        const conta = await contaMP(eid, rec);
        if (conta && conta.token) await mpPedir(conta.token, 'DELETE', `/v1/customers/${d.cid}/cards/${d.cardId}`).catch(() => null);
        await ref.delete(); return res.json({ ok: true });
      }
      if (b.acao === 'cartoes') {
        if (!idOk(eid)) return res.status(400).json({ erro: 'Pedido inválido.' });
        const s = await db.collection(`escolas/${eid}/cartoes`).where('uid', '==', u.uid).get();
        return res.json({ cartoes: s.docs.map(d => cartaoPublico(d.data())) });
      }
      const forma = b.acao === 'boleto' ? 'boleto' : 'cartao';
      const prep = await preparar(u, eid, b.itens, forma);
      const { L, conta, valor, f, cfg } = prep;
      if (b.acao === 'preparar') {
        if (forma === 'cartao' && !conta.publicKey) return res.status(412).json({ erro: 'Para aceitar cartão, a escola precisa conectar o Mercado Pago de novo (Ajustes → Mercado Pago). Por enquanto, use o Pix.', codigo: 'reconectar' });
        const salvo = (await cartaoRef(eid, u.uid, L.rec).get()).data();
        const plat = (await ler('servidor/mp')) || {};
        return res.json({ rec: L.rec, base: L.base, valor, publicKey: conta.publicKey || null, maxParcelas: maxParc(f), jurosEscola: f.jurosEscola === true,
          cartao: cartaoPublico(salvo), automatico: plat.automatico === true && f.recorrente === true });
      }
      if (b.acao === 'cartao') {
        const { chave, p, dado } = await cobrarCartao(eid, u, prep, b);
        let cartao = null;
        if (p.status === 'approved' && b.salvar && b.token2) { try { cartao = cartaoPublico(await guardarCartao(eid, u, L.rec, conta, String(b.token2))); } catch (e) { logger.warn('guardar cartão', e.message); } }
        if (p.status === 'approved' && cartao && b.auto === true) {
          const plat = (await ler('servidor/mp')) || {};
          if (plat.automatico === true && f.recorrente === true) { await cartaoRef(eid, u.uid, L.rec).set({ auto: true, autoEm: Date.now() }, { merge: true }); cartao.auto = true; }
        }
        if (p.status !== 'approved') return res.status(402).json({ erro: recusa(p.status_detail), chave });
        return res.json({ ok: true, chave, valor: dado.valor, parcelas: dado.parcelas, cartao });
      }
      if (b.acao === 'boleto') {
        const x = b.pagador || {}, cpf = C.soDigitos(x.cpf), cep = C.soDigitos(x.cep), nome = String(x.nome || '').trim().replace(/\s+/g, ' ');
        if (!C.cpfValido(cpf)) return res.status(400).json({ erro: 'O CPF de quem paga não está certo.' });
        if (nome.split(' ').length < 2) return res.status(400).json({ erro: 'Escreva o nome completo de quem paga.' });
        if (cep.length !== 8 || !x.rua || !x.numero || !x.bairro || !x.cidade || !/^[A-Z]{2}$/.test(String(x.uf || ''))) return res.status(400).json({ erro: 'Preencha o endereço completo, com CEP.' });
        const chave = `${u.uid.slice(0, 20)}_${L.rec}_b${C.chaveItens(L.itens.map(i => i.k))}`, cobRef = db.doc(`escolas/${eid}/cobrancas/${chave}`);
        const ant = (await cobRef.get()).data();
        if (ant && ant.status === 'pending' && ant.valor === valor && ant.expira > Date.now() + 864e5) return res.json({ boleto: { ...ant, chave } });
        const expira = Date.now() + 3 * 864e5, [prim, ...resto] = nome.split(' ');
        const corpo = { transaction_amount: valor, description: descDe(prep.escola, L), payment_method_id: 'bolbradesco', date_of_expiration: isoRecife(expira),
          payer: { email: u.email || `responsavel-${u.uid.slice(0, 8)}@turmaemdia.app`, first_name: prim, last_name: resto.join(' '), identification: { type: 'CPF', number: cpf },
            address: { zip_code: cep, street_name: String(x.rua).slice(0, 80), street_number: String(x.numero).slice(0, 10), neighborhood: String(x.bairro).slice(0, 60), city: String(x.cidade).slice(0, 60), federal_unit: x.uf } },
          external_reference: `${eid}|${chave}`, notification_url: `${BASE()}/mpWebhook?e=${encodeURIComponent(eid)}&r=${encodeURIComponent(L.rec)}`, ...(prep.fee > 0 ? { application_fee: prep.fee } : {}) };
        const r = await mpPedir(conta.token, 'POST', '/v1/payments', corpo, `${eid}_${chave}_${Date.now()}`);
        if (!r.ok) { logger.error('mp boleto', L.rec, r.status, JSON.stringify(r.j)); return res.status(502).json({ erro: 'O Mercado Pago não gerou o boleto agora. Confira o endereço e tente de novo, ou use o Pix.' }); }
        const td = r.j.transaction_details || {}, dado = { mpId: String(r.j.id), rec: L.rec, forma: 'boleto', valor, base: L.base, fee: prep.fee, status: r.j.status || 'pending',
          linha: td.digitable_line || (r.j.barcode || {}).content || '', link: td.external_resource_url || '', criadoEm: Date.now(), expira, uid: u.uid, rids: prep.rids, desc: corpo.description, itens: L.itens };
        await cobRef.set(dado);
        return res.json({ boleto: { ...dado, chave } });
      }
      res.status(400).json({ erro: 'Pedido inválido.' });
    } catch (e) { logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.', ...(e.codigo ? { codigo: e.codigo } : {}) }); }
  });

  /* Cobrança automática (rotina diária): só com servidor/mp.automatico = true (liberação do Mercado Pago).
     Para cada cartão com "auto" ligado: junta o que venceu (até 10 dias) e ainda está em aberto para esse recebedor
     e cobra no cartão salvo. Tenta cada conjunto uma vez por dia, no máximo 3 vezes. */
  async function cobrarAutomatico(hoje = hojeRecife()) {
    const plat = (await ler('servidor/mp')) || {}; if (plat.automatico !== true) return { feitos: 0 };
    let feitos = 0;
    for (const e of (await db.collection('escolas').get()).docs) {
      if (e.data().encerradaEm) continue;
      const eid = e.id, cfg = (await ler(`escolas/${eid}/config/geral`)) || {};
      if (!((cfg.formas || {}).recorrente === true && (cfg.formas || {}).cartao === true) || await pausada(eid)) continue;
      const cards = await db.collection(`escolas/${eid}/cartoes`).where('auto', '==', true).get();
      for (const cd of cards.docs) {
        const d = cd.data();
        try {
          const rids = [...await meusVinculos(eid, d.uid)]; if (!rids.length) continue;
          const chaves = [], mapa = P.mapa;
          const [turmas, extras, grupos, acordos] = await Promise.all([mapa(`escolas/${eid}/turmas`), mapa(`escolas/${eid}/extras`), mapa(`escolas/${eid}/grupos`), mapa(`escolas/${eid}/acordos`)]);
          for (const rid of rids) {
            const alunas = Object.fromEntries((await db.collection(`escolas/${eid}/alunas`).where('responsavelId', '==', rid).get()).docs.map(x => [x.id, x.data()]));
            for (const alid of Object.keys(alunas)) {
              const pag = (await ler(`escolas/${eid}/pagamentos/${alid}`)) || {};
              for (const i of C.itensComEncargos({ alunas, turmas, extras, grupos, acordos, pag, cfg }, alid, hoje)) {
                const recs = Object.keys(i.partes || { escola: 1 });
                if (!i.pago && i.v > 0 && i.venc && i.venc <= hoje && C.difDias(i.venc, hoje) <= 10 && recs.length === 1 && recs[0] === d.rec) chaves.push(i.k);
              }
            }
          }
          if (!chaves.length) continue;
          const marca = `${hoje}_${C.chaveItens(chaves)}`, tent = d.tentativas || {};
          if (tent[marca] || Object.keys(tent).filter(k => k.endsWith(C.chaveItens(chaves))).length >= 3) continue;
          await cd.ref.set({ tentativas: { ...tent, [marca]: Date.now() } }, { merge: true });
          const u = { uid: d.uid, email: null, name: '' };
          const prep = await preparar(u, eid, chaves, 'cartao').catch(() => null); if (!prep || prep.L.rec !== d.rec) continue;
          const t = await mpPedir(prep.conta.token, 'POST', '/v1/card_tokens', { card_id: d.cardId, customer_id: d.cid });
          if (!t.ok || !t.j.id) { logger.warn('auto token', eid, t.status, JSON.stringify(t.j).slice(0, 200)); continue; }
          const { p } = await cobrarCartao(eid, u, prep, { token: t.j.id, cardId: d.cardId, parcelas: 1, auto: true });
          await cd.ref.set({ ultimo: { em: Date.now(), status: p.status, detalhe: p.status_detail || null } }, { merge: true });
          if (p.status === 'approved') feitos++;
        } catch (x) { logger.warn('auto', eid, x.message); }
      }
    }
    return { feitos };
  }

  return { pagar, interno: { cobrarAutomatico, recusa } };
};

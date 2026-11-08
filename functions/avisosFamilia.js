/* Turma em Dia · avisos automáticos no celular das famílias (notificação push), todo dia às 10h (rotinaDiaria).
   No máximo 1 aviso por dia para cada família, juntando tudo numa mensagem só.
   - Mensalidades, taxas e parcelas de acordo: 3 dias antes do vencimento, no dia, e depois de vencido
     no dia seguinte e mais 3 vezes, de 7 em 7 dias (dias 1, 8, 15 e 22 depois do vencimento). Depois disso, para.
     Quem tem acordo ativo não recebe aviso de atraso das cobranças antigas (só das parcelas do acordo).
   - Pendências do cadastro (termo, atestado, documentos, contrato): 1 vez por semana, até 4 semanas.
   - Eventos: no dia seguinte ao que a escola criou e 1 dia antes do prazo de resposta, para quem ainda não respondeu.
   A escola desliga tudo em Ajustes (config/geral.pushFamilias = false).
   O aparelho da família fica em escolas/{eid}/membros/{uid}.push (o servidor grava, pela ação familiaPush). */
'use strict';
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const C = require('./calculo');

const DIA = 864e5, ANO = 365 * DIA;
const TIPOS_DOC_PADRAO = [{ id: 'cardio', nome: 'Parecer cardiológico' }, { id: 'ident', nome: 'Documento de identidade' }];
const SAUDE = ['coracao', 'esforco', 'desmaio', 'doenca', 'ossos', 'outro'];
const somaDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DIA).toISOString().slice(0, 10);
const dias = (de, ate) => Math.round((Date.parse(ate + 'T12:00:00Z') - Date.parse(de + 'T12:00:00Z')) / DIA);
const brl = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const primeiro = n => String(n || '').trim().split(/\s+/)[0] || 'seu filho';
const APOS_VENC = [1, 8, 15, 22];

// mesmo critério do app (situacaoAtestado)
function atestadoFalta(t, agora) {
  const sim = SAUDE.some(k => (t.respostas || {})[k]), at = t.atestado || {}, novo = x => x && agora - x < ANO;
  if (novo(at.recebidoEm) && (!at.enviadoEm || at.recebidoEm >= at.enviadoEm)) return false;
  if (novo(at.enviadoEm) && !(at.recusa && at.recusa.em > at.enviadoEm)) return false;
  return !!(sim || at.pedidoEm);
}

module.exports = (db, enviar) => {
  enviar = enviar || (async (tokens, msg) => {
    const r = await admin.messaging().sendEachForMulticast({ tokens, ...msg });
    return r.responses.map(x => ({ ok: x.success, codigo: x.error && x.error.code }));
  });
  const ler = async p => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
  const col = async p => Object.fromEntries((await db.collection(p).get()).docs.map(d => [d.id, d.data()]));

  // o que avisar hoje para uma família (lista de frases; a primeira vai em destaque)
  function frasesPagamento(d, alunas, hoje) {
    const out = [], ate = somaDias(hoje, 3);
    for (const [alid, a] of Object.entries(alunas)) {
      const acordo = Object.values(d.acordos).some(A => A && A.alid === alid && !A.cancelado && !A.perdao);
      // "hoje" + 3 dias: entra a mensalidade do mês seguinte quando ela vence nos primeiros dias
      for (const i of C.itensAluna({ ...d, alunas: d.alunas, pag: d.pags[alid] || {} }, alid, ate)) {
        if (i.pago || !(i.v > 0) || !i.venc) continue;
        const n = dias(hoje, i.venc), nome = primeiro(a.nome);
        if (n === 3) out.push({ ord: 2, t: `${i.desc} de ${nome} vence em 3 dias (${brl(i.v)}).` });
        else if (n === 0) out.push({ ord: 1, t: `${i.desc} de ${nome} vence hoje (${brl(i.v)}).` });
        else if (n < 0 && APOS_VENC.includes(-n) && !(acordo && i.tipo !== 'a')) out.push({ ord: 0, t: `${i.desc} de ${nome} está vencida desde ${dm(i.venc)}.` });
      }
    }
    return out;
  }
  async function pendencias(eid, d, alunas, hoje, agora) {
    const out = [], tipos = Array.isArray(d.cfg.tiposDoc) ? d.cfg.tiposDoc : TIPOS_DOC_PADRAO, ct = d.contrato || {};
    for (const [alid, a] of Object.entries(alunas)) {
      const f = [], t = (await ler(`escolas/${eid}/saude/${alid}`)) || {};
      if (!t.em) f.push('termo de matrícula'); else if (agora - t.em > ANO) f.push('renovar o termo de matrícula');
      if (t.em && atestadoFalta(t, agora)) f.push('atestado médico');
      const docs = ((await ler(`escolas/${eid}/docsAlunos/${alid}`)) || {}).docs || {};
      for (const T of tipos) { const m = docs[T.id]; if (!m || (m.validade && m.validade < hoje)) f.push(String(T.nome || 'documento').toLowerCase()); }
      if (ct.ativo && ct.texto && !(await db.doc(`escolas/${eid}/contratos/${alid}_v${ct.versao || 1}`).get()).exists) f.push('assinar o contrato');
      if (f.length) out.push(`${primeiro(a.nome)}: ${f.join(', ')}`);
    }
    return out;
  }
  function frasesEventos(d, alunas, hoje, agora) {
    const out = [], amanha = somaDias(hoje, 1);
    for (const [xid, x] of Object.entries(d.extras)) {
      if (!x || !(x.tipo === 'evento' || x.tipo === 'competicao') || C.prazoPassou(x, agora)) continue;
      const fim = x.dataFim && x.dataFim >= x.data ? x.dataFim : x.data; if (fim && fim < hoje) continue;
      const quem = Object.keys(alunas).filter(id => (x.convidados || []).includes(id) && !((x.part || {})[id] || {}).st);
      if (!quem.length) continue;
      const nomes = quem.map(id => primeiro(alunas[id].nome)).join(' e '), criado = d.criados[xid] || 0;
      if (criado > agora - DIA) out.push({ ord: 3, t: `Novo evento: ${x.nome || 'evento'}. ${nomes} vai? Responda no app.` });
      else if (x.prazo === amanha) out.push({ ord: 1, t: `Responda até amanhã: ${x.nome || 'evento'}. ${nomes} vai?` });
    }
    return out;
  }

  async function escola(eid, e, hoje, agora) {
    const cfg = (await ler(`escolas/${eid}/config/geral`)) || {};
    if (cfg.pushFamilias === false) return 0;
    const ms = (await db.collection(`escolas/${eid}/membros`).where('push', '!=', null).get()).docs.filter(m => (m.data().push || []).length && m.data().pushDia !== hoje);
    if (!ms.length) return 0;
    const extrasQ = await db.collection(`escolas/${eid}/extras`).get();
    const d = { cfg, turmas: await col(`escolas/${eid}/turmas`), grupos: await col(`escolas/${eid}/grupos`), extras: {}, criados: {}, acordos: {}, pags: {}, alunas: {}, contrato: (await ler(`escolas/${eid}/config/contrato`)) || {} };
    extrasQ.docs.forEach(x => { d.extras[x.id] = x.data(); d.criados[x.id] = x.createTime ? x.createTime.toMillis() : 0; });
    const mes = hoje.slice(0, 7);
    let enviados = 0;
    for (const m of ms) {
      const rids = (await db.collection(`escolas/${eid}/membros/${m.id}/vinculos`).get()).docs.map(v => v.id);
      if (!rids.length) continue;
      const alunas = {};
      for (let i = 0; i < rids.length; i += 30) (await db.collection(`escolas/${eid}/alunas`).where('responsavelId', 'in', rids.slice(i, i + 30)).get()).docs.forEach(x => { alunas[x.id] = x.data(); });
      for (const [id, a] of Object.entries(alunas)) if (!a || a.anonimizadoEm || !C.ativaNoMes(a, mes)) delete alunas[id];
      if (!Object.keys(alunas).length) continue;
      Object.assign(d.alunas, alunas);
      for (const id of Object.keys(alunas)) if (!d.pags[id]) d.pags[id] = (await ler(`escolas/${eid}/pagamentos/${id}`)) || {};
      for (let i = 0; i < rids.length; i += 30) (await db.collection(`escolas/${eid}/acordos`).where('rid', 'in', rids.slice(i, i + 30)).get()).docs.forEach(x => { d.acordos[x.id] = x.data(); });
      const frases = [...frasesPagamento(d, alunas, hoje), ...frasesEventos(d, alunas, hoje, agora)];
      // pendências do cadastro: 1 vez por semana, até 4 semanas (volta a contar quando tudo fica em dia)
      const md = m.data(), pend = await pendencias(eid, d, alunas, hoje, agora), pp = md.pushPend || null, up = {};
      if (!pend.length) { if (pp) up.pushPend = FieldValue.delete(); }
      else if (!pp || (pp.n < 4 && dias(pp.ult, hoje) >= 7)) { frases.push({ ord: 4, t: `Falta no cadastro de ${pend.join('; ')}. Resolva pelo app.` }); up.pushPend = { n: (pp ? pp.n : 0) + 1, ult: hoje }; }
      if (!frases.length) { if (Object.keys(up).length) await m.ref.update(up); continue; }
      frases.sort((x, y) => x.ord - y.ord);
      const corpo = frases.length === 1 ? frases[0].t : `${frases[0].t} E mais ${frases.length - 1} aviso${frases.length === 2 ? '' : 's'} no app.`;
      const titulo = e.nome || 'Turma em Dia', tokens = md.push;
      const msg = { notification: { title: titulo, body: corpo }, data: { titulo, corpo, url: './' },
        android: { notification: { sound: 'default' } }, apns: { payload: { aps: { sound: 'default' } } }, webpush: { headers: { TTL: '43200' } } };
      const r = await enviar(tokens, msg), mortos = tokens.filter((tk, i) => !r[i].ok && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r[i].codigo || ''));
      if (r.some(x => x.ok)) enviados++;
      await m.ref.update({ ...up, pushDia: hoje, ...(mortos.length ? { push: FieldValue.arrayRemove(...mortos) } : {}) });
    }
    return enviados;
  }

  async function diario(hoje, agora = Date.now()) {
    let total = 0;
    for (const e of (await db.collection('escolas').get()).docs) {
      try { total += await escola(e.id, e.data(), hoje, agora); } catch (er) { require('firebase-functions/logger').error('avisos famílias', e.id, er.message); }
    }
    return { enviados: total };
  }
  return { interno: { diario, frasesPagamento, frasesEventos, atestadoFalta } };
};

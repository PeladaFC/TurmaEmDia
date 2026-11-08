/* Turma em Dia · avisos automáticos no celular das famílias (notificação push), todo dia às 10h (rotinaDiaria).
   Cada cobrança vai num aviso próprio, que abre direto o pagamento dela. Cada pergunta (evento, competição,
   taxa dividida) vai num aviso com os botões "Vai" / "Não vai" (respondem sem abrir o app: respostaPush).
   - Mensalidades, taxas e parcelas de acordo: 3 dias antes do vencimento, no dia, e depois de vencido
     no dia seguinte e mais 3 vezes, de 7 em 7 dias (dias 1, 8, 15 e 22 depois do vencimento). Depois disso, para.
     Quem tem acordo ativo não recebe aviso de atraso das cobranças antigas (só das parcelas do acordo).
   - Pendências do cadastro (termo, atestado, documentos, contrato): 1 vez por semana, até 4 semanas.
   - Eventos e taxas divididas: na hora em que a escola cria (novoExtra) e 1 dia antes do prazo, para quem ainda não respondeu.
   - Taxa nova (uniforme, festa...): na hora em que a escola cria, um aviso que abre o pagamento.
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
  const LP = require('./linkPush')(db);
  const API = () => `https://southamerica-east1-${process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'turma-em-dia-57c1e'}.cloudfunctions.net/respostaPush`;
  const col = async p => Object.fromEntries((await db.collection(p).get()).docs.map(d => [d.id, d.data()]));

  // cobranças: um aviso para cada uma, que abre direto o pagamento dela
  function avisosPagamento(eid, d, alunas, hoje) {
    const out = [], ate = somaDias(hoje, 3);
    for (const [alid, a] of Object.entries(alunas)) {
      const acordo = Object.values(d.acordos).some(A => A && A.alid === alid && !A.cancelado && !A.perdao);
      // "hoje" + 3 dias: entra a mensalidade do mês seguinte quando ela vence nos primeiros dias
      for (const i of C.itensAluna({ ...d, alunas: d.alunas, pag: d.pags[alid] || {} }, alid, ate)) {
        if (i.pago || !(i.v > 0) || !i.venc) continue;
        const n = dias(hoje, i.venc), nome = primeiro(a.nome);
        let t = null;
        if (n === 3) t = `${i.desc} de ${nome} vence em 3 dias: ${brl(i.v)}.`;
        else if (n === 0) t = `${i.desc} de ${nome} vence hoje: ${brl(i.v)}.`;
        else if (n < 0 && APOS_VENC.includes(-n) && !(acordo && i.tipo !== 'a')) t = `${i.desc} de ${nome} está vencida desde ${dm(i.venc)}.`;
        if (t) out.push({ corpo: `${t} Toque para pagar.`, url: `./?pagar=${eid}~${encodeURIComponent(i.k)}`, acoes: [{ a: 'pagar', t: 'Pagar com Pix' }] });
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
  // perguntas (evento, competição, taxa dividida): um aviso por aluno, com "Vai" / "Não vai" no próprio aviso
  async function avisosPerguntas(eid, uid, d, alunas, hoje, agora, soXid) {
    const out = [], amanha = somaDias(hoje, 1), dataR = ms => new Date(ms - 3 * 36e5).toISOString().slice(0, 10);
    for (const [xid, x] of Object.entries(d.extras)) {
      if (!x || (soXid && xid !== soXid)) continue;
      const ev = x.tipo === 'evento' || x.tipo === 'competicao', rt = x.tipo === 'taxa' && !!x.rateio;
      if (!ev && !rt) continue;
      if (ev) { if (C.prazoPassou(x, agora)) continue; const fim = x.dataFim && x.dataFim >= x.data ? x.dataFim : x.data; if (fim && fim < hoje) continue; }
      if (rt && C.rateioFechado(x, agora)) continue;
      const novo = !!soXid, vespera = ev ? x.prazo === amanha : !!(x.rateio.prazoEm && dataR(x.rateio.prazoEm) === amanha);
      if (!novo && !vespera) continue;
      // botões só onde a família responde pelo app (no evento com inscrição feita fora, ela confirma no app)
      const botoes = rt || x.semCobranca || x.cobranca === 'app';
      for (const id of Object.keys(alunas).filter(id => (x.convidados || []).includes(id) && !((x.part || {})[id] || {}).st)) {
        const nome = primeiro(alunas[id].nome), nomeX = x.nome || (rt ? 'taxa' : 'evento');
        const per = rt ? `${nomeX}: ${nome} vai participar?` : `${nomeX}${x.data ? ` (${dm(x.data)})` : ''}. ${nome} vai?`;
        const corpo = `${novo ? (rt ? 'Nova taxa dividida' : x.tipo === 'competicao' ? 'Nova competição' : 'Novo evento') : 'Responda até amanhã'}: ${per}`;
        const r = botoes ? await LP.assinar({ u: uid, e: eid, x: xid, a: id, exp: agora + 7 * DIA }) : null;
        out.push({ corpo, url: `./?evento=${eid}~${xid}`, ...(r ? { acoes: [{ a: 'interesse', t: 'Vai' }, { a: 'nao', t: 'Não vai' }], resp: r } : {}) });
      }
    }
    return out;
  }

  // manda cada aviso num push separado; devolve quantos saíram e os aparelhos que não existem mais
  async function mandar(tokens, titulo, avisos) {
    const mortos = new Set(); let enviados = 0;
    for (const v of avisos) {
      tokens = tokens.filter(tk => !mortos.has(tk)); if (!tokens.length) break;
      const data = { titulo, corpo: v.corpo, url: v.url, ...(v.acoes ? { acoes: JSON.stringify(v.acoes) } : {}), ...(v.resp ? { resp: v.resp, api: API() } : {}) };
      const msg = { notification: { title: titulo, body: v.corpo }, data,
        android: { notification: { sound: 'default' } }, apns: { payload: { aps: { sound: 'default' } } }, webpush: { headers: { TTL: '43200' } } };
      const r = await enviar(tokens, msg);
      tokens.forEach((tk, i) => { if (!r[i].ok && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r[i].codigo || '')) mortos.add(tk); });
      if (r.some(x => x.ok)) enviados++;
    }
    return { enviados, mortos: [...mortos] };
  }

  // a escola acabou de criar um evento, uma competição ou uma taxa: avisa na hora as famílias de quem participa
  async function novoExtra(eid, xid, x, agora = Date.now()) {
    if (!x || x.matricula) return 0;
    const cfg = (await ler(`escolas/${eid}/config/geral`)) || {};
    if (cfg.pushFamilias === false) return 0;
    const ms = (await db.collection(`escolas/${eid}/membros`).where('push', '!=', null).get()).docs.filter(m => (m.data().push || []).length);
    if (!ms.length) return 0;
    const e = (await ler(`escolas/${eid}`)) || {}, titulo = e.nome || 'Turma em Dia', hoje = new Date(agora - 3 * 36e5).toISOString().slice(0, 10);
    const d = { cfg, turmas: await col(`escolas/${eid}/turmas`), grupos: await col(`escolas/${eid}/grupos`), alunas: await col(`escolas/${eid}/alunas`), extras: { [xid]: x } };
    const ev = x.tipo === 'evento' || x.tipo === 'competicao', rt = x.tipo === 'taxa' && !!x.rateio;
    const alvo = ev || rt ? new Set((x.convidados || []).filter(id => !((x.part || {})[id] || {}).st)) : C.alvoExtra(x, d.alunas, d.grupos);
    if (!alvo.size) return 0;
    let enviados = 0;
    for (const m of ms) {
      const rids = new Set((await db.collection(`escolas/${eid}/membros/${m.id}/vinculos`).get()).docs.map(v => v.id));
      const alunas = Object.fromEntries([...alvo].filter(id => d.alunas[id] && !d.alunas[id].anonimizadoEm && rids.has(d.alunas[id].responsavelId)).map(id => [id, d.alunas[id]]));
      if (!Object.keys(alunas).length) continue;
      let avisos = [];
      if (ev || rt) avisos = await avisosPerguntas(eid, m.id, d, alunas, hoje, agora, xid);
      else for (const [alid, a] of Object.entries(alunas)) {
        const v = C.valorExtra(x, alid); if (!(v > 0)) continue;
        avisos.push({ corpo: `Nova cobrança: ${x.nome || 'taxa'} de ${primeiro(a.nome)}, ${brl(v)}${x.venc ? `, vence ${dm(x.venc)}` : ''}. Toque para pagar.`, url: `./?pagar=${eid}~${encodeURIComponent(`x:${xid}:${alid}`)}`, acoes: [{ a: 'pagar', t: 'Pagar com Pix' }] });
      }
      const r = await mandar(m.data().push, titulo, avisos); enviados += r.enviados;
      if (r.mortos.length) await m.ref.update({ push: FieldValue.arrayRemove(...r.mortos) });
    }
    return enviados;
  }

  async function escola(eid, e, hoje, agora) {
    const cfg = (await ler(`escolas/${eid}/config/geral`)) || {};
    if (cfg.pushFamilias === false) return 0;
    const ms = (await db.collection(`escolas/${eid}/membros`).where('push', '!=', null).get()).docs.filter(m => (m.data().push || []).length && m.data().pushDia !== hoje);
    if (!ms.length) return 0;
    const extrasQ = await db.collection(`escolas/${eid}/extras`).get();
    const d = { cfg, turmas: await col(`escolas/${eid}/turmas`), grupos: await col(`escolas/${eid}/grupos`), extras: {}, criados: {}, acordos: {}, pags: {}, alunas: {}, contrato: (await ler(`escolas/${eid}/config/contrato`)) || {} };
    extrasQ.docs.forEach(x => { d.extras[x.id] = x.data(); d.criados[x.id] = x.createTime ? x.createTime.toMillis() : 0; });
    const mes = hoje.slice(0, 7), titulo = e.nome || 'Turma em Dia';
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
      const avisos = [...avisosPagamento(eid, d, alunas, hoje), ...(await avisosPerguntas(eid, m.id, d, alunas, hoje, agora))];
      // pendências do cadastro: um aviso, 1 vez por semana, até 4 semanas (volta a contar quando tudo fica em dia)
      const md = m.data(), pend = await pendencias(eid, d, alunas, hoje, agora), pp = md.pushPend || null, up = {};
      if (!pend.length) { if (pp) up.pushPend = FieldValue.delete(); }
      else if (!pp || (pp.n < 4 && dias(pp.ult, hoje) >= 7)) { avisos.push({ corpo: `Falta no cadastro de ${pend.join('; ')}. Toque para resolver.`, url: './?filhos=1' }); up.pushPend = { n: (pp ? pp.n : 0) + 1, ult: hoje }; }
      const r = await mandar(md.push, titulo, avisos); enviados += r.enviados;
      await m.ref.update({ ...up, pushDia: hoje, ...(r.mortos.length ? { push: FieldValue.arrayRemove(...r.mortos) } : {}) });
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
  const { onDocumentCreated } = require('firebase-functions/v2/firestore');
  const avisoNovoExtra = onDocumentCreated('escolas/{eid}/extras/{xid}', ev =>
    novoExtra(ev.params.eid, ev.params.xid, ev.data && ev.data.data()).catch(e => require('firebase-functions/logger').error('aviso novo extra', e.message)));
  return { avisoNovoExtra, interno: { diario, novoExtra, avisosPagamento, avisosPerguntas, atestadoFalta } };
};

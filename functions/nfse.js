/* Turma em Dia · nota fiscal (NFS-e) da comissão do app, direto no Emissor Nacional (nfse.gov.br).
   Sem serviço pago no meio: o único requisito é o certificado digital A1 da empresa.
   Usa a biblioteca aberta open-nfse (MIT), que monta a DPS, valida no esquema oficial, assina e envia.

   Onde fica cada coisa (o app não lê nada disto: regras do Firestore):
   - servidor/plataforma                      e-mails da empresa que podem ver o relatório
   - servidor/nfse                            configuração fiscal (configurar-nfse.sh): ligado, ambiente, cnpj, cTribNac...
   - servidor/nfse_cert                       certificado A1 da empresa (pfx em base64 + senha)
   - servidor/nfse/notas/{AAAA-MM_eid~rec}    cada nota: situação, chave de acesso e XML (rec = escola ou id do professor)
   - servidor/nfse/contadores/{cnpj_serie}    número sequencial da DPS (nunca repete)
   - servidor/nfse/pendentes/{id}             envios que falharam por rede, para tentar de novo

   Fluxo: no dia 1º (rotina diária às 10h), emite a nota do mês anterior para cada escola (e cada professor
   com conta própria) que pagou comissão; nos outros dias, tenta de novo o que ficou pendente.
   A escola baixa o PDF no app (engrenagem → Ajustes da escola → Notas fiscais da comissão).
   A mesma empresa emite as notas do Pelota FC: por isso a série das notas daqui é outra (padrão 901). */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

const COD_RECIFE = '2611606';
const VER_APLIC = 'TurmaEmDia-1';

module.exports = (db, PAG) => {
  const erro = (m, http) => Object.assign(new Error(m), { http });
  const ler = async p => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
  let LIB = null;
  const lib = async () => LIB || (LIB = await import('open-nfse'));
  const idNota = (mes, gid) => `${mes}_${gid}`;
  const mesAnterior = agora => { const d = new Date((agora || Date.now()) - 3 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
  const descricao = (l, mes) => { const [a, m] = mes.split('-');
    return `Comissão de intermediação de pagamentos via aplicativo Turma em Dia (${l.grupo}), competência ${m}/${a}. ${l.qtd} pagamento${l.qtd === 1 ? '' : 's'} por Pix.`.slice(0, 1000); };

  /* ---------- configuração ---------- */
  const config = async () => (await ler('servidor/nfse')) || {};
  function falta(cfg) {
    const f = [];
    if (!/^\d{14}$/.test(cfg.cnpj || '')) f.push('CNPJ da empresa');
    if (!/^\d{6}$/.test(cfg.cTribNac || '')) f.push('código do serviço (cTribNac)');
    if ((cfg.opSimpNac || '3') === '3' && cfg.pTotTribSN == null) f.push('percentual de tributos do Simples');
    return f;
  }

  /* ---------- número da DPS: atômico, nunca repete ---------- */
  const contador = cfg => ({
    async next({ emitenteCnpj, serie }) {
      const ref = db.doc(`servidor/nfse/contadores/${emitenteCnpj}_${serie}`);
      const n = await db.runTransaction(async tx => {
        const s = await tx.get(ref), d = s.exists ? s.data() : {};
        const prox = Math.max(Number(d.ultimo) || 0, (Number(cfg.nInicial) || 1) - 1) + 1;
        tx.set(ref, { ultimo: prox, em: Date.now() });
        return prox;
      });
      return String(n);
    }
  });

  /* ---------- envios pendentes (falha de rede): guardados no banco ---------- */
  const DATAS = ['firstAttemptAt', 'lastAttemptAt', 'notBefore'];
  const pRef = id => db.doc(`servidor/nfse/pendentes/${Buffer.from(String(id)).toString('base64url')}`);
  const store = {
    async save(e) { const o = { ...e }; DATAS.forEach(k => { if (o[k] instanceof Date) o[k] = o[k].getTime(); }); await pRef(e.id).set(JSON.parse(JSON.stringify(o))); },
    async list() { const q = await db.collection('servidor/nfse/pendentes').get(); return q.docs.map(d => { const o = d.data(); DATAS.forEach(k => { if (o[k] != null) o[k] = new Date(o[k]); }); return o; }); },
    async delete(id) { await pRef(id).delete(); }
  };

  /* ---------- cliente do Emissor Nacional ---------- */
  async function cliente(cfg) {
    const L = await lib(), c = await ler('servidor/nfse_cert');
    if (!c || !c.pfx) throw erro('O certificado digital da empresa ainda não foi instalado.', 412);
    return new L.NfseClient({
      ambiente: cfg.ambiente === 'producao' ? L.Ambiente.Producao : L.Ambiente.ProducaoRestrita,
      certificado: { pfx: Buffer.from(c.pfx, 'base64'), password: c.senha || '' },
      dpsCounter: contador(cfg), retryStore: store, timeoutMs: 60000
    });
  }

  // dados da nota de quem recebe os Pix (l = linha de comissoesDoMes)
  function parametros(cfg, l, mes) {
    const [a, m] = mes.split('-').map(Number);
    const opSimpNac = String(cfg.opSimpNac || '3');
    const regime = { opSimpNac, regEspTrib: String(cfg.regEspTrib || '0'), ...(opSimpNac === '3' ? { regApTribSN: String(cfg.regApTribSN || '1') } : {}) };
    const codMun = cfg.codMun || COD_RECIFE;
    return {
      emitente: { cnpj: cfg.cnpj, codMunicipio: codMun, ...(cfg.im ? { inscricaoMunicipal: String(cfg.im) } : {}), regime },
      serie: String(cfg.serie || '1'),
      tpAmb: cfg.ambiente === 'producao' ? '1' : '2',
      dCompet: new Date(Date.UTC(a, m, 0, 15)), // último dia do mês da comissão
      verAplic: VER_APLIC,
      servico: { cTribNac: cfg.cTribNac, ...(cfg.cNBS ? { cNBS: String(cfg.cNBS) } : {}), ...(cfg.cTribMun ? { cTribMun: String(cfg.cTribMun) } : {}), descricao: descricao(l, mes), codMunicipioPrestacao: codMun },
      valores: { vServ: Math.round(l.total * 100) / 100, ...(cfg.pTotTribSN != null ? { pTotTribSN: Number(cfg.pTotTribSN) } : {}), ...(cfg.aliqIss != null ? { aliqIss: Number(cfg.aliqIss) } : {}) },
      tomador: { documento: l.doc.length === 14 ? { CNPJ: l.doc } : { CPF: l.doc }, nome: String(l.nome || '').slice(0, 300), ...(l.email ? { email: l.email } : {}) }
    };
  }

  /* ---------- emitir ---------- */
  async function emitirUma(C, cfg, mes, l) {
    const ref = db.doc(`servidor/nfse/notas/${idNota(mes, l.gid)}`);
    const base = { mes, gid: l.gid, eid: l.eid, rec: l.rec, grupo: l.grupo, valor: l.total, qtd: l.qtd, tomador: { nome: l.nome, doc: l.doc, email: l.email }, ambiente: cfg.ambiente || 'restrita' };
    // trava: no máximo uma nota por grupo e mês, mesmo se duas emissões rodarem juntas
    const livre = await db.runTransaction(async tx => {
      const s = await tx.get(ref), d = s.exists ? s.data() : {};
      if (d.status === 'ok' || d.status === 'pendente' || (d.status === 'emitindo' && Date.now() - d.em < 15 * 60e3)) return false;
      tx.set(ref, { ...base, status: l.doc ? 'emitindo' : 'sem_dados', motivo: l.doc ? null : 'Falta o CPF ou CNPJ de quem recebe.', em: Date.now() }, { merge: true });
      return !!l.doc;
    });
    if (!livre) return l.doc ? 'pulou' : 'sem_dados';
    try {
      const r = await C.emitir(parametros(cfg, l, mes));
      if (r.status === 'ok') { await ref.set({ status: 'ok', chave: r.nfse.chaveAcesso, idDps: r.nfse.idDps, xml: r.nfse.xmlNfse, emitidaEm: Date.now(), motivo: null, em: Date.now() }, { merge: true }); return 'ok'; }
      await ref.set({ status: 'pendente', idDps: r.pending.idDps, motivo: 'O Emissor Nacional não respondeu. O app tenta de novo sozinho.', em: Date.now() }, { merge: true });
      return 'pendente';
    } catch (e) {
      const motivo = String((e.codigo ? `[${e.codigo}] ` : '') + (e.descricao || e.message || 'erro')).slice(0, 500);
      logger.error('nfse', mes, l.gid, motivo);
      await ref.set({ status: 'erro', motivo, em: Date.now() }, { merge: true });
      return 'erro';
    }
  }
  async function retentar(C) {
    const antes = Object.fromEntries((await store.list()).map(p => [p.id, p.idDps]));
    if (!Object.keys(antes).length) return;
    const itens = await C.replayPendingEvents();
    for (const it of itens) {
      const idDps = it.status === 'success_emission' ? it.emission.idDps : antes[it.id];
      if (!idDps || (it.status !== 'success_emission' && it.status !== 'failed_permanent')) continue;
      const q = await db.collection('servidor/nfse/notas').where('idDps', '==', idDps).limit(1).get();
      if (q.empty) continue;
      if (it.status === 'success_emission') await q.docs[0].ref.set({ status: 'ok', chave: it.emission.chaveAcesso, xml: it.emission.xmlNfse, emitidaEm: Date.now(), motivo: null, em: Date.now() }, { merge: true });
      else await q.docs[0].ref.set({ status: 'erro', motivo: String(it.error && it.error.message || 'Recusada pelo Emissor Nacional.').slice(0, 500), em: Date.now() }, { merge: true });
    }
  }
  async function emitirMes(mes, { forcar = false } = {}) {
    const cfg = await config();
    if (!cfg.ligado && !forcar) return { desligado: true };
    const f = falta(cfg); if (f.length) throw erro('Falta configurar: ' + f.join(', ') + '.', 412);
    const C = await cliente(cfg);
    await retentar(C);
    const { linhas } = await PAG.comissoesDoMes(mes);
    const res = {};
    for (const l of linhas) { const r = await emitirUma(C, cfg, mes, l); res[r] = (res[r] || 0) + 1; }
    logger.info('nfse mês', mes, cfg.ambiente || 'restrita', res);
    return res;
  }
  // chamada pela rotina diária (pushCobrancas): dia 1º emite o mês anterior; nos outros dias só retenta pendentes
  async function tarefaDiaria(hoje) {
    const cfg = await config();
    if (!cfg.ligado || falta(cfg).length) return;
    if (String(hoje).slice(8, 10) === '01') { await emitirMes(mesAnterior()); return; }
    const p = await db.collection('servidor/nfse/pendentes').limit(1).get();
    if (!p.empty) await retentar(await cliente(cfg));
  }

  /* ---------- PDF (DANFSe), gerado na hora a partir do XML oficial ---------- */
  async function pdfDe(mes, gid) {
    const n = await ler(`servidor/nfse/notas/${idNota(mes, gid)}`);
    if (!n || n.status !== 'ok' || !n.xml) throw erro('Nota não encontrada.', 404);
    const L = await lib();
    const buf = await L.gerarDanfse(L.parseNfseXml(n.xml), { ambiente: n.ambiente === 'producao' ? L.Ambiente.Producao : L.Ambiente.ProducaoRestrita });
    return { pdf: Buffer.from(buf).toString('base64'), nome: `TurmaEmDia_nota_${mes}.pdf`, chave: n.chave };
  }

  /* ---------- relatório e ações da empresa ---------- */
  async function daPlataforma(req) {
    const u = await PAG.usuario(req), em = String(u.email || '').toLowerCase();
    const d = (await ler('servidor/plataforma')) || {}, lista = (d.emails || []).map(x => String(x).toLowerCase().trim());
    if (!em || !lista.includes(em)) throw erro('Acesso só para a empresa do Turma em Dia.', 403);
    if (u.email_verified !== true) throw erro('Confirme o seu e-mail para abrir o painel do dono.', 403);
    return u;
  }
  const mesOk = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');

  /* ---------- painel do dono: uso do app por região (como no Pelota FC) ---------- */
  const UF_REGIAO = { AC: 'Norte', AP: 'Norte', AM: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
    AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
    DF: 'Centro-Oeste', GO: 'Centro-Oeste', MT: 'Centro-Oeste', MS: 'Centro-Oeste', ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste', PR: 'Sul', RS: 'Sul', SC: 'Sul' };
  const mesRecife = ms => new Date(ms - 3 * 3600e3).toISOString().slice(0, 7);
  // cidade/UF da escola: o que a administração informou nos Ajustes; senão, tenta tirar do nome de um local ("Unidade Centro - Recife/PE")
  function ondeFica(cfg, locais) {
    let uf = String(cfg.uf || '').toUpperCase(), cidade = String(cfg.cidade || '').trim(), origem = UF_REGIAO[uf] ? 'ajustes' : '';
    if (!origem) {
      uf = '';
      for (const l of locais) {
        const txt = String(l.endereco || l.end || l.nome || ''), m = txt.match(/(?:^|[\s,\-\/])([A-Za-z]{2})\s*$/), u2 = m && m[1].toUpperCase();
        if (UF_REGIAO[u2]) { uf = u2; const partes = txt.split(/[,\-\/]/).map(x => x.trim()).filter(Boolean); cidade = cidade || (partes.length > 1 ? partes[partes.length - 2] : ''); origem = 'local'; break; }
      }
    }
    return { uf, cidade, regiao: UF_REGIAO[uf] || 'Sem cidade informada', origem };
  }
  async function painel() {
    const agora = Date.now(), d30 = agora - 30 * 864e5, mes = mesRecife(agora);
    const contas = { total: 0, novas30: 0, ativas30: 0 };
    let tok;
    do {
      const r = await admin.auth().listUsers(1000, tok);
      r.users.forEach(u => { contas.total++; const c = Date.parse(u.metadata.creationTime) || 0, l = Date.parse(u.metadata.lastRefreshTime || u.metadata.lastSignInTime) || 0; if (c > d30) contas.novas30++; if (l > d30) contas.ativas30++; });
      tok = r.pageToken;
    } while (tok);
    const tot = { escolas: 0, ativas: 0, alunos: 0, familias: 0, comPix: 0, pagantes: 0, pixMes: 0, volumeMes: 0, comissaoMes: 0, semCidade: 0 };
    const reg = {}, ufs = {}, cids = {};
    const soma = (map, k, e) => { const o = map[k] = map[k] || { nome: k, escolas: 0, ativas: 0, alunos: 0, contas: 0, pagantes: 0, comissaoMes: 0 };
      o.escolas++; if (e.ativa) o.ativas++; o.alunos += e.alunos; o.contas += e.contas; if (e.pagante) o.pagantes++; o.comissaoMes += e.comissao; };
    const escolas = await db.collection('escolas').get();
    for (const ed of escolas.docs) {
      const p = `escolas/${ed.id}`, e0 = ed.data();
      const [cfgS, locS, aluS, memS, cobS] = await Promise.all([db.doc(`${p}/config/geral`).get(), db.collection(`${p}/locais`).get(), db.collection(`${p}/alunas`).get(),
        db.collection(`${p}/membros`).get(), db.collection(`${p}/cobrancas`).get()]);
      const cfg = cfgS.exists ? cfgS.data() : {};
      const onde = ondeFica(cfg, locS.docs.map(d => d.data()));
      let pix = 0, volume = 0, comissao = 0, recente = false;
      cobS.forEach(c => { const x = c.data(); if ((x.criadoEm || 0) > d30) recente = true;
        if (x.status !== 'approved' || mesRecife(x.pagoEm || x.atualizadoEm || x.criadoEm || 0) !== mes) return; pix++; volume += Number(x.valor) || 0; comissao += Number(x.fee) || 0; });
      const alunos = aluS.docs.filter(d => d.data().ativa !== false).length;
      const e = { ativa: recente, alunos, contas: memS.docs.length + (e0.admins || []).length, pagante: comissao > 0, comissao };
      tot.escolas++; if (e.ativa) tot.ativas++; tot.alunos += alunos; tot.familias += memS.docs.length; if (cfg.mpConectadoEm) tot.comPix++; if (e.pagante) tot.pagantes++;
      tot.pixMes += pix; tot.volumeMes += volume; tot.comissaoMes += comissao; if (!onde.uf) tot.semCidade++;
      soma(reg, onde.regiao, e);
      if (onde.uf) { soma(ufs, onde.uf, e); soma(cids, (onde.cidade || 'Cidade não informada') + ' · ' + onde.uf, e); }
    }
    const lista = m => Object.values(m).map(o => ({ ...o, comissaoMes: Math.round(o.comissaoMes * 100) / 100 })).sort((a, b) => b.escolas - a.escolas || b.alunos - a.alunos);
    tot.volumeMes = Math.round(tot.volumeMes * 100) / 100; tot.comissaoMes = Math.round(tot.comissaoMes * 100) / 100;
    return { em: agora, mes, contas, totais: tot, regioes: lista(reg), estados: lista(ufs), cidades: lista(cids).slice(0, 30) };
  }
  const notasPlataforma = onRequest({ cors: true, maxInstances: 2, memory: '512MiB', timeoutSeconds: 300 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      await daPlataforma(req);
      const b = req.body || {};
      if (b.acao === 'acesso') return res.json({ ok: true });
      if (b.acao === 'painel') return res.json(await painel());
      if (b.acao === 'tomador') {
        const [eid, rec] = String(b.gid || '').split('~'), doc = String(b.doc || '').replace(/\D/g, '');
        const ok = x => /^[A-Za-z0-9_-]{1,60}$/.test(x || '');
        if (!ok(eid) || !ok(rec) || !(await ler(`escolas/${eid}`))) return res.status(404).json({ erro: 'Escola não encontrada.' });
        if (doc.length !== 11 && doc.length !== 14) return res.status(400).json({ erro: 'CPF ou CNPJ inválido.' });
        const nome = String(b.nome || '').trim().slice(0, 120); if (!nome) return res.status(400).json({ erro: 'Falta o nome.' });
        await db.doc(`escolas/${eid}/segredos/nota_${rec}`).set({ nome, doc, tipoDoc: doc.length === 14 ? 'CNPJ' : 'CPF', email: String(b.email || '').trim().slice(0, 120), origem: 'manual', em: Date.now() }, { merge: true });
        return res.json({ ok: true });
      }
      if (!mesOk(b.mes)) return res.status(400).json({ erro: 'Pedido inválido.' });
      if (b.acao === 'emitir') return res.json(await emitirMes(b.mes, { forcar: true }));
      if (b.acao === 'pdf') return res.json(await pdfDe(b.mes, String(b.gid || '')));
      if (b.acao !== 'relatorio') return res.status(400).json({ erro: 'Pedido inválido.' });
      const r = await PAG.comissoesDoMes(b.mes);
      for (const l of r.linhas) { const n = await ler(`servidor/nfse/notas/${idNota(b.mes, l.gid)}`); l.nota = n ? { status: n.status, chave: n.chave || null, motivo: n.motivo || null, ambiente: n.ambiente || null } : null; }
      const cfg = await config(), cert = await ler('servidor/nfse_cert');
      r.nfse = { ligado: !!cfg.ligado, ambiente: cfg.ambiente || 'restrita', falta: falta(cfg).concat(cert && cert.pfx ? [] : ['certificado digital A1']), validade: (cert && cert.validade) || null };
      res.json(r);
    } catch (e) { logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.' }); }
  });

  /* ---------- a administração da escola baixa as notas da escola ---------- */
  const notaComissao = onRequest({ cors: true, maxInstances: 3, memory: '512MiB' }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const u = await PAG.usuario(req), b = req.body || {}, eid = String(b.eid || '');
      if (!/^[A-Za-z0-9_-]{1,60}$/.test(eid)) return res.status(400).json({ erro: 'Pedido inválido.' });
      const e = await ler(`escolas/${eid}`);
      if (!e || !(e.admins || []).includes(u.uid)) return res.status(403).json({ erro: 'Só a administração da escola pode ver as notas.' });
      if (b.acao === 'pdf') { if (!mesOk(b.mes)) return res.status(400).json({ erro: 'Pedido inválido.' }); return res.json(await pdfDe(b.mes, `${eid}~escola`)); }
      const q = await db.collection('servidor/nfse/notas').where('eid', '==', eid).get();
      const notas = q.docs.map(d => d.data()).filter(n => n.status === 'ok' && (n.rec || 'escola') === 'escola').map(n => ({ mes: n.mes, valor: n.valor, chave: n.chave, teste: n.ambiente !== 'producao' })).sort((a, c) => c.mes.localeCompare(a.mes));
      res.json({ notas });
    } catch (e) { logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.' }); }
  });

  return { notasPlataforma, notaComissao, interno: { ondeFica, painel, tarefaDiaria, emitirMes, parametros, mesAnterior, store, contador } };
};

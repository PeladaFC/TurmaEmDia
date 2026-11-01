/* Turma em Dia · nota fiscal (NFS-e) da escola e dos professores para as famílias.
   Quem presta o serviço (a escola, ou o professor que recebe com conta própria) emite com o próprio CNPJ e o
   próprio certificado digital A1, direto no Emissor Nacional (nfse.gov.br), pela biblioteca aberta open-nfse.
   Não tem nada a ver com a nota da comissão do app (nfse.js): outro serviço, outro CNPJ, outra configuração.

   Onde fica cada coisa (o app não lê os segredos: regras do Firestore):
   - escolas/{eid}/segredos/nfseCfg_{rec}             dados fiscais de quem emite (rec = 'escola' ou id do professor)
   - escolas/{eid}/segredos/nfseCert_{rec}            certificado A1 (pfx em base64 + senha), titular e validade
   - escolas/{eid}/segredos/nfseCert_{rec}/pendentes  envios que falharam por rede, para tentar de novo
   - escolas/{eid}/notasFamilia/{nid}                 cada nota: situação, valor, família, chave de acesso e XML
   - servidor/nfseFam/contadores/{cnpj}_{serie}       número da DPS (nunca repete)

   Quando emite:
   - Pix aprovado (mpWebhook) → uma nota por Pix, na hora;
   - recebido em dinheiro, com "Emitir nota fiscal" marcado → o app pede logo depois de registrar.
   Só entra o que tem nota ligada (cada turma, taxa e evento tem o seu liga/desliga) e só para a família que
   quer nota (se quem emite escolheu "só quem pedir") ou que não recusou (se escolheu "todas").
   Sem certificado ou com a nota desligada, não emite nada. */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const C = require('./calculo');

const VER_APLIC = 'TurmaEmDia-familias-1';
const idOk = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);
const hojeRecife = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
const REGIMES = { mei: '2', simples: '3', normal: '1' };
// sugestões da lista nacional (LC 116): quem decide é a escola, com o contador
const SERVICOS = { '060401': 'Esportes, dança, ginástica, natação, artes marciais e atividades físicas', '080201': 'Ensino e instrução (cursos livres)' };

module.exports = (db, PAG, op = {}) => {
  const erro = (m, http, codigo) => Object.assign(new Error(m), { http, codigo });
  const ler = async p => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
  const mapa = async p => Object.fromEntries((await db.collection(p).get()).docs.map(d => [d.id, d.data()]));
  let LIB = null;
  const lib = async () => LIB || (LIB = op.lib ? await op.lib() : await import('open-nfse'));
  const cfgRef = (eid, rec) => db.doc(`escolas/${eid}/segredos/nfseCfg_${rec}`);
  const certPath = (eid, rec) => `escolas/${eid}/segredos/nfseCert_${rec}`;
  const notaRef = (eid, nid) => db.doc(`escolas/${eid}/notasFamilia/${nid}`);

  /* ---------- quem está pedindo ---------- */
  // administração da escola: emite como 'escola'. Professor (e-mail cadastrado pela escola): emite como ele mesmo.
  async function quem(u, eid) {
    if (!idOk(eid)) throw erro('Pedido inválido.', 400);
    const e = await ler(`escolas/${eid}`); if (!e) throw erro('Escola não encontrada.', 404);
    if ((e.admins || []).includes(u.uid)) return { papel: 'admin', rec: 'escola', escola: e };
    const eq = await ler(`escolas/${eid}/equipe/${u.uid}`);
    if (eq && idOk(eq.pid)) {
      const P = await ler(`escolas/${eid}/professoras/${eq.pid}`);
      if (P && u.email_verified && String(P.emailApp || '').toLowerCase() === String(u.email || '').toLowerCase()) return { papel: 'prof', rec: eq.pid, escola: e, P };
    }
    return { papel: 'familia', escola: e };
  }

  /* ---------- cidade onde o serviço é prestado (código do IBGE), pela cidade e estado dos Ajustes da escola ---------- */
  const semAc = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  async function codMunDe(eid) {
    const g = (await ler(`escolas/${eid}/config/geral`)) || {}, uf = String(g.uf || '').toUpperCase(), cid = semAc(g.cidade), chave = `${cid}|${uf}`;
    if (!uf || !cid) return null;
    if (g.codMun && g.codMunDe === chave) return g.codMun;
    let cod = cid === 'recife' && uf === 'PE' ? '2611606' : null;
    if (!cod) try {
      const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`), l = r.ok ? await r.json() : [];
      const m = l.find(x => semAc(x.nome) === cid); cod = m ? String(m.id) : null;
    } catch (e) { logger.warn('ibge', e.message); }
    if (cod) await db.doc(`escolas/${eid}/config/geral`).set({ codMun: cod, codMunDe: chave }, { merge: true });
    return cod;
  }

  /* ---------- configuração de quem emite ---------- */
  async function estado(eid, rec) {
    const cfg = (await ler(`escolas/${eid}/segredos/nfseCfg_${rec}`)) || {}, cert = await ler(certPath(eid, rec));
    const c = cert && cert.pfx ? { titular: cert.titular || '', doc: cert.doc || '', validade: cert.validade || null, vencido: !!(cert.validade && cert.validade < Date.now()) } : null;
    const codMun = await codMunDe(eid), f = falta(cfg, c); if (!codMun) f.push('cidade e estado da escola (em Ajustes)');
    return { cfg: { modo: 'todas', ambiente: 'restrita', ...cfg }, cert: c, falta: f, codMun, servicos: SERVICOS, ...(rec === 'escola' ? {} : { meus: await meusItens(eid, rec, cfg) }) };
  }
  // professor: as turmas, taxas e eventos cujo dinheiro cai para ele. Quem liga ou desliga a nota deles é o professor, não a escola.
  async function meusItens(eid, rec, cfg) {
    const [turmas, extras] = await Promise.all([mapa(`escolas/${eid}/turmas`), mapa(`escolas/${eid}/extras`)]), it = (cfg && cfg.itens) || {};
    return [...Object.entries(turmas).filter(([, t]) => C.recDe(t) === rec).map(([id, t]) => ({ id, nome: t.nome || 'Turma', tipo: 'turma', nota: it[id] === true })),
      ...Object.entries(extras).filter(([, x]) => x.recebedor === rec && !(x.tipo === 'evento' && x.cobranca !== 'app')).map(([id, x]) => ({ id, nome: x.nome || 'Cobrança', tipo: x.tipo === 'taxa' ? 'taxa' : 'evento', nota: it[id] === true }))];
  }
  // a chave de cada item: da escola, o que está na turma/taxa; do professor, o que ele escolheu
  function comChaves(rec, cfg, turmas, extras) {
    if (rec === 'escola') return { turmas, extras };
    const it = (cfg && cfg.itens) || {}, troca = m => Object.fromEntries(Object.entries(m).map(([id, x]) => [id, C.recDe(x) === rec ? { ...x, nota: it[id] === true } : x]));
    return { turmas: troca(turmas), extras: troca(extras) };
  }
  function falta(cfg, cert) {
    const f = [];
    if (!cert) f.push('certificado digital A1'); else if (cert.vencido) f.push('certificado digital válido (o seu venceu)');
    if (!/^\d{14}$/.test(cfg.cnpj || '')) f.push('CNPJ');
    if (!REGIMES[cfg.regime]) f.push('tipo de empresa (MEI, Simples ou outro)');
    if (!/^\d{6}$/.test(cfg.cTribNac || '')) f.push('código do serviço');
    if (cfg.regime && cfg.regime !== 'mei' && !(Number(cfg.aliqIss) > 0)) f.push('alíquota do ISS');
    if (cfg.regime && cfg.regime !== 'mei' && !(Number(cfg.pTrib) > 0)) f.push('percentual aproximado de tributos');
    return f;
  }
  function limparCfg(b, antes) {
    const n = x => x === '' || x == null ? null : Math.round(Number(String(x).replace(',', '.')) * 100) / 100;
    const o = {
      cnpj: C.soDigitos(b.cnpj).slice(0, 14), regime: REGIMES[b.regime] ? b.regime : null, im: C.soDigitos(b.im).slice(0, 15) || null,
      cTribNac: C.soDigitos(b.cTribNac).slice(0, 6), cNBS: C.soDigitos(b.cNBS).slice(0, 9) || null,
      aliqIss: b.regime === 'mei' ? null : n(b.aliqIss), pTrib: b.regime === 'mei' ? null : n(b.pTrib),
      descricao: String(b.descricao || '').trim().slice(0, 200),
      modo: b.modo === 'pedido' ? 'pedido' : 'todas', ambiente: b.ambiente === 'producao' ? 'producao' : 'restrita',
      serie: /^\d{1,4}$/.test(String(b.serie || '')) ? String(b.serie) : (antes.serie || '1'), em: Date.now()
    };
    if (o.aliqIss != null && !(o.aliqIss >= 2 && o.aliqIss <= 5)) throw erro('A alíquota do ISS fica entre 2% e 5%.', 400);
    if (o.pTrib != null && !(o.pTrib > 0 && o.pTrib < 40)) throw erro('O percentual de tributos parece errado. Confira com o contador.', 400);
    if (o.cnpj && o.cnpj.length !== 14) throw erro('O CNPJ tem 14 números.', 400);
    return o;
  }

  // o app só precisa saber se está ligado e o modo (para o liga/desliga da família): fica num lugar que ele lê
  async function publicar(eid, rec, ligado, modo) {
    const v = { ligado: !!ligado, modo: modo === 'pedido' ? 'pedido' : 'todas' };
    if (rec === 'escola') await db.doc(`escolas/${eid}/config/geral`).set({ nfFam: v }, { merge: true });
    else await db.doc(`escolas/${eid}/profsPublico/${rec}`).set({ nf: v }, { merge: true });
  }

  /* ---------- certificado ---------- */
  async function guardarCert(eid, rec, pfx64, senha) {
    const L = await lib(), buf = Buffer.from(String(pfx64 || ''), 'base64');
    if (buf.length < 500 || buf.length > 30000) throw erro('Esse arquivo não parece um certificado A1 (.pfx ou .p12).', 400);
    let c; try { c = L.parsePfx(buf, String(senha || '')); } catch (e) { throw erro('Não abriu: a senha está errada ou o arquivo não é um certificado A1.', 400); }
    const validade = c.expiresOn instanceof Date ? c.expiresOn.getTime() : Date.parse(c.expiresOn);
    if (validade < Date.now()) throw erro('Esse certificado já venceu. Peça um novo à certificadora.', 400);
    const subj = String(c.subject || ''), titular = (subj.match(/CN=([^,]+)/) || [])[1] || subj, doc = (titular.match(/(\d{14}|\d{11})\s*$/) || [])[1] || '';
    await db.doc(certPath(eid, rec)).set({ pfx: buf.toString('base64'), senha: String(senha || ''), titular: titular.replace(/:\d+$/, '').trim().slice(0, 150), doc, validade, em: Date.now() });
    // o CNPJ do certificado já preenche o cadastro
    const cfg = (await ler(`escolas/${eid}/segredos/nfseCfg_${rec}`)) || {};
    if (doc.length === 14 && !cfg.cnpj) await cfgRef(eid, rec).set({ cnpj: doc }, { merge: true });
    return { titular, validade, doc };
  }

  /* ---------- cliente do Emissor Nacional (um por quem emite) ---------- */
  const contador = cfg => ({
    async next({ emitenteCnpj, serie }) {
      const ref = db.doc(`servidor/nfseFam/contadores/${emitenteCnpj}_${serie}`);
      return String(await db.runTransaction(async tx => { const s = await tx.get(ref), d = s.exists ? s.data() : {}; const prox = (Number(d.ultimo) || 0) + 1; tx.set(ref, { ultimo: prox, em: Date.now() }); return prox; }));
    }
  });
  const DATAS = ['firstAttemptAt', 'lastAttemptAt', 'notBefore'];
  const store = (eid, rec) => {
    const base = `${certPath(eid, rec)}/pendentes`, ref = id => db.doc(`${base}/${Buffer.from(String(id)).toString('base64url')}`);
    return {
      async save(e) { const o = { ...e }; DATAS.forEach(k => { if (o[k] instanceof Date) o[k] = o[k].getTime(); }); await ref(e.id).set(JSON.parse(JSON.stringify(o))); },
      async list() { const q = await db.collection(base).get(); return q.docs.map(d => { const o = d.data(); DATAS.forEach(k => { if (o[k] != null) o[k] = new Date(o[k]); }); return o; }); },
      async delete(id) { await ref(id).delete(); }
    };
  };
  async function cliente(eid, rec, cfg) {
    const L = await lib(), c = await ler(certPath(eid, rec));
    if (!c || !c.pfx) throw erro('O certificado digital ainda não foi instalado.', 412);
    return new L.NfseClient({
      ambiente: cfg.ambiente === 'producao' ? L.Ambiente.Producao : L.Ambiente.ProducaoRestrita,
      certificado: { pfx: Buffer.from(c.pfx, 'base64'), password: c.senha || '' },
      dpsCounter: contador(cfg), retryStore: store(eid, rec), timeoutMs: 60000
    });
  }

  /* ---------- montar a nota ---------- */
  function parametros(cfg, codMun, n) {
    const opSimpNac = REGIMES[cfg.regime];
    const regime = { opSimpNac, regEspTrib: '0', ...(opSimpNac === '3' ? { regApTribSN: '1' } : {}) };
    const iss = cfg.aliqIss != null ? Number(cfg.aliqIss) : null, pt = Number(cfg.pTrib) || 0;
    const tot = opSimpNac === '3' ? { pTotTribSN: pt } : opSimpNac === '1' ? { pTotTrib: { pTotTribFed: Math.max(0, Math.round((pt - (iss || 0)) * 100) / 100), pTotTribEst: 0, pTotTribMun: iss || 0 } } : {};
    return {
      emitente: { cnpj: cfg.cnpj, codMunicipio: codMun, ...(cfg.im ? { inscricaoMunicipal: cfg.im } : {}), regime },
      serie: cfg.serie || '1', tpAmb: cfg.ambiente === 'producao' ? '1' : '2', dCompet: new Date(n.data + 'T15:00:00Z'), verAplic: VER_APLIC,
      servico: { cTribNac: cfg.cTribNac, ...(cfg.cNBS ? { cNBS: cfg.cNBS } : {}), descricao: n.descricao, codMunicipioPrestacao: codMun },
      valores: { vServ: n.valor, ...(iss != null && opSimpNac !== '2' ? { aliqIss: iss } : {}), ...tot },
      tomador: { documento: { CPF: n.tomador.cpf }, nome: n.tomador.nome.slice(0, 300), ...(n.tomador.email ? { email: n.tomador.email } : {}) }
    };
  }
  // o que entra na nota de quem recebe (rec), a partir dos itens pagos: só o que tem nota ligada, sem multa e juros
  async function montar(eid, rec, itens, cfg) {
    const [t0, x0] = await Promise.all([mapa(`escolas/${eid}/turmas`), mapa(`escolas/${eid}/extras`)]), { turmas, extras } = comChaves(rec, cfg, t0, x0);
    const alunos = {}, porAl = {};
    let valor = 0;
    for (const i of itens) {
      const a = alunos[i.alid] = alunos[i.alid] || (await ler(`escolas/${eid}/alunas/${i.alid}`)) || {};
      if (!C.emiteNota(i, rec, a, turmas, extras)) continue;
      const enc = i.enc && i.enc.base > 0 ? i.enc.base / (i.enc.base + (i.enc.multa || 0) + (i.enc.juros || 0)) : 1;
      const v = C.r2((Number(i.v) || 0) * enc); if (!(v > 0)) continue;
      valor = C.r2(valor + v);
      const nome = String(a.nome || '').trim() || 'Aluno(a)';
      (porAl[nome] = porAl[nome] || []).push(`${i.desc || 'Serviço'}${i.detalhe && i.tipo === 'm' ? ' (' + i.detalhe + ')' : ''}`);
    }
    // "Davi Lima: Mensalidade de outubro (Sub-9), Copa Recife"
    return { valor, linhas: Object.entries(porAl).map(([n, l]) => `${n}: ${l.join(', ')}`), alunos };
  }

  /* ---------- emitir: chamada pelo Pix (webhook) e pela baixa em dinheiro ---------- */
  // nid: um id fixo por pagamento, para nunca emitir duas vezes a mesma coisa
  async function emitir(eid, rec, { nid, rid, itens, origem, data }) {
    const cfg = (await ler(`escolas/${eid}/segredos/nfseCfg_${rec}`)) || {};
    if (!cfg.ligado) return 'desligado';
    const cert = await ler(certPath(eid, rec));
    if (!cert || !cert.pfx) return 'sem_certificado'; // sem certificado, não emite (e não incomoda ninguém)
    const r = rid ? (await ler(`escolas/${eid}/responsaveis/${rid}`)) || {} : {};
    if (r.nota === 'nao') return 'familia_nao';
    if (cfg.modo === 'pedido' && r.nota !== 'sim') return 'nao_pediu';
    const m = await montar(eid, rec, itens || [], cfg);
    if (!(m.valor > 0)) return 'sem_itens';
    const escola = (await ler(`escolas/${eid}`)) || {}, geral = (await ler(`escolas/${eid}/config/geral`)) || {};
    const extra = cfg.descricao ? cfg.descricao + '. ' : '';
    const n = {
      rec, rid: rid || null, origem, data: data || hojeRecife(), valor: m.valor, itens: m.linhas,
      descricao: `${extra}${m.linhas.join('; ')}. ${escola.nome || ''}`.replace(/\s+/g, ' ').trim().slice(0, 1000),
      tomador: { nome: String(r.nome || '').trim(), cpf: C.soDigitos(r.cpf), email: String(r.email || '').trim() }, ambiente: cfg.ambiente || 'restrita'
    };
    const ref = notaRef(eid, nid), semCpf = !C.cpfValido(n.tomador.cpf) || !n.tomador.nome;
    const livre = await db.runTransaction(async tx => {
      const s = await tx.get(ref), d = s.exists ? s.data() : {};
      if (d.status === 'ok' || d.status === 'pendente' || d.status === 'cancelada' || (d.status === 'emitindo' && Date.now() - d.em < 15 * 60e3)) return false;
      tx.set(ref, { ...n, status: semCpf ? 'sem_dados' : 'emitindo', motivo: semCpf ? 'Falta o CPF certo ou o nome do responsável. Corrija o cadastro e toque em "Tentar de novo".' : null, criadaEm: d.criadaEm || Date.now(), em: Date.now() }, { merge: true });
      return !semCpf;
    });
    if (!livre) return semCpf ? 'sem_dados' : 'pulou';
    return enviar(eid, rec, cfg, ref, n, geral);
  }
  async function enviar(eid, rec, cfg, ref, n, geral) {
    try {
      const f = falta(cfg, { vencido: false }); if (f.length) throw erro('Falta configurar: ' + f.join(', ') + '.', 412);
      const Cl = await cliente(eid, rec, cfg);
      const cod = (await codMunDe(eid)) || cfg.codMun; if (!cod) throw erro('Falta a cidade e o estado da escola (em Ajustes).', 412);
      const r = await Cl.emitir(parametros(cfg, cod, n));
      if (r.status === 'ok') { await ref.set({ status: 'ok', chave: r.nfse.chaveAcesso, idDps: r.nfse.idDps, xml: r.nfse.xmlNfse, emitidaEm: Date.now(), motivo: null, em: Date.now() }, { merge: true }); return 'ok'; }
      await ref.set({ status: 'pendente', idDps: r.pending.idDps, motivo: 'O Emissor Nacional não respondeu. O app tenta de novo sozinho.', em: Date.now() }, { merge: true });
      return 'pendente';
    } catch (e) {
      const motivo = String((e.codigo && !e.http ? `[${e.codigo}] ` : '') + (e.descricao || e.message || 'erro')).slice(0, 500);
      logger.error('nota família', eid, rec, motivo);
      await ref.set({ status: 'erro', motivo, em: Date.now() }, { merge: true });
      return 'erro';
    }
  }
  // Pix aprovado: a cobrança já é de um recebedor só
  async function aposPix(eid, chave, cob) {
    try {
      const rid = (cob.rids && cob.rids[0]) || null;
      return await emitir(eid, cob.rec || 'escola', { nid: 'pix_' + chave, rid, itens: cob.itens || [], origem: 'pix', data: hojeRecife() });
    } catch (e) { logger.error('nota pix', eid, chave, e.message); return 'erro'; }
  }
  // dinheiro: a administração registrou; cada recebedor emite a parte dele
  async function aposBaixa(eid, alid, chaves) {
    const a = await ler(`escolas/${eid}/alunas/${alid}`); if (!a) throw erro('Aluno(a) não encontrado(a).', 404);
    const [pag, turmas, extras, acordos] = await Promise.all([ler(`escolas/${eid}/pagamentos/${alid}`), mapa(`escolas/${eid}/turmas`), mapa(`escolas/${eid}/extras`), mapa(`escolas/${eid}/acordos`)]);
    const quer = new Set(chaves), por = {};
    const itens = C.itensAluna({ alunas: { [alid]: a }, turmas, extras, grupos: {}, acordos, pag: pag || {}, cfg: {} }, alid, hojeRecife()).filter(i => quer.has(i.k) && i.pago && i.pago.via === 'dinheiro');
    for (const i of itens) {
      const partes = i.tipo === 'm' ? C.partesMens(a, turmas, i.pago.v) : i.tipo === 'a' ? C.partesAcordo(acordos[i.aid] || {}, i.pago.v) : { [C.recDe(extras[i.xid])]: i.pago.v };
      for (const [rec, v] of Object.entries(partes)) (por[rec] = por[rec] || []).push({ ...i, v, enc: i.pago.enc || null });
    }
    const out = {};
    for (const [rec, its] of Object.entries(por)) {
      const nid = `din_${alid}_${C.chaveItens(its.map(i => i.k))}_${rec}`.slice(0, 140);
      out[rec] = await emitir(eid, rec, { nid, rid: a.responsavelId, itens: its, origem: 'dinheiro', data: (its[0].pago && its[0].pago.d) || hojeRecife() });
    }
    return out;
  }
  // tenta de novo o que não foi (rede caiu, CPF corrigido, certificado instalado depois)
  async function retentar(eid, rec, nid) {
    const ref = notaRef(eid, nid), d = await ler(`escolas/${eid}/notasFamilia/${nid}`);
    if (!d || d.rec !== rec) throw erro('Nota não encontrada.', 404);
    if (d.status === 'ok' || d.status === 'cancelada') return d.status;
    const cfg = (await ler(`escolas/${eid}/segredos/nfseCfg_${rec}`)) || {}, geral = (await ler(`escolas/${eid}/config/geral`)) || {};
    if (d.status === 'pendente') {
      const Cl = await cliente(eid, rec, cfg), its = await Cl.replayPendingEvents();
      for (const it of its) if (it.status === 'success_emission' && it.emission.idDps === d.idDps) { await ref.set({ status: 'ok', chave: it.emission.chaveAcesso, xml: it.emission.xmlNfse, emitidaEm: Date.now(), motivo: null, em: Date.now() }, { merge: true }); return 'ok'; }
      return 'pendente';
    }
    const r = d.rid ? (await ler(`escolas/${eid}/responsaveis/${d.rid}`)) || {} : {};
    const n = { ...d, tomador: { nome: String(r.nome || d.tomador.nome || '').trim(), cpf: C.soDigitos(r.cpf || d.tomador.cpf), email: String(r.email || d.tomador.email || '').trim() } };
    if (!C.cpfValido(n.tomador.cpf)) { await ref.set({ status: 'sem_dados', motivo: 'O CPF do responsável ainda está faltando ou errado.', em: Date.now() }, { merge: true }); return 'sem_dados'; }
    if (!cfg.ligado) throw erro('Ligue a nota fiscal antes de emitir.', 412);
    await ref.set({ status: 'emitindo', tomador: n.tomador, ambiente: cfg.ambiente || 'restrita', em: Date.now() }, { merge: true });
    return enviar(eid, rec, cfg, ref, n, geral);
  }
  async function cancelar(eid, rec, nid, motivo) {
    const ref = notaRef(eid, nid), d = await ler(`escolas/${eid}/notasFamilia/${nid}`);
    if (!d || d.rec !== rec) throw erro('Nota não encontrada.', 404);
    if (d.status !== 'ok') { await ref.set({ status: 'cancelada', motivo: 'Descartada antes de emitir.', em: Date.now() }, { merge: true }); return 'cancelada'; }
    const cfg = (await ler(`escolas/${eid}/segredos/nfseCfg_${rec}`)) || {}, Cl = await cliente(eid, rec, cfg);
    const r = await Cl.cancelar({ chaveAcesso: d.chave, autor: { CNPJ: cfg.cnpj }, cMotivo: '1', xMotivo: String(motivo || 'Emitida por engano').slice(0, 255).padEnd(15, '.') });
    if (r.status === 'ok') { await ref.set({ status: 'cancelada', canceladaEm: Date.now(), motivo: String(motivo || ''), em: Date.now() }, { merge: true }); return 'cancelada'; }
    throw erro('O Emissor Nacional não respondeu. Tente cancelar de novo daqui a pouco.', 503);
  }
  async function pdf(eid, nid) {
    const n = await ler(`escolas/${eid}/notasFamilia/${nid}`);
    if (!n || n.status !== 'ok' || !n.xml) throw erro('Nota não encontrada.', 404);
    const L = await lib(), buf = await L.gerarDanfse(L.parseNfseXml(n.xml), { ambiente: n.ambiente === 'producao' ? L.Ambiente.Producao : L.Ambiente.ProducaoRestrita });
    return { pdf: Buffer.from(buf).toString('base64'), nome: `nota_fiscal_${n.data || ''}.pdf`, chave: n.chave };
  }
  const resumo = (id, n) => ({ nid: id, rec: n.rec, rid: n.rid, origem: n.origem, data: n.data, valor: n.valor, itens: n.itens || [], status: n.status, motivo: n.motivo || null, chave: n.chave || null, teste: n.ambiente !== 'producao', tomador: n.tomador ? n.tomador.nome : '' });

  /* ---------- pedidos do app ---------- */
  const notaFiscal = onRequest({ cors: true, maxInstances: 3, memory: '512MiB', timeoutSeconds: 120 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const u = await PAG.usuario(req), b = req.body || {}, eid = String(b.eid || ''), Q = await quem(u, eid), a = String(b.acao || '');
      // família: ver e baixar as próprias notas, pedir ou dispensar nota
      if (Q.papel === 'familia' || a.startsWith('fam')) {
        const rids = new Set((await db.collection(`escolas/${eid}/membros/${u.uid}/vinculos`).get()).docs.map(d => d.id));
        if (!rids.size) throw erro('Entre com o código da escola primeiro.', 403);
        if (a === 'famNotas') {
          const out = [];
          for (const rid of rids) (await db.collection(`escolas/${eid}/notasFamilia`).where('rid', '==', rid).get()).forEach(d => { const n = d.data(); if (n.status === 'ok' || n.status === 'cancelada') out.push(resumo(d.id, n)); });
          const pref = {}; for (const rid of rids) { const r = (await ler(`escolas/${eid}/responsaveis/${rid}`)) || {}; pref[rid] = r.nota || null; }
          const modos = {}; for (const rec of ['escola', ...Object.keys(await mapa(`escolas/${eid}/profsPublico`))]) { const c = await ler(`escolas/${eid}/segredos/nfseCfg_${rec}`); if (c && c.ligado) modos[rec] = c.modo || 'todas'; }
          return res.json({ notas: out.sort((x, y) => String(y.data).localeCompare(String(x.data))), pref, modos });
        }
        if (a === 'famPdf') { const nid = String(b.nid || ''); if (!/^[A-Za-z0-9_~.:-]{1,160}$/.test(nid)) throw erro('Pedido inválido.', 400); const n = await ler(`escolas/${eid}/notasFamilia/${nid}`); if (!n || !rids.has(n.rid)) throw erro('Nota não encontrada.', 404); return res.json(await pdf(eid, nid)); }
        if (a === 'famPref') { const rid = String(b.rid || ''); if (!rids.has(rid)) throw erro('Pedido inválido.', 403); await db.doc(`escolas/${eid}/responsaveis/${rid}`).set({ nota: b.quer ? 'sim' : 'nao', notaEm: Date.now() }, { merge: true }); return res.json({ ok: true }); }
        throw erro('Pedido inválido.', 400);
      }
      const rec = Q.rec;
      if (a === 'estado') return res.json({ ...(await estado(eid, rec)), papel: Q.papel });
      if (a === 'salvar') {
        const antes = (await ler(`escolas/${eid}/segredos/nfseCfg_${rec}`)) || {}, novo = limparCfg(b.cfg || {}, antes);
        const ligar = !!(b.cfg || {}).ligado, E0 = await estado(eid, rec), f = falta(novo, E0.cert).concat(E0.codMun ? [] : ['cidade e estado da escola (em Ajustes)']);
        if (ligar && f.length) throw erro('Para ligar, falta: ' + f.join(', ') + '.', 412);
        // professor: liga/desliga de cada turma, taxa e evento dele (só os que são dele)
        const itens = rec === 'escola' ? null : Object.fromEntries((E0.meus || []).map(x => [x.id, !!((b.cfg || {}).itens || {})[x.id]]));
        await cfgRef(eid, rec).set({ ...novo, ...(itens ? { itens } : {}), codMun: E0.codMun || null, ligado: ligar }, { merge: true }); await publicar(eid, rec, ligar, novo.modo);
        return res.json(await estado(eid, rec));
      }
      if (a === 'certificado') { await guardarCert(eid, rec, b.pfx, b.senha); return res.json(await estado(eid, rec)); }
      if (a === 'tirarCertificado') { await db.doc(certPath(eid, rec)).delete(); await cfgRef(eid, rec).set({ ligado: false }, { merge: true }); await publicar(eid, rec, false); return res.json(await estado(eid, rec)); }
      if (a === 'aliquota') {
        const cfg = { ...((await ler(`escolas/${eid}/segredos/nfseCfg_${rec}`)) || {}), ambiente: 'producao' }, serv = C.soDigitos(b.cTribNac).slice(0, 6), geral = (await ler(`escolas/${eid}/config/geral`)) || {};
        if (serv.length !== 6) throw erro('Escolha o código do serviço primeiro.', 400);
        const cod = await codMunDe(eid); if (!cod) throw erro('Preencha a cidade e o estado da escola em Ajustes antes.', 412); void geral;
        const Cl = await cliente(eid, rec, cfg), r = await Cl.consultarAliquota(cod, serv, new Date());
        const l = (r.aliquotas && (r.aliquotas[serv] || Object.values(r.aliquotas)[0])) || [], x = l.find(q => q.aliquota != null) || null;
        return res.json({ aliquota: x ? Number(x.aliquota) : null, mensagem: x ? null : (r.mensagem || 'A prefeitura não informou a alíquota. Pergunte ao contador.') });
      }
      if (a === 'notas') {
        const q = await db.collection(`escolas/${eid}/notasFamilia`).where('rec', '==', rec).get(), out = [];
        q.forEach(d => out.push(resumo(d.id, d.data())));
        return res.json({ notas: out.sort((x, y) => String(y.data).localeCompare(String(x.data)) || 0).slice(0, 300) });
      }
      const nid = String(b.nid || '');
      if (['pdf', 'retentar', 'cancelar'].includes(a) && !/^[A-Za-z0-9_~.:-]{1,160}$/.test(nid)) throw erro('Pedido inválido.', 400);
      if (a === 'pdf') { const n = await ler(`escolas/${eid}/notasFamilia/${nid}`); if (!n || n.rec !== rec) throw erro('Nota não encontrada.', 404); return res.json(await pdf(eid, nid)); }
      if (a === 'retentar') return res.json({ status: await retentar(eid, rec, nid) });
      if (a === 'cancelar') return res.json({ status: await cancelar(eid, rec, nid, b.motivo) });
      // só a administração registra dinheiro; cada recebedor emite a parte dele
      if (a === 'baixa') {
        if (Q.papel !== 'admin') throw erro('Só a administração registra pagamentos.', 403);
        const alid = String(b.alid || ''), ks = (Array.isArray(b.chaves) ? b.chaves : []).map(String).slice(0, 40);
        if (!idOk(alid) || !ks.length) throw erro('Pedido inválido.', 400);
        return res.json({ res: await aposBaixa(eid, alid, ks) });
      }
      throw erro('Pedido inválido.', 400);
    } catch (e) { if (!e.http) logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.', codigo: e.codigo || null }); }
  });

  return { notaFiscal, interno: { aposPix, aposBaixa, emitir, montar, parametros, falta, estado } };
};

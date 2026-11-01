/* Turma em Dia · regras de cobrança. O MESMO arquivo roda no app (regras.js) e no servidor
   (functions/calculo.js, cópia idêntica conferida pelo teste): o valor que a família vê é o valor do Pix.

   Tudo é por ALUNA. Cada aluna tem um responsável; o responsável pode pagar o que quiser,
   de uma filha ou de várias, num Pix só.

   Mensalidade da aluna num mês:
   1. Soma o preço de todas as turmas dela.
   2. Desconto por mais de uma atividade: só se a administração escolheu para esta aluna (descMultiOk).
   3. Desconto de irmã: só se a administração escolheu para esta aluna (descIrmaOk).
      Nenhum desconto entra sozinho e o app não sugere: é escolha da administração.
   4. Ajuste individual, por último: bolsista (zero), valor combinado (substitui), desconto em % ou desconto em R$.
   A aluna só é cobrada nos meses em que está ativa (de "inicio" até "fim").

   Cobranças extras (evento, competição, taxa): cada uma tem o próprio vencimento e vale para
   os grupos, as turmas e as alunas avulsas que a professora escolheu. */
(function (root, fab) { if (typeof module === 'object' && module.exports) module.exports = fab(); else root.Calc = fab(); })(this, function () {
  'use strict';
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const TIPOS_EXTRA = { evento: 'Evento', competicao: 'Evento', taxa: 'Taxa' };
  const MESES_ATRAS = 12; // mensalidades em aberto aparecem por até 12 meses
  const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
  const pad = n => String(n).padStart(2, '0');
  const mesValido = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
  const nomeMes = m => MESES[Number(String(m).slice(5, 7)) - 1] || '';
  function mesMais(m, n) { let [y, mm] = String(m).split('-').map(Number); mm += n; while (mm < 1) { mm += 12; y--; } while (mm > 12) { mm -= 12; y++; } return `${y}-${pad(mm)}`; }
  function stPag(x) { if (!x) return null; if (x === true) return { s: 'pago' }; return x.s === 'pago' ? x : null; }
  const soDigitos = s => String(s || '').replace(/\D/g, '');
  // CPF com os dois dígitos verificadores certos (11 números, não todos iguais)
  function cpfValido(c) {
    const d = soDigitos(c); if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }
  // telefone sem DDI, para comparar "(81) 99999-0000" com "+55 81 999990000"
  const telNorm = s => { const d = soDigitos(s); return d.length > 11 && d.startsWith('55') ? d.slice(2) : d; };

  function ativaNoMes(a, mes) {
    if (!a) return false;
    if (a.inicio && a.inicio > mes) return false;
    if (a.fim && a.fim < mes) return false;
    if (a.ativa === false && !a.fim) return false;
    return true;
  }
  function baseAluna(a, turmas, cfg) {
    const ts = (a.turmas || []).map(t => turmas[t]).filter(Boolean);
    let v = ts.reduce((s, t) => s + (Number(t.preco) || 0), 0);
    const soma = r2(v), multi = Number(cfg.descMulti) || 0;
    if (multi > 0 && a.descMultiOk === true) v = v * (1 - multi);
    return { v: r2(v), soma, turmas: ts };
  }
  function aplicaAjuste(v, d) {
    if (!d) return r2(v);
    if (d.isenta) return 0;
    if (d.v != null && d.v !== '' && Number(d.v) >= 0) return r2(d.v);
    if (Number(d.pct) > 0) return r2(v * (1 - Math.min(1, Number(d.pct))));
    if (Number(d.menos) > 0) return r2(Math.max(0, v - Number(d.menos)));
    return r2(v);
  }
  // mensalidade de uma aluna num mês, considerando as irmãs (mesmo responsável)
  function mensalidade(alunas, alid, mes, turmas, cfg) {
    cfg = cfg || {}; const a = (alunas || {})[alid];
    if (!a || !ativaNoMes(a, mes)) return null;
    const irmas = Object.entries(alunas).filter(([, x]) => a.responsavelId && x.responsavelId === a.responsavelId && ativaNoMes(x, mes))
      .map(([id, x]) => ({ id, ...baseAluna(x, turmas || {}, cfg) })).filter(x => x.turmas.length)
      .sort((x, y) => y.v - x.v || x.id.localeCompare(y.id));
    const eu = baseAluna(a, turmas || {}, cfg); if (!eu.turmas.length) return null;
    const dIrma = Number(cfg.descIrmas) || 0, podeIrma = irmas.some(x => x.id !== alid), podeMulti = eu.turmas.length >= 2;
    const irma = dIrma > 0 && podeIrma && a.descIrmaOk === true, comIrma = irma ? r2(eu.v * (1 - dIrma)) : eu.v, v0 = aplicaAjuste(comIrma, a.desc);
    // primeiro mês com desconto (matrícula no meio do mês): metade, proporcional aos dias, isento ou outro valor
    const pm = a.primeiroMes && a.primeiroMes.mes === mes ? a.primeiroMes : null;
    const v = !pm ? v0 : pm.tipo === 'valor' ? r2(Math.max(0, Math.min(v0, Number(pm.v) || 0))) : r2(v0 * Math.max(0, Math.min(1, Number(pm.fator) || 0)));
    return { v, soma: eu.soma, cheio: eu.v, irma, podeIrma, podeMulti, dMulti: r2(eu.soma - eu.v), dIrma: r2(eu.v - comIrma), dAjuste: r2(comIrma - v0), dPrimeiro: r2(v0 - v), primeiro: pm,
      irmas: irmas.filter(x => x.id !== alid).map(x => x.id), turmas: eu.turmas.map(t => t.nome), turmasObj: eu.turmas };
  }
  const vencMens = (mes, cfg) => `${mes}-${pad(Math.min(28, Math.max(1, Number((cfg || {}).vencDia) || 10)))}`;
  // aluno que entra depois do vencimento do mês: o primeiro mês vence alguns dias depois da matrícula (vencPrimeiro), sem multa
  const vencAluna = (a, mes, cfg) => { const v = vencMens(mes, cfg); return a && a.vencPrimeiro && a.inicio === mes && a.vencPrimeiro > v ? a.vencPrimeiro : v; };
  // valor de uma cobrança extra para um aluno: o valor padrão, ou o valor ajustado só para ele
  const valorExtra = (x, alid) => r2(x && x.valores && x.valores[alid] != null ? x.valores[alid] : (x || {}).v);
  // alunas que uma cobrança extra alcança: grupos + turmas + avulsas
  function alvoExtra(x, alunas, grupos) {
    const s = new Set(x.alunas || x.quem || []);
    for (const g of x.grupos || []) for (const id of ((grupos || {})[g] || {}).alunas || []) s.add(id);
    if ((x.turmas || []).length) for (const [id, a] of Object.entries(alunas || {})) if ((a.turmas || []).some(t => x.turmas.includes(t))) s.add(id);
    return s;
  }

  /* Tudo o que uma aluna tem de cobrança (em aberto e pago).
     d = { alunas, turmas, extras, grupos, pag (pagamentos/{alid}), cfg }, hoje = 'AAAA-MM-DD'
     Cada item: { k, tipo: 'm'|'x', alid, mes?, xid?, desc, detalhe, v, venc, pago } */
  /* Quem recebe: cada turma e cada cobrança extra tem um recebedor escolhido pela administração
     ('escola' ou o id de uma professora). A mensalidade de quem faz turmas de recebedores diferentes
     é dividida pelo valor de cada turma (os descontos se dividem na mesma proporção). */
  const recDe = x => (x && x.recebedor) || 'escola';
  function partesMens(a, turmas, v) {
    const ts = (a.turmas || []).map(t => (turmas || {})[t]).filter(Boolean), por = {};
    if (!ts.length) return { escola: r2(v) };
    const tot = ts.reduce((s, t) => s + (Number(t.preco) || 0), 0); let resto = r2(v);
    ts.forEach((t, i) => { const w = tot ? (Number(t.preco) || 0) / tot : 1 / ts.length, val = i === ts.length - 1 ? resto : r2(v * w); resto = r2(resto - val); por[recDe(t)] = r2((por[recDe(t)] || 0) + val); });
    return por;
  }
  // nota fiscal: cada turma, taxa e evento diz se emite nota (padrão: NÃO; a escola liga o que quiser).
  // Mensalidade e acordo: vale a turma de quem recebe. Devolve true/false para a parte deste recebedor no item.
  function emiteNota(i, rec, a, turmas, extras) {
    if (i.tipo === 'x') { const x = (extras || {})[i.xid]; return !!(x && x.nota === true); }
    const ts = ((a && a.turmas) || []).map(t => (turmas || {})[t]).filter(Boolean).filter(t => recDe(t) === rec);
    return ts.some(t => t.nota === true);
  }
  // parcela de acordo: divide entre os recebedores na mesma proporção das cobranças que entraram no acordo
  function partesAcordo(A, v) {
    const fr = Object.entries(A.fracoes || { escola: 1 }), out = {}; let resto = r2(v);
    fr.forEach(([rec, f], i) => { const val = i === fr.length - 1 ? resto : r2(v * f); resto = r2(resto - val); out[rec] = val; });
    return out;
  }
  function itensAluna(d, alid, hoje) {
    const cfg = d.cfg || {}, pag = d.pag || {}, a = (d.alunas || {})[alid], itens = [];
    if (!a) return itens;
    const atual = String(hoje).slice(0, 7), nome = a.nome || 'Aluno(a)';
    const meses = new Set(Object.keys(pag.mens || {}));
    for (let k = 0; k < MESES_ATRAS; k++) meses.add(mesMais(atual, -k));
    for (const mes of [...meses].sort()) {
      if (!mesValido(mes) || mes > atual) continue;
      if (((pag.mens || {})[mes] || {}).s === 'acordo') continue; // entrou num acordo: quem cobra agora são as parcelas
      const p = stPag((pag.mens || {})[mes]);
      const m = p ? null : mensalidade(d.alunas, alid, mes, d.turmas, cfg);
      if (!p && !(m && m.v > 0)) continue;
      // partes já pagas a algum recebedor (pagamento em mais de um Pix) saem do que falta
      let partes = null, v = p ? r2(p.v) : m.v;
      if (!p) { const ja = ((pag.mensPartes || {})[mes]) || {}; partes = {}; for (const [rec, val] of Object.entries(partesMens(a, d.turmas, m.v))) if (!stPag(ja[rec])) partes[rec] = val; v = r2(Object.values(partes).reduce((s, x) => s + x, 0)); if (!(v > 0)) continue; }
      itens.push({ k: `m:${mes}:${alid}`, tipo: 'm', alid, mes, desc: `Mensalidade de ${nomeMes(mes)}`, detalhe: m ? m.turmas.join(' + ') : 'Mensalidade', v, total: p ? r2(p.v) : m.v, partes, venc: vencAluna(a, mes, cfg), pago: p });
    }
    for (const [xid, x] of Object.entries(d.extras || {})) {
      if (!x) continue;
      if (((pag.extras || {})[xid] || {}).s === 'acordo') continue;
      const p = stPag((pag.extras || {})[xid]);
      if (!p && !alvoExtra(x, d.alunas, d.grupos).has(alid)) continue;
      itens.push({ k: `x:${xid}:${alid}`, tipo: 'x', alid, xid, mes: String(x.venc || '').slice(0, 7), desc: x.nome || TIPOS_EXTRA[x.tipo] || 'Cobrança extra', detalhe: TIPOS_EXTRA[x.tipo] || 'Extra', tipoExtra: x.tipo, v: p ? r2(p.v) : valorExtra(x, alid), total: valorExtra(x, alid), partes: p ? null : { [recDe(x)]: valorExtra(x, alid) }, venc: x.venc, pago: p });
    }
    // acordos: as cobranças atrasadas viram parcelas, cada uma com o seu vencimento
    for (const [aid, A] of Object.entries(d.acordos || {})) {
      if (!A || A.alid !== alid || A.cancelado) continue;
      const N = (A.parcelas || []).length;
      for (const q of A.parcelas || []) {
        const p = stPag(((pag.acordos || {})[aid] || {})[q.n]);
        itens.push({ k: `a:${aid}.${q.n}:${alid}`, tipo: 'a', alid, aid, n: q.n, mes: String(q.venc).slice(0, 7), desc: `Acordo · parcela ${q.n} de ${N}`, detalhe: A.resumo || 'Acordo de atrasados', v: p ? r2(p.v) : r2(q.v), total: r2(q.v), partes: p ? null : partesAcordo(A, q.v), venc: q.venc, pago: p });
      }
    }
    return itens.sort((x, y) => String(x.venc).localeCompare(String(y.venc)) || x.k.localeCompare(y.k)).map(i => ({ ...i, nome }));
  }
  /* Multa e juros por atraso (Ajustes da escola). Limites usuais da lei: multa até 2% (CDC art. 52, §1º)
     e juros de mora até 1% ao mês, proporcionais aos dias. A escola pode tirar de uma cobrança até uma data
     (pag.semEncargos[chave] = { ate }); passou a data, volta tudo, contado desde o vencimento original. */
  const MULTA_MAX = 2, JUROS_MAX = 1;
  const chaveEnc = k => String(k).replace(/[.:]/g, '_');
  const diasEntre = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));
  function encargos(i, cfg, hoje) {
    const c = (cfg || {}).atraso; if (!c || !c.ativo || i.pago || !(i.venc < hoje)) return null;
    const dias = diasEntre(i.venc, hoje);
    const multa = r2(i.v * Math.min(MULTA_MAX, Number(c.multa) || 0) / 100), juros = r2(i.v * Math.min(JUROS_MAX, Number(c.juros) || 0) / 100 * dias / 30);
    return multa + juros > 0 ? { multa, juros, dias, base: i.v } : null;
  }
  function perdao(i, pag, hoje) { const p = ((pag || {}).semEncargos || {})[chaveEnc(i.k)]; if (!p || i.pago) return null; return !p.ate || hoje <= p.ate ? { ate: p.ate || null } : null; }
  function comEncargos(i, cfg, pag, hoje) {
    const e = encargos(i, cfg, hoje); if (!e) return i;
    const pd = perdao(i, pag, hoje); if (pd) return { ...i, perdao: pd };
    const v = r2(e.base + e.multa + e.juros); let partes = null;
    if (i.partes) { const f = v / e.base, ks = Object.keys(i.partes); partes = Object.fromEntries(ks.map(r => [r, r2(i.partes[r] * f)]));
      const dif = r2(v - Object.values(partes).reduce((x, y) => x + y, 0)); if (dif && ks.length) partes[ks[0]] = r2(partes[ks[0]] + dif); }
    return { ...i, enc: e, v, partes };
  }
  // o que a família vê e paga: itens com multa e juros já somados
  const itensComEncargos = (d, alid, hoje) => itensAluna(d, alid, hoje).map(i => comEncargos(i, d.cfg, d.pag, hoje));
  const status = (item, hoje) => item.pago ? 'pago' : item.venc < hoje ? 'vencido' : 'aberto';
  // "m:2026-10:alid" ou "x:xid:alid" → partes
  function lerChave(k) {
    const p = String(k || '').split(':');
    if (p.length !== 3 || !/^[A-Za-z0-9_-]{1,60}$/.test(p[2])) return null;
    if (p[0] === 'm' && mesValido(p[1])) return { tipo: 'm', mes: p[1], alid: p[2] };
    if (p[0] === 'x' && /^[A-Za-z0-9_-]{1,60}$/.test(p[1])) return { tipo: 'x', xid: p[1], alid: p[2] };
    if (p[0] === 'a' && /^[A-Za-z0-9_-]{1,60}\.\d{1,2}$/.test(p[1])) return { tipo: 'a', aid: p[1].split('.')[0], n: Number(p[1].split('.')[1]), alid: p[2] };
    return null;
  }

  // Valor do Pix: com "quem paga cobre a taxa", a escola recebe o valor cheio.
  /* Quem paga cobre a taxa do Pix? Desligado, a não ser que a escola ligue.
     Mensalidade, acordo e taxa avulsa: a escolha da escola (Ajustes). Evento e taxa de um evento: a escolha do evento. */
  function repassaItem(it, cfg, extras) {
    if (it && it.tipo === 'x' && it.xid && extras) {
      const x = extras[it.xid] || {}, ev = x.evento ? extras[x.evento] : (x.tipo === 'evento' || x.tipo === 'competicao') ? x : null;
      if (ev) return ev.pixRepassa === true;
    }
    return (cfg || {}).pixRepassa === true;
  }
  // parte do lote em que quem paga cobre a taxa
  function baseRepasse(itens, cfg, extras) { return r2((itens || []).reduce((s, it) => s + (repassaItem(it, cfg, extras) ? Number(it.v) || 0 : 0), 0)); }
  function valorPix(base, cfg, taxaMP, comissao, baseRep) {
    const b = r2(base), rep = Math.min(b, r2(baseRep == null ? ((cfg || {}).pixRepassa === true ? b : 0) : baseRep));
    const valor = rep > 0 ? r2(b - rep) + Math.ceil(rep / (1 - taxaMP - comissao) * 100 - 1e-6) / 100 : b;
    const fee = comissao > 0 ? r2(valor * comissao) : 0;
    return { valor: r2(valor), fee };
  }
  function chaveItens(ks) {
    const s = [...ks].sort().join(','); let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  /* Faixa etária: conta a idade que a aluna completa no ano (ano − ano de nascimento),
     como nas categorias de ginástica. Turma sem idade mínima e máxima aceita todas as idades. */
  const idadeNoAno = (nasc, ano) => /^\d{4}/.test(nasc || '') ? Number(ano) - Number(String(nasc).slice(0, 4)) : null;
  const todasIdades = t => !t || t.todasIdades || (t.idadeMin == null && t.idadeMax == null);
  const cabe = (t, idade) => todasIdades(t) || idade == null || ((t.idadeMin == null || idade >= t.idadeMin) && (t.idadeMax == null || idade <= t.idadeMax));
  const faixaTxt = t => todasIdades(t) ? 'Todas as idades' : t.idadeMin != null && t.idadeMax != null ? `${t.idadeMin} a ${t.idadeMax} anos` : t.idadeMin != null ? `a partir de ${t.idadeMin} anos` : `até ${t.idadeMax} anos`;
  /* Área do professor: o que ele vê dos alunos das turmas dele, sem dados da família (nada de telefone, CPF ou saúde).
     d = { alunas, turmas, extras, grupos, acordos, cfg, pags: { alid: pagamentos } }, pid, mes 'AAAA-MM', hoje 'AAAA-MM-DD'.
     Os valores são a parte dele: o que cai para ele nas turmas, cobranças e acordos em que ele é o recebedor. */
  function painelProfessor(d, pid, mes, hoje) {
    const turmas = d.turmas || {}, minhas = Object.keys(turmas).filter(t => turmas[t] && turmas[t].professoraId === pid), set = new Set(minhas);
    const alunos = [], rec = [], atr = [], ven = [];
    const parteMesPaga = (a, pag, mm) => {
      const pp = stPag(((pag.mensPartes || {})[mm] || {})[pid]); if (pp) return pp;
      const pt = stPag((pag.mens || {})[mm]); if (pt && !(pag.mensPartes || {})[mm]) { const v = partesMens(a, turmas, pt.v)[pid] || 0; return v > 0 ? { ...pt, v } : null; }
      return null;
    };
    for (const [alid, a] of Object.entries(d.alunas || {})) {
      if (!a || a.anonimizadoEm) continue;
      const ts = (a.turmas || []).filter(t => set.has(t)); if (!ts.length) continue;
      const pag = (d.pags || {})[alid] || {}, dd = { ...d, pag }, nome = a.nome || 'Aluno(a)';
      let recebeu = false;
      // recebidos no mês: mensalidades (a parte dele), cobranças extras dele e parcelas de acordo
      for (const mm of new Set([...Object.keys(pag.mens || {}), ...Object.keys(pag.mensPartes || {})])) {
        const p = parteMesPaga(a, pag, mm); if (p && p.v > 0 && String(p.d).slice(0, 7) === mes) { rec.push({ d: p.d, alid, aluno: nome, cobranca: `Mensalidade de ${nomeMes(mm)}`, via: p.via || null, v: r2(p.v) }); recebeu = true; }
      }
      for (const [xid, x] of Object.entries(pag.extras || {})) {
        const p = stPag(x), X = (d.extras || {})[xid]; if (!p || !X || recDe(X) !== pid || String(p.d).slice(0, 7) !== mes) continue;
        rec.push({ d: p.d, alid, aluno: nome, cobranca: X.nome || 'Cobrança', via: p.via || null, v: r2(p.v) }); recebeu = true;
      }
      for (const [aid, ps] of Object.entries(pag.acordos || {})) for (const [n, x] of Object.entries(ps || {})) {
        const p = stPag(x), A = (d.acordos || {})[aid]; if (!p || !A || String(p.d).slice(0, 7) !== mes) continue;
        const v = partesAcordo(A, p.v)[pid] || 0; if (v > 0) { rec.push({ d: p.d, alid, aluno: nome, cobranca: `Acordo · parcela ${n}`, via: p.via || null, v }); recebeu = true; }
      }
      // em aberto: a parte dele, atrasada ou vencendo no mês
      let atraso = 0;
      for (const i of itensComEncargos(dd, alid, hoje)) {
        if (i.pago || !i.partes || !(i.partes[pid] > 0)) continue; const v = r2(i.partes[pid]);
        if (i.venc < hoje) { atr.push({ venc: i.venc, alid, aluno: nome, cobranca: i.desc, v }); atraso = r2(atraso + v); }
        else if (String(i.venc).slice(0, 7) === mes) ven.push({ venc: i.venc, alid, aluno: nome, cobranca: i.desc, v });
      }
      // a mensalidade do mês, do ponto de vista dele
      const ativo = ativaNoMes(a, mes); let mensal = null;
      if (ativo) {
        const pg = parteMesPaga(a, pag, mes), pm = (pag.mens || {})[mes];
        if (pg) mensal = { st: 'pago', v: r2(pg.v), d: pg.d || null };
        else {
          const m = mensalidade(d.alunas, alid, mes, turmas, d.cfg || {}), venc = vencAluna(a, mes, d.cfg);
          if (m) mensal = { st: stPag(pm) ? 'pago' : pm && pm.s === 'acordo' ? 'acordo' : venc < hoje ? 'atrasado' : 'aberto', v: r2(partesMens(a, turmas, m.v)[pid] || 0), venc };
        }
      }
      if (!ativo && !atraso && !recebeu) continue;
      const grupos = Object.values(d.grupos || {}).filter(g => g && (g.alunas || []).includes(alid)).map(g => g.nome || '').filter(Boolean);
      alunos.push({ id: alid, nome, nascimento: a.nascimento || null, turmas: ts, grupos, ativo, mensal, atraso });
    }
    const soma = l => r2(l.reduce((s, x) => s + x.v, 0)), ord = (x, y) => String(x.d || x.venc).localeCompare(String(y.d || y.venc)) || String(x.aluno).localeCompare(String(y.aluno), 'pt-BR');
    alunos.sort((x, y) => String(x.nome).localeCompare(String(y.nome), 'pt-BR'));
    return { turmas: minhas, alunos, rec: rec.sort(ord), atr: atr.sort(ord), ven: ven.sort(ord), totais: { recebido: soma(rec), atrasado: soma(atr), aVencer: soma(ven) } };
  }
  return { vencAluna, cpfValido, emiteNota, repassaItem, baseRepasse, recDe, partesMens, partesAcordo, idadeNoAno, todasIdades, cabe, faixaTxt, MESES, TIPOS_EXTRA, r2, pad, mesValido, nomeMes, mesMais, stPag, soDigitos, telNorm, ativaNoMes, baseAluna, aplicaAjuste, mensalidade, vencMens, alvoExtra, valorExtra, itensAluna, itensComEncargos, comEncargos, MULTA_MAX, JUROS_MAX, chaveEnc, status, lerChave, valorPix, chaveItens, painelProfessor };
});

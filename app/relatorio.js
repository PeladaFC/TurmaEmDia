/* Escolinha · relatório em PDF dos pagamentos de uma professora (recebidos no período e em atraso).
   Recebe os dados já calculados pelo app e desenha com o PdfSimples. */
(function (root, fab) { if (typeof module === 'object' && module.exports) module.exports = fab(root.PdfSimples || require('./pdf-simples.js')); else root.Relatorio = fab(root.PdfSimples); })(this, function (P) {
  'use strict';
  let ROSA = '#8B6B47'; const TINTA = '#1A2030', CINZA = '#5D6578', LINHA = '#E1E4EC', FUNDO = '#F4F5F8', VERDE = '#17786A', TIJOLO = '#B0442B', AMBAR = '#9A6A00';
  const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const M = 40;
  function professora(R) {
    ROSA = /^#[0-9a-f]{6}$/i.test(R.cor || '') ? R.cor : '#8B6B47';
    const d = P.Documento(), L = d.w - 2 * M; let y = 0;
    const cabecalho = primeira => {
      d.ret(0, 0, d.w, 6, ROSA); y = 34;
      // logo da escola no canto direito (até 46 pontos de altura)
      if (R.logo && R.logo.jpg && d.imagem) { const h = 46, w = Math.min(110, h * R.logo.w / R.logo.h); d.imagem(d.w - M - w, 18, w, w * R.logo.h / R.logo.w, R.logo); }
      d.texto(M, y, String(R.escola || '').toUpperCase(), { tam: 8, neg: true, cor: CINZA, max: L - (R.logo ? 120 : 0) }); y += 22;
      if (primeira) {
        d.texto(M, y, 'Relatório de pagamentos', { tam: 20, neg: true, cor: TINTA }); y += 22;
        d.texto(M, y, R.professora, { tam: 13, neg: true, cor: ROSA, max: L }); y += 16;
        d.texto(M, y, `Período: ${R.periodo} · gerado em ${R.geradoEm}`, { tam: 9, cor: CINZA }); y += 13;
        if (R.conta) { d.texto(M, y, 'Recebimento: ' + R.conta, { tam: 9, cor: CINZA, max: L }); y += 13; }
        y += 7;
      } else { d.texto(M, y, `${R.professora} · ${R.periodo} (continuação)`, { tam: 10, neg: true, cor: TINTA, max: L }); y += 18; }
    };
    const novaPag = () => { d.novaPagina(); cabecalho(false); };
    const precisa = h => { if (y + h > d.h - 56) novaPag(); };
    cabecalho(true);
    // resumo
    const caixas = [['Recebido no período', R.resumo.recebido, VERDE, `${R.resumo.nRec} pagamento${R.resumo.nRec === 1 ? '' : 's'}`],
      ['Em atraso (até hoje)', R.resumo.atraso, TIJOLO, `${R.resumo.nAtr} cobrança${R.resumo.nAtr === 1 ? '' : 's'}`],
      ['A vencer no período', R.resumo.aVencer, AMBAR, `${R.resumo.nVen} cobrança${R.resumo.nVen === 1 ? '' : 's'}`]];
    const cw = (L - 16) / 3;
    caixas.forEach(([rot, v, c, sub], i) => { const x = M + i * (cw + 8); d.ret(x, y, cw, 58, FUNDO); d.ret(x, y, 3, 58, c);
      d.texto(x + 12, y + 16, rot, { tam: 8, neg: true, cor: CINZA, max: cw - 18 }); d.texto(x + 12, y + 36, brl(v), { tam: 15, neg: true, cor: c, max: cw - 18 }); d.texto(x + 12, y + 50, sub, { tam: 8, cor: CINZA }); });
    y += 80;
    // tabela genérica
    const tabela = (titulo, cols, linhas, total, vazio) => {
      precisa(60); d.texto(M, y, titulo, { tam: 12, neg: true, cor: TINTA }); y += 10;
      const cab = () => { d.ret(M, y, L, 18, FUNDO); let x = M + 6; cols.forEach(c => { d.texto(c.dir ? x + c.w - 12 : x, y + 12, c.t, { tam: 7.5, neg: true, cor: CINZA, alinha: c.dir ? 'dir' : null }); x += c.w; }); y += 18; };
      cab();
      if (!linhas.length) { d.texto(M + 6, y + 14, vazio, { tam: 9, cor: CINZA }); y += 26; return; }
      linhas.forEach(l => {
        if (y + 17 > d.h - 56) { novaPag(); d.texto(M, y, titulo + ' (continuação)', { tam: 10, neg: true, cor: TINTA }); y += 10; cab(); }
        let x = M + 6; cols.forEach((c, i) => { const v = l[i]; d.texto(c.dir ? x + c.w - 12 : x, y + 12, v, { tam: 8.5, cor: c.cor ? c.cor(l) : TINTA, neg: !!c.neg, alinha: c.dir ? 'dir' : null, max: c.w - 10 }); x += c.w; });
        y += 17; d.linha(M, y, M + L, y, LINHA, 0.5);
      });
      if (total != null) { y += 4; d.texto(M + L - 6, y + 12, `Total: ${brl(total)}`, { tam: 10, neg: true, cor: TINTA, alinha: 'dir' }); y += 20; }
      y += 14;
    };
    tabela(`Recebidos em ${R.periodoCurto}`, [{ t: 'DATA', w: 52 }, { t: 'ALUNO(A)', w: 128 }, { t: 'COBRANÇA', w: 175 }, { t: 'FORMA', w: 70 }, { t: 'VALOR', w: L - 425, dir: true, neg: true }],
      R.recebidos.map(r => [r.data, r.aluna, r.cobranca, r.forma, brl(r.v)]), R.resumo.recebido, 'Nenhum pagamento recebido neste período.');
    tabela('Em atraso', [{ t: 'VENCEU', w: 52 }, { t: 'ALUNO(A)', w: 110 }, { t: 'RESPONSÁVEL', w: 120 }, { t: 'COBRANÇA', w: 128 }, { t: 'DIAS', w: 38, dir: true }, { t: 'VALOR', w: L - 448, dir: true, neg: true, cor: () => TIJOLO }],
      R.atrasados.map(r => [r.venc, r.aluna, r.resp, r.cobranca, String(r.dias), brl(r.v)]), R.resumo.atraso, 'Nenhuma cobrança em atraso. 🎉'.replace(' 🎉', ''));
    if (R.aVencer.length) tabela(`A vencer em ${R.periodoCurto}`, [{ t: 'VENCE', w: 52 }, { t: 'ALUNO(A)', w: 150 }, { t: 'COBRANÇA', w: 230 }, { t: 'VALOR', w: L - 432, dir: true, neg: true }],
      R.aVencer.map(r => [r.venc, r.aluna, r.cobranca, brl(r.v)]), R.resumo.aVencer, '');
    precisa(40);
    d.texto(M, y, 'Valores da parte deste(a) professor(a): mensalidades das turmas e cobranças que a escola direcionou para ele(a).', { tam: 8, cor: CINZA, max: L }); y += 11;
    d.texto(M, y, 'Mensalidade de aluno(a) com turmas de recebedores diferentes é dividida pelo valor de cada turma.', { tam: 8, cor: CINZA, max: L });
    // rodapé com número da página
    const n = d.pagina;
    for (let i = 0; i < n; i++) { d.irPara(i); d.linha(M, d.h - 40, M + L, d.h - 40, LINHA, 0.5); d.texto(M, d.h - 26, `${R.escola} · Relatório de ${R.professora} · ${R.periodo}`, { tam: 7.5, cor: CINZA, max: L - 80 }); d.texto(M + L, d.h - 26, `Página ${i + 1} de ${n}`, { tam: 7.5, cor: CINZA, alinha: 'dir' }); }
    return d.bytes(`Relatório de pagamentos · ${R.professora} · ${R.periodo}`);
  }
  return { professora };
});

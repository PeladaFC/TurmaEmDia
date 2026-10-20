/* Escolinha · gerador de PDF simples (sem bibliotecas de fora).
   Texto em Helvetica e Helvetica-Bold (fontes padrão de todo leitor de PDF, com acentos do português),
   retângulos e linhas. Coordenadas em pontos, a partir do canto de cima à esquerda de uma folha A4. */
(function (root, fab) { if (typeof module === 'object' && module.exports) module.exports = fab(); else root.PdfSimples = fab(); })(this, function () {
  'use strict';
  const A4 = { w: 595.28, h: 841.89 };
  // larguras (1/1000 do tamanho da fonte) dos caracteres 32 a 126, tiradas das métricas da Helvetica
  const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const W_NEG = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  // caracteres fora do Latin-1 que o WinAnsi tem em outra posição
  const WIN = { '—': 0x97, '–': 0x96, '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92, '…': 0x85, '•': 0x95, '€': 0x80 };
  function codigo(ch) {
    if (WIN[ch]) return WIN[ch];
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) return c;
    if (c >= 160 && c <= 255) return c;
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return base && base.charCodeAt(0) < 127 ? base.charCodeAt(0) : 63; // '?'
  }
  function larguraCar(c, neg) {
    if (c >= 32 && c <= 126) return (neg ? W_NEG : W_REG)[c - 32];
    if (c === 0x97 || c === 0x85) return 1000; if (c === 0x96 || c === 0x95) return 556; if (c === 0xB7) return 278;
    if (c >= 160) { const b = String.fromCharCode(c).normalize('NFD').replace(/[̀-ͯ]/g, ''); const k = b.charCodeAt(0); if (k >= 32 && k <= 126) return (neg ? W_NEG : W_REG)[k - 32]; }
    return 556;
  }
  const largura = (txt, tam, neg) => [...String(txt)].reduce((s, ch) => s + larguraCar(codigo(ch), neg), 0) * tam / 1000;
  function emPdf(txt) { let o = ''; for (const ch of String(txt)) { const c = codigo(ch); const s = String.fromCharCode(c); o += (s === '(' || s === ')' || s === '\\') ? '\\' + s : s; } return o; }
  // corta o texto para caber na largura, com reticências
  function caber(txt, tam, neg, max) {
    txt = String(txt ?? ''); if (largura(txt, tam, neg) <= max) return txt;
    while (txt.length && largura(txt + '…', tam, neg) > max) txt = txt.slice(0, -1);
    return txt.trimEnd() + '…';
  }
  const cor = c => { const h = String(c || '#000000').replace('#', ''); return [0, 2, 4].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' '); };

  function Documento() {
    const paginas = [], imagens = []; let ops = null;
    const doc = {
      w: A4.w, h: A4.h,
      novaPagina() { ops = []; paginas.push(ops); return doc; },
      get pagina() { return paginas.length; },
      irPara(i) { ops = paginas[i]; return doc; },
      texto(x, y, txt, o = {}) {
        const tam = o.tam || 10, neg = !!o.neg; let t = o.max ? caber(txt, tam, neg, o.max) : String(txt ?? '');
        let xx = x; if (o.alinha === 'dir') xx = x - largura(t, tam, neg); else if (o.alinha === 'meio') xx = x - largura(t, tam, neg) / 2;
        ops.push(`BT /${neg ? 'F2' : 'F1'} ${tam} Tf ${cor(o.cor)} rg ${xx.toFixed(2)} ${(A4.h - y).toFixed(2)} Td (${emPdf(t)}) Tj ET`);
        return doc;
      },
      ret(x, y, w, h, c) { ops.push(`${cor(c)} rg ${x.toFixed(2)} ${(A4.h - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); return doc; },
      linha(x1, y1, x2, y2, c, esp = 0.5) { ops.push(`${cor(c)} RG ${esp} w ${x1.toFixed(2)} ${(A4.h - y1).toFixed(2)} m ${x2.toFixed(2)} ${(A4.h - y2).toFixed(2)} l S`); return doc; },
      // imagem JPEG (base64), desenhada na caixa x, y, w, h
      imagem(x, y, w, h, im) {
        let i = imagens.findIndex(q => q.jpg === im.jpg); if (i < 0) { imagens.push({ jpg: im.jpg, w: im.w, h: im.h }); i = imagens.length - 1; }
        ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(A4.h - y - h).toFixed(2)} cm /Im${i + 1} Do Q`); return doc;
      },
      largura, caber,
      // o PDF pronto, como bytes (Uint8Array)
      bytes(titulo) {
        const obj = [], add = s => { obj.push(s); return obj.length; };
        const cat = add(null), pags = add(null);
        const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        const ims = imagens.map(im => { const b = atob(im.jpg); return add(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${b.length} >>\nstream\n${b}\nendstream`); });
        const xo = ims.length ? ` /XObject << ${ims.map((n, i) => `/Im${i + 1} ${n} 0 R`).join(' ')} >>` : '';
        const kids = paginas.map(p => { const corpo = p.join('\n'), c = add(`<< /Length ${corpo.length} >>\nstream\n${corpo}\nendstream`);
          return add(`<< /Type /Page /Parent ${pags} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xo} >> /Contents ${c} 0 R >>`); });
        obj[cat - 1] = `<< /Type /Catalog /Pages ${pags} 0 R >>`;
        obj[pags - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
        const info = add(`<< /Title (${emPdf(titulo || 'Relatório')}) /Producer (Escolinha) >>`);
        let s = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const pos = [];
        obj.forEach((o, i) => { pos.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
        const xref = s.length;
        s += `xref\n0 ${obj.length + 1}\n0000000000 65535 f \n` + pos.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('');
        s += `trailer\n<< /Size ${obj.length + 1} /Root ${cat} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`;
        const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b;
      }
    };
    return doc.novaPagina();
  }
  return { Documento, largura, caber };
});

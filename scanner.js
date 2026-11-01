/* Turma em Dia · "escanear" documento na foto, como as Notas do iPhone (sem bibliotecas de fora).
   detectar(canvas): acha as bordas do papel (linhas fortes, transformada de Hough) e devolve os 4 cantos
                     [sup. esq., sup. dir., inf. dir., inf. esq.] em pixels do canvas, ou null.
   endireitar(canvas, cantos, max): corta e endireita (perspectiva) para um retângulo.
   realcar(canvas): papel mais branco e texto mais nítido, como um scanner. */
(function (root, fab) { if (typeof module === 'object' && module.exports) module.exports = fab(); else root.Scanner = fab(); })(this, function () {
  'use strict';

  // ---------- detecção das bordas ----------
  function detectar(fonte) {
    const MAX = 360, f = Math.min(1, MAX / Math.max(fonte.width, fonte.height));
    const W = Math.max(8, Math.round(fonte.width * f)), H = Math.max(8, Math.round(fonte.height * f));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(fonte, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data, N = W * H;
    // cinza + um pouco de cor (o papel costuma ter cor diferente do fundo)
    let cinza = new Float32Array(N);
    for (let i = 0; i < N; i++) { const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); cinza[i] = 0.299 * r + 0.587 * gg + 0.114 * b + 0.35 * (mx - mn); }
    // desfoca duas vezes (tira a textura do fundo: tecido, madeira…)
    for (let k = 0; k < 3; k++) cinza = desfocar(cinza, W, H);
    // gradiente (Sobel)
    const mag = new Float32Array(N), ang = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, a = cinza[i - W - 1], b = cinza[i - W], cc = cinza[i - W + 1], d = cinza[i - 1], e = cinza[i + 1], ff = cinza[i + W - 1], gg2 = cinza[i + W], h = cinza[i + W + 1];
      const gx = (cc + 2 * e + h) - (a + 2 * d + ff), gy = (ff + 2 * gg2 + h) - (a + 2 * b + cc);
      mag[i] = Math.hypot(gx, gy); ang[i] = Math.atan2(gy, gx);
    }
    // só as bordas mais fortes
    const ord = Float32Array.from(mag).sort(), corte = Math.max(8, ord[Math.floor(N * 0.9)]);
    // Hough: cada ponto de borda vota na reta perpendicular ao gradiente dele
    const NT = 180, R = Math.ceil(Math.hypot(W, H)), acc = new Float32Array(NT * (2 * R + 1));
    const cosT = new Float32Array(NT), sinT = new Float32Array(NT);
    for (let t = 0; t < NT; t++) { cosT[t] = Math.cos(t * Math.PI / NT); sinT[t] = Math.sin(t * Math.PI / NT); }
    const borda = new Uint8Array(N);
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x; if (mag[i] < corte) continue; borda[i] = 1;
      let t0 = Math.round(((ang[i] + Math.PI) % Math.PI) / Math.PI * NT) % NT;
      for (let dt = -4; dt <= 4; dt++) { const t = (t0 + dt + NT) % NT, r = Math.round(x * cosT[t] + y * sinT[t]); acc[t * (2 * R + 1) + r + R] += mag[i]; }
    }
    // picos (as retas mais votadas), sem repetir retas quase iguais
    const picos = [];
    for (let t = 0; t < NT; t++) for (let r = -R; r <= R; r++) { const v = acc[t * (2 * R + 1) + r + R]; if (v > 0) picos.push([v, t, r]); }
    picos.sort((p, q) => q[0] - p[0]);
    const retas = [];
    for (const [v, t, r] of picos) {
      if (retas.length >= 24) break;
      if (retas.some(q => { const dt = Math.min(Math.abs(q.t - t), NT - Math.abs(q.t - t)); return dt < 8 && Math.abs((dt === Math.abs(q.t - t) ? q.r : -q.r) - r) < Math.max(W, H) * 0.04; })) continue;
      retas.push({ t, r, v, c: cosT[t], s: sinT[t] });
    }
    // horizontais e verticais (até 35° de inclinação)
    const horiz = retas.filter(l => Math.abs(l.t - 90) <= 35).slice(0, 8), vert = retas.filter(l => l.t <= 35 || l.t >= 145).slice(0, 8);
    const cruza = (a, b) => { const d = a.c * b.s - a.s * b.c; if (Math.abs(d) < 1e-6) return null; return { x: (a.r * b.s - a.s * b.r) / d, y: (a.c * b.r - a.r * b.c) / d }; };
    // quanto do lado do quadrilátero passa por borda forte
    const apoio = (p, q) => { const n = Math.max(8, Math.round(Math.hypot(q.x - p.x, q.y - p.y))); let ok = 0;
      for (let k = 0; k <= n; k++) { const x = Math.round(p.x + (q.x - p.x) * k / n), y = Math.round(p.y + (q.y - p.y) * k / n); let achou = 0;
        for (let dy = -2; dy <= 2 && !achou; dy++) for (let dx = -2; dx <= 2 && !achou; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && borda[yy * W + xx]) achou = 1; }
        ok += achou; } return ok / (n + 1); };
    let melhor = null;
    for (let i = 0; i < horiz.length; i++) for (let j = i + 1; j < horiz.length; j++) for (let k = 0; k < vert.length; k++) for (let m = k + 1; m < vert.length; m++) {
      let [h1, h2] = [horiz[i], horiz[j]], [v1, v2] = [vert[k], vert[m]];
      const ps = [cruza(h1, v1), cruza(h1, v2), cruza(h2, v2), cruza(h2, v1)]; if (ps.some(p => !p)) continue;
      const q = ordenar(ps); if (!q) continue;
      if (q.some(p => p.x < -W * 0.04 || p.y < -H * 0.04 || p.x > W * 1.04 || p.y > H * 1.04)) continue;
      const area = areaQuad(q) / (W * H); if (area < 0.12 || area > 0.985) continue;
      if (!convexo(q)) continue;
      const lados = [0, 1, 2, 3].map(a => apoio(q[a], q[(a + 1) % 4])), minimo = Math.min(...lados);
      if (minimo < 0.35) continue;
      const nota = (lados.reduce((x, y) => x + y, 0) / 4) * (0.55 + 0.45 * Math.sqrt(area)) * (0.7 + 0.3 * minimo);
      if (!melhor || nota > melhor.nota) melhor = { nota, q };
    }
    if (!melhor) return null;
    return melhor.q.map(p => ({ x: clamp(p.x / f, 0, fonte.width), y: clamp(p.y / f, 0, fonte.height) }));
  }
  function desfocar(a, W, H) {
    const b = new Float32Array(a.length), c = new Float32Array(a.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; b[i] = (a[i - (x > 0 ? 1 : 0)] + a[i] + a[i + (x < W - 1 ? 1 : 0)]) / 3; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; c[i] = (b[i - (y > 0 ? W : 0)] + b[i] + b[i + (y < H - 1 ? W : 0)]) / 3; }
    return c;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // cantos na ordem: sup. esq., sup. dir., inf. dir., inf. esq.
  function ordenar(ps) {
    const cx = ps.reduce((s, p) => s + p.x, 0) / 4, cy = ps.reduce((s, p) => s + p.y, 0) / 4;
    const q = ps.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)); // começa no canto de cima à esquerda (ângulo mais negativo)
    let i0 = 0, menor = Infinity; q.forEach((p, i) => { const s = p.x + p.y; if (s < menor) { menor = s; i0 = i; } });
    return [0, 1, 2, 3].map(k => q[(i0 + k) % 4]);
  }
  const areaQuad = q => Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % 4]; return s + p.x * n.y - n.x * p.y; }, 0)) / 2;
  function convexo(q) { let sinal = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4], z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x); if (Math.abs(z) < 1e-6) return false; const s = Math.sign(z); if (sinal && s !== sinal) return false; sinal = s; } return true; }

  // ---------- endireitar (perspectiva) ----------
  // homografia que leva o retângulo [0,w]x[0,h] para o quadrilátero q
  function homografia(w, h, q) {
    const src = [[0, 0], [w, 0], [w, h], [0, h]], A = [], B = [];
    for (let i = 0; i < 4; i++) { const [x, y] = src[i], X = q[i].x, Y = q[i].y;
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); B.push(X); A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); B.push(Y); }
    const s = resolver(A, B); return s ? [...s, 1] : null;
  }
  function resolver(A, B) {
    const n = B.length, M = A.map((l, i) => [...l, B[i]]);
    for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-10) return null; [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
    return M.map((l, i) => l[n] / l[i]);
  }
  function endireitar(fonte, q, max = 1600) {
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let w = Math.max(d(q[0], q[1]), d(q[3], q[2])), h = Math.max(d(q[0], q[3]), d(q[1], q[2]));
    const f = Math.min(1, max / Math.max(w, h)); w = Math.max(16, Math.round(w * f)); h = Math.max(16, Math.round(h * f));
    const Hm = homografia(w, h, q); if (!Hm) return fonte;
    const sw = fonte.width, sh = fonte.height, sp = fonte.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const og = out.getContext('2d'), od = og.createImageData(w, h), o = od.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const z = Hm[6] * x + Hm[7] * y + 1, X = (Hm[0] * x + Hm[1] * y + Hm[2]) / z, Y = (Hm[3] * x + Hm[4] * y + Hm[5]) / z;
      const x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0, k = (y * w + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { o[k] = o[k + 1] = o[k + 2] = 255; o[k + 3] = 255; continue; }
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) o[k + c] = (sp[i00 + c] * (1 - fx) + sp[i10 + c] * fx) * (1 - fy) + (sp[i01 + c] * (1 - fx) + sp[i11 + c] * fx) * fy;
      o[k + 3] = 255;
    }
    og.putImageData(od, 0, 0); return out;
  }

  // ---------- realçar (como scanner) ----------
  // tira a sombra (divide pelo "fundo" desfocado), clareia o papel e escurece o texto
  function realcar(fonte) {
    const w = fonte.width, h = fonte.height, out = document.createElement('canvas'); out.width = w; out.height = h;
    const g = out.getContext('2d', { willReadFrequently: true }); g.drawImage(fonte, 0, 0);
    const im = g.getImageData(0, 0, w, h), p = im.data;
    // fundo: imagem bem pequena e desfocada (a luz do ambiente)
    const bw = Math.max(8, Math.round(w / 24)), bh = Math.max(8, Math.round(h / 24)), bc = document.createElement('canvas'); bc.width = bw; bc.height = bh;
    const bg = bc.getContext('2d', { willReadFrequently: true }); bg.filter = 'blur(2px)'; bg.drawImage(fonte, 0, 0, bw, bh);
    const big = document.createElement('canvas'); big.width = w; big.height = h; const gg = big.getContext('2d', { willReadFrequently: true });
    gg.imageSmoothingQuality = 'high'; gg.drawImage(bc, 0, 0, w, h); const fd = gg.getImageData(0, 0, w, h).data;
    for (let i = 0; i < p.length; i += 4) for (let c = 0; c < 3; c++) {
      let v = p[i + c] / Math.max(40, fd[i + c]) ; // 1 = papel
      v = Math.min(1, v * 1.08); v = v < 0.55 ? v * 0.75 : v; // texto mais escuro
      p[i + c] = Math.round(255 * Math.pow(v, 1.6));
    }
    g.putImageData(im, 0, 0); return out;
  }

  return { detectar, endireitar, realcar, ordenar };
});

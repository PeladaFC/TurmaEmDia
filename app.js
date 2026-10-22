/* Escolinha · app (administração da escola e área da família).
   Escola → locais → atividades → turmas. Cada aluno(a) pertence a uma família; o responsável
   paga tudo do mês num Pix só. Com ?mock=1 usa um banco de teste na memória, com dados de exemplo. */
const CFG = window.CONFIG || {}, C = window.Calc;
const MOCK = !!window.DEMO || new URLSearchParams(location.search).has('mock');
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const URLF = n => `https://${CFG.regiao || 'southamerica-east1'}-${(CFG.firebase || {}).projectId}.cloudfunctions.net/${n}`;
const MP_VOLTA = new URLSearchParams(location.search).get('mp');

/* ================= Banco ================= */
let B;
async function backendReal() {
  const [{ initializeApp }, A, F] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
  const app = initializeApp(CFG.firebase);
  const auth = A.getAuth(app); auth.languageCode = 'pt';
  // continua logado no aparelho até tocar em "Sair" (também no app instalado na tela inicial)
  await A.setPersistence(auth, A.browserLocalPersistence).catch(() => { });
  const fs = F.initializeFirestore(app, { ignoreUndefinedProperties: true });
  const ref = p => F.doc(fs, p);
  const erro = e => { const x = new Error(e.message); x.code = (e.code || '').replace(/^(auth|firestore)\//, ''); throw x; };
  const lista = s => s.docs.map(d => ({ id: d.id, data: d.data() }));
  return {
    onAuth: cb => A.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, nome: u.displayName || '', email: u.email || '' } : null)),
    login: (e, s) => A.signInWithEmailAndPassword(auth, e, s).catch(erro),
    cadastrar: async (nome, e, s) => { const c = await A.createUserWithEmailAndPassword(auth, e, s).catch(erro); await A.updateProfile(c.user, { displayName: nome }); return c; },
    google: async () => { const p = new A.GoogleAuthProvider();
      try { return await A.signInWithPopup(auth, p); } catch (e) { if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) return A.signInWithRedirect(auth, p); erro(e); } },
    reset: e => A.sendPasswordResetEmail(auth, e).catch(erro),
    verificarEmail: () => auth.currentUser ? A.sendEmailVerification(auth.currentUser).catch(erro) : null,
    sair: () => A.signOut(auth),
    token: async () => auth.currentUser ? auth.currentUser.getIdToken() : null,
    get: async p => { const s = await F.getDoc(ref(p)).catch(erro); return s.exists() ? s.data() : null; },
    set: (p, d, o) => F.setDoc(ref(p), d, o && o.merge ? { merge: true } : {}).catch(erro),
    tirar: (p, campo) => F.updateDoc(ref(p), { [campo]: F.deleteField() }).catch(erro),
    del: p => F.deleteDoc(ref(p)).catch(erro),
    ouvirDoc: (p, cb, err) => F.onSnapshot(ref(p), s => cb(s.exists() ? s.data() : null), e => err && err(e)),
    ouvirCol: (p, cb, err, onde) => F.onSnapshot(onde ? F.query(F.collection(fs, p), F.where(onde[0], '==', onde[1])) : F.collection(fs, p), s => cb(lista(s)), e => err && err(e)),
    lote: async ops => { const b = F.writeBatch(fs); for (const o of ops) { if (o.op === 'del') b.delete(ref(o.p)); else b.set(ref(o.p), o.d, o.op === 'merge' ? { merge: true } : {}); } await b.commit().catch(erro); }
  };
}
function backendMock() {
  // igual ao Firestore: lista dentro de lista não é aceita (pega o erro já no modo de teste)
  const aninhada = (v, p, dentro) => { if (Array.isArray(v)) { if (dentro) throw new Error('Nested arrays are not supported (' + p + ')'); v.forEach(x => aninhada(x, p, true)); } else if (v && typeof v === 'object') Object.values(v).forEach(x => aninhada(x, p, false)); };
  const store = new Map(), docL = new Map(), colL = [], users = new Map();
  let authCb = null, cur = null;
  const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
  const merge = (a, b) => { const o = (a && typeof a === 'object' && !Array.isArray(a)) ? { ...a } : {}; for (const k in b) { const v = b[k]; o[k] = (v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) ? merge(o[k], v) : v; } return o; };
  const parent = p => p.split('/').slice(0, -1).join('/');
  const colDocs = (c, onde) => [...store.keys()].filter(k => parent(k) === c).map(k => ({ id: k.split('/').pop(), data: clone(store.get(k)) })).filter(d => !onde || d.data[onde[0]] === onde[1]);
  const fire = p => setTimeout(() => {
    (docL.get(p) || []).forEach(cb => cb(clone(store.get(p)) ?? null));
    const c = parent(p); colL.filter(l => l.c === c).forEach(l => l.cb(colDocs(c, l.onde)));
  }, 0);
  let entregue;
  const setA = u => { cur = u; setTimeout(() => { if (authCb && entregue !== cur) { entregue = cur; authCb(cur); } }, 0); };
  const api = {
    onAuth: cb => { authCb = cb; setTimeout(() => { if (entregue !== cur || entregue === undefined) { entregue = cur; cb(cur); } }, 0); },
    login: async (e, s) => { const u = users.get(e); if (!u || u.s !== s) throw Object.assign(new Error('x'), { code: 'invalid-credential' }); setA(u.user); },
    cadastrar: async (nome, e, s) => { if (users.has(e)) throw Object.assign(new Error('x'), { code: 'email-already-in-use' }); const user = { uid: 'u' + (users.size + 1), nome, email: e }; users.set(e, { s, user }); setA(user); },
    google: async () => api.cadastrar('Teste Google', 'g' + Date.now() + '@gmail.com', 'x'),
    reset: async () => { }, sair: async () => setA(null), token: async () => cur ? 'mock' : null,
    get: async p => clone(store.get(p)) ?? null,
    set: async (p, d, o) => { aninhada(d, p); store.set(p, o && o.merge ? merge(store.get(p), clone(d)) : clone(d)); fire(p); },
    tirar: async (p, campo) => { const d = clone(store.get(p)) || {}; const ks = campo.split('.'); let o = d; for (const k of ks.slice(0, -1)) o = o[k] || {}; delete o[ks.at(-1)]; store.set(p, d); fire(p); },
    del: async p => { store.delete(p); fire(p); },
    ouvirDoc: (p, cb) => { setTimeout(() => cb(clone(store.get(p)) ?? null), 0); if (!docL.has(p)) docL.set(p, []); docL.get(p).push(cb); return () => docL.set(p, docL.get(p).filter(x => x !== cb)); },
    ouvirCol: (c, cb, err, onde) => { const l = { c, cb, onde }; setTimeout(() => cb(colDocs(c, onde)), 0); colL.push(l); return () => { const i = colL.indexOf(l); if (i >= 0) colL.splice(i, 1); }; },
    lote: async ops => { for (const o of ops) { if (o.op === 'del') await api.del(o.p); else await api.set(o.p, o.d, { merge: o.op === 'merge' }); } }
  };
  window.__mock = { store, users, cur: () => cur, trocar: async e => { await api.sair(); await api.login(e, '123456'); } };
  return api;
}

/* ================= Utilidades ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } } };
const novoId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const novoCodigo = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pad = n => String(n).padStart(2, '0');
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const mesHoje = () => hoje().slice(0, 7);
function mesMais(m, n) { let [y, mm] = m.split('-').map(Number); mm += n; while (mm < 1) { mm += 12; y--; } while (mm > 12) { mm -= 12; y++; } return `${y}-${pad(mm)}`; }
const nomeMesAno = m => { const t = `${C.nomeMes(m)} de ${m.slice(0, 4)}`; return t[0].toUpperCase() + t.slice(1); };
const dataBR = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '';
const iniciais = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const primeiro = n => String(n || '').trim().split(/\s+/)[0];
function parseValor(v) { const s = String(v ?? '').trim().replace(/\s|R\$/g, ''); if (!s) return NaN; const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; }
const fmtValor = v => v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ',');
const ERROS = {
  'invalid-credential': 'E-mail ou senha incorretos.', 'wrong-password': 'E-mail ou senha incorretos.', 'user-not-found': 'Não existe conta com esse e-mail.',
  'email-already-in-use': 'Já existe uma conta com esse e-mail. Toque em "Já tenho conta".', 'invalid-email': 'Esse e-mail não parece válido.',
  'weak-password': 'A senha precisa ter pelo menos 6 caracteres.', 'too-many-requests': 'Muitas tentativas. Espere um pouco e tente de novo.',
  'network-request-failed': 'Sem internet. Verifique a conexão.', 'popup-closed-by-user': 'O login com Google foi fechado antes de terminar.',
  'permission-denied': 'Você não tem permissão para isso.', 'unavailable': 'Sem conexão com o servidor. Tente de novo.'
};
const msgErro = e => ERROS[e && e.code] || (e && e.message && !/firebase|undefined/i.test(e.message) ? e.message : 'Algo deu errado. Tente de novo.');
function aviso(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(aviso.t); aviso.t = setTimeout(() => t.hidden = true, 3200); }
async function copiar(txt, ok) { try { await navigator.clipboard.writeText(txt); aviso(ok || 'Copiado'); } catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); aviso(ok || 'Copiado'); } catch (_) { aviso('Não deu para copiar. Selecione o texto e copie.'); } ta.remove(); } }
function qrSVG(txt) { if (typeof qrcode !== 'function') return ''; const q = qrcode(0, 'M'); q.addData(txt); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
const LINK_APP = location.origin + location.pathname;
const ICO = {
  evento: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M12 13.2l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  painel: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  cobr: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
  alunas: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><path d="M12 7v7l-4 7M12 14l4 7M5 10c4 2 10 2 14 0"/></svg>',
  escola: '<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/></svg>',
  caixa: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M16 15h2"/></svg>',
  filhas: '<svg viewBox="0 0 24 24"><circle cx="9" cy="7" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M14.5 20c0-2.5 1.2-4.6 3.5-4.6S21 17.5 21 20"/></svg>',
  voltar: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  troca: '<svg viewBox="0 0 24 24"><path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7"/></svg>',
  relat: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>'
};

/* ================= Estado ================= */
let EU = null, MINHAS = {}, S = null, OUV = [];
const RAIZ = () => $('raiz');
function pararOuvintes() { OUV.forEach(f => { try { f(); } catch (e) { } }); OUV = []; }

/* ================= Login ================= */
const MARCA_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="4" y="9" width="56" height="51" rx="15" fill="currentColor"/><rect x="17" y="3" width="7" height="14" rx="3.5" fill="currentColor" stroke="var(--marca-borda,#fff)" stroke-width="3"/><rect x="40" y="3" width="7" height="14" rx="3.5" fill="currentColor" stroke="var(--marca-borda,#fff)" stroke-width="3"/><path d="M19 36.5l9 9 17-18" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const NOME_APP = () => CFG.nomeApp || 'Turma em Dia';
// topo da página inicial: marca, nome, para que serve e as três vantagens
function capaApp(compacta) {
  const vant = [['cobr', 'Cobrança por aluno, Pix com baixa automática', 'Mensalidade, evento, competição e taxa, cada um com seu vencimento.'],
    ['filhas', 'A família escolhe o que pagar', 'De um filho ou de todos, num Pix só, pelo celular.'],
    ['caixa', 'Tudo organizado para a escola', 'Atrasados, acordos, relatório de cada professor(a) e o caixa do mês.']];
  return `<div class="capa ${compacta ? 'compacta' : ''}">
      <div class="capa-marca">${MARCA_SVG}</div>
      <h1 class="capa-nome">${esc(NOME_APP())}</h1>
      <p class="capa-frase">As mensalidades da sua escolinha em dia, por Pix.</p>
      ${compacta ? '' : '<p class="capa-sub">Para escolinhas de esporte, dança, luta, música e o que mais for.</p>'}
    </div>`;
}
function vantagensApp() {
  const vant = [['cobr', 'Cobrança por aluno, Pix com baixa automática', 'Mensalidade, evento, competição e taxa, cada um com seu vencimento.'],
    ['filhas', 'A família escolhe o que pagar', 'De um filho ou de todos, num Pix só, pelo celular.'],
    ['caixa', 'Tudo organizado para a escola', 'Atrasados, acordos, relatório de cada professor(a) e o caixa do mês.']];
  return `<section><h2>O que o app faz</h2><ul class="vantagens">${vant.map(([ic, t, d]) => `<li><span class="vant-ic">${ICO[ic] || ''}</span><span class="grow"><b>${esc(t)}</b><span class="s">${esc(d)}</span></span></li>`).join('')}</ul></section>`;
}
/* Abertura como app: 1) marca e nome aparecem e somem; 2) os tópicos do que o app faz sobem um a um; 3) entrada. */
let ABERTURA = null, ABERTURA_PRONTA = Promise.resolve(), INTRO_VISTA = ls.get('escolinha.introVista') === '1';
const MOVIMENTO = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
/* T.E.D. → Turma em Dia: começa com "T.E.D."; os pontos somem, o T, o E e o D se afastam e as letras entram no meio.
   As três palavras se completam juntas. Larguras medidas com a própria fonte, para o movimento ser liso. */
function nomeAbertura(el, t0) {
  const m = document.createElement('span'); m.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'; el.appendChild(m);
  const medir = ch => { m.textContent = ch; return m.getBoundingClientRect().width; };
  const passo = 110, grupos = [['T', 'urma'], ['E', 'm'], ['D', 'ia']], wE = medir('E'), we = medir('e');
  let html = '';
  grupos.forEach(([L, r], g) => {
    if (g) html += `<span class="ab-c" style="--w:${medir(' ')}px;--d:${t0}ms">&nbsp;</span>`;
    html += g === 1 ? `<span class="ab-E" style="--wE:${wE}px;--we:${we}px"><i class="e0">E</i><i class="e1">E</i><i class="e2">e</i></span>` : `<span>${L}</span>`;
    html += `<span class="ab-p" style="--w:${medir('.')}px">.</span>`;
    [...r].forEach((ch, i) => { html += `<span class="ab-c" style="--w:${medir(ch)}px;--d:${t0 + 150 + (4 - r.length + i) * passo}ms">${ch}</span>`; });
  });
  el.innerHTML = html; el.style.setProperty('--t0', t0 + 'ms');
  return t0 + 150 + 4 * passo + 900;
}

function mostrarAbertura() {
  const el = document.createElement('div'); el.id = 'abertura'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="ab-marca">${MARCA_SVG}</div><div class="ab-nome">${esc(NOME_APP())}</div>`;
  document.body.appendChild(el);
  // ABERTURA_PRONTA: o nome terminou de se formar; a abertura fica na tela até alguém decidir para onde ir
  ABERTURA_PRONTA = (async () => {
    let dura = 500;
    if (MOVIMENTO) {
      // espera a fonte (no máximo meio segundo) para medir as letras certinho
      try { await Promise.race([document.fonts.load('800 40px "Bricolage Grotesque"'), new Promise(r => setTimeout(r, 500))]); } catch (e) { }
      dura = nomeAbertura(el.querySelector('.ab-nome'), 2200) + 700;
    }
    await new Promise(r => setTimeout(r, dura));
  })();
  ABERTURA = ABERTURA_PRONTA;
  return ABERTURA;
}
const abEl = () => document.getElementById('abertura');
// sai da abertura do jeito simples (esmaece): login, sem escola, Minhas escolas
function sairAbertura() {
  const el = abEl(); if (!el) return Promise.resolve();
  if (el._saindo) return el._saindo;
  el._saindo = (async () => {
    await ABERTURA_PRONTA;
    el.classList.add('saindo');
    await new Promise(r => setTimeout(r, MOVIMENTO ? 700 : 50));
    el.remove();
  })();
  ABERTURA = el._saindo;
  return el._saindo;
}
// cor e logo de cada escola ficam guardadas no aparelho, para a abertura já sair com a cara da escola
const marcaGuardada = eid => { try { return JSON.parse(ls.get('escolinha.marca.' + eid) || 'null'); } catch (e) { return null; } };
async function marcaDa(eid) {
  const g = marcaGuardada(eid); if (g) return g;
  try { const c = await Promise.race([B.get(`escolas/${eid}/config/geral`), new Promise(r => setTimeout(() => r(null), 1500))]); return c ? { cor: c.cor || '', logo: c.logo || '' } : {}; } catch (e) { return {}; }
}
// abre a escola a partir da abertura: a tela se parte em cartas que viram em ordem aleatória; cada carta passa por
// preto → cor escura da escola → um clarão e mostra no verso um pedaço da tela da escola (cor, logo e nome).
// Tudo desenhado num canvas: são ~180 cartas, e com elementos da página o celular engasgaria.
const esperaImg = src => new Promise(ok => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; setTimeout(() => ok(i.complete && i.naturalWidth ? i : null), 1500); });
function fundoRadial(ctx, W, H, c1, c2) {
  const rx = 1.2 * W, ry = 0.9 * H; ctx.save(); ctx.translate(W / 2, H * 0.38); ctx.scale(rx / ry, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry); g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(-W, -H, 3 * W, 3 * H); ctx.restore();
}
function linhasTexto(ctx, txt, max) {
  const out = []; let l = '';
  for (const w of txt.split(/\s+/)) { const t = l ? l + ' ' + w : w; if (l && ctx.measureText(t).width > max) { out.push(l); l = w; } else l = t; }
  if (l) out.push(l); return out;
}
async function abrirComCartas(eid, tab) {
  let el = abEl();
  if (!MOVIMENTO) { if (el) sairAbertura(); return abrirEscola(eid, tab); }
  // sem a abertura na tela (trocando de escola por dentro do app): uma tela do Turma em Dia surge rápido e as cartas viram dela
  const nova = !el;
  if (nova) { el = document.createElement('div'); el.id = 'abertura'; el.setAttribute('aria-hidden', 'true'); el.style.opacity = '0'; document.body.appendChild(el); }
  else await ABERTURA_PRONTA;
  const box = el.querySelector('.ab-esc');
  if (box) { box.style.transition = 'opacity .2s ease'; box.style.opacity = '0'; }
  const m = await marcaDa(eid), nome = (MINHAS[eid] || {}).nome || 'Escola';
  const cor = hexOk(m.cor) ? m.cor : COR_PADRAO, logo = await esperaImg(m.logo);
  const claro = contraste(cor, '#FFFFFF') < 3, tinta = claro ? '#1A2030' : '#FFFFFF', corForte = claro ? mistura(cor, '#000000', 0.45) : cor; // cor clara: texto escuro
  try { await Promise.race([document.fonts.load('italic 800 32px "Barlow Condensed"'), new Promise(r => setTimeout(r, 600))]); } catch (e) { }
  const W = innerWidth, H = innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  const tela = () => { const c = document.createElement('canvas'); c.width = W * dpr; c.height = H * dpr; const x = c.getContext('2d'); x.scale(dpr, dpr); return [c, x]; };
  // frente: a abertura como está (marca e nome do app, ou só o fundo se estava escolhendo a escola)
  const [F, fx] = tela(), app = COR_PADRAO;
  fundoRadial(fx, W, H, mistura(app, '#FFFFFF', 0.10), mistura(app, '#000000', 0.38));
  if (!box) {
    const am = el.querySelector('.ab-marca'), an = el.querySelector('.ab-nome');
    const q = Math.min(176, Math.round(W * 0.45)), mr = am ? am.getBoundingClientRect() : { left: W / 2 - q / 2, top: H / 2 - q / 2 - 40, width: q, height: q };
    const nr = an ? an.getBoundingClientRect() : { left: 0, top: H / 2 + q / 2 - 18, width: W, height: 46 };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="9" width="56" height="51" rx="15" fill="rgba(255,255,255,.14)" stroke="#fff" stroke-width="3"/><rect x="17" y="3" width="7" height="14" rx="3.5" fill="#fff" stroke="${app}" stroke-width="3"/><rect x="40" y="3" width="7" height="14" rx="3.5" fill="#fff" stroke="${app}" stroke-width="3"/><path d="M19 36.5l9 9 17-18" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const mi = await esperaImg('data:image/svg+xml,' + encodeURIComponent(svg));
    if (mi) fx.drawImage(mi, mr.left, mr.top, mr.width, mr.height);
    fx.fillStyle = '#fff'; fx.font = '800 40px "Bricolage Grotesque", "Trebuchet MS", sans-serif'; fx.textAlign = 'center'; fx.textBaseline = 'middle';
    fx.fillText(NOME_APP(), nr.left + nr.width / 2, nr.top + nr.height / 2);
  }
  // verso: a tela da escola
  const [V, vx] = tela();
  fundoRadial(vx, W, H, mistura(cor, '#FFFFFF', 0.12), mistura(cor, '#000000', 0.30));
  vx.font = 'italic 800 36px "Barlow Condensed", "Arial Narrow", sans-serif'; vx.textAlign = 'center'; vx.textBaseline = 'top';
  const Q = Math.min(176, Math.round(W * 0.45)), ls2 = linhasTexto(vx, nome.toUpperCase(), W - 48), alto = Q + 22 + ls2.length * 37; let y = (H - alto) / 2;
  vx.save(); vx.shadowColor = 'rgba(0,0,0,.25)'; vx.shadowBlur = 30; vx.shadowOffsetY = 10; vx.fillStyle = '#fff';
  vx.beginPath(); vx.roundRect ? vx.roundRect(W / 2 - Q / 2, y, Q, Q, Q * 0.2) : vx.rect(W / 2 - Q / 2, y, Q, Q); vx.fill(); vx.restore();
  if (logo) { const L = Q * 0.84, k = Math.min(L / logo.naturalWidth, L / logo.naturalHeight), lw = logo.naturalWidth * k, lh = logo.naturalHeight * k; vx.drawImage(logo, W / 2 - lw / 2, y + Q / 2 - lh / 2, lw, lh); }
  else { vx.fillStyle = corForte; vx.font = `italic 800 ${Math.round(Q * 0.38)}px "Barlow Condensed", "Arial Narrow", sans-serif`; vx.textBaseline = 'middle'; vx.fillText(iniciais(nome), W / 2, y + Q / 2 + 2); vx.font = 'italic 800 36px "Barlow Condensed", "Arial Narrow", sans-serif'; vx.textBaseline = 'top'; }
  vx.fillStyle = tinta; y += Q + 22; ls2.forEach((l, i) => vx.fillText(l, W / 2, y + i * 37));
  // as cartas
  const n = W < 600 ? 9 : 16, s = W / n, lin = Math.ceil(H / s), cartas = [];
  for (let r = 0; r < lin; r++) for (let c = 0; c < n; c++) cartas.push({ x: c * s, y: r * s, d: Math.random() * 760 });
  const fim = Math.max(...cartas.map(k => k.d)) + 620, VIRA = 360, COR = 600;
  const escura = mistura(cor, '#000000', 0.5), clara = '#F6F3EE';
  const cv = document.createElement('canvas'); cv.className = 'ab-cartas'; cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const mix = (a, b, t) => mistura(a, b, Math.max(0, Math.min(1, t)));
  const quadro = t => {
    ctx.fillStyle = '#0d0b09'; ctx.fillRect(0, 0, W, H);
    for (const k of cartas) {
      const lt = t - k.d, sw = s * dpr, sx = k.x * dpr, sy = k.y * dpr;
      if (lt <= 0) { ctx.drawImage(F, sx, sy, sw + dpr, sw + dpr, k.x, k.y, s + 1, s + 1); continue; }
      const p = Math.min(1, lt / VIRA), e = p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2, ang = e * Math.PI, w = Math.abs(Math.cos(ang)) * (s + 1);
      const x0 = k.x + (s + 1 - w) / 2;
      if (ang < Math.PI / 2) { ctx.drawImage(F, sx, sy, sw + dpr, sw + dpr, x0, k.y, w, s + 1); continue; }
      ctx.drawImage(V, sx, sy, sw + dpr, sw + dpr, x0, k.y, w, s + 1);
      // o clarão por cima do verso: preto → cor escura da escola → branco → some
      const q = Math.min(1, lt / COR); let c, a = 1;
      if (q < .3) c = '#0d0b09'; else if (q < .55) c = mix('#0d0b09', escura, (q - .3) / .25); else if (q < .78) c = mix(escura, clara, (q - .55) / .23); else { c = clara; a = 1 - (q - .78) / .22; }
      if (a > 0) { ctx.globalAlpha = a; ctx.fillStyle = c; ctx.fillRect(x0, k.y, w, s + 1); ctx.globalAlpha = 1; }
    }
  };
  quadro(0); el.appendChild(cv); el.classList.add('virando');
  if (nova) { el.style.transition = 'opacity .2s ease'; void el.offsetWidth; el.style.opacity = '1'; await new Promise(r => setTimeout(r, 380)); el.style.transition = ''; }
  abrirEscola(eid, tab); // o app vai carregando por baixo, escondido pelas cartas
  await new Promise(ok => { const t0 = performance.now(); const passo = now => { const t = now - t0; quadro(Math.min(t, fim)); if (t < fim) requestAnimationFrame(passo); else ok(); }; requestAnimationFrame(passo); });
  ctx.drawImage(V, 0, 0, W, H);
  await new Promise(r => setTimeout(r, 900));
  el.style.opacity = '0';
  await new Promise(r => setTimeout(r, 500));
  el.remove();
}
// mais de uma escola: o nome sobe e some, e as escolas aparecem como botões
// "Trocar escola" de dentro do app: a mesma tela de escolha da abertura surge por cima; Cancelar volta para onde estava
function trocarEscola() {
  if (abEl()) return;
  const el = document.createElement('div'); el.id = 'abertura'; el.style.opacity = '0'; el.style.transition = 'opacity .25s ease';
  document.body.appendChild(el); void el.offsetWidth; el.style.opacity = '1';
  setTimeout(() => { el.style.transition = ''; }, 260);
  escolherNaAbertura({ atual: S && S.eid });
}
async function escolherNaAbertura(op = {}) {
  const el = abEl(); if (!el) return telaInicio();
  // cor e logo de cada escola: as que ainda não estão guardadas no aparelho vêm do servidor (no máximo 1,5 s)
  await Promise.all(Object.keys(MINHAS).filter(eid => !marcaGuardada(eid)).map(async eid => { const m = await marcaDa(eid); if (m && (m.cor || m.logo)) ls.set('escolinha.marca.' + eid, JSON.stringify(m)); }));
  await ABERTURA_PRONTA;
  const lista = Object.entries(MINHAS).sort((a, b) => String(a[1].nome || '').localeCompare(String(b[1].nome || ''), 'pt-BR'));
  const papel = e => e.papel === 'admin' ? 'Administração' : e.papel === 'professora' ? 'Professor(a)' : 'Responsável' + (e.familia ? ' · ' + e.familia : '');
  const box = document.createElement('div'); box.className = 'ab-esc';
  box.innerHTML = `<h2>Qual escola?</h2>${lista.map(([eid, e], i) => { const m = marcaGuardada(eid) || {}, c = hexOk(m.cor) ? m.cor : COR_PADRAO;
    const claro = contraste(c, '#FFFFFF') < 3, ci = claro ? '#1A2030' : '#FFFFFF', cd = claro ? mistura(c, '#000000', 0.45) : c; // cor clara: texto escuro
    return `<button type="button" class="ab-bt${String(e.nome || '').length > 20 ? ' longo' : ''}" data-abe="${esc(eid)}" style="--d:${380 + i * 110}ms;--c:${c};--ci:${ci};--cd:${cd}">${m.logo ? `<img src="${esc(m.logo)}" alt="">` : `<span class="ini">${esc(iniciais(e.nome))}</span>`}<span class="grow"><b>${esc(e.nome || 'Escola')}</b><span class="s">${eid === op.atual ? 'Você está aqui · ' : ''}${esc(papel(e))}</span></span></button>`; }).join('')}
    <div class="ab-rodape" style="--d:${380 + lista.length * 110}ms"><button type="button" class="ab-mais">Outras opções</button>${op.atual ? '<button type="button" class="ab-mais" id="abcancela">Cancelar</button>' : ''}</div>`;
  el.removeAttribute('aria-hidden'); el.classList.add('escolhe'); el.appendChild(box);
  box.querySelectorAll('[data-abe]').forEach(b => b.onclick = () => { box.querySelectorAll('button').forEach(x => x.disabled = true); abrirComCartas(b.dataset.abe); });
  box.querySelector('.ab-mais').onclick = () => { telaInicio(); sairAbertura(); };
  const fechar = () => { el.style.transition = 'opacity .25s ease'; el.style.opacity = '0'; setTimeout(() => el.remove(), 260); };
  if (op.atual) { $('abcancela').onclick = fechar; box.querySelector(`[data-abe="${op.atual}"]`).onclick = fechar; }
}
// muito tempo com o app em segundo plano: na volta, abre de novo do começo (com a abertura)
let OCULTO_DESDE = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { OCULTO_DESDE = Date.now(); return; }
  if (OCULTO_DESDE && Date.now() - OCULTO_DESDE > 30 * 60 * 1000 && EU && !$('overlay').innerHTML) location.reload();
  OCULTO_DESDE = 0;
});
function telaIntro(depois) {
  INTRO_VISTA = true; ls.set('escolinha.introVista', '1');
  const vant = [['cobr', 'Cobrança por aluno', 'Mensalidade, evento, competição e taxa, cada um com seu vencimento. Pix com baixa automática.'],
    ['filhas', 'A família escolhe o que pagar', 'De um filho ou de todos, num Pix só, pelo celular.'],
    ['caixa', 'Tudo organizado para a escola', 'Atrasados, acordos, relatório de cada professor(a) e o caixa do mês.']];
  RAIZ().innerHTML = `<div class="intro">
    <div class="intro-topo"><span class="marca-mini">${MARCA_SVG}</span><b>${esc(NOME_APP())}</b><button class="intro-pular" id="ipular">Pular</button></div>
    <ul class="vantagens intro-lista">${vant.map(([ic, t, d], i) => `<li class="sobe" style="--d:${400 + i * 1100}ms"><span class="vant-ic">${ICO[ic] || ''}</span><span class="grow"><b>${esc(t)}</b><span class="s">${esc(d)}</span></span></li>`).join('')}</ul>
    <div class="intro-fim sobe" style="--d:${400 + vant.length * 1100}ms">
      <div class="intro-barra"><i></i></div>
      <button class="btn" id="iseguir" style="width:100%;padding:15px">Continuar</button>
    </div></div>`;
  let foi = false; const seguir = () => { if (foi) return; foi = true; clearTimeout(t); const r = RAIZ().firstElementChild; if (r && MOVIMENTO) { r.classList.add('saindo'); setTimeout(depois, 300); } else depois(); };
  const t = setTimeout(seguir, MOVIMENTO ? 8000 : 4000);
  $('iseguir').onclick = seguir; $('ipular').onclick = seguir;
}
function telaLogin(modo = 'entrar') {
  // primeira vez nesta abertura do app: espera a tela de abertura e mostra o que o app faz
  if (!INTRO_VISTA && modo === 'entrar') { return (ABERTURA || Promise.resolve()).then(() => { if (!EU) telaIntro(() => { if (!EU) telaLogin(modo); }); }); }
  // Por enquanto (modo de teste): entrada direta, sem e-mail e senha
  if (MOCK && modo !== 'senha') {
    RAIZ().innerHTML = `<div class="login entrada">
      ${capaApp(true)}
      <section class="entrar-box sobe" style="--d:150ms"><h2>Entrar como</h2>
        <button class="entrar-op" id="eadm"><span class="vant-ic forte">${ICO.painel || ICO.cobr}</span><span class="grow"><b>Administração</b><span class="s">Cobranças, alunos, turmas e financeiro da escola</span></span><span aria-hidden="true" class="seta">›</span></button>
        <button class="entrar-op" id="efam"><span class="vant-ic">${ICO.filhas}</span><span class="grow"><b>Responsável</b><span class="s">Ver e pagar as cobranças dos filhos</span></span><span aria-hidden="true" class="seta">›</span></button>
      </section>
      <div class="note sobe" style="text-align:center;--d:350ms">Modo de teste, com dados de exemplo. O login com senha fica para depois.</div>
      ${linksLegais()}
    </div>`;
    $('eadm').onclick = () => B.login('admin@teste.com', '123456');
    $('efam').onclick = () => B.login('familia@teste.com', '123456');
    return;
  }
  RAIZ().innerHTML = `<div class="login entrada">
    ${capaApp(true)}
    <h2 style="margin-top:6px">${modo === 'criar' ? 'Criar conta' : 'Entrar'}</h2>
    ${modo === 'criar' ? `<div class="field"><label for="lnome">Seu nome</label><input id="lnome" autocomplete="name"></div>` : ''}
    <div class="field"><label for="lmail">E-mail</label><input id="lmail" type="email" autocomplete="email" inputmode="email"></div>
    <div class="field"><label for="lsenha">Senha</label><input id="lsenha" type="password" autocomplete="${modo === 'criar' ? 'new-password' : 'current-password'}"></div>
    <div class="err" id="lerr" role="alert"></div>
    <button class="btn" id="lok">${modo === 'criar' ? 'Criar conta' : 'Entrar'}</button>
    <button class="btn ghost" id="ltroca">${modo === 'criar' ? 'Já tenho conta' : 'Criar conta'}</button>
    ${modo === 'entrar' ? `<button class="btn ghost" id="lreset" style="border:0;color:var(--muted)">Esqueci a senha</button>` : ''}
    <div class="or">ou</div>
    <button class="btn ghost" id="lgoogle">Entrar com Google</button>
    ${MOCK ? `<div class="banner"><span>Modo de teste. Administração: <b>admin@teste.com</b>; família: <b>familia@teste.com</b>; senha <b>123456</b>.</span></div>` : ''}
  </div>`;
  const err = m => $('lerr').textContent = m;
  $('ltroca').onclick = () => telaLogin(modo === 'criar' ? 'entrar' : 'criar');
  $('lgoogle').onclick = () => B.google().catch(e => err(msgErro(e)));
  if ($('lreset')) $('lreset').onclick = async () => { const e = $('lmail').value.trim(); if (!e) return err('Digite seu e-mail para receber o link de troca de senha.'); try { await B.reset(e); aviso('Enviamos um link para ' + e); } catch (x) { err(msgErro(x)); } };
  $('lok').onclick = async () => {
    const e = $('lmail').value.trim(), s = $('lsenha').value;
    if (!e || !s) return err('Preencha e-mail e senha.');
    $('lok').disabled = true;
    try { if (modo === 'criar') { const n = $('lnome').value.trim(); if (!n) { $('lok').disabled = false; return err('Digite seu nome.'); } await B.cadastrar(n, e, s); } else await B.login(e, s); }
    catch (x) { err(msgErro(x)); $('lok').disabled = false; }
  };
  $('lsenha').onkeydown = ev => { if (ev.key === 'Enter') $('lok').click(); };
}

/* ================= Minhas escolas ================= */
// convite direto para a administração: vale só para o e-mail convidado, e a pessoa aceita depois de entrar com ele
let CONVITES = [];
const chaveEmail = e => String(e || '').trim().toLowerCase().replace('@', '_at_').replace(/[^a-z0-9_-]/g, '_');
// chama uma função do servidor (no modo de teste, não existe servidor)
async function servidor(nome, corpo) {
  const t = await B.token().catch(() => null); if (!t) throw new Error('Entre na sua conta de novo.');
  let r; try { r = await fetch(URLF(nome), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(corpo) }); }
  catch (e) { throw new Error('Sem conexão com o servidor. Tente de novo.'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.erro || 'Não deu certo agora. Tente de novo.'), { code: j.codigo || '' });
  return j;
}
async function convitesPara(u) {
  if (!u || !u.email) return [];
  if (!MOCK) return (await servidor('adminConvite', { acao: 'listar' })).convites || [];
  const d = (await B.get('convitesAdm/' + chaveEmail(u.email))) || {};
  return Object.entries(d).filter(([, c]) => c && c.expira > Date.now()).map(([eid, c]) => ({ eid, ...c }));
}
async function responderConvite(c, aceita) {
  const k = chaveEmail(EU.email);
  if (!MOCK) {
    try { await servidor('adminConvite', { acao: aceita ? 'aceitar' : 'recusar', eid: c.eid }); }
    catch (e) { if (e.code === 'confirmar-email') { await B.verificarEmail(); confirmar('Confirme o seu e-mail', `Enviamos um link para <b>${esc(EU.email)}</b>. Abra o e-mail e toque no link. Depois entre de novo no app e toque em "Aceitar".`, 'Entendi', () => B.sair()); return; } throw e; }
    if (aceita) MINHAS[c.eid] = { nome: c.escola, papel: 'admin' };
  } else if (aceita) {
    const e0 = (await B.get('escolas/' + c.eid)) || {};
    await B.set('escolas/' + c.eid, { admins: [...new Set([...(e0.admins || []), EU.uid])], adminsInfo: { [EU.uid]: { nome: EU.nome || c.nome || '', email: EU.email || '', em: Date.now(), convidadoPor: c.por || null } }, convitesAdm: { [k]: null } }, { merge: true });
    await B.set('users/' + EU.uid, { escolas: { [c.eid]: { nome: e0.nome || c.escola || 'Escola', papel: 'admin' } } }, { merge: true });
    MINHAS[c.eid] = { nome: e0.nome || c.escola, papel: 'admin' };
  } else await B.set('escolas/' + c.eid, { convitesAdm: { [k]: null } }, { merge: true });
  if (MOCK) await B.set('convitesAdm/' + k, { [c.eid]: null }, { merge: true });
  CONVITES = CONVITES.filter(x => x.eid !== c.eid);
  if (aceita) { aviso('Pronto! Agora você faz parte da administração.'); abrirEscola(c.eid); } else { aviso('Convite recusado'); telaInicio(); }
}
let VOLTA_ESCOLA = null; // escola de onde veio para "Minhas escolas": a seta volta para ela
function telaInicio() {
  if (S && S.eid) VOLTA_ESCOLA = S.eid;
  pararOuvintes(); S = null;
  const lista = Object.entries(MINHAS), volta = VOLTA_ESCOLA && MINHAS[VOLTA_ESCOLA] ? VOLTA_ESCOLA : null;
  RAIZ().innerHTML = `<div class="wrap" style="padding-top:20px">
    <div class="brand"><span class="marca-mini">${MARCA_SVG}</span><h1><small>Olá, ${esc(primeiro(EU.nome) || 'tudo bem?')}</small>${esc(NOME_APP())}</h1><div class="acts">${volta ? `<button class="icon-btn" id="ivolta" aria-label="Voltar para ${esc(MINHAS[volta].nome || 'a escola')}">${ICO.voltar}</button>` : ''}</div></div>
    ${CONVITES.map(c => `<div class="hero consent"><div class="label">Convite</div><b>${esc(c.porNome || 'A escola')} convidou você para a administração da ${esc(c.escola || 'escola')}</b>
      <span class="sub">Você vai ver e cuidar das turmas, alunos e cobranças da escola. O convite vale até ${new Date(c.expira).toLocaleDateString('pt-BR')}.</span>
      <div class="actions"><button class="btn ghost" data-recusa-conv="${esc(c.eid)}">Recusar</button><button class="btn" data-aceita-conv="${esc(c.eid)}">Aceitar</button></div></div>`).join('')}
    <section>
      <h2>Minhas escolas</h2>
      ${lista.length ? `<ul class="list">${lista.map(([eid, e]) => `<li class="tap" data-e="${esc(eid)}"><div class="dot">${esc(iniciais(e.nome))}</div><div class="grow"><div class="t">${esc(e.nome || 'Escola')}</div><div class="s">${e.papel === 'admin' ? 'Administração' : e.papel === 'professora' ? 'Professor(a)' : 'Responsável' + (e.familia ? ' · ' + esc(e.familia) : '')}</div></div><span class="chip">${e.papel === 'admin' ? 'Admin' : e.papel === 'professora' ? 'Turmas' : 'Pagar'}</span></li>`).join('')}</ul>`
        : `<div class="empty"><b>Você ainda não está em nenhuma escola.</b><span>Se você é mãe, pai ou responsável, use o código que a escola mandou. Se você dirige a escola, crie a sua.</span></div>`}
    </section>
    <section>
      <h2>Sou responsável por um(a) aluno(a)</h2>
      <div class="field"><label for="icod">Código do responsável</label><input id="icod" maxlength="6" autocapitalize="characters" placeholder="Ex.: K7Q2MX" style="text-transform:uppercase;letter-spacing:.2em;font-weight:700"></div>
      <div class="err" id="ierr" role="alert"></div>
      <button class="btn" id="ientrar">Entrar com o código</button>
    </section>
    <section>
      <h2>Dirijo uma escola</h2>
      <button class="btn ghost" id="icriar">Criar minha escola</button>
    </section>
    <button class="btn ghost" id="isair" style="margin-top:8px">Sair da conta</button>
  </div>`;
  RAIZ().querySelectorAll('[data-e]').forEach(li => li.onclick = () => abrirComCartas(li.dataset.e)); // trocar de escola: passa o carteado
  RAIZ().querySelectorAll('[data-aceita-conv],[data-recusa-conv]').forEach(b => b.onclick = async () => { const eid = b.dataset.aceitaConv || b.dataset.recusaConv, c = CONVITES.find(x => x.eid === eid); if (!c) return; b.disabled = true;
    try { await responderConvite(c, !!b.dataset.aceitaConv); } catch (e) { aviso(msgErro(e)); b.disabled = false; } });
  if ($('ivolta')) $('ivolta').onclick = () => abrirEscola(volta);
  $('isair').onclick = () => confirmar('Sair da conta?', 'Para entrar de novo, você vai precisar do seu e-mail e senha (ou da conta Google).', 'Sair', () => { VOLTA_ESCOLA = null; B.sair(); });
  $('icriar').onclick = () => sheetCriarEscola();
  $('ientrar').onclick = async () => {
    const cod = $('icod').value.trim().toUpperCase(), err = m => $('ierr').textContent = m;
    if (!/^[A-Z0-9]{6}$/.test(cod)) return err('O código tem 6 letras e números. Confira na mensagem da escola.');
    $('ientrar').disabled = true;
    try {
      const c = await B.get('codigos/' + cod);
      if (!c || !c.rid) { $('ientrar').disabled = false; return err('Código não encontrado. Confira com a escola.'); }
      const jaMembro = await B.get(`escolas/${c.eid}/membros/${EU.uid}`).catch(() => null);
      if (!jaMembro) await B.set(`escolas/${c.eid}/membros/${EU.uid}`, { codigo: cod, nome: EU.nome || '', email: EU.email || '', em: Date.now() });
      await B.set(`escolas/${c.eid}/membros/${EU.uid}/vinculos/${c.rid}`, { codigo: cod, em: Date.now() });
      const [esc_, resp] = await Promise.all([B.get('escolas/' + c.eid), B.get(`escolas/${c.eid}/responsaveis/${c.rid}`)]);
      await B.set('users/' + EU.uid, { escolas: { [c.eid]: { nome: (esc_ || {}).nome || 'Escola', papel: 'familia', familia: (resp || {}).nome || '' } } }, { merge: true });
      MINHAS[c.eid] = { nome: (esc_ || {}).nome, papel: 'familia', familia: (resp || {}).nome };
      abrirEscola(c.eid);
    } catch (e) { err(msgErro(e)); $('ientrar').disabled = false; }
  };
}
function sheetCriarEscola() {
  sheet(`<h3>Criar escola</h3>
    <div class="field"><label for="cnome">Nome da escola</label><input id="cnome" maxlength="60" placeholder="Ex.: Escolinha Movimento"></div>
    <div class="two"><div class="field"><label for="cvenc">Vencimento (dia do mês)</label><input id="cvenc" type="number" min="1" max="28" value="10"></div>
    <div class="field"><label for="cloc">Local (opcional)</label><input id="cloc" maxlength="60" placeholder="Ex.: Unidade Centro"></div></div>
    <div class="note">Depois você cadastra as turmas, os grupos e os alunos.</div>
    <label class="check aceite"><input type="checkbox" id="ctermos"><span>Li e aceito os <button type="button" class="link" data-doc="termos">Termos de uso</button> e a <button type="button" class="link" data-doc="privacidade">Política de privacidade</button>. A escola é responsável pelos dados que cadastrar.</span></label>
    <div class="err" id="cerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="cok">Criar</button></div>`, () => {
    $('cok').onclick = async () => {
      const nome = $('cnome').value.trim(), venc = Number($('cvenc').value), loc = $('cloc').value.trim();
      if (!nome) return $('cerr').textContent = 'Digite o nome da escola.';
      if (!(venc >= 1 && venc <= 28)) return $('cerr').textContent = 'O vencimento vai do dia 1 ao 28.';
      if (!$('ctermos').checked) return $('cerr').textContent = 'Para criar a escola, aceite os Termos de uso e a Política de privacidade.';
      $('cok').disabled = true;
      const eid = novoId();
      try {
        const ops = [
          { op: 'set', p: 'escolas/' + eid, d: { nome, dono: EU.uid, admins: [EU.uid], adminsInfo: { [EU.uid]: { nome: EU.nome || '', email: EU.email || '', em: Date.now() } }, criadaEm: Date.now(), termosAceitos: { em: Date.now(), versao: VERSAO_TERMOS, uid: EU.uid } } },
          { op: 'set', p: `escolas/${eid}/config/geral`, d: { vencDia: venc, pixRepassa: false, descIrmas: 0, descMulti: 0 } }
        ];
        if (loc) ops.push({ op: 'set', p: `escolas/${eid}/locais/${novoId()}`, d: { nome: loc, ordem: 1 } });
        await B.lote(ops);
        await B.set('users/' + EU.uid, { escolas: { [eid]: { nome, papel: 'admin' } } }, { merge: true });
        MINHAS[eid] = { nome, papel: 'admin' };
        fecharSheet(); abrirEscola(eid, 'turmas');
      } catch (e) { $('cerr').textContent = msgErro(e); $('cok').disabled = false; }
    };
  });
}

/* ================= Folhas (sheets) ================= */
let SHEET_FECHA = null;
// trava a tela de trás enquanto uma janela está aberta (no iPhone, senão a rolagem passa para trás)
let TRAVA_Y = 0;
function travarFundo(on) {
  const b = document.body;
  if (on && !b.classList.contains('travado')) { TRAVA_Y = window.scrollY; b.style.top = -TRAVA_Y + 'px'; b.classList.add('travado'); }
  else if (!on && b.classList.contains('travado')) { b.classList.remove('travado'); b.style.top = ''; window.scrollTo(0, TRAVA_Y); }
}
// "voltar": janela aberta por outra volta para a de origem; senão fecha; sem janela, volta para a aba anterior
let SHEET_VOLTAR = null, PROX_VOLTAR = null;
const abrirDe = (pai, filho) => { PROX_VOLTAR = pai; filho(); };
function voltar() {
  if ($('overlay').innerHTML) { const v = SHEET_VOLTAR; if (v) { SHEET_VOLTAR = null; v(); } else fecharSheet(); return true; }
  if (!S && VOLTA_ESCOLA && MINHAS[VOLTA_ESCOLA] && EU && document.getElementById('ivolta')) { abrirEscola(VOLTA_ESCOLA); return true; }
  if (S && S.hist && S.hist.length) { S.tab = S.hist.pop(); ls.set('escolinha.tab.' + S.papel, S.tab); render(); window.scrollTo(0, 0); return true; }
  return false;
}
/* Gestos de arrastar:
   - com uma janela aberta, arrastar da beirada esquerda para a direita fecha/volta a janela;
   - nas telas, arrastar para o lado troca de aba (para a esquerda: a próxima; para a direita: a anterior), na ordem da barra de baixo.
   Não vale em cima do calendário (lá o arrasto troca o mês), de campos de texto e de faixas que rolam para o lado. */
let ABAS_ATUAIS = [];
(function gestos() {
  let x0 = null, y0 = 0, dx = 0, ativo = false, alvo = null, modo = null;
  const solta = a => { if (!a) return; a.style.transition = ''; a.style.transform = ''; a.style.opacity = ''; };
  const livre = el => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.matches && n.matches('input,textarea,select,.mg,#abertura,nav.tabs')) return false;
      if (n.scrollWidth > n.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return false;
    }
    return true;
  };
  const vizinha = () => { const i = ABAS_ATUAIS.indexOf(S && S.tab), j = dx < 0 ? i + 1 : i - 1; return i >= 0 && j >= 0 && j < ABAS_ATUAIS.length ? ABAS_ATUAIS[j] : null; };
  document.addEventListener('touchstart', e => {
    const t = e.touches[0]; if (e.touches.length !== 1) return;
    const sh = document.querySelector('#overlay .sheet');
    if (sh) { if (t.clientX > 28) return; modo = 'janela'; alvo = sh; }
    else if (S && $('tela') && !abEl() && ABAS_ATUAIS.length > 1 && livre(e.target)) { modo = 'aba'; alvo = $('tela'); }
    else return;
    x0 = t.clientX; y0 = t.clientY; dx = 0; ativo = false;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (x0 == null) return; const t = e.touches[0]; dx = t.clientX - x0; const dy = Math.abs(t.clientY - y0);
    if (!ativo) {
      if (dy > 12 && dy > Math.abs(dx)) { x0 = null; return; }
      if (modo === 'janela' ? dx > 10 : Math.abs(dx) > 14 && Math.abs(dx) > dy * 1.4) ativo = true; else return;
    }
    alvo.style.transition = 'none';
    if (modo === 'janela') { alvo.style.transform = `translateX(${Math.max(0, dx)}px)`; alvo.style.opacity = String(1 - Math.min(0.45, dx / 700)); }
    else { const d = vizinha() ? dx : dx * 0.2; alvo.style.transform = `translateX(${d}px)`; alvo.style.opacity = String(1 - Math.min(0.5, Math.abs(d) / 600)); }
  }, { passive: true });
  const fim = () => {
    if (x0 == null) return; const a = alvo; x0 = null; alvo = null;
    a.style.transition = 'transform .2s ease, opacity .2s ease';
    if (modo === 'janela') {
      if (ativo && dx > 80) { a.style.transform = 'translateX(100%)'; a.style.opacity = '0'; setTimeout(() => { voltar(); if (document.body.contains(a)) solta(a); }, 190); }
      else { a.style.transform = ''; a.style.opacity = ''; setTimeout(() => solta(a), 220); }
      return;
    }
    const prox = ativo && Math.abs(dx) > 70 ? vizinha() : null;
    if (!prox) { a.style.transform = ''; a.style.opacity = ''; setTimeout(() => solta(a), 220); return; }
    const lado = dx < 0 ? -1 : 1;
    a.style.transform = `translateX(${lado * 100}%)`; a.style.opacity = '0';
    setTimeout(() => {
      irPara(prox); const nt = $('tela'); if (!nt) return;
      nt.style.transition = 'none'; nt.style.transform = `translateX(${-lado * 40}px)`; nt.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => { nt.style.transition = 'transform .22s ease, opacity .22s ease'; nt.style.transform = ''; nt.style.opacity = ''; setTimeout(() => solta(nt), 260); }));
    }, 170);
  };
  document.addEventListener('touchend', fim); document.addEventListener('touchcancel', fim);
})();
function sheet(html, montar, aoFechar) {
  if (SHEET_FECHA) { const f = SHEET_FECHA; SHEET_FECHA = null; f(); }
  SHEET_VOLTAR = PROX_VOLTAR; PROX_VOLTAR = null; travarFundo(true);
  $('overlay').innerHTML = `<div class="sheet-bg" id="sbg"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  $('sbg').onclick = e => { if (e.target.id === 'sbg') fecharSheet(); };
  $('overlay').querySelectorAll('[data-fechar]').forEach(b => b.onclick = fecharSheet);
  SHEET_FECHA = aoFechar || null;
  montar && montar($('overlay').querySelector('.sheet'));
}
function fecharSheet() { if (SHEET_FECHA) { const f = SHEET_FECHA; SHEET_FECHA = null; f(); } SHEET_VOLTAR = null; $('overlay').innerHTML = ''; travarFundo(false); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('overlay').innerHTML) fecharSheet(); });
function confirmar(titulo, texto, botao, acao) {
  sheet(`<h3>${esc(titulo)}</h3><p class="sub" style="margin:0">${texto}</p><div class="err" id="kerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn danger" id="kok">${esc(botao)}</button></div>`, () => {
    $('kok').onclick = async () => { $('kok').disabled = true; try { await acao(); fecharSheet(); } catch (e) { $('kerr').textContent = msgErro(e); $('kok').disabled = false; } };
  });
}

/* ================= Abrir uma escola ================= */
async function abrirEscola(eid, tab) {
  pararOuvintes(); fecharSheet();
  RAIZ().innerHTML = `<div class="wrap" style="padding-top:40px"><div class="empty">Abrindo a escola…</div></div>`;
  let escola;
  try { escola = await B.get('escolas/' + eid); } catch (e) { escola = null; }
  if (!escola) { aviso('Você não tem mais acesso a essa escola.'); delete MINHAS[eid]; return telaInicio(); }
  const admin = (escola.admins || []).includes(EU.uid);
  let prof = null;
  const papel = admin ? 'a' : prof ? 'p' : 'f', ABAS_OK = { a: ['cobr', 'alunas', 'turmas', 'eventos', 'fin'], p: ['turmas', 'lancar'], f: ['pagar', 'filhas'] }[papel];
  ls.set('escolinha.ultima', eid);
  S = { eid, admin, prof, papel, escola, mes: mesHoje(), tab: tab || ls.get('escolinha.tab.' + papel) || ABAS_OK[0],
    cfg: {}, mpc: {}, locais: {}, turmas: {}, grupos: {}, resps: {}, alunas: {}, extras: {}, pags: {}, lanc: {}, membros: {}, profs: {}, acordos: {}, vinc: {}, pedidos: {}, saude: {}, eu: null, carregado: new Set(), sel: null, sug: [], anoRef: null };
  if (!ABAS_OK.includes(S.tab)) S.tab = ABAS_OK[0];
  const p = `escolas/${eid}`;
  const col = (nome, chave, onde) => B.ouvirCol(`${p}/${nome}`, docs => { S[chave] = Object.fromEntries(docs.map(d => [d.id, d.data])); S.carregado.add(chave); agendar(); }, e => console.warn(nome, e), onde);
  OUV.push(B.ouvirDoc(p, d => { if (d) { S.escola = d; agendar(); } }));
  OUV.push(B.ouvirDoc(`${p}/config/geral`, d => { S.cfg = d || {}; S.cfgOk = true; agendar(); }));
  ['locais', 'turmas', 'grupos', 'extras'].forEach(n => OUV.push(col(n, n)));
  if (admin || prof) {
    OUV.push(col('acordos', 'acordos'));
    OUV.push(col('professoras', 'profs')); OUV.push(col('responsaveis', 'resps')); OUV.push(col('alunas', 'alunas')); OUV.push(col('pagamentos', 'pags'));
    if (admin) { OUV.push(B.ouvirDoc(`${p}/config/mp`, d => { S.mpc = d || {}; agendar(); }, () => { })); OUV.push(col('lancamentos', 'lanc')); OUV.push(col('membros', 'membros')); OUV.push(col('pedidos', 'pedidos')); OUV.push(col('saude', 'saude')); }
  } else {
    // a família só vê o nome de cada professor(a) (profsPublico, copiado pelo servidor); telefone e chave Pix ficam com a escola
    OUV.push(col(MOCK ? 'professoras' : 'profsPublico', 'profs'));
    const acordosPorRid = {}; S.acordos = {};
    OUV.push(B.ouvirDoc(`${p}/membros/${EU.uid}`, d => { S.eu = d || {}; agendar(); }, () => { S.eu = {}; agendar(); }));
    // responsável: só os cadastros ligados à conta dele, os alunos desses cadastros e a ficha de cada um
    const porRid = {}, porAluna = {}, alunasPorRid = {};
    const juntarAlunas = () => { S.alunas = Object.assign({}, ...Object.values(alunasPorRid)); S.carregado.add('alunas'); sincronizarFichas(); agendar(); };
    const sincronizarFichas = () => {
      for (const alid of Object.keys(S.alunas)) if (!porAluna[alid]) porAluna[alid] = B.ouvirDoc(`${p}/pagamentos/${alid}`, d => { S.pags[alid] = d || {}; agendar(); }, () => { });
      for (const alid of Object.keys(porAluna)) if (!S.alunas[alid]) { porAluna[alid](); delete porAluna[alid]; delete S.pags[alid]; }
    };
    OUV.push(B.ouvirCol(`${p}/membros/${EU.uid}/vinculos`, docs => {
      const rids = new Set(docs.map(d => d.id)); S.carregado.add('vinc');
      for (const rid of rids) if (!porRid[rid]) porRid[rid] = [
        B.ouvirDoc(`${p}/responsaveis/${rid}`, d => { if (d) S.resps[rid] = d; else delete S.resps[rid]; agendar(); }, () => { }),
        B.ouvirCol(`${p}/alunas`, docs2 => { alunasPorRid[rid] = Object.fromEntries(docs2.map(x => [x.id, x.data])); juntarAlunas(); }, () => { }, ['responsavelId', rid]),
        B.ouvirCol(`${p}/saude`, docs3 => { for (const x of docs3) S.saude[x.id] = x.data; agendar(); }, () => { }, ['responsavelId', rid]),
        B.ouvirCol(`${p}/acordos`, docs4 => { acordosPorRid[rid] = Object.fromEntries(docs4.map(x => [x.id, x.data])); S.acordos = Object.assign({}, ...Object.values(acordosPorRid)); agendar(); }, () => { }, ['rid', rid])];
      for (const rid of Object.keys(porRid)) if (!rids.has(rid)) { porRid[rid].forEach(f => f()); delete porRid[rid]; delete alunasPorRid[rid]; delete acordosPorRid[rid]; delete S.resps[rid]; juntarAlunas(); }
      if (!rids.size) juntarAlunas();
      buscarSugestoes();
    }, () => { }));
    OUV.push(() => { Object.values(porRid).flat().forEach(f => f()); Object.values(porAluna).forEach(f => f()); });
  }
  if (MINHAS[eid] && MINHAS[eid].nome !== escola.nome) B.set('users/' + EU.uid, { escolas: { [eid]: { nome: escola.nome } } }, { merge: true }).catch(() => { });
  render();
  if (admin && MP_VOLTA && ls.get('escolinha.mpVolta') === eid) { ls.set('escolinha.mpVolta', null); setTimeout(() => { aviso(MP_VOLTA === 'ok' ? 'Mercado Pago conectado! Confira se é a conta certa.' : 'Não deu para conectar o Mercado Pago. Tente de novo.'); if (MP_VOLTA === 'ok') sheetAjustes(); }, 600); }
}
let pend = null;
function agendar() { if (pend) return; pend = requestAnimationFrame(() => { pend = null; render(); }); }

/* ================= Cálculos com o estado ================= */
const dados = alid => ({ alunas: S.alunas, turmas: S.turmas, extras: S.extras, grupos: S.grupos, acordos: S.acordos, pag: S.pags[alid] || {}, cfg: S.cfg });
// multa e juros por atraso (Ajustes): somados nas cobranças vencidas e em aberto, salvo se a escola tirou
// multa, juros e o "sem multa e juros até tal data" ficam em regras.js, o mesmo cálculo do servidor
const { MULTA_MAX, JUROS_MAX, chaveEnc } = C;
const comEncargos = i => C.comEncargos(i, S.cfg, S.pags[i.alid] || {}, hoje());
const itensDe = alid => C.itensAluna(dados(alid), alid, hoje()).map(comEncargos);
// formas de pagamento: Pix, boleto e cartão passam pelo app (ficam travados); dinheiro a escola marca e pode desfazer
const NOME_VIA = { pix: 'Pix', boleto: 'Boleto', cartao: 'Cartão', dinheiro: 'Dinheiro' };
const ONLINE = via => ['pix', 'boleto', 'cartao'].includes(via);
const nomeVia = p => p.via === 'pix' ? 'Pix automático' : p.via === 'cartao' ? `Cartão${p.parcelas > 1 ? ` em ${p.parcelas}x` : ''}` : NOME_VIA[p.via] || 'Outro';
// taxas da conta do Mercado Pago (editáveis em Ajustes, porque mudam de conta para conta)
const TAXAS_PADRAO = { pix: 0.99, boleto: 3.49, cartao: 4.98, parc: { 2: 9.64, 3: 11.23, 4: 12.81, 5: 14.38, 6: 15.94 } };
const FORMAS_PADRAO = { boleto: true, cartao: true, parcelado: true, maxParcelas: 3 };
const taxasCfg = () => ({ ...TAXAS_PADRAO, ...(S.cfg.taxas || {}), parc: { ...TAXAS_PADRAO.parc, ...((S.cfg.taxas || {}).parc || {}) } });
const formasCfg = () => ({ ...FORMAS_PADRAO, ...(S.cfg.formas || {}) });
const COMISSAO = 0.01;
const TAXA_TRANSACAO = () => ((0.0099 + COMISSAO) * 100).toFixed(2).replace('.', ','); // Pix do Mercado Pago + app = 1,99%
// boleto e cartão ficam guardados para depois; por enquanto só Pix
const OUTRAS_FORMAS = false;
// quanto a família paga em cada forma, para uma base (o que a escola tem que receber)
// valor de cada forma de pagamento; baseRep = parte em que quem paga cobre a taxa (padrão: a escolha da escola)
function valorForma(base, forma, n, baseRep) {
  const t = taxasCfg(), r = Math.min(C.r2(base), C.r2(baseRep == null ? (S.cfg.pixRepassa === true ? base : 0) : baseRep));
  const up = (b, pct) => C.r2(C.r2(b - r) + (r > 0 ? Math.ceil(r / (1 - pct - COMISSAO) * 100 - 1e-6) / 100 : 0));
  if (forma === 'pix') return { total: up(base, t.pix / 100) };
  if (forma === 'boleto') return { total: r > 0 ? C.r2(C.r2(base - r) + Math.ceil((r + t.boleto) / (1 - COMISSAO) * 100 - 1e-6) / 100) : C.r2(base) };
  const vista = up(base, t.cartao / 100);
  if (forma === 'cartao' && (!n || n < 2)) return { total: vista, parcelas: 1, parcela: vista };
  const juros = (Number(t.parc[n]) || 0) / 100, total = C.r2(vista * (1 + juros));
  return { total, parcelas: n, parcela: C.r2(total / n), juros };
}
// janelinha que simula a taxa: com um valor, mostra quanto a família paga e quanto a escola recebe, ligado ou desligado
function simTaxaHTML(id, v0, semCampo) {
  return `<div class="simtaxa" id="${id}">${semCampo ? '' : `<div class="simtaxa-in"><label for="${id}v">Simular uma cobrança de</label><span class="simtaxa-r">R$ <input id="${id}v" inputmode="decimal" value="${esc(fmtValor(v0 > 0 ? v0 : 100))}"></span></div>`}<div class="simtaxa-res" id="${id}r"></div></div>`;
}
// valorDe: de onde vem o valor (padrão: o campo da própria janelinha)
function ligarSimTaxa(id, marcado, valorDe) {
  const caixa = $(id + 'v'), res = $(id + 'r'); if (!res) return () => { };
  const ler = valorDe || (() => parseValor(caixa.value));
  const ver = () => {
    const v = ler(), rep = marcado();
    if (!(v > 0)) { res.innerHTML = '<span class="sub">Coloque o valor para ver quanto a família paga e quanto a escola recebe.</span>'; return; }
    const paga = C.valorPix(v, {}, 0.0099, COMISSAO, rep ? v : 0).valor, recebe = C.r2(paga - C.r2(paga * 0.0099) - C.r2(paga * COMISSAO));
    res.innerHTML = `<div><span>A família paga</span><b class="num">${brl(paga)}</b></div><div><span>A escola recebe</span><b class="num">${brl(recebe)}</b></div>`;
  };
  if (caixa) caixa.addEventListener('input', ver); ver(); return ver;
}
const repLote = l => l.itens ? C.baseRepasse(l.itens, S.cfg, S.extras) : undefined;
const linhaEnc = i => i.perdao ? `<span class="s perdao">Sem multa e juros${i.perdao.ate ? ` se pagar até ${dataBR(i.perdao.ate)}` : ''}</span>` : i.enc ? `<span class="s enc num">Inclui multa e juros: ${brl(C.r2(i.enc.multa + i.enc.juros))} (${i.enc.dias} dia${i.enc.dias === 1 ? '' : 's'} de atraso)</span>` : '';
const st = i => C.status(i, hoje());
// cobranças de uma aluna que pertencem a um mês (mensalidade do mês + extras que vencem nele), inclusive meses futuros
function itensDoMes(alid, mes) {
  const a = S.alunas[alid], pag = S.pags[alid] || {}, out = []; if (!a) return out;
  const neg = ((pag.mens || {})[mes] || {}).s === 'acordo';
  const p = C.stPag((pag.mens || {})[mes]), m = p || neg ? null : C.mensalidade(S.alunas, alid, mes, S.turmas, S.cfg);
  if (!neg && (p || (m && m.v > 0))) out.push({ k: `m:${mes}:${alid}`, tipo: 'm', alid, mes, v: p ? C.r2(p.v) : m.v, venc: C.vencMens(mes, S.cfg), pago: p, tipoExtra: null });
  for (const [xid, x] of Object.entries(S.extras)) {
    if (String(x.venc || '').slice(0, 7) !== mes) continue;
    if (((pag.extras || {})[xid] || {}).s === 'acordo') continue;
    const px = C.stPag((pag.extras || {})[xid]);
    if (px || C.alvoExtra(x, S.alunas, S.grupos).has(alid)) out.push({ k: `x:${xid}:${alid}`, tipo: 'x', alid, xid, v: px ? C.r2(px.v) : C.valorExtra(x, alid), venc: x.venc, pago: px, tipoExtra: x.tipo });
  }
  for (const i of itensDe(alid)) if (i.tipo === 'a' && String(i.venc).slice(0, 7) === mes) out.push({ ...i, tipoExtra: 'acordo' });
  return out;
}
// quanto cada recebedor (escola ou professor(a)) tem previsto e recebido num mês
function porRecebedor(mes) {
  const out = {};
  for (const alid of Object.keys(S.alunas)) for (const i of itensDoMes(alid, mes)) {
    const partes = i.tipo === 'm' ? C.partesMens(S.alunas[alid], S.turmas, i.v) : i.tipo === 'a' ? C.partesAcordo(S.acordos[i.aid] || {}, i.v) : { [C.recDe(S.extras[i.xid])]: i.v };
    for (const [r, v] of Object.entries(partes)) { const o = out[r] = out[r] || { esp: 0, rec: 0 }; o.esp = C.r2(o.esp + v); if (i.pago) o.rec = C.r2(o.rec + v); }
  }
  return out;
}
function resumoAluna(alid) {
  const it = itensDe(alid), ab = it.filter(i => !i.pago), venc = ab.filter(i => st(i) === 'vencido');
  const soma = l => C.r2(l.reduce((s, i) => s + i.v, 0));
  return { it, aberto: soma(ab), vencido: soma(venc), status: !it.length ? null : venc.length ? 'vencido' : ab.length ? 'aberto' : 'pago' };
}
const ordenar = (obj, campo = 'nome') => Object.entries(obj).sort((a, b) => (a[1].ordem ?? 999) - (b[1].ordem ?? 999) || String(a[1][campo] || '').localeCompare(String(b[1][campo] || ''), 'pt-BR'));
const porNome = obj => Object.entries(obj).sort((a, b) => String(a[1].nome || '').localeCompare(String(b[1].nome || ''), 'pt-BR'));
const nomeTurma = t => t ? `${t.nome || 'Turma'}${t.atividade ? ' · ' + t.atividade : ''}` : '';
const localDe = t => t && t.localId && S.locais[t.localId] ? S.locais[t.localId].nome : '';
const turmasTxt = a => (a.turmas || []).map(t => S.turmas[t]).filter(Boolean).map(t => t.nome).join(', ');
const alunasDaTurma = (tid, mes) => Object.entries(S.alunas).filter(([, a]) => (a.turmas || []).includes(tid) && C.ativaNoMes(a, mes || mesHoje()));
function idade(n) { if (!/^\d{4}-\d{2}-\d{2}$/.test(n || '')) return ''; const h = hoje(); let i = Number(h.slice(0, 4)) - Number(n.slice(0, 4)); if (h.slice(5) < n.slice(5)) i--; return i >= 0 && i < 120 ? `${i} ano${i === 1 ? '' : 's'}` : ''; }
const nascTxt = a => a && a.nascimento ? `${dataBR(a.nascimento)}/${a.nascimento.slice(0, 4)} (${idade(a.nascimento)})` : '';
/* ---- Faixa etária: aviso de mudança de turma (virada do ano) ---- */
const anoRef = () => S.anoRef || Number(hoje().slice(0, 4));
const idadeAno = a => C.idadeNoAno(a && a.nascimento, anoRef());
const profNome = t => t && t.professoraId && S.profs[t.professoraId] ? S.profs[t.professoraId].nome : (t && t.professora) || '';
function mudancasFaixa(soAlid) {
  const ano = anoRef(), out = [];
  for (const [alid, a] of porNome(S.alunas)) {
    if ((soAlid && alid !== soAlid) || !a.nascimento || !C.ativaNoMes(a, mesHoje())) continue;
    const id = C.idadeNoAno(a.nascimento, ano);
    for (const tid of a.turmas || []) {
      const t = S.turmas[tid]; if (!t || C.cabe(t, id) || (a.faixaOk || {})[tid] === ano) continue;
      const sug = ordenar(S.turmas).filter(([x, T]) => x !== tid && !(a.turmas || []).includes(x) && !C.todasIdades(T) && C.cabe(T, id))
        .sort((x, y) => (y[1].localId === t.localId) - (x[1].localId === t.localId)).map(([x]) => x);
      out.push({ alid, tid, idade: id, sug });
    }
  }
  return out;
}
function cartaoFaixa(m, comNome = true) {
  const a = S.alunas[m.alid], t = S.turmas[m.tid], ano = anoRef(), k = `${m.alid}|${m.tid}`;
  const opc = m.sug.map(x => `<option value="${esc(x)}">${esc(S.turmas[x].nome)} (${esc(C.faixaTxt(S.turmas[x]))}${localDe(S.turmas[x]) ? ' · ' + esc(localDe(S.turmas[x])) : ''})</option>`).join('');
  return `<div class="faixa-card">
    <div><b>${comNome ? esc(a.nome) + ' ' : ''}${comNome ? 'faz' : 'Faz'} ${m.idade} anos em ${ano}</b> <span class="sub">(nasceu em ${esc(String(a.nascimento).slice(0, 4))})</span></div>
    <div class="sub">A turma <b style="color:var(--ink)">${esc(t.nome)}</b> é de ${esc(C.faixaTxt(t))}.${m.sug.length ? ' Mudar de turma?' : ' Nenhuma turma dessa faixa está cadastrada.'}</div>
    ${m.sug.length > 1 ? `<select data-fxsel="${esc(k)}" aria-label="Nova turma">${opc}</select>` : ''}
    <div class="actions">${m.sug.length ? `<button class="btn" data-fxmudar="${esc(k)}">Mudar${m.sug.length === 1 ? ' para ' + esc(S.turmas[m.sug[0]].nome) : ''}</button>` : ''}<button class="btn ghost" data-fxmanter="${esc(k)}">Manter na ${esc(t.nome)}</button></div>
  </div>`;
}
function ligarFaixa(el, depois) {
  el.querySelectorAll('[data-fxabrir]').forEach(b => b.onclick = () => sheetFaixa());
  el.querySelectorAll('[data-fxmudar]').forEach(b => b.onclick = async () => {
    const [alid, tid] = b.dataset.fxmudar.split('|'), sel = el.querySelector(`[data-fxsel="${CSS.escape(b.dataset.fxmudar)}"]`), m = mudancasFaixa(alid).find(x => x.tid === tid);
    const novo = sel ? sel.value : m && m.sug[0]; if (!novo) return; const a = S.alunas[alid]; b.disabled = true;
    try { await B.set(`escolas/${S.eid}/alunas/${alid}`, { turmas: (a.turmas || []).map(x => x === tid ? novo : x) }, { merge: true }); aviso(`${primeiro(a.nome)} foi para ${S.turmas[novo].nome}`); depois && setTimeout(depois, 60); }
    catch (e) { aviso(msgErro(e)); b.disabled = false; }
  });
  el.querySelectorAll('[data-fxmanter]').forEach(b => b.onclick = async () => {
    const [alid, tid] = b.dataset.fxmanter.split('|'), a = S.alunas[alid]; b.disabled = true;
    try { await B.set(`escolas/${S.eid}/alunas/${alid}`, { faixaOk: { ...(a.faixaOk || {}), [tid]: anoRef() } }, { merge: true }); aviso(`${primeiro(a.nome)} continua na ${S.turmas[tid].nome}`); depois && setTimeout(depois, 60); }
    catch (e) { aviso(msgErro(e)); b.disabled = false; }
  });
}
// no painel fica só o resumo; tocando, abre a lista com todos os avisos
function blocoFaixa(lista) {
  return `<button class="faixa-resumo" data-fxabrir><span class="grow"><b>Mudanças de faixa etária</b><span class="s">${lista.length} aviso${lista.length === 1 ? '' : 's'} para avaliar</span></span><span class="chip vencido num">${lista.length}</span><span aria-hidden="true" style="font-weight:800">›</span></button>`;
}
function sheetFaixa() {
  const lista = mudancasFaixa(); if (!lista.length) { fecharSheet(); return aviso('Nenhuma mudança de faixa etária para avaliar.'); }
  const jan = S.anoRef || hoje().slice(5, 7) === '01';
  sheet(`<div class="headrow"><h3>Mudanças de faixa etária</h3><span class="chip vencido">${lista.length}</span></div>
    <div class="sub">${jan ? `Começou ${anoRef()}. ` : ''}Estes alunos estão fora da faixa etária da turma. Confirme se mudam de turma ou continuam.</div>
    ${lista.map(m => cartaoFaixa(m)).join('')}
    <button class="btn ghost" data-fechar>Fechar</button>`, s => ligarFaixa(s, () => sheetFaixa()));
}
const respDe = alid => S.resps[(S.alunas[alid] || {}).responsavelId] || {};
const ROT = { pago: 'Pago', vencido: 'Vencido', aberto: 'Em aberto' };
const tipoItem = i => i.tipo === 'm' ? 'Mensalidade' : i.tipo === 'a' ? 'Acordo' : (C.TIPOS_EXTRA[i.tipoExtra] || 'Extra');
/* WhatsApp: abre a conversa com o número cadastrado e a mensagem já escrita (a pessoa só toca em enviar) */
function numeroWa(tel) { let d = C.soDigitos(tel); if (d.length === 10 || d.length === 11) d = '55' + d; return d.length >= 12 && d.length <= 13 ? d : ''; }
const waLink = (tel, txt) => numeroWa(tel) ? `https://wa.me/${numeroWa(tel)}?text=${encodeURIComponent(txt)}` : '';
const ICO_EDIT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICO_WA = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3z"/></svg>';

/* ================= Casca da escola ================= */
/* ================= Aparência: cor e logo da escola ================= */
const COR_PADRAO = '#8B6B47';
const CORES = [['#8B6B47', 'Bege'], ['#C2305A', 'Rosa'], ['#2357C6', 'Azul'], ['#0E7C86', 'Turquesa'], ['#1E7F4F', 'Verde'], ['#D2601A', 'Laranja'], ['#C62828', 'Vermelho'], ['#6B3FC0', 'Roxo'], ['#22252E', 'Grafite']];
const hexOk = c => /^#[0-9a-f]{6}$/i.test(c || '');
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hex = a => '#' + a.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const mistura = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function aplicarTema(cor) {
  cor = hexOk(cor) ? cor : COR_PADRAO;
  let ac = cor; for (let i = 0; i < 12 && contraste(ac, '#FFFFFF') < 3.2; i++) ac = mistura(ac, '#000000', 0.12); // cor clara demais: escurece até dar para ler
  const ink = contraste(ac, '#FFFFFF') >= 3.2 ? '#FFFFFF' : '#1A2030';
  let acD = mistura(cor, '#FFFFFF', 0.3); for (let i = 0; i < 12 && contraste(acD, '#1B1F2A') < 4.5; i++) acD = mistura(acD, '#FFFFFF', 0.15);
  // as cores vão direto no <html> (estilo em linha): nada na página passa por cima, em qualquer navegador
  const claro = { '--accent': ac, '--accent-ink': ink, '--accent-soft': mistura(ac, '#FFFFFF', 0.87) };
  const escuro = { '--accent': acD, '--accent-ink': '#12151D', '--accent-soft': mistura(acD, '#1B1F2A', 0.78) };
  TEMA_ATUAL = { claro, escuro }; pintarTema();
  const mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.content = ac;
}
function aplicarLogo() {
  /* O ícone é sempre o do Turma em Dia (aba, tela inicial, Android e iPhone), igual ao que vai para as lojas.
     A logo da escola aparece só dentro do app: no topo e no relatório em PDF. */
  ['icon', 'apple-touch-icon'].forEach(rel => { const l = document.querySelector(`link[rel="${rel}"]`); if (l && l.dataset.padrao) l.href = l.dataset.padrao; });
}
let MARCA_ATUAL = '', PREVIA_MARCA = false;
let TEMA_ATUAL = null;
const MQ_ESCURO = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function pintarTema() {
  if (!TEMA_ATUAL) return;
  const r = document.documentElement, dt = r.getAttribute('data-theme'), escuro = dt === 'dark' || (dt !== 'light' && MQ_ESCURO && MQ_ESCURO.matches);
  for (const [k, v] of Object.entries(escuro ? TEMA_ATUAL.escuro : TEMA_ATUAL.claro)) r.style.setProperty(k, v);
}
if (MQ_ESCURO) { try { MQ_ESCURO.addEventListener('change', pintarTema); } catch (e) { MQ_ESCURO.addListener && MQ_ESCURO.addListener(pintarTema); } }
function aplicarMarca(cfg) {
  if (PREVIA_MARCA) return; // enquanto a Adm escolhe, a prévia manda
  cfg = cfg || {}; const k = (cfg.cor || '') + '|' + (cfg.logo || '').length; if (k === MARCA_ATUAL) return; MARCA_ATUAL = k;
  if (S && S.eid && S.cfgOk) ls.set('escolinha.marca.' + S.eid, JSON.stringify({ cor: cfg.cor || '', logo: cfg.logo || '' }));
  aplicarTema(cfg.cor); aplicarLogo(cfg.logo);
}
// ---- logo: abrir a imagem, tirar o fundo (no próprio celular) e gerar os arquivos pequenos ----
function abrirImagem(arquivo, max = 480) {
  return new Promise((ok, falha) => {
    if (!arquivo || !/^image\//.test(arquivo.type)) return falha(new Error('Escolha uma imagem (PNG ou JPG).'));
    const url = URL.createObjectURL(arquivo), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url);
      const f = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * f)); c.height = Math.max(1, Math.round(img.height * f));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); ok(c); };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error('Não deu para abrir essa imagem. Tente outra.')); };
    img.src = url;
  });
}
// a imagem já vem sem fundo? (borda quase toda transparente)
function jaSemFundo(c) {
  const { width: w, height: h } = c, d = c.getContext('2d').getImageData(0, 0, w, h).data; let t = 0, n = 0;
  const ver = (x, y) => { n++; if (d[(y * w + x) * 4 + 3] < 40) t++; };
  for (let x = 0; x < w; x += 2) { ver(x, 0); ver(x, h - 1); } for (let y = 0; y < h; y += 2) { ver(0, y); ver(w - 1, y); }
  return t / n > 0.6;
}
/* Tira o fundo: descobre a cor da borda e apaga, a partir das bordas, tudo o que tem cor parecida e está ligado à borda.
   O que está dentro do escudo (mesmo que seja da mesma cor) fica, porque não encosta na borda. A beirada fica suavizada.
   Devolve { canvas, ok, motivo }: ok = false quando o fundo não é liso o bastante para separar direito. */
function tirarFundo(orig, forca) {
  const w = orig.width, h = orig.height, ctx = orig.getContext('2d'), src = ctx.getImageData(0, 0, w, h), d = src.data;
  // cor do fundo = a mais comum na borda (agrupada)
  const cont = new Map(), borda = [];
  const pega = (x, y) => { const i = (y * w + x) * 4; if (d[i + 3] < 40) return; const k = (d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4); cont.set(k, (cont.get(k) || 0) + 1); borda.push(i); };
  for (let x = 0; x < w; x++) { pega(x, 0); pega(x, h - 1); } for (let y = 1; y < h - 1; y++) { pega(0, y); pega(w - 1, y); }
  if (!borda.length) return { canvas: orig, ok: false, motivo: 'A imagem já não tem fundo.' };
  let top = null, max = 0; cont.forEach((v, k) => { if (v > max) { max = v; top = k; } });
  const soma = [0, 0, 0]; let q = 0;
  for (const i of borda) { const k = (d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4); if (k === top) { soma[0] += d[i]; soma[1] += d[i + 1]; soma[2] += d[i + 2]; q++; } }
  const bg = soma.map(v => v / q), tol = forca, dist = i => Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);
  const uniforme = borda.filter(i => dist(i) < tol).length / borda.length;
  // inundação a partir da borda
  const fora = new Uint8Array(w * h), fila = new Int32Array(w * h); let ini = 0, fim = 0;
  const tenta = p => { if (fora[p]) return; const i = p * 4; if (d[i + 3] < 40 || dist(i) < tol) { fora[p] = 1; fila[fim++] = p; } };
  for (let x = 0; x < w; x++) { tenta(x); tenta((h - 1) * w + x); } for (let y = 0; y < h; y++) { tenta(y * w); tenta(y * w + w - 1); }
  while (ini < fim) { const p = fila[ini++], x = p % w, y = (p / w) | 0; if (x > 0) tenta(p - 1); if (x < w - 1) tenta(p + 1); if (y > 0) tenta(p - w); if (y < h - 1) tenta(p + w); }
  const out = ctx.createImageData(w, h), o = out.data; let tirados = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4; o[i] = d[i]; o[i + 1] = d[i + 1]; o[i + 2] = d[i + 2];
    if (fora[p]) { o[i + 3] = 0; tirados++; continue; }
    // beirada: pixel do desenho encostado no fundo e com cor parecida fica meio transparente
    const x = p % w, y = (p / w) | 0, viz = (x > 0 && fora[p - 1]) || (x < w - 1 && fora[p + 1]) || (y > 0 && fora[p - w]) || (y < h - 1 && fora[p + w]);
    let a = d[i + 3]; if (viz) { const k = dist(i); if (k < tol * 2) a = Math.round(a * Math.max(0.15, (k - tol) / tol)); }
    o[i + 3] = a; if (a > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const frac = tirados / (w * h);
  if (x1 < 0) return { canvas: orig, ok: false, motivo: 'O corte apagou a imagem toda. Diminua a força do corte ou fique com a imagem como antes.' };
  // recorta o que sobrou, com uma pequena margem
  const m = Math.round(Math.max(w, h) * 0.03), cx = Math.max(0, x0 - m), cy = Math.max(0, y0 - m), cw = Math.min(w, x1 + m + 1) - cx, ch = Math.min(h, y1 + m + 1) - cy;
  const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').putImageData(out, 0, 0);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; c.getContext('2d').drawImage(t, cx, cy, cw, ch, 0, 0, cw, ch);
  let ok = true, motivo = '';
  if (uniforme < 0.55) { ok = false; motivo = 'O fundo da imagem não é de uma cor só, então o corte pode ter ficado ruim.'; }
  else if (frac < 0.03) { ok = false; motivo = 'Quase nada do fundo saiu.'; }
  else if (frac > 0.92) { ok = false; motivo = 'O corte levou quase toda a imagem.'; }
  return { canvas: c, ok, motivo };
}
// a imagem escolhida vira dois arquivos pequenos: PNG para o app (fundo transparente) e JPEG para o PDF
function gerarMarca(fonte) {
  const caber = max => { const f = Math.min(1, max / Math.max(fonte.width, fonte.height)); return [Math.max(1, Math.round(fonte.width * f)), Math.max(1, Math.round(fonte.height * f))]; };
  const [w, h] = caber(256), c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(fonte, 0, 0, w, h);
  let logo = c.toDataURL('image/png'); if (logo.length > 180000) logo = c.toDataURL('image/webp', 0.9);
  const [pw, ph] = caber(320), d = document.createElement('canvas'); d.width = pw; d.height = ph; const x = d.getContext('2d');
  x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, pw, ph); x.drawImage(fonte, 0, 0, pw, ph);
  return { logo, logoPdf: { jpg: d.toDataURL('image/jpeg', 0.88).split(',')[1], w: pw, h: ph } };
}
async function prepararLogo(arquivo) { return gerarMarca(await abrirImagem(arquivo, 256)); }
function render() {
  aplicarMarca(S.cfg);
  if (!S) return;
  const adm = S.admin, abas = {
    a: [['cobr', 'Cobranças', 'cobr'], ['alunas', 'Alunos', 'alunas'], ['turmas', 'Turmas', 'escola'], ['eventos', 'Eventos', 'evento'], ['fin', 'Financeiro', 'caixa']],
    p: [['turmas', 'Minhas turmas', 'escola'], ['lancar', 'Eventos e taxas', 'cobr']],
    f: [['pagar', 'Pagar', 'cobr'], ['filhas', 'Meus filhos', 'filhas']] }[S.papel];
  const comMes = adm && ['cobr', 'fin'].includes(S.tab);
  const titulo = adm ? 'Administração' : S.prof ? 'Professor(a) ' + ((S.profs[S.prof] || {}).nome || '') : (Object.values(S.resps)[0] || {}).nome || 'Responsável';
  const foco = document.activeElement && document.activeElement.id, selS = foco && document.activeElement.selectionStart;
  RAIZ().innerHTML = `<div class="wrap">
    <header class="top">
      <div class="brand">${S.cfg.logo ? `<img class="marca" src="${esc(S.cfg.logo)}" alt="">` : ''}<h1><small>${esc(titulo)}</small>${esc(S.escola.nome || 'Escola')}</h1>
        <div class="acts"><button class="icon-btn" id="hcfg" aria-label="Ajustes">${ICO.gear}</button></div></div>
      ${Object.keys(MINHAS).length > 1 ? `<button class="troca-btn" id="htroca">${ICO.troca}<span>Trocar escola</span></button>` : ''}
      ${comMes ? `<div class="monthbar"><button id="mprev" aria-label="Mês anterior">‹</button><div class="m num">${esc(nomeMesAno(S.mes))}</div><button id="mnext" aria-label="Próximo mês">›</button></div>` : ''}
    </header>
    <div id="faixa"></div>
    <main id="tela" style="display:flex;flex-direction:column;gap:16px"></main>
  </div>
  <nav class="tabs" aria-label="Seções"><div class="in">${abas.map(([k, n, ic]) => `<button data-tab="${k}" aria-current="${S.tab === k ? 'page' : 'false'}">${ICO[ic]}${n}</button>`).join('')}</div></nav>`;
  RAIZ().querySelectorAll('[data-tab]').forEach(b => b.onclick = () => irPara(b.dataset.tab));
  ABAS_ATUAIS = abas.map(([k]) => k);
  $('hcfg').onclick = () => sheetAjustes();
  if ($('htroca')) $('htroca').onclick = () => trocarEscola();
  if (comMes) { $('mprev').onclick = () => { S.mes = mesMais(S.mes, -1); render(); }; $('mnext').onclick = () => { S.mes = mesMais(S.mes, 1); render(); }; }
  faixa();
  const v = $('tela');
  if (S.papel === 'f' && S.eu && !S.eu.consentimento) return telaConsentimento(v);
  ({ cobr: tCobrancas, alunas: tAlunas, turmas: tTurmas, eventos: tEventos, fin: tFinanceiro, pagar: tPagar, filhas: tFilhas, lancar: tLancar })[S.tab](v);
  if (foco && $(foco) && $(foco).tagName === 'INPUT' && $(foco).type !== 'checkbox') { $(foco).focus(); try { $(foco).setSelectionRange(selS, selS); } catch (e) { } }
}
function irPara(tab, extra) { if (S.tab !== tab) { S.hist = (S.hist || []).concat(S.tab).slice(-20); } S.tab = tab; Object.assign(S, extra || {}); ls.set('escolinha.tab.' + S.papel, tab); render(); scrollTo(0, 0); }
function faixa() {
  const PAP = { a: ['administração', 'admin@teste.com'], f: ['responsável', 'familia@teste.com'] };
  const f = $('faixa'); let h = MOCK ? `<div class="banner" style="margin-bottom:8px"><span>Modo de teste, com dados de exemplo. Você está como <b>${PAP[S.papel][0]}</b>.</span><span class="actions">${Object.entries(PAP).filter(([k]) => k !== S.papel).map(([k, [n, e]]) => `<button data-ver="${e}">Ver como ${n}</button>`).join('')}${S.admin ? `<button id="mano">${S.anoRef ? 'Voltar para hoje' : 'Simular janeiro de ' + (Number(hoje().slice(0, 4)) + 1)}</button>` : ''}</span></div>` : '';
  if (S.admin) {
    if (!S.cfg.mpConectadoEm) h += `<div class="banner"><span>O <b>Pix automático</b> ainda não está ligado. Conecte a conta do Mercado Pago da escola para os responsáveis pagarem pelo app.</span><button id="fpix">Ligar Pix</button></div>`;
    else if (S.mpc && S.mpc.conta && S.mpc.confirmada === false) h += `<div class="banner"><span>Confira a conta conectada: <b>${esc(S.mpc.conta.nome || '')}</b> ${esc(S.mpc.conta.doc || '')}</span><button id="fpix">Conferir</button></div>`;
  }
  f.innerHTML = h; if ($('fpix')) $('fpix').onclick = () => sheetAjustes();
  f.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => window.__mock.trocar(b.dataset.ver));
  if ($('mano')) $('mano').onclick = () => { S.anoRef = S.anoRef ? null : Number(hoje().slice(0, 4)) + 1; render(); if (S.anoRef) aviso('Simulando janeiro de ' + S.anoRef + ': veja os avisos de faixa etária.'); };
}
/* Padrão das telas: título, uma informação por linha embaixo, e à direita o valor com a etiqueta (status) embaixo dele.
   Detalhes em pares "rótulo: valor" alinhados (ddl) e somas em linhas (conta). Tudo já vem escapado. */
const linhas = (...xs) => xs.flat().filter(Boolean).map(x => `<div class="s">${x}</div>`).join('');
const valorCol = (valor, extra, cls) => `<span class="valor-col"><b class="amt num ${cls || ''}">${valor}</b>${extra || ''}</span>`;
const ddl = pares => `<dl class="dl">${pares.filter(p => p && p[1]).map(([r, v]) => `<dt>${esc(r)}</dt><dd>${v}</dd>`).join('')}</dl>`;
const contaL = (rot, val, cls) => `<div class="conta-linha ${cls || ''}"><span>${rot}</span><span class="num">${val}</span></div>`;
// a conta da mensalidade, linha por linha: cada turma, cada desconto autorizado e o total
function contaMensalidade(m, a, titulo) {
  if (!m) return '';
  const pct = x => Math.round((Number(x) || 0) * 100) + '%';
  return `<div class="conta">${titulo ? `<div class="label">${esc(titulo)}</div>` : ''}${m.turmasObj.map(t => contaL(esc(t.nome), brl(t.preco))).join('')}
    ${m.dMulti > 0 ? contaL(`Desconto mais de uma atividade (${pct(S.cfg.descMulti)})`, '− ' + brl(m.dMulti), 'desc') : ''}
    ${m.dIrma > 0 ? contaL(`Desconto de irmão(ã) (${pct(S.cfg.descIrmas)})`, '− ' + brl(m.dIrma), 'desc') : ''}
    ${m.dAjuste > 0 ? contaL((a && a.desc && a.desc.isenta ? 'Bolsa' : a && a.desc && a.desc.pct ? `Desconto (${Math.round(a.desc.pct * 100)}%)` : a && a.desc && a.desc.menos ? 'Desconto em R$' : 'Desconto combinado com a escola') + (a && a.desc && a.desc.motivo ? `<span class="s" style="display:block">${esc(a.desc.motivo)}</span>` : ''), '− ' + brl(m.dAjuste), 'desc') : m.dAjuste < 0 ? contaL('Valor combinado com a escola' + (a && a.desc && a.desc.motivo ? `<span class="s" style="display:block">${esc(a.desc.motivo)}</span>` : ''), '+ ' + brl(-m.dAjuste)) : ''}
    ${contaL('<b>Total por mês</b>', `<b>${brl(m.v)}</b>`, 'total')}</div>`;
}
function linhaAluna(alid, valor, status, subs, depois) {
  const a = S.alunas[alid] || {};
  return `<li class="tap" data-aluna="${esc(alid)}"><div class="dot">${esc(iniciais(a.nome))}</div><div class="grow"><div class="t">${esc(a.nome || 'Aluno(a)')}</div>${linhas(subs || [esc(respDe(alid).nome || 'Sem responsável')])}</div>${valorCol(brl(valor), status ? `<span class="chip ${status}">${ROT[status]}</span>` : '')}${depois || ''}</li>`;
}
const ligarAlunas = v => v.querySelectorAll('[data-aluna]').forEach(li => li.onclick = e => { if (e.target.closest('.wa')) return; sheetCobrancaAluna(li.dataset.aluna); });

/* ================= Cobranças (administração): resumo do mês, quem deve, atrasados e eventos — tudo numa aba ================= */
function atrasados() {
  const h = hoje(), porAluna = [], porMes = {}; let total = 0;
  for (const alid of Object.keys(S.alunas)) {
    const it = itensDe(alid).filter(i => !i.pago && i.venc < h); if (!it.length) continue;
    const v = C.r2(it.reduce((s, i) => s + i.v, 0)); total += v;
    it.forEach(i => { const m = String(i.venc).slice(0, 7); porMes[m] = C.r2((porMes[m] || 0) + i.v); });
    porAluna.push({ alid, it, v, desde: it[0].venc, dias: Math.round((Date.parse(h) - Date.parse(it[0].venc)) / 864e5), acordo: Object.values(S.acordos).some(A => A.alid === alid && !A.cancelado) });
  }
  porAluna.sort((x, y) => y.v - x.v);
  return { total: C.r2(total), porAluna, porMes };
}
function tCobrancas(v) {
  if (!Object.keys(S.turmas).length) { v.innerHTML = `<div class="empty"><b>Comece cadastrando as turmas.</b><span>Cada turma tem a sua mensalidade. Depois cadastre os alunos e os responsáveis.</span><button class="btn" id="pgo">Cadastrar turmas</button></div>`; $('pgo').onclick = () => irPara('turmas'); return; }
  const mes = S.mes, h = hoje(), atr = atrasados(), mudFx = mudancasFaixa();
  // resumo do mês escolhido
  const tot = { esp: 0, pix: 0, din: 0, aVencer: 0, vencido: 0 };
  for (const alid of Object.keys(S.alunas)) for (const i of itensDoMes(alid, mes)) {
    tot.esp += i.v; if (i.pago) { if (ONLINE(i.pago.via)) tot.pix += i.v; else tot.din += i.v; } else if (i.venc < h) tot.vencido += i.v; else tot.aVencer += i.v;
  }
  const rec = tot.pix + tot.din, pc = x => tot.esp ? x / tot.esp * 100 : 0, cur = brl;
  // quem deve: uma lista só, com filtros
  const filtro = S.filtroCobr || 'aberto', q = (S.buscaC || '').trim().toLowerCase(), mesAtual = mesHoje();
  const todos = Object.keys(S.alunas).map(alid => ({ alid, ...resumoAluna(alid) })).filter(r => r.it.length);
  const antigos = atr.porAluna.map(x => ({ ...x, vAntes: C.r2(x.it.filter(i => String(i.venc).slice(0, 7) < mesAtual).reduce((s, i) => s + i.v, 0)) })).filter(x => x.vAntes > 0);
  const cont = { aberto: todos.filter(r => r.aberto > 0).length, vencido: todos.filter(r => r.status === 'vencido').length, antigos: antigos.length, pago: todos.filter(r => r.status === 'pago').length, todas: todos.length };
  const busca = alid => !q || String(S.alunas[alid].nome).toLowerCase().includes(q) || String(respDe(alid).nome || '').toLowerCase().includes(q);
  const waDe = (alid, itens) => { const r = respDe(alid), wa = waLink(r.telefone, textoMsg('atraso', alid, itens)); return wa ? `<a class="wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp de ${esc(r.nome || '')}">${ICO_WA}</a>` : ''; };
  let lista;
  if (filtro === 'antigos') {
    const l = antigos.filter(x => busca(x.alid)), meses = {};
    l.forEach(x => x.it.filter(i => String(i.venc).slice(0, 7) < mesAtual).forEach(i => { const m = String(i.venc).slice(0, 7); meses[m] = C.r2((meses[m] || 0) + i.v); }));
    const ms = Object.entries(meses).sort((a, b) => a[0].localeCompare(b[0])), max = Math.max(1, ...ms.map(([, x]) => x)), tAnt = C.r2(l.reduce((s, x) => s + x.vAntes, 0));
    const nomeM = m => { const t = `${C.nomeMes(m).slice(0, 3)}/${m.slice(2, 4)}`; return t[0].toUpperCase() + t.slice(1); };
    lista = l.length ? `<div class="hero" style="gap:10px"><div><div class="label">Vencido em meses passados</div><div class="big num" style="color:var(--out)">${cur(tAnt)}</div><div class="sub">${l.length} aluno${l.length === 1 ? '' : 's'}</div></div>
        ${ms.length > 1 ? `<div class="mesbars">${ms.map(([m, x]) => `<div class="mb"><span class="num">${cur(x).replace('R$', '').trim()}</span><i style="height:${Math.max(6, x / max * 70)}px"></i><span>${esc(nomeM(m))}</span></div>`).join('')}</div>` : ''}</div>
      <ul class="list">${l.map(x => `<li><div class="dot">${esc(iniciais(S.alunas[x.alid].nome))}</div><div class="grow tap" data-aluna="${esc(x.alid)}" style="cursor:pointer"><div class="t">${esc(S.alunas[x.alid].nome)}</div>${linhas(esc(respDe(x.alid).nome || 'Sem responsável'), `Atrasado há ${x.dias} dias`, x.v > x.vAntes ? `<span class="num">+ ${cur(C.r2(x.v - x.vAntes))} vencido este mês</span>` : '')}</div>${valorCol(cur(x.vAntes), x.acordo ? '<span class="chip pix">Acordo</span>' : '', 'out')}${waDe(x.alid, x.it)}</li>`).join('')}</ul>
      <details class="dica"><summary class="headrow" style="cursor:pointer"><h2>Como resolver muitos atrasos</h2><span class="sub">ver ›</span></summary>
        <ol style="margin-top:10px"><li><b>Mande a cobrança pelo WhatsApp</b> (botão verde) com a lista do que está em aberto. Muitas vezes é só esquecimento.</li>
        <li><b>Faça um acordo</b>: toque no nome, junte os atrasados, dê um desconto se quiser e divida em parcelas. As parcelas aparecem para o responsável pagar pelo app.</li>
        <li><b>Cobre o que vence, não o que já passou:</b> o acordo deixa a mensalidade nova em dia e organiza o resto.</li></ol></details>`
      : `<div class="empty"><b>Nenhum atraso de meses passados.</b></div>`;
  } else {
    let rows = todos.filter(r => filtro === 'todas' || (filtro === 'aberto' ? r.aberto > 0 : r.status === filtro)).filter(r => busca(r.alid));
    rows.sort((a, b) => b.vencido - a.vencido || b.aberto - a.aberto || String(S.alunas[a.alid].nome).localeCompare(String(S.alunas[b.alid].nome), 'pt-BR'));
    lista = rows.length ? `<ul class="list">${rows.map(r => linhaAluna(r.alid, r.status === 'pago' ? 0 : r.aberto, r.status, [esc(respDe(r.alid).nome || 'Sem responsável'), r.vencido && r.vencido < r.aberto ? `<span class="num">${cur(r.vencido)} já vencido</span>` : ''], r.vencido ? waDe(r.alid, r.it.filter(i => !i.pago && st(i) === 'vencido')) : '')).join('')}</ul>`
      : `<div class="empty">${Object.keys(S.alunas).length ? 'Nenhum aluno neste filtro.' : '<b>Nenhum aluno cadastrado.</b><span>Cadastre os alunos na aba Alunos.</span>'}</div>`;
  }
  const ext = Object.entries(S.extras).filter(([, x]) => !eventoNovo(x) || pelaEscola(x)).sort((a, b) => String(b[1].venc).localeCompare(String(a[1].venc)));
  const fil = (k, n) => `<button class="pick" data-fl="${k}" aria-pressed="${filtro === k}">${n} <span class="num">${cont[k]}</span></button>`;
  v.innerHTML = `${avisoMudancasTermo()}${mudFx.length ? blocoFaixa(mudFx) : ''}${avisoAtestadosAdm()}
    <div class="hero">
      <div><div class="label">Recebido em ${esc(C.nomeMes(mes))}</div><div class="big num">${cur(rec)}</div>
        <div class="sub num">de ${cur(tot.esp)} previstos${tot.esp ? ` · ${Math.round(pc(rec))}%` : ''}</div></div>
      <div class="stack" role="img" aria-label="Recebido ${cur(rec)}, a vencer ${cur(tot.aVencer)}, vencido ${cur(tot.vencido)}">
        <i class="s-in" style="width:${pc(rec)}%"></i><i class="s-warn" style="width:${pc(tot.aVencer)}%"></i><i class="s-out" style="width:${pc(tot.vencido)}%"></i></div>
      <div class="tiles">
        <div class="tile"><span class="lbl"><span class="sw s-in"></span>Recebido</span><b class="num">${cur(rec)}</b><span class="s num">App ${cur(tot.pix).replace('R$', '').trim()}<br>Dinheiro ${cur(tot.din).replace('R$', '').trim()}</span></div>
        <div class="tile"><span class="lbl"><span class="sw s-warn"></span>A vencer</span><b class="num">${cur(tot.aVencer)}</b><span class="s">no prazo</span></div>
        <div class="tile"><span class="lbl"><span class="sw s-out"></span>Vencido</span><b class="num" style="color:var(--out)">${cur(tot.vencido)}</b><span class="s">deste mês</span></div>
      </div>
    </div>
    ${antigos.length && filtro !== 'antigos' ? `<button class="banner" data-fl="antigos" style="border:0;text-align:left;width:100%;background:var(--out-soft)"><span>Além disso, <b>${cur(C.r2(antigos.reduce((s, x) => s + x.vAntes, 0)))}</b> vencidos de meses passados, de ${antigos.length} aluno${antigos.length === 1 ? '' : 's'}.</span><span style="color:var(--out);font-weight:800">Ver ›</span></button>` : ''}
    <section><h2>Quem deve</h2>
      <div class="chips">${fil('aberto', 'Em aberto')}${fil('vencido', 'Vencidas')}${fil('antigos', 'Meses passados')}${fil('pago', 'Em dia')}${fil('todas', 'Todos')}</div>
      <div class="field"><input id="cbusca" type="search" placeholder="Buscar aluno(a) ou responsável" value="${esc(S.buscaC || '')}" aria-label="Buscar"></div>
      ${lista}
      <div class="note">Toque no nome para ver cada cobrança, cobrar com QR, receber em dinheiro ou fazer um acordo. O botão verde abre o WhatsApp do responsável com a mensagem pronta.</div>
    </section>
    <section><div class="headrow"><h2>Taxas e cobranças extras</h2><button class="add" id="xnovo">+ Lançar</button></div>
      ${ext.length ? `<ul class="list">${ext.map(([xid, x]) => { const alvo = [...C.alvoExtra(x, S.alunas, S.grupos)], pg = alvo.filter(a => C.stPag(((S.pags[a] || {}).extras || {})[xid])).length;
        const o = x.origem || x, para = [...(o.todos ? ['Todos os alunos'] : []), ...(o.eventos || []).map(k => { const e = S.extras[k.slice(3)]; return e ? ({ i: 'Inscrição confirmada · ', v: 'Disseram que vão · ', n: 'Não vão · ', s: 'Não responderam · ' }[k[1]] || 'Disseram que vão · ') + e.nome : ''; }), ...(o.grupos || []).map(g => (S.grupos[g] || {}).nome), ...(o.turmas || []).map(t => (S.turmas[t] || {}).nome)].filter(Boolean), tot = C.r2(alvo.reduce((t, id) => t + C.valorExtra(x, id), 0));
        return `<li class="tap" data-x="${esc(xid)}"><div class="grow"><div class="t">${esc(x.nome)}</div>${linhas(`<span class="num">${ehEvento(x) && x.data ? `Evento ${x.dataFim && x.dataFim !== x.data ? 'de ' : 'em '}${periodoTxt(x)}` : esc(C.TIPOS_EXTRA[x.tipo] || 'Extra')} · vence ${dataBR(x.venc)}</span>`, para.length ? 'Para: ' + esc(para.join(', ')) : '', `<span class="num">${alvo.length} aluno${alvo.length === 1 ? '' : 's'} · ${Object.keys(x.valores || {}).length ? 'valores diferentes' : brl(x.v) + ' cada'}</span>`, 'Recebe: ' + esc(nomeRec(C.recDe(x))))}</div>${valorCol(cur(tot), `<span class="s num">${pg} de ${alvo.length} pagas</span>`)}</li>`; }).join('')}</ul>`
        : `<div class="empty"><span>Lance aqui taxas, como a da federação, ajuda de custo ou uniforme. Dá para lançar só para os inscritos de um evento. Escolha para quais grupos, turmas ou alunos cada um vale e o vencimento de cada um.</span></div>`}
    </section>`;
  ligarFaixa(v);
  if ($('vatlist')) $('vatlist').onclick = () => sheetAtestadosEscola();
  v.querySelectorAll('[data-vmud]').forEach(b => b.onclick = () => sheetVerTermo(b.dataset.vmud));
  v.querySelectorAll('[data-fl]').forEach(b => b.onclick = () => { S.filtroCobr = b.dataset.fl; render(); });
  $('cbusca').oninput = e => { S.buscaC = e.target.value; render(); };
  ligarAlunas(v);
  v.querySelectorAll('[data-x]').forEach(li => li.onclick = () => sheetExtra(li.dataset.x));
  $('xnovo').onclick = () => sheetExtra();
}
// mensagens prontas para o responsável: lembrete, cobrança de atraso ou acordo.
// O texto vem do modelo da escola (Ajustes → Mensagens do WhatsApp); os campos entre chaves são preenchidos sozinhos.
const MODELOS_PADRAO = {
  lembrete: 'Olá, {responsavel}! Passando para lembrar das cobranças de {aluno} na {escola}:\n{lista}\nTotal: {total}\n\nPague pelo app, escolhendo o que quer pagar: {link}\n{codigo}',
  atraso: 'Olá, {responsavel}! Tudo bem? Aqui é da {escola}. Consta em aberto, referente a {aluno}:\n{lista}\nTotal: {total}\n\nSe ficar difícil pagar tudo de uma vez, podemos combinar um parcelamento. É só responder esta mensagem.\n\nPague pelo app, escolhendo o que quer pagar: {link}\n{codigo}',
  acordo: 'Olá, {responsavel}! Conforme combinamos, o acordo de {aluno} ficou assim:\n{parcelas}\nTotal: {total}\n\nPague pelo app: {link}\n{codigo}',
  atestado: 'Olá, {responsavel}! Aqui é da {escola}. Para {aluno} fazer as aulas com segurança, precisamos de um atestado médico dizendo que pode fazer a atividade física.\n\nÉ só tirar uma foto do atestado e enviar pelo app, em Meus filhos: {link}\n{codigo}'
};
const MODELOS_NOME = { lembrete: 'Lembrete', atraso: 'Atraso', acordo: 'Acordo', atestado: 'Atestado' };
const CAMPOS_MSG = [['responsavel', 'Responsável'], ['aluno', 'Aluno(a)'], ['escola', 'Escola'], ['lista', 'Lista de cobranças'], ['total', 'Total'], ['parcelas', 'Parcelas do acordo'], ['link', 'Link do app'], ['codigo', 'Código de acesso']];
const modeloDe = tipo => ((S.cfg.modelos || {})[tipo] || MODELOS_PADRAO[tipo]);
function preencherModelo(modelo, v) {
  return String(modelo).replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? v[k] : m).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function camposMsg(tipo, alid, itens) {
  const r = respDe(alid), a = S.alunas[alid] || {};
  const A = tipo === 'acordo' ? Object.entries(S.acordos).filter(([, x]) => x.alid === alid && !x.cancelado).map(([, x]) => x).pop() : null;
  const tot = A ? A.total : itens.reduce((s, i) => s + i.v, 0);
  return { responsavel: primeiro(r.nome) || 'responsável', aluno: primeiro(a.nome) || 'seu filho(a)', escola: S.escola.nome || 'escola',
    lista: itens.map(i => `• ${i.desc}: ${brl(i.v)} (${st(i) === 'vencido' ? 'venceu' : 'vence'} ${dataBR(i.venc)}${i.enc ? ', com multa e juros' : i.perdao && i.perdao.ate ? `, sem multa e juros se pago até ${dataBR(i.perdao.ate)}` : ''})`).join('\n'),
    total: brl(tot) + (A && A.desconto > 0 ? ` (com desconto de ${brl(A.desconto)})` : ''),
    parcelas: A ? A.parcelas.map(q => `• Parcela ${q.n} de ${A.parcelas.length}: ${brl(q.v)}, vence ${dataBR(q.venc)}`).join('\n') : '',
    link: LINK_APP, codigo: r.codigo ? `No primeiro acesso, use o código: ${r.codigo}` : '' };
}
function textoMsg(tipo, alid, itens) {
  if (tipo === 'acordo' && !Object.values(S.acordos).some(x => x.alid === alid && !x.cancelado)) tipo = 'lembrete';
  return preencherModelo(modeloDe(tipo), camposMsg(tipo, alid, itens));
}
// editar e salvar os modelos das mensagens
function sheetModelos(tipo0) {
  let tipo = tipo0 || 'lembrete'; const rasc = { ...MODELOS_PADRAO, ...(S.cfg.modelos || {}) };
  const exemplo = { responsavel: 'Patrícia', aluno: 'Sofia', escola: S.escola.nome || 'Escola', lista: '• Mensalidade de outubro: R$ 260,00 (venceu 10/10)\n• Taxa da federação: R$ 40,00 (vence 12/11)', total: 'R$ 300,00', parcelas: '• Parcela 1 de 2: R$ 150,00, vence 20/10\n• Parcela 2 de 2: R$ 150,00, vence 20/11', link: LINK_APP, codigo: 'No primeiro acesso, use o código: ABC123' };
  sheet(`<h3>Mensagens do WhatsApp</h3>
    <div class="sub">Escreva do seu jeito. O app troca os campos entre chaves pelos dados de cada aluno na hora de enviar.</div>
    <div class="seg">${Object.entries(MODELOS_NOME).map(([k, n]) => `<button type="button" data-mod="${k}">${n}</button>`).join('')}</div>
    <div class="field"><label for="mtxt">Modelo</label><textarea id="mtxt" class="msg-edit" rows="9"></textarea></div>
    <div class="field"><span class="lb">Toque para colocar um campo no texto</span><div class="chips">${CAMPOS_MSG.map(([k, n]) => `<button type="button" class="pick" data-campo="${k}">${n}</button>`).join('')}</div></div>
    <div class="field"><span class="lb">Exemplo de como chega</span><div class="msg-prev" id="mprev"></div></div>
    <button type="button" class="btn ghost btn-mini" id="mpadrao" style="align-self:flex-start">Voltar ao texto padrão</button>
    <div class="err" id="merr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn" id="mok">Salvar mensagens</button></div>`, sh => {
    const ver = () => { sh.querySelectorAll('[data-mod]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mod === tipo)); $('mtxt').value = rasc[tipo]; prev(); };
    const prev = () => { $('mprev').textContent = preencherModelo($('mtxt').value, exemplo); };
    sh.querySelectorAll('[data-mod]').forEach(b => b.onclick = () => { rasc[tipo] = $('mtxt').value; tipo = b.dataset.mod; ver(); });
    $('mtxt').addEventListener('input', () => { rasc[tipo] = $('mtxt').value; prev(); });
    sh.querySelectorAll('[data-campo]').forEach(b => b.onclick = () => { const t = $('mtxt'), ini = t.selectionStart ?? t.value.length, fim = t.selectionEnd ?? ini, ins = `{${b.dataset.campo}}`;
      t.value = t.value.slice(0, ini) + ins + t.value.slice(fim); rasc[tipo] = t.value; t.focus(); t.selectionStart = t.selectionEnd = ini + ins.length; prev(); });
    $('mpadrao').onclick = () => { rasc[tipo] = MODELOS_PADRAO[tipo]; ver(); aviso('Texto padrão de volta. Toque em salvar para ficar valendo.'); };
    $('mok').onclick = async () => {
      rasc[tipo] = $('mtxt').value; if (Object.values(rasc).some(t => !t.trim())) return $('merr').textContent = 'Nenhuma mensagem pode ficar vazia.';
      $('mok').disabled = true;
      const salvar = {}; Object.keys(MODELOS_PADRAO).forEach(k => salvar[k] = rasc[k] === MODELOS_PADRAO[k] ? null : rasc[k]);
      try { await B.set(`escolas/${S.eid}/config/geral`, { modelos: salvar }, { merge: true }); fecharSheet(); aviso('Mensagens salvas'); } catch (e) { $('merr').textContent = msgErro(e); $('mok').disabled = false; }
    };
    ver();
  });
}
const textoCobranca = (alid, itens) => textoMsg(itens.some(i => st(i) === 'vencido') ? 'atraso' : 'lembrete', alid, itens);
function sheetCobrancaAluna(alid) {
  const desenhar = () => {
    const a = S.alunas[alid]; if (!a) return fecharSheet();
    const r = respDe(alid), it = itensDe(alid), abertos = it.filter(i => !i.pago), pagos = it.filter(i => i.pago).reverse();
    const sel = new Set(abertos.map(i => i.k)), tot = abertos.reduce((s, i) => s + i.v, 0);
    const acordosAl = Object.entries(S.acordos).filter(([, A]) => A.alid === alid && !A.cancelado);
    let tipoMsg = abertos.some(i => st(i) === 'vencido') ? 'atraso' : acordosAl.length ? 'acordo' : 'lembrete';
    sheet(`<div class="headrow"><h3>${esc(a.nome)}</h3><button class="chip" id="cfich">Ficha do(a) aluno(a)</button></div>
      ${ddl([['Nascimento', esc(nascTxt(a))], ['Turmas', esc(turmasTxt(a) || 'Sem turma')], ['Responsável', esc(r.nome || '—')], ['WhatsApp', r.telefone ? `<span class="num" style="user-select:all">${esc(r.telefone)}</span>` : '']])}
      ${abertos.length ? `<div class="tot"><span>Em aberto</span><b class="num">${brl(tot)}</b></div>
        <div class="checks full">${abertos.map(i => `<label><input type="checkbox" data-i="${esc(i.k)}" checked><span class="grow"><span class="t" style="display:block">${esc(i.desc)}</span><span class="s">${esc(tipoItem(i))}${i.tipo === 'm' && i.detalhe ? ' · ' + esc(i.detalhe) : ''}</span><span class="s num">Vence ${dataBR(i.venc)}</span>${linhaEnc(i)}${i.enc ? `<button type="button" class="link enc-tirar" data-semenc="${esc(i.k)}">Tirar multa e juros</button>` : i.perdao ? `<button type="button" class="link enc-tirar" data-volenc="${esc(i.k)}">Voltar a cobrar multa e juros</button>` : ''}</span><span class="valor-col"><b class="num">${brl(i.v)}</b>${st(i) === 'vencido' ? '<span class="chip vencido">Vencida</span>' : ''}</span></label>`).join('')}</div>
        <div class="tot"><span>Marcado</span><b class="num" id="ftot"></b></div>
        <div class="actions"><button class="btn" id="fqr" ${S.cfg.mpConectadoEm ? '' : 'disabled'}>Cobrar na hora com QR</button><button class="btn ghost" id="fdin">Recebi em dinheiro</button></div>
        ${S.cfg.mpConectadoEm ? '' : '<div class="note">Ligue o Pix automático em Ajustes para gerar o QR Code.</div>'}
        ${abertos.some(i => st(i) === 'vencido' && i.tipo !== 'a') ? `<button class="btn ghost" id="facordo">Fazer acordo dos atrasados</button>` : ''}
        <div class="hero" style="padding:14px;gap:10px"><div class="label">Mensagem para ${esc(primeiro(r.nome) || 'o responsável')}</div>
          <div class="seg"><button data-mt="lembrete">Lembrete</button><button data-mt="atraso">Atraso</button>${acordosAl.length ? '<button data-mt="acordo">Acordo</button>' : ''}</div>
          <textarea id="fmtxt" class="msg-edit" rows="8" aria-label="Mensagem"></textarea>
          <div class="note">Pode mexer no texto antes de enviar. Para mudar o texto de todas as próximas vezes, <button type="button" class="link" id="fmod">edite o modelo</button>.</div>
          <div class="actions">${numeroWa(r.telefone) ? `<a class="btn wa-btn" id="fwa" target="_blank" rel="noopener">${ICO_WA} Abrir no WhatsApp</span></a>` : ''}<button class="btn ghost" id="fmsg">Copiar</button></div>
          ${numeroWa(r.telefone) ? `<div class="note">Abre a conversa com ${esc(r.telefone)} e a mensagem já escrita. Você confere e toca em enviar.</div>` : '<div class="note">Cadastre o WhatsApp do responsável para enviar direto.</div>'}</div>`
        : `<div class="empty"><b>${it.length ? 'Nada em aberto. Tudo pago!' : 'Nenhuma cobrança.'}</b></div>`}
      ${acordosAl.map(([aid, A]) => { const pg = A.parcelas.filter(q => C.stPag((((S.pags[alid] || {}).acordos || {})[aid] || {})[q.n])).length; return `<div class="banner ok"><span><b>Acordo de ${dataBR(A.criadoEm)}</b>: ${A.parcelas.length}x, total ${brl(A.total)}${A.desconto > 0 ? ` (desconto de ${brl(A.desconto)})` : ''} · ${pg} de ${A.parcelas.length} paga${pg === 1 ? '' : 's'}.</span>${pg ? '' : `<button data-cancac="${esc(aid)}">Cancelar acordo</button>`}</span></div>`; }).join('')}
      ${pagos.length ? `<details class="historico"><summary><span class="grow"><b>Histórico de pagamentos</b><span class="s">${pagos.length} pagamento${pagos.length === 1 ? '' : 's'} · ${brl(C.r2(pagos.reduce((x, i) => x + i.v, 0)))}</span></span><span class="seta" aria-hidden="true">▾</span></summary><ul class="list">${pagos.map(i => `<li><div class="grow"><div class="t">${esc(i.desc)}</div>${linhas(`<span class="num">${nomeVia(i.pago)}${i.pago.d ? ' em ' + dataBR(i.pago.d) : ''}</span>`)}</div>${valorCol(brl(i.v), ONLINE(i.pago.via) ? `<span class="chip pix">${NOME_VIA[i.pago.via]}</span>` : `<button class="chip" data-desf="${esc(i.k)}">Desfazer</button>`, 'in')}</li>`).join('')}</ul>
        <div class="note">O que foi pago por Pix fica travado: só o que foi recebido em dinheiro pode ser desfeito.</div></details>` : ''}
      <div class="err" id="ferr" role="alert"></div>
      <button class="btn ghost" data-fechar>Fechar</button>`, s => {
      $('cfich').onclick = () => abrirDe(() => sheetCobrancaAluna(alid), () => sheetAluna(alid));
      const upd = () => { const t = abertos.filter(i => sel.has(i.k)).reduce((x, i) => x + i.v, 0); if ($('ftot')) $('ftot').textContent = brl(t); ['fqr', 'fdin'].forEach(id => { if ($(id) && !(id === 'fqr' && !S.cfg.mpConectadoEm)) $(id).disabled = !t; }); };
      s.querySelectorAll('[data-i]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.i) : sel.delete(c.dataset.i); upd(); }); upd();
      const marcados = () => abertos.filter(i => sel.has(i.k));
      const atualizaWa = () => { if ($('fwa')) $('fwa').href = waLink(r.telefone, $('fmtxt').value); };
      const msg = () => { if (!$('fmtxt')) return; $('fmtxt').value = textoMsg(tipoMsg, alid, marcados().length ? marcados() : abertos); atualizaWa(); s.querySelectorAll('[data-mt]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mt === tipoMsg)); };
      if ($('fmtxt')) $('fmtxt').addEventListener('input', atualizaWa);
      if ($('fmod')) $('fmod').onclick = () => abrirDe(() => sheetCobrancaAluna(alid), () => sheetModelos(tipoMsg));
      s.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { tipoMsg = b.dataset.mt; msg(); });
      s.querySelectorAll('[data-i]').forEach(c => c.addEventListener('change', msg)); msg();
      if ($('fmsg')) $('fmsg').onclick = () => copiar($('fmtxt').value, 'Mensagem copiada. Cole no WhatsApp do responsável.');
      if ($('facordo')) $('facordo').onclick = () => abrirDe(() => sheetCobrancaAluna(alid), () => sheetAcordo(alid));
      s.querySelectorAll('[data-cancac]').forEach(b => b.onclick = () => confirmar('Cancelar acordo?', 'As cobranças antigas voltam para a lista de atraso, com os valores originais.', 'Cancelar acordo', async () => { await cancelarAcordo(b.dataset.cancac); setTimeout(() => sheetCobrancaAluna(alid), 80); }));
      if ($('fqr')) $('fqr').onclick = () => sheetPix(marcados().map(i => i.k), () => sheetCobrancaAluna(alid));
      if ($('fdin')) $('fdin').onclick = async () => {
        $('fdin').disabled = true;
        const val = i => ({ s: 'pago', d: hoje(), v: i.v, via: 'dinheiro', obs: 'Marcado pela administração', por: EU.uid });
        const up = { mens: {}, extras: {}, acordos: {} };
        marcados().forEach(i => { if (i.tipo === 'm') up.mens[i.mes] = val(i); else if (i.tipo === 'a') (up.acordos[i.aid] = up.acordos[i.aid] || {})[i.n] = val(i); else up.extras[i.xid] = val(i); });
        try { await B.set(`escolas/${S.eid}/pagamentos/${alid}`, up, { merge: true }); aviso('Pagamento registrado'); setTimeout(desenhar, 60); }
        catch (e) { $('ferr').textContent = msgErro(e); $('fdin').disabled = false; }
      };
      s.querySelectorAll('[data-semenc]').forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); abrirDe(() => sheetCobrancaAluna(alid), () => sheetPerdao(alid, b.dataset.semenc)); });
      s.querySelectorAll('[data-volenc]').forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation();
        confirmar('Voltar a cobrar multa e juros?', 'O acordo acaba agora e a cobrança volta com multa e juros desde o vencimento.', 'Voltar a cobrar', async () => { await B.tirar(`escolas/${S.eid}/pagamentos/${alid}`, `semEncargos.${chaveEnc(b.dataset.volenc)}`); aviso('Multa e juros de volta'); setTimeout(() => sheetCobrancaAluna(alid), 60); }); });
      s.querySelectorAll('[data-desf]').forEach(b => b.onclick = async () => {
        const i = pagos.find(x => x.k === b.dataset.desf); b.disabled = true;
        try { await B.tirar(`escolas/${S.eid}/pagamentos/${alid}`, i.tipo === 'm' ? `mens.${i.mes}` : i.tipo === 'a' ? `acordos.${i.aid}.${i.n}` : `extras.${i.xid}`); aviso('Pagamento desfeito'); setTimeout(desenhar, 60); }
        catch (e) { $('ferr').textContent = msgErro(e); b.disabled = false; }
      });
    });
  };
  desenhar();
}

/* ================= Tirar multa e juros até uma data ================= */
function sheetPerdao(alid, k) {
  const i = itensDe(alid).find(x => x.k === k); if (!i || !i.enc) return sheetCobrancaAluna(alid);
  const emDias = n => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const PRAZO_SUG = 2, PRAZO_MAX = 7, sug = emDias(PRAZO_SUG), max = emDias(PRAZO_MAX);
  sheet(`<h3>Tirar multa e juros</h3>
    <div class="sub">${esc((S.alunas[alid] || {}).nome || '')} · ${esc(i.desc)}</div>
    <div class="conta">${contaL('Valor original', brl(i.enc.base))}${contaL(`Multa e juros (${i.enc.dias} dia${i.enc.dias === 1 ? '' : 's'})`, '− ' + brl(C.r2(i.enc.multa + i.enc.juros)), 'desc')}${contaL('<b>Paga até a data limite</b>', `<b>${brl(i.enc.base)}</b>`, 'total')}</div>
    <div class="field"><label for="pdata">Data limite do acordo</label><input id="pdata" type="date" min="${hoje()}" max="${max}" value="${sug}"></div>
    <div class="chips">${[1, 2, 3, 5, 7].map(n => `<button type="button" class="pick" data-pd="${emDias(n)}">${n} dia${n > 1 ? 's' : ''}${n === PRAZO_SUG ? ' (sugerido)' : ''}</button>`).join('')}</div>
    <div class="note">O prazo pode ser de até ${PRAZO_MAX} dias.</div>
    <div class="aviso-lei"><b>Como funciona</b><span>Se pagar até a data, a família paga só o valor original. Se passar da data sem pagar, a multa e os juros voltam sozinhos, contados desde o vencimento, como se não tivesse havido acordo.</span></div>
    <div class="err" id="perr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" id="pvolta">Voltar</button><button type="button" class="btn" id="pok">Confirmar acordo</button></div>`, sh => {
    const marca = () => sh.querySelectorAll('[data-pd]').forEach(b => b.setAttribute('aria-pressed', b.dataset.pd === $('pdata').value));
    sh.querySelectorAll('[data-pd]').forEach(b => b.onclick = () => { $('pdata').value = b.dataset.pd; marca(); }); $('pdata').addEventListener('input', marca); marca();
    $('pvolta').onclick = () => sheetCobrancaAluna(alid);
    $('pok').onclick = async () => { const ate = $('pdata').value; if (!/^\d{4}-\d{2}-\d{2}$/.test(ate) || ate < hoje()) return $('perr').textContent = 'Escolha uma data de hoje em diante.';
      if (ate > max) return $('perr').textContent = `O prazo pode ser de no máximo ${PRAZO_MAX} dias (até ${dataBR(max)}).`;
      $('pok').disabled = true;
      try { await B.set(`escolas/${S.eid}/pagamentos/${alid}`, { semEncargos: { [chaveEnc(k)]: { ate, por: EU.uid, em: Date.now() } } }, { merge: true }); aviso(`Sem multa e juros até ${dataBR(ate)}`); setTimeout(() => sheetCobrancaAluna(alid), 60); }
      catch (e) { $('perr').textContent = msgErro(e); $('pok').disabled = false; } };
  });
}

/* ================= Acordo de atrasados ================= */
function sheetAcordo(alid) {
  const a = S.alunas[alid], r = respDe(alid), venc = itensDe(alid).filter(i => !i.pago && st(i) === 'vencido' && i.tipo !== 'a');
  const sel = new Set(venc.map(i => i.k)), d7 = new Date(Date.now() + 7 * 864e5), prim = `${d7.getFullYear()}-${pad(d7.getMonth() + 1)}-${pad(d7.getDate())}`;
  sheet(`<h3>Acordo · ${esc(a.nome)}</h3>
    <div class="sub">Responsável: ${esc(r.nome || '—')}. Junte as cobranças atrasadas, dê um desconto se quiser e divida em parcelas. As parcelas aparecem para pagar pelo app, e as cobranças antigas saem da lista de atraso.</div>
    <div class="checks full">${venc.map(i => `<label><input type="checkbox" data-ai="${esc(i.k)}" checked><span class="grow"><span class="t" style="display:block">${esc(i.desc)}</span><span class="s">venceu ${dataBR(i.venc)}</span></span><b class="num">${brl(i.v)}</b></label>`).join('')}</div>
    <div class="tot"><span>Total atrasado</span><b class="num" id="aqtot"></b></div>
    <div class="two"><div class="field"><label for="aqdt">Desconto</label><select id="aqdt"><option value="0">Sem desconto</option><option value="pct">Em %</option><option value="rs">Em R$</option></select></div>
    <div class="field" id="aqdvw" hidden><label for="aqdv" id="aqdl">Valor</label><input id="aqdv" inputmode="decimal"></div></div>
    <div class="two"><div class="field"><label for="aqn">Parcelas</label><select id="aqn">${[1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n === 1 ? 'À vista' : n + 'x'}</option>`).join('')}</select></div>
    <div class="field"><label for="aqv">1º vencimento</label><input id="aqv" type="date" value="${prim}" min="${hoje()}"></div></div>
    <div class="items" id="aqprev"></div>
    <div class="field"><label for="aqobs">Observação (opcional)</label><input id="aqobs" maxlength="120" placeholder="Ex.: combinado por telefone com o responsável"></div>
    <div class="err" id="aqerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="aqok">Fechar acordo</button></div>`, s => {
    let plano = null;
    const calc = () => {
      const its = venc.filter(i => sel.has(i.k)), bruto = C.r2(its.reduce((x, i) => x + i.v, 0)), t = $('aqdt').value, dv = parseValor($('aqdv').value);
      $('aqdvw').hidden = t === '0'; $('aqdl').textContent = t === 'pct' ? 'Desconto (%)' : 'Desconto (R$)';
      const desc = t === 'pct' && dv > 0 ? C.r2(bruto * Math.min(dv, 100) / 100) : t === 'rs' && dv > 0 ? Math.min(bruto, C.r2(dv)) : 0, total = C.r2(bruto - desc), n = Number($('aqn').value);
      const base = Math.floor(total / n * 100) / 100, parcelas = [];
      for (let k = 1; k <= n; k++) { const dt = new Date($('aqv').value + 'T12:00'); dt.setMonth(dt.getMonth() + k - 1); parcelas.push({ n: k, v: k === n ? C.r2(total - base * (n - 1)) : base, venc: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` }); }
      // quem recebe as parcelas: na mesma proporção das cobranças que entraram
      const porRec = {}; its.forEach(i => Object.entries(i.partes || { escola: i.v }).forEach(([rc, x]) => porRec[rc] = (porRec[rc] || 0) + x));
      const fracoes = Object.fromEntries(Object.entries(porRec).map(([rc, x]) => [rc, bruto ? x / bruto : 1]));
      plano = { its, bruto, desc, total, parcelas, fracoes };
      $('aqtot').textContent = brl(bruto);
      $('aqprev').innerHTML = its.length ? `${desc > 0 ? `<div class="item"><span>Desconto</span><b class="num" style="color:var(--in)">− ${brl(desc)}</b></div>` : ''}<div class="item"><span><b>Total do acordo</b></span><b class="num">${brl(total)}</b></div>${parcelas.map(q => `<div class="item sub"><span>${n === 1 ? 'À vista' : `Parcela ${q.n} de ${n}`} · vence ${dataBR(q.venc)}</span><span class="num">${brl(q.v)}</span></div>`).join('')}<div class="item sub"><span>Recebe: ${esc(Object.keys(fracoes).map(nomeRec).join(', '))}</span></div>` : '';
    };
    s.querySelectorAll('[data-ai]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.ai) : sel.delete(c.dataset.ai); calc(); });
    ['aqdt', 'aqdv', 'aqn', 'aqv'].forEach(id => $(id).addEventListener('input', calc)); calc();
    $('aqok').onclick = async () => {
      const err = m => $('aqerr').textContent = m;
      if (!plano.its.length) return err('Marque ao menos uma cobrança atrasada.');
      if (!(plano.total > 0)) return err('O total do acordo precisa ser maior que zero.');
      if (!$('aqv').value) return err('Escolha o vencimento da primeira parcela.');
      $('aqok').disabled = true;
      const aid = novoId(), A = { alid, rid: S.alunas[alid].responsavelId || null, itens: plano.its.map(i => ({ k: i.k, tipo: i.tipo, mes: i.mes || null, xid: i.xid || null, v: i.v, desc: i.desc })), original: plano.bruto, desconto: plano.desc, total: plano.total,
        parcelas: plano.parcelas, fracoes: plano.fracoes, resumo: `${plano.its.length} cobrança${plano.its.length > 1 ? 's' : ''} atrasada${plano.its.length > 1 ? 's' : ''}`, obs: $('aqobs').value.trim(), criadoEm: hoje(), por: EU.uid };
      const marca = i => ({ s: 'acordo', acordo: aid, v: i.v, d: hoje() }), up = { mens: {}, extras: {} };
      plano.its.forEach(i => { if (i.tipo === 'm') up.mens[i.mes] = marca(i); else up.extras[i.xid] = marca(i); });
      try { await B.lote([{ op: 'set', p: `escolas/${S.eid}/acordos/${aid}`, d: A }, { op: 'merge', p: `escolas/${S.eid}/pagamentos/${alid}`, d: up }]); aviso('Acordo fechado. Mande as parcelas para o responsável.'); setTimeout(() => sheetCobrancaAluna(alid), 80); }
      catch (e) { err(msgErro(e)); $('aqok').disabled = false; }
    };
  });
}
async function cancelarAcordo(aid) {
  const A = S.acordos[aid]; if (!A) return;
  for (const i of A.itens || []) await B.tirar(`escolas/${S.eid}/pagamentos/${A.alid}`, i.tipo === 'm' ? `mens.${i.mes}` : `extras.${i.xid}`).catch(() => { });
  await B.set(`escolas/${S.eid}/acordos/${aid}`, { cancelado: true, canceladoEm: hoje() }, { merge: true });
  aviso('Acordo cancelado');
}

/* ================= Pix: gerar e acompanhar ================= */
/* Um pagamento da mãe pode virar mais de um Pix: um para cada recebedor (escola ou professor(a)),
   porque o Mercado Pago manda cada Pix para uma conta só. Os Pix aparecem um depois do outro. */
const nomeRec = rec => rec === 'escola' ? (S.escola.nome || 'Escola') : ((S.profs[rec] || {}).nome || 'Professor(a)');
const recConectado = rec => rec === 'escola' ? !!S.cfg.mpConectadoEm : !!(S.profs[rec] || {}).mpConectadoEm;
function dividirPorRecebedor(itens) {
  const por = {};
  for (const i of itens) for (const [rec, v] of Object.entries(i.partes || { escola: i.v })) {
    const L = por[rec] = por[rec] || { rec, base: 0, itens: [] };
    L.base = C.r2(L.base + v); L.itens.push({ k: i.k, tipo: i.tipo, alid: i.alid, mes: i.mes || null, xid: i.xid || null, v, total: i.total || i.v, recs: Object.keys(i.partes || { escola: 1 }), desc: i.desc, nome: i.nome });
  }
  // escola primeiro, depois professoras em ordem alfabética
  return Object.values(por).sort((x, y) => (y.rec === 'escola') - (x.rec === 'escola') || nomeRec(x.rec).localeCompare(nomeRec(y.rec), 'pt-BR'));
}
async function pixCriar(chaves) {
  if (MOCK) {
    const quer = new Set(chaves), ab = [...new Set(chaves.map(k => k.split(':')[2]))].flatMap(alid => itensDe(alid)).filter(i => quer.has(i.k) && !i.pago && i.v > 0);
    if (!ab.length) throw new Error('Esses itens já foram pagos.');
    const lotes = dividirPorRecebedor(ab), sem = lotes.filter(l => !recConectado(l.rec));
    if (sem.length) throw new Error(`${sem.map(l => nomeRec(l.rec)).join(' e ')} ainda não ligou o Pix no app. Fale com a escola.`);
    const out = [];
    for (const l of lotes) {
      const { valor, fee } = C.valorPix(l.base, S.cfg, 0.0099, 0.01, repLote(l)), chave = `${EU.uid}_${l.rec}_${C.chaveItens(l.itens.map(i => i.k))}`;
      const d = { mpId: 'mock' + Date.now() + l.rec, rec: l.rec, valor, base: l.base, fee, status: 'pending', qr: `00020126580014br.gov.bcb.pix0136teste-${l.rec}-escolinha5204000053039865802BR5913${nomeRec(l.rec).normalize('NFD').replace(/[^A-Za-z ]/g, '').slice(0, 13).toUpperCase()}6006RECIFE62070503***6304ABCD`, qr64: '', criadoEm: Date.now(), expira: Date.now() + 864e5, uid: EU.uid, itens: l.itens };
      await B.set(`escolas/${S.eid}/cobrancas/${chave}`, d); out.push({ ...d, chave });
    }
    return out;
  }
  const t = await B.token().catch(() => null); if (!t) throw new Error('Entre na sua conta de novo.');
  let r; try { r = await fetch(URLF('criarPix'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ eid: S.eid, itens: chaves }) }); }
  catch (e) { throw new Error('Sem conexão com o servidor. Tente de novo.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || 'Não deu para gerar o Pix agora.');
  return Array.isArray(j.lotes) ? j.lotes : [{ ...j, rec: j.rec || 'escola' }];
}
async function mockAprovar(chave, via = 'pix', parcelas = 1) {
  const p = `escolas/${S.eid}/cobrancas/${chave}`, cob = await B.get(p); if (!cob) return;
  const val = v => ({ s: 'pago', d: hoje(), v, obs: via === 'pix' ? 'Pix automático' : 'Pago pelo app (' + NOME_VIA[via] + ')', via, ...(parcelas > 1 ? { parcelas } : {}), mp: cob.mpId, rec: cob.rec });
  for (const i of cob.itens) {
    const fp = `escolas/${S.eid}/pagamentos/${i.alid}`, pag = (await B.get(fp)) || {};
    if (i.tipo === 'x') { await B.set(fp, { extras: { [i.xid]: val(i.v) } }, { merge: true }); continue; }
    if (i.tipo === 'a') { const [aid, n] = i.k.split(':')[1].split('.'); await B.set(fp, { acordos: { [aid]: { [n]: val(i.v) } } }, { merge: true }); continue; }
    const partes = { ...(((pag.mensPartes || {})[i.mes]) || {}), [cob.rec]: val(i.v) };
    const up = { mensPartes: { [i.mes]: { [cob.rec]: val(i.v) } } };
    // mensalidade fica "paga" quando todos os recebedores dela receberam
    if ((i.recs || [cob.rec]).every(r => C.stPag(partes[r]))) up.mens = { [i.mes]: { ...val(i.total), rec: i.recs.length > 1 ? 'dividido' : cob.rec } };
    await B.set(fp, up, { merge: true });
  }
  await B.set(p, { status: 'approved' }, { merge: true });
}
const opcoesRec = atual => [['escola', (S.escola.nome || 'Escola') + ' (escola)'], ...porNome(S.profs).map(([id, P]) => [id, P.nome])].map(([id, n]) => `<option value="${esc(id)}" ${(atual || 'escola') === id ? 'selected' : ''}>${esc(n)}${recConectado(id) ? '' : ' (Pix não ligado)'}</option>`).join('');
// a família escolhe como pagar, vendo quanto fica em cada forma
function sheetFormas(chaves) {
  const quer = new Set(chaves), itens = [...new Set(chaves.map(k => k.split(':')[2]))].flatMap(alid => itensDe(alid)).filter(i => quer.has(i.k) && !i.pago);
  const lotes = dividirPorRecebedor(itens), base = C.r2(itens.reduce((x, i) => x + i.v, 0)), f = formasCfg(), N = lotes.length;
  const tot = (forma, n) => C.r2(lotes.reduce((x, l) => x + valorForma(l.base, forma, n, repLote(l)).total, 0));
  const ops = [['pix', null, 'Pix', 'Cai na hora · mais barato', ICO.cobr]];
  if (f.boleto) ops.push(['boleto', null, 'Boleto', 'Compensa em até 3 dias úteis', ICO.caixa]);
  if (f.cartao) ops.push(['cartao', 1, 'Cartão de crédito à vista', 'Na fatura do cartão', ICO.caixa]);
  if (f.cartao && f.parcelado) for (let n = 2; n <= Math.min(6, Number(f.maxParcelas) || 1); n++) ops.push(['cartao', n, `Cartão em ${n}x`, '', ICO.caixa]);
  const pix = tot('pix');
  sheet(`<h3>Como você quer pagar?</h3>
    <div class="conta">${contaL('Cobranças escolhidas', brl(base))}</div>
    ${N > 1 ? `<div class="banner"><span>Vai para ${N} recebedores (${lotes.map(l => esc(nomeRec(l.rec))).join(', ')}), então o pagamento é feito em ${N} partes, uma para cada um.</span></div>` : ''}
    <div class="formas">${ops.map(([fo, n, t, d, ic], i) => { const v = tot(fo, n), par = n > 1 ? C.r2(v / n) : 0;
      return `<button type="button" class="forma" data-fo="${fo}" data-n="${n || 1}"><span class="vant-ic">${ic}</span><span class="grow"><b>${esc(t)}</b><span class="s">${n > 1 ? `${n}x de ${brl(par)}` : esc(d)}</span></span><span class="valor-col"><b class="num">${brl(v)}</b>${fo !== 'pix' && v > pix ? `<span class="s num">+ ${brl(C.r2(v - pix))} que o Pix</span>` : fo === 'pix' && ops.length > 1 ? '<span class="chip pago">Melhor preço</span>' : ''}</span></button>`; }).join('')}</div>
    <button class="btn ghost" data-fechar>Cancelar</button>`, sh => {
    sh.querySelectorAll('[data-fo]').forEach(b => b.onclick = () => { const fo = b.dataset.fo, n = Number(b.dataset.n);
      if (fo === 'pix') abrirDe(() => sheetFormas(chaves), () => sheetPix(chaves)); else abrirDe(() => sheetFormas(chaves), () => sheetOutraForma(chaves, fo, n)); });
  });
}
// boleto e cartão: no app publicado, abre a tela segura do Mercado Pago (o cartão nunca passa pelo app)
function sheetOutraForma(chaves, forma, n) {
  sheet(`<h3>${forma === 'boleto' ? 'Pagar com boleto' : n > 1 ? `Cartão em ${n}x` : 'Cartão de crédito'}</h3><div id="ofc" class="empty">Preparando…</div><button class="btn ghost" data-fechar>Fechar</button>`, async () => {
    let lotes; try { lotes = await pixCriar(chaves); } catch (e) { $('ofc').innerHTML = `<b>Não deu para preparar.</b><span>${esc(msgErro(e))}</span>`; return; }
    const vals = lotes.map(l => ({ ...l, ...valorForma(l.base, forma, n, repLote(l)) })), total = C.r2(vals.reduce((x, l) => x + l.total, 0));
    const passo = k => {
      const l = vals[k], N = vals.length;
      $('ofc').outerHTML = `<div id="ofc" style="display:flex;flex-direction:column;gap:12px">
        ${N > 1 ? `<div class="banner"><span>Parte ${k + 1} de ${N} · para ${esc(nomeRec(l.rec))}. Total ${brl(total)}.</span></div>` : ''}
        <div class="conta">${contaL('Cobranças', brl(l.base))}${l.total > l.base ? contaL(forma === 'boleto' ? 'Taxa do boleto' : n > 1 ? 'Taxas do cartão e do parcelamento' : 'Taxa do cartão', brl(C.r2(l.total - l.base))) : ''}${contaL('<b>Total</b>', `<b>${brl(l.total)}</b>`, 'total')}${n > 1 ? contaL(`${n} parcelas de`, brl(l.parcela)) : ''}</div>
        <div class="note">${forma === 'boleto' ? 'O boleto é gerado pelo Mercado Pago. Você pode pagar no app do banco ou numa lotérica. Quando compensar (até 3 dias úteis), a baixa é automática.' : 'Você digita o cartão na tela segura do Mercado Pago: o número do cartão não passa pelo app nem fica com a escola. Quando aprovar, a baixa é automática.'}</div>
        <button class="btn" id="ofir">${forma === 'boleto' ? 'Gerar boleto' : 'Pagar no Mercado Pago'}</button>
        ${MOCK ? `<button class="btn ghost" id="ofmock">Teste: simular ${forma === 'boleto' ? 'boleto pago' : 'cartão aprovado'}</button>` : ''}
      </div>`;
      $('ofir').onclick = () => aviso(MOCK ? 'Na demonstração, use o botão de simular. No app publicado, abre o Mercado Pago.' : 'Disponível quando o servidor for atualizado.');
      if ($('ofmock')) $('ofmock').onclick = async () => { await mockAprovar(l.chave, forma, n || 1); if (k + 1 < N) { aviso(`Parte para ${primeiro(nomeRec(l.rec))} paga. Agora a próxima.`); passo(k + 1); } else { $('ofc').innerHTML = `<div class="done"><div class="ok">✓</div><h3>Pagamento confirmado!</h3><span class="sub">${brl(total)} ${forma === 'boleto' ? 'no boleto' : 'no cartão'}${n > 1 ? ` em ${n}x` : ''}. Obrigado!</span></div>`; S.sel = null; } };
    };
    passo(0);
  });
}
function sheetPix(chaves, voltar) {
  let parar = null;
  sheet(`<h3>Pagar com Pix</h3><div id="pxc" class="empty">Gerando o Pix…</div><div class="err" id="pxerr" role="alert"></div><button class="btn ghost" id="pxf">Fechar</button>`, async () => {
    $('pxf').onclick = () => { fecharSheet(); voltar && voltar(); };
    let lotes;
    try { lotes = await pixCriar(chaves); } catch (e) { $('pxc').innerHTML = `<b>Não deu para gerar o Pix.</b><span>${esc(msgErro(e))}</span>`; return; }
    const total = C.r2(lotes.reduce((s, l) => s + l.valor, 0));
    const passo = n => {
      if (!$('pxc')) return; parar && parar(); parar = null;
      const d = lotes[n], N = lotes.length, repasse = C.r2(d.valor - d.base), porAluna = {};
      (d.itens || []).forEach(i => (porAluna[i.nome || 'Aluno(a)'] = porAluna[i.nome || 'Aluno(a)'] || []).push(i));
      $('pxc').outerHTML = `<div id="pxc" style="display:flex;flex-direction:column;gap:12px">
        ${N > 1 ? `<div class="banner"><span>Seu pagamento vai em <b>${N} Pix</b>, um para cada recebedor: ${lotes.map((l, i) => `${i < n ? '✓ ' : ''}${esc(nomeRec(l.rec))} ${brl(l.valor)}`).join(' · ')}. Total ${brl(total)}.</span></div>` : ''}
        <div class="headrow"><h2>${N > 1 ? `Pix ${n + 1} de ${N}` : 'Pix'} · para ${esc(nomeRec(d.rec))}</h2></div>
        ${(() => { // só o que está sendo pago, sem valor de cada coisa; a taxa vai junto do último item ("+ taxa de transação")
          const grupos = Object.entries(porAluna), ult = grupos.length - 1;
          return grupos.map(([nm, l], g) => `<div class="items"><div class="label">${esc(nm)}</div>${l.map((i, k) => `<div class="item"><span>${esc(i.desc)}${i.v < i.total ? ' <span class="sub">(parte da ' + esc(nomeRec(d.rec).split(' ')[0]) + ')</span>' : ''}${repasse > 0 && g === ult && k === l.length - 1 ? ' + taxa de transação' : ''}</span></div>`).join('')}</div>`).join(''); })()}
        <div class="tot"><span>Valor deste Pix</span><b class="num">${brl(d.valor)}</b></div>
        <div class="qrbox">${d.qr64 ? `<img src="data:image/png;base64,${d.qr64}" alt="QR Code do Pix">` : qrSVG(d.qr)}</div>
        <div class="code">${esc(d.qr)}</div>
        <button class="btn" id="pxcopy">Copiar código Pix</button>
        <div class="pix-st" id="pxst"><i></i>Aguardando o pagamento. ${n + 1 < N ? 'Quando este Pix cair, aparece o próximo.' : 'Esta tela muda sozinha quando o Pix cair.'}</div>
        <div class="note">O QR vale por 24 horas. No app do banco, escolha Pix → Pagar com QR Code ou Pix copia e cola.</div>
        ${MOCK ? `<button class="btn ghost" id="pxmock">Teste: simular Pix pago</button>` : ''}
      </div>`;
      $('pxcopy').onclick = () => copiar(d.qr, 'Código Pix copiado. Cole no app do banco.');
      if ($('pxmock')) $('pxmock').onclick = () => mockAprovar(d.chave);
      parar = B.ouvirDoc(`escolas/${S.eid}/cobrancas/${d.chave}`, c => {
        if (!c || !$('pxst')) return;
        if (c.status === 'approved') {
          if (n + 1 < N) { aviso(`Pix para ${primeiro(nomeRec(d.rec))} confirmado. Agora o próximo.`); setTimeout(() => passo(n + 1), 400); return; }
          $('pxc').innerHTML = `<div class="done"><div class="ok">✓</div><h3>Pagamento confirmado!</h3><span class="sub">${N > 1 ? `${N} Pix, ${brl(total)} no total` : brl(c.valor) + ' recebidos por Pix'}. Obrigado!</span></div>`; S.sel = null; parar && parar(); parar = null;
        } else if (['rejected', 'cancelled', 'expired'].includes(c.status)) $('pxst').innerHTML = `<i style="background:var(--out)"></i>Este Pix foi cancelado ou venceu. Feche e gere outro.`;
      }, () => { });
    };
    passo(0);
  }, () => { parar && parar(); });
}

/* ================= Eventos e taxas ================= */
const TIPOS_LANCAR = [['evento', 'Evento'], ['taxa', 'Taxa']];
const ehEvento = x => !!x && (x.tipo === 'evento' || x.tipo === 'competicao');
// evento novo: só calendário e inscrições; a inscrição é paga direto ao organizador, fora do app
const eventoNovo = x => ehEvento(x) && (!!x.semCobranca || x.cobranca === 'app');
// inscrição pelo caixa da escola: quem diz "vai" recebe a cobrança no app; pagou, está inscrito
const pelaEscola = x => eventoNovo(x) && x.cobranca === 'app';
const xidDe = x => Object.keys(S.extras).find(k => S.extras[k] === x);
const pagouEvento = (x, id) => { const k = xidDe(x); return !!(k && C.stPag(((S.pags[id] || {}).extras || {})[k])); };
const ST_PART = { interesse: 'Quer ir', nao: 'Não vai', inscrito: 'Inscrito(a)' };
// quem faz a inscrição: a escola (paga ao organizador), a própria família (e confirma no app) ou pelo app (Pix da escola)
// duas formas de inscrição: direto com a organização (a família confirma no app) ou na escola (Pix no app, confirma sozinho)
// fotos de evento: reduzidas no celular (até 1400 px, ~250 KB cada), no máximo 3 por evento
const FOTOS_EV_MAX = 3, FOTO_EV_BYTES = 260000, MIDIA_EV = {};
async function fotoReduzida(arquivo) {
  const c = await abrirImagem(arquivo, 1400); let url = '';
  for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) { url = c.toDataURL('image/jpeg', q); if (url.length * 0.75 <= FOTO_EV_BYTES) return url; }
  const m = await abrirImagem(arquivo, 1000); return m.toDataURL('image/jpeg', 0.6);
}
// fotos de um evento (busca uma vez e guarda); "pronto" redesenha quando chegam
function fotosDoEvento(xid, x, pronto) {
  if (!x || !x.fotos) return [];
  if (MIDIA_EV[xid]) return MIDIA_EV[xid] === 'carregando' ? [] : MIDIA_EV[xid];
  MIDIA_EV[xid] = 'carregando';
  B.get(`escolas/${S.eid}/midiaEventos/${xid}`).then(d => { MIDIA_EV[xid] = (d && d.fotos) || []; pronto && pronto(); }).catch(() => { MIDIA_EV[xid] = []; });
  return [];
}
const fotosHTML = (xid, fotos) => fotos.length ? `<div class="ev-fotos ver">${fotos.map((f, i) => `<button type="button" class="ev-foto" data-verfoto="${esc(xid)}:${i}"><img src="${esc(f.src)}" alt="Foto ${i + 1} do evento"></button>`).join('')}</div>` : '';
function ligarFotos(raiz) {
  raiz.querySelectorAll('[data-verfoto]').forEach(b => b.onclick = () => { const [xid, i] = b.dataset.verfoto.split(':'), f = (MIDIA_EV[xid] || [])[Number(i)]; if (!f) return;
    sheet(`<h3>${esc((S.extras[xid] || {}).nome || 'Evento')}</h3><img src="${esc(f.src)}" alt="" style="width:100%;border-radius:5px;display:block"><button class="btn ghost" data-fechar>Fechar</button>`); });
}
const modoInsc = x => x && x.cobranca === 'app' ? 'app' : 'familia';
const MODOS_INSC = [['familia', 'Na organização'], ['app', 'Na escola']];
const partDe = (x, id) => { const st = (((x || {}).part || {})[id] || {}).st || null; return pelaEscola(x) && pagouEvento(x, id) ? 'inscrito' : st; };
const convidadosDe = x => eventoNovo(x) ? (x.convidados || []).filter(id => S.alunas[id]) : [...C.alvoExtra(x, S.alunas, S.grupos)];
const eventosAtivos = () => Object.entries(S.extras).filter(([, x]) => eventoNovo(x) && x.data).sort((a, b) => a[1].data.localeCompare(b[1].data));

// quadros para escolher atletas: todos, inscritos/interessados de cada evento (só nas taxas), grupos e turmas
function quadrosDe(selA, comEventos, foco) {
  const ativos = porNome(S.alunas).filter(([id, a]) => (C.ativaNoMes(a, mesHoje()) && !a.anonimizadoEm) || selA.has(id)).map(([id]) => id);
  const q = [['todos', 'Todos os alunos', ativos]];
  if (comEventos) { const lim = isoDe(new Date(Date.now() - 90 * 864e5));
    for (const [xid, x] of eventosAtivos().filter(([, x]) => fimDe(x) >= lim)) { const cv = convidadosDe(x);
      // evento escolhido na taxa: todas as respostas, cada uma no seu quadro
      if (xid === foco) { const por = st => cv.filter(id => (partDe(x, id) || 'sem') === st), fam = modoInsc(x) === 'familia';
        q.push(['ei:' + xid, `Vão · inscrição confirmada · ${x.nome}`, por('inscrito')], ['ev:' + xid, `Vão · ${fam ? 'falta confirmar a inscrição' : 'falta inscrever'} · ${x.nome}`, por('interesse')],
          ['en:' + xid, `Não vão · ${x.nome}`, por('nao')], ['es:' + xid, `Não responderam · ${x.nome}`, por('sem')]); continue; }
      const ins = cv.filter(id => partDe(x, id) === 'inscrito'), vao = cv.filter(id => ['interesse', 'inscrito'].includes(partDe(x, id)));
      if (ins.length) q.push(['ei:' + xid, `Inscrição confirmada · ${x.nome}`, ins]);
      if (vao.length > ins.length) q.push(['ev:' + xid, `Disseram que vão · ${x.nome}`, vao]); } }
  return [...q, ...porNome(S.grupos).map(([g, G]) => ['g:' + g, G.nome, (G.alunas || []).filter(id => S.alunas[id])]),
    ...ordenar(S.turmas).map(([t, T]) => ['t:' + t, T.nome, alunasDaTurma(t).map(([id]) => id)])];
}
// seletor de atletas por quadros (taxas e eventos). Com valor: cada atleta pode ter o seu, confirmado no botão OK
function seletorAtletas(raiz, o) {
  const { quadros, selA, usados, vals, comValor, travado = () => false, subDe, aoMudar } = o;
  const Q = Object.fromEntries(quadros.map(q => [q[0], q])); let aberto = null;
  const valDe = id => vals && vals[id] != null ? vals[id] : o.padrao();
  const linha = id => { const a = S.alunas[id] || {}, on = selA.has(id), tr = travado(id);
    return `<div class="xa ${on ? 'on' : ''}"><label class="xa-nome"><input type="checkbox" data-xa="${esc(id)}" ${on ? 'checked' : ''} ${tr ? 'disabled' : ''}><span class="grow"><span class="t">${esc(a.nome)}</span><span class="s">${esc(subDe ? subDe(id) : turmasTxt(a) || 'Sem turma')}</span></span></label>
      ${comValor && on ? `<span class="xa-val"><span aria-hidden="true">R$</span><input data-xv="${esc(id)}" inputmode="decimal" value="${esc(fmtValor(valDe(id)))}" aria-label="Valor de ${esc(a.nome)}" ${tr ? 'disabled' : ''}><button type="button" class="xa-ok" data-xok="${esc(id)}" hidden>OK</button></span>` : ''}</div>`; };
  const desenhar = () => {
    raiz.innerHTML = quadros.map(([k, nome, ids]) => { const n = ids.filter(id => selA.has(id)).length, todos = ids.length && n === ids.length, ab = aberto === k;
      return `<div class="xq ${ab ? 'aberto' : ''} ${n ? 'tem' : ''}"><button type="button" class="xq-cab" data-q="${esc(k)}" aria-expanded="${ab}"><span class="grow"><b>${esc(nome)}</b><span class="s">${ids.length ? (n ? (todos ? (ids.length === 1 ? '1 marcado' : `Todos os ${ids.length} marcados`) : `${n} de ${ids.length} marcado${n === 1 ? '' : 's'}`) : `${ids.length} aluno${ids.length === 1 ? '' : 's'} · nenhum marcado`) : 'Nenhum aluno'}</span></span><span class="seta" aria-hidden="true">▾</span></button>
        ${ab && ids.length ? `<div class="xq-corpo"><label class="xa-todos"><input type="checkbox" data-todos="${esc(k)}" ${todos ? 'checked' : ''}><b>Todos</b><span class="s">(${ids.length})</span></label>${ids.map(linha).join('')}</div>` : ''}</div>`; }).join('');
    raiz.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { aberto = aberto === b.dataset.q ? null : b.dataset.q; desenhar(); });
    raiz.querySelectorAll('[data-todos]').forEach(c => c.onchange = () => { usados.add(c.dataset.todos); Q[c.dataset.todos][2].forEach(id => { if (travado(id)) return; c.checked ? selA.add(id) : selA.delete(id); }); desenhar(); });
    raiz.querySelectorAll('[data-xa]').forEach(c => c.onchange = () => { if (aberto) usados.add(aberto); c.checked ? selA.add(c.dataset.xa) : selA.delete(c.dataset.xa); desenhar(); });
    // valor de um atleta: só vale depois de tocar em OK (evita digitar 12000 sem querer)
    raiz.querySelectorAll('[data-xv]').forEach(i => { const id = i.dataset.xv, ok = raiz.querySelector(`[data-xok="${CSS.escape(id)}"]`);
      i.oninput = () => { const v = parseValor(i.value), mudou = i.value.trim() !== '' && v >= 0 && C.r2(v) !== C.r2(valDe(id)); ok.hidden = !mudou; i.classList.toggle('pend', mudou || (i.value.trim() !== '' && !(v >= 0))); };
      i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } };
      ok.onclick = () => { const v = C.r2(parseValor(i.value)); if (!(v >= 0)) return; if (v === C.r2(o.padrao())) delete vals[id]; else vals[id] = v; desenhar(); aviso(`Valor de ${primeiro(S.alunas[id].nome)}: ${brl(v)}`); }; });
    if (aoMudar) aoMudar();
  };
  // há valor digitado e não confirmado?
  const pendente = () => { const i = raiz.querySelector('input.pend'); return i ? S.alunas[i.dataset.xv] : null; };
  const origem = () => { const r = { todos: false, grupos: [], turmas: [], eventos: [] }; quadros.forEach(([k, , qids]) => { if (!usados.has(k) || !qids.some(id => selA.has(id))) return;
    if (k === 'todos') r.todos = true; else if (k[0] === 'g') r.grupos.push(k.slice(2)); else if (k[0] === 't') r.turmas.push(k.slice(2)); else r.eventos.push(k); }); return r; };
  return { desenhar, pendente, origem, valDe };
}

// ---- Taxas (e cobranças antigas de eventos) ----
function sheetExtra(xid, op = {}) {
  const x = xid ? S.extras[xid] : null, ed = !!x;
  if (x && eventoNovo(x)) return sheetVerEvento(xid);
  if (!ed && op.tipo === 'evento') return sheetEvento(null);
  const pagou = id => !!(x && C.stPag(((S.pags[id] || {}).extras || {})[xid]));
  const temPag = ed && Object.keys(S.pags).some(pagou), legado = ed && ehEvento(x);
  const pre = op.pre || {};
  const selA = new Set(x ? [...C.alvoExtra(x, S.alunas, S.grupos)] : pre.ids || []), vals = { ...((x && x.valores) || {}) };
  const o0 = (x && x.origem) || x || {}, usados = new Set([...(o0.todos ? ['todos'] : []), ...(o0.grupos || []).map(g => 'g:' + g), ...(o0.turmas || []).map(t => 't:' + t), ...(o0.eventos || []), ...(pre.quadro ? [pre.quadro] : [])]);
  let evento = x ? x.evento || null : pre.evento || null, quadros = quadrosDe(selA, true, evento);
  const padrao = () => parseValor(($('xval') || {}).value || '') || 0;
  const evsTaxa = eventosAtivos().filter(([id, e]) => id === evento || fimDe(e) >= isoDe(new Date(Date.now() - 90 * 864e5)));
  sheet(`<h3>${ed ? (legado ? 'Editar cobrança do evento' : 'Editar taxa') : 'Lançar'}</h3>
    ${ed ? '' : `<div class="seg">${TIPOS_LANCAR.map(([k, n]) => `<button type="button" data-t="${k}" aria-pressed="${k === 'taxa'}">${n}</button>`).join('')}</div>`}
    <div class="field"><label for="xnome">Descrição</label><input id="xnome" maxlength="60" value="${esc(x ? x.nome : pre.nome || '')}" placeholder="Ex.: Ajuda de custo, uniforme, taxa da federação"></div>
    ${legado ? `<div class="note">Evento ${esc(periodoTxt(x))}${x.local ? ' · ' + esc(x.local) : ''}. Esta é uma cobrança antiga, feita pelo app.</div>` : ''}
    <div class="two"><div class="field"><label for="xval">Valor padrão (R$)</label><input id="xval" inputmode="decimal" value="${esc(fmtValor(x && x.v))}" placeholder="0,00" ${temPag ? 'disabled' : ''}></div>
    <div class="field"><label for="xven">Vencimento</label><input id="xven" type="date" value="${esc(x ? x.venc : hoje())}" ${temPag ? 'disabled' : ''}></div></div>
    ${temPag ? '<div class="note">Já há pagamentos desta cobrança: o valor padrão e o vencimento não mudam mais. Quem já pagou fica como está; dá para incluir alunos e mudar o valor de quem ainda não pagou.</div>' : ''}
    ${S.admin ? `<div class="field"><label for="xrec">O pagamento vai para</label><select id="xrec" ${temPag ? 'disabled' : ''}>${opcoesRec(x ? x.recebedor : 'escola')}</select></div>` : `<div class="note">A escola escolhe para quem vai o pagamento desta cobrança.</div>`}
    ${!legado && evsTaxa.length ? `<div class="field"><label for="xev">É de um evento?</label><select id="xev"><option value="">Não, taxa avulsa</option>${evsTaxa.map(([id, e]) => `<option value="${esc(id)}" ${id === evento ? 'selected' : ''}>${esc(e.nome)} · ${esc(periodoTxt(e))}</option>`).join('')}</select>
      <span class="sub" id="xevnota"></span></div>` : ''}
    <div class="field"><span class="lb">Para quem? Toque num quadro para escolher os atletas</span><div id="xquadros"></div></div>
    <div class="xresumo" id="xcont"></div>
    <div class="err" id="xerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="xok">Salvar</button></div>
    ${ed ? `<button class="btn ghost" id="xdel" style="color:var(--out)">Excluir cobrança</button>` : ''}`, s => {
    const resumo = () => {
      const ids = [...selA].filter(id => S.alunas[id]), tot = C.r2(ids.reduce((t, id) => t + sel.valDe(id), 0)), dif = ids.filter(id => vals[id] != null && vals[id] !== padrao());
      $('xcont').innerHTML = ids.length ? `<details class="historico"><summary><span class="grow"><b>${ids.length} aluno${ids.length === 1 ? '' : 's'} · total ${brl(tot)}</b><span class="s">${dif.length ? `${dif.length} com valor diferente do padrão` : padrao() ? `${brl(padrao())} cada` : 'Informe o valor padrão'} · toque para ver a lista</span></span><span class="seta" aria-hidden="true">▾</span></summary>
        <div class="conta" style="padding:0 14px 14px">${porNome(Object.fromEntries(ids.map(id => [id, S.alunas[id]]))).map(([id, a]) => contaL(esc(a.nome), brl(sel.valDe(id)), vals[id] != null && vals[id] !== padrao() ? 'dif' : '')).join('')}${contaL('<b>Total</b>', `<b>${brl(tot)}</b>`, 'total')}</div></details>`
        : '<div class="note">Nenhum aluno marcado ainda.</div>';
    };
    const opSel = () => ({ quadros, selA, usados, vals, comValor: true, padrao, travado: pagou, subDe: id => { if (pagou(id)) return 'Já pagou'; const e = evento && S.extras[evento], st = e && partDe(e, id); return st === 'inscrito' ? 'Inscrição confirmada' : st === 'interesse' ? 'Disse que vai' : turmasTxt(S.alunas[id]) || 'Sem turma'; }, aoMudar: () => resumo() });
    let sel = seletorAtletas($('xquadros'), opSel());
    // taxa de um evento: os quadros desse evento vêm primeiro e quem já confirmou a inscrição (ou, se ninguém, quem disse que vai) já vem marcado
    const escolherEvento = (marcar) => {
      const e = evento && S.extras[evento]; quadros = quadrosDe(selA, true, evento);
      if (e) { const doEv = quadros.filter(([k]) => k.slice(3) === evento), resto = quadros.filter(([k]) => k.slice(3) !== evento); quadros = [...doEv, ...resto];
        // já vem marcado quem confirmou a inscrição; se ninguém confirmou, quem disse que vai
        const pre_ = doEv[0] && doEv[0][2].length ? doEv[0] : doEv[1];
        if (marcar && pre_ && pre_[2].length) { pre_[2].forEach(id => selA.add(id)); usados.add(pre_[0]); }
        const cv = convidadosDe(e), ins = cv.filter(id => partDe(e, id) === 'inscrito').length, vao = cv.filter(id => ['interesse', 'inscrito'].includes(partDe(e, id))).length;
        if ($('xevnota')) $('xevnota').textContent = `${ins} com inscrição confirmada · ${vao} disseram que vão. A taxa aparece dentro do evento.`;
        $('xnome').placeholder = `Ex.: Ajuda de custo · ${e.nome}`; }
      else if ($('xevnota')) $('xevnota').textContent = '';
      sel = seletorAtletas($('xquadros'), opSel()); sel.desenhar(); };
    if ($('xev')) $('xev').onchange = () => { evento = $('xev').value || null; escolherEvento(true); };
    if (evento) setTimeout(() => escolherEvento(false), 0);
    s.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { if (b.dataset.t === 'evento') sheetEvento(null); });
    $('xval').oninput = () => { s.querySelectorAll('[data-xv]').forEach(i => { if (vals[i.dataset.xv] == null && !i.classList.contains('pend')) i.value = fmtValor(padrao()); }); resumo(); };
    sel.desenhar();
    $('xok').onclick = async () => {
      const nome = $('xnome').value.trim(), v = padrao(), venc = $('xven').value, err = m => $('xerr').textContent = m;
      if (!nome) { $('xnome').focus(); $('xnome').scrollIntoView({ block: 'center', behavior: 'smooth' }); return err('Preencha a descrição da taxa, como "Ajuda de custo · Copa" ou "Taxa da federação".'); }
      if (!(v > 0)) return err('Informe o valor padrão por aluno(a), como 85,00.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(venc)) return err('Escolha a data de vencimento.');
      const p = sel.pendente(); if (p) return err(`Toque em OK para confirmar o valor de ${p.nome}, ou volte ao valor anterior.`);
      const ids = [...selA].filter(id => S.alunas[id]); if (!ids.length) return err('Toque num quadro e marque os atletas desta cobrança.');
      const valores = {}; for (const id of ids) if (vals[id] != null && C.r2(vals[id]) !== C.r2(v)) { if (!(vals[id] > 0)) return err(`Confira o valor de ${S.alunas[id].nome}.`); valores[id] = C.r2(vals[id]); }
      $('xok').disabled = true;
      const base = legado ? { tipo: x.tipo, data: x.data || null, dataFim: x.dataFim || null, local: x.local || null } : { tipo: 'taxa' };
      try { await B.set(`escolas/${S.eid}/extras/${xid || novoId()}`, { ...base, nome, v, venc, alunas: ids, valores, grupos: [], turmas: [], origem: sel.origem(), evento: evento || null, recebedor: S.admin && $('xrec') ? $('xrec').value : (x ? x.recebedor || 'escola' : 'escola'), lancadoPor: x ? x.lancadoPor || null : (S.prof || 'admin'), criadoEm: x ? x.criadoEm || Date.now() : Date.now() }); fecharSheet(); aviso(ed ? 'Cobrança atualizada' : 'Taxa lançada'); }
      catch (e) { err(msgErro(e)); $('xok').disabled = false; }
    };
    if ($('xdel')) $('xdel').onclick = () => temPag ? ($('xerr').textContent = 'Esta cobrança já tem pagamentos e não pode ser excluída. Desmarque os alunos que não vão participar.') : confirmar('Excluir cobrança?', `"${esc(x.nome)}" sai da lista de todos os alunos.`, 'Excluir', () => B.del(`escolas/${S.eid}/extras/${xid}`));
  });
}

// ---- Eventos: calendário e inscrições (a inscrição é paga ao organizador, fora do app) ----
function sheetEvento(xid) {
  const x = xid ? S.extras[xid] : null, ed = !!x;
  const selA = new Set(x ? x.convidados || [] : []), o0 = (x && x.origem) || {}, usados = new Set([...(o0.todos ? ['todos'] : []), ...(o0.grupos || []).map(g => 'g:' + g), ...(o0.turmas || []).map(t => 't:' + t)]);
  const quadros = quadrosDe(selA, false), resp = id => !!partDe(x, id);
  const temPagEv = !!x && pelaEscola(x) && (x.convidados || []).some(id => pagouEvento(x, id));
  let cob = modoInsc(x);
  sheet(`<h3>${ed ? 'Editar evento' : 'Lançar'}</h3>
    ${ed ? '' : `<div class="seg">${TIPOS_LANCAR.map(([k, n]) => `<button type="button" data-t="${k}" aria-pressed="${k === 'evento'}">${n}</button>`).join('')}</div>`}
    <div class="field"><label for="enome">Nome do evento</label><input id="enome" maxlength="60" value="${esc(x ? x.nome : '')}" placeholder="Ex.: Copa Nordeste, Festival de fim de ano"></div>
    <div class="two"><div class="field"><label for="edata">Começa em</label><input id="edata" type="date" value="${esc((x && x.data) || '')}"></div>
    <div class="field"><label for="edfim">Termina em</label><input id="edfim" type="date" value="${esc((x && (x.dataFim || x.data)) || '')}"></div></div>
    <div class="two"><div class="field"><label for="elocal">Local</label><input id="elocal" maxlength="60" value="${esc((x && x.local) || '')}" placeholder="Ex.: Recife"></div>
    <div class="field"><label for="eorg">Quem organiza</label><input id="eorg" maxlength="60" value="${esc((x && x.organizador) || '')}" placeholder="Ex.: Clube Náutico"></div></div>
    <div class="field"><span class="lb">Onde é a inscrição?</span><div class="insc-ops" id="ecob">${MODOS_INSC.map(([k, n]) => `<button type="button" class="insc-op" data-cob="${k}" aria-pressed="${cob === k}" ${temPagEv && k !== 'app' ? 'disabled' : ''}><span class="insc-bola" aria-hidden="true"></span><span class="grow"><b>${n}</b><span class="s">${k === 'app' ? 'A família paga a inscrição por Pix no app. Pagou, fica inscrita sozinha.' : 'A família se inscreve e paga direto com quem organiza. Depois confirma no app.'}</span></span></button>`).join('')}</div>
      ${temPagEv ? '<div class="note">Já há inscrições pagas pelo app, então o valor e a forma de pagar não mudam mais.</div>' : ''}</div>
    <div class="grade2">
      <div class="field"><label for="eprazo">Responder até</label><input id="eprazo" type="date" value="${esc((x && x.prazo) || '')}"></div>
      <div class="field so-app"><label for="even">Vencimento</label><input id="even" type="date" value="${esc((x && x.venc) || '')}" ${temPagEv ? 'disabled' : ''}></div>
      <div class="field"><label for="einsc">Inscrição (R$)</label><input id="einsc" inputmode="decimal" value="${esc(x && (x.cobranca === 'app' ? x.v : x.valorInscricao) ? fmtValor(x.cobranca === 'app' ? x.v : x.valorInscricao) : '')}" placeholder="0,00" ${temPagEv ? 'disabled' : ''}></div>
      ${S.admin ? `<div class="field so-app"><label for="erec">Recebe</label><select id="erec" ${temPagEv ? 'disabled' : ''}>${opcoesRec(x ? x.recebedor : 'escola')}</select></div>` : ''}
    </div>
    <div id="eappw">
    <label class="check"><input type="checkbox" id="erep" ${x && x.pixRepassa === true ? 'checked' : ''}> <span class="grow">Quem paga cobre a taxa do Pix (${TAXA_TRANSACAO()}%)<span class="s" style="display:block;color:var(--muted);font-size:.82rem">Vale para a inscrição e para as taxas deste evento.</span></span></label>
    ${simTaxaHTML('esim', 0, true)}</div>
    <div class="field"><span class="lb">Fotos do evento</span><span class="sub">Cartaz, regulamento, horários. Os responsáveis veem junto com o evento. Até ${FOTOS_EV_MAX} fotos.</span>
      <div class="ev-fotos" id="efotos"></div><input type="file" id="efoto" accept="image/*" hidden><div class="err" id="eferr" role="alert"></div></div>
    <div class="field"><span class="lb">Quem pode ir? Os responsáveis recebem o convite no app</span><div id="equadros"></div></div>
    <div class="err" id="eerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="eok">Salvar</button></div>
    ${ed ? `<button class="btn ghost" id="edel" style="color:var(--out)">Excluir evento</button>` : ''}`, s => {
    const sel = seletorAtletas($('equadros'), { quadros, selA, usados, subDe: id => ST_PART[partDe(x, id)] || turmasTxt(S.alunas[id]) || 'Sem turma' });
    sel.desenhar();
    s.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { if (b.dataset.t === 'taxa') sheetExtra(null, { tipo: 'taxa' }); });
    $('edata').addEventListener('change', () => { const a = $('edata').value, b = $('edfim').value; if (a && (!b || b < a)) $('edfim').value = a; $('edfim').min = a; });
    const verCob = () => { s.querySelectorAll('[data-cob]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cob === cob)); $('eappw').hidden = cob !== 'app'; s.querySelectorAll('.so-app').forEach(e => e.hidden = cob !== 'app'); };
    s.querySelectorAll('[data-cob]').forEach(b => b.onclick = () => { if (b.disabled) return; cob = b.dataset.cob; verCob(); }); verCob();
    // fotos do evento: ficam num documento à parte (midiaEventos), para a lista de eventos continuar leve
    let fotos = [], fotosMudou = false;
    const verFotos = () => { $('efotos').innerHTML = fotos.map((f, i) => `<span class="ev-foto"><img src="${esc(f.src)}" alt="Foto ${i + 1} do evento"><button type="button" class="ev-foto-x" data-fx="${i}" aria-label="Tirar esta foto">×</button></span>`).join('')
        + (fotos.length < FOTOS_EV_MAX ? '<button type="button" class="ev-foto-add" id="efadd"><span aria-hidden="true">+</span>Adicionar foto</button>' : '');
      $('efotos').querySelectorAll('[data-fx]').forEach(b => b.onclick = () => { fotos.splice(Number(b.dataset.fx), 1); fotosMudou = true; verFotos(); });
      if ($('efadd')) $('efadd').onclick = () => $('efoto').click(); };
    verFotos();
    if (xid && x.fotos) B.get(`escolas/${S.eid}/midiaEventos/${xid}`).then(d => { if (d && d.fotos && !fotosMudou) { fotos = d.fotos.slice(0, FOTOS_EV_MAX); verFotos(); } }).catch(() => { });
    $('efoto').onchange = async () => { const f = $('efoto').files[0]; $('efoto').value = ''; $('eferr').textContent = ''; if (!f) return;
      try { fotos.push({ src: await fotoReduzida(f), em: Date.now() }); fotosMudou = true; verFotos(); } catch (e) { $('eferr').textContent = msgErro(e); } };
    // quanto a família paga e a escola recebe pela inscrição, conforme a caixa da taxa (só quando a inscrição é paga pelo app)
    const verSim = ligarSimTaxa('esim', () => $('erep').checked, () => parseValor($('einsc').value));
    $('erep').addEventListener('change', verSim); $('einsc').addEventListener('input', verSim);
    $('eok').onclick = async () => {
      const err = m => $('eerr').textContent = m, nome = $('enome').value.trim(), data = $('edata').value, dataFim = $('edfim').value || data, insc = parseValor($('einsc').value);
      if (!nome) return err('Dê um nome ao evento.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return err('Escolha quando o evento começa.');
      if (dataFim < data) return err('O evento não pode terminar antes de começar.');
      const ids = [...selA].filter(id => S.alunas[id]); if (!ids.length) return err('Toque num quadro e marque quem pode ir.');
      const sai = (x ? x.convidados || [] : []).filter(id => !selA.has(id) && resp(id));
      if (sai.some(id => x && pagouEvento(x, id))) return err('Há quem já pagou a inscrição entre os desmarcados. Mantenha essas pessoas no evento.');
      const venc = $('even').value; if (cob === 'app' && !(insc > 0)) return err('Informe o valor da inscrição, que vai ser cobrado pelo app.');
      if (cob === 'app' && !/^\d{4}-\d{2}-\d{2}$/.test(venc)) return err('Escolha o vencimento da inscrição.');
      $('eok').disabled = true;
      const part = { ...((x && x.part) || {}) }; sai.forEach(id => delete part[id]);
      const app = cob === 'app', cobrados = app ? ids.filter(id => ['interesse', 'inscrito'].includes((part[id] || {}).st) || (x && pagouEvento(x, id))) : [];
      const id = xid || novoId();
      try { await B.set(`escolas/${S.eid}/extras/${id}`, { tipo: 'evento', fotos: fotos.length, cobranca: app ? 'app' : 'familia', semCobranca: !app, pixRepassa: $('erep').checked, nome, data, dataFim: dataFim !== data ? dataFim : null, local: $('elocal').value.trim() || null, organizador: $('eorg').value.trim() || null,
          valorInscricao: !app && insc > 0 ? C.r2(insc) : null, prazo: $('eprazo').value || null, convidados: ids, origem: sel.origem(), part,
          v: app ? C.r2(insc) : 0, venc: app ? venc : null, recebedor: app ? (S.admin && $('erec') ? $('erec').value : (x && x.recebedor) || 'escola') : null, valores: {}, alunas: cobrados, grupos: [], turmas: [], lancadoPor: x ? x.lancadoPor || null : (S.prof || 'admin'), criadoEm: x ? x.criadoEm || Date.now() : Date.now() });
        if (fotosMudou && (fotos.length || (x && x.fotos))) { // sem foto nenhuma, antes e agora: nada a guardar
          try { await B.set(`escolas/${S.eid}/midiaEventos/${id}`, { fotos }); delete MIDIA_EV[id]; }
          catch (e) { fecharSheet(); aviso('O evento foi salvo, mas as fotos não. Tente pôr as fotos de novo daqui a pouco.'); return; }
        }
        fecharSheet(); aviso(ed ? 'Evento atualizado' : 'Evento lançado. Os responsáveis já podem responder.'); }
      catch (e) { err(msgErro(e)); $('eok').disabled = false; }
    };
    if ($('edel')) $('edel').onclick = () => temPagEv ? ($('eerr').textContent = 'Este evento já tem inscrições pagas pelo app e não pode ser excluído.') : confirmar('Excluir evento?', `"${esc(x.nome)}" sai do calendário, com as respostas e inscrições.`, 'Excluir', () => B.del(`escolas/${S.eid}/extras/${xid}`));
  });
}
// pedir resposta pelo WhatsApp
function waEvento(xid, id) {
  const x = S.extras[xid], r = respDe(id), a = S.alunas[id] || {};
  const txt = `Olá, ${primeiro(r.nome) || 'tudo bem'}! Aqui é da ${S.escola.nome || 'escola'}. Vamos participar de ${x.nome} (${periodoTxt(x)}${x.local ? ', ' + x.local : ''}). ${primeiro(a.nome)} vai?${x.prazo ? ` Responda até ${dataBR(x.prazo)}.` : ''}\n\nÉ só responder pelo app, em Meus filhos: ${LINK_APP}`;
  return waLink(r.telefone, txt);
}
const marcarPart = (xid, id, st) => { if (!MOCK && S.papel === 'f') return servidor('eventoResposta', { eid: S.eid, xid, alid: id, st });
  const x = S.extras[xid], d = { part: { [id]: { st, em: Date.now(), por: EU.uid, quem: S.papel === 'f' ? 'familia' : 'escola' } } };
  // pelo caixa da escola: a lista de quem é cobrado acompanha quem disse que vai
  if (pelaEscola(x)) { const novo = { ...(x.part || {}), [id]: { st } }; d.alunas = (x.convidados || []).filter(a => ['interesse', 'inscrito'].includes((novo[a] || {}).st) || pagouEvento(x, a)); }
  return B.set(`escolas/${S.eid}/extras/${xid}`, d, { merge: true }); };
// administração: quem vai, quem já está inscrito
function sheetVerEvento(xid) {
  const x = S.extras[xid]; if (!x) return fecharSheet();
  const cv = porNome(Object.fromEntries(convidadosDe(x).map(id => [id, S.alunas[id]]))).map(([id]) => id);
  const g = { inscrito: [], interesse: [], sem: [], nao: [] }; cv.forEach(id => g[partDe(x, id) || 'sem'].push(id));
  const taxas = Object.entries(S.extras).filter(([, t]) => t.evento === xid), app = pelaEscola(x), fam = modoInsc(x) === 'familia';
  const volta = () => sheetVerEvento(xid);
  const lin = (id, acoes) => { const a = S.alunas[id], P = (x.part || {})[id] || {}; return `<li><div class="dot">${esc(iniciais(a.nome))}</div><div class="grow"><div class="t">${esc(a.nome)}</div>${linhas(esc(respDe(id).nome || 'Sem responsável'), P.em ? `${P.quem === 'escola' ? 'Marcado pela escola' : 'Respondeu'} em ${dataCurta(P.em)}` : '')}</div><span class="ev-acoes">${acoes}</span></li>`; };
  const bt = (id, st, txt, cls = 'ghost') => `<button type="button" class="btn ${cls} btn-mini" data-pst="${esc(st)}" data-pid="${esc(id)}">${txt}</button>`;
  const sec = (tit, ids, acoes, vazio) => `<section><h2>${tit} <span class="sub num">${ids.length}</span></h2>${ids.length ? `<ul class="list">${ids.map(id => lin(id, acoes(id))).join('')}</ul>` : `<div class="note">${vazio}</div>`}</section>`;
  sheet(`<h3>${esc(x.nome)}</h3>
    ${ddl([['Quando', esc(periodoTxt(x))], ['Local', esc(x.local || '')], ['Organiza', esc(x.organizador || '')], ['Inscrição', app ? `<span class="num">${brl(x.v)}</span> <span class="sub">pelo caixa da escola · vence ${dataBR(x.venc)}</span>` : x.valorInscricao ? `<span class="num">${brl(x.valorInscricao)}</span> <span class="sub">paga ao organizador</span>` : ''], ['Responder até', x.prazo ? dataBR(x.prazo) : '']])}
    ${fotosHTML(xid, fotosDoEvento(xid, x, () => { if ($('evmsg')) sheetVerEvento(xid); }))}
    <div class="tiles"><div class="tile"><span class="lbl">Inscritos</span><b class="num">${g.inscrito.length}</b></div><div class="tile"><span class="lbl">${app ? 'A pagar' : fam ? 'Falta confirmar' : 'Querem ir'}</span><b class="num">${g.interesse.length}</b></div><div class="tile"><span class="lbl">Sem resposta</span><b class="num">${g.sem.length}</b></div></div>
    <button type="button" class="btn ghost btn-ico" id="evmsg">${ICO_WA}<span>Mensagem para o grupo</span></button>
    ${app ? sec('Vão · aguardando pagamento', g.interesse, id => `${valorCol(brl(C.valorExtra(x, id)), '<span class="chip aberto">A pagar</span>')}${bt(id, 'nao', 'Não vai')}`, 'Ninguém com inscrição a pagar.')
      : fam ? sec('Vão · falta confirmar a inscrição', g.interesse, id => { const wa = waLink(respDe(id).telefone, `Olá, ${primeiro(respDe(id).nome) || 'tudo bem'}! Aqui é da ${S.escola.nome || 'escola'}. Lembrete: a inscrição de ${primeiro(S.alunas[id].nome)} em ${x.nome} é feita direto com ${x.organizador || 'quem organiza'}. Depois de fazer, toque em "Já fiz a inscrição" no app: ${LINK_APP}`);
          return `${bt(id, 'inscrito', 'Marcar inscrito')}${wa ? `<a class="wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Lembrar pelo WhatsApp">${ICO_WA}</a>` : ''}`; }, 'Todos que vão já confirmaram a inscrição.')
      : sec('Querem ir', g.interesse, id => bt(id, 'inscrito', 'Inscrever', ''), 'Ninguém aguardando inscrição.')}
    ${app ? sec('Inscritos · pagos', g.inscrito, () => '<span class="chip pago">Pago</span>', 'Quem pagar a inscrição pelo app aparece aqui.')
      : sec(fam ? 'Inscrição confirmada' : 'Inscritos', g.inscrito, id => `<span class="chip pago">${fam && ((x.part || {})[id] || {}).quem === 'familia' ? 'Família confirmou' : 'Inscrito(a)'}</span>${bt(id, 'interesse', 'Desfazer')}`, fam ? 'Quando a família fizer a inscrição e confirmar no app, aparece aqui.' : 'Quando a inscrição for paga ao organizador, toque em "Inscrever".')}
    ${sec('Sem resposta', g.sem, id => { const wa = waEvento(xid, id); return `${bt(id, 'interesse', 'Vai')}${bt(id, 'nao', 'Não vai')}${wa ? `<a class="wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Perguntar pelo WhatsApp">${ICO_WA}</a>` : ''}`; }, 'Todos responderam.')}
    ${sec('Não vão', g.nao, id => bt(id, 'interesse', 'Vai'), 'Ninguém respondeu que não vai.')}
    ${taxas.length ? `<section><h2>Taxas deste evento</h2><ul class="list">${taxas.map(([tid, t]) => { const al = [...C.alvoExtra(t, S.alunas, S.grupos)]; return `<li class="tap" data-tx="${esc(tid)}"><div class="grow"><div class="t">${esc(t.nome)}</div>${linhas(`<span class="num">${al.length} aluno${al.length === 1 ? '' : 's'} · vence ${dataBR(t.venc)}</span>`)}</div>${valorCol(brl(C.r2(al.reduce((s, id) => s + C.valorExtra(t, id), 0))))}</li>`; }).join('')}</ul></section>` : ''}
    <button type="button" class="btn" id="evtaxa" ${g.inscrito.length + g.interesse.length ? '' : 'disabled'}>Lançar taxa deste evento</button>
    <div class="note">${g.inscrito.length + g.interesse.length ? `Já vem marcado quem ${g.inscrito.length ? 'confirmou a inscrição' : 'disse que vai'}; dá para ajustar. Serve para ajuda de custo, uniforme, transporte.` : 'Disponível quando alguém disser que vai.'}</div>
    <div class="actions"><button type="button" class="btn ghost" id="evedit">Editar evento</button><button type="button" class="btn ghost" data-fechar>Fechar</button></div>`, sh => {
    $('evmsg').onclick = () => abrirDe(volta, () => sheetMsgEvento(xid));
    ligarFotos(sh);
    sh.querySelectorAll('[data-pst]').forEach(b => b.onclick = async () => { b.disabled = true; await marcarPart(xid, b.dataset.pid, b.dataset.pst); if (b.dataset.pst === 'inscrito') aviso(`${primeiro(S.alunas[b.dataset.pid].nome)} inscrito(a)`); setTimeout(volta, 60); });
    sh.querySelectorAll('[data-tx]').forEach(li => li.onclick = () => abrirDe(volta, () => sheetExtra(li.dataset.tx)));
    $('evedit').onclick = () => abrirDe(volta, () => sheetEvento(xid));
    $('evtaxa').onclick = () => abrirDe(volta, () => sheetExtra(null, { tipo: 'taxa', pre: { ids: g.inscrito.length ? g.inscrito : g.interesse, evento: xid, quadro: (g.inscrito.length ? 'ei:' : 'ev:') + xid } }));
  });
}
// relatório do evento em uma mensagem só, para mandar no grupo de WhatsApp
function textoGrupoEvento(xid, ate) {
  const x = S.extras[xid] || {}, modo = modoInsc(x), app = modo === 'app';
  const cv = porNome(Object.fromEntries(convidadosDe(x).map(id => [id, S.alunas[id]]))).map(([id]) => id);
  const g = { inscrito: [], interesse: [], sem: [], nao: [] }; cv.forEach(id => g[partDe(x, id) || 'sem'].push(id));
  const nm = id => { const p = String(S.alunas[id].nome || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1]}` : p[0]; };
  const lista = (tit, ids) => ids.length ? `${tit.replace(/^(\S+) (.*)$/, '$1 *$2')} (${ids.length})*\n${ids.map(id => `• ${nm(id)}`).join('\n')}` : '';
  const vao = g.inscrito.length + g.interesse.length;
  const L = [`🏆 *${x.nome}*`, [`📅 ${periodoTxt(x)}`, x.local ? `📍 ${x.local}` : ''].filter(Boolean).join('\n')];
  L.push(`Até agora: *${vao}* vão, *${g.nao.length}* não vão e *${g.sem.length}* ainda não responderam.`);
  if (app) {
    L.push(lista('✅ Vão · inscrição paga', g.inscrito), lista('⏳ Vão · falta pagar a inscrição', g.interesse));
  } else if (modo === 'familia') {
    L.push(lista('✅ Vão · inscrição confirmada', g.inscrito), lista(`⏳ Vão · falta fazer a inscrição com ${x.organizador || 'quem organiza'} e confirmar no app`, g.interesse));
  } else {
    L.push(lista('✅ Vão · já inscritos', g.inscrito), lista('⏳ Vão · a escola ainda vai inscrever', g.interesse));
  }
  // taxas ligadas ao evento: quem já pagou e quem falta
  Object.entries(S.extras).filter(([, t]) => t.evento === xid).forEach(([tid, t]) => {
    const al = porNome(Object.fromEntries([...C.alvoExtra(t, S.alunas, S.grupos)].filter(id => S.alunas[id]).map(id => [id, S.alunas[id]]))).map(([id]) => id);
    if (!al.length) return;
    const pg = al.filter(id => C.stPag(((S.pags[id] || {}).extras || {})[tid])), falta = al.filter(id => !pg.includes(id));
    L.push(`💰 *${t.nome}*${t.venc ? ` (vence ${dataBR(t.venc)})` : ''}\n${pg.length ? `Já pagaram: ${pg.map(nm).join(', ')}` : 'Ninguém pagou ainda.'}${falta.length ? `\nFalta pagar: ${falta.map(nm).join(', ')}` : '\nTodos pagaram 🎉'}`);
  });
  L.push(lista('❓ Ainda não responderam', g.sem), lista('❌ Não vão', g.nao));
  const fim = [];
  if (ate) fim.push(`⚠️ *As inscrições vão até ${dataBR(ate)}${dataBR(ate) && ate.slice(0, 4) !== String(new Date().getFullYear()) ? '/' + ate.slice(0, 4) : ''}.* ${app ? 'Depois dessa data não dá mais para pagar pelo app.' : 'Depois dessa data não conseguimos garantir a vaga.'}`);
  fim.push(app ? `Para responder ou pagar a inscrição, é só abrir o app: ${LINK_APP}` : modo === 'familia' ? `Quem já fez a inscrição, toque em "Já fiz a inscrição" no app: ${LINK_APP}` : `Para responder se vai, é só abrir o app: ${LINK_APP}`);
  L.push(fim.join('\n'));
  if (S.escola && S.escola.nome) L.push(`_${S.escola.nome}_`);
  return L.filter(Boolean).join('\n\n');
}
function sheetMsgEvento(xid) {
  const x = S.extras[xid]; if (!x) return fecharSheet();
  const ate0 = x.prazo || (pelaEscola(x) ? x.venc : '') || '';
  sheet(`<h3>Mensagem para o grupo</h3>
    <div class="sub">Um resumo de ${esc(x.nome)} para mandar no grupo de WhatsApp das famílias: quem vai, quem já confirmou, quem já pagou e quem falta. Dá para mexer no texto antes de enviar.</div>
    <div class="field"><label for="emate">Inscrições até</label><input type="date" id="emate" value="${esc(ate0)}"><span class="sub">Esta data aparece no fim da mensagem como lembrete. Deixe em branco para não lembrar.</span></div>
    <div class="field"><label for="emtxt">Mensagem</label><textarea id="emtxt" class="msg-edit" rows="14"></textarea></div>
    <a class="btn btn-ico" id="emwa" target="_blank" rel="noopener">${ICO_WA}<span>Abrir no WhatsApp</span></a>
    <div class="note">O WhatsApp abre e você escolhe o grupo. Se preferir, copie e cole lá.</div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Fechar</button><button type="button" class="btn ghost" id="emcop">Copiar texto</button></div>`, () => {
    const ta = $('emtxt'), wa = $('emwa');
    const link = () => { wa.href = 'https://wa.me/?text=' + encodeURIComponent(ta.value); };
    const gerar = () => { ta.value = textoGrupoEvento(xid, $('emate').value); link(); };
    gerar();
    $('emate').onchange = gerar; ta.oninput = link;
    $('emcop').onclick = () => copiar(ta.value, 'Mensagem copiada. Cole no grupo.');
  });
}
// lista de eventos (aba Turmas da administração e tela da professora)
function blocoEventos() {
  const h = hoje(), L = eventosAtivos(), prox = L.filter(([, x]) => fimDe(x) >= h), pass = L.filter(([, x]) => fimDe(x) < h).reverse();
  const li = ([xid, x]) => { const cv = convidadosDe(x), ins = cv.filter(id => partDe(x, id) === 'inscrito').length, quer = cv.filter(id => partDe(x, id) === 'interesse').length;
    return `<li class="tap" data-ev="${esc(xid)}"><div class="grow"><div class="t">${esc(x.nome)}</div>${linhas(`<span class="num">${esc(periodoTxt(x))}</span>`, x.local ? esc(x.local) : '', pelaEscola(x) ? `Pago no app · ${ins} pago${ins === 1 ? '' : 's'} · ${quer} a pagar` : modoInsc(x) === 'familia' ? `Família inscreve · ${ins} confirmado${ins === 1 ? '' : 's'} · ${quer} falta${quer === 1 ? '' : 'm'}` : `Escola inscreve · ${ins} inscrito${ins === 1 ? '' : 's'} · ${quer} quer${quer === 1 ? '' : 'em'} ir`)}</div>${quer && modoInsc(x) === 'escola' ? '<span class="chip aberto">Inscrever</span>' : ''}</li>`; };
  return `<section><div class="headrow"><h2>Eventos</h2><span class="acts-mini"><button class="add" id="evcal">Calendário</button><button class="add" id="evnovo">+ Evento</button></span></div>
    ${prox.length ? `<ul class="list">${prox.map(li).join('')}</ul>` : '<div class="empty"><span>Lance copas, festivais e campeonatos. Os responsáveis dizem pelo app se o filho vai, e você marca quem já está inscrito.</span></div>'}
    ${pass.length ? `<details class="historico"><summary><span class="grow"><b>Eventos que já passaram</b><span class="s">${pass.length}</span></span><span class="seta" aria-hidden="true">▾</span></summary><ul class="list">${pass.map(li).join('')}</ul></details>` : ''}</section>`;
}
function ligarEventos(v) {
  if ($('evcal')) $('evcal').onclick = () => sheetCalendario();
  if ($('evnovo')) $('evnovo').onclick = () => sheetEvento(null);
  v.querySelectorAll('li[data-ev]').forEach(li => li.onclick = () => sheetVerEvento(li.dataset.ev));
}
// família: eventos dos filhos, para dizer se vai
function blocoEventosFamilia() {
  const h = hoje(), meus = Object.keys(S.alunas);
  const L = eventosAtivos().filter(([, x]) => fimDe(x) >= h).map(([xid, x]) => ({ xid, x, ids: convidadosDe(x).filter(id => meus.includes(id)) })).filter(e => e.ids.length);
  if (!L.length) return '';
  return `<section><h2>Eventos</h2>${L.map(({ xid, x, ids }) => `<div class="filha ev-fam"><div class="t" style="font-size:1.05rem">${esc(x.nome)}</div>
    ${ddl([['Quando', esc(periodoTxt(x))], ['Local', esc(x.local || '')], ['Organiza', esc(x.organizador || '')], ['Inscrição', pelaEscola(x) ? `<span class="num">${brl(x.v)}</span> <span class="sub">pelo app, vence ${dataBR(x.venc)}</span>` : x.valorInscricao ? `<span class="num">${brl(x.valorInscricao)}</span> <span class="sub">paga ao organizador</span>` : ''], ['Responder até', x.prazo ? dataBR(x.prazo) : '']])}
    ${fotosHTML(xid, fotosDoEvento(xid, x, agendar))}
    ${ids.map(id => respFamilia(xid, x, id)).join('')}</div>`).join('')}</section>`;
}
// resposta da família a um evento, conforme quem faz a inscrição
function respFamilia(xid, x, id) {
  const st = partDe(x, id), modo = modoInsc(x), P = (x.part || {})[id] || {}, nm = esc(primeiro(S.alunas[id].nome));
  const b = (fst, txt, on, cls = '') => `<button type="button" class="${cls}" data-fx="${esc(xid)}" data-fid="${esc(id)}" data-fst="${fst}" aria-pressed="${on}">${txt}</button>`;
  const vaiNao = `<div class="seg ev-seg">${b('interesse', 'Vai', st === 'interesse' || st === 'inscrito')}${b('nao', 'Não vai', st === 'nao')}</div>`;
  let sub = 'Vai?', direita = vaiNao, extra = '';
  if (st === 'nao') sub = 'Não vai';
  if (st === 'inscrito') {
    sub = modo === 'app' ? 'Inscrição paga' : modo === 'familia' ? `Inscrição confirmada${P.quem === 'familia' ? ' por você' : ' pela escola'}${P.em ? ' em ' + dataCurta(P.em) : ''}` : 'Inscrição feita pela escola';
    direita = '<span class="chip pago">Inscrito(a)</span>';
    if (modo === 'familia' && P.quem === 'familia') extra = `<button type="button" class="link ev-desfaz" data-fx="${esc(xid)}" data-fid="${esc(id)}" data-fst="interesse">Desfazer confirmação</button>`;
  } else if (st === 'interesse') {
    sub = modo === 'app' ? 'A inscrição está na tela Pagar' : modo === 'familia' ? `Faça a inscrição com ${esc(x.organizador || 'quem organiza')} e depois confirme aqui` : 'A escola vai cuidar da inscrição';
    if (modo === 'familia') extra = `<button type="button" class="btn btn-mini ev-ja" data-fx="${esc(xid)}" data-fid="${esc(id)}" data-fst="inscrito">Já fiz a inscrição</button>`;
  }
  return `<div class="ev-resp"><span class="grow"><b>${nm}</b><span class="s">${sub}</span>${extra}</span>${direita}</div>`;
}
function avisoEventosFamilia() {
  const h = hoje(), meus = Object.keys(S.alunas);
  return eventosAtivos().filter(([, x]) => fimDe(x) >= h && (!x.prazo || x.prazo >= h)).map(([xid, x]) => ({ x, ids: convidadosDe(x).filter(id => meus.includes(id) && !partDe(x, id)) })).filter(e => e.ids.length)
    .map(({ x, ids }) => `<button class="faixa-resumo" data-irfilhos="1"><span class="grow"><b>${esc(x.nome)}: ${esc(ids.map(id => primeiro(S.alunas[id].nome)).join(' e '))} ${ids.length > 1 ? 'vão' : 'vai'}?</b><span class="s">${esc(periodoTxt(x))}${x.prazo ? ` · responda até ${dataBR(x.prazo)}` : ''}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`).join('');
}

/* ================= Alunas e responsáveis (administração) ================= */
// cadastros de responsável com o mesmo telefone ou CPF (possível repetição)
function chaveContato(r) { return { t: C.telNorm(r.telefone), c: C.soDigitos(r.cpf) }; }
function mesmoContato(a, b) { const x = chaveContato(a), y = chaveContato(b); return (x.t.length >= 10 && x.t === y.t) || (x.c.length === 11 && x.c === y.c); }
function repetidos() {
  const ig = new Set(S.cfg.naoRepetidos || []), L = Object.entries(S.resps), out = [];
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const [a, A] = L[i], [b, Bx] = L[j], par = [a, b].sort().join('+');
    if (!ig.has(par) && mesmoContato(A, Bx)) out.push({ a, b, par, por: chaveContato(A).t && chaveContato(A).t === chaveContato(Bx).t ? 'telefone' : 'CPF' });
  }
  return out;
}
const alunasDoResp = rid => porNome(S.alunas).filter(([, a]) => a.responsavelId === rid);
function tAlunas(v) {
  const q = (S.busca || '').trim().toLowerCase(), mes = mesHoje();
  const grupos = porNome(S.resps).map(([rid, r]) => ({ rid, r, al: alunasDoResp(rid) }));
  const sem = porNome(S.alunas).filter(([, a]) => !a.responsavelId || !S.resps[a.responsavelId]);
  if (sem.length) grupos.push({ rid: '', r: { nome: 'Sem responsável' }, al: sem });
  const vis = grupos.filter(g => !q || String(g.r.nome).toLowerCase().includes(q) || String(g.r.telefone || '').includes(q) || g.al.some(([, a]) => String(a.nome).toLowerCase().includes(q)));
  const reps = repetidos(), nAtivas = Object.values(S.alunas).filter(a => C.ativaNoMes(a, mes)).length;
  v.innerHTML = `
    ${avisoMudancasTermo()}
    <div class="headrow"><h2>Alunos por responsável</h2><button class="add" id="ana">+ Aluno(a)</button></div>
    <div class="sub num">${nAtivas} alunos ativos · ${Object.keys(S.resps).length} responsáveis</div>
    ${(() => { const at = Object.entries(S.alunas).filter(([, a]) => C.ativaNoMes(a, mes) && !a.anonimizadoEm), sem = at.filter(([id]) => termoDe(id).st !== 'ok').length, atest = at.filter(([id]) => termoDe(id).atest).length;
      return sem || atest ? `<div class="banner"><span><b>Termo de matrícula:</b> ${sem ? `${sem} aluno${sem === 1 ? '' : 's'} sem termo assinado` : ''}${sem && atest ? ' · ' : ''}${atest ? `${atest} precisa${atest === 1 ? '' : 'm'} de atestado médico` : ''}. Os responsáveis preenchem pelo app; as etiquetas aparecem em cada aluno.</span></div>` : ''; })()}
    ${reps.map(x => `<div class="banner"><span><b>${esc(S.resps[x.a].nome)}</b> (${esc(alunasDoResp(x.a).map(([, a]) => primeiro(a.nome)).join(', ') || 'sem alunos')}) e <b>${esc(S.resps[x.b].nome)}</b> (${esc(alunasDoResp(x.b).map(([, a]) => primeiro(a.nome)).join(', ') || 'sem alunos')}) têm o mesmo ${x.por}. É a mesma pessoa?</span><span class="actions"><button data-junta="${esc(x.par)}">Agrupar</button><button data-nao="${esc(x.par)}" style="color:var(--muted)">Não é</button></span></div>`).join('')}
    <div class="field"><input id="abusca" type="search" placeholder="Buscar aluno(a), responsável ou telefone" value="${esc(S.busca || '')}" aria-label="Buscar"></div>
    ${vis.length ? vis.map(({ rid, r, al }) => `<ul class="list">
        <li class="${rid ? 'tap' : ''}" ${rid ? `data-resp="${esc(rid)}"` : ''} style="background:var(--surface2)"><div class="grow"><div class="label">Responsável</div><div class="t">${esc(r.nome)}</div>${rid ? linhas(`<span class="num">${esc(r.telefone || 'Sem telefone')}</span>`, r.cpf ? `<span class="num">CPF ${esc(r.cpf)}</span>` : '') : ''}</div>${rid && r.codigo ? `<span class="chip" style="letter-spacing:.12em">${esc(r.codigo)}</span>` : ''}</li>
        ${al.map(([id, a]) => { const m = C.mensalidade(S.alunas, id, mes, S.turmas, S.cfg), at = C.ativaNoMes(a, mes); return `<li class="tap" data-al="${esc(id)}" style="${at ? '' : 'opacity:.55'}"><div class="dot">${esc(iniciais(a.nome))}</div><div class="grow"><div class="t">${esc(a.nome)}</div>${linhas(esc(idade(a.nascimento) || 'Sem data de nascimento'), esc(turmasTxt(a) || 'Sem turma'))}</div>${valorCol(m ? brl(m.v) : '—', [mudancasFaixa(id).length ? '<span class="chip vencido">Faixa etária</span>' : '', at ? '' : '<span class="chip">Inativo(a)</span>', (() => { if (!at || a.anonimizadoEm) return ''; const x = termoDe(id); return x.pend && x.pend.length ? '<span class="chip vencido">Termo mudou</span>' : x.atest ? '<span class="chip vencido">Falta atestado</span>' : x.st !== 'ok' ? '<span class="chip aberto">Sem termo</span>' : ''; })()].join(''))}</li>`; }).join('')}
        ${rid ? `<li class="tap" data-nova="${esc(rid)}" style="min-height:44px"><span class="sub">+ Outro(a) aluno(a) com ${esc(primeiro(r.nome))}</span></li>` : ''}
      </ul>`).join('') : `<div class="empty">${q ? 'Nada encontrado.' : '<b>Nenhum aluno cadastrado.</b><span>Cadastre cada aluno(a) com a turma e o responsável. Se o telefone ou o CPF do responsável já existir, o app sugere agrupar os irmãos.</span>'}</div>`}`;
  $('abusca').oninput = e => { S.busca = e.target.value; render(); };
  $('ana').onclick = () => sheetAluna();
  v.querySelectorAll('[data-resp]').forEach(li => li.onclick = () => sheetResp(li.dataset.resp));
  v.querySelectorAll('[data-al]').forEach(li => li.onclick = () => sheetAluna(li.dataset.al));
  v.querySelectorAll('[data-vmud]').forEach(b => b.onclick = () => sheetVerTermo(b.dataset.vmud));
  v.querySelectorAll('[data-nova]').forEach(li => li.onclick = () => sheetAluna(null, li.dataset.nova));
  v.querySelectorAll('[data-nao]').forEach(b => b.onclick = () => B.set(`escolas/${S.eid}/config/geral`, { naoRepetidos: [...(S.cfg.naoRepetidos || []), b.dataset.nao] }, { merge: true }));
  v.querySelectorAll('[data-junta]').forEach(b => b.onclick = () => juntarResps(...b.dataset.junta.split('+')));
}
function juntarResps(a, b) {
  // fica o cadastro com mais alunos (ou o mais antigo); o outro é apagado
  const [fica, sai] = alunasDoResp(b).length > alunasDoResp(a).length ? [b, a] : [a, b], F = S.resps[fica], X = S.resps[sai];
  confirmar('Agrupar responsáveis?', `${esc(alunasDoResp(sai).map(([, x]) => x.nome).join(', ') || 'Os alunos')} passa${alunasDoResp(sai).length > 1 ? 'm' : ''} para ${esc(F.nome)}. Quem entrou no app pelo código ${esc(X.codigo || '')} precisa entrar de novo com o código ${esc(F.codigo || '')}. Os irmãos ficam juntos no mesmo responsável.`, 'Agrupar', async () => {
    const ops = alunasDoResp(sai).map(([id]) => ({ op: 'merge', p: `escolas/${S.eid}/alunas/${id}`, d: { responsavelId: fica } }));
    const comp = {}; ['telefone', 'cpf', 'email'].forEach(k => { if (!F[k] && X[k]) comp[k] = X[k]; });
    if (Object.keys(comp).length) ops.push({ op: 'merge', p: `escolas/${S.eid}/responsaveis/${fica}`, d: comp });
    ops.push({ op: 'del', p: `escolas/${S.eid}/responsaveis/${sai}` }); if (X.codigo) ops.push({ op: 'del', p: 'codigos/' + X.codigo });
    await B.lote(ops); aviso('Responsáveis agrupados');
  });
}
function convite(r) { return `Olá${r.nome ? ', ' + primeiro(r.nome) : ''}! A ${S.escola.nome || 'escola'} agora recebe as mensalidades e as taxas pelo app. Você vê cada cobrança e escolhe o que pagar, por Pix.\n1. Abra ${LINK_APP}\n2. Crie sua conta (ou entre com Google)\n3. Digite o código: ${r.codigo}`; }
function sheetResp(rid) {
  const r = S.resps[rid]; if (!r) return;
  const al = alunasDoResp(rid), noApp = Object.values(S.membros).filter(m => m.codigo === r.codigo).length;
  sheet(`<h3>${esc(r.nome)}</h3>
    <div class="sub">Responsável por ${esc(al.map(([, a]) => a.nome).join(', ') || 'nenhum aluno')}</div>
    <div class="field"><label for="rnome">Nome</label><input id="rnome" maxlength="60" value="${esc(r.nome || '')}"></div>
    <div class="two"><div class="field"><label for="rtel">WhatsApp</label><input id="rtel" inputmode="tel" maxlength="20" value="${esc(r.telefone || '')}"></div>
    <div class="field"><label for="rcpf">CPF</label><input id="rcpf" inputmode="numeric" maxlength="14" value="${esc(r.cpf || '')}"></div></div>
    <div class="field"><label for="rmail">E-mail</label><input id="rmail" type="email" maxlength="80" value="${esc(r.email || '')}"></div>
    <div class="hero" style="padding:14px;gap:8px"><div class="label">Código de acesso</div><div class="big num" style="font-size:1.8rem;letter-spacing:.18em;user-select:all">${esc(r.codigo || '')}</div>
      <div class="sub">${noApp ? `${noApp} pessoa${noApp > 1 ? 's' : ''} entrou no app com este código.` : 'Ninguém entrou no app com este código ainda.'}</div>
      <div class="actions">${numeroWa(r.telefone) ? `<a class="btn wa-btn" href="${esc(waLink(r.telefone, convite(r)))}" target="_blank" rel="noopener">${ICO_WA} Enviar convite</a>` : ''}<button class="btn ghost" id="rconv">Copiar convite</button></div></div>
    <div class="err" id="rerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="rok">Salvar</button></div>
    <button class="btn ghost" id="rdel" style="color:var(--out)">Excluir responsável</button>`, () => {
    $('rconv').onclick = () => copiar(convite(r), 'Convite copiado. Cole no WhatsApp do responsável.');
    $('rok').onclick = async () => {
      const nome = $('rnome').value.trim(); if (!nome) return $('rerr').textContent = 'Digite o nome do responsável.';
      const cpf = C.soDigitos($('rcpf').value); if (cpf && cpf.length !== 11) return $('rerr').textContent = 'O CPF tem 11 números.';
      try { await B.set(`escolas/${S.eid}/responsaveis/${rid}`, { nome, telefone: $('rtel').value.trim(), cpf: $('rcpf').value.trim(), email: $('rmail').value.trim() }, { merge: true }); fecharSheet(); aviso('Responsável atualizado'); }
      catch (e) { $('rerr').textContent = msgErro(e); }
    };
    $('rdel').onclick = () => al.length ? ($('rerr').textContent = 'Este responsável tem alunos. Troque o responsável deles antes.') : confirmar('Excluir responsável?', `${esc(r.nome)} e o código ${esc(r.codigo || '')} deixam de existir.`, 'Excluir', () => B.lote([{ op: 'del', p: `escolas/${S.eid}/responsaveis/${rid}` }, ...(r.codigo ? [{ op: 'del', p: 'codigos/' + r.codigo }] : [])]));
  });
}
function sheetAluna(alid, ridPadrao, turmaPadrao) {
  // aluno novo sem nenhuma turma cadastrada: primeiro a turma, depois volta para o cadastro com ela marcada
  if (!alid && !turmaPadrao && !Object.keys(S.turmas).length) return sheet(`<h3>Primeiro, cadastre uma turma</h3>
    <div class="sub">Todo aluno(a) precisa estar em uma turma, porque é a turma que define o valor da mensalidade. Cadastre a turma e o app volta para o cadastro do aluno(a), com a turma já marcada.</div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Agora não</button><button type="button" class="btn" id="aprimt">Cadastrar turma</button></div>`, () => {
    $('aprimt').onclick = () => sheetTurma(null, tid => sheetAluna(null, ridPadrao, tid));
  });
  const a = alid ? S.alunas[alid] : null, ed = !!a, mes = mesHoje(), adm = S.admin;
  const ativa = a ? C.ativaNoMes(a, mes) || (a.inicio && a.inicio > mes) : true;
  const d0 = (a && a.desc) || {}, modo0 = d0.isenta ? 'isenta' : d0.v != null && d0.v !== '' ? 'valor' : Number(d0.pct) > 0 ? 'pct' : Number(d0.menos) > 0 ? 'menos' : 'nenhum';
  const minhas = new Set(a ? a.turmas || [] : turmaPadrao ? [turmaPadrao] : []), meusG = new Set(alid ? Object.keys(S.grupos).filter(g => (S.grupos[g].alunas || []).includes(alid)) : []);
  let rid = (a && a.responsavelId && S.resps[a.responsavelId]) ? a.responsavelId : (ridPadrao || null), recusado = new Set();
  const r0 = rid ? S.resps[rid] : {};
  const mudA = ed ? mudancasFaixa(alid) : [];
  // professor(a) vê primeiro as próprias turmas; administração vê todas
  const listaT = ordenar(S.turmas).filter(([tid, t]) => adm || t.professoraId === S.prof || minhas.has(tid));
  sheet(`<h3>${ed ? esc(a.nome) : 'Novo(a) aluno(a)'}</h3>
    ${ed && adm ? cartaoTermo(alid) : ''}
    ${mudA.map(m => cartaoFaixa(m, false)).join('')}
    <div class="field"><label for="anome">Nome do(a) aluno(a)</label><input id="anome" maxlength="60" value="${esc(a ? a.nome : '')}"></div>
    <div class="two"><div class="field"><label for="anasc">Data de nascimento</label><input id="anasc" type="date" max="${hoje()}" value="${esc(a ? a.nascimento || '' : '')}"></div>
    <div class="field"><span class="lb">Idade</span><div id="aidade" class="num campo-fixo">${esc(idade(a && a.nascimento) || '—')}</div></div></div>
    <div class="field"><span class="lb">Turma</span>
      <div class="checks">${listaT.map(([tid, t]) => { const n = alunasDaTurma(tid).length, cheia = t.vagas && n >= t.vagas && !minhas.has(tid); return `<label><input type="checkbox" data-tu="${esc(tid)}" ${minhas.has(tid) ? 'checked' : ''}><span class="grow"><span class="t" style="display:block">${esc(t.nome)}</span><span class="s">${esc(C.faixaTxt(t))}</span>${t.horario ? `<span class="s">${esc(t.horario)}</span>` : ''}${profNome(t) || localDe(t) ? `<span class="s">${esc([profNome(t), localDe(t)].filter(Boolean).join(' · '))}</span>` : ''}${t.vagas && !cheia ? `<span class="s num">${t.vagas - n === 1 ? 'Resta 1 vaga' : `Restam ${t.vagas - n} vagas`}</span>` : ''}<span class="s fora" data-fx="${esc(tid)}" style="color:var(--out);font-weight:700"></span></span><span class="valor-col">${adm ? `<b class="num">${brl(t.preco)}</b>` : ''}${cheia ? '<span class="chip vencido">Cheia</span>' : ''}</span></label>`; }).join('') || '<div class="grp">Nenhuma turma cadastrada ainda</div>'}</div></div>
    ${Object.keys(S.grupos).length ? `<div class="field"><span class="lb">Grupos</span><div class="chips">${porNome(S.grupos).map(([g, G]) => `<button type="button" class="pick" data-gr="${esc(g)}" aria-pressed="${meusG.has(g)}">${esc(G.nome)}</button>`).join('')}</div></div>` : ''}
    <div class="hero" style="padding:14px;gap:10px"><div class="label">Responsável</div>
      <div class="field"><label for="rnome">Nome</label><input id="rnome" maxlength="60" value="${esc(r0.nome || '')}" placeholder="Quem paga"></div>
      <div class="two"><div class="field"><label for="rtel">WhatsApp</label><input id="rtel" inputmode="tel" maxlength="20" value="${esc(r0.telefone || '')}" placeholder="(81) 99999-9999"></div>
      <div class="field"><label for="rcpf">CPF</label><input id="rcpf" inputmode="numeric" maxlength="14" value="${esc(r0.cpf || '')}" placeholder="000.000.000-00"></div></div>
      <div id="rsug"></div>
      <div class="note" id="rinfo"></div></div>
    ${adm ? `<div class="field"><span class="lb">Descontos</span>
      <div class="chips"><button type="button" class="pick" id="bqirma">Irmão(ã) ${Math.round((Number(S.cfg.descIrmas) || 0) * 100)}%</button><button type="button" class="pick" id="bqmulti">Mais de uma atividade ${Math.round((Number(S.cfg.descMulti) || 0) * 100)}%</button></div>
      <input type="checkbox" id="adirma" hidden ${a && a.descIrmaOk ? 'checked' : ''}><input type="checkbox" id="admulti" hidden ${a && a.descMultiOk ? 'checked' : ''}></div>
    <div class="field"><span class="lb">Outro desconto</span>
      <div class="chips" id="bqaj">${[['nenhum', 'Nenhum'], ['pct', 'Em %'], ['menos', 'Em R$'], ['valor', 'Valor combinado'], ['isenta', 'Bolsista']].map(([k, n]) => `<button type="button" class="pick" data-aj="${k}">${n}</button>`).join('')}</div>
      <select id="aaj" hidden><option value="nenhum"></option><option value="pct"></option><option value="menos"></option><option value="valor"></option><option value="isenta"></option></select></div>
    <div id="aajbox" class="faixa-card" style="background:var(--bg)">
      <div class="field" id="aajv"><label for="aajn" id="aajl">Valor</label><input id="aajn" inputmode="decimal">
        <div class="chips" id="bqpct">${[10, 20, 30, 50].map(n => `<button type="button" class="pick" data-pc="${n}">${n}%</button>`).join('')}</div></div>
      <div class="field"><label for="ajmot">Motivo do desconto</label><input id="ajmot" maxlength="80" value="${esc((a && a.desc && a.desc.motivo) || '')}" placeholder="Ex.: filho(a) de funcionário, combinado na matrícula">
        <div class="chips">${['Combinado na matrícula', 'Dificuldade financeira', 'Atleta destaque', 'Filho(a) de funcionário'].map(m => `<button type="button" class="pick" data-mot="${esc(m)}">${esc(m)}</button>`).join('')}</div></div></div>
    <div class="note">Só vale o desconto que você escolher aqui.</div>
    <div class="filha" style="padding:12px" id="aconta"></div>` : `<div class="note">Desconto e valor da mensalidade ficam com a administração.</div>`}
    <div class="two"><div class="field"><label for="aini">Cobrar a partir de</label><input id="aini" type="month" value="${esc(a ? a.inicio || mes : mes)}"></div>
    <div class="field" id="afimw"><label for="afim">Último mês cobrado</label><input id="afim" type="month" value="${esc(a && a.fim ? a.fim : mesMais(mes, -1))}"></div></div>
    ${ed ? `<label class="check"><input type="checkbox" id="aativa" ${ativa ? 'checked' : ''}> Aluno(a) ativo(a)</label>` : ''}
    <div class="err" id="aerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="aok">Salvar</button></div>
    ${ed && adm ? `<div class="actions"><button class="btn ghost" id="acob">Ver cobranças</button><button class="btn ghost" id="adel" style="color:var(--out)">Excluir aluno(a)</button></div>${a && !a.anonimizadoEm ? '<button class="btn ghost" id="aanon" style="color:var(--out)">Apagar dados pessoais (LGPD)</button>' : ''}` : ''}`, s => {
    ligarFaixa(s, () => sheetAluna(alid));
    if (adm) { $('aaj').value = modo0; $('aajn').value = modo0 === 'pct' ? String(Math.round(Number(d0.pct) * 100)) : modo0 === 'valor' ? fmtValor(d0.v) : modo0 === 'menos' ? fmtValor(d0.menos) : ''; }
    const marcaFaixa = () => { const id = C.idadeNoAno($('anasc').value, anoRef()); s.querySelectorAll('[data-fx]').forEach(el => { const t = S.turmas[el.dataset.fx]; el.textContent = id != null && !C.cabe(t, id) ? `Fora da faixa: faz ${id} anos em ${anoRef()}` : ''; }); };
    s.querySelectorAll('[data-gr]').forEach(b => b.onclick = () => { const g = b.dataset.gr; meusG.has(g) ? meusG.delete(g) : meusG.add(g); b.setAttribute('aria-pressed', meusG.has(g)); });
    const descAtual = () => { if (!adm) return a ? a.desc || null : null; const m = $('aaj').value, n = parseValor($('aajn').value), mot = $('ajmot').value.trim(); const d = m === 'isenta' ? { isenta: true } : m === 'valor' ? { v: n } : m === 'pct' ? { pct: n / 100 } : m === 'menos' ? { menos: n } : null; return d && mot ? { ...d, motivo: mot } : d; };
    // sugestão: outro cadastro de responsável com o mesmo telefone ou CPF
    const sugerir = () => {
      const atual = { telefone: $('rtel').value, cpf: $('rcpf').value };
      const achado = Object.entries(S.resps).find(([id, r]) => id !== rid && !recusado.has(id) && mesmoContato(atual, r));
      const info = rid ? `${esc(S.resps[rid] ? 'Cadastro de ' + S.resps[rid].nome : '')}${alunasDoResp(rid).filter(([id]) => id !== alid).length ? ' · também responsável por ' + esc(alunasDoResp(rid).filter(([id]) => id !== alid).map(([, x]) => primeiro(x.nome)).join(', ')) : ''}` : 'Se o telefone ou o CPF já estiver cadastrado, o app sugere agrupar com os irmãos.';
      $('rinfo').innerHTML = info;
      if (!achado) { $('rsug').innerHTML = ''; return; }
      const [mid, m] = achado, irmas = alunasDoResp(mid).map(([, x]) => primeiro(x.nome));
      $('rsug').innerHTML = `<div class="banner"><span><b>${esc(m.nome)}</b> já está cadastrado(a) com esse ${mesmoContato({ telefone: atual.telefone }, m) ? 'telefone' : 'CPF'}${irmas.length ? `, responsável por ${esc(irmas.join(', '))}` : ''}. É a mesma pessoa?</span><span class="actions"><button type="button" id="rsim">Sim, agrupar</button><button type="button" id="rnao" style="color:var(--muted)">Não, é outra</button></span></div>`;
      $('rsim').onclick = () => { rid = mid; $('rnome').value = m.nome || ''; $('rtel').value = m.telefone || ''; $('rcpf').value = m.cpf || ''; sugerir(); prev(); aviso('Agrupada com ' + primeiro(m.nome)); };
      $('rnao').onclick = () => { recusado.add(mid); sugerir(); };
    };
    const prev = () => {
      $('afimw').hidden = $('aativa') ? $('aativa').checked : true; marcaFaixa();
      if (!adm) return;
      const m = $('aaj').value; $('aajbox').hidden = m === 'nenhum'; $('aajv').hidden = m === 'nenhum' || m === 'isenta'; $('bqpct').hidden = m !== 'pct'; $('aajl').textContent = m === 'pct' ? 'Desconto (%)' : m === 'menos' ? 'Abater da mensalidade (R$)' : 'Valor combinado por mês (R$)';
      s.querySelectorAll('[data-aj]').forEach(b => b.setAttribute('aria-pressed', b.dataset.aj === m));
      s.querySelectorAll('[data-pc]').forEach(b => b.setAttribute('aria-pressed', String(Math.round(parseValor($('aajn').value))) === b.dataset.pc));
      s.querySelectorAll('[data-mot]').forEach(b => b.setAttribute('aria-pressed', $('ajmot').value.trim() === b.dataset.mot));

      const ts = [...s.querySelectorAll('[data-tu]')].filter(c => c.checked).map(c => c.dataset.tu), id = alid || '_nova';
      const sim = { ...S.alunas, [id]: { ...(a || {}), responsavelId: rid || '_novo', turmas: ts, desc: descAtual(), inicio: mes, fim: null, ativa: true, descIrmaOk: $('adirma').checked, descMultiOk: $('admulti').checked } };
      const r = C.mensalidade(sim, id, mes, S.turmas, S.cfg);
      $('bqirma').setAttribute('aria-pressed', $('adirma').checked); $('bqmulti').setAttribute('aria-pressed', $('admulti').checked);
      $('aconta').innerHTML = r ? contaMensalidade(r, sim[id], 'Mensalidade') : '<div class="sub">Marque ao menos uma turma.</div>';
    };
    ['rtel', 'rcpf'].forEach(id => $(id).addEventListener('input', sugerir));
    $('anasc').addEventListener('input', () => { $('aidade').textContent = idade($('anasc').value) || '—'; });
    s.querySelectorAll('input,select').forEach(el => el.addEventListener('input', prev)); sugerir(); prev();
    if (adm) {
      const toca = id => { $(id).checked = !$(id).checked; prev(); };
      $('bqirma').onclick = () => toca('adirma'); $('bqmulti').onclick = () => toca('admulti');
      s.querySelectorAll('[data-aj]').forEach(b => b.onclick = () => { const antes = $('aaj').value; $('aaj').value = b.dataset.aj; if (antes !== b.dataset.aj) $('aajn').value = ''; prev(); if (!$('aajv').hidden) $('aajn').focus(); });
      s.querySelectorAll('[data-pc]').forEach(b => b.onclick = () => { $('aajn').value = b.dataset.pc; prev(); });
      s.querySelectorAll('[data-mot]').forEach(b => b.onclick = () => { $('ajmot').value = $('ajmot').value.trim() === b.dataset.mot ? '' : b.dataset.mot; prev(); });
    }
    if ($('acob')) $('acob').onclick = () => sheetCobrancaAluna(alid);
    if ($('avtermo')) $('avtermo').onclick = () => abrirDe(() => sheetAluna(alid), () => sheetVerTermo(alid));
    $('aok').onclick = async () => {
      const nome = $('anome').value.trim(), ts = [...s.querySelectorAll('[data-tu]')].filter(c => c.checked).map(c => c.dataset.tu), err = m => $('aerr').textContent = m;
      const rn = $('rnome').value.trim(), rt = $('rtel').value.trim(), rc = $('rcpf').value.trim();
      if (!nome) return err('Digite o nome do(a) aluno(a).');
      if (!idade($('anasc').value)) return err('Informe a data de nascimento do(a) aluno(a).');
      if (!rn) return err('Digite o nome do responsável.');
      if (!rt && !rc) return err('Informe o WhatsApp ou o CPF do responsável.');
      if (rc && C.soDigitos(rc).length !== 11) return err('O CPF tem 11 números.');
      const m = adm ? $('aaj').value : '', n = adm ? parseValor($('aajn').value) : 0;
      if (m === 'pct' && !(n > 0 && n <= 100)) return err('O desconto vai de 1 a 100%.');
      if (m === 'menos' && !(n > 0)) return err('Informe quanto abater da mensalidade, como 30,00.');
      if (m === 'valor' && !(n >= 0)) return err('Informe o valor combinado, como 120,00.');
      if (!ts.length) return err('Escolha a turma do(a) aluno(a).');
      const ativaN = $('aativa') ? $('aativa').checked : true, ini = $('aini').value || mes, fim = ativaN ? null : ($('afim').value || mesMais(mes, -1));
      if (fim && fim < ini) return err('O último mês cobrado não pode ser antes do primeiro.');
      $('aok').disabled = true;
      try {
        const id = alid || novoId(), ops = []; let r = rid;
        if (r) ops.push({ op: 'merge', p: `escolas/${S.eid}/responsaveis/${r}`, d: { nome: rn, telefone: rt, cpf: rc } });
        else { r = novoId(); const cod = novoCodigo(); ops.push({ op: 'set', p: `escolas/${S.eid}/responsaveis/${r}`, d: { nome: rn, telefone: rt, cpf: rc, codigo: cod, criadoEm: Date.now() } }, { op: 'set', p: 'codigos/' + cod, d: { eid: S.eid, rid: r } }); }
        ops.push({ op: 'set', p: `escolas/${S.eid}/alunas/${id}`, d: { ...(a || {}), nome, responsavelId: r, nascimento: $('anasc').value || null, turmas: ts, desc: descAtual(), ...(adm ? { descIrmaOk: $('adirma').checked, descMultiOk: $('admulti').checked } : {}), inicio: ini, fim, ativa: ativaN, ...(a ? {} : { cadastradaPor: S.prof ? 'professora' : 'administracao' }) } });
        for (const [g, G] of Object.entries(S.grupos)) { const tem = (G.alunas || []).includes(id); if (tem !== meusG.has(g)) ops.push({ op: 'merge', p: `escolas/${S.eid}/grupos/${g}`, d: { alunas: meusG.has(g) ? [...(G.alunas || []), id] : (G.alunas || []).filter(x => x !== id) } }); }
        await B.lote(ops); fecharSheet(); aviso(ed ? 'Aluno(a) atualizado(a)' : 'Aluno(a) cadastrado(a)');
      } catch (e) { err(msgErro(e)); $('aok').disabled = false; }
    };
    if ($('aanon')) $('aanon').onclick = () => confirmarApagar([alid], null);
    if ($('adel')) $('adel').onclick = () => {
      const p = S.pags[alid] || {};
      if (Object.keys(p.mens || {}).length || Object.keys(p.extras || {}).length) return $('aerr').textContent = 'Este(a) aluno(a) tem pagamentos registrados. Para sair, desmarque "Aluno(a) ativo(a)"; o histórico fica guardado. Se a família pediu, use "Apagar dados pessoais".';
      confirmar('Excluir aluno(a)?', `${esc(a.nome)} sai da escola e das cobranças.`, 'Excluir', () => B.del(`escolas/${S.eid}/alunas/${alid}`));
    };
  });
}

/* ================= Turmas, grupos, professores e locais ================= */
function cartaoTurma(tid, t) {
  const mes = mesHoje(), al = alunasDaTurma(tid, mes).sort((x, y) => String(x[1].nome).localeCompare(String(y[1].nome), 'pt-BR')), n = al.length;
  const aberta = (S.turmasAbertas || new Set()).has(tid);
  const fora = ([id, a]) => a.nascimento && !C.cabe(t, idadeAno(a)) && (a.faixaOk || {})[tid] !== anoRef(), nFora = al.filter(fora).length;
  const alunosTxt = `${n} aluno${n === 1 ? '' : 's'}${t.vagas ? ` · ${n >= t.vagas ? 'turma cheia' : t.vagas - n === 1 ? 'resta 1 vaga' : `restam ${t.vagas - n} vagas`}` : ''}`;
  return `<div class="local turma-card">
    <div class="hd"><div class="grow"><div class="t">${esc(t.nome)}</div></div>${S.admin ? `<button class="btn ghost btn-mini" data-et="${esc(tid)}">${ICO_EDIT} Editar</button>` : ''}</div>
    <div class="turma-info">${ddl([S.admin && ['Valor', `<b class="num">${brl(t.preco)}</b> <span class="sub">por mês</span>`], ['Faixa etária', esc(C.faixaTxt(t))], ['Professor(a)', esc(profNome(t) || '—')], ['Local', esc(localDe(t) || '—')], ['Dias e horário', esc(t.horario || '—')], S.admin && ['Pix vai para', esc(nomeRec(C.recDe(t)))], ['Alunos', `<span class="num">${alunosTxt}</span>${nFora ? ` <span class="chip vencido">${nFora} faixa etária</span>` : ''}`]])}</div>
    <button class="mostrar" data-abre="${esc(tid)}" aria-expanded="${aberta}">${aberta ? 'Esconder alunos' : `Mostrar alunos${n ? ` (${n})` : ''}`}<span aria-hidden="true">${aberta ? '▴' : '▾'}</span></button>
    ${aberta ? `<div class="ativ">${al.map(x => { const [id, a] = x;
      return `<div class="turma" data-al="${esc(id)}"><div class="grow"><div class="t">${esc(a.nome)}</div>${linhas(esc(idade(a.nascimento) || 'Sem data de nascimento'), respDe(id).nome ? 'Responsável: ' + esc(respDe(id).nome) : '')}</div>${fora(x) ? '<span class="chip vencido">Faixa etária</span>' : ''}</div>`; }).join('') || '<div class="sub">Nenhum aluno nesta turma ainda.</div>'}
      <button class="mini" data-nt="${esc(tid)}">+ Aluno(a) nesta turma</button></div>` : ''}</div>`;
}
/* ================= Aba Eventos (administração): calendário do mês, próximos eventos e o que já passou ================= */
function tEventos(v) {
  const h = hoje(); if (!S.evMes) S.evMes = h.slice(0, 7);
  const ano = Number(S.evMes.slice(0, 4)), mes = Number(S.evMes.slice(5, 7)), nomeM = C.MESES[mes - 1];
  const L = eventosAtivos(), prox = L.filter(([, x]) => fimDe(x) >= h), pass = L.filter(([, x]) => fimDe(x) < h).reverse();
  const card = ([xid, x]) => { const cv = convidadosDe(x), n = st => cv.filter(id => (partDe(x, id) || 'sem') === st).length, app = pelaEscola(x), d = new Date(x.data + 'T12:00');
    const ins = n('inscrito'), vao = n('interesse') + ins;
    return `<li class="tap ev-card" data-ev="${esc(xid)}"><div class="cal-dia"><b class="num">${d.getDate()}</b><span>${C.MESES[d.getMonth()].slice(0, 3)}</span></div>
      <div class="grow"><div class="t">${esc(x.nome)}</div>${linhas(`<span class="num">${esc(periodoTxt(x))}</span>${x.local ? ' · ' + esc(x.local) : ''}`,
        `${vao} vão · ${ins} ${app ? 'pago' : 'confirmado'}${ins === 1 ? '' : 's'} · ${n('sem')} sem resposta`)}
        <span class="chip ${app ? 'pix' : ''}" style="align-self:flex-start;margin-top:4px">${app ? 'Inscrição na escola' : 'Inscrição na organização'}</span></div></li>`; };
  v.innerHTML = `<section><div class="cal-topo"><button type="button" class="icon-btn" id="emant" aria-label="Mês anterior">‹</button><h2>${nomeM[0].toUpperCase() + nomeM.slice(1)} de ${ano}</h2><button type="button" class="icon-btn" id="emprox" aria-label="Próximo mês">›</button></div>
      ${gradeMes(ano, mes, eventosDoMes(ano, mes))}
      <button type="button" class="btn ghost" id="evano">Ver o ano inteiro</button></section>
    <section><div class="headrow" style="flex-wrap:nowrap"><h2>Próximos eventos <span class="sub num">${prox.length}</span></h2><button class="add-disc" id="evnovo2">+ Evento</button></div>
      ${prox.length ? `<ul class="list">${prox.map(card).join('')}</ul>` : '<div class="empty"><span>Lance copas, festivais e campeonatos. Os responsáveis dizem pelo app se o filho vai.</span></div>'}</section>
    ${pass.length ? `<details class="historico"><summary><span class="grow"><b>Eventos que já passaram</b><span class="s">${pass.length}</span></span><span class="seta" aria-hidden="true">▾</span></summary><ul class="list">${pass.map(card).join('')}</ul></details>` : ''}
    <button class="btn" id="evnovo" style="width:100%;padding:15px">+ Novo evento</button>`;
  const vai = n => { let a = ano, m = mes + n; if (m < 1) { m = 12; a--; } if (m > 12) { m = 1; a++; } S.evMes = `${a}-${String(m).padStart(2, '0')}`; render(); };
  $('emant').onclick = () => vai(-1); $('emprox').onclick = () => vai(1);
  $('evano').onclick = () => sheetCalendario(ano);
  $('evnovo').onclick = $('evnovo2').onclick = () => sheetEvento(null);
  v.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => abrirEvento(b.dataset.ev));
  let x0 = null; const g = v.querySelector('.mg');
  g.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  g.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) vai(dx < 0 ? 1 : -1); });
}
function tTurmas(v) {
  const prof = S.prof, turmas = ordenar(S.turmas).filter(([, t]) => !prof || t.professoraId === prof);
  const mud = mudancasFaixa().filter(m => !prof || (S.turmas[m.tid] || {}).professoraId === prof);
  const meu = prof ? porRecebedor(mesHoje())[prof] || { esp: 0, rec: 0 } : null, P = prof ? S.profs[prof] || {} : null;
  v.innerHTML = `${prof ? `<div class="hero"><div class="headrow" style="align-items:flex-end"><div><div class="label">Recebido por você em ${esc(C.nomeMes(mesHoje()))}</div><div class="big num">${brl(meu.rec)}</div></div><div style="text-align:right"><div class="label">Previsto</div><div class="num" style="font-weight:800">${brl(meu.esp)}</div></div></div>
      ${P.mpConectadoEm ? '<div class="sub">Os Pix que a escola direciona para você caem direto na sua conta do Mercado Pago.</div>' : '<div class="banner"><span>Seu Mercado Pago ainda não está ligado.</span><button id="pligar">Ligar agora</button></div>'}</div>` : ''}
    ${mud.length ? blocoFaixa(mud) : ''}
    <section><div class="headrow"><h2>${prof ? 'Minhas turmas' : 'Turmas'}</h2>${S.admin ? '<button class="add" id="tnov">+ Turma</button>' : ''}</div>
      ${turmas.length ? `<div class="tree">${turmas.map(([tid, t]) => cartaoTurma(tid, t)).join('')}</div>`
        : `<div class="empty">${prof ? 'Nenhuma turma está com você ainda. A administração escolhe o(a) professor(a) de cada turma.' : '<b>Nenhuma turma ainda.</b><span>Cadastre as turmas uma a uma: nome, faixa etária, professor(a), local, valor e horário. Depois cadastre os alunos dentro de cada turma.</span>'}</div>`}
    </section>
    ${S.admin ? `<section><div class="headrow"><h2>Professores</h2><button class="add" id="pnov">+ Professor(a)</button></div>
      ${Object.keys(S.profs).length ? `<ul class="list">${porNome(S.profs).map(([pid, P]) => { const ts = Object.values(S.turmas).filter(t => t.professoraId === pid).map(t => t.nome); return `<li class="tap" data-pr="${esc(pid)}"><div class="grow"><div class="t">${esc(P.nome)}</div><div class="s">${esc(ts.join(', ') || 'Sem turma')}</div></div><span class="chip ${P.mpConectadoEm ? 'pago' : 'aberto'}">${P.mpConectadoEm ? 'Pix ligado' : 'Pix não ligado'}</span></li>`; }).join('')}</ul>` : '<div class="note">Cadastre os professores para escolher quem dá cada turma.</div>'}
    </section>
    ${S.admin ? '' : blocoEventos()}
    <section><div class="headrow"><h2>Grupos</h2><button class="add" id="gnov">+ Grupo</button></div>${listaGrupos()}</section>
    <section><div class="headrow"><h2>Locais</h2><button class="add" id="lnov" style="background:var(--surface2);color:var(--ink)">+ Local</button></div>
      <div class="chips">${ordenar(S.locais).map(([lid, l]) => `<button class="pick" data-lo="${esc(lid)}">📍 ${esc(l.nome)}</button>`).join('') || '<span class="note">Opcional. O local aparece como etiqueta na turma.</span>'}</div></section>` : ''}`;
  ligarFaixa(v);
  if ($('pligar')) $('pligar').onclick = () => sheetAjustes();
  if ($('tnov')) $('tnov').onclick = () => sheetTurma();
  if ($('pnov')) $('pnov').onclick = () => sheetProf();
  if ($('gnov')) $('gnov').onclick = () => sheetGrupo();
  if ($('lnov')) $('lnov').onclick = () => sheetLocal();
  ligarEventos(v);
  v.querySelectorAll('[data-et]').forEach(e => e.onclick = () => sheetTurma(e.dataset.et));
  v.querySelectorAll('[data-abre]').forEach(b => b.onclick = () => { S.turmasAbertas = S.turmasAbertas || new Set(); const k = b.dataset.abre; S.turmasAbertas.has(k) ? S.turmasAbertas.delete(k) : S.turmasAbertas.add(k); render(); });
  v.querySelectorAll('[data-al]').forEach(e => e.onclick = () => sheetAluna(e.dataset.al));
  v.querySelectorAll('[data-nt]').forEach(e => e.onclick = () => sheetAluna(null, null, e.dataset.nt));
  v.querySelectorAll('[data-pr]').forEach(e => e.onclick = () => sheetProf(e.dataset.pr));
  v.querySelectorAll('[data-g]').forEach(e => e.onclick = () => sheetGrupo(e.dataset.g));
  v.querySelectorAll('[data-lo]').forEach(e => e.onclick = () => sheetLocal(e.dataset.lo));
}
function listaGrupos() {
  return Object.keys(S.grupos).length ? `<ul class="list">${porNome(S.grupos).map(([g, G]) => `<li class="tap" data-g="${esc(g)}"><div class="grow"><div class="t">${esc(G.nome)}</div><div class="s">${esc((G.alunas || []).map(id => primeiro((S.alunas[id] || {}).nome)).filter(Boolean).join(', ') || 'Sem alunos')}</div></div><span class="chip">${(G.alunas || []).length}</span></li>`).join('')}</ul>`
    : `<div class="empty"><span>Grupos servem para lançar cobranças para um conjunto de alunos, como "Equipe competitiva" ou "Vai ao Estadual".</span></div>`;
}
// Professora: lança eventos, competições e taxas e cuida dos grupos
function tLancar(v) {
  const ext = Object.entries(S.extras).filter(([, x]) => !eventoNovo(x) || pelaEscola(x)).sort((a, b) => String(b[1].venc).localeCompare(String(a[1].venc)));
  v.innerHTML = `${blocoEventos()}<section><div class="headrow"><h2>Taxas e cobranças extras</h2><button class="add" id="xnovo">+ Lançar</button></div>
      ${ext.length ? `<ul class="list">${ext.map(([xid, x]) => { const alvo = [...C.alvoExtra(x, S.alunas, S.grupos)], pg = alvo.filter(a => C.stPag(((S.pags[a] || {}).extras || {})[xid])).length;
        return `<li class="tap" data-x="${esc(xid)}"><div class="grow"><div class="t">${esc(x.nome)}</div><div class="s num"><span class="chip">${esc(C.TIPOS_EXTRA[x.tipo] || 'Extra')}</span> vence ${dataBR(x.venc)} · ${pg}/${alvo.length} pagas</div></div><span class="amt num">${brl(C.r2(alvo.reduce((t, id) => t + C.valorExtra(x, id), 0)))}</span></li>`; }).join('')}</ul>`
        : `<div class="empty"><span>Lance taxas, como ajuda de custo ou uniforme. Escolha para quais grupos, turmas ou alunos cada um vale e o vencimento.</span></div>`}</section>
    <section><div class="headrow"><h2>Grupos</h2><button class="add" id="gnov">+ Grupo</button></div>${listaGrupos()}</section>`;
  ligarEventos(v); $('xnovo').onclick = () => sheetExtra(); $('gnov').onclick = () => sheetGrupo();
  v.querySelectorAll('[data-x]').forEach(li => li.onclick = () => sheetExtra(li.dataset.x));
  v.querySelectorAll('[data-g]').forEach(e => e.onclick = () => sheetGrupo(e.dataset.g));
}
function sheetSimples({ titulo, campos, salvar, excluir, bloqueio, montar, depois }) {
  sheet(`<h3>${esc(titulo)}</h3>${campos}<div class="err" id="serr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="sok">Salvar</button></div>
    ${excluir ? `<button class="btn ghost" id="sdel" style="color:var(--out)">Excluir</button>` : ''}`, s => {
    montar && montar(s);
    $('sok').onclick = async () => { $('sok').disabled = true; try { const m = await salvar(s); if (m) { $('serr').textContent = m; $('sok').disabled = false; return; } fecharSheet(); aviso('Salvo'); if (depois) setTimeout(depois, 80); } catch (e) { $('serr').textContent = msgErro(e); $('sok').disabled = false; } };
    if ($('sdel')) $('sdel').onclick = () => bloqueio ? ($('serr').textContent = bloqueio) : confirmar('Excluir?', 'Isto não pode ser desfeito.', 'Excluir', excluir);
  });
}
function sheetLocal(lid) {
  const l = lid ? S.locais[lid] : null, n = lid ? Object.values(S.turmas).filter(t => t.localId === lid).length : 0;
  sheetSimples({ titulo: l ? 'Editar local' : 'Novo local',
    campos: `<div class="field"><label for="lnome2">Nome do local</label><input id="lnome2" maxlength="60" value="${esc(l ? l.nome : '')}" placeholder="Ex.: Unidade Centro"></div>
      <div class="field"><label for="lend">Endereço (opcional)</label><input id="lend" maxlength="120" value="${esc(l ? l.endereco || '' : '')}"></div>`,
    salvar: async () => { const nome = $('lnome2').value.trim(); if (!nome) return 'Digite o nome do local.'; await B.set(`escolas/${S.eid}/locais/${lid || novoId()}`, { nome, endereco: $('lend').value.trim(), ordem: l ? l.ordem ?? 0 : Object.keys(S.locais).length + 1 }); },
    excluir: lid && (() => B.del(`escolas/${S.eid}/locais/${lid}`)), bloqueio: n ? `${n} turma${n > 1 ? 's usam' : ' usa'} este local. Troque o local dessas turmas antes.` : null });
}
function sheetProf(pid) {
  const P = pid ? S.profs[pid] : null, n = pid ? Object.values(S.turmas).filter(t => t.professoraId === pid).length : 0;
  sheetSimples({ titulo: P ? 'Editar professor(a)' : 'Novo(a) professor(a)',
    campos: `<div class="field"><label for="pnome">Nome</label><input id="pnome" maxlength="60" value="${esc(P ? P.nome : '')}"></div>
      <div class="field"><label for="ptel">WhatsApp</label><input id="ptel" inputmode="tel" maxlength="20" value="${esc(P ? P.telefone || '' : '')}" placeholder="(81) 99999-9999"></div>
      ${P ? `<div class="field"><span class="lb">Conta que recebe o Pix</span>${blocoConta(pid, P)}</div>` : '<div class="note">Depois de salvar, você adiciona a conta que recebe o Pix.</div>'}`,
    montar: () => { document.querySelectorAll('.sheet [data-conta]').forEach(b => b.onclick = () => abrirDe(() => sheetProf(pid), () => sheetConta(pid))); },
    salvar: async () => { const nome = $('pnome').value.trim(); if (!nome) return 'Digite o nome do(a) professor(a).'; await B.set(`escolas/${S.eid}/professoras/${pid || novoId()}`, { nome, telefone: $('ptel').value.trim() }, { merge: true }); },
    excluir: pid && (() => B.del(`escolas/${S.eid}/professoras/${pid}`)), bloqueio: n ? 'Este(a) professor(a) tem turmas. Troque o(a) professor(a) dessas turmas antes.' : null });
}
// adicionar, trocar ou tirar a conta que recebe o Pix do(a) professor(a)
function sheetConta(pid) {
  const P = S.profs[pid]; if (!P) return;
  const turmasDela = Object.entries(S.turmas).filter(([, t]) => C.recDe(t) === pid), extrasDela = Object.entries(S.extras).filter(([, x]) => C.recDe(x) === pid);
  const msgLink = url => `Olá, ${primeiro(P.nome)}! Para receber pelo app da ${S.escola.nome || 'escola'} os pagamentos das suas turmas direto na sua conta do Mercado Pago, abra este link e autorize (vale 7 dias): ${url}`;
  sheet(`<h3>Conta de ${esc(primeiro(P.nome))}</h3>
    <div class="conta-box ${P.mpConectadoEm ? '' : 'vazia'}"><div class="headrow"><span class="label">Pix automático</span><span class="chip ${P.mpConectadoEm ? 'pago' : 'aberto'}">${P.mpConectadoEm ? 'Ligado' : 'Não ligado'}</span></div>
      <div class="sub">${P.mpConectadoEm ? `Os Pix que você direcionar para ${esc(primeiro(P.nome))} caem na conta do Mercado Pago${P.mpConta ? ' de <b>' + esc(P.mpConta) + '</b>' : ''}.` : `${esc(primeiro(P.nome))} precisa abrir o link e autorizar a conta do Mercado Pago dele(a). Só ele(a) pode fazer isso, com a senha da própria conta.`}</div>
      <div class="actions"><button type="button" class="btn ${P.mpConectadoEm ? 'ghost' : ''}" id="clink">${P.mpConectadoEm ? 'Trocar por outra conta' : 'Mandar link para ligar'}</button>
        ${P.mpConectadoEm ? `<button type="button" class="btn ghost" id="cdesl" style="color:var(--out)">Desligar esta conta</button>` : ''}</div>
      ${MOCK && !P.mpConectadoEm ? `<button type="button" class="btn ghost btn-mini" id="cmock" style="align-self:flex-start">Teste: simular que ${esc(primeiro(P.nome))} autorizou</button>` : ''}</div>
    <div class="field"><label for="cmpc">Conta do Mercado Pago (para conferência)</label><input id="cmpc" maxlength="80" value="${esc(P.mpContaInfo || '')}" placeholder="E-mail ou CPF da conta"></div>
    <div class="field"><label for="cpix">Chave Pix (para conferência)</label><input id="cpix" maxlength="80" value="${esc(P.pixChave || '')}" placeholder="CPF, e-mail, celular ou chave aleatória"></div>
    <div class="note">Estes dois campos aparecem no relatório em PDF. Para apagar, deixe em branco e salve.</div>
    <div class="err" id="cerr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn" id="cok">Salvar</button></div>
    ${P.mpConectadoEm || P.mpContaInfo || P.pixChave ? `<button type="button" class="btn ghost" id="ctudo" style="color:var(--out)">Tirar toda a conta de ${esc(primeiro(P.nome))}</button>` : ''}`, () => {
    $('clink').onclick = async () => {
      let url = `${LINK_APP}?ligar=${pid}`;
      if (!MOCK) { $('clink').disabled = true; try { url = (await mpProf('link', pid)).link; } catch (e) { $('cerr').textContent = msgErro(e); $('clink').disabled = false; return; } $('clink').disabled = false; }
      const txt = msgLink(url), wa = waLink(P.telefone, txt);
      if (wa) window.open(wa, '_blank', 'noopener'); else copiar(txt, 'Link copiado. Mande para ' + primeiro(P.nome) + '. Ao autorizar, a conta nova substitui a anterior.');
    };
    if ($('cmock')) $('cmock').onclick = async () => { await B.set(`escolas/${S.eid}/professoras/${pid}`, { mpConectadoEm: Date.now(), mpConta: P.nome }, { merge: true }); aviso('Conta ligada (teste)'); setTimeout(() => sheetConta(pid), 60); };
    // desligar: tira a conta e, se você quiser, manda as turmas e cobranças dela para a escola
    const desligar = (tudo) => {
      const n = turmasDela.length + extrasDela.length;
      sheet(`<h3>${tudo ? 'Tirar toda a conta?' : 'Desligar esta conta?'}</h3>
        <p class="sub" style="margin:0">Os próximos Pix deixam de cair na conta de ${esc(primeiro(P.nome))}. O que já foi pago continua registrado.</p>
        ${n ? `<label class="check"><input type="checkbox" id="dmov" checked> Mandar para a escola o que hoje vai para ${esc(primeiro(P.nome))} (${turmasDela.length} turma${turmasDela.length === 1 ? '' : 's'}${extrasDela.length ? `, ${extrasDela.length} cobrança${extrasDela.length === 1 ? '' : 's'}` : ''})</label>
          <div class="note">Se deixar desmarcado, essas turmas ficam sem Pix até ligar outra conta.</div>` : ''}
        <div class="err" id="derr" role="alert"></div>
        <div class="actions"><button type="button" class="btn ghost" id="dvolta">Voltar</button><button type="button" class="btn danger" id="dok">${tudo ? 'Tirar conta' : 'Desligar'}</button></div>`, () => {
        $('dvolta').onclick = () => sheetConta(pid);
        $('dok').onclick = async () => {
          $('dok').disabled = true;
          const ops = [{ op: 'merge', p: `escolas/${S.eid}/professoras/${pid}`, d: { mpConectadoEm: null, mpConta: null, mpDesligadoEm: Date.now(), ...(tudo ? { mpContaInfo: '', pixChave: '' } : {}) } }];
          if ($('dmov') && $('dmov').checked) { turmasDela.forEach(([tid]) => ops.push({ op: 'merge', p: `escolas/${S.eid}/turmas/${tid}`, d: { recebedor: 'escola' } })); extrasDela.forEach(([xid]) => ops.push({ op: 'merge', p: `escolas/${S.eid}/extras/${xid}`, d: { recebedor: 'escola' } })); }
          try { if (!MOCK && P.mpConectadoEm) await mpProf('desconectar', pid); await B.lote(ops); fecharSheet(); aviso(tudo ? 'Conta retirada' : 'Conta desligada'); } catch (e) { $('derr').textContent = msgErro(e); $('dok').disabled = false; }
        };
      });
    };
    if ($('cdesl')) $('cdesl').onclick = () => desligar(false);
    if ($('ctudo')) $('ctudo').onclick = () => desligar(true);
    $('cok').onclick = async () => { $('cok').disabled = true; try { await B.set(`escolas/${S.eid}/professoras/${pid}`, { mpContaInfo: $('cmpc').value.trim(), pixChave: $('cpix').value.trim() }, { merge: true }); fecharSheet(); aviso('Conta salva'); } catch (e) { $('cerr').textContent = msgErro(e); $('cok').disabled = false; } };
  });
}
function sheetTurma(tid, depois) {
  const novoTid = tid || novoId(), t = tid ? S.turmas[tid] : null, n = tid ? Object.values(S.alunas).filter(a => (a.turmas || []).includes(tid)).length : 0, todas = t ? C.todasIdades(t) : false;
  sheetSimples({ titulo: t ? 'Editar turma' : 'Nova turma',
    campos: `<div class="field"><label for="tnome">Nome da turma</label><input id="tnome" maxlength="60" value="${esc(t ? t.nome : '')}" placeholder="Ex.: Iniciação"></div>
      <div class="field"><span class="lb">Faixa etária</span>
        <div class="two"><div class="field"><label for="tmin">De (anos)</label><input id="tmin" type="number" min="0" max="99" inputmode="numeric" value="${esc(t && t.idadeMin != null ? t.idadeMin : '')}" ${todas ? 'disabled' : ''}></div>
        <div class="field"><label for="tmax">Até (anos)</label><input id="tmax" type="number" min="0" max="99" inputmode="numeric" value="${esc(t && t.idadeMax != null ? t.idadeMax : '')}" ${todas ? 'disabled' : ''}></div></div>
        <label class="check"><input type="checkbox" id="ttodas" ${todas ? 'checked' : ''}> Todas as faixas etárias</label>
        <div class="note">Vale a idade que o(a) aluno(a) completa no ano.</div></div>
      <div class="two"><div class="field"><label for="tprof">Professor(a)</label><select id="tprof"><option value="">Sem professor(a)</option>${porNome(S.profs).map(([id, P]) => `<option value="${esc(id)}" ${t && t.professoraId === id ? 'selected' : ''}>${esc(P.nome)}</option>`).join('')}</select></div>
      <div class="field"><label for="tloc">Local</label><select id="tloc"><option value="">Sem local</option>${ordenar(S.locais).map(([id, l]) => `<option value="${esc(id)}" ${t && t.localId === id ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</select></div></div>
      <div class="two"><div class="field"><label for="tpreco">Valor mensal (R$)</label><input id="tpreco" inputmode="decimal" value="${esc(fmtValor(t && t.preco))}" placeholder="0,00"></div>
      <div class="field"><label for="tvag">Limite de alunos (opcional)</label><input id="tvag" type="number" min="0" value="${esc(t && t.vagas ? t.vagas : '')}"></div></div>
      <div class="field"><label for="thor">Dias e horário</label><input id="thor" maxlength="60" value="${esc(t ? t.horario || '' : '')}" placeholder="Ex.: Seg e Qua, 17h às 18h"></div>
      <div class="field"><label for="trec">A mensalidade vai para</label><select id="trec">${opcoesRec(t && t.recebedor)}</select>
        <div class="note">O Pix da mensalidade cai direto na conta do Mercado Pago de quem você escolher aqui.</div></div>
      ${n ? `<div class="note">${n} aluno${n === 1 ? '' : 's'} nesta turma. Mudar o valor vale para os meses que ainda não foram pagos.</div>` : ''}`,
    montar: () => { $('ttodas').onchange = e => { $('tmin').disabled = $('tmax').disabled = e.target.checked; }; if (!t) $('tprof').onchange = e => { if (e.target.value) $('trec').value = e.target.value; }; },
    salvar: async () => {
      const nome = $('tnome').value.trim(), preco = parseValor($('tpreco').value), todasN = $('ttodas').checked;
      const mn = $('tmin').value === '' ? null : Number($('tmin').value), mx = $('tmax').value === '' ? null : Number($('tmax').value);
      if (!nome) return 'Digite o nome da turma.';
      if (!todasN && mn == null && mx == null) return 'Informe a faixa etária ou marque "Todas as faixas etárias".';
      if (!todasN && mn != null && mx != null && mn > mx) return 'A idade inicial não pode ser maior que a final.';
      if (!(preco >= 0)) return 'Informe o valor mensal da turma, como 150,00.';
      await B.set(`escolas/${S.eid}/turmas/${novoTid}`, { ...(t || {}), nome, todasIdades: todasN, idadeMin: todasN ? null : mn, idadeMax: todasN ? null : mx, professoraId: $('tprof').value || null, recebedor: $('trec').value || 'escola', localId: $('tloc').value || null, horario: $('thor').value.trim(), preco, vagas: Number($('tvag').value) || null, ordem: t ? t.ordem ?? 0 : Object.keys(S.turmas).length + 1 });
    },
    depois: depois ? () => depois(novoTid) : null,
    excluir: tid && (() => B.del(`escolas/${S.eid}/turmas/${tid}`)), bloqueio: n ? 'Esta turma tem alunos. Tire os alunos da turma antes de excluir.' : null });
}
function sheetGrupo(gid) {
  const G = gid ? S.grupos[gid] : null, sel = new Set(G ? G.alunas || [] : []);
  const usado = gid ? Object.values(S.extras).some(x => (x.grupos || []).includes(gid)) : false;
  sheetSimples({ titulo: G ? 'Editar grupo' : 'Novo grupo',
    campos: `<div class="field"><label for="gnome">Nome do grupo</label><input id="gnome" maxlength="50" value="${esc(G ? G.nome : '')}" placeholder="Ex.: Equipe competitiva"></div>
      <div class="field"><div class="headrow"><span class="lb">Alunos <span class="num" id="gcnt"></span></span></div>
        <select id="gturma"><option value="">Adicionar uma turma inteira…</option>${ordenar(S.turmas).map(([t, T]) => `<option value="${esc(t)}">${esc(nomeTurma(T))}</option>`).join('')}</select>
        <div class="checks">${porNome(S.alunas).filter(([id, a]) => C.ativaNoMes(a, mesHoje()) || sel.has(id)).map(([id, a]) => `<label><input type="checkbox" data-ga="${esc(id)}" ${sel.has(id) ? 'checked' : ''}><span class="grow">${esc(a.nome)}<span class="s" style="display:block">${esc(turmasTxt(a))}</span></span></label>`).join('') || '<div class="grp">Cadastre alunos primeiro</div>'}</div></div>`,
    montar: s => {
      const cnt = () => $('gcnt').textContent = `(${s.querySelectorAll('[data-ga]:checked').length})`; cnt();
      s.querySelectorAll('[data-ga]').forEach(c => c.onchange = cnt);
      $('gturma').onchange = e => { const t = e.target.value; if (t) s.querySelectorAll('[data-ga]').forEach(c => { if ((S.alunas[c.dataset.ga].turmas || []).includes(t)) c.checked = true; }); e.target.value = ''; cnt(); };
    },
    salvar: async s => { const nome = $('gnome').value.trim(); if (!nome) return 'Dê um nome ao grupo.';
      await B.set(`escolas/${S.eid}/grupos/${gid || novoId()}`, { nome, alunas: [...s.querySelectorAll('[data-ga]')].filter(c => c.checked).map(c => c.dataset.ga) }); },
    excluir: gid && (() => B.del(`escolas/${S.eid}/grupos/${gid}`)), bloqueio: usado ? 'Há cobranças lançadas para este grupo. Tire o grupo dessas cobranças antes.' : null });
}

/* ================= Relatórios para os professores (administração) ================= */
// o que é de um(a) professor(a): recebidos no mês (pela data do pagamento), em atraso até hoje e a vencer no mês
function dadosRelatorio(pid, mes) {
  const h = hoje(), rec = [], atr = [], ven = [];
  const forma = p => NOME_VIA[p.via] || 'Outro';
  for (const [alid, a] of porNome(S.alunas)) {
    const pag = S.pags[alid] || {}, r = respDe(alid);
    // mensalidades pagas: a parte dela (se pagou em mais de um Pix, vale o que caiu para ela)
    const meses = new Set([...Object.keys(pag.mens || {}), ...Object.keys(pag.mensPartes || {})]);
    for (const mm of meses) {
      const pp = C.stPag(((pag.mensPartes || {})[mm] || {})[pid]), pt = C.stPag((pag.mens || {})[mm]);
      let v = 0, d = null, f = '';
      if (pp) { v = pp.v; d = pp.d; f = forma(pp); }
      else if (pt && !(pag.mensPartes || {})[mm]) { v = (C.partesMens(a, S.turmas, pt.v) || {})[pid] || 0; d = pt.d; f = forma(pt); }
      if (v > 0 && String(d).slice(0, 7) === mes) rec.push({ d, data: dataBR(d), aluna: a.nome, cobranca: `Mensalidade de ${C.nomeMes(mm)}`, forma: f, v });
    }
    for (const [xid, x] of Object.entries(pag.extras || {})) {
      const p = C.stPag(x), X = S.extras[xid]; if (!p || !X || C.recDe(X) !== pid || String(p.d).slice(0, 7) !== mes) continue;
      rec.push({ d: p.d, data: dataBR(p.d), aluna: a.nome, cobranca: X.nome, forma: forma(p), v: p.v });
    }
    for (const [aid, ps] of Object.entries(pag.acordos || {})) for (const [n, x] of Object.entries(ps || {})) {
      const p = C.stPag(x), A = S.acordos[aid]; if (!p || !A || String(p.d).slice(0, 7) !== mes) continue;
      const v = C.partesAcordo(A, p.v)[pid] || 0; if (v > 0) rec.push({ d: p.d, data: dataBR(p.d), aluna: a.nome, cobranca: `Acordo · parcela ${n}`, forma: forma(p), v });
    }
    for (const i of itensDe(alid)) {
      if (i.pago || !i.partes || !(i.partes[pid] > 0)) continue;
      if (i.venc < h) atr.push({ vd: i.venc, venc: dataBR(i.venc), aluna: a.nome, resp: r.nome || '—', tel: r.telefone || '', cobranca: i.desc, dias: Math.round((Date.parse(h) - Date.parse(i.venc)) / 864e5), v: i.partes[pid] });
      else if (String(i.venc).slice(0, 7) === mes) ven.push({ vd: i.venc, venc: dataBR(i.venc), aluna: a.nome, cobranca: i.desc, v: i.partes[pid] });
    }
  }
  rec.sort((x, y) => String(x.d).localeCompare(String(y.d))); atr.sort((x, y) => x.vd.localeCompare(y.vd)); ven.sort((x, y) => x.vd.localeCompare(y.vd));
  const soma = l => C.r2(l.reduce((s, x) => s + x.v, 0));
  return { recebidos: rec, atrasados: atr, aVencer: ven, resumo: { recebido: soma(rec), atraso: soma(atr), aVencer: soma(ven), nRec: rec.length, nAtr: atr.length, nVen: ven.length } };
}
async function salvarArquivo(nome, bytes, tipo) {
  // dentro do Claude (demonstração): pede ao app para salvar; no celular: abre o compartilhar (WhatsApp, e-mail); senão baixa
  try { if (window.claude && window.claude.use) { const dl = await window.claude.use('downloads'); if (dl) { await dl.save({ filename: nome, data: new Blob([bytes], { type: tipo }) }); return 'salvo'; } } }
  catch (e) { if (e && e.code === 'declined') return 'cancelado'; }
  const arq = new File([bytes], nome, { type: tipo });
  try { if (navigator.canShare && navigator.canShare({ files: [arq] })) { await navigator.share({ files: [arq], title: nome }); return 'compartilhado'; } } catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; }
  const url = URL.createObjectURL(arq), a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'baixado';
}
function pdfProfessora(pid, mes) {
  const P = S.profs[pid] || {}, D = dadosRelatorio(pid, mes), agora = new Date();
  const bytes = window.Relatorio.professora({ cor: hexOk(S.cfg.cor) ? S.cfg.cor : null, logo: S.cfg.logoPdf || null, escola: S.escola.nome || 'Escola', professora: P.nome || 'Professor(a)', periodo: nomeMesAno(mes), periodoCurto: `${C.nomeMes(mes)} de ${mes.slice(0, 4)}`, conta: contaTxt(P),
    geradoEm: `${dataBR(hoje())}/${hoje().slice(0, 4)} ${pad(agora.getHours())}:${pad(agora.getMinutes())}`, ...D });
  const nome = `Relatorio ${String(P.nome || 'professor').split(' ')[0]} ${mes}.pdf`.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return { bytes, nome };
}
async function gerarPdfProfessora(pid, mes) {
  const { bytes, nome } = pdfProfessora(pid, mes);
  const r = await salvarArquivo(nome, bytes, 'application/pdf');
  if (r !== 'cancelado') aviso(r === 'compartilhado' ? 'Relatório compartilhado' : 'Relatório em PDF pronto');
}
function textoRelatorio(pid, mes) {
  const P = S.profs[pid] || {}, D = dadosRelatorio(pid, mes);
  return `Olá, ${primeiro(P.nome)}! Resumo de ${C.nomeMes(mes)} na ${S.escola.nome || 'escola'}:\n• Recebido por você: ${brl(D.resumo.recebido)} (${D.resumo.nRec} pagamento${D.resumo.nRec === 1 ? '' : 's'})\n• Em atraso: ${brl(D.resumo.atraso)}${D.atrasados.length ? '\n' + D.atrasados.map(a => `   - ${a.aluna}: ${a.cobranca}, ${brl(a.v)} (venceu ${a.venc})`).join('\n') : ''}\n• A vencer este mês: ${brl(D.resumo.aVencer)}\nO relatório completo vai em PDF.`;
}
// todo dinheiro que entrou no mês (pela data do pagamento), dividido por quem recebeu
function recebidosNoMes(mes) {
  const out = [], forma = p => NOME_VIA[p.via] || 'Outro';
  const add = (rec, v, p, a, desc) => { if (v > 0 && String(p.d).slice(0, 7) === mes) out.push({ rec, v: C.r2(v), via: p.via, forma: forma(p), d: p.d, data: dataBR(p.d), aluna: a.nome, cobranca: desc }); };
  for (const [alid, a] of porNome(S.alunas)) {
    const pag = S.pags[alid] || {};
    for (const mm of new Set([...Object.keys(pag.mens || {}), ...Object.keys(pag.mensPartes || {})])) {
      const mp = (pag.mensPartes || {})[mm], pt = C.stPag((pag.mens || {})[mm]);
      if (mp) { for (const [rec, x] of Object.entries(mp)) { const p = C.stPag(x); if (p) add(rec, p.v, p, a, `Mensalidade de ${C.nomeMes(mm)}`); } }
      else if (pt) for (const [rec, v] of Object.entries(C.partesMens(a, S.turmas, pt.v))) add(rec, v, pt, a, `Mensalidade de ${C.nomeMes(mm)}`);
    }
    for (const [xid, x] of Object.entries(pag.extras || {})) { const p = C.stPag(x), X = S.extras[xid]; if (p && X) add(C.recDe(X), p.v, p, a, X.nome); }
    for (const [aid, ps] of Object.entries(pag.acordos || {})) for (const [n, x] of Object.entries(ps || {})) { const p = C.stPag(x), A = S.acordos[aid]; if (p && A) for (const [rec, v] of Object.entries(C.partesAcordo(A, p.v))) add(rec, v, p, a, `Acordo · parcela ${n}`); }
  }
  return out.sort((x, y) => String(x.d).localeCompare(String(y.d)));
}
function tFinanceiro(v) {
  const aba = S.abaFin || 'escola';
  v.innerHTML = `<div class="seg"><button data-fa="escola" aria-pressed="${aba === 'escola'}">Contas da escola</button><button data-fa="prof" aria-pressed="${aba === 'prof'}">Professores</button></div><div id="fcorpo" style="display:flex;flex-direction:column;gap:16px"></div>`;
  v.querySelectorAll('[data-fa]').forEach(b => b.onclick = () => { S.abaFin = b.dataset.fa; render(); });
  (aba === 'prof' ? finProfessoras : finEscola)($('fcorpo'));
}
// contabilidade rápida da escola: o que caiu na conta da escola, saídas e saldo
function finEscola(v) {
  const mes = S.mes, rs = recebidosNoMes(mes).filter(r => r.rec === 'escola');
  const pix = C.r2(rs.filter(r => ONLINE(r.via)).reduce((s, r) => s + r.v, 0)), din = C.r2(rs.filter(r => !ONLINE(r.via)).reduce((s, r) => s + r.v, 0));
  const ls_ = Object.entries(S.lanc).filter(([, l]) => String(l.data).slice(0, 7) === mes).sort((a, b) => String(b[1].data).localeCompare(String(a[1].data)));
  const outras = C.r2(ls_.filter(([, l]) => l.tipo === 'entrada').reduce((s, [, l]) => s + l.v, 0)), sai = C.r2(ls_.filter(([, l]) => l.tipo === 'saida').reduce((s, [, l]) => s + l.v, 0));
  const ent = C.r2(pix + din + outras), saldo = C.r2(ent - sai), conta = (S.mpc || {}).conta;
  const porCat = {}; ls_.filter(([, l]) => l.tipo === 'saida').forEach(([, l]) => porCat[l.cat] = (porCat[l.cat] || 0) + l.v);
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]), maxC = cats.length ? cats[0][1] : 1;
  v.innerHTML = `<div class="hero">
      <div><div class="label">Saldo da escola em ${esc(C.nomeMes(mes))}</div><div class="big num" style="color:${saldo < 0 ? 'var(--out)' : 'var(--ink)'}">${brl(saldo)}</div></div>
      <div class="conta">
        ${contaL('Pelo app (Pix, cartão, boleto)', brl(pix))}
        ${contaL('Recebido em dinheiro', brl(din))}
        ${contaL('Outras entradas', brl(outras))}
        ${contaL(`Saídas (${ls_.filter(([, l]) => l.tipo === 'saida').length} lançamento${ls_.filter(([, l]) => l.tipo === 'saida').length === 1 ? '' : 's'})`, '− ' + brl(sai), 'saida')}
        ${contaL('<b>Saldo do mês</b>', `<b>${brl(saldo)}</b>`, 'total')}
      </div>
      <div class="note">Só o que é da escola: o que os professores recebem direto fica na aba Professores.</div>
    </div>
    <section class="dica" style="gap:6px"><div class="headrow"><h2>Pix da escola</h2><button class="chip" id="fcfg">Editar</button></div>
      ${ddl([['Mercado Pago', S.cfg.mpConectadoEm ? `${conta ? esc(conta.nome) : 'Conta da escola'} <span class="chip pago">Conectado</span>` : '<span class="chip vencido">Não conectado</span>'], ['Documento', conta && S.cfg.mpConectadoEm ? `<span class="num">${esc(conta.doc || '')}</span>` : ''], ['Chave Pix', S.cfg.pixChave ? `<span class="num" style="user-select:all">${esc(S.cfg.pixChave)}</span>` : '—']])}
    </section>
    ${rs.length ? `<details class="dica"><summary class="headrow" style="cursor:pointer"><h2>Entradas da escola</h2><span class="sub">${rs.length} pagamento${rs.length === 1 ? '' : 's'} · ver ›</span></summary>
      <ul class="list" style="margin-top:10px">${rs.map(r => `<li><div class="grow"><div class="t">${esc(r.aluna)}</div>${linhas(esc(r.cobranca), `<span class="num">${esc(r.forma)} em ${esc(r.data)}</span>`)}</div>${valorCol(brl(r.v), '', 'in')}</li>`).join('')}</ul></details>` : ''}
    <section><h2>Para onde foi o dinheiro</h2>${cats.length ? `<div class="bars">${cats.map(([c, x]) => `<div class="bar"><div class="row1"><span>${esc(c)}</span><b class="num">${brl(x)}</b></div><div class="track"><i class="late" style="width:${Math.max(3, x / maxC * 100)}%"></i></div></div>`).join('')}</div>` : '<div class="sub">Nenhuma saída registrada neste mês.</div>'}</section>
    <section><div class="headrow"><h2>Lançamentos</h2><button class="add" id="cnl">+ Lançamento</button></div>
      ${ls_.length ? `<ul class="list">${ls_.map(([id, l]) => `<li class="tap" data-l="${esc(id)}"><div class="grow"><div class="t">${esc(l.desc || l.cat)}</div>${linhas(esc(l.cat), `<span class="num">${dataBR(l.data)}${l.localId && S.locais[l.localId] ? ' · ' + esc(S.locais[l.localId].nome) : ''}</span>`)}</div>${valorCol(`${l.tipo === 'entrada' ? '+' : '−'} ${brl(l.v)}`, '', l.tipo === 'entrada' ? 'in' : 'out')}</li>`).join('')}</ul>`
        : `<div class="empty"><span>Registre aqui aluguel, salários, compra de aparelhos, inscrições, patrocínios. O que é pago pelo app entra sozinho.</span></div>`}
    </section>`;
  $('fcfg').onclick = () => sheetAjustes(); $('cnl').onclick = () => sheetLanc();
  v.querySelectorAll('[data-l]').forEach(li => li.onclick = () => sheetLanc(li.dataset.l));
}
// a conta que recebe o Pix do(a) professor(a), em destaque: dá para adicionar, trocar ou tirar
function blocoConta(pid, P) {
  const tem = P.mpConectadoEm || P.mpContaInfo || P.pixChave;
  if (!tem) return `<div class="conta-box vazia"><div class="grow"><b>Nenhuma conta de recebimento</b><span class="s">Sem conta, os pagamentos das turmas dele(a) não podem cair direto para ele(a).</span></div><button class="btn btn-mini" data-conta="${esc(pid)}">+ Adicionar conta</button></div>`;
  return `<div class="conta-box"><div class="headrow"><span class="label">Conta que recebe</span><span class="chip ${P.mpConectadoEm ? 'pago' : 'aberto'}">${P.mpConectadoEm ? 'Pix ligado' : 'Pix não ligado'}</span></div>
    ${ddl([['Mercado Pago', esc(P.mpConectadoEm ? (P.mpConta || P.mpContaInfo || 'Conta ligada') : (P.mpContaInfo || '—'))], ['Chave Pix', P.pixChave ? `<span class="num">${esc(P.pixChave)}</span>` : '—']])}
    <button class="btn ghost btn-mini" data-conta="${esc(pid)}" style="align-self:flex-start">${ICO_EDIT} Alterar ou tirar conta</button></div>`;
}
function contaTxt(P) { return [P.mpContaInfo && 'Mercado Pago: ' + P.mpContaInfo, P.pixChave && 'chave Pix: ' + P.pixChave].filter(Boolean).join(' · '); }
// relatório dos professores: quem recebe o quê, e o PDF de cada uma
function finProfessoras(v) {
  const mes = S.mes, rs = recebidosNoMes(mes), atr = atrasados(), prev = porRecebedor(mes), profs = porNome(S.profs);
  const quem = ['escola', ...profs.map(([id]) => id)].map(r => ({ r, rec: C.r2(rs.filter(x => x.rec === r).reduce((s, x) => s + x.v, 0)), atr: C.r2(atr.porAluna.flatMap(x => x.it).reduce((s, i) => s + ((i.partes || {})[r] || 0), 0)), prev: (prev[r] || {}).esp || 0 }));
  // cobranças do mês por tipo (antes ficava no Painel)
  const tipos = [['m', 'Mensalidades'], ['evento', 'Eventos'], ['taxa', 'Taxas'], ['acordo', 'Parcelas de acordos']], porTipo = {};
  for (const alid of Object.keys(S.alunas)) for (const i of itensDoMes(alid, mes)) { const k = i.tipo === 'm' ? 'm' : i.tipo === 'a' ? 'acordo' : i.tipoExtra === 'competicao' ? 'evento' : i.tipoExtra || 'taxa', T = porTipo[k] = porTipo[k] || { esp: 0, rec: 0 }; T.esp += i.v; if (i.pago) T.rec += i.v; }
  v.innerHTML = `<section><h2>Cobranças de ${esc(C.nomeMes(mes))} por tipo</h2>
      <div class="bars">${tipos.filter(([k]) => porTipo[k]).map(([k, n]) => { const T = porTipo[k]; return `<div class="bar"><div class="row1"><span>${n}</span><span class="num"><b>${brl(T.rec)}</b> <span class="sub">de ${brl(T.esp)}</span></span></div><div class="track"><i style="width:${T.esp ? T.rec / T.esp * 100 : 0}%"></i></div></div>`; }).join('') || '<div class="sub">Nada previsto para este mês.</div>'}</div></section>
    <section><h2>Quem recebe o quê em ${esc(C.nomeMes(mes))}</h2>
      <ul class="list">${quem.map(q => `<li class="quem"><div class="grow"><div class="t">${esc(q.r === 'escola' ? 'Escola' : nomeRec(q.r))}</div>
        <div class="conta" style="margin-top:6px">${contaL('Recebido', brl(q.rec), q.rec ? 'desc' : '')}${contaL('Em atraso', brl(q.atr), q.atr ? 'saida' : '')}${contaL('Previsto no mês', brl(q.prev))}</div></div></li>`).join('')}</ul>
      <div class="note">Recebido: pela data do pagamento. Em atraso: tudo vencido até hoje. Previsto: o que vence no mês.</div></section>
    ${profs.length ? profs.map(([pid, P]) => { const D = dadosRelatorio(pid, mes), ts = Object.values(S.turmas).filter(t => C.recDe(t) === pid).map(t => t.nome);
      return `<div class="hero" style="gap:10px">
        <div class="headrow"><h2>${esc(P.nome)}</h2><button class="btn ghost btn-mini" data-edp="${esc(pid)}">${ICO_EDIT} Editar</button></div>
        ${ddl([['Turmas', esc(ts.join(', ') || 'Nenhuma direcionada')]])}
        ${blocoConta(pid, P)}
        <div class="legend">
          <div><span class="sw s-in"></span><span class="grow">Recebido em ${esc(C.nomeMes(mes))}<span class="s">${D.resumo.nRec} pagamento${D.resumo.nRec === 1 ? '' : 's'}</span></span><b class="num">${brl(D.resumo.recebido)}</b></div>
          <div><span class="sw s-out"></span><span class="grow">Em atraso<span class="s">${D.atrasados.length ? esc([...new Set(D.atrasados.map(a => primeiro(a.aluna)))].join(', ')) : 'ninguém em atraso'}</span></span><b class="num" style="color:var(--out)">${brl(D.resumo.atraso)}</b></div>
          <div><span class="sw s-warn"></span><span class="grow">A vencer em ${esc(C.nomeMes(mes))}</span><b class="num">${brl(D.resumo.aVencer)}</b></div>
        </div>
        <button class="btn wa-btn" data-envia="${esc(pid)}">${ICO_WA} Enviar relatório em PDF no WhatsApp</button>
        <div class="actions"><button class="btn ghost" data-pdf="${esc(pid)}">Baixar PDF</button><button class="btn ghost" data-txt="${esc(pid)}">Copiar resumo</button></div>
      </div>`; }).join('') : `<div class="empty"><b>Nenhum(a) professor(a) cadastrado(a).</b><span>Cadastre os professores na aba Turmas e escolha, em cada turma, para quem vai a mensalidade.</span></div>`}`;
  v.querySelectorAll('[data-envia]').forEach(b => b.onclick = () => sheetEnviarRelatorio(b.dataset.envia, mes));
  v.querySelectorAll('[data-pdf]').forEach(b => b.onclick = async () => { b.disabled = true; try { await gerarPdfProfessora(b.dataset.pdf, mes); } catch (e) { aviso('Não deu para gerar o PDF agora.'); console.warn(e); } b.disabled = false; });
  v.querySelectorAll('[data-txt]').forEach(b => b.onclick = () => copiar(textoRelatorio(b.dataset.txt, mes), 'Resumo copiado. Cole no WhatsApp do(a) professor(a).'));
  v.querySelectorAll('[data-edp]').forEach(b => b.onclick = () => sheetProf(b.dataset.edp));
  v.querySelectorAll('[data-conta]').forEach(b => b.onclick = () => sheetConta(b.dataset.conta));
}
/* Enviar o PDF para o(a) professor(a) no WhatsApp.
   No celular (app publicado): abre o compartilhar com o PDF já anexado; escolhe WhatsApp e o(a) professor(a).
   Onde não dá para compartilhar arquivo (aqui na demonstração, no computador): salva o PDF e abre a conversa dela. */
function sheetEnviarRelatorio(pid, mes) {
  const P = S.profs[pid] || {}, { bytes, nome } = pdfProfessora(pid, mes), arq = new File([bytes], nome, { type: 'application/pdf' });
  const txt = textoRelatorio(pid, mes), wa = waLink(P.telefone, txt + '\n\n(O PDF vai anexo nesta conversa.)');
  const podeArquivo = !window.claude && navigator.canShare && navigator.canShare({ files: [arq] });
  sheet(`<h3>Enviar para ${esc(P.nome)}</h3>
    <div class="sub">Relatório de ${esc(C.nomeMes(mes))} · ${esc(nome)}</div>
    ${!numeroWa(P.telefone) ? `<div class="banner"><span>Cadastre o WhatsApp do(a) professor(a) para abrir a conversa direto.</span><button id="eedit">Cadastrar</button></div>` : ''}
    ${podeArquivo ? `<button class="btn wa-btn" id="eshare">${ICO_WA} Enviar PDF</button>
      <div class="note">Abre o compartilhar do celular com o PDF anexado. Escolha WhatsApp e ${esc(primeiro(P.nome))}.</div>`
      : `<div class="passos"><div class="passo"><span class="nump">1</span><div class="grow"><b>Salve o PDF</b><div class="s">Fica nos arquivos do celular ou do computador.</div></div><button class="btn" id="esave">Salvar</button></div>
        <div class="passo"><span class="nump">2</span><div class="grow"><b>Abra a conversa com ${esc(primeiro(P.nome))}</b><div class="s">O resumo já vai escrito. Toque no clipe 📎 → Documento e escolha o PDF.</div></div>${wa ? `<a class="btn wa-btn" href="${esc(wa)}" target="_blank" rel="noopener">${ICO_WA}</a>` : ''}</div></div>
      <div class="note">O WhatsApp não deixa um site anexar o arquivo sozinho numa conversa. No app publicado, no celular, este botão abre o compartilhar com o PDF já anexado.</div>`}
    <button class="btn ghost" data-fechar>Fechar</button>`, () => {
    if ($('eedit')) $('eedit').onclick = () => sheetProf(pid);
    if ($('esave')) $('esave').onclick = async () => { const r = await salvarArquivo(nome, bytes, 'application/pdf'); if (r !== 'cancelado') { aviso('PDF salvo. Agora abra a conversa.'); $('esave').textContent = 'Salvo ✓'; } };
    if ($('eshare')) $('eshare').onclick = async () => { try { await navigator.share({ files: [arq], title: nome, text: txt }); aviso('Relatório enviado'); fecharSheet(); } catch (e) { if (e.name !== 'AbortError') aviso('Não deu para compartilhar. Use Baixar PDF.'); } };
  });
}

/* ================= Caixa (administração) ================= */
const CAT_SAI = ['Professores e equipe', 'Aluguel do espaço', 'Material esportivo', 'Uniforme e figurino', 'Competições e inscrições', 'Viagens', 'Taxas da federação', 'Material e manutenção', 'Outros'];
const CAT_ENT = ['Patrocínio', 'Festival ou apresentação', 'Rifa ou evento', 'Venda de uniforme', 'Outros'];
function tCaixa(v) {
  const mes = S.mes; let mens = 0, ext = 0, pix = 0;
  // entradas pelo dia em que o dinheiro entrou
  Object.values(S.pags).forEach(p => {
    Object.values(p.mens || {}).forEach(x => { const q = C.stPag(x); if (q && String(q.d).slice(0, 7) === mes) { mens += Number(q.v) || 0; if (ONLINE(q.via)) pix += Number(q.v) || 0; } });
    Object.values(p.extras || {}).forEach(x => { const q = C.stPag(x); if (q && String(q.d).slice(0, 7) === mes) { ext += Number(q.v) || 0; if (ONLINE(q.via)) pix += Number(q.v) || 0; } });
  });
  const ls_ = Object.entries(S.lanc).filter(([, l]) => String(l.data).slice(0, 7) === mes).sort((a, b) => String(b[1].data).localeCompare(String(a[1].data)));
  const rec = ls_.filter(([, l]) => l.tipo === 'entrada').reduce((s, [, l]) => s + l.v, 0), sai = ls_.filter(([, l]) => l.tipo === 'saida').reduce((s, [, l]) => s + l.v, 0);
  const ent = mens + ext + rec, saldo = ent - sai;
  const porCat = {}; ls_.filter(([, l]) => l.tipo === 'saida').forEach(([, l]) => porCat[l.cat] = (porCat[l.cat] || 0) + l.v);
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]), maxC = cats.length ? cats[0][1] : 1;
  v.innerHTML = `<div class="hero">
      <div><div class="label">Saldo de ${esc(C.nomeMes(mes))}</div><div class="big num" style="color:${saldo < 0 ? 'var(--out)' : 'var(--ink)'}">${brl(saldo)}</div></div>
      <div class="legend">
        <div><span class="sw s-in"></span><span class="grow">Entradas<span class="s">mensalidades ${brl(mens)} · extras ${brl(ext)} · outras ${brl(rec)}</span></span><b class="num">${brl(ent)}</b></div>
        <div><span class="sw s-out"></span><span class="grow">Saídas</span><b class="num">${brl(sai)}</b></div>
      </div>
      <div class="sub num">${brl(pix)} entraram por Pix. Conta pelo dia em que o dinheiro entrou.</div>
    </div>
    <section><h2>Para onde foi o dinheiro</h2>${cats.length ? `<div class="bars">${cats.map(([c, x]) => `<div class="bar"><div class="row1"><span>${esc(c)}</span><b class="num">${brl(x)}</b></div><div class="track"><i class="late" style="width:${Math.max(3, x / maxC * 100)}%"></i></div></div>`).join('')}</div>` : '<div class="sub">Nenhuma saída registrada neste mês.</div>'}</section>
    <section><div class="headrow"><h2>Lançamentos</h2><button class="add" id="cnl">+ Lançamento</button></div>
      ${ls_.length ? `<ul class="list">${ls_.map(([id, l]) => `<li class="tap" data-l="${esc(id)}"><div class="grow"><div class="t">${esc(l.desc || l.cat)}</div><div class="s num">${dataBR(l.data)} · ${esc(l.cat)}${l.localId && S.locais[l.localId] ? ' · ' + esc(S.locais[l.localId].nome) : ''}</div></div><span class="amt num ${l.tipo === 'entrada' ? 'in' : 'out'}">${l.tipo === 'entrada' ? '+' : '−'} ${brl(l.v)}</span></li>`).join('')}</ul>`
        : `<div class="empty"><span>Registre aqui salários, aluguel, compra de aparelhos, inscrições em competições, patrocínios. Mensalidades e cobranças pagas entram sozinhas.</span></div>`}
    </section>`;
  $('cnl').onclick = () => sheetLanc();
  v.querySelectorAll('[data-l]').forEach(li => li.onclick = () => sheetLanc(li.dataset.l));
}
function sheetLanc(id) {
  const l = id ? S.lanc[id] : null; let tipo = l ? l.tipo : 'saida';
  const opts = (tp, sel) => (tp === 'entrada' ? CAT_ENT : CAT_SAI).map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
  sheet(`<h3>${l ? 'Editar lançamento' : 'Novo lançamento'}</h3>
    <div class="seg"><button type="button" data-t="saida" aria-pressed="${tipo === 'saida'}">Saída</button><button type="button" data-t="entrada" aria-pressed="${tipo === 'entrada'}">Entrada</button></div>
    <div class="field"><label for="lcat">Categoria</label><select id="lcat">${opts(tipo, l && l.cat)}</select></div>
    <div class="field"><label for="ldesc">Descrição</label><input id="ldesc" maxlength="100" value="${esc(l ? l.desc || '' : '')}" placeholder="Ex.: Salário do professor"></div>
    <div class="two"><div class="field"><label for="lval">Valor (R$)</label><input id="lval" inputmode="decimal" value="${esc(fmtValor(l && l.v))}" placeholder="0,00"></div>
    <div class="field"><label for="ldata">Data</label><input id="ldata" type="date" value="${esc(l ? l.data : (S.mes === mesHoje() ? hoje() : S.mes + '-01'))}"></div></div>
    <div class="field"><label for="lloc">Local (opcional)</label><select id="lloc"><option value="">Escola toda</option>${ordenar(S.locais).map(([lid, x]) => `<option value="${esc(lid)}" ${l && l.localId === lid ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></div>
    <div class="err" id="lerr2" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="lok2">Salvar</button></div>
    ${l ? `<button class="btn ghost" id="ldel" style="color:var(--out)">Excluir lançamento</button>` : ''}`, s => {
    s.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tipo = b.dataset.t; s.querySelectorAll('[data-t]').forEach(y => y.setAttribute('aria-pressed', y === b)); $('lcat').innerHTML = opts(tipo); });
    $('lok2').onclick = async () => {
      const v = parseValor($('lval').value), data = $('ldata').value;
      if (!(v > 0)) return $('lerr2').textContent = 'Informe um valor maior que zero, como 150,00.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return $('lerr2').textContent = 'Escolha a data.';
      $('lok2').disabled = true;
      try { await B.set(`escolas/${S.eid}/lancamentos/${id || novoId()}`, { tipo, cat: $('lcat').value, desc: $('ldesc').value.trim(), v, data, localId: $('lloc').value || null }); fecharSheet(); aviso('Lançamento salvo'); if (data.slice(0, 7) !== S.mes) { S.mes = data.slice(0, 7); render(); } }
      catch (e) { $('lerr2').textContent = msgErro(e); $('lok2').disabled = false; }
    };
    if ($('ldel')) $('ldel').onclick = () => confirmar('Excluir lançamento?', esc(l.desc || l.cat), 'Excluir', () => B.del(`escolas/${S.eid}/lancamentos/${id}`));
  });
}

/* ================= Área do responsável ================= */
async function vinculosServidor(acao, rid) {
  if (MOCK) {
    const st_ = window.__mock.store, p = `escolas/${S.eid}`, meus = Object.keys(S.resps);
    const minhasR = meus.map(r => st_.get(`${p}/responsaveis/${r}`)).filter(Boolean);
    const mem = st_.get(`${p}/membros/${EU.uid}`) || {}, recus = new Set(mem.recusados || []);
    const todos = [...st_.keys()].filter(k => k.startsWith(`${p}/responsaveis/`) && k.split('/').length === 4).map(k => [k.split('/').pop(), st_.get(k)]);
    if (acao === 'vincular') { await B.set(`${p}/membros/${EU.uid}/vinculos/${rid}`, { em: Date.now(), via: 'sugestao' }); return {}; }
    if (acao === 'recusar') { await B.set(`${p}/membros/${EU.uid}`, { recusados: [...recus, rid] }, { merge: true }); return {}; }
    return { sugestoes: todos.filter(([id, r]) => !meus.includes(id) && !recus.has(id) && minhasR.some(m => mesmoContato(m, r))).map(([id, r]) => ({ rid: id, responsavel: r.nome, alunas: [...st_.keys()].filter(k => k.startsWith(`${p}/alunas/`) && st_.get(k).responsavelId === id).map(k => primeiro(st_.get(k).nome)), por: C.telNorm(r.telefone) && minhasR.some(m => C.telNorm(m.telefone) === C.telNorm(r.telefone)) ? 'telefone' : 'CPF' })).filter(x => x.alunas.length) };
  }
  const t = await B.token().catch(() => null); if (!t) throw new Error('Entre na sua conta de novo.');
  const r = await fetch(URLF('vinculos'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ eid: S.eid, acao, rid }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Não deu certo agora.'); return j;
}
let sugT = null;
function buscarSugestoes() { clearTimeout(sugT); sugT = setTimeout(async () => { if (!S || S.papel !== 'f') return; try { const j = await vinculosServidor('sugestoes'); S.sug = j.sugestoes || []; agendar(); } catch (e) { } }, 400); }
function tPagar(v) {
  if (!S.carregado.has('alunas')) { v.innerHTML = `<div class="empty">Carregando…</div>`; return; }
  const h = hoje(), fimMes = `${mesHoje()}-31`, al = porNome(S.alunas);
  const porAl = al.map(([id, a]) => ({ id, a, it: itensDe(id) }));
  const abertos = porAl.flatMap(x => x.it.filter(i => !i.pago));
  // começa sem nada marcado: a mãe escolhe o que quer pagar agora
  if (!S.sel) S.sel = new Set();
  for (const k of [...S.sel]) if (!abertos.some(i => i.k === k)) S.sel.delete(k);
  const marcados = abertos.filter(i => S.sel.has(i.k)), totSel = C.r2(marcados.reduce((s, i) => s + i.v, 0));
  const totAb = C.r2(abertos.reduce((s, i) => s + i.v, 0)), totVenc = C.r2(abertos.filter(i => i.venc < h).reduce((s, i) => s + i.v, 0));
  const pixOk = !!S.cfg.mpConectadoEm;
  const pagos = porAl.flatMap(x => x.it.filter(i => i.pago)).sort((a, b) => String(b.pago.d || b.venc).localeCompare(String(a.pago.d || a.venc))).slice(0, 10);
  v.innerHTML = `
    ${avisoEventosFamilia()}${avisoTermos()}
    ${(S.sug || []).map(sg => `<div class="banner"><span>Encontramos <b>${esc(sg.alunas.join(', '))}</b> cadastrado(a)${sg.alunas.length > 1 ? 's' : ''} com o seu ${esc(sg.por)} (responsável: ${esc(sg.responsavel)}). ${sg.alunas.length > 1 ? 'São seus filhos' : 'É seu filho(a)'}?</span><span class="actions"><button data-vinc="${esc(sg.rid)}">Sim, juntar</button><button data-recusa="${esc(sg.rid)}" style="color:var(--muted)">Não</button></span></div>`).join('')}
    <div class="hero"><div class="headrow" style="align-items:flex-end"><div><div class="label">Em aberto</div><div class="big num">${brl(totAb)}</div></div>
      ${totVenc > 0 ? `<div style="text-align:right"><div class="label">Vencido</div><div class="num" style="font-weight:800;font-size:1.15rem;color:var(--out)">${brl(totVenc)}</div></div>` : ''}</div>
      <div class="sub">${abertos.length ? 'Escolha abaixo as cobranças que quer pagar agora. Pode ser de um filho(a) só ou de todos juntos.' : 'Tudo em dia. Obrigado!'}</div>
      ${abertos.some(i => i.venc < h) ? `<div class="actions"><button class="chip" id="pvenc">Marcar as vencidas</button>${marcados.length ? '<button class="chip" id="plimpa">Desmarcar tudo</button>' : ''}</div>` : marcados.length ? '<div class="actions"><button class="chip" id="plimpa">Desmarcar tudo</button></div>' : ''}</div>
    ${pixOk ? '' : `<div class="banner"><span>A escola ainda não ligou o pagamento por Pix no app. Fale com a administração.</span></div>`}
    ${porAl.filter(x => x.it.some(i => !i.pago)).map(({ id, a, it }) => { const ab = it.filter(i => !i.pago), todos = ab.every(i => S.sel.has(i.k)), sub = C.r2(ab.filter(i => S.sel.has(i.k)).reduce((s, i) => s + i.v, 0));
      return `<div class="month-card ${ab.some(i => i.venc < h) ? 'late' : ''}">
      <div class="headrow"><div><h2>${esc(a.nome)}</h2><div class="s">${esc(turmasTxt(a))}</div></div><button class="chip" data-tudo="${esc(id)}">${todos ? 'Desmarcar' : 'Marcar tudo'}</button></div>
      <div class="checks" style="max-height:none">${ab.map(i => `<label><input type="checkbox" data-k="${esc(i.k)}" ${S.sel.has(i.k) ? 'checked' : ''}><span class="grow"><span class="t" style="display:block">${esc(i.desc)}</span><span class="s">${esc(tipoItem(i))}</span><span class="s num">Vence ${dataBR(i.venc)}</span>${linhaEnc(i)}<span class="s">Para ${esc(Object.keys(i.partes || { escola: 1 }).map(nomeRec).join(' e '))}</span></span><span class="valor-col"><b class="num">${brl(i.v)}</b>${i.venc < h ? '<span class="chip vencido">Vencida</span>' : ''}</span></label>`).join('')}</div>
      <div class="item sub"><span>Marcado de ${esc(primeiro(a.nome))}</span><b class="num" style="color:var(--ink)">${brl(sub)}</b></div>
    </div>`; }).join('')}
    ${!abertos.length && !pagos.length ? `<div class="empty"><b>Nenhuma cobrança ainda.</b><span>Quando a escola cadastrar as turmas dos seus filhos, as cobranças aparecem aqui.</span></div>` : ''}
    ${pagos.length ? `<section><h2>Pagos recentemente</h2><ul class="list">${pagos.map(i => `<li><div class="grow"><div class="t">${esc(i.desc)}</div>${linhas(esc(primeiro(i.nome)), `<span class="num">${nomeVia(i.pago)}${i.pago.d ? ' em ' + dataBR(i.pago.d) : ''}</span>`)}</div>${valorCol(brl(i.v), '<span class="chip pago">Pago</span>', 'in')}</li>`).join('')}</ul></section>` : ''}
    ${abertos.length ? `<div class="paybar"><div class="grow"><div class="label">${marcados.length ? (() => { const n = dividirPorRecebedor(marcados).length; return `${marcados.length} ite${marcados.length === 1 ? 'm' : 'ns'}${n > 1 ? ` · ${n} Pix` : ''}`; })() : 'Escolha o que pagar'}</div><b class="num" style="font-size:1.25rem">${brl(totSel)}</b></div><button class="btn" id="ppagar" ${pixOk && totSel > 0 ? '' : 'disabled'}>${OUTRAS_FORMAS ? 'Pagar' : 'Pagar com Pix'}</button></div>` : ''}`;
  v.querySelectorAll('[data-k]').forEach(c => c.onchange = () => { c.checked ? S.sel.add(c.dataset.k) : S.sel.delete(c.dataset.k); render(); });
  v.querySelectorAll('[data-tudo]').forEach(b => b.onclick = () => { const ab = itensDe(b.dataset.tudo).filter(i => !i.pago), todos = ab.every(i => S.sel.has(i.k)); ab.forEach(i => todos ? S.sel.delete(i.k) : S.sel.add(i.k)); render(); });
  v.querySelectorAll('[data-vinc]').forEach(b => b.onclick = async () => { b.disabled = true; try { await vinculosServidor('vincular', b.dataset.vinc); S.sug = S.sug.filter(x => x.rid !== b.dataset.vinc); S.sel = null; aviso('Pronto! Agora você vê essas cobranças também.'); } catch (e) { aviso(msgErro(e)); b.disabled = false; } });
  v.querySelectorAll('[data-recusa]').forEach(b => b.onclick = async () => { try { await vinculosServidor('recusar', b.dataset.recusa); } catch (e) { } S.sug = S.sug.filter(x => x.rid !== b.dataset.recusa); render(); });
  v.querySelectorAll('[data-termo]').forEach(b => b.onclick = () => sheetTermo(b.dataset.termo));
  v.querySelectorAll('[data-atest]').forEach(b => b.onclick = () => sheetEnviarAtestado(b.dataset.atest));
  v.querySelectorAll('[data-irfilhos]').forEach(b => b.onclick = () => irPara('filhas'));
  if ($('ppagar')) $('ppagar').onclick = () => (OUTRAS_FORMAS ? sheetFormas : sheetPix)(marcados.map(i => i.k));
  if ($('pvenc')) $('pvenc').onclick = () => { abertos.filter(i => i.venc < h).forEach(i => S.sel.add(i.k)); render(); };
  if ($('plimpa')) $('plimpa').onclick = () => { S.sel.clear(); render(); };
}
function tFilhas(v) {
  const mes = mesHoje(), al = porNome(S.alunas);
  const linha = (rot, val) => val ? `<dt>${esc(rot)}</dt><dd>${val}</dd>` : '';
  const evs = eventosDoAno(), nComp = evs.filter(c => c.meu && fimDe(c.x) >= hoje()).length;
  v.innerHTML = `<h2>Meus filhos</h2>
    ${blocoEventosFamilia()}
    ${evs.length ? `<button class="faixa-resumo neutra" id="fcal"><span class="grow"><b>Calendário de eventos</b><span class="s">${nComp ? `${nComp} com seus filhos` : 'Ver os eventos da escola'}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>` : ''}
    ${al.length ? al.map(([id, a]) => { const ts = (a.turmas || []).map(t => S.turmas[t]).filter(Boolean), m = C.mensalidade(S.alunas, id, mes, S.turmas, S.cfg), gs = Object.values(S.grupos).filter(g => (g.alunas || []).includes(id)).map(g => g.nome);
      return `<div class="filha">
        <div class="filha-topo"><div class="dot">${esc(iniciais(a.nome))}</div><div class="grow"><div class="t" style="font-size:1.05rem">${esc(a.nome)}</div>${C.ativaNoMes(a, mes) ? '' : '<span class="chip">Inativo(a)</span>'}</div></div>
        <dl class="dl">
          ${linha('Nascimento', a.nascimento ? `${esc(dataBR(a.nascimento))}/${esc(a.nascimento.slice(0, 4))} <span class="sub">(${esc(idade(a.nascimento))})</span>` : '')}
          ${linha('Termo', (() => { const x = termoDe(id); const ult = ((x.t || {}).alteracoes || []).filter(m => (m.mudou || []).length).pop();
            return x.st === 'ok' ? `<span class="dd-col">${x.pend.length ? '<span class="chip">Mudança enviada · aguardando a escola</span>' : '<span class="chip pago">Assinado</span>'}${!x.pend.length && ult && ult.cienteEm ? `<span class="sub">Mudança de ${dataCurta(ult.em)} vista pela escola em ${dataCurta(ult.cienteEm)}</span>` : ''}<button type="button" class="link" data-vtermo="${esc(id)}">Ver termo</button></span>` : `<button type="button" class="chip vencido" data-termo="${esc(id)}">${x.st === 'vencido' ? 'Renovar' : 'Preencher'}</button>`; })())}
          ${(() => { const x = termoDe(id); if (x.st !== 'ok' || !x.as) return ''; const at = x.t.atestado || {};
            const rot = { ok: '<span class="chip pago">Conferido</span>', conferir: '<span class="chip">Aguardando a escola</span>', recusado: '<span class="chip vencido">Mandar outro</span>', falta: '<span class="chip vencido">Falta enviar</span>' }[x.as];
            return linha('Atestado', `<span class="dd-col">${rot}<button type="button" class="link" data-atest="${esc(id)}">${at.enviadoEm && x.as !== 'recusado' ? 'Ver atestado' : 'Enviar atestado'}</button></span>`); })()}
          ${linha('Grupos', gs.length ? gs.map(g => `<span class="chip">${esc(g)}</span>`).join(' ') : '')}
        </dl>
        ${ts.map(t => `<div class="filha-turma"><div class="label">Turma</div><div class="t">${esc(t.nome)}</div>
          <dl class="dl">${linha('Dias e horário', esc(t.horario || '—'))}${linha('Local', esc(localDe(t) || '—'))}${linha('Professor(a)', esc(profNome(t) || '—'))}${linha('Faixa etária', esc(C.faixaTxt(t)))}${linha('Valor', `<span class="num">${brl(t.preco)}</span> <span class="sub">por mês</span>`)}</dl></div>`).join('') || '<div class="sub">Sem turma</div>'}
        ${m ? `<div class="filha-turma">${contaMensalidade(m, a, 'Mensalidade de ' + C.nomeMes(mes))}</div>` : ''}
      </div>`; }).join('') : `<div class="empty">Nenhum aluno ligado à sua conta ainda. Fale com a escola.</div>`}
    <div class="note">Mensalidade vence todo dia ${Number(S.cfg.vencDia) || 10}. Descontos são combinados com a escola.${(S.cfg.atraso || {}).ativo ? ` Depois do vencimento: multa de ${String(S.cfg.atraso.multa).replace('.', ',')}% e juros de ${String(S.cfg.atraso.juros).replace('.', ',')}% ao mês.` : ''}</div>`;
  v.querySelectorAll('[data-termo]').forEach(b => b.onclick = () => sheetTermo(b.dataset.termo));
  v.querySelectorAll('[data-atest]').forEach(b => b.onclick = () => sheetEnviarAtestado(b.dataset.atest));
  v.querySelectorAll('[data-vtermo]').forEach(b => b.onclick = () => sheetVerTermo(b.dataset.vtermo));
  if ($('fcal')) $('fcal').onclick = () => sheetCalendario();
  ligarFotos(v);
  v.querySelectorAll('[data-fx]').forEach(b => b.onclick = async () => { b.disabled = true; try { await marcarPart(b.dataset.fx, b.dataset.fid, b.dataset.fst); const m = modoInsc(S.extras[b.dataset.fx]), f = b.dataset.fst;
    aviso(f === 'inscrito' ? 'Inscrição confirmada. A escola já está sabendo.' : f === 'nao' ? 'Resposta enviada' : m === 'app' ? 'Combinado! A inscrição já está na tela Pagar.' : m === 'familia' ? 'Combinado! Faça a inscrição com quem organiza e depois toque em "Já fiz a inscrição".' : 'Combinado! A escola vai cuidar da inscrição.'); } catch (e) { aviso(msgErro(e)); b.disabled = false; } });
}
/* ================= Calendário anual de eventos ================= */
const DIAS_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
// todos os eventos com data; para a família, "meu" = algum filho vai
function eventosDoAno(ano) {
  const minhas = new Set(Object.keys(S.alunas)), fam = S.papel === 'f';
  return Object.entries(S.extras).filter(([, x]) => ehEvento(x) && /^\d{4}-\d{2}-\d{2}$/.test(x.data || '') && (!ano || (x.data <= `${ano}-12-31` && fimDe(x) >= `${ano}-01-01`)))
    .map(([xid, x]) => { const alvo = convidadosDe(x), meus = fam ? alvo.filter(id => minhas.has(id) && (!eventoNovo(x) || ['interesse', 'inscrito'].includes(partDe(x, id)))) : alvo; return { xid, x, alvo, meus, meu: !fam || meus.length > 0 }; })
    .sort((a, b) => a.x.data.localeCompare(b.x.data));
}
function quemEvento(c, fam) {
  const x = c.x;
  if (fam) return c.meu ? c.meus.map(id => primeiro((S.alunas[id] || {}).nome) + (eventoNovo(x) ? (partDe(x, id) === 'inscrito' ? ' (inscrito)' : ' (quer ir)') : '')).join(', ') : '';
  if (!eventoNovo(x)) return `${c.alvo.length} atleta${c.alvo.length === 1 ? '' : 's'}`;
  const ins = c.alvo.filter(id => partDe(x, id) === 'inscrito').length, quer = c.alvo.filter(id => partDe(x, id) === 'interesse').length;
  return `${ins} inscrito${ins === 1 ? '' : 's'} · ${quer} quer${quer === 1 ? '' : 'em'} ir`;
}
const abrirEvento = xid => (eventoNovo(S.extras[xid]) ? sheetVerEvento : sheetExtra)(xid);
// mês em grade (como o calendário do celular): eventos de vários dias viram uma barra do começo ao fim
const fimDe = x => (x.dataFim && x.dataFim >= x.data) ? x.dataFim : x.data;
const isoDe = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function periodoTxt(x) {
  const a = x.data, b = fimDe(x), dia = d => Number(d.slice(8)), mes = d => C.MESES[Number(d.slice(5, 7)) - 1], cur = d => mes(d).slice(0, 3) + '.';
  if (a === b) return `${dia(a)} de ${mes(a)}`;
  return a.slice(0, 7) === b.slice(0, 7) ? `${dia(a)} a ${dia(b)} de ${mes(b)}` : `${dia(a)} de ${cur(a)} a ${dia(b)} de ${cur(b)}`;
}
// grade do mês (domingo a sábado); eventos de vários dias viram uma barra do começo ao fim
function gradeMes(ano, mes, L) {
  const h = hoje(), dia1 = new Date(ano, mes - 1, 1), dias = new Date(ano, mes, 0).getDate(), semanas = [];
  let d = new Date(ano, mes - 1, 1 - dia1.getDay());
  while (d <= new Date(ano, mes - 1, dias)) { const sem = []; for (let i = 0; i < 7; i++) { sem.push(new Date(d)); d.setDate(d.getDate() + 1); } semanas.push(sem); }
  const MAX = 3;
  const semanaHtml = sem => {
    const s0 = isoDe(sem[0]), s6 = isoDe(sem[6]);
    const ev = L.filter(c => c.x.data <= s6 && fimDe(c.x) >= s0).sort((a, b) => a.x.data.localeCompare(b.x.data) || fimDe(b.x).localeCompare(fimDe(a.x)));
    const pistas = [], barras = [], extra = Array(7).fill(0);
    for (const c of ev) {
      const a = Math.max(0, sem.findIndex(x => isoDe(x) >= c.x.data)), bIdx = sem.map(isoDe).filter(x => x <= fimDe(c.x)).length - 1;
      let p = pistas.findIndex(fimP => fimP < a); if (p < 0) { p = pistas.length; pistas.push(-1); } pistas[p] = bIdx;
      if (p >= MAX) { for (let i = a; i <= bIdx; i++) extra[i]++; continue; }
      const comeca = c.x.data >= s0, termina = fimDe(c.x) <= s6;
      barras.push(`<button type="button" class="mb-barra ${c.meu ? 'meu' : 'outro'} ${comeca ? 'ini' : ''} ${termina ? 'fim' : ''}" style="grid-column:${a + 1}/${bIdx + 2};grid-row:${p + 2}" data-ev="${esc(c.xid)}" aria-label="${esc(c.x.nome)}, ${esc(periodoTxt(c.x))}">${comeca || a === 0 ? `<span>${esc(c.x.nome)}</span>` : ''}</button>`);
    }
    const nums = sem.map((x, i) => { const iso = isoDe(x), fora = x.getMonth() !== mes - 1, fds = i === 0 || i === 6;
      return `<div class="mg-num ${fora ? 'fora' : ''} ${fds ? 'fds' : ''} ${iso === h ? 'hoje' : ''}" style="grid-column:${i + 1};grid-row:1"><span>${x.getDate()}</span></div>`; }).join('');
    const mais = extra.map((n, i) => n ? `<div class="mg-mais" style="grid-column:${i + 1};grid-row:${MAX + 2}">+${n}</div>` : '').join('');
    return `<div class="mg-sem" style="grid-template-rows:auto repeat(${Math.min(MAX, Math.max(1, pistas.length))}, 18px)${extra.some(Boolean) ? ' 14px' : ''}">${nums}${barras.join('')}${mais}</div>`;
  };
  return `<div class="mg"><div class="mg-cab">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((x, i) => `<span class="${i === 0 || i === 6 ? 'fds' : ''}">${x}</span>`).join('')}</div>${semanas.map(semanaHtml).join('')}</div>`;
}
const eventosDoMes = (ano, mes) => { const pm = `${ano}-${String(mes).padStart(2, '0')}`, ini = pm + '-01', fim = isoDe(new Date(ano, mes, 0)); return eventosDoAno().filter(c => c.x.data <= fim && fimDe(c.x) >= ini); };
function sheetMes(ano, mes) {
  const nomeM = C.MESES[mes - 1], fam = S.papel === 'f', L = eventosDoMes(ano, mes);
  const linha = c => { const quem = quemEvento(c, fam);
    return `<li class="cal-ev ${c.meu ? 'meu' : 'outro'}" data-ev="${esc(c.xid)}"><div class="grow"><div class="t">${esc(c.x.nome)}</div>${linhas(`<span class="num">${esc(periodoTxt(c.x))}</span>`, c.x.local ? esc(c.x.local) : '', quem ? esc(quem) : '')}</div></li>`; };
  sheet(`<div class="cal-topo"><button type="button" class="icon-btn" id="mgant" aria-label="Mês anterior">‹</button><h3>${nomeM[0].toUpperCase() + nomeM.slice(1)} de ${ano}</h3><button type="button" class="icon-btn" id="mgprox" aria-label="Próximo mês">›</button></div>
    ${gradeMes(ano, mes, L)}
    ${fam && L.length ? '<div class="mg-legenda"><span><i class="meu"></i>Seus filhos vão</span><span><i class="outro"></i>Outros eventos da escola</span></div>' : ''}
    ${L.length ? `<section><h2>Eventos do mês</h2><ul class="list">${L.map(linha).join('')}</ul></section>` : '<div class="empty"><span>Nenhum evento neste mês.</span></div>'}
    <div class="actions"><button type="button" class="btn ghost" id="mgano">Ver o ano</button>${!fam ? '<button type="button" class="btn" id="mgnovo">+ Lançar evento</button>' : '<button type="button" class="btn" data-fechar>Fechar</button>'}</div>
    ${!fam ? '<button type="button" class="btn ghost" data-fechar>Fechar</button>' : ''}`, sh => {
    const vai = n => { let a = ano, m = mes + n; if (m < 1) { m = 12; a--; } if (m > 12) { m = 1; a++; } sheetMes(a, m); };
    $('mgant').onclick = () => vai(-1); $('mgprox').onclick = () => vai(1);
    $('mgano').onclick = () => sheetCalendario(ano);
    if ($('mgnovo')) $('mgnovo').onclick = () => abrirDe(() => sheetMes(ano, mes), () => sheetExtra(null, { tipo: 'evento' }));
    // tocar na barra: mostra o evento na lista (e, para a escola, abre para editar)
    sh.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => {
      if (S.admin || S.prof) return abrirDe(() => sheetMes(ano, mes), () => abrirEvento(b.dataset.ev));
      const li = sh.querySelector(`li[data-ev="${CSS.escape(b.dataset.ev)}"]`); if (li) { li.scrollIntoView({ block: 'center', behavior: 'smooth' }); li.classList.remove('pisca'); void li.offsetWidth; li.classList.add('pisca'); }
    });
    // arrastar para o lado troca o mês
    let x0 = null; const g = sh.querySelector('.mg');
    g.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    g.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) vai(dx < 0 ? 1 : -1); });
  });
}
function sheetCalendario(ano) {
  ano = ano || Number(hoje().slice(0, 4));
  const L = eventosDoAno(ano), h = hoje(), fam = S.papel === 'f', porMes = {}, nMeus = L.filter(c => c.meu).length;
  L.forEach(c => { for (let m = 1; m <= 12; m++) { const pm = `${ano}-${String(m).padStart(2, '0')}`; if (c.x.data <= pm + '-31' && fimDe(c.x) >= pm + '-01') (porMes[m] = porMes[m] || []).push(c); } });
  const mesAtual = h.startsWith(String(ano)) ? Number(h.slice(5, 7)) : 0;
  const nomeM = m => { const n = C.MESES[m - 1]; return n[0].toUpperCase() + n.slice(1); };
  const linha = c => { const d = new Date(c.x.data + 'T12:00'), ed = S.admin || S.prof;
    const quem = quemEvento(c, fam);
    return `<li class="cal-ev ${c.meu ? 'meu' : 'outro'} ${ed ? 'tap' : ''}" ${ed ? `data-cx="${esc(c.xid)}"` : ''}><div class="cal-dia"><b class="num">${d.getDate()}</b><span>${DIAS_SEM[d.getDay()]}</span></div>
      <div class="grow"><div class="t">${esc(c.x.nome)}</div>${linhas(fimDe(c.x) !== c.x.data ? `<span class="num">${esc(periodoTxt(c.x))}</span>` : '', c.x.local ? esc(c.x.local) : '', quem ? esc(quem) : '')}</div></li>`; };
  sheet(`<div class="cal-topo"><button type="button" class="icon-btn" id="calant" aria-label="Ano anterior">‹</button><h3>Eventos de ${ano}</h3><button type="button" class="icon-btn" id="calprox" aria-label="Próximo ano">›</button></div>
    <div class="sub">${!L.length ? 'Nenhum evento neste ano.' : fam ? `${L.length} evento${L.length === 1 ? '' : 's'} da escola no ano${nMeus ? `; em destaque, ${nMeus === 1 ? 'o que seus filhos vão' : `os ${nMeus} que seus filhos vão`}` : ''}.` : `${L.length} evento${L.length === 1 ? '' : 's'} no ano. A data entra quando você lança uma cobrança do tipo evento.`}</div>
    <div class="cal-grade">${C.MESES.map((_, i) => { const m = i + 1, l = porMes[m] || [], meus = l.filter(c => c.meu).length; return `<button type="button" class="cal-mes ${meus ? 'tem' : l.length ? 'outros' : ''} ${m === mesAtual ? 'atual' : ''}" data-cm="${m}"><span>${nomeM(m).slice(0, 3)}</span><b class="num">${l.length || '·'}</b></button>`; }).join('')}</div>
    ${Object.keys(porMes).map(Number).sort((a, b) => a - b).map(m => `<section id="calm${m}"><h2>${nomeM(m)}</h2><ul class="list">${porMes[m].map(linha).join('')}</ul></section>`).join('')}
    ${!fam ? '<button type="button" class="btn ghost" id="calnova">+ Lançar evento</button>' : ''}
    <button class="btn ghost" data-fechar>Fechar</button>`, sh => {
    $('calant').onclick = () => sheetCalendario(ano - 1); $('calprox').onclick = () => sheetCalendario(ano + 1);
    sh.querySelectorAll('[data-cm]').forEach(b => b.onclick = () => sheetMes(ano, Number(b.dataset.cm)));
    sh.querySelectorAll('[data-cx]').forEach(li => li.onclick = () => abrirDe(() => sheetCalendario(ano), () => abrirEvento(li.dataset.cx)));
    if ($('calnova')) $('calnova').onclick = () => abrirDe(() => sheetCalendario(ano), () => sheetExtra(null, { tipo: 'evento' }));
  });
}


/* ================= Termo de matrícula: saúde, emergência, primeiros socorros e imagem ================= */
const VERSAO_TERMO_MAT = 1;
const PERGUNTAS_SAUDE = [
  ['coracao', 'Algum médico já disse que a criança tem problema no coração ou que só deve fazer atividade física com orientação médica?'],
  ['esforco', 'Ela sente dor no peito, falta de ar fora do normal ou cansaço exagerado quando faz esforço?'],
  ['desmaio', 'Já desmaiou ou teve tontura forte durante ou depois de exercício?'],
  ['doenca', 'Tem asma, bronquite, epilepsia (convulsão), diabetes ou outra doença que precise de cuidado durante a atividade?'],
  ['ossos', 'Tem problema nos ossos, articulações ou coluna que possa piorar com exercício, ou se machucou nos últimos 6 meses?'],
  ['outro', 'Existe alguma outra razão de saúde para a criança não fazer atividade física?']];
// situação do termo de um aluno: falta, vencido (mais de 1 ano), ok; e se precisa de atestado
function termoDe(alid) {
  const t = S.saude[alid]; if (!t || !t.em) return { st: 'falta' };
  const venc = Date.now() - t.em > 365 * 864e5, sim = PERGUNTAS_SAUDE.some(([k]) => (t.respostas || {})[k]);
  const as = situacaoAtestado(t, sim), atest = !!as && as !== 'ok';
  const pend = (t.alteracoes || []).filter(m => (m.mudou || []).length && !m.cienteEm);
  return { st: venc ? 'vencido' : 'ok', t, sim, as, atest, pend };
}
const ROT_TERMO = { falta: 'Termo de matrícula não preenchido', vencido: 'Termo de matrícula vencido (mais de 1 ano)', ok: 'Termo de matrícula assinado' };
function sheetTermo(alid) {
  const a = S.alunas[alid] || {}, t = S.saude[alid] || {}, r = t.respostas || {}, em = t.emergencia || {}, resp = respDe(alid);
  const modo = !t.em ? 'novo' : Date.now() - t.em > ANO_MS ? 'renovar' : 'mudar';
  const simNao = (k, txt) => `<div class="pq"><div class="pq-t">${esc(txt)}</div><div class="seg pq-seg"><button type="button" data-q="${k}" data-v="0" aria-pressed="${r[k] === false}">Não</button><button type="button" data-q="${k}" data-v="1" aria-pressed="${r[k] === true}">Sim</button></div></div>`;
  sheet(`<h3>${modo === 'mudar' ? 'Informar mudança' : modo === 'renovar' ? 'Renovar o termo' : 'Termo de matrícula'}</h3>
    <div class="sub">${esc(a.nome || '')} · ${esc(S.escola.nome || 'Escola')}. ${modo === 'mudar' ? 'Mude só o que mudou e assine de novo.' : 'Leva uns 3 minutos.'} Só a escola vê estas informações.</div>
    ${modo !== 'novo' ? '<div class="aviso-lei"><b>A escola é avisada</b><span>A escola recebe um aviso mostrando o que mudou. As informações anteriores ficam guardadas, com a data de cada mudança.</span></div>' : ''}
    <section><h2>1. Saúde</h2><div class="sub">Responda pensando nos últimos 12 meses.</div>
      ${PERGUNTAS_SAUDE.map(([k, q]) => simNao(k, q)).join('')}
      <div class="field" id="tsimw" hidden><label for="tsim">Conte um pouco sobre o que marcou "sim"</label><textarea id="tsim" class="msg-edit" rows="3" style="min-height:80px">${esc(t.detalhes || '')}</textarea>
        <div class="aviso-lei"><b>Atestado médico</b><span>Com alguma resposta "sim", a escola vai pedir um atestado médico dizendo que a criança pode fazer a atividade.</span></div></div></section>
    <section><h2>2. Para a escola saber</h2>
      <div class="field"><label for="talerg">Alergias</label><input id="talerg" maxlength="200" value="${esc(t.alergias || '')}" placeholder="Ex.: dipirona, amendoim. Deixe em branco se não tiver"></div>
      <div class="field"><label for="tremed">Remédios de uso contínuo</label><input id="tremed" maxlength="200" value="${esc(t.remedios || '')}" placeholder="Nome e horário, se tiver"></div>
      <div class="field"><label for="tplano">Plano de saúde (opcional)</label><input id="tplano" maxlength="100" value="${esc(t.plano || '')}" placeholder="Nome do plano e número da carteirinha"></div>
      <div class="label" style="margin-top:4px">Contato de emergência</div>
      <div class="field"><label for="tenome">Nome</label><input id="tenome" maxlength="60" value="${esc(em.nome || resp.nome || '')}"></div>
      <div class="two"><div class="field"><label for="tetel">Telefone</label><input id="tetel" inputmode="tel" maxlength="20" value="${esc(em.telefone || resp.telefone || '')}"></div>
      <div class="field"><label for="teparen">Parentesco</label><input id="teparen" maxlength="30" value="${esc(em.parentesco || '')}" placeholder="Ex.: mãe, avó"></div></div></section>
    <section><h2>3. Primeiros socorros</h2>
      <label class="check aceite"><input type="checkbox" id="tsocorro" ${t.primeirosSocorros ? 'checked' : ''}><span>Autorizo a escola a prestar os primeiros socorros e, em caso de emergência, levar a criança ao atendimento médico mais próximo, avisando o contato de emergência o quanto antes.</span></label></section>
    <section><h2>4. Uso de imagem</h2><div class="sub">Fotos e vídeos de aulas, apresentações e competições nas redes e materiais da escola. É opcional e não muda nada na matrícula.</div>
      <div class="seg"><button type="button" data-img="1" aria-pressed="${t.imagem === true}">Autorizo</button><button type="button" data-img="0" aria-pressed="${t.imagem === false}">Não autorizo</button></div></section>
    <section><h2>5. Declaração</h2>
      <label class="check aceite"><input type="checkbox" id="tsens"><span>Autorizo a escola a guardar estas informações de saúde da criança, que só a administração e o(a) professor(a) da turma podem ver, conforme a <button type="button" class="link" data-doc="privacidade">Política de privacidade</button>.</span></label>
      <label class="check aceite"><input type="checkbox" id="tverd"><span>Sou pai, mãe ou responsável legal. As informações são verdadeiras, e vou avisar a escola se a saúde da criança mudar.</span></label>
      <div class="field"><label for="tassin">Seu nome completo (assinatura)</label><input id="tassin" maxlength="80" value="${esc(EU.nome || '')}" autocomplete="name"></div></section>
    <div class="note">Rascunho para revisão jurídica. O termo vale por 1 ano; o app avisa quando for a hora de renovar.</div>
    <div class="err" id="terr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Depois</button><button type="button" class="btn" id="tok">${modo === 'mudar' ? 'Enviar mudança' : modo === 'renovar' ? 'Renovar termo' : 'Assinar termo'}</button></div>`, sh => {
    const resp_ = { ...r }; let img = t.imagem ?? null;
    const ver = () => { sh.querySelectorAll('[data-q]').forEach(b => b.setAttribute('aria-pressed', resp_[b.dataset.q] === (b.dataset.v === '1'))); $('tsimw').hidden = !PERGUNTAS_SAUDE.some(([k]) => resp_[k] === true);
      sh.querySelectorAll('[data-img]').forEach(b => b.setAttribute('aria-pressed', img === (b.dataset.img === '1'))); };
    sh.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { resp_[b.dataset.q] = b.dataset.v === '1'; ver(); });
    sh.querySelectorAll('[data-img]').forEach(b => b.onclick = () => { img = b.dataset.img === '1'; ver(); }); ver();
    $('tok').onclick = async () => {
      const err = m => { $('terr').textContent = m; $('terr').scrollIntoView({ block: 'center', behavior: 'smooth' }); };
      const falta = PERGUNTAS_SAUDE.filter(([k]) => typeof resp_[k] !== 'boolean'); if (falta.length) return err(`Responda todas as perguntas de saúde (falta${falta.length > 1 ? 'm' : ''} ${falta.length}).`);
      const sim = PERGUNTAS_SAUDE.some(([k]) => resp_[k]); if (sim && !$('tsim').value.trim()) return err('Conte um pouco sobre o que marcou "sim".');
      if (!$('tenome').value.trim() || C.soDigitos($('tetel').value).length < 10) return err('Informe o nome e o telefone (com DDD) do contato de emergência.');
      if (!$('tsocorro').checked) return err('Para a criança participar das aulas, é preciso autorizar os primeiros socorros.');
      if (img === null) return err('Escolha se autoriza ou não o uso de imagem.');
      if (!$('tsens').checked || !$('tverd').checked) return err('Marque as duas declarações do item 5.');
      if ($('tassin').value.trim().split(/\s+/).length < 2) return err('Digite seu nome completo para assinar.');
      $('tok').disabled = true;
      const d = { responsavelId: a.responsavelId || null, respostas: resp_, detalhes: sim ? $('tsim').value.trim() : '', alergias: $('talerg').value.trim(), remedios: $('tremed').value.trim(), plano: $('tplano').value.trim(),
        emergencia: { nome: $('tenome').value.trim(), telefone: $('tetel').value.trim(), parentesco: $('teparen').value.trim() }, primeirosSocorros: true, imagem: img,
        assinatura: { nome: $('tassin').value.trim(), uid: EU.uid, email: EU.email || '' }, em: Date.now(), versao: VERSAO_TERMO_MAT, atestado: (() => { const ant = t.atestado; if (ant && (ant.enviadoEm || ant.recebidoEm)) return sim && !ant.pedidoEm ? { ...ant, pedidoEm: Date.now() } : ant; return sim ? { pedidoEm: Date.now() } : null; })() };
      // nada se perde: a versão anterior vai para o histórico, com o que mudou; a escola precisa tocar em "Ciente"
      const alts = [...(t.alteracoes || [])];
      if (t.em) {
        const mudou = difTermo(t, d), simNovo = PERGUNTAS_SAUDE.some(([k]) => resp_[k] && !(t.respostas || {})[k]);
        if (modo === 'mudar' && !mudou.length) { $('tok').disabled = false; return err('Nada mudou. Mude o que for preciso antes de enviar.'); }
        const { alteracoes, atestado, ...anterior } = t;
        alts.push({ em: d.em, tipo: modo, assinatura: { nome: d.assinatura.nome }, mudou, anterior, ...(mudou.length ? {} : { cienteEm: d.em, cienteNome: 'sem mudanças' }) });
        if (simNovo) d.atestado = { pedidoEm: Date.now() }; // problema novo de saúde: pede atestado novo
      }
      d.alteracoes = alts;
      try { await B.set(`escolas/${S.eid}/saude/${alid}`, d); fecharSheet(); S.saude[alid] = d;
        const as = situacaoAtestado(d, sim);
        if (as === 'falta' || as === 'recusado') setTimeout(() => sheetEnviarAtestado(alid, { depoisTermo: true }), 80);
        else aviso(modo === 'mudar' ? 'Mudança enviada. A escola foi avisada.' : modo === 'renovar' ? 'Termo renovado. Obrigado!' : 'Termo assinado. Obrigado!'); }
      catch (e) { err(msgErro(e)); $('tok').disabled = false; }
    };
  });
}
// mudanças no termo: o que mudou entre duas versões, em linguagem simples
const ROT_SAUDE = { coracao: 'Problema no coração', esforco: 'Dor ou falta de ar no esforço', desmaio: 'Desmaio ou tontura no exercício', doenca: 'Doença que precisa de cuidado', ossos: 'Ossos, articulações ou coluna', outro: 'Outra razão de saúde' };
function camposTermo(t) {
  const r = t.respostas || {}, e = t.emergencia || {};
  return [...PERGUNTAS_SAUDE.map(([k]) => [ROT_SAUDE[k], r[k] ? 'Sim' : 'Não']), ['Detalhes de saúde', t.detalhes || ''], ['Alergias', t.alergias || ''], ['Remédios', t.remedios || ''], ['Plano de saúde', t.plano || ''],
    ['Contato de emergência', e.nome || ''], ['Telefone de emergência', e.telefone || ''], ['Parentesco', e.parentesco || ''], ['Uso de imagem', t.imagem ? 'Autorizado' : 'Não autorizado']];
}
function difTermo(antes, depois) {
  const a = Object.fromEntries(camposTermo(antes));
  return camposTermo(depois).filter(([k, v]) => String(a[k] ?? '').trim() !== String(v).trim()).map(([k, v]) => ({ campo: k, antes: a[k] || '', depois: v }));
}
const horaCurta = ms => { const d = new Date(ms); return `${dataCurta(ms)} às ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`; };
// o banco não aceita lista dentro de lista: cada mudança é { campo, antes, depois } (lê também o formato antigo)
const itensMudou = mudou => (mudou || []).map(x => Array.isArray(x) ? x : [x.campo, x.antes, x.depois]);
const listaMudou = mudou => `<ul class="mud-lista">${itensMudou(mudou).map(([k, a, d]) => `<li><span class="mud-rot">${esc(k)}</span><span class="mud-val"><s>${esc(a || 'nada')}</s><span aria-hidden="true">→</span><b>${esc(d || 'nada')}</b></span></li>`).join('')}</ul>`;
// corpo do termo (o mesmo para a escola e para a família); "marcar" destaca o que mudou e ainda não foi visto
function corpoTermo(t, marcar = new Set()) {
  const m = (rot, html) => marcar.has(rot) ? `<mark class="mudou">${html}</mark>` : html;
  const sn = (k, v) => m(ROT_SAUDE[k], v ? '<b style="color:var(--out)">Sim</b>' : 'Não'), e = t.emergencia || {};
  const emerg = ['Contato de emergência', 'Telefone de emergência', 'Parentesco'].some(k => marcar.has(k));
  return `<section><h2>Saúde</h2><dl class="dl dl-largo">${PERGUNTAS_SAUDE.map(([k, q]) => `<dt>${esc(q)}</dt><dd>${sn(k, (t.respostas || {})[k])}</dd>`).join('')}</dl>${t.detalhes ? `<div class="note"><b>Detalhes:</b> ${m('Detalhes de saúde', esc(t.detalhes))}</div>` : ''}</section>
    <section><h2>Para a escola saber</h2>${ddl([['Alergias', m('Alergias', esc(t.alergias || 'Nenhuma'))], ['Remédios', m('Remédios', esc(t.remedios || 'Nenhum'))], ['Plano de saúde', m('Plano de saúde', esc(t.plano || '—'))],
      ['Emergência', (emerg ? s => `<mark class="mudou">${s}</mark>` : s => s)(`${esc(e.nome || '')}${e.parentesco ? ' (' + esc(e.parentesco) + ')' : ''}<br><span class="num">${esc(e.telefone || '')}</span>`)]])}</section>
    <section><h2>Autorizações</h2>${ddl([['Primeiros socorros', 'Autorizado'], ['Uso de imagem', m('Uso de imagem', t.imagem ? 'Autorizado' : '<b style="color:var(--out)">Não autorizado</b>')]])}</section>`;
}
// leitura do termo: a escola vê o que mudou, dá ciente e vê o histórico; a família vê o termo e pode informar uma mudança
function sheetVerTermo(alid) {
  const a = S.alunas[alid] || {}, x = termoDe(alid), t = x.t, adm = !!S.admin; if (!t) return;
  const alts = t.alteracoes || [], pend = x.pend || [], marcar = new Set(adm ? pend.flatMap(p => itensMudou(p.mudou).map(([k]) => k)) : []);
  const ult = alts.filter(m => (m.mudou || []).length).pop();
  sheet(`<h3>Termo de ${esc(primeiro(a.nome))}</h3>
    <div class="sub">${alts.length ? 'Última versão assinada' : 'Assinado'} por ${esc(t.assinatura.nome)} em ${horaCurta(t.em)}${x.st === 'vencido' ? ' · <b style="color:var(--out)">vencido, ' + (adm ? 'pedir renovação' : 'precisa renovar') + '</b>' : ''}</div>
    ${adm && pend.length ? `<div class="mud-alerta"><b>O termo mudou</b>
      ${pend.map(p => `<div class="mud-item"><span class="sub">${p.tipo === 'renovar' ? 'Renovado' : 'Mudado'} por ${esc(p.assinatura.nome)} em ${horaCurta(p.em)}</span>${listaMudou(p.mudou)}</div>`).join('')}
      <span class="sub">O que mudou está marcado no termo abaixo. Basta uma pessoa da administração tocar em "Ciente": fica registrado quem viu, a data e a hora, e o aviso some para todas.</span>
      <button type="button" class="btn" id="vtciente">Ciente</button></div>` : ''}
    ${!adm && ult ? `<div class="aviso-lei ${ult.cienteEm ? 'ok' : ''}"><b>${ult.cienteEm ? 'Escola ciente' : 'Aguardando a escola'}</b><span>Mudança enviada em ${horaCurta(ult.em)}${ult.cienteEm ? `, vista pela escola em ${horaCurta(ult.cienteEm)}` : '. A escola já recebeu o aviso.'}</span></div>` : ''}
    ${adm ? blocoAtestadoAdm(alid, x) : ''}
    ${corpoTermo(t, marcar)}
    ${adm && alts.length ? `<details class="historico"><summary><span class="grow"><b>Histórico de mudanças</b><span class="s">${alts.length} mudança${alts.length === 1 ? '' : 's'} desde a primeira assinatura</span></span><span class="seta" aria-hidden="true">▾</span></summary>
      <div class="hist-corpo">${alts.slice().reverse().map(m => `<div class="mud-item"><b>${m.tipo === 'renovar' ? 'Renovação' : 'Mudança'} em ${horaCurta(m.em)}</b><span class="sub">Assinado por ${esc(m.assinatura.nome)}</span>
        ${(m.mudou || []).length ? listaMudou(m.mudou) : '<span class="sub">Renovado sem mudanças.</span>'}
        <span class="sub">${m.cienteEm ? ((m.mudou || []).length ? `Escola ciente em ${horaCurta(m.cienteEm)} (${esc(m.cienteNome || 'administração')})` : '') : '<b style="color:var(--out)">Aguardando ciência da escola</b>'}</span>
        <details class="antes"><summary>Ver como estava antes</summary><div class="sub">Versão assinada por ${esc((m.anterior.assinatura || {}).nome || '')} em ${horaCurta(m.anterior.em)}</div>${corpoTermo(m.anterior)}</details></div>`).join('')}</div></details>` : ''}
    ${adm ? '<button class="btn ghost" data-fechar>Fechar</button>' : `<div class="note">Se algo mudou na saúde de ${esc(primeiro(a.nome))} (alergia, remédio, contato de emergência) ou se quiser mudar a autorização de imagem, informe aqui. A escola é avisada e a versão anterior fica guardada.</div>
      <div class="actions"><button type="button" class="btn ghost" data-fechar>Fechar</button><button type="button" class="btn" id="vtmudar">${x.st === 'vencido' ? 'Renovar termo' : 'Informar mudança'}</button></div>`}`, () => {
    if (adm) ligarAtestadoAdm(alid, () => sheetVerTermo(alid));
    if (adm && t.vistoAdm !== t.em) B.set(`escolas/${S.eid}/saude/${alid}`, { vistoAdm: t.em }, { merge: true }).catch(() => { });
    if ($('vtmudar')) $('vtmudar').onclick = () => sheetTermo(alid);
    if ($('vtciente')) $('vtciente').onclick = async () => {
      $('vtciente').disabled = true; const agora = Date.now();
      const novas = alts.map(m => (m.mudou || []).length && !m.cienteEm ? { ...m, cienteEm: agora, cientePor: EU.uid, cienteNome: EU.nome || 'Administração' } : m);
      try { await B.set(`escolas/${S.eid}/saude/${alid}`, { alteracoes: novas }, { merge: true }); aviso('Ciente registrado'); setTimeout(() => sheetVerTermo(alid), 60); }
      catch (e) { aviso(msgErro(e)); $('vtciente').disabled = false; }
    };
  });
}
// administração: aviso forte no topo de Cobranças enquanto ninguém deu ciente
// termo assinado (ou renovado) que a administração ainda não abriu
const termoNovo = id => { const t = S.saude[id]; return !!(t && t.em && t.vistoAdm !== t.em); };
// cartão do termo na ficha do aluno: em destaque, com o que importa de saúde à vista
function cartaoTermo(alid) {
  const x = termoDe(alid), t = x.t, r = (t && t.respostas) || {}, wa = (() => { const rr = respDe(alid); return waLink(rr.telefone, `Olá, ${primeiro(rr.nome) || 'tudo bem'}! Aqui é da ${S.escola.nome || 'escola'}. Falta preencher o termo de matrícula de ${primeiro((S.alunas[alid] || {}).nome)} (saúde, contato de emergência e autorizações). Leva uns 3 minutos, pelo app: ${LINK_APP}`); })();
  if (!t) return `<div class="termo-card aviso"><div class="tc-cab"><span class="tc-ic" aria-hidden="true">!</span><span class="grow"><b>Termo de matrícula não assinado</b><span class="s">Saúde, contato de emergência e autorizações. O responsável preenche pelo app.</span></span></div>
    ${wa ? `<div class="at-botoes"><a class="btn btn-mini" href="${esc(wa)}" target="_blank" rel="noopener">Pedir pelo WhatsApp</a></div>` : ''}</div>`;
  const pend = x.pend || [], campos = [...new Set(pend.flatMap(p => itensMudou(p.mudou).map(([k]) => k)))];
  const sims = PERGUNTAS_SAUDE.filter(([k]) => r[k]).map(([k]) => ROT_SAUDE[k]);
  const destaque = [...sims.map(n => ['Saúde', n]), t.alergias ? ['Alergia', t.alergias] : null, t.remedios ? ['Remédio', t.remedios] : null, t.imagem === false ? ['Imagem', 'não autoriza uso de imagem'] : null].filter(Boolean);
  const tipo = pend.length ? 'alerta' : x.st === 'vencido' || x.atest ? 'aviso' : 'ok';
  const titulo = pend.length ? 'O termo de saúde mudou' : x.st === 'vencido' ? 'Termo de matrícula vencido' : x.as === 'conferir' ? 'Termo assinado · atestado para conferir' : x.atest ? 'Termo assinado · falta atestado médico' : 'Termo de matrícula assinado';
  const sub = pend.length ? `${esc(campos.slice(0, 4).join(', '))}${campos.length > 4 ? ' e mais' : ''} · ${horaCurta(pend.at(-1).em)}. Veja o que mudou e toque em "Ciente".`
    : `Por ${esc(t.assinatura.nome)} em ${horaCurta(t.em)}`;
  return `<div class="termo-card ${tipo}"><div class="tc-cab"><span class="tc-ic" aria-hidden="true">${tipo === 'ok' ? '✓' : '!'}</span><span class="grow"><b>${titulo}</b><span class="s">${sub}</span></span>${termoNovo(alid) && !pend.length ? '<span class="chip pago">Novo</span>' : ''}</div>
    ${destaque.length ? `<ul class="tc-lista">${destaque.map(([k, v]) => `<li><span>${esc(k)}</span><b>${esc(v)}</b></li>`).join('')}</ul>` : '<div class="tc-nada">Nenhum problema de saúde, alergia ou remédio informado.</div>'}
    <div class="at-botoes"><button type="button" class="btn ${tipo === 'alerta' ? '' : 'ghost'} btn-mini" id="avtermo">${pend.length ? 'Ver o que mudou' : 'Ver termo completo'}</button></div></div>`;
}
function avisoMudancasTermo() {
  if (!S.admin) return '';
  const novos = porNome(S.alunas).filter(([id, a]) => !a.anonimizadoEm && termoNovo(id) && !(termoDe(id).pend || []).length);
  const faixaNovos = novos.length ? `<button class="faixa-resumo ok" data-vmud="${esc(novos[0][0])}"><span class="grow"><b>${novos.length === 1 ? `Termo de matrícula assinado: ${esc(primeiro(novos[0][1].nome))}` : `${novos.length} termos de matrícula assinados`}</b><span class="s">${novos.length === 1 ? 'Toque para ver as informações de saúde.' : esc(novos.map(([, a]) => primeiro(a.nome)).join(', ')) + '. Toque para ver o primeiro.'}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>` : '';
  return faixaNovos + 
porNome(S.alunas).map(([id, a]) => ({ id, a, x: termoDe(id) })).filter(r => r.x.pend && r.x.pend.length).map(({ id, a, x }) => {
    const campos = [...new Set(x.pend.flatMap(p => itensMudou(p.mudou).map(([k]) => k)))];
    return `<button class="faixa-resumo alerta" data-vmud="${esc(id)}"><span class="grow"><b>O termo de ${esc(primeiro(a.nome))} mudou</b><span class="s">${esc(campos.slice(0, 3).join(', '))}${campos.length > 3 ? ` e mais ${campos.length - 3}` : ''} · ${dataCurta(x.pend.at(-1).em)}. Toque para ver e dar ciente.</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`;
  }).join('');
}
// aviso para a família: termo a preencher
function avisoTermos() {
  const pend = porNome(S.alunas).filter(([id, a]) => !a.anonimizadoEm && termoDe(id).st !== 'ok');
  const atest = porNome(S.alunas).filter(([id, a]) => !a.anonimizadoEm && termoDe(id).st === 'ok' && ['falta', 'recusado'].includes(termoDe(id).as));
  return pend.map(([id, a]) => `<button class="faixa-resumo" data-termo="${esc(id)}"><span class="grow"><b>${termoDe(id).st === 'vencido' ? 'Renovar' : 'Preencher'} o termo de matrícula de ${esc(primeiro(a.nome))}</b><span class="s">Saúde, contato de emergência e autorizações. Leva uns 3 minutos.</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`).join('')
    + atest.map(([id, a]) => { const r = ((termoDe(id).t || {}).atestado || {}).recusa; return `<button class="faixa-resumo" data-atest="${esc(id)}"><span class="grow"><b>${r ? 'Mandar outro atestado' : 'Enviar o atestado médico'} de ${esc(primeiro(a.nome))}</b><span class="s">${r ? 'A escola pediu outro: ' + esc(r.motivo) : 'Uma foto do atestado dizendo que pode fazer a atividade. Fica guardado no app.'}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`; }).join('');
}

/* ================= Atestado médico ================= */
// O arquivo fica em escolas/{eid}/atestados/{alid} (foto reduzida ou PDF pequeno); o termo guarda só a situação.
// Situação: null (não precisa), falta, recusado (a escola pediu outro), conferir (enviado, a escola ainda não viu), ok.
const ATEST_MAX_IMG = 380 * 1024, ATEST_MAX_PDF = 650 * 1024, ANO_MS = 365 * 864e5;
function situacaoAtestado(t, sim) {
  const at = (t && t.atestado) || {}, novo = x => x && Date.now() - x < ANO_MS;
  if (novo(at.recebidoEm) && (!at.enviadoEm || at.recebidoEm >= at.enviadoEm)) return 'ok';
  if (novo(at.enviadoEm) && !(at.recusa && at.recusa.em > at.enviadoEm)) return 'conferir';
  if (!(sim || at.pedidoEm)) return null;
  return at.recusa ? 'recusado' : 'falta';
}
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const dataCurta = ms => { const d = new Date(ms); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
const lerDataUrl = arq => new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => falha(new Error('Não deu para ler esse arquivo.')); r.readAsDataURL(arq); });
const bytesDe = url => { const b = atob(url.split(',')[1]), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
// reduz a foto no próprio celular: até 1600 px, JPEG, abaixo de ~380 KB (uma foto de celular tem 3 a 5 MB)
async function prepararAtestado(arq) {
  if (!arq) throw new Error('Escolha um arquivo.');
  if (arq.type === 'application/pdf' || /\.pdf$/i.test(arq.name || '')) {
    if (arq.size > ATEST_MAX_PDF) throw new Error(`Esse PDF tem ${kb(arq.size)}. Tire uma foto do atestado (o app reduz sozinho) ou mande um PDF de até ${kb(ATEST_MAX_PDF)}.`);
    return { arquivo: await lerDataUrl(arq), tipo: 'pdf', nome: arq.name || 'atestado.pdf', tam: arq.size, original: arq.size };
  }
  if (!/^image\//.test(arq.type || '')) throw new Error('Escolha uma foto ou um PDF.');
  let fonte = await abrirImagem(arq, 1600), url = '';
  for (let lado = 1600; lado >= 700; lado = Math.round(lado * 0.8)) {
    const f = Math.min(1, lado / Math.max(fonte.width, fonte.height)), c = document.createElement('canvas');
    c.width = Math.round(fonte.width * f); c.height = Math.round(fonte.height * f);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(fonte, 0, 0, c.width, c.height);
    for (const q of [0.72, 0.6, 0.5]) { url = c.toDataURL('image/jpeg', q); if (url.length * 0.75 <= ATEST_MAX_IMG) break; }
    if (url.length * 0.75 <= ATEST_MAX_IMG) break;
  }
  return { arquivo: url, tipo: 'img', nome: (arq.name || 'atestado').replace(/\.\w+$/, '') + '.jpg', tam: Math.round(url.length * 0.75), original: arq.size };
}
function previaAtestado(f) {
  if (!f || !f.arquivo) return '<div class="sub">Arquivo não encontrado.</div>';
  return f.tipo === 'pdf'
    ? `<div class="atest-pdf"><span class="atest-ic" aria-hidden="true">PDF</span><span class="grow"><b>${esc(f.nome || 'atestado.pdf')}</b><span class="s">${kb(f.tam || 0)}</span></span><button type="button" class="btn ghost btn-mini" data-atabrir>Abrir</button></div>`
    : `<img class="atest-img" src="${f.arquivo}" alt="Foto do atestado médico" data-atabrir>`;
}
function ligarPrevia(raiz, f, alid) {
  raiz.querySelectorAll('[data-atabrir]').forEach(b => b.onclick = () => abrirArquivoAtestado(f, alid));
}
async function abrirArquivoAtestado(f, alid) {
  const tipo = f.tipo === 'pdf' ? 'application/pdf' : 'image/jpeg', nome = `atestado-${(primeiro((S.alunas[alid] || {}).nome) || 'aluno').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}.${f.tipo === 'pdf' ? 'pdf' : 'jpg'}`;
  if (f.tipo !== 'pdf') { // foto: abre grande por cima, com botão de salvar
    const el = document.createElement('div'); el.className = 'doc-legal-bg atest-zoom';
    el.innerHTML = `<div class="atest-zoom-box"><img src="${f.arquivo}" alt="Atestado médico"><div class="actions"><button type="button" class="btn ghost" data-z="0">Fechar</button><button type="button" class="btn" data-z="1">Salvar no celular</button></div></div>`;
    document.body.appendChild(el);
    el.onclick = async e => { const b = e.target.closest('[data-z]'); if (e.target === el || (b && b.dataset.z === '0')) return el.remove(); if (b) { const r = await salvarArquivo(nome, bytesDe(f.arquivo), tipo); if (r !== 'cancelado') aviso('Atestado salvo'); } };
    return;
  }
  const r = await salvarArquivo(nome, bytesDe(f.arquivo), tipo); if (r !== 'cancelado') aviso('Atestado salvo');
}
const carregarAtestado = alid => B.get(`escolas/${S.eid}/atestados/${alid}`).catch(() => null);

// enviar (família) ou anexar o atestado recebido em papel (administração)
function sheetEnviarAtestado(alid, op = {}) {
  const a = S.alunas[alid] || {}, t = S.saude[alid] || {}, t_ = t, at = t.atestado || {}, x = termoDe(alid), adm = !!S.admin;
  const jaTem = !!at.enviadoEm && x.as !== 'recusado' && x.as !== 'falta';
  let novo = null;
  sheet(`<h3>Atestado médico de ${esc(primeiro(a.nome))}</h3>
    ${op.depoisTermo ? `<div class="aviso-lei"><b>${t_.alteracoes && t_.alteracoes.length ? 'Termo enviado!' : 'Termo assinado!'}</b><span>Como tem resposta "sim" no questionário, a escola precisa de um atestado médico dizendo que ${esc(primeiro(a.nome))} pode fazer a atividade. Pode enviar agora ou depois, em Meus filhos.</span></div>` : ''}
    ${!adm && x.as === 'recusado' ? `<div class="aviso-lei"><b>A escola pediu outro atestado</b><span>${esc(at.recusa.motivo)}</span></div>` : ''}
    ${adm ? '<div class="sub">Tire uma foto do atestado que você recebeu em papel. Ele fica guardado aqui, e você não precisa guardar a folha.</div>'
      : '<div class="sub">Tire uma foto do atestado inteiro, com o nome, a assinatura e o carimbo do médico bem legíveis.</div>'}
    ${jaTem ? `<div class="field"><span class="lb">${x.as === 'ok' ? `Conferido pela escola em ${dataCurta(at.recebidoEm)}` : `Enviado em ${dataCurta(at.enviadoEm)} · a escola vai conferir`}</span><div id="atatual" class="atest-box"><div class="sub">Carregando…</div></div></div>` : ''}
    <div class="field" id="atnovo" hidden><span class="lb">Novo atestado</span><div class="atest-box" id="atprev"></div><div class="sub" id="attam"></div></div>
    <span class="btn ${jaTem ? 'ghost' : ''} toque-arquivo" id="atbtn">${jaTem ? 'Trocar o atestado' : 'Tirar foto ou escolher arquivo'}<input type="file" id="atarq" accept="image/*,application/pdf" aria-label="Escolher o atestado"></span>
    <div class="note">Foto ou PDF. O app reduz a foto antes de guardar, para não ocupar espaço. Só a administração e o(a) professor(a) da turma veem.</div>
    <div class="err" id="aterr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>${op.depoisTermo ? 'Enviar depois' : 'Fechar'}</button><button type="button" class="btn" id="atok" hidden>${adm ? 'Guardar atestado' : 'Enviar atestado'}</button></div>`, sh => {
    if (jaTem) carregarAtestado(alid).then(f => { const box = $('atatual'); if (!box) return; box.innerHTML = previaAtestado(f); if (f) ligarPrevia(box, f, alid); });
    $('atarq').onchange = async e => {
      const arq = e.target.files[0]; e.target.value = ''; if (!arq) return;
      $('aterr').textContent = ''; $('atbtn').firstChild.textContent = 'Preparando…';
      try { novo = await prepararAtestado(arq); } catch (er) { novo = null; $('aterr').textContent = er.message; }
      $('atbtn').firstChild.textContent = novo ? 'Escolher outro' : (jaTem ? 'Trocar o atestado' : 'Tirar foto ou escolher arquivo');
      $('atbtn').classList.toggle('ghost', !!novo || jaTem);
      $('atnovo').hidden = !novo; $('atok').hidden = !novo; if (!novo) return;
      $('atprev').innerHTML = previaAtestado(novo); ligarPrevia($('atprev'), novo, alid);
      $('attam').textContent = novo.tipo === 'img' && novo.original > novo.tam ? `Foto reduzida de ${kb(novo.original)} para ${kb(novo.tam)}.` : kb(novo.tam);
      if (novo.tipo === 'img') $('atprev').querySelector('img').scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    $('atok').onclick = async () => {
      if (!novo) return; $('atok').disabled = true; $('atok').textContent = 'Enviando…';
      const agora = Date.now(), meta = { tipo: novo.tipo, nome: novo.nome, tam: novo.tam, enviadoEm: agora, enviadoPor: EU.uid, quem: adm ? 'escola' : 'familia' };
      try {
        await B.set(`escolas/${S.eid}/atestados/${alid}`, { arquivo: novo.arquivo, tipo: novo.tipo, nome: novo.nome, tam: novo.tam, em: agora, por: EU.uid, responsavelId: a.responsavelId || null });
        await B.set(`escolas/${S.eid}/saude/${alid}`, { atestado: { ...at, ...meta, recusa: at.recusa || null, ...(adm ? { recebidoEm: agora, conferidoPor: EU.uid } : { recebidoEm: at.recebidoEm || null }) } }, { merge: true });
        fecharSheet(); aviso(adm ? 'Atestado guardado' : 'Atestado enviado. A escola vai conferir.');
        if (op.volta) setTimeout(op.volta, 80);
      } catch (er) { $('aterr').textContent = msgErro(er); $('atok').disabled = false; $('atok').textContent = adm ? 'Guardar atestado' : 'Enviar atestado'; }
    };
  });
}
// mensagem de WhatsApp para pedir o atestado
function waAtestado(alid) {
  const r = respDe(alid), rec = (((S.saude[alid] || {}).atestado) || {}).recusa;
  let txt = textoMsg('atestado', alid, []);
  if (rec && termoDe(alid).as === 'recusado') txt += `\n\nO atestado que recebemos não deu para aceitar: ${rec.motivo}. Pode mandar outro?`;
  return waLink(r.telefone, txt);
}
// bloco do atestado na leitura do termo (administração)
function blocoAtestadoAdm(alid, x) {
  const at = (x.t && x.t.atestado) || {}, wa = waAtestado(alid);
  const anexar = `<button type="button" class="btn ghost btn-mini" id="vanexar">${x.as === 'ok' || x.as === 'conferir' ? 'Trocar o atestado' : 'Anexar atestado recebido em papel'}</button>`;
  const pedir = wa ? `<a class="btn btn-mini" href="${esc(wa)}" target="_blank" rel="noopener">Pedir pelo WhatsApp</a>` : '';
  const caixa = (titulo, texto, botoes, prev) => `<section><h2>Atestado médico</h2><div class="aviso-lei ${x.as === 'ok' ? 'ok' : ''}"><b>${titulo}</b><span>${texto}</span></div>${prev ? '<div class="atest-box" id="vatprev"><div class="sub">Carregando…</div></div>' : ''}<div class="at-botoes">${botoes}</div></section>`;
  if (!x.as) return `<section><h2>Atestado médico</h2><div class="sub">Não foi pedido: nenhuma resposta "sim" no questionário.</div><div class="at-botoes">${anexar}</div></section>`;
  if (x.as === 'falta') return caixa('Falta o atestado', `Tem resposta "sim" no questionário. Peça o atestado médico antes das aulas. A família envia a foto pelo app, em Meus filhos.`, pedir + anexar);
  if (x.as === 'recusado') return caixa('Você pediu outro atestado', `Em ${dataCurta(at.recusa.em)}: ${esc(at.recusa.motivo)}. Esperando a família mandar outro.`, pedir + anexar);
  if (x.as === 'conferir') return caixa('Atestado para conferir', `Enviado ${at.quem === 'escola' ? 'pela escola' : 'pela família'} em ${dataCurta(at.enviadoEm)}. Confira se tem o nome do(a) aluno(a), a data, e a assinatura e o carimbo do médico.`,
    '<button type="button" class="btn btn-mini" id="vatok">Está certo</button><button type="button" class="btn ghost btn-mini" id="vatnao">Pedir outro</button>', true);
  return caixa('Atestado conferido', `${at.quem === 'escola' ? 'Anexado pela escola' : 'Enviado pela família'} em ${dataCurta(at.enviadoEm || at.recebidoEm)}, conferido em ${dataCurta(at.recebidoEm)}. Vale por 1 ano.`, anexar, !!at.enviadoEm);
}
function ligarAtestadoAdm(alid, volta) {
  const at = ((S.saude[alid] || {}).atestado) || {};
  if ($('vatprev')) carregarAtestado(alid).then(f => { const box = $('vatprev'); if (!box) return; box.innerHTML = previaAtestado(f); if (f) ligarPrevia(box, f, alid); });
  if ($('vanexar')) $('vanexar').onclick = () => abrirDe(volta, () => sheetEnviarAtestado(alid, { volta }));
  if ($('vatok')) $('vatok').onclick = async () => { $('vatok').disabled = true; await B.set(`escolas/${S.eid}/saude/${alid}`, { atestado: { ...at, recebidoEm: Date.now(), conferidoPor: EU.uid, recusa: null } }, { merge: true }); aviso('Atestado conferido'); setTimeout(volta, 60); };
  if ($('vatnao')) $('vatnao').onclick = () => abrirDe(volta, () => sheetPedirOutroAtestado(alid, volta));
}
function sheetPedirOutroAtestado(alid, volta) {
  const a = S.alunas[alid] || {}, at = ((S.saude[alid] || {}).atestado) || {};
  const MOT = ['Foto sem leitura', 'Sem assinatura ou carimbo do médico', 'Sem data', 'Não diz que pode fazer atividade física', 'Nome errado'];
  sheet(`<h3>Pedir outro atestado</h3>
    <div class="sub">${esc(primeiro(a.nome))}. A família vê o motivo no app e pode mandar outro.</div>
    <div class="field"><span class="lb">Motivo</span><div class="chips">${MOT.map(m => `<button type="button" class="pick" data-pm="${esc(m)}">${esc(m)}</button>`).join('')}</div></div>
    <div class="field"><label for="pomot">Ou escreva</label><input id="pomot" maxlength="120" placeholder="Ex.: o atestado é do ano passado"></div>
    <div class="err" id="poerr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn" id="pook">Pedir outro</button></div>`, sh => {
    sh.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { $('pomot').value = b.dataset.pm; sh.querySelectorAll('[data-pm]').forEach(c => c.setAttribute('aria-pressed', c === b)); });
    $('pook').onclick = async () => {
      const m = $('pomot').value.trim(); if (!m) return $('poerr').textContent = 'Escolha ou escreva o motivo.';
      $('pook').disabled = true;
      await B.set(`escolas/${S.eid}/saude/${alid}`, { atestado: { ...at, pedidoEm: at.pedidoEm || Date.now(), recebidoEm: null, recusa: { em: Date.now(), motivo: m, por: EU.uid } } }, { merge: true });
      aviso('Pedido salvo. Avise a família pelo WhatsApp.'); setTimeout(volta, 60);
    };
  });
}
// administração: aviso na tela de Cobranças e lista de atestados
function atestadosEscola() {
  const at = porNome(S.alunas).filter(([id, a]) => !a.anonimizadoEm && C.ativaNoMes(a, mesHoje()) && termoDe(id).st !== 'falta').map(([id, a]) => ({ id, a, x: termoDe(id) })).filter(r => r.x.as);
  return { conferir: at.filter(r => r.x.as === 'conferir'), faltam: at.filter(r => r.x.as === 'falta' || r.x.as === 'recusado'), ok: at.filter(r => r.x.as === 'ok') };
}
function avisoAtestadosAdm() {
  const g = atestadosEscola(); if (!g.conferir.length && !g.faltam.length) return '';
  const p = [g.conferir.length ? `<b>${g.conferir.length}</b> para conferir` : '', g.faltam.length ? `<b>${g.faltam.length}</b> falta${g.faltam.length === 1 ? '' : 'm'} enviar` : ''].filter(Boolean).join(' · ');
  return `<button class="faixa-resumo" id="vatlist"><span class="grow"><b>Atestados médicos</b><span class="s">${p}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`;
}
function sheetAtestadosEscola() {
  const g = atestadosEscola(), volta = () => sheetAtestadosEscola();
  const linha = (r, dir) => `<li class="tap" data-va="${esc(r.id)}"><div class="dot">${esc(iniciais(r.a.nome))}</div><div class="grow"><div class="t">${esc(r.a.nome)}</div>${linhas(esc(respDe(r.id).nome || 'Sem responsável'), dir)}</div>${r.x.as === 'falta' || r.x.as === 'recusado' ? (() => { const wa = waAtestado(r.id); return wa ? `<a class="wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Pedir pelo WhatsApp" data-nao-abre>${ICO_WA}</a>` : ''; })() : ''}</li>`;
  const at = r => (r.x.t.atestado || {});
  sheet(`<h3>Atestados médicos</h3>
    <div class="sub">Dos alunos que marcaram "sim" no questionário de saúde, ou que você anexou. O atestado vale por 1 ano.</div>
    ${g.conferir.length ? `<section><h2>Para conferir</h2><ul class="list">${g.conferir.map(r => linha(r, `Enviado em ${dataCurta(at(r).enviadoEm)}`)).join('')}</ul></section>` : ''}
    ${g.faltam.length ? `<section><h2>Faltam enviar</h2><ul class="list">${g.faltam.map(r => linha(r, r.x.as === 'recusado' ? 'Você pediu outro: ' + esc(at(r).recusa.motivo) : 'Ainda não enviou')).join('')}</ul><div class="note">O botão verde abre o WhatsApp com o pedido pronto. Para mudar o texto, edite o modelo "Atestado" em Ajustes → Mensagens.</div></section>` : ''}
    ${g.ok.length ? `<details class="historico"><summary><span class="grow"><b>Conferidos</b><span class="s">${g.ok.length} aluno${g.ok.length === 1 ? '' : 's'}</span></span><span class="seta" aria-hidden="true">▾</span></summary><ul class="list">${g.ok.map(r => linha(r, `Conferido em ${dataCurta(at(r).recebidoEm)}`)).join('')}</ul></details>` : ''}
    ${!g.conferir.length && !g.faltam.length && !g.ok.length ? '<div class="empty">Nenhum atestado pedido.</div>' : ''}
    <button class="btn ghost" data-fechar>Fechar</button>`, sh => {
    sh.querySelectorAll('[data-va]').forEach(li => li.onclick = e => { if (e.target.closest('[data-nao-abre]')) return; abrirDe(volta, () => sheetVerTermo(li.dataset.va)); });
  });
}


/* ================= Formas de pagamento (administração) ================= */
function sheetFormasEscola() {
  const f = formasCfg(), t = taxasCfg(), num = v => String(v).replace('.', ','), ex = 300;
  sheet(`<h3>Formas de pagamento</h3>
    <div class="sub">O Pix fica sempre ligado: é o mais barato e cai na hora. Ligue as outras formas se quiser dar opção às famílias.</div>
    <div class="checks" style="max-height:none">
      <label><input type="checkbox" checked disabled><span class="grow"><b>Pix</b><span class="s">Taxa ${num(t.pix)}% · cai na hora</span></span></label>
      <label><input type="checkbox" id="fbol" ${f.boleto ? 'checked' : ''}><span class="grow"><b>Boleto</b><span class="s">Taxa R$ ${num(t.boleto)} por boleto pago · cai em 3 dias</span></span></label>
      <label><input type="checkbox" id="fcar" ${f.cartao ? 'checked' : ''}><span class="grow"><b>Cartão de crédito à vista</b><span class="s">Taxa ${num(t.cartao)}% · cai em 7 dias</span></span></label>
      <label><input type="checkbox" id="fpar" ${f.parcelado ? 'checked' : ''}><span class="grow"><b>Cartão parcelado</b><span class="s">A escola paga ${num(t.cartao)}%; os juros do parcelamento ficam com quem paga</span></span></label>
    </div>
    <div class="field" id="fmaxw"><label for="fmax">Parcelar em até</label><select id="fmax">${[2, 3, 4, 5, 6].map(n => `<option value="${n}" ${Number(f.maxParcelas) === n ? 'selected' : ''}>${n}x</option>`).join('')}</select></div>
    <details class="historico"><summary><span class="grow"><b>Taxas da sua conta no Mercado Pago</b><span class="s">Confira no app do Mercado Pago, em "Todas as taxas", e ajuste aqui</span></span><span class="seta" aria-hidden="true">▾</span></summary>
      <div style="padding:0 14px 14px;display:flex;flex-direction:column;gap:10px">
        <div class="two"><div class="field"><label for="tpix">Pix (%)</label><input id="tpix" inputmode="decimal" value="${num(t.pix)}"></div><div class="field"><label for="tbol">Boleto (R$)</label><input id="tbol" inputmode="decimal" value="${num(t.boleto)}"></div></div>
        <div class="two"><div class="field"><label for="tcar">Cartão (%)</label><input id="tcar" inputmode="decimal" value="${num(t.cartao)}"></div><div></div></div>
        <div class="lb" style="font-size:.82rem;font-weight:700;color:var(--muted)">Juros do parcelamento pagos pelo cliente (%)</div>
        <div class="two">${[2, 3, 4, 5, 6].map(n => `<div class="field"><label for="tp${n}">${n}x</label><input id="tp${n}" inputmode="decimal" value="${num(t.parc[n])}"></div>`).join('')}</div>
      </div></details>
    <div class="field"><span class="lb">Exemplo: uma cobrança de ${brl(ex)}</span><div class="conta" id="fex"></div></div>
    <div class="note">Mais ${Math.round(COMISSAO * 100)}% de comissão do app em todas as formas. ${S.cfg.pixRepassa === true ? 'Como "quem paga cobre a taxa" está ligado, a família paga a taxa da forma que escolher e a escola recebe o valor cheio.' : 'Como "quem paga cobre a taxa" está desligado, as taxas saem do valor que a escola recebe.'}</div>
    <div class="err" id="ferr2" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn" id="fok2">Salvar</button></div>`, () => {
    const ler = () => { const pn = id => parseValor($(id).value); return { formas: { boleto: $('fbol').checked, cartao: $('fcar').checked, parcelado: $('fcar').checked && $('fpar').checked, maxParcelas: Number($('fmax').value) },
      taxas: { pix: pn('tpix'), boleto: pn('tbol'), cartao: pn('tcar'), parc: Object.fromEntries([2, 3, 4, 5, 6].map(n => [n, pn('tp' + n)])) } }; };
    const ver = () => { const l = ler(), old = S.cfg; S.cfg = { ...old, formas: l.formas, taxas: l.taxas };
      $('fmaxw').hidden = !(l.formas.cartao && l.formas.parcelado); $('fpar').disabled = !l.formas.cartao;
      const linhas_ = [['Pix', valorForma(ex, 'pix').total]]; if (l.formas.boleto) linhas_.push(['Boleto', valorForma(ex, 'boleto').total]);
      if (l.formas.cartao) linhas_.push(['Cartão à vista', valorForma(ex, 'cartao', 1).total]);
      if (l.formas.cartao && l.formas.parcelado) for (let n = 2; n <= l.formas.maxParcelas; n++) { const v = valorForma(ex, 'cartao', n); linhas_.push([`Cartão em ${n}x (${n}x de ${brl(v.parcela)})`, v.total]); }
      S.cfg = old; $('fex').innerHTML = linhas_.map(([a, v]) => contaL(esc(a), brl(v))).join(''); };
    document.querySelectorAll('.sheet input, .sheet select').forEach(el => el.addEventListener('input', ver)); ver();
    $('fok2').onclick = async () => { const l = ler();
      if ([l.taxas.pix, l.taxas.boleto, l.taxas.cartao, ...Object.values(l.taxas.parc)].some(v => !(v >= 0) || v > 50)) return $('ferr2').textContent = 'Confira as taxas: use números como 4,98.';
      $('fok2').disabled = true;
      try { await B.set(`escolas/${S.eid}/config/geral`, l, { merge: true }); fecharSheet(); aviso('Formas de pagamento salvas'); } catch (e) { $('ferr2').textContent = msgErro(e); $('fok2').disabled = false; } };
  });
}

/* ================= Administração da escola (várias pessoas) ================= */
// cada pessoa entra com a própria conta; só quem criou a escola convida, pelo e-mail, e o convite vale 7 dias
function blocoAdms(raiz) {
  const E = S.escola, dono = E.dono, info = E.adminsInfo || {}, souDono = EU.uid === dono, agora = Date.now();
  const convites = Object.entries(E.convitesAdm || {}).filter(([, c]) => c && c.expira > agora);
  const lin = uid => { const i = info[uid] || {}, eu = uid === EU.uid;
    return `<li><div class="dot">${esc(iniciais(i.nome || '?'))}</div><div class="grow"><div class="t">${esc(i.nome || 'Administrador(a)')}${eu ? ' <span class="sub">(você)</span>' : ''}</div>${linhas(esc(i.email || ''), uid === dono ? 'Criou a escola' : i.em ? `Entrou em ${dataCurta(i.em)}` : '')}</div>
      ${uid === dono ? '<span class="chip">Dono(a)</span>' : souDono ? `<button type="button" class="btn ghost btn-mini" data-tiradm="${esc(uid)}" style="color:var(--out)">Tirar</button>` : eu ? '<button type="button" class="btn ghost btn-mini" data-saiadm="1">Sair</button>' : ''}</li>`; };
  raiz.innerHTML = `<div class="sub">Cada pessoa entra com a própria conta e senha, e o app registra quem fez cada coisa. Um "Ciente" de qualquer pessoa da administração já vale para todas.</div>
    <ul class="list">${(E.admins || []).map(lin).join('')}</ul>
    ${convites.length ? `<ul class="list">${convites.map(([k, c]) => `<li><div class="dot">${esc(iniciais(c.nome))}</div><div class="grow"><div class="t">${esc(c.nome)}</div>${linhas(esc(c.email), `Convite enviado · aguardando aceitar até ${dataCurta(c.expira)}`)}</div><button type="button" class="btn ghost btn-mini" data-cancconv="${esc(k)}">Cancelar</button></li>`).join('')}</ul>` : ''}
    ${souDono ? `<div class="conta-box convite" id="jconvbox" hidden><b>Convidar para a administração</b>
      <div class="field"><label for="jcnome">Nome</label><input id="jcnome" maxlength="60" autocomplete="off"></div>
      <div class="field"><label for="jcemail">E-mail da pessoa</label><input id="jcemail" type="email" inputmode="email" autocomplete="off" placeholder="nome@exemplo.com"></div>
      <div class="sub">Só quem entrar no app com este e-mail vê o convite e pode aceitar. Ninguém entra na administração sem convite.</div>
      <div class="err" id="jcerr" role="alert"></div>
      <div class="at-botoes"><button type="button" class="btn ghost btn-mini" id="jcnao">Cancelar</button><button type="button" class="btn btn-mini" id="jcok">Enviar convite</button></div></div>
    <button type="button" class="linha-botao" id="jconv"><span class="grow"><b>+ Convidar administrador(a)</b><span class="s">Pelo e-mail da pessoa</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`
    : '<div class="note">Só quem criou a escola pode convidar ou tirar pessoas da administração.</div>'}`;
  const redesenha = () => setTimeout(() => blocoAdms(raiz), 80);
  if ($('jconv')) $('jconv').onclick = () => { $('jconvbox').hidden = false; $('jconv').hidden = true; $('jcnome').focus(); };
  if ($('jcnao')) $('jcnao').onclick = () => { $('jconvbox').hidden = true; $('jconv').hidden = false; };
  if ($('jcok')) $('jcok').onclick = async () => {
    const nome = $('jcnome').value.trim(), email = $('jcemail').value.trim().toLowerCase(), err = m => $('jcerr').textContent = m;
    if (!nome) return err('Digite o nome da pessoa.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Confira o e-mail.');
    if (Object.values(info).some(i => (i.email || '').toLowerCase() === email && (E.admins || []).some(u => info[u] === i))) return err('Esta pessoa já faz parte da administração.');
    $('jcok').disabled = true; const k = chaveEmail(email), c = { nome, email, em: Date.now(), por: EU.uid, porNome: EU.nome || '', escola: E.nome || '', expira: Date.now() + 7 * 864e5 };
    try { if (MOCK) { await B.set('convitesAdm/' + k, { [S.eid]: c }, { merge: true }); await B.set('escolas/' + S.eid, { convitesAdm: { [k]: c } }, { merge: true }); } else await servidor('adminConvite', { acao: 'criar', eid: S.eid, nome, email });
      aviso(`Convite enviado para ${primeiro(nome)}. Peça para entrar no app com ${email}.`); redesenha(); }
    catch (e) { err(msgErro(e)); $('jcok').disabled = false; } };
  raiz.querySelectorAll('[data-cancconv]').forEach(b => b.onclick = async () => { const k = b.dataset.cancconv, c = (E.convitesAdm || {})[k] || {}; b.disabled = true;
    try { if (MOCK) { await B.set('convitesAdm/' + k, { [S.eid]: null }, { merge: true }); await B.set('escolas/' + S.eid, { convitesAdm: { [k]: null } }, { merge: true }); } else await servidor('adminConvite', { acao: 'cancelar', eid: S.eid, email: c.email });
      aviso('Convite cancelado'); redesenha(); } catch (e) { aviso(msgErro(e)); b.disabled = false; } });
  raiz.querySelectorAll('[data-tiradm]').forEach(b => b.onclick = () => { const uid = b.dataset.tiradm, n = (info[uid] || {}).nome || 'esta pessoa';
    confirmar('Tirar da administração?', `${esc(n)} deixa de ver e mexer nos dados da escola. O que já foi feito por essa pessoa continua registrado.`, 'Tirar', async () => { await B.set('escolas/' + S.eid, { admins: (S.escola.admins || []).filter(x => x !== uid) }, { merge: true }); aviso('Pronto'); }); });
  raiz.querySelectorAll('[data-saiadm]').forEach(b => b.onclick = () => confirmar('Sair da administração?', 'Você deixa de ver os dados desta escola. Para voltar, quem criou a escola precisa te convidar de novo.', 'Sair', async () => {
    await B.set('escolas/' + S.eid, { admins: (S.escola.admins || []).filter(x => x !== EU.uid) }, { merge: true }); await B.set('users/' + EU.uid, { escolas: { [S.eid]: null } }, { merge: true }); delete MINHAS[S.eid]; location.reload(); }));
}

/* ================= Privacidade e dados (LGPD) ================= */
const VERSAO_TERMOS = 1, VERSAO_PRIVACIDADE = 1;
const linksLegais = () => `<div class="legal"><button type="button" class="link" data-doc="privacidade">Política de privacidade</button><span aria-hidden="true">·</span><button type="button" class="link" data-doc="termos">Termos de uso</button></div>`;
// os textos ficam em privacidade.html e termos.html; aqui abrem dentro do app
document.addEventListener('click', e => { const b = e.target.closest('[data-doc]'); if (!b) return; e.preventDefault(); e.stopPropagation(); abrirDocLegal(b.dataset.doc); });
async function abrirDocLegal(tipo) {
  const volta = $('overlay').innerHTML ? null : null, url = tipo + '.html';
  let corpo = '';
  try { const r = await fetch(url, { cache: 'no-cache' }); const t = await r.text(); const m = new DOMParser().parseFromString(t, 'text/html').querySelector('main'); corpo = m ? m.innerHTML : ''; } catch (e) { }
  if (!corpo) corpo = `<p>Não deu para abrir agora. <a href="${esc(url)}" target="_blank" rel="noopener">Abrir em outra aba</a>.</p>`;
  const el = document.createElement('div'); el.className = 'doc-legal-bg'; el.innerHTML = `<div class="doc-legal" role="dialog" aria-modal="true"><button type="button" class="btn ghost btn-mini doc-fechar">Fechar</button><div class="doc-corpo">${corpo}</div></div>`;
  document.body.appendChild(el); travarFundo(true);
  const fechar = () => { el.remove(); if (!$('overlay').innerHTML) travarFundo(false); };
  el.querySelector('.doc-fechar').onclick = fechar; el.onclick = e => { if (e.target === el) fechar(); };
}
// responsável: autorização no primeiro acesso (LGPD, art. 14: dados de crianças)
function telaConsentimento(v) {
  const filhos = porNome(S.alunas).map(([, a]) => primeiro(a.nome)).join(', ');
  v.innerHTML = `<div class="hero consent">
    <div class="label">Antes de começar</div>
    <h2 style="font-size:1.3rem">Seus dados e os dados ${filhos ? 'de ' + esc(filhos) : 'dos seus filhos'}</h2>
    <p class="sub" style="margin:0">A ${esc(S.escola.nome || 'escola')} usa o ${esc(NOME_APP())} para organizar turmas e cobranças. Para isso, o app guarda o nome e a data de nascimento dos alunos, o seu nome e WhatsApp, e o que foi pago.</p>
    <ul class="consent-lista"><li>Usamos só para as turmas e as cobranças da escolinha.</li><li>Não vendemos dados e não fazemos publicidade.</li><li>Você pode baixar uma cópia ou pedir a exclusão quando quiser, em Minha conta.</li></ul>
    <label class="check aceite"><input type="checkbox" id="cons"><span>Sou pai, mãe ou responsável legal e autorizo o uso desses dados, conforme a <button type="button" class="link" data-doc="privacidade">Política de privacidade</button>.</span></label>
    <div class="err" id="conserr" role="alert"></div>
    <button class="btn" id="consok">Concordo e continuar</button>
    <button class="btn ghost" id="consnao">Não concordo</button>
  </div>`;
  $('consok').onclick = async () => {
    if (!$('cons').checked) return $('conserr').textContent = 'Marque a autorização para continuar.';
    $('consok').disabled = true;
    try { await B.set(`escolas/${S.eid}/membros/${EU.uid}`, { consentimento: { em: Date.now(), versao: VERSAO_PRIVACIDADE } }, { merge: true }); aviso('Obrigado! Tudo pronto.'); }
    catch (e) { $('conserr').textContent = msgErro(e); $('consok').disabled = false; }
  };
  $('consnao').onclick = () => confirmar('Não concorda?', 'Sem a autorização, o app não pode mostrar os dados dos seus filhos. Você pode pagar direto com a escola e, se quiser, pedir que ela apague os dados que já cadastrou.', 'Sair da conta', () => B.sair());
}
// arquivo com os dados (JSON legível), para cópia ou portabilidade
function baixarJson(nome, dados) {
  const txt = JSON.stringify(dados, null, 2), bytes = new TextEncoder().encode(txt);
  return salvarArquivo(nome, bytes, 'application/json');
}
const dataArq = () => hoje().replace(/-/g, '');
function dadosDaFamilia() {
  const alunos = Object.entries(S.alunas).map(([id, a]) => ({ aluno: a.nome, nascimento: a.nascimento || null, turmas: (a.turmas || []).map(t => (S.turmas[t] || {}).nome).filter(Boolean),
    cobrancas: itensDe(id).map(i => ({ descricao: i.desc, valor: i.v, vencimento: i.venc, pago: i.pago ? { forma: i.pago.via, data: i.pago.d || null } : null })) }));
  return { app: NOME_APP(), escola: S.escola.nome || '', geradoEm: new Date().toISOString(), voce: { nome: EU.nome || '', email: EU.email || '' },
    responsaveis: Object.values(S.resps).map(r => ({ nome: r.nome, whatsapp: r.telefone || '', cpf: r.cpf || '' })), alunos };
}
function sheetPrivFamilia() {
  const meus = Object.values(S.pedidos || {}).filter(x => x.uid === EU.uid && x.status !== 'feito');
  sheet(`<h3>Privacidade e dados</h3>
    <div class="sub">Você pode baixar uma cópia dos seus dados e dos seus filhos, ou pedir à escola que apague.</div>
    <button type="button" class="linha-botao" id="pfbaixar"><span class="grow"><b>Baixar meus dados</b><span class="s">Arquivo com cadastro, turmas e cobranças</span></span><span aria-hidden="true">›</span></button>
    <button type="button" class="linha-botao" id="pfexcluir"><span class="grow"><b>Pedir exclusão dos dados</b><span class="s">${S.eu && S.eu.pedidoExclusao ? 'Pedido enviado em ' + esc(dataBR(new Date(S.eu.pedidoExclusao).toISOString().slice(0, 10))) + '. A escola vai responder.' : 'O pedido vai para a escola, que apaga os dados'}</span></span><span aria-hidden="true">›</span></button>
    ${linksLegais()}
    <button class="btn ghost" data-fechar>Fechar</button>`, () => {
    $('pfbaixar').onclick = async () => { const r = await baixarJson(`meus-dados-${dataArq()}.json`, dadosDaFamilia()); if (r !== 'cancelado') aviso('Arquivo salvo'); };
    $('pfexcluir').onclick = () => {
      if (S.eu && S.eu.pedidoExclusao) return aviso('Seu pedido já foi enviado. A escola vai responder.');
      confirmar('Pedir exclusão dos dados?', `A ${esc(S.escola.nome || 'escola')} vai receber o pedido para apagar o seu cadastro e o dos seus filhos (${esc(porNome(S.alunas).map(([, a]) => primeiro(a.nome)).join(', ') || 'nenhum')}). Cobranças em aberto continuam devidas e o registro do que foi pago pode ficar guardado pelo prazo da lei, sem identificar vocês.`, 'Enviar pedido', async () => {
        const id = novoId();
        await B.lote([{ op: 'set', p: `escolas/${S.eid}/pedidos/${id}`, d: { tipo: 'exclusao', uid: EU.uid, nome: EU.nome || '', email: EU.email || '', rids: Object.keys(S.resps), alunas: Object.keys(S.alunas), em: Date.now(), status: 'pendente' } },
          { op: 'merge', p: `escolas/${S.eid}/membros/${EU.uid}`, d: { pedidoExclusao: Date.now() } }]);
        aviso('Pedido enviado para a escola');
      });
    };
  });
}
// escola: apagar os dados pessoais (anonimiza), mantendo o registro do que foi pago
async function apagarDadosPessoais(alids, pedidoId) {
  const ops = [], rids = new Set();
  for (const alid of alids) { const a = S.alunas[alid]; if (!a) continue; if (a.responsavelId) rids.add(a.responsavelId);
    ops.push({ op: 'set', p: `escolas/${S.eid}/alunas/${alid}`, d: { nome: 'Aluno(a) removido(a)', nascimento: null, responsavelId: a.responsavelId || null, turmas: a.turmas || [], desc: null, inicio: a.inicio || null, fim: mesMais(mesHoje(), -1), ativa: false, anonimizadoEm: Date.now() } });
    ops.push({ op: 'del', p: `escolas/${S.eid}/saude/${alid}` }, { op: 'del', p: `escolas/${S.eid}/atestados/${alid}` });
    for (const [g, G] of Object.entries(S.grupos)) if ((G.alunas || []).includes(alid)) ops.push({ op: 'merge', p: `escolas/${S.eid}/grupos/${g}`, d: { alunas: G.alunas.filter(x => x !== alid) } });
  }
  // responsável só é apagado se não tiver outro aluno ativo
  for (const rid of rids) { const outros = Object.entries(S.alunas).filter(([id, a]) => a.responsavelId === rid && !alids.includes(id) && !a.anonimizadoEm); const r = S.resps[rid]; if (!r || outros.length) continue;
    ops.push({ op: 'set', p: `escolas/${S.eid}/responsaveis/${rid}`, d: { nome: 'Responsável removido', telefone: '', cpf: '', codigo: null, anonimizadoEm: Date.now() } });
    if (r.codigo) ops.push({ op: 'del', p: 'codigos/' + r.codigo }); }
  if (pedidoId) ops.push({ op: 'merge', p: `escolas/${S.eid}/pedidos/${pedidoId}`, d: { status: 'feito', feitoEm: Date.now(), por: EU.uid } });
  await B.lote(ops);
}
function confirmarApagar(alids, pedidoId) {
  const nomes = alids.map(id => (S.alunas[id] || {}).nome).filter(Boolean).join(', ');
  confirmar('Apagar dados pessoais?', `${esc(nomes || 'Os alunos')} ${alids.length > 1 ? 'deixam' : 'deixa'} de ter nome, nascimento e contato do responsável no app, e sai${alids.length > 1 ? 'em' : ''} das turmas e grupos. O registro do que foi pago fica, sem identificar a pessoa, pelo prazo da lei. Isto não pode ser desfeito.`, 'Apagar dados', async () => { await apagarDadosPessoais(alids, pedidoId); aviso('Dados pessoais apagados'); });
}
function dadosDaEscola() {
  const { logoPdf, ...cfg } = S.cfg || {};
  return { app: NOME_APP(), geradoEm: new Date().toISOString(), escola: { id: S.eid, nome: S.escola.nome || '' }, ajustes: cfg, locais: S.locais, turmas: S.turmas, professores: S.profs, grupos: S.grupos,
    responsaveis: S.resps, alunos: S.alunas, cobrancasExtras: S.extras, acordos: S.acordos, pagamentos: S.pags, lancamentos: S.lanc, pedidosDeDados: S.pedidos };
}
function sheetPrivEscola() {
  const pend = Object.entries(S.pedidos || {}).filter(([, x]) => x.status !== 'feito'), feitos = Object.values(S.pedidos || {}).filter(x => x.status === 'feito').length;
  sheet(`<h3>Privacidade e dados</h3>
    <div class="sub">A escola é a responsável pelos dados que cadastra (controladora). Aqui você atende os pedidos das famílias e guarda uma cópia de tudo.</div>
    <section><h2>Pedidos das famílias</h2>
      ${pend.length ? `<ul class="list">${pend.map(([id, x]) => `<li><div class="grow"><div class="t">${esc(x.nome || 'Responsável')}</div>${linhas('Pediu a exclusão dos dados', esc((x.alunas || []).map(a => (S.alunas[a] || {}).nome).filter(Boolean).join(', ') || 'sem alunos'), `<span class="num">${esc(dataBR(new Date(x.em).toISOString().slice(0, 10)))}</span>`)}</div>
        <span class="valor-col"><button class="btn btn-mini" data-papagar="${esc(id)}">Apagar dados</button></span></li>`).join('')}</ul>
        <div class="note">Responda o quanto antes (a LGPD fala em até 15 dias para pedidos de acesso). Se houver cobrança em aberto, combine com a família antes; o registro do que foi pago continua guardado sem identificar ninguém.</div>`
        : `<div class="empty"><span>Nenhum pedido pendente.${feitos ? ` ${feitos} já atendido${feitos === 1 ? '' : 's'}.` : ''}</span></div>`}
    </section>
    <section><h2>Cópia dos dados</h2>
      <button type="button" class="linha-botao" id="pebaixar"><span class="grow"><b>Baixar todos os dados da escola</b><span class="s">Alunos, responsáveis, turmas, cobranças, pagamentos e caixa, num arquivo só. Guarde como cópia de segurança.</span></span><span aria-hidden="true">›</span></button>
    </section>
    <section><h2>Apagar dados de um aluno</h2><div class="sub">Abra o aluno em Alunos e toque em <b>Apagar dados pessoais (LGPD)</b>.</div></section>
    <section><h2>Documentos</h2>${linksLegais()}${S.escola.termosAceitos ? `<div class="note">Termos aceitos em ${esc(dataBR(new Date(S.escola.termosAceitos.em).toISOString().slice(0, 10)))}/${new Date(S.escola.termosAceitos.em).getFullYear()}.</div>` : ''}</section>
    <button class="btn ghost" data-fechar>Fechar</button>`, s => {
    $('pebaixar').onclick = async () => { const r = await baixarJson(`${(S.escola.nome || 'escola').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').toLowerCase()}-dados-${dataArq()}.json`, dadosDaEscola()); if (r !== 'cancelado') aviso('Arquivo salvo'); };
    s.querySelectorAll('[data-papagar]').forEach(b => b.onclick = () => { const x = S.pedidos[b.dataset.papagar]; confirmarApagar((x.alunas || []).filter(a => S.alunas[a]), b.dataset.papagar); });
  });
}

/* ================= Ajustes ================= */
// conta do Mercado Pago de um(a) professor(a): o link para ele(a) autorizar, ou desligar (o servidor apaga a chave)
async function mpProf(acao, pid) {
  const t = await B.token().catch(() => null); if (!t) throw new Error('Entre na sua conta de novo.');
  let r; try { r = await fetch(URLF('mpConectar'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ eid: S.eid, acao, pid }) }); }
  catch (e) { throw new Error('Sem conexão com o servidor. Tente de novo.'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Não deu certo agora. Tente de novo.');
  return j;
}
async function mpConta(acao) {
  if (MOCK) {
    if (acao === 'desconectar') { await B.set(`escolas/${S.eid}/config/geral`, { mpConectadoEm: null }, { merge: true }); await B.set(`escolas/${S.eid}/config/mp`, { conta: null, confirmada: false }, { merge: true }); return {}; }
    await B.set(`escolas/${S.eid}/config/geral`, { mpConectadoEm: Date.now(), mpTaxaApp: 0.01 }, { merge: true }); await B.set(`escolas/${S.eid}/config/mp`, { conta: { nome: 'Maria Teste da Silva', doc: '***.456.789-**' }, confirmada: false }, { merge: true }); aviso('Mercado Pago conectado (teste)'); return {};
  }
  const t = await B.token().catch(() => null); if (!t) throw new Error('Entre na sua conta de novo.');
  let r; try { r = await fetch(URLF('mpConectar'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ eid: S.eid, acao, volta: LINK_APP }) }); }
  catch (e) { throw new Error('Sem conexão com o servidor. Tente de novo.'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Não deu certo agora. Tente de novo.');
  if (j.url) { ls.set('escolinha.mpVolta', S.eid); location.assign(j.url); }
  return j;
}
function sheetAjustes() {
  if (!S.admin) {
    const P = S.prof ? S.profs[S.prof] || {} : null;
    return sheet(`<h3>Minha conta</h3><div class="sub">${esc(EU.nome || '')} · ${esc(EU.email || '')}</div><div class="sub">${S.prof ? 'Professor(a)' : 'Responsável'} na ${esc(S.escola.nome || '')}</div>
      ${P ? `<section><h2>Meu Mercado Pago</h2>${P.mpConectadoEm ? `<div class="banner ok"><span>Ligado${P.mpConta ? ' à conta de <b>' + esc(P.mpConta) + '</b>' : ''}. Os pagamentos que a escola direcionar para você caem direto na sua conta.</span></div><button class="btn ghost" id="pmdes" style="color:var(--out)">Desligar</button>`
        : `<div class="sub">Ligue a sua conta do Mercado Pago para receber direto os pagamentos que a escola direcionar para você.</div><button class="btn" id="pmcon">Conectar meu Mercado Pago</button>`}</section>` : ''}
      ${S.prof ? '' : `<section><h2>Privacidade e dados</h2><button type="button" class="linha-botao" id="jprivf"><span class="grow"><b>Baixar meus dados ou pedir exclusão</b><span class="s">Seus dados e os dos seus filhos</span></span><span aria-hidden="true">›</span></button></section>`}
      <div class="actions"><button class="btn ghost" id="jtroca">Minhas escolas</button><button class="btn ghost" id="jsair">Sair da conta</button></div><button class="btn ghost" data-fechar>Fechar</button>`, () => {
      if ($('jprivf')) $('jprivf').onclick = () => abrirDe(sheetAjustes, sheetPrivFamilia);
      $('jtroca').onclick = () => { fecharSheet(); telaInicio(); }; $('jsair').onclick = () => { fecharSheet(); B.sair(); };
      // no teste, ligar/desligar é simulado; no app de verdade usa o mesmo OAuth da escola
      if ($('pmcon')) $('pmcon').onclick = async () => { if (!MOCK) return aviso('Disponível quando o servidor for atualizado.'); await B.set(`escolas/${S.eid}/professoras/${S.prof}`, { mpConectadoEm: Date.now(), mpConta: EU.nome || 'Professor(a)' }, { merge: true }); aviso('Mercado Pago ligado (teste)'); setTimeout(sheetAjustes, 60); };
      if ($('pmdes')) $('pmdes').onclick = async () => { await B.set(`escolas/${S.eid}/professoras/${S.prof}`, { mpConectadoEm: null }, { merge: true }); setTimeout(sheetAjustes, 60); };
    });
  }
  const c = S.cfg, conta = (S.mpc || {}).conta, taxaTot = (0.0099 + (Number(c.mpTaxaApp) || 0.01)) * 100;
  sheet(`<h3>Ajustes da escola</h3>
    <section><h2>Pix automático</h2>
      ${c.mpConectadoEm ? `<div class="banner ok"><span>Conectado${conta ? ` à conta de <b>${esc(conta.nome)}</b> ${esc(conta.doc || '')}` : ''}.</span></div>
        ${conta && S.mpc.confirmada === false ? `<div class="sub">É essa a conta que deve receber os pagamentos?</div><div class="actions"><button class="btn ok" id="mpsim">Sim, é essa conta</button><button class="btn ghost" id="mpout">Não, conectar outra</button></div>` : ''}
        <div class="actions"><button class="btn ghost" id="mpinfo">Atualizar dados da conta</button><button class="btn ghost" id="mpdes" style="color:var(--out)">Desconectar</button></div>`
        : `<div class="sub">O dinheiro cai direto na conta do Mercado Pago da escola, e a baixa no app é automática. Antes de conectar, confira: conta no nome de quem recebe, maior de 18 anos, identidade confirmada e uma chave Pix cadastrada.</div>
        <div class="note">Se o Mercado Pago já estiver aberto neste celular, ele conecta direto com essa conta. Depois você confere o nome e o CPF.</div>
        <button class="btn" id="mpcon">Conectar Mercado Pago</button>`}
      <div class="field"><label for="jpix">Chave Pix da escola (para conferência)</label><input id="jpix" maxlength="80" value="${esc(c.pixChave || '')}" placeholder="CNPJ, e-mail, celular ou chave aleatória"></div>
      <label class="check"><input type="checkbox" id="jrep" ${c.pixRepassa === true ? 'checked' : ''}> Quem paga cobre a taxa do Pix (${taxaTot.toFixed(2).replace('.', ',')}%)</label>
      <div class="note">Ligado: o responsável paga um pouco a mais e a escola recebe o valor cheio. Desligado: a taxa sai do valor recebido.</div>
      ${simTaxaHTML('jsim', 100)}
    </section>
    <section><h2>Mensalidade</h2>
      <div class="field"><label for="jnome">Nome da escola</label><input id="jnome" maxlength="60" value="${esc(S.escola.nome || '')}"></div>
      <div class="two"><div class="field"><label for="jvenc">Vencimento (dia)</label><input id="jvenc" type="number" min="1" max="28" value="${esc(c.vencDia || 10)}"></div><div></div></div>
      <div class="two"><div class="field"><label for="jirm">Desconto de irmãos (%)</label><input id="jirm" type="number" min="0" max="100" value="${esc(Math.round((Number(c.descIrmas) || 0) * 100))}"></div>
      <div class="field"><label for="jmul">Mais de uma atividade (%)</label><input id="jmul" type="number" min="0" max="100" value="${esc(Math.round((Number(c.descMulti) || 0) * 100))}"></div></div>
      <div class="note">Estes são os percentuais dos botões rápidos. O desconto só vale para o(a) aluno(a) em que você escolher, no cadastro dele(a).</div>
    </section>
    ${OUTRAS_FORMAS ? `<section><h2>Formas de pagamento</h2>
      <button type="button" class="linha-botao" id="jformas"><span class="grow"><b>Pix${formasCfg().boleto ? ', boleto' : ''}${formasCfg().cartao ? ', cartão' : ''}${formasCfg().cartao && formasCfg().parcelado ? ` (até ${formasCfg().maxParcelas}x)` : ''}</b><span class="s">Escolha o que a família pode usar e confira as taxas da sua conta</span></span><span aria-hidden="true">›</span></button>
    </section>` : ''}
    <section><h2>Multa e juros por atraso</h2>
      <label class="check"><input type="checkbox" id="jatr" ${(c.atraso || {}).ativo ? 'checked' : ''}> Cobrar multa e juros nas cobranças vencidas</label>
      <div class="two"><div class="field"><label for="jamul">Multa (%)</label><input id="jamul" inputmode="decimal" value="${esc(String((c.atraso || {}).multa ?? 2).replace('.', ','))}"></div>
      <div class="field"><label for="jajur">Juros (% ao mês)</label><input id="jajur" inputmode="decimal" value="${esc(String((c.atraso || {}).juros ?? 1).replace('.', ','))}"></div></div>
      <div class="aviso-lei"><b>Limite da lei</b><span>Multa de no máximo <b>2%</b> e juros de no máximo <b>1% ao mês</b>, contados por dia de atraso (Código de Defesa do Consumidor, art. 52, §1º, e Código Civil). Para cobrar, a multa e os juros precisam estar previstos no contrato de matrícula ou combinados com a família.</span></div>
      <div class="note">Exemplo: mensalidade de R$ 260,00 paga com 15 dias de atraso = R$ 260,00 + R$ 5,20 de multa + R$ 1,30 de juros. A família vê o acréscimo separado, e você pode tirar de uma cobrança específica na cobrança do aluno.</div>
    </section>
    <section><h2>Privacidade e dados</h2>
      <button type="button" class="linha-botao" id="jpriv"><span class="grow"><b>Pedidos das famílias e cópia dos dados</b><span class="s">${Object.values(S.pedidos || {}).filter(x => x.status !== 'feito').length ? `<b style="color:var(--out)">${Object.values(S.pedidos).filter(x => x.status !== 'feito').length} pedido(s) pendente(s)</b>` : 'LGPD: exclusão, cópia de segurança e documentos'}</span></span><span aria-hidden="true">›</span></button>
    </section>
    <section><h2>Mensagens do WhatsApp</h2>
      <button type="button" class="linha-botao" id="jmsgs"><span class="grow"><b>Lembrete, atraso e acordo</b><span class="s">${S.cfg.modelos && Object.values(S.cfg.modelos).some(Boolean) ? 'Com o texto da escola' : 'Usando o texto padrão'} · toque para editar</span></span><span aria-hidden="true">›</span></button>
    </section>
    <section><h2>Administração da escola</h2><div id="jadms"></div></section>
    <section><h2>Aparência</h2>
      <button type="button" class="linha-botao" id="japar">${c.logo ? `<img src="${esc(c.logo)}" alt="" class="mini-logo">` : '<span class="mini-logo vazio">Logo</span>'}<span class="grow"><b>Cor e logo da escola</b><span class="s">Toque para mudar</span></span><span class="cor-amostra" style="background:${hexOk(c.cor) ? c.cor : COR_PADRAO}"></span><span aria-hidden="true">›</span></button>
    </section>
    <div class="err" id="jerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Fechar</button><button class="btn" id="jok">Salvar ajustes</button></div>
    <section><h2>Conta</h2><div class="sub">${esc(EU.nome || '')} · ${esc(EU.email || '')}</div>
      <div class="actions"><button class="btn ghost" id="jtroca">Minhas escolas</button><button class="btn ghost" id="jsair">Sair da conta</button></div></section>`, () => {
    if ($('jsimv')) { const verJ = ligarSimTaxa('jsim', () => $('jrep').checked); $('jrep').addEventListener('change', verJ); }
    const err = m => $('jerr').textContent = m;
    $('japar').onclick = () => abrirDe(sheetAjustes, sheetAparencia);
    $('jmsgs').onclick = () => abrirDe(sheetAjustes, () => sheetModelos());
    $('jpriv').onclick = () => abrirDe(sheetAjustes, sheetPrivEscola);
    blocoAdms($('jadms'));
    if ($('jformas')) $('jformas').onclick = () => abrirDe(sheetAjustes, sheetFormasEscola);
    const acao = (id, a) => { if ($(id)) $(id).onclick = async () => { $(id).disabled = true; try { await mpConta(a); if (a !== 'conectar' || MOCK) sheetAjustes(); } catch (e) { err(msgErro(e)); $(id).disabled = false; } }; };
    acao('mpcon', 'conectar'); acao('mpinfo', 'info'); acao('mpout', 'conectar');
    if ($('mpdes')) $('mpdes').onclick = () => confirmar('Desconectar o Mercado Pago?', 'Os responsáveis não vão conseguir pagar por Pix no app até você conectar de novo. Os pagamentos já feitos continuam registrados.', 'Desconectar', () => mpConta('desconectar'));
    if ($('mpsim')) $('mpsim').onclick = async () => { try { await B.set(`escolas/${S.eid}/config/mp`, { confirmada: true }, { merge: true }); aviso('Conta confirmada'); S.mpc.confirmada = true; sheetAjustes(); } catch (e) { err(msgErro(e)); } };
    $('jtroca').onclick = () => { fecharSheet(); telaInicio(); }; $('jsair').onclick = () => { fecharSheet(); B.sair(); };
    $('jok').onclick = async () => {
      const nome = $('jnome').value.trim(), venc = Number($('jvenc').value), irm = Number($('jirm').value), mul = Number($('jmul').value);
      if (!nome) return err('Digite o nome da escola.'); if (!(venc >= 1 && venc <= 28)) return err('O vencimento vai do dia 1 ao 28.');
      if (!(irm >= 0 && irm <= 100) || !(mul >= 0 && mul <= 100)) return err('Os descontos vão de 0 a 100%.');
      const aMul = parseValor($('jamul').value), aJur = parseValor($('jajur').value);
      if (!(aMul >= 0) || aMul > MULTA_MAX) return err('A multa por atraso pode ser de no máximo 2%, pela lei.');
      if (!(aJur >= 0) || aJur > JUROS_MAX) return err('Os juros por atraso podem ser de no máximo 1% ao mês, pela lei.');
      $('jok').disabled = true;
      try { await B.lote([{ op: 'merge', p: `escolas/${S.eid}/config/geral`, d: { vencDia: venc, descIrmas: irm / 100, descMulti: mul / 100, pixRepassa: $('jrep').checked, pixChave: $('jpix').value.trim(), atraso: { ativo: $('jatr').checked, multa: aMul, juros: aJur } } }, { op: 'merge', p: 'escolas/' + S.eid, d: { nome } }]); fecharSheet(); aviso('Ajustes salvos'); }
      catch (e) { err(msgErro(e)); $('jok').disabled = false; }
    };
  });
}
// tela própria para cor e logo: muda na hora para você ver; só fica valendo ao salvar
function sheetAparencia() {
  const c = S.cfg; let cor = hexOk(c.cor) ? c.cor : COR_PADRAO, marca = { logo: c.logo || null, logoPdf: c.logoPdf || null };
  PREVIA_MARCA = true;
  sheet(`<h3>Cor e logo</h3>
    <div class="sub">Aparecem para todos que usam o app da escola. A logo também vai no relatório em PDF.</div>
    <div class="field"><span class="lb">Logo da escola</span>
      <div class="logo-linha"><div class="logo-prev" id="ylogop"></div>
        <div class="grow" style="display:flex;flex-direction:column;gap:8px">
          <span class="btn ghost toque-arquivo">Escolher imagem<input type="file" id="ylogo" accept="image/*" aria-label="Escolher imagem da logo"></span>
          <button type="button" class="btn ghost" id="ylogox" style="color:var(--out)">Tirar logo</button></div></div>
      <div class="note">Pode ser foto ou imagem com fundo. O app tenta tirar o fundo sozinho e mostra antes de usar.</div></div>
    <div class="corte" id="ycorte" hidden>
      <div class="label">Tirar o fundo da logo</div>
      <div class="corte-par"><figure><div class="xadrez"><img id="yimgo" alt="Como enviou"></div><figcaption>Como enviou</figcaption></figure>
        <figure><div class="xadrez"><img id="yimgs" alt="Sem fundo"></div><figcaption>Sem o fundo</figcaption></figure></div>
      <div class="field"><label for="ytol">Força do corte</label><input type="range" id="ytol" min="8" max="140" value="48"><div class="corte-escala"><span>Tira menos</span><span>Tira mais</span></div></div>
      <div class="corte-msg" id="ycmsg"></div>
      <div class="actions"><button type="button" class="btn ghost" id="yantes">Ficar como antes</button><button type="button" class="btn" id="ysem">Usar sem fundo</button></div>
    </div>
    <div class="field"><span class="lb">Cor principal</span>
      <div class="cores">${CORES.map(([h, n]) => `<button type="button" class="cor" data-cor="${h}" style="background:${h}" aria-label="${n}"></button>`).join('')}</div>
      <div class="two" style="align-items:end"><div class="field"><label for="yhex">Outra cor (código)</label><input id="yhex" maxlength="7" placeholder="#2357C6" autocapitalize="characters"></div>
        <div class="field"><span class="lb">ou escolha</span><span class="btn ghost toque-arquivo" id="ycorbtn">Paleta de cores<input type="color" id="ycor" aria-label="Paleta de cores"></span></div></div></div>
    <div class="field"><span class="lb">Exemplo de como fica</span><div class="previa" id="yprev" aria-hidden="true"></div><div class="note">É só uma amostra das cores, não precisa tocar.</div></div>
    <div class="err" id="yerr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn" id="yok">Salvar cor e logo</button></div>`, s => {
    const ver = () => {
      aplicarTema(cor);
      $('ycor').value = cor; if (document.activeElement !== $('yhex')) $('yhex').value = cor.toUpperCase();
      s.querySelectorAll('[data-cor]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cor.toLowerCase() === cor.toLowerCase()));
      $('ylogop').innerHTML = marca.logo ? `<img src="${esc(marca.logo)}" alt="Logo">` : '<span>Sem logo</span>'; $('ylogox').hidden = !marca.logo;
      $('yprev').innerHTML = `<div class="previa-topo">${marca.logo ? `<img src="${esc(marca.logo)}" alt="">` : ''}<b>${esc(S.escola.nome || 'Escola')}</b></div>
        <div class="actions"><span class="btn" style="flex:1">Botão</span><span class="chip pix" style="align-self:center">Etiqueta</span><span class="pick" aria-pressed="true" style="align-self:center">Selecionado</span></div>`;
    };
    s.querySelectorAll('[data-cor]').forEach(b => b.addEventListener('click', () => { cor = b.dataset.cor; ver(); }));
    const daPaleta = e => { if (hexOk(e.target.value)) { cor = e.target.value; ver(); } };
    $('ycor').addEventListener('input', daPaleta); $('ycor').addEventListener('change', daPaleta);
    $('yhex').addEventListener('input', e => { let v = e.target.value.trim(); if (v && v[0] !== '#') v = '#' + v; if (hexOk(v)) { cor = v; ver(); } });
    // escolheu a imagem: tenta tirar o fundo e pergunta se ficou bom
    let original = null, semFundo = null, pend = 0;
    const refazer = () => {
      semFundo = tirarFundo(original, Number($('ytol').value));
      $('yimgs').src = semFundo.canvas.toDataURL('image/png');
      $('ycmsg').className = 'corte-msg' + (semFundo.ok ? '' : ' alerta');
      $('ycmsg').textContent = semFundo.ok ? 'Ficou bom? Se o fundo ainda aparece, aumente a força do corte. Se sumiu parte da logo, diminua.'
        : semFundo.motivo + ' Quer deixar a logo como antes?';
      $('ysem').disabled = semFundo.canvas === original;
      // quando o corte não ficou bom, o botão em destaque passa a ser "Ficar como antes"
      $('ysem').className = semFundo.ok ? 'btn' : 'btn ghost'; $('yantes').className = semFundo.ok ? 'btn ghost' : 'btn';
    };
    $('ytol').addEventListener('input', () => { cancelAnimationFrame(pend); pend = requestAnimationFrame(refazer); });
    $('ylogo').addEventListener('change', async e => {
      $('yerr').textContent = ''; const f = e.target.files[0]; e.target.value = '';
      try {
        original = await abrirImagem(f, 480);
        if (jaSemFundo(original)) { marca = gerarMarca(original); $('ycorte').hidden = true; ver(); aviso('A imagem já veio sem fundo.'); return; }
        $('yimgo').src = original.toDataURL('image/png'); $('ytol').value = 48; refazer();
        $('ycorte').hidden = false; $('ycorte').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (x) { $('yerr').textContent = x.message; }
    });
    $('ysem').addEventListener('click', () => { marca = gerarMarca(semFundo.canvas); $('ycorte').hidden = true; ver(); aviso('Logo sem fundo pronta. Toque em salvar.'); });
    $('yantes').addEventListener('click', () => { marca = gerarMarca(original); $('ycorte').hidden = true; ver(); aviso('Logo mantida como enviou.'); });
    $('ylogox').addEventListener('click', () => { marca = { logo: null, logoPdf: null }; ver(); });
    $('yok').addEventListener('click', async () => {
      $('yok').disabled = true;
      try { await B.set(`escolas/${S.eid}/config/geral`, { cor, logo: marca.logo, logoPdf: marca.logoPdf }, { merge: true }); PREVIA_MARCA = false; MARCA_ATUAL = ''; fecharSheet(); aviso('Cor e logo salvas'); }
      catch (e) { $('yerr').textContent = msgErro(e); $('yok').disabled = false; }
    });
    ver();
  }, () => { PREVIA_MARCA = false; MARCA_ATUAL = ''; aplicarMarca(S.cfg); });
}

/* ================= Dados de exemplo (só no modo de teste) ================= */
async function semearMock() {
  await B.cadastrar('Patrícia Lins', 'familia@teste.com', '123456'); const uF = window.__mock.cur().uid; await B.sair();
  await B.cadastrar('Paula Diretora', 'admin@teste.com', '123456'); const uA = window.__mock.cur().uid;
  const eid = 'esc1', p = `escolas/${eid}`, m = mesHoje(), m1 = mesMais(m, -1), m2 = mesMais(m, -2), set = (q, d) => B.set(q, d);
  const cfg = { atraso: { ativo: true, multa: 2, juros: 1 }, vencDia: 10, pixRepassa: false, descIrmas: 0.1, descMulti: 0.15, mpConectadoEm: Date.now(), mpTaxaApp: 0.01, pixChave: '12.345.678/0001-90' };
  // ?mock=1&marca=1: a escola de exemplo com cor e escudo próprios (para ver a abertura com a cara da escola)
  if (/[?&]marca=1/.test(location.search)) { cfg.cor = '#1E5A8A'; cfg.logo = 'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><path d='M40 4 70 14v24c0 19-13 32-30 38C23 70 10 57 10 38V14z' fill='#1E5A8A'/><path d='M40 12 62 19v19c0 14-9 24-22 29-13-5-22-15-22-29V19z' fill='#fff'/><text x='40' y='47' text-anchor='middle' font-family='Arial Black,Arial' font-weight='900' font-size='19' fill='#1E5A8A'>EM</text></svg>"); }
  await set(p, { nome: 'Escolinha Movimento', dono: uA, admins: [uA], adminsInfo: { [uA]: { nome: 'Paula Diretora', email: 'admin@teste.com', em: Date.now() - 200 * 864e5 } } });
  await set(`${p}/config/geral`, cfg);
  await set(`${p}/config/mp`, { conta: { nome: 'Paula Diretora Souza', doc: '***.456.789-**' }, confirmada: true });
  await set(`${p}/locais/l1`, { nome: 'Unidade Centro', ordem: 1 }); await set(`${p}/locais/l2`, { nome: 'Unidade Praia', ordem: 2 });
  await set(`${p}/professoras/p1`, { nome: 'Juliana Costa', telefone: '(81) 95555-1111', mpConectadoEm: Date.now(), mpConta: 'Juliana Costa', mpContaInfo: 'juliana.costa@email.com', pixChave: '(81) 95555-1111' });
  await set(`${p}/professoras/p2`, { nome: 'Camila Ribeiro', telefone: '(81) 95555-2222', mpConectadoEm: Date.now(), mpConta: 'Camila Ribeiro', mpContaInfo: 'camila.ribeiro@email.com', pixChave: 'camila.ribeiro@email.com' });
  await set(`${p}/professoras/p3`, { nome: 'Rafael Souza', telefone: '(81) 95555-3333' });
  await set(`${p}/professoras/p4`, { nome: 'Beatriz Nunes', telefone: '(81) 95555-4444' });
  const turmas = {
    t1: { nome: 'Iniciação', idadeMin: 6, idadeMax: 8, professoraId: 'p1', recebedor: 'p1', localId: 'l1', horario: 'Seg e Qua, 17h às 18h', preco: 180, vagas: 15, ordem: 1 },
    t2: { nome: 'Pré-equipe', idadeMin: 9, idadeMax: 12, professoraId: 'p1', recebedor: 'p1', localId: 'l1', horario: 'Ter, Qui e Sáb, 15h às 17h', preco: 260, vagas: 12, ordem: 2 },
    t3: { nome: 'Artística livre', todasIdades: true, professoraId: 'p2', recebedor: 'p2', localId: 'l1', horario: 'Sex, 16h às 17h30', preco: 150, ordem: 3 },
    t4: { nome: 'Baby class', idadeMin: 3, idadeMax: 5, professoraId: 'p2', recebedor: 'p2', localId: 'l2', horario: 'Sáb, 9h às 10h', preco: 130, vagas: 10, ordem: 4 },
    t5: { nome: 'Futebol Sub-8', idadeMin: 6, idadeMax: 8, professoraId: 'p3', recebedor: 'escola', localId: 'l2', horario: 'Ter e Qui, 18h às 19h', preco: 170, ordem: 5 },
    t6: { nome: 'Futebol Sub-12', idadeMin: 9, idadeMax: 12, professoraId: 'p3', recebedor: 'escola', localId: 'l2', horario: 'Seg e Qua, 18h às 19h30', preco: 200, ordem: 6 } };
  for (const [k, v] of Object.entries(turmas)) await set(`${p}/turmas/${k}`, v);
  // r1b é um cadastro repetido da Patrícia (mesmo telefone): mostra a sugestão de agrupar
  const resps = { r1: ['Patrícia Lins', '(81) 99999-1001', '123.456.789-01', 'K7Q2MX'], r1b: ['Patrícia Lins', '81 999991001', '', 'H4N8PW'], r2: ['Roberto Melo', '(81) 98888-2002', '', 'P3T8ZA'], r3: ['Carla Andrade', '(81) 97777-3003', '', 'B9W4HN'], r4: ['Fernanda Rocha', '(81) 96666-4004', '', 'R2D5KC'] };
  for (const [id, [nome, telefone, cpf, cod]] of Object.entries(resps)) { await set(`${p}/responsaveis/${id}`, { nome, telefone, cpf, codigo: cod }); await set('codigos/' + cod, { eid, rid: id }); }
  const alunas = { al1: { nome: 'Sofia Lins', responsavelId: 'r1', turmas: ['t2', 't3'], nascimento: '2016-03-14', descMultiOk: true }, al2: { nome: 'Helena Lins', responsavelId: 'r1b', turmas: ['t4'], nascimento: '2021-08-02' }, al3: { nome: 'Luíza Melo', responsavelId: 'r2', turmas: ['t1'], nascimento: '2018-11-20' },
    al4: { nome: 'Ana Beatriz Andrade', responsavelId: 'r3', turmas: ['t2'], desc: { pct: 0.5, motivo: 'Atleta destaque' }, nascimento: '2015-06-09' }, al5: { nome: 'Pedro Rocha', responsavelId: 'r4', turmas: ['t5'], nascimento: '2017-01-27' }, al6: { nome: 'Alice Rocha', responsavelId: 'r4', turmas: ['t4'], nascimento: '2022-04-15' } };
  for (const [k, v] of Object.entries(alunas)) { v.inicio = m2; v.ativa = true; v.desc = v.desc || null; await set(`${p}/alunas/${k}`, v); }
  await set(`${p}/grupos/g1`, { nome: 'Equipe competitiva', alunas: ['al1', 'al3', 'al4'] });
  await set(`${p}/grupos/g2`, { nome: 'Vai ao Estadual', alunas: ['al1', 'al4'] });
  await set(`${p}/extras/x1`, { tipo: 'evento', semCobranca: true, nome: 'Torneio Regional', data: `${mesMais(m, 1)}-06`, dataFim: `${mesMais(m, 1)}-09`, local: 'Caruaru', organizador: 'Federação Pernambucana', valorInscricao: 85, prazo: `${m}-28`, convidados: ['al1', 'al3', 'al4'], origem: { grupos: ['g1'] }, part: { al3: { st: 'inscrito', em: Date.now() - 3 * 864e5, quem: 'escola' }, al4: { st: 'interesse', em: Date.now() - 864e5, quem: 'familia' } }, v: 0, alunas: [], grupos: [], turmas: [] });
  await set(`${p}/extras/x2`, { tipo: 'taxa', nome: 'Taxa da federação 2027', v: 40, venc: `${m}-12`, grupos: ['g2'], turmas: [], alunas: [], recebedor: 'escola' });
  await set(`${p}/extras/x3`, { tipo: 'evento', nome: 'Festival de fim de ano', data: `${mesMais(m, 1)}-29`, local: 'Ginásio da escola', v: 60, venc: `${mesMais(m, 1)}-05`, grupos: [], turmas: ['t1', 't2', 't3', 't4', 't5', 't6'], alunas: [], recebedor: 'escola' });
  await set(`${p}/extras/x6`, { tipo: 'evento', cobranca: 'app', semCobranca: false, nome: 'Copa de Futebol Sub-8', data: `${mesMais(m, 1)}-14`, dataFim: `${mesMais(m, 1)}-15`, local: 'Olinda', organizador: 'Liga Olindense', convidados: ['al5'], origem: { turmas: ['t5'] }, part: { al5: { st: 'interesse', em: Date.now() - 2 * 864e5, quem: 'familia' } }, v: 50, venc: `${mesMais(m, 1)}-05`, recebedor: 'escola', valores: {}, alunas: ['al5'], grupos: [], turmas: [] });
  await set(`${p}/extras/x4`, { tipo: 'evento', semCobranca: true, nome: 'Copa Nordeste', data: `${Number(m.slice(0, 4)) + 1}-03-19`, dataFim: `${Number(m.slice(0, 4)) + 1}-03-22`, local: 'Fortaleza', organizador: 'Confederação', valorInscricao: 120, convidados: ['al1', 'al3', 'al4'], origem: { grupos: ['g1'] }, part: {}, v: 0, alunas: [], grupos: [], turmas: [] });
  await set(`${p}/extras/x5`, { tipo: 'evento', semCobranca: true, nome: 'Campeonato Estadual', data: `${Number(m.slice(0, 4)) + 1}-07-10`, dataFim: `${Number(m.slice(0, 4)) + 1}-07-12`, local: 'Recife', organizador: 'Federação Pernambucana', convidados: ['al1', 'al4'], origem: { grupos: ['g2'] }, part: { al1: { st: 'interesse', em: Date.now() - 864e5, quem: 'familia' } }, v: 0, alunas: [], grupos: [], turmas: [] });
  const pago = (v, via, d) => ({ s: 'pago', v, via, d, obs: via === 'pix' ? 'Pix automático' : 'Marcado pela administração' });
  let k = 0;
  for (const alid of Object.keys(alunas)) {
    const up = { mens: {}, extras: {} };
    for (const mm of [m2, m1]) { if (mm === m1 && ['al5', 'al6'].includes(alid)) continue; const r = C.mensalidade(alunas, alid, mm, turmas, cfg); if (r) up.mens[mm] = pago(r.v, k++ % 3 ? 'pix' : 'dinheiro', `${mm}-0${(k % 8) + 1}`); }
    if (alid === 'al3') up.mens[m] = pago(C.mensalidade(alunas, 'al3', m, turmas, cfg).v, 'pix', `${m}-09`);
    if (alid === 'al4') up.extras.x2 = pago(40, 'pix', `${m}-05`);
    await set(`${p}/pagamentos/${alid}`, up);
  }
  await set(`${p}/lancamentos/c1`, { tipo: 'saida', cat: 'Professores e equipe', desc: 'Professor de futebol', v: 1800, data: `${m}-05` });
  await set(`${p}/lancamentos/c2`, { tipo: 'saida', cat: 'Aluguel do espaço', desc: 'Unidade Centro', v: 1200, data: `${m}-05`, localId: 'l1' });
  await set(`${p}/lancamentos/c3`, { tipo: 'saida', cat: 'Material esportivo', desc: 'Bolas e cones', v: 320, data: `${m}-03` });
  await set(`${p}/membros/${uF}`, { codigo: 'K7Q2MX', nome: 'Patrícia Lins', email: 'familia@teste.com' });
  const nao = { coracao: false, esforco: false, desmaio: false, doenca: false, ossos: false, outro: false };
  await set(`${p}/saude/al4`, { responsavelId: 'r3', respostas: { ...nao, doenca: true }, detalhes: 'Asma leve, usa bombinha antes de esforço intenso.', alergias: '', remedios: 'Bombinha (salbutamol) se precisar', plano: '', emergencia: { nome: 'Carla Andrade', telefone: '(81) 97777-3003', parentesco: 'mãe' }, primeirosSocorros: true, imagem: true, assinatura: { nome: 'Carla Andrade' }, em: Date.now() - 20 * 864e5, versao: 1, atestado: { pedidoEm: Date.now() - 20 * 864e5 } });
  await set(`${p}/saude/al3`, { responsavelId: 'r2', respostas: nao, detalhes: '', alergias: 'Dipirona', remedios: '', plano: 'Hapvida', emergencia: { nome: 'Roberto Melo', telefone: '(81) 98888-2002', parentesco: 'pai' }, primeirosSocorros: true, imagem: false, assinatura: { nome: 'Roberto Melo' }, em: Date.now() - 60 * 864e5, versao: 1, atestado: null });
  await set(`${p}/membros/${uF}/vinculos/r1`, { codigo: 'K7Q2MX' });
  await set('users/' + uA, { escolas: { [eid]: { nome: 'Escolinha Movimento', papel: 'admin' } } });
  // ?mock=1&duas=1: a administração também está numa segunda escola (para ver a escolha na abertura)
  if (/[?&]duas=1/.test(location.search)) {
    await set('escolas/e2', { nome: 'Ballet Arte', dono: uA, admins: [uA] }); await set('escolas/e2/config/geral', { vencDia: 10, cor: '#7A3E9D' });
    await set('escolas/e3', { nome: 'Escola de Futebol Craques do Amanhã Boa Viagem', dono: uA, admins: [] }); await set('escolas/e3/config/geral', { vencDia: 10, cor: '#F2C94C' });
    await set('users/' + uA, { escolas: { [eid]: { nome: 'Escolinha Movimento', papel: 'admin' }, e2: { nome: 'Ballet Arte', papel: 'admin' }, e3: { nome: 'Escola de Futebol Craques do Amanhã Boa Viagem', papel: 'familia', familia: 'Paula Diretora' } } });
  }
  await set('users/' + uF, { escolas: { [eid]: { nome: 'Escolinha Movimento', papel: 'familia', familia: 'Patrícia Lins' } } });
  await B.sair();
}

/* ================= Início ================= */
(async () => {
  mostrarAbertura();
  try { B = MOCK ? backendMock() : await backendReal(); }
  catch (e) { RAIZ().innerHTML = `<div class="login"><div class="logo">Ops<span>.</span></div><p>Não deu para carregar o app. Verifique a internet e tente de novo.</p></div>`; return; }
  if (!MOCK && (!CFG.firebase || /COLE-AQUI|SEU-PROJETO/.test(JSON.stringify(CFG.firebase)))) { RAIZ().innerHTML = `<div class="login"><div class="logo">Quase lá<span>.</span></div><p>Falta colocar os dados do projeto Firebase no arquivo <b>config.js</b>. Para ver o app funcionando com dados de exemplo, abra com <b>?mock=1</b> no fim do endereço.</p></div>`; return; }
  if (MOCK) await semearMock();
  // quem já entrou continua entrando direto (no app de verdade o Firebase guarda o login; no teste, guardamos aqui)
  if (MOCK && ls.get('escolinha.mockLogin')) { try { await B.login(ls.get('escolinha.mockLogin'), '123456'); } catch (e) { } }
  let vez = 0;
  B.onAuth(async u => {
    const minha = ++vez;
    pararOuvintes(); fecharSheet(); EU = u; $('toast').hidden = true;
    if (MOCK) ls.set('escolinha.mockLogin', u ? u.email || null : null);
    if (u) { INTRO_VISTA = true; ls.set('escolinha.introVista', '1'); } // já entrou: daqui em diante abre direto
    // sem conta (abriu sem login ou saiu da conta): a apresentação do app aparece de novo antes do login
    if (!u) { S = null; INTRO_VISTA = false; sairAbertura(); return telaLogin(); }
    const perfil = await B.get('users/' + u.uid).catch(() => null);
    if (minha !== vez) return;
    MINHAS = (perfil && perfil.escolas) || {};
    // convite para a administração: procura sem atrasar a abertura da escola
    convitesPara(u).then(c => { CONVITES = c || []; if (minha !== vez || !CONVITES.length) return; if (!S) telaInicio(); else aviso('Você tem um convite para a administração de outra escola. Veja em Ajustes → Minhas escolas.'); }).catch(() => { });
    if (MP_VOLTA && ls.get('escolinha.mpVolta') && MINHAS[ls.get('escolinha.mpVolta')]) { sairAbertura(); return abrirEscola(ls.get('escolinha.mpVolta')); }
    // uma escola: as cartas viram direto para ela; mais de uma: escolhe na própria abertura
    const ks = Object.keys(MINHAS);
    if (ks.length === 1) return abrirComCartas(ks[0]);
    if (ks.length > 1 && abEl()) return escolherNaAbertura();
    sairAbertura(); telaInicio();
  });
  if (MP_VOLTA) history.replaceState(null, '', location.pathname + (MOCK ? '?mock=1' : ''));
})();

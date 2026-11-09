/* Escolinha · app (administração da escola e área da família).
   Escola → locais → atividades → turmas. Cada aluno(a) pertence a uma família; o responsável
   paga tudo do mês num Pix só. Com ?mock=1 usa um banco de teste na memória, com dados de exemplo. */
const CFG = window.CONFIG || {}, C = window.Calc;
const MOCK = !!window.DEMO || new URLSearchParams(location.search).has('mock');
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const URLF = n => `https://${CFG.regiao || 'southamerica-east1'}-${(CFG.firebase || {}).projectId}.cloudfunctions.net/${n}`;
const MP_VOLTA = new URLSearchParams(location.search).get('mp');
// vindo do site (turmaemdia.com.br): ?entrar=escola|professor|familia abre em Entrar; ?entrar=novo abre em Criar conta (só na primeira tela)
let ENTRAR_PARAM = new URLSearchParams(location.search).get('entrar');
const ENTRAR_NOVO = () => { const r = ENTRAR_PARAM === 'novo'; ENTRAR_PARAM = null; return r; };

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
    recarregar: async () => { if (auth.currentUser) { await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); } },
    // aparelho para os avisos (push) do Firebase Cloud Messaging
    pushToken: async reg => { const M = await import(FB + 'firebase-messaging.js'); if (!(await M.isSupported())) return null; return M.getToken(M.getMessaging(app), { serviceWorkerRegistration: reg }); },
    sair: () => A.signOut(auth),
    token: async () => auth.currentUser ? auth.currentUser.getIdToken() : null,
    get: async p => { const s = await F.getDoc(ref(p)).catch(erro); return s.exists() ? s.data() : null; },
    set: (p, d, o) => F.setDoc(ref(p), d, o && o.merge ? { merge: true } : {}).catch(erro),
    tirar: (p, campo) => F.updateDoc(ref(p), { [campo]: F.deleteField() }).catch(erro),
    del: p => F.deleteDoc(ref(p)).catch(erro),
    ouvirDoc: (p, cb, err) => F.onSnapshot(ref(p), s => cb(s.exists() ? s.data() : null), e => err && err(e)),
    ultimos: async (p, campo, n) => (await F.getDocs(F.query(F.collection(fs, p), F.orderBy(campo, 'desc'), F.limit(n))).catch(erro)).docs.map(d => ({ id: d.id, data: d.data() })),
    meus: async (p, campo, v) => (await F.getDocs(F.query(F.collection(fs, p), F.where(campo, '==', v))).catch(erro)).docs.map(d => d.id),
    onde: async (p, campo, op, v) => (await F.getDocs(F.query(F.collection(fs, p), F.where(campo, op, v))).catch(erro)).docs.map(d => ({ id: d.id, data: d.data() })),
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
    reset: async () => { }, sair: async () => setA(null), token: async () => cur ? 'mock' : null, verificarEmail: async () => { }, recarregar: async () => { },
    get: async p => clone(store.get(p)) ?? null,
    set: async (p, d, o) => { aninhada(d, p); store.set(p, o && o.merge ? merge(store.get(p), clone(d)) : clone(d)); fire(p); },
    tirar: async (p, campo) => { const d = clone(store.get(p)) || {}; const ks = campo.split('.'); let o = d; for (const k of ks.slice(0, -1)) o = o[k] || {}; delete o[ks.at(-1)]; store.set(p, d); fire(p); },
    del: async p => { store.delete(p); fire(p); },
    ouvirDoc: (p, cb) => { setTimeout(() => cb(clone(store.get(p)) ?? null), 0); if (!docL.has(p)) docL.set(p, []); docL.get(p).push(cb); return () => docL.set(p, docL.get(p).filter(x => x !== cb)); },
    ultimos: async (p, campo, n) => colDocs(p).sort((a, b) => (b.data[campo] || 0) - (a.data[campo] || 0)).slice(0, n),
    meus: async (p, campo, v) => colDocs(p, [campo, v]).map(d => d.id),
    onde: async (p, campo, op, v) => colDocs(p).filter(d => op === 'array-contains' ? (d.data[campo] || []).includes(v) : op === '>=' ? d.data[campo] >= v : d.data[campo] === v),
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
const msgErroTexto = e => (e && (e.code === 'permission-denied' || e.code === 'plano-leitura') && typeof planoTrava === 'function' && planoTrava() ? MSG_LEITURA : null) || ERROS[e && e.code] || (e && e.message && !/firebase|undefined/i.test(e.message) ? e.message : 'Algo deu errado. Tente de novo.');
// erros "esperados" (senha errada, sem internet...) não vão para o registro; o resto vai
const ERROS_ESPERADOS = new Set(['invalid-credential', 'wrong-password', 'user-not-found', 'email-already-in-use', 'invalid-email', 'weak-password', 'missing-password', 'too-many-requests', 'network-request-failed', 'popup-closed-by-user', 'unavailable', 'cancelled-popup-request', 'popup-blocked', 'plano-leitura', 'reconectar', 'pausada']);
const msgErro = e => { try { if (e && ((e.code && !ERROS_ESPERADOS.has(e.code)) || e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError)) registrarErro(e, 'tratado'); } catch (x) { } return msgErroTexto(e); };

/* ================= Registro técnico de erros (igual ao Pelota FC) =================
   Erros de JavaScript, promessas rejeitadas, erros mostrados no console e erros inesperados dos try/catch vão para a
   coleção "erros", para o dono da plataforma ver (Painel do dono → Erros). Guarda só o necessário para achar o problema:
   mensagem, stack, código, tela, ação (o botão tocado, nunca o texto digitado), ID da conta, versão, aparelho, tamanho
   da tela, se o app está instalado e a data. Números longos (CPF, telefone) e e-mails são trocados por marcadores.
   O mesmo erro da mesma pessoa vai no máximo uma vez a cada 10 minutos: no aparelho e no banco (o id do documento inclui
   o intervalo de 10 minutos e as regras só deixam criar, nunca sobrescrever). No máximo 30 registros por abertura do app.
   Some sozinho depois de 90 dias (expiraEm, com a rotina diária do servidor). */
const VERSAO_APP = '2026.10.28';
const DEZ_MIN = 10 * 60 * 1000;
const ERR_IGNORA = /ResizeObserver loop|^Script error\.?$|Load failed|Failed to fetch|NetworkError|AbortError|operation was aborted|Sem conexão com o servidor/i;
let TELA_SHEET = '', ULTIMA_ACAO = '', ERROS_FILA = [], ERR_N = 0, ERR_ENVIANDO = false; const ERR_MEM = {};
const limpaErro = (x, max) => String(x == null ? '' : x).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').replace(/\d[\d.\-\/() ]{6,}\d/g, '[número]').slice(0, max);
const hashErro = t => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h.toString(36); };
function telaAtual() {
  let base = 'inicio';
  try { base = !EU ? 'login' : S ? `${S.papel === 'a' ? 'admin' : S.papel === 'p' ? 'professor' : 'familia'}/${S.tab}` : document.getElementById('abertura') ? 'abertura' : 'minhas-escolas'; } catch (x) { }
  return TELA_SHEET ? `${base} > ${TELA_SHEET}` : base;
}
// a ação: qual botão ou campo foi tocado (id ou atributo data-*), nunca o texto da tela
document.addEventListener('click', e => {
  try { const el = e.target && e.target.closest && e.target.closest('button,a,[data-ev],[data-tab],li.tap,input,select,label'); if (!el) return;
    const dat = Object.keys(el.dataset || {})[0];
    ULTIMA_ACAO = (el.id ? '#' + el.id : dat ? `[data-${dat.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}]` : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '')).slice(0, 80);
  } catch (x) { }
}, true);
function registrarErro(err, origem) {
  try {
    if (!err || ERR_ENVIANDO) return;
    const e = err instanceof Error ? err : typeof err === 'string' ? new Error(err) : Object.assign(new Error((err && (err.message || err.reason)) || JSON.stringify(err).slice(0, 300)), { code: err.code, status: err.status, stack: err.stack || '' });
    const cod = String(e.code || '').replace(/^(auth|firestore)\//, '');
    const msg = limpaErro((cod ? `[${cod}] ` : '') + (e.message || 'erro sem mensagem'), 500);
    if (ERR_IGNORA.test(e.message || '') || ERROS_ESPERADOS.has(cod) || [400, 401, 403, 404, 409].includes(e.status) || ERR_N >= 30) return;
    const stack = limpaErro(e.stack || '', 4000);
    const chave = hashErro(msg + '|' + (stack.split('\n').find(l => /:\d+:\d+/.test(l)) || '')), agora = Date.now();
    let uid = ''; try { uid = (EU && EU.uid) || ''; } catch (x) { }
    const k = chave + '.' + uid; let vistos = {}; try { vistos = JSON.parse(ls.get('ted.errosVistos') || '{}'); } catch (x) { }
    if (agora - Math.max(ERR_MEM[k] || 0, vistos[k] || 0) < DEZ_MIN) return;
    ERR_MEM[k] = agora; vistos[k] = agora; for (const x of Object.keys(vistos)) if (agora - vistos[x] > DEZ_MIN) delete vistos[x];
    ls.set('ted.errosVistos', JSON.stringify(vistos));
    ERR_N++;
    const d = { msg, stack, chave, cod: cod.slice(0, 60), tela: telaAtual().slice(0, 120), acao: ULTIMA_ACAO, origem: String(origem || 'js').slice(0, 30), versao: VERSAO_APP,
      aparelho: String(navigator.userAgent || '').slice(0, 250), telaPx: `${innerWidth}x${innerHeight}`, pwa: !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches || navigator.standalone),
      url: limpaErro(location.pathname + location.search, 200), em: agora, expiraEm: new Date(agora + 90 * 864e5) };
    ERROS_FILA.push(d); if (ERROS_FILA.length > 5) ERROS_FILA.shift();
    enviarErros();
  } catch (x) { }
}
window.registrarErro = registrarErro;
async function enviarErros() {
  let uid = ''; try { uid = (EU && EU.uid) || ''; } catch (x) { }
  if (!uid || !B || !ERROS_FILA.length) return;
  const fila = ERROS_FILA; ERROS_FILA = [];
  for (const d of fila) { ERR_ENVIANDO = true; try { await B.set(`erros/${uid}_${d.chave}_${Math.floor(d.em / DEZ_MIN)}`, { ...d, uid }); } catch (x) { } finally { ERR_ENVIANDO = false; } }
}
window.addEventListener('error', ev => { if (ev && (ev.error || ev.message)) registrarErro(ev.error || { message: String(ev.message), stack: `${ev.filename || ''}:${ev.lineno || 0}:${ev.colno || 0}` }, 'janela'); });
window.addEventListener('unhandledrejection', ev => { const r = ev && ev.reason; registrarErro(r instanceof Error ? r : { message: 'Promessa rejeitada: ' + ((r && (r.message || r)) || ''), stack: (r && r.stack) || '', code: r && r.code }, 'promessa'); });
// erros mostrados no console (console.warn/console.error com um erro dentro)
['warn', 'error'].forEach(n => { const orig = console[n].bind(console); console[n] = (...a) => { orig(...a); try { const e = a.find(x => x instanceof Error || (x && typeof x === 'object' && x.message && (x.stack || x.code))); if (e) registrarErro(e, 'console'); } catch (x) { } }; });
function aviso(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(aviso.t); aviso.t = setTimeout(() => t.hidden = true, 3200); }
async function copiar(txt, ok) { try { await navigator.clipboard.writeText(txt); aviso(ok || 'Copiado'); } catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); aviso(ok || 'Copiado'); } catch (_) { aviso('Não deu para copiar. Selecione o texto e copie.'); } ta.remove(); } }
function qrSVG(txt) { if (typeof qrcode !== 'function') return ''; const q = qrcode(0, 'M'); q.addData(txt); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
const LINK_APP = location.origin + location.pathname;
const ICO = {
  lupa: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  evento: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M12 13.2l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  painel: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  pend: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 8.6v5.2" stroke-width="2.6"/><circle cx="12" cy="17" r="1.45" fill="currentColor" stroke="none"/></svg>',
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
const MARCA_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="4" y="9" width="56" height="51" rx="15" fill="currentColor"/><rect x="17" y="3" width="7" height="14" rx="3.5" fill="currentColor" stroke="var(--marca-borda,#fff)" stroke-width="3"/><rect x="40" y="3" width="7" height="14" rx="3.5" fill="currentColor" stroke="var(--marca-borda,#fff)" stroke-width="3"/><path d="M19 36.5l9 9 17-18" fill="none" stroke="#34C759" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const NOME_APP = () => CFG.nomeApp || 'Turma em Dia';
// topo da página inicial: marca, nome, para que serve e as três vantagens
function capaApp(compacta) {
  const vant = [['cobr', 'Cobranças', 'Pix, boleto ou cartão, com baixa automática assim que a família paga.'],
    ['escola', 'Turmas e alunos', 'Chamada, frequência de cada aluno e informações de saúde à mão, com segurança.'],
    ['filhas', 'Famílias', 'Pagam, acompanham os eventos, enviam documentos e falam com a escola com facilidade.'],
    ['caixa', 'Financeiro', 'Controle total do caixa: pagamentos, juros, acordos, nota fiscal e muito mais.']];
  return `<div class="capa ${compacta ? 'compacta' : ''}">
      <div class="capa-marca">${MARCA_SVG}</div>
      <h1 class="capa-nome">${esc(NOME_APP())}</h1>
      <p class="capa-frase">Tudo da sua escolinha em um só lugar.</p>
      ${compacta ? '' : '<p class="capa-sub">Para escolinhas de esporte, dança, luta, música e o que mais for.</p>'}
      ${compacta ? `<ul class="capa-vant">${[['Turmas e chamada', 'Horários, professores, vagas e a frequência de cada aluno.'], ['Cobrança automática', 'A família paga e a mensalidade já aparece como paga.'], ['Eventos e documentos', 'Calendário, inscrições, termos e atestados no mesmo lugar.'], ['O caixa da escola', 'Entradas, saídas, acordos e o repasse dos professores.']].map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('')}</ul>` : ''}
    </div>`;
}
function vantagensApp() {
  const vant = [['cobr', 'Cobranças', 'Pix, boleto ou cartão, com baixa automática assim que a família paga.'],
    ['escola', 'Turmas e alunos', 'Chamada, frequência de cada aluno e informações de saúde à mão, com segurança.'],
    ['filhas', 'Famílias', 'Pagam, acompanham os eventos, enviam documentos e falam com a escola com facilidade.'],
    ['caixa', 'Financeiro', 'Controle total do caixa: pagamentos, juros, acordos, nota fiscal e muito mais.']];
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="9" width="56" height="51" rx="15" fill="rgba(255,255,255,.14)" stroke="#fff" stroke-width="3"/><rect x="17" y="3" width="7" height="14" rx="3.5" fill="#fff" stroke="${app}" stroke-width="3"/><rect x="40" y="3" width="7" height="14" rx="3.5" fill="#fff" stroke="${app}" stroke-width="3"/><path d="M19 36.5l9 9 17-18" fill="none" stroke="#34C759" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
  const vant = [['cobr', 'Cobranças', 'Pix, boleto ou cartão, com baixa automática assim que a família paga.'],
    ['escola', 'Turmas e alunos', 'Chamada, frequência de cada aluno e informações de saúde à mão, com segurança.'],
    ['filhas', 'Famílias', 'Pagam, acompanham os eventos, enviam documentos e falam com a escola com facilidade.'],
    ['caixa', 'Financeiro', 'Controle total do caixa: pagamentos, juros, acordos, nota fiscal e muito mais.']];
  RAIZ().innerHTML = `<div class="intro">
    <div class="intro-topo"><span class="marca-mini">${MARCA_SVG}</span><b>${esc(NOME_APP())}</b><button class="intro-pular" id="ipular">Pular</button></div>
    <ul class="vantagens intro-lista">${vant.map(([ic, t, d], i) => `<li class="sobe" style="--d:${400 + i * 1100}ms"><span class="vant-ic">${ICO[ic] || ''}</span><span class="grow"><b>${esc(t)}</b><span class="s">${esc(d)}</span></span></li>`).join('')}</ul>
    <div class="intro-fim sobe" style="--d:${400 + vant.length * 1100}ms">
      <div class="intro-barra"><i></i></div>
      <button class="btn" id="iseguir" style="width:100%;padding:15px">Continuar</button>
    </div></div>`;
  let foi = false, t = null, resta = MOVIMENTO ? 8000 : 4000, desde = Date.now();
  const seguir = () => { if (foi) return; foi = true; clearTimeout(t); const r = RAIZ().firstElementChild; if (r && MOVIMENTO) { r.classList.add('saindo'); setTimeout(depois, 300); } else depois(); };
  t = setTimeout(seguir, resta);
  $('iseguir').onclick = seguir; $('ipular').onclick = seguir;
  // segurar o dedo na tela (fora dos botões) pausa a apresentação, como pausar um vídeo; soltou, continua
  const el = RAIZ().querySelector('.intro');
  let pausado = false;
  const pausar = e => { if (foi || pausado || (e.target && e.target.closest('button'))) return; pausado = true; clearTimeout(t); resta = Math.max(300, resta - (Date.now() - desde)); el.classList.add('pausado'); };
  const continuar = () => { if (!pausado || foi) return; pausado = false; desde = Date.now(); el.classList.remove('pausado'); t = setTimeout(seguir, resta); };
  el.addEventListener('pointerdown', pausar); ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, continuar));
  el.addEventListener('contextmenu', e => e.preventDefault());
}
function telaLogin(modo = 'entrar') {
  // primeira vez nesta abertura do app: espera a tela de abertura e mostra o que o app faz
  if (!INTRO_VISTA && modo === 'entrar') { return (ABERTURA || Promise.resolve()).then(() => { if (!EU) telaIntro(() => { if (!EU) telaLogin(modo); }); }); }
  // Por enquanto (modo de teste): entrada direta, sem e-mail e senha
  if (MOCK && modo !== 'senha') {
    RAIZ().innerHTML = `<div class="login entrada">
      ${capaApp(true)}
      <div class="login-form">
      <section class="entrar-box sobe" style="--d:150ms"><h2>Entrar como</h2>
        <button class="entrar-op" id="eadm"><span class="vant-ic forte">${ICO.painel || ICO.cobr}</span><span class="grow"><b>Administração</b><span class="s">Pendências, alunos, turmas e financeiro da escola</span></span><span aria-hidden="true" class="seta">›</span></button>
        <button class="entrar-op" id="efam"><span class="vant-ic">${ICO.filhas}</span><span class="grow"><b>Responsável</b><span class="s">Ver e pagar as cobranças dos filhos</span></span><span aria-hidden="true" class="seta">›</span></button>
        <button class="entrar-op" id="enovo"><span class="vant-ic">${ICO.escola || ICO.filhas}</span><span class="grow"><b>Pessoa nova</b><span class="s">Ver o primeiro acesso (sem escola)</span></span><span aria-hidden="true" class="seta">›</span></button>
      </section>
      <div class="note sobe" style="text-align:center;--d:350ms">Modo de teste, com dados de exemplo. O login com senha fica para depois.</div>
      ${linksLegais()}
      </div>
    </div>`;
    $('eadm').onclick = () => B.login('admin@teste.com', '123456');
    $('efam').onclick = () => B.login('familia@teste.com', '123456');
    $('enovo').onclick = () => B.cadastrar('Felipe Luiz', `novo${Date.now() % 100000}@teste.com`, '123456');
    return;
  }
  RAIZ().innerHTML = `<div class="login entrada">
    ${capaApp(true)}
    <div class="login-form">
    <a class="login-volta" href="../">‹ Voltar ao site</a>
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
    </div>
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
  const j = await r.json().catch(() => ({})); if (!r.ok) { const x = Object.assign(new Error(j.erro || 'Não deu certo agora. Tente de novo.'), { code: j.codigo || '' }); if (r.status >= 500) registrarErro(Object.assign(new Error(`servidor ${nome} respondeu ${r.status}: ${j.erro || ''}`), { stack: '' }), 'servidor'); throw x; }
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
  if (!Object.keys(MINHAS).length && !CONVITES.length && !PROF_PEND.length) return telaNovo();
  const lista = Object.entries(MINHAS), volta = VOLTA_ESCOLA && MINHAS[VOLTA_ESCOLA] ? VOLTA_ESCOLA : null;
  RAIZ().innerHTML = `<div class="wrap" style="padding-top:20px">
    <div class="brand"><span class="marca-mini">${MARCA_SVG}</span><h1><small>Olá, ${esc(primeiro(EU.nome) || 'tudo bem?')}</small>${esc(NOME_APP())}</h1><div class="acts">${volta ? `<button class="icon-btn" id="ivolta" aria-label="Voltar para ${esc(MINHAS[volta].nome || 'a escola')}">${ICO.voltar}</button>` : ''}</div></div>
    ${PROF_PEND.length ? `<div class="hero consent"><div class="label">Professor(a)</div><b>A ${esc(PROF_PEND.join(', '))} cadastrou você como professor(a)</b>
      <span class="sub">Para entrar, confirme o seu e-mail ${esc(EU.email || '')}: toque em "Mandar o link", abra o e-mail e toque no link. Depois volte aqui e toque em "Já confirmei".</span>
      <div class="actions"><button class="btn ghost" id="ipconf">Mandar o link</button><button class="btn" id="ipja">Já confirmei</button></div></div>` : ''}
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
  if ($('ipconf')) $('ipconf').onclick = async () => { await B.verificarEmail(); aviso('Link enviado para ' + (EU.email || 'o seu e-mail')); };
  if ($('ipja')) $('ipja').onclick = async () => { $('ipja').disabled = true; await B.recarregar().catch(() => { }); const r = await vincularProf(); if (r && (r.escolas || []).length) { aviso('Pronto! Agora você entra como professor(a).'); telaInicio(); } else { $('ipja').disabled = false; aviso(PROF_PEND.length ? 'O e-mail ainda não foi confirmado. Abra o link que enviamos.' : 'Não encontramos o cadastro. Fale com a escola.'); } };
  RAIZ().querySelectorAll('[data-aceita-conv],[data-recusa-conv]').forEach(b => b.onclick = async () => { const eid = b.dataset.aceitaConv || b.dataset.recusaConv, c = CONVITES.find(x => x.eid === eid); if (!c) return; b.disabled = true;
    try { await responderConvite(c, !!b.dataset.aceitaConv); } catch (e) { aviso(msgErro(e)); b.disabled = false; } });
  if ($('ivolta')) $('ivolta').onclick = () => abrirEscola(volta);
  $('isair').onclick = () => confirmar('Sair da conta?', 'Para entrar de novo, você vai precisar do seu e-mail e senha (ou da conta Google).', 'Sair', () => { VOLTA_ESCOLA = null; B.sair(); });
  $('icriar').onclick = () => telaCriarEscola(1);
  $('ientrar').onclick = async () => {
    const err = m => $('ierr').textContent = m;
    $('ientrar').disabled = true;
    try { if (!(await entrarComCodigo($('icod').value, err))) $('ientrar').disabled = false;
    } catch (e) { err(msgErro(e)); $('ientrar').disabled = false; }
  };
}
// código do responsável (a escola manda): liga a conta aos filhos daquela escola. Filhos em outra escola: outro código.
async function entrarComCodigo(valor, err) {
  const cod = String(valor || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(cod)) { err('O código tem 6 letras e números. Confira na mensagem da escola.'); return false; }
  const c = await B.get('codigos/' + cod);
  if (!c || !c.rid) { err('Código não encontrado. Confira com a escola.'); return false; }
  const jaMembro = await B.get(`escolas/${c.eid}/membros/${EU.uid}`).catch(() => null);
  if (!jaMembro) await B.set(`escolas/${c.eid}/membros/${EU.uid}`, { codigo: cod, nome: EU.nome || '', email: EU.email || '', em: Date.now() });
  await B.set(`escolas/${c.eid}/membros/${EU.uid}/vinculos/${c.rid}`, { codigo: cod, em: Date.now() });
  const [esc_, resp] = await Promise.all([B.get('escolas/' + c.eid), B.get(`escolas/${c.eid}/responsaveis/${c.rid}`)]);
  await B.set('users/' + EU.uid, { escolas: { [c.eid]: { nome: (esc_ || {}).nome || 'Escola', papel: 'familia', familia: (resp || {}).nome || '' } } }, { merge: true });
  MINHAS[c.eid] = { nome: (esc_ || {}).nome, papel: 'familia', familia: (resp || {}).nome };
  abrirEscola(c.eid); return true;
}

/* ================= Quem chega pela primeira vez =================
   Todas estas telas têm a mesma estrutura (marca ou passos · título · conteúdo · botão · links),
   para o título, o botão e os links ficarem sempre no mesmo lugar. */
let USR = {}; // users/{uid}: perfil (responsável), perfilProf (professor)
function telaOb({ passo, rotulo, titulo, sub, corpo, botao, dois, links }) {
  const tot = LOJA() ? 4 : 5; // no app da loja não tem o passo do cartão
  const topo = passo ? `<div class="ob-pp" aria-label="Passo ${passo} de ${tot}">${Array.from({ length: tot }, (_, i) => `<i class="${i < passo ? 'on' : ''}"></i>`).join('')}</div>`
    : `<span class="marca-mini">${MARCA_SVG}</span><b>${esc(NOME_APP())}</b>`;
  RAIZ().innerHTML = `<div class="ob"><div class="ob-topo">${topo}</div>
    <div class="ob-tit">${rotulo ? `<div class="label">${rotulo}</div>` : ''}<h2>${titulo}</h2>${sub ? `<span class="sub">${sub}</span>` : ''}</div>
    <div class="ob-corpo">${corpo || ''}</div>
    <div class="ob-pe">${dois ? `<div class="dois">${dois}${botao}</div>` : botao}<div class="ob-links">${links || ''}</div></div></div>`;
  window.scrollTo(0, 0);
}
const linkSair = '<button type="button" id="obsair">Sair da conta</button>';
const ligarSair = () => { if ($('obsair')) $('obsair').onclick = () => confirmar('Sair da conta?', 'Para entrar de novo, você vai precisar do seu e-mail e senha (ou da conta Google).', 'Sair', () => { VOLTA_ESCOLA = null; B.sair(); }); };
// procura os filhos pelo cadastro (e-mail confirmado entra sozinho; CPF/WhatsApp viram pedido para a escola)
async function identificarFamilia(dados) {
  if (MOCK) { if (dados) { USR.perfil = { ...dados, email: EU.email, em: Date.now() }; await B.set('users/' + EU.uid, { perfil: USR.perfil }, { merge: true }); } return { escolas: [], pedidos: 0 }; }
  const r = await servidor('familiaIdentificar', dados || {});
  if (dados) USR.perfil = { ...dados, email: EU.email };
  for (const e of r.escolas || []) MINHAS[e.eid] = { nome: e.nome, papel: 'familia', familia: e.familia };
  return r;
}
function telaNovo() {
  if (USR.perfilProf) return telaProfEnviado();
  if (USR.perfil) return telaCadastroFeito();
  const cod = `<div class="field"><label for="ncod">Código do responsável <span class="sub">(a escola envia)</span></label><input id="ncod" class="cod" maxlength="6" autocapitalize="characters" placeholder="K7Q2MX"></div>`;
  telaOb({ rotulo: `Olá, ${esc(primeiro(EU.nome) || 'tudo bem?')}`, titulo: 'Novo aqui?',
    sub: 'Faça seu cadastro. Use o código que a escola enviou ou aguarde: em breve você será identificado como responsável.',
    corpo: `<div class="field"><label for="nnome">Nome completo</label><input id="nnome" maxlength="80" autocomplete="name" value="${esc(EU.nome || '')}"></div>
      <div class="two"><div class="field"><label for="ntel">WhatsApp</label><input id="ntel" inputmode="tel" autocomplete="tel" placeholder="(81) 9 9999-9999"></div>
      <div class="field"><label for="ncpf">CPF</label><input id="ncpf" inputmode="numeric" placeholder="000.000.000-00"></div></div>
      <div class="field"><label>E-mail</label><input class="ro" value="${esc(EU.email || '')}" readonly tabindex="-1"></div>
      ${cod}<div class="err" id="nerr" role="alert"></div>`,
    botao: '<button class="btn" id="nok">Continuar</button>',
    links: '<button type="button" id="ncriar">Criar escola</button><button type="button" id="nprof">Professor</button>' });
  $('ncriar').onclick = () => telaCriarEscola(1);
  $('nprof').onclick = () => telaProfCadastro();
  $('nok').onclick = async () => {
    const err = m => $('nerr').textContent = m, nome = $('nnome').value.trim(), tel = $('ntel').value.trim(), cpf = $('ncpf').value.trim();
    if (!nome) return err('Digite seu nome completo.');
    if (C.soDigitos(tel).length < 10) return err('Digite seu WhatsApp com o DDD.');
    if (cpf && !C.cpfValido(cpf)) return err('Esse CPF não confere. Veja se algum número foi digitado errado.');
    $('nok').disabled = true;
    try {
      const r = await identificarFamilia({ nome, telefone: tel, cpf });
      if ($('ncod').value.trim()) { if (await entrarComCodigo($('ncod').value, err)) return; $('nok').disabled = false; return; }
      const ks = Object.keys(MINHAS); if (ks.length) { aviso('Achamos seus filhos!'); return abrirEscola(ks[0]); }
      telaCadastroFeito(r.pedidos);
    } catch (e) { err(msgErro(e)); $('nok').disabled = false; }
  };
}
function telaCadastroFeito(pedidos) {
  telaOb({ rotulo: `Olá, ${esc(primeiro(EU.nome) || 'tudo bem?')}`, titulo: 'Cadastro feito!',
    sub: pedidos ? 'A escola vai confirmar que você é o responsável. Assim que ela liberar, seus filhos aparecem aqui.' : 'Quando a escola cadastrar seu e-mail ou CPF, seus filhos aparecem aqui sozinhos. Filhos em outra escola? Use o código dela.',
    corpo: `<div class="ob-icone">⏳</div><div class="field"><label for="ncod">Código do responsável <span class="sub">(a escola envia)</span></label><input id="ncod" class="cod" maxlength="6" autocapitalize="characters" placeholder="K7Q2MX"></div><div class="err" id="nerr" role="alert"></div>`,
    botao: '<button class="btn" id="nok">Entrar com o código</button>', links: linkSair });
  ligarSair();
  $('nok').onclick = async () => { $('nok').disabled = true; try { if (!(await entrarComCodigo($('ncod').value, m => $('nerr').textContent = m))) $('nok').disabled = false; } catch (e) { $('nerr').textContent = msgErro(e); $('nok').disabled = false; } };
}
// professor(a): cadastro completo; a escola libera o acesso cadastrando o e-mail dele(a)
function telaProfCadastro() {
  const p = USR.perfilProf || {};
  telaOb({ rotulo: 'Professor(a)', titulo: 'Seu cadastro', sub: 'A escola usa estes dados para liberar seu acesso.',
    corpo: `<div class="field"><label for="qnome">Nome completo</label><input id="qnome" maxlength="80" autocomplete="name" value="${esc(p.nome || EU.nome || '')}"></div>
      <div class="two"><div class="field"><label for="qtel">WhatsApp</label><input id="qtel" inputmode="tel" autocomplete="tel" placeholder="(81) 9 9999-9999" value="${esc(p.telefone || '')}"></div>
      <div class="field"><label for="qnasc">Nascimento</label><input id="qnasc" type="date" value="${esc(p.nascimento || '')}"></div></div>
      <div class="two"><div class="field"><label for="qcpf">CPF</label><input id="qcpf" inputmode="numeric" placeholder="000.000.000-00" value="${esc(p.cpf || '')}"></div>
      <div class="field"><label for="qcref">CREF <span class="sub">(se tiver)</span></label><input id="qcref" maxlength="20" placeholder="000000-G/PE" value="${esc(p.cref || '')}"></div></div>
      <div class="field"><label for="qens">O que você ensina</label><input id="qens" maxlength="80" placeholder="Ex.: Balé, Ginástica rítmica" value="${esc(p.ensina || '')}"></div>
      <div class="ob-quadro"><b>Conta no Mercado Pago</b><span class="sub">Os Pix dos alunos caem direto nela (é grátis) e o app dá baixa sozinho. Você conecta depois que a escola liberar seu acesso.</span>
        <div class="seg" id="qmp"><button type="button" data-mp="sim" aria-pressed="${p.mp !== 'nao'}">Já tenho</button><button type="button" data-mp="nao" aria-pressed="${p.mp === 'nao'}">Ainda não tenho</button></div>
        <span class="sub" id="qmpnao" ${p.mp === 'nao' ? '' : 'hidden'}>Crie a sua no app do Mercado Pago ou em <a class="link" href="https://www.mercadopago.com.br" target="_blank" rel="noopener">mercadopago.com.br</a>, com o seu CPF.</span></div>
      <div class="err" id="qerr" role="alert"></div>`,
    botao: '<button class="btn" id="qok">Enviar cadastro</button>', links: '<button type="button" id="qvolta">Voltar</button>' });
  $('qvolta').onclick = () => USR.perfilProf ? telaProfEnviado() : telaNovo();
  $('qmp').querySelectorAll('[data-mp]').forEach(b => b.onclick = () => { $('qmp').querySelectorAll('[data-mp]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('qmpnao').hidden = b.dataset.mp !== 'nao'; });
  $('qok').onclick = async () => {
    const err = m => $('qerr').textContent = m, v = id => $(id).value.trim();
    if (!v('qnome')) return err('Digite seu nome completo.');
    if (C.soDigitos(v('qtel')).length < 10) return err('Digite seu WhatsApp com o DDD.');
    if (!C.cpfValido(v('qcpf'))) return err('Esse CPF não confere. Veja se algum número foi digitado errado.');
    $('qok').disabled = true;
    const perfilProf = { nome: v('qnome'), telefone: v('qtel'), nascimento: v('qnasc') || null, cpf: C.soDigitos(v('qcpf')), cref: v('qcref') || null, ensina: v('qens') || null,
      mp: $('qmp').querySelector('[aria-pressed="true"]').dataset.mp, email: EU.email || '', em: Date.now() };
    try { await B.set('users/' + EU.uid, { perfilProf }, { merge: true }); USR.perfilProf = perfilProf; telaProfEnviado(); }
    catch (e) { err(msgErro(e)); $('qok').disabled = false; }
  };
}
function telaProfEnviado() {
  telaOb({ rotulo: 'Professor(a)', titulo: 'Cadastro enviado!', sub: 'Agora é só aguardar, a escola em breve irá liberar seu acesso.',
    corpo: `<div class="ob-icone">✅</div><div class="ob-dica" style="justify-content:center;text-align:center"><span>Avise a escola que o seu e-mail é <b>${esc(EU.email || '')}</b>.</span></div>`,
    botao: '<button class="btn" id="qedit">Editar meu cadastro</button>', links: linkSair });
  ligarSair(); $('qedit').onclick = () => telaProfCadastro();
}
// criar escola em 4 passos, como fases de um jogo: nome · vencimento · primeira turma · lista de primeiros passos
let WZ = null;
const UF_NOMES = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
// cidades do estado (lista oficial do IBGE); guarda no aparelho. Sem internet: aceita o que for digitado
const CIDADES = {};
async function cidadesDoEstado(uf) {
  if (CIDADES[uf]) return CIDADES[uf];
  try { const g = JSON.parse(localStorage.getItem('escolinha.cid.' + uf) || 'null'); if (g && g.length) return CIDADES[uf] = g; } catch (e) { }
  try { const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`); if (!r.ok) return null;
    const l = (await r.json()).map(m => m.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    try { localStorage.setItem('escolinha.cid.' + uf, JSON.stringify(l)); } catch (e) { }
    return CIDADES[uf] = l; } catch (e) { return null; }
}
const acharCidade = (l, v) => l.find(c => semAcento(c) === semAcento(String(v || '').trim())) || '';
function telaCriarEscola(passo) {
  if (!WZ || passo === 1 && !WZ.nome) WZ = WZ || { nome: '', cidade: '', uf: '', termos: false, venc: 10, turma: { nome: '', preco: '', hs: [{ dias: [], ini: '', fim: '' }] } };
  const voltar = '<button class="btn ghost" id="wvolta">Voltar</button>';
  if (passo === 1) {
    telaOb({ passo: 1, rotulo: `Passo 1 de ${LOJA() ? 4 : 5}`, titulo: 'Como se chama sua escola?', sub: 'É o nome que as famílias vão ver no app.',
      corpo: `<div class="field"><label for="wnome">Nome da escola</label><input id="wnome" maxlength="60" placeholder="Ex.: Escolinha Movimento" value="${esc(WZ.nome)}"></div>
        <div class="two"><div class="field"><label for="wuf">Estado</label><select id="wuf"><option value="">Escolha</option>${Object.keys(UF_NOMES).sort().map(u => `<option ${u === WZ.uf ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div class="field"><label for="wcid">Cidade</label><input id="wcid" maxlength="60" list="wcids" autocomplete="off" placeholder="Digite a cidade" value="${esc(WZ.cidade)}"><datalist id="wcids"></datalist></div></div>
        <label class="check aceite"><input type="checkbox" id="wtermos" ${WZ.termos ? 'checked' : ''}><span>Li e aceito os <button type="button" class="link" data-doc="termos">Termos de uso</button> e a <button type="button" class="link" data-doc="privacidade">Política de privacidade</button>.</span></label>
        <div class="err" id="werr" role="alert"></div>`,
      botao: '<button class="btn" id="wok">Próximo</button>', dois: voltar });
    $('wvolta').onclick = () => { WZ = null; telaInicio(); };
    // estado primeiro; a cidade vira uma lista com as cidades daquele estado
    let cidades = null;
    const carregar = async () => { const uf = $('wuf').value; $('werr').textContent = '';
      cidades = null; $('wcids').innerHTML = ''; if (!uf) return;
      cidades = await cidadesDoEstado(uf); if (!$('wuf') || $('wuf').value !== uf || !cidades) return; // a tela já mudou
      $('wcids').innerHTML = cidades.map(c => `<option value="${esc(c)}">`).join('');
      if ($('wcid').value && !acharCidade(cidades, $('wcid').value)) $('wcid').value = ''; };
    $('wuf').onchange = () => { carregar(); if (!$('wcid').value) setTimeout(() => $('wcid').focus(), 50); };
    // cidade antes do estado: avisa (a lista de cidades depende do estado)
    $('wcid').addEventListener('focus', () => { if (!$('wuf').value) $('werr').textContent = 'Escolha também o estado, ao lado.'; });
    if (WZ.uf) carregar();
    $('wok').onclick = () => {
      const cid = cidades ? acharCidade(cidades, $('wcid').value) : $('wcid').value.trim();
      Object.assign(WZ, { nome: $('wnome').value.trim(), cidade: cid || $('wcid').value.trim(), uf: $('wuf').value, termos: $('wtermos').checked });
      const err = m => $('werr').textContent = m;
      if (!WZ.nome) return err('Digite o nome da escola.');
      if (!WZ.uf) return err('Escolha o estado da escola.');
      if (!WZ.cidade) return err('Digite a cidade da escola.');
      if (cidades && !cid) return err(`Não achamos "${$('wcid').value.trim()}" em ${UF_NOMES[WZ.uf]}. Escolha a cidade na lista.`);
      if (!WZ.termos) return err('Para criar a escola, aceite os Termos de uso e a Política de privacidade.');
      telaCriarEscola(2);
    };
  } else if (passo === 2) {
    const dias = [5, 10, 15, 20, 25];
    telaOb({ passo: 2, rotulo: `Passo 2 de ${LOJA() ? 4 : 5}`, titulo: 'Quando as famílias pagam?', sub: 'O dia do mês em que a mensalidade vence. Dá para mudar depois.',
      corpo: `<div class="ob-dias" id="wdias">${dias.map(d => `<button type="button" data-v="${d}" aria-pressed="${WZ.venc === d}">${d}</button>`).join('')}</div>
        <div class="field" style="max-width:200px;margin:0 auto"><label for="woutro">Ou outro dia (1 a 28)</label><input id="woutro" type="number" min="1" max="28" inputmode="numeric" value="${dias.includes(WZ.venc) ? '' : WZ.venc}" style="text-align:center"></div>
        <div class="ob-dica">💡<span>O app avisa as famílias 3 dias antes e no dia do vencimento.</span></div><div class="err" id="werr" role="alert"></div>`,
      botao: '<button class="btn" id="wok">Criar escola</button>', dois: voltar });
    $('wdias').querySelectorAll('[data-v]').forEach(b => b.onclick = () => { WZ.venc = Number(b.dataset.v); $('woutro').value = ''; $('wdias').querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
    $('woutro').oninput = () => { if ($('woutro').value) $('wdias').querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', 'false')); };
    $('wvolta').onclick = () => telaCriarEscola(1);
    $('wok').onclick = async () => {
      if ($('woutro').value) { const v = Number($('woutro').value); if (!(v >= 1 && v <= 28)) return $('werr').textContent = 'O vencimento vai do dia 1 ao 28.'; WZ.venc = v; }
      // a escola é criada aqui; depois vêm o cartão (obrigatório) e a primeira turma (dá para pular)
      $('wok').disabled = true; const eid = novoId();
      try {
        await B.lote([
          { op: 'set', p: 'escolas/' + eid, d: { nome: WZ.nome, dono: EU.uid, admins: [EU.uid], adminsInfo: { [EU.uid]: { nome: EU.nome || '', email: EU.email || '', em: Date.now() } }, criadaEm: Date.now(), termosAceitos: { em: Date.now(), versao: VERSAO_TERMOS, uid: EU.uid }, ...(LOJA() ? {} : { cartaoPendente: true }) } },
          { op: 'set', p: `escolas/${eid}/config/geral`, d: { vencDia: WZ.venc, pixRepassa: false, descIrmas: 0, descMulti: 0, cidade: WZ.cidade, uf: WZ.uf, primeirosPassos: true } }
        ]);
        await B.set('users/' + EU.uid, { escolas: { [eid]: { nome: WZ.nome, papel: 'admin' } } }, { merge: true });
        MINHAS[eid] = { nome: WZ.nome, papel: 'admin' }; WZ.eid = eid;
        LOJA() ? telaCriarEscola(3) : telaCartaoEscola(eid, WZ.nome, () => telaCriarEscola(3));
      } catch (e) { $('werr').textContent = msgErro(e); $('wok').disabled = false; }
    };
  } else if (passo === 3) {
    const n = LOJA() ? 3 : 4;
    telaOb({ passo: n, rotulo: `Passo ${n} de ${LOJA() ? 4 : 5}`, titulo: 'Sua primeira turma', sub: 'Um grupo de alunos com a mesma mensalidade. Se preferir, pule e crie depois na aba Turmas.',
      corpo: `<div class="two"><div class="field"><label for="wtnome">Nome da turma</label><input id="wtnome" maxlength="60" placeholder="Ex.: Balé Baby" value="${esc(WZ.turma.nome)}"></div>
        <div class="field"><label for="wtpreco">Mensalidade (R$)</label><input id="wtpreco" inputmode="decimal" placeholder="150,00" value="${esc(WZ.turma.preco)}"></div></div>
        ${camposHorariosHTML()}<div class="err" id="werr" role="alert"></div>`,
      botao: '<button class="btn" id="wok">Criar turma</button>', links: '<button type="button" id="wpular">Pular</button>' });
    camposTurmaHorarios(WZ.turma.hs);
    const guardar = () => { WZ.turma.nome = $('wtnome').value.trim(); WZ.turma.preco = $('wtpreco').value.trim(); };
    $('wpular').onclick = () => { WZ.turmaFeita = false; telaCriarEscola(4); };
    $('wok').onclick = async () => {
      guardar(); const err = m => $('werr').textContent = m, preco = parseValor(WZ.turma.preco);
      if (!WZ.turma.nome) return err('Digite o nome da turma.');
      if (!(preco >= 0)) return err('Digite o valor da mensalidade, como 150,00.');
      const H = salvarHorarios(WZ.turma.hs, ''); if (H.erro) return err(H.erro);
      if (!H.dias.length) return err('Marque os dias de aula da turma.');
      $('wok').disabled = true;
      const eid = WZ.eid, tid = novoId();
      try {
        await B.set(`escolas/${eid}/turmas/${tid}`, { nome: WZ.turma.nome, todasIdades: true, idadeMin: null, idadeMax: null, professoraId: null, professoraIds: [], ...H, chamada: true, chamadaObrig: false, recebedor: 'escola', localId: null, preco, vagas: null, ordem: 1 });
        WZ.turmaFeita = true; telaCriarEscola(4);
      } catch (e) { err(msgErro(e)); $('wok').disabled = false; }
    };
  } else {
    const eid = WZ.eid;
    telaOb({ passo: LOJA() ? 4 : 5, rotulo: LOJA() ? 'Passo 4 de 4' : 'Passo 5 de 5', titulo: 'Tudo pronto! 🎉', sub: 'Agora é só seguir a lista. Ela fica no topo da aba Pendências até tudo ficar pronto.',
      corpo: `<div class="hero"><div class="passos">${PASSOS_ESCOLA.map(([k, t]) => `<div>${k === 'escola' || (k === 'turma' && WZ.turmaFeita) ? '<span class="ok">✓</span>' : '<span class="vazio"></span>'}${t}</div>`).join('')}</div></div>`,
      botao: '<button class="btn" id="wok">Adicionar alunos</button>', links: '<button type="button" id="wdepois">Fazer depois</button>' });
    $('wok').onclick = () => { WZ = null; abrirEscola(eid, 'alunas').then(() => setTimeout(() => passoAbrir('alunos'), 300)); };
    $('wdepois').onclick = () => { WZ = null; abrirEscola(eid); };
  }
}
// cartão do plano, obrigatório ao criar a escola: o Mercado Pago confere se o cartão é válido,
// e a primeira cobrança só acontece no fim dos 30 dias de teste grátis. Se a pessoa sair antes, a tela volta ao abrir a escola.
async function telaCartaoEscola(eid, nome, depois) {
  const S0 = S; S = { eid, escola: { nome }, alunas: {}, plano: null }; // o servidor do plano só precisa saber qual é a escola
  let R = null, campos = null, metodo = null;
  const sair = () => { if (campos) campos.sair(); campos = null; };
  telaOb({ passo: 3, rotulo: 'Passo 3 de 5', titulo: 'Cadastre o cartão',
    sub: 'Nada é cobrado até acabar o teste grátis de 30 dias. Pode aparecer uma cobrança pequena só para confirmar o cartão, que é devolvida em seguida.',
    corpo: `<div class="field"><label>Número do cartão</label><div class="mpcampo" id="ccnum"></div></div>
      <div class="two"><div class="field"><label>Validade</label><div class="mpcampo" id="ccval"></div></div><div class="field"><label>Código de segurança</label><div class="mpcampo" id="cccvv"></div></div></div>
      <div class="field"><label for="ccnome">Nome no cartão</label><input id="ccnome" autocomplete="cc-name" placeholder="Como está no cartão"></div>
      <div class="field"><label for="ccdoc">CPF ou CNPJ do titular</label><input id="ccdoc" inputmode="numeric"></div>
      <div class="note">Depois do teste, o plano custa a partir de ${brl(C.PLANOS[0].mes)} por mês, conforme o número de alunos. Dá para cancelar antes.</div>
      <div class="note">🔒 O número vai direto para o Mercado Pago, que confere se o cartão é válido. O Turma em Dia não vê nem guarda o número.</div>
      <div class="err" id="ccerr" role="alert"></div>`,
    botao: '<button class="btn" id="ccok">Salvar cartão</button>', links: '<button type="button" id="cccod">Tenho um código de cortesia</button><button type="button" id="ccsair">Sair da conta</button>' });
  $('cccod').onclick = () => sheet(`<h3>Código de cortesia</h3><div class="sub">Digite o código que o Turma em Dia mandou para a escola. Com ele, a escola ganha meses grátis e não precisa cadastrar o cartão agora.</div>
    <div class="field"><label for="cdcod">Código</label><input id="cdcod" autocapitalize="characters" autocomplete="off" maxlength="30" placeholder="Ex.: ESCOLA-AMIGA"></div>
    <div class="err" id="cderr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Voltar</button><button type="button" class="btn" id="cdok">Usar o código</button></div>`, () => {
    $('cdcod').focus(); $('cdcod').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); });
    $('cdok').onclick = async () => { const c = $('cdcod').value.trim(); if (c.length < 3) return $('cderr').textContent = 'Digite o código.';
      $('cdok').disabled = true;
      try { const r = await chamarPlano({ acao: 'codigo', codigo: c });
        if (MOCK) await B.set('escolas/' + eid, { cartaoPendente: false }, { merge: true });
        fecharSheet(); sair(); S = S0; aviso(`Código aceito: grátis até ${dataBRA(r.plano.cortesiaAte)}`); depois(); }
      catch (e) { $('cderr').textContent = msgErro(e); $('cdok').disabled = false; } };
  });
  $('ccsair').onclick = () => { sair(); S = S0; confirmar('Sair da conta?', 'A escola fica criada. Quando você entrar de novo, é só cadastrar o cartão para continuar.', 'Sair', () => { VOLTA_ESCOLA = null; B.sair(); }); };
  $('ccdoc').addEventListener('input', e => { const x = C.soDigitos(e.target.value); e.target.value = x.length > 11 ? fmtCnpj(x) : fmtCpf(x); });
  const err = m => { $('ccerr').textContent = m; $('ccok').disabled = false; $('ccok').textContent = 'Salvar cartão'; };
  try { R = await chamarPlano({ acao: 'estado' }); campos = await camposCartao(R.publicKey || 'TEST-PUB', { num: 'ccnum', val: 'ccval', cvv: 'cccvv' }, async b => { try { metodo = await campos.metodo(b); } catch (e) { } }); }
  catch (e) { err(msgErro(e)); }
  $('ccok').onclick = async () => {
    const nomeC = $('ccnome').value.trim(), doc = C.soDigitos($('ccdoc').value);
    if (!campos) return err('Não deu para abrir os campos do cartão. Confira a internet e tente de novo.');
    if (nomeC.length < 3) return err('Escreva o nome como está no cartão.');
    if (!(doc.length === 11 ? C.cpfValido(doc) : doc.length === 14)) return err('Confira o CPF ou CNPJ do titular.');
    $('ccok').disabled = true; $('ccok').textContent = 'Conferindo o cartão…';
    try {
      if (!R.plano.doc) { const r = await chamarPlano({ acao: 'documento', doc }); if (r.aviso) aviso(r.aviso); }
      const t = await campos.token({ cardholderName: nomeC, identificationType: doc.length === 11 ? 'CPF' : 'CNPJ', identificationNumber: doc });
      await chamarPlano({ acao: 'cartao', token: t.id, ciclo: 'mensal', marca: (metodo && metodo.name) || 'Cartão', fim: t.last_four_digits });
      if (MOCK) await B.set('escolas/' + eid, { cartaoPendente: false }, { merge: true }); // no app de verdade, o servidor tira a marca
      sair(); S = S0; aviso('Cartão salvo'); depois();
    } catch (e) { err(msgErro(e)); }
  };
}
// primeiros passos da escola nova: aparecem no topo das Pendências até ficarem todos prontos (ou a escola esconder)
const PASSOS_ESCOLA = [['escola', 'Criar a escola'], ['turma', 'Criar a primeira turma'], ['alunos', 'Adicionar os alunos'], ['codigos', 'Mandar o código para as famílias'], ['mp', 'Conectar o Mercado Pago da escola']];
function passosFeitos() {
  const al = Object.values(S.alunas || {}).filter(a => !a.anonimizadoEm);
  return { escola: true, turma: Object.keys(S.turmas || {}).length > 0, alunos: al.length > 0, codigos: !!S.cfg.passoCodigos || Object.values(S.membros || {}).some(m => m && (m.codigo || m.via)), mp: !!S.cfg.mpConectadoEm };
}
function cardPrimeirosPassos() {
  if (!S.admin || !S.cfg.primeirosPassos) return '';
  const f = passosFeitos(), n = PASSOS_ESCOLA.filter(([k]) => f[k]).length;
  if (n === PASSOS_ESCOLA.length) return '';
  return `<section><div class="hero"><div class="label" style="display:flex;justify-content:space-between"><span>Primeiros passos · ${n} de ${PASSOS_ESCOLA.length}</span><button type="button" class="link" id="ppesc" style="font-size:.78rem">Esconder</button></div>
    <div class="passos">${PASSOS_ESCOLA.map(([k, t]) => f[k] ? `<div><span class="ok">✓</span>${t}</div>` : `<button type="button" data-passo="${k}"><span class="vazio"></span><span class="grow">${t}</span><span class="seta">›</span></button>`).join('')}</div></div></section>`;
}
// responsável que chegou sem código e bate pelo CPF ou WhatsApp: a escola confirma antes de ele ver os filhos
function cardPedidosFamilia() {
  const ps = Object.entries(S.pedidosFam || {}).filter(([, p]) => p && (p.rids || []).length);
  if (!ps.length) return '';
  return `<section><h2>Pedidos de acesso</h2><ul class="list">${ps.map(([uid, p]) => { const filhos = p.rids.flatMap(rid => Object.values(S.alunas).filter(a => a.responsavelId === rid && !a.anonimizadoEm).map(a => primeiro(a.nome)));
    const resp = p.rids.map(rid => (S.resps[rid] || {}).nome).filter(Boolean).join(', ');
    return `<li><div class="grow"><div class="t">${esc(p.nome || 'Alguém')} pediu para ver ${esc(filhos.join(', ') || 'os alunos')}</div><span class="s">Cadastro de ${esc(resp || 'responsável')} · ${esc(p.email || '')}${p.telefone ? ' · ' + esc(foneBR(p.telefone)) : ''}</span>
      <div class="actions" style="margin-top:8px"><button class="btn ghost btn-mini" data-pfno="${esc(uid)}">Recusar</button><button class="btn btn-mini" data-pfok="${esc(uid)}">Liberar</button></div></div></li>`; }).join('')}</ul>
    <div class="note">O CPF ou o WhatsApp do cadastro bate com o do responsável. Confira antes de liberar.</div></section>`;
}
function ligarPedidosFamilia(v) {
  v.querySelectorAll('[data-pfok],[data-pfno]').forEach(b => b.onclick = async () => {
    const uid = b.dataset.pfok || b.dataset.pfno, ok = !!b.dataset.pfok; b.disabled = true;
    try { if (MOCK) await B.del(`escolas/${S.eid}/pedidosFamilia/${uid}`); else await servidor('familiaAprovar', { eid: S.eid, uid, ok }); aviso(ok ? 'Acesso liberado' : 'Pedido recusado'); }
    catch (e) { aviso(msgErro(e)); b.disabled = false; }
  });
}
function passoAbrir(k) {
  if (k === 'turma') return sheetTurma(null);
  if (k === 'alunos') { irPara('alunas'); return setTimeout(() => { const b = $('ana'); if (b) b.click(); }, 120); }
  if (k === 'codigos') { B.set(`escolas/${S.eid}/config/geral`, { passoCodigos: true }, { merge: true }).catch(() => { }); return irPara('alunas'); }
  if (k === 'mp') return sheetAjustes();
}
function ligarPrimeirosPassos(v) {
  v.querySelectorAll('[data-passo]').forEach(b => b.onclick = () => passoAbrir(b.dataset.passo));
  if ($('ppesc')) $('ppesc').onclick = () => B.set(`escolas/${S.eid}/config/geral`, { primeirosPassos: false }, { merge: true });
}
function sheetCriarEscola() {
  sheet(`<h3>Criar escola</h3>
    <div class="field"><label for="cnome">Nome da escola</label><input id="cnome" maxlength="60" placeholder="Ex.: Escolinha Movimento"></div>
    <div class="two"><div class="field"><label for="ccid">Cidade</label><input id="ccid" maxlength="60" placeholder="Ex.: Recife" autocomplete="address-level2"></div>
    <div class="field"><label for="cuf">Estado</label><select id="cuf"><option value="">Escolha</option>${UFS.map(u => `<option>${u}</option>`).join('')}</select></div></div>
    <div class="two"><div class="field"><label for="cvenc">Vencimento (dia do mês)</label><input id="cvenc" type="number" min="1" max="28" value="10"></div>
    <div class="field"><label for="cloc">Local (opcional)</label><input id="cloc" maxlength="60" placeholder="Ex.: Unidade Centro"></div></div>
    <div class="note">Depois você cadastra as turmas, os grupos e os alunos.</div>
    <label class="check aceite"><input type="checkbox" id="ctermos"><span>Li e aceito os <button type="button" class="link" data-doc="termos">Termos de uso</button> e a <button type="button" class="link" data-doc="privacidade">Política de privacidade</button>. A escola é responsável pelos dados que cadastrar.</span></label>
    <div class="err" id="cerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="cok">Criar</button></div>`, () => {
    $('cok').onclick = async () => {
      const nome = $('cnome').value.trim(), venc = Number($('cvenc').value), loc = $('cloc').value.trim();
      if (!nome) return $('cerr').textContent = 'Digite o nome da escola.';
      const cidade = $('ccid').value.trim(), uf = $('cuf').value; if (!cidade || !uf) return $('cerr').textContent = 'Diga a cidade e o estado da escola.';
      if (!(venc >= 1 && venc <= 28)) return $('cerr').textContent = 'O vencimento vai do dia 1 ao 28.';
      if (!$('ctermos').checked) return $('cerr').textContent = 'Para criar a escola, aceite os Termos de uso e a Política de privacidade.';
      $('cok').disabled = true;
      const eid = novoId();
      try {
        const ops = [
          { op: 'set', p: 'escolas/' + eid, d: { nome, dono: EU.uid, admins: [EU.uid], adminsInfo: { [EU.uid]: { nome: EU.nome || '', email: EU.email || '', em: Date.now() } }, criadaEm: Date.now(), termosAceitos: { em: Date.now(), versao: VERSAO_TERMOS, uid: EU.uid } } },
          { op: 'set', p: `escolas/${eid}/config/geral`, d: { vencDia: venc, pixRepassa: false, descIrmas: 0, descMulti: 0, cidade, uf } }
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
// iPhone: com o teclado aberto, a barra de baixo "sobe" e às vezes fica no meio da tela depois que o teclado fecha.
// Escondemos a barra enquanto se digita e, quando o teclado fecha, recolocamos tudo no lugar.
(function teclado() {
  const campo = el => el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]),textarea,select,[contenteditable="true"]');
  // com uma janela aberta, o fundo está travado e o iPhone cuida da rolagem sozinho: mexer aqui faz a janela pular
  // (e, com um campo ainda aberto, briga com o iPhone e o teclado fica subindo e descendo). Também não mexe se ainda há um campo aberto.
  // com janela aberta: só manda o iPhone redesenhar a janela (às vezes ficava um espaço em branco onde estava o teclado)
  const redesenharJanela = () => { const sh = document.querySelector('#overlay .sheet'); if (!sh) return; const y = sh.scrollTop; sh.style.transform = 'translateZ(0)'; requestAnimationFrame(() => { sh.style.transform = ''; sh.scrollTop = y; }); };
  const ajustar = () => { const b = document.body; if (campo(document.activeElement)) return; if (b.classList.contains('travado')) return redesenharJanela(); b.style.transform = 'translateZ(0)'; requestAnimationFrame(() => { b.style.transform = ''; window.scrollTo(window.scrollX, window.scrollY); }); };
  let t = null;
  document.addEventListener('focusin', e => { if (campo(e.target)) { clearTimeout(t); document.body.classList.add('digitando'); } });
  document.addEventListener('focusout', e => { if (!campo(e.target)) return; clearTimeout(t); t = setTimeout(() => { if (!campo(document.activeElement)) { document.body.classList.remove('digitando'); ajustar(); } }, 120); });
  const vv = window.visualViewport;
  if (vv) { let alto = vv.height; vv.addEventListener('resize', () => { if (vv.height > alto + 80) ajustar(); alto = vv.height; }); }
})();
let JANELA_TECLADO = () => { };
// iPhone: com o teclado aberto, a área visível encolhe e o Safari "empurra" a página para cima (a janela dava uma pancada).
// A janela aberta acompanha só a parte visível da tela: fica parada, logo acima do teclado, e só o teclado sobe.
(function janelaAcimaDoTeclado() {
  const vv = window.visualViewport; if (!vv) return;
  let raf = 0;
  const pos = () => { raf = 0;
    const bg = document.getElementById('sbg'); if (!bg) return;
    const teclado = window.innerHeight - vv.height > 120;
    if (!teclado) { bg.style.top = bg.style.height = bg.style.bottom = ''; return; }
    bg.style.top = vv.offsetTop + 'px'; bg.style.height = vv.height + 'px'; bg.style.bottom = 'auto';
    // o campo tocado fica visível dentro da janela (rola só a janela, nunca a página)
    const el = document.activeElement, sh = bg.querySelector('.sheet');
    if (sh && el && sh.contains(el) && el !== sh) { const r = el.getBoundingClientRect(), rs = sh.getBoundingClientRect();
      if (r.bottom > rs.bottom - 12) sh.scrollTop += r.bottom - rs.bottom + 24; else if (r.top < rs.top + 12) sh.scrollTop -= rs.top - r.top + 24; }
  };
  const agendar = () => { if (!raf) raf = requestAnimationFrame(pos); };
  vv.addEventListener('resize', agendar); vv.addEventListener('scroll', agendar); JANELA_TECLADO = agendar;
})();
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
  // a mesma janela desenhada de novo (ex.: tocou numa opção) continua no mesmo ponto da rolagem, sem pular para o topo
  let chave = '';
  try { const l = (new Error().stack || '').split('\n').map(x => (x.match(/(?:at\s+)?([A-Za-z_$][\w$]*)/) || [])[1]).filter(x => x && !['Error', 'sheet', 'at', 'async'].includes(x)); TELA_SHEET = l[0] || 'janela'; chave = l.slice(0, 3).join('>'); } catch (x) { TELA_SHEET = 'janela'; }
  const antes = $('overlay').querySelector('.sheet'), rolagem = antes && chave && chave === SHEET_CHAVE ? antes.scrollTop : 0, SHEET_CHAVE_ANT = SHEET_CHAVE; SHEET_CHAVE = chave;
  SHEET_SAIR = null;
  if (SHEET_FECHA) { const f = SHEET_FECHA; SHEET_FECHA = null; f(); }
  SHEET_VOLTAR = PROX_VOLTAR; PROX_VOLTAR = null; travarFundo(true);
  // janela nova sobe suave de baixo (a mesma janela redesenhada não anima); o fundo escurece só se não havia janela aberta
  const anima = !(antes && chave && chave === SHEET_CHAVE_ANT);
  $('overlay').innerHTML = `<div class="sheet-bg${anima && !antes ? ' esc' : ''}" id="sbg"><div class="sheet${anima ? ' sobe' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  $('sbg').onclick = e => { if (e.target.id === 'sbg') fecharSheet(); };
  { const sh = $('overlay').querySelector('.sheet.sobe'); if (sh) sh.addEventListener('animationend', () => sh.classList.remove('sobe'), { once: true }); }
  $('overlay').querySelectorAll('[data-fechar]').forEach(b => b.onclick = () => fecharSheet());
  SHEET_FECHA = aoFechar || null;
  JANELA_TECLADO(); // janela nova aberta com o teclado ainda na tela
  if (rolagem) $('overlay').querySelector('.sheet').scrollTop = rolagem;
  montar && montar($('overlay').querySelector('.sheet'));
  if (anima) focoInicial($('overlay').querySelector('.sheet'));
  if (rolagem) { const sh = $('overlay').querySelector('.sheet'); if (sh && !sh.scrollTop) sh.scrollTop = rolagem; }
}
let SHEET_CHAVE = '';
// arrastar a janela para baixo pela alça (ou pelo topo, com a janela no início) fecha, como nos apps do celular
(function arrastarParaFechar() {
  let sh = null, y0 = 0, t0 = 0, dy = 0, ativo = false;
  document.addEventListener('touchstart', e => {
    const s = e.target.closest && e.target.closest('#overlay .sheet'); if (!s || e.touches.length !== 1) return;
    const topo = e.touches[0].clientY - s.getBoundingClientRect().top;
    // só pela faixa de cima (alça e título), e com a janela rolada até o início; nunca começando num campo
    if (topo > 64 || s.scrollTop > 2 || e.target.closest('input,textarea,select,button,a,label')) return;
    sh = s; y0 = e.touches[0].clientY; t0 = Date.now(); dy = 0; ativo = false;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!sh) return; dy = e.touches[0].clientY - y0;
    if (!ativo && dy > 6) { ativo = true; sh.style.transition = 'none'; }
    if (!ativo) return;
    e.preventDefault(); sh.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const soltar = () => {
    if (!sh) return; const s = sh; sh = null; if (!ativo) return;
    const rapido = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6;
    s.style.transition = 'transform .2s ease';
    if (dy > Math.min(140, s.offsetHeight * 0.25) || rapido) {
      s.style.transform = 'translateY(100%)';
      setTimeout(() => { fecharSheet(); if (document.body.contains(s)) { s.style.transition = 'transform .2s ease'; s.style.transform = ''; } }, 180);
    } else s.style.transform = '';
  };
  document.addEventListener('touchend', soltar); document.addEventListener('touchcancel', soltar);
})();
// aviso de erro numa janela: se ficou fora da vista (ex.: lá embaixo, perto do botão), a janela rola até ele.
// Antes, com o teclado aberto, a pessoa tocava em Salvar, o aviso aparecia escondido e parecia que nada tinha acontecido.
new MutationObserver(ms => {
  for (const m of ms) { const el = m.target.nodeType === 1 ? m.target : m.target.parentElement; if (!el || !el.classList || !el.classList.contains('err') || el.id === 'errperto' || !el.textContent.trim()) continue;
    const sh = el.closest('.sheet'); if (!sh) continue; const r = el.getBoundingClientRect(), rs = sh.getBoundingClientRect();
    if (r.top < rs.top + 8 || r.bottom > rs.bottom - 8) sh.scrollTo({ top: sh.scrollTop + r.top - rs.top - rs.height / 2, behavior: 'smooth' }); }
}).observe(document.getElementById('overlay'), { subtree: true, childList: true, characterData: true });
// uma tela pode pedir para confirmar antes de fechar (ex.: chamada com marcações sem salvar). Devolve true para segurar.
let SHEET_SAIR = null;
window.addEventListener('beforeunload', e => { if (SHEET_SAIR && SHEET_SAIR.sujo && SHEET_SAIR.sujo()) { e.preventDefault(); e.returnValue = ''; } });
function fecharSheet(forcar) { if (!forcar && SHEET_SAIR && SHEET_SAIR(() => fecharSheet(true))) return; SHEET_SAIR = null; TELA_SHEET = ''; if (SHEET_FECHA) { const f = SHEET_FECHA; SHEET_FECHA = null; f(); } SHEET_VOLTAR = null; $('overlay').innerHTML = ''; travarFundo(false); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('overlay').innerHTML) fecharSheet(); });
/* ================= No computador: teclado como num programa de computador =================
   Enter passa para o próximo campo; no último campo, Enter salva (aperta o botão principal da janela).
   Ctrl+Enter salva de qualquer campo. "/" ou Ctrl+K abre a busca. Alt+1, Alt+2... trocam de aba.
   A janela nova já abre com o cursor no primeiro campo vazio. No celular nada disso muda. */
const DESK = () => !!(window.matchMedia && matchMedia('(min-width:1000px) and (hover:hover)').matches);
const CAMPO_SEL = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]):not([type=range]),select,textarea';
const visivel = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
const camposDe = caixa => [...caixa.querySelectorAll(CAMPO_SEL)].filter(el => !el.disabled && !el.readOnly && visivel(el));
const botaoPrincipal = caixa => { const bs = [...caixa.querySelectorAll('button.btn:not(.ghost):not(.btn-mini):not([disabled])')].filter(visivel); return bs[bs.length - 1] || null; };
function focoInicial(caixa) {
  if (!DESK() || !caixa || caixa.contains(document.activeElement)) return;
  const cs = camposDe(caixa).filter(el => el.tagName !== 'SELECT'); const alvo = cs.find(el => !el.value) || null;
  if (alvo) { try { alvo.focus({ preventScroll: true }); } catch (e) { } }
}
document.addEventListener('keydown', e => {
  if (!DESK() || e.isComposing) return;
  const el = e.target, caixa = el && el.closest && (el.closest('#overlay .sheet') || el.closest('.login') || el.closest('#tela'));
  // Ctrl+Enter (ou Cmd+Enter): salva a janela aberta
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { const sh = $('overlay').querySelector('.sheet'); const b = sh && botaoPrincipal(sh); if (b) { e.preventDefault(); b.click(); } return; }
  // Enter num campo: vai para o próximo; no último, aperta o botão principal
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey && caixa && el.matches && el.matches(CAMPO_SEL) && el.tagName !== 'TEXTAREA') {
    if (e.defaultPrevented || el.onkeydown) return; // o campo já tem o seu próprio Enter
    const cs = camposDe(caixa), i = cs.indexOf(el); if (i < 0) return;
    e.preventDefault();
    if (i < cs.length - 1) { const n = cs[i + 1]; n.focus(); if (n.select && /^(text|email|tel|number|search|url)$/.test(n.type)) n.select(); return; }
    const b = caixa.closest('#overlay') ? botaoPrincipal(caixa) : null; if (b) b.click();
    return;
  }
  // atalhos fora dos campos
  const digitando = el && el.matches && el.matches('input,textarea,select,[contenteditable]');
  if (((e.key === '/' && !digitando) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) && !$('overlay').innerHTML) {
    const busca = $('abusca') || (document.querySelector('#tela input[type=search], #tela .busca-campo input')) ; if (busca) { e.preventDefault(); busca.focus(); busca.select && busca.select(); return; }
    if ($('hbusca')) { e.preventDefault(); $('hbusca').click(); }
    return;
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key) && !$('overlay').innerHTML) {
    const abas = document.querySelectorAll('nav.tabs [data-tab]'), b = abas[+e.key - 1]; if (b) { e.preventDefault(); b.click(); }
  }
});
function confirmar(titulo, texto, botao, acao) {
  sheet(`<h3>${esc(titulo)}</h3><p class="sub" style="margin:0">${texto}</p><div class="err" id="kerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn danger" id="kok">${esc(botao)}</button></div>`, () => {
    $('kok').onclick = async () => { $('kok').disabled = true; try { await acao(); fecharSheet(); } catch (e) { $('kerr').textContent = msgErro(e); $('kok').disabled = false; } };
  });
}

// aviso de erro logo abaixo do campo que falta (dentro da janela aberta), rolando só até ele. erroPerto(null) apaga.
function erroPerto(alvo, msg) {
  const ant = document.getElementById('errperto'); if (ant) ant.remove();
  if (!alvo) return;
  const d = document.createElement('div'); d.id = 'errperto'; d.className = 'err'; d.setAttribute('role', 'alert'); d.textContent = msg;
  alvo.insertAdjacentElement('afterend', d);
  const sh = alvo.closest('.sheet');
  if (sh) { const r = alvo.getBoundingClientRect(), rs = sh.getBoundingClientRect(); sh.scrollTo({ top: sh.scrollTop + r.top - rs.top - rs.height / 3, behavior: 'smooth' }); }
  else alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
/* ================= Abrir uma escola ================= */
async function abrirEscola(eid, tab) {
  pararOuvintes(); fecharSheet();
  RAIZ().innerHTML = `<div class="wrap" style="padding-top:40px"><div class="empty">Abrindo a escola…</div></div>`;
  let escola;
  try { escola = await B.get('escolas/' + eid); } catch (e) { escola = null; }
  if (!escola) { aviso('Você não tem mais acesso a essa escola.'); delete MINHAS[eid]; return telaInicio(); }
  const admin = (escola.admins || []).includes(EU.uid);
  // escola criada sem terminar o cadastro do cartão: volta para esse passo
  if (admin && escola.cartaoPendente && !LOJA()) return telaCartaoEscola(eid, escola.nome, () => abrirEscola(eid, tab));
  let prof = null;
  // professor(a) com acesso ao app: o servidor criou escolas/{eid}/equipe/{uid} quando ele(a) entrou com o e-mail cadastrado
  if (!admin) { const eq = await B.get(`escolas/${eid}/equipe/${EU.uid}`).catch(() => null); if (eq && eq.pid) prof = eq.pid; }
  const papel = admin ? 'a' : prof ? 'p' : 'f', ABAS_OK = { a: ['cobr', 'alunas', 'turmas', 'eventos', 'fin'], p: ['pturmas', 'palunos', 'pfin'], f: ['pagar', 'feventos', 'filhas'] }[papel];
  ls.set('escolinha.ultima', eid);
  S = { eid, admin, prof, papel, escola, mes: mesHoje(), tab: tab || ls.get('escolinha.tab.' + papel) || ABAS_OK[0],
    cfg: {}, mpc: {}, locais: {}, turmas: {}, grupos: {}, resps: {}, alunas: {}, extras: {}, pags: {}, lanc: {}, fixas: {}, membros: {}, profs: {}, acordos: {}, vinc: {}, pedidos: {}, saude: {}, docs: {}, eu: null, carregado: new Set(), sel: null, sug: [], anoRef: null };
  if (!ABAS_OK.includes(S.tab)) S.tab = ABAS_OK[0];
  const p = `escolas/${eid}`;
  const col = (nome, chave, onde) => B.ouvirCol(`${p}/${nome}`, docs => { S[chave] = Object.fromEntries(docs.map(d => [d.id, d.data])); S.carregado.add(chave); agendar(); }, e => console.warn(nome, e), onde);
  OUV.push(B.ouvirDoc(p, d => { if (d) { S.escola = d; agendar(); } }));
  OUV.push(B.ouvirDoc(`${p}/config/geral`, d => { S.cfg = d || {}; S.cfgOk = true; agendar(); }));
  // plano do app (teste, pago até, bloqueio por atraso): só o servidor grava
  OUV.push(B.ouvirDoc(`${p}/config/plano`, d => { S.plano = d || null; agendar(); }, () => { S.plano = null; }));
  if (!prof || admin) OUV.push(B.ouvirDoc(`${p}/config/contrato`, d => { S.contratoCfg = d || {}; agendar(); }, () => { }));
  (prof && !admin ? ['locais', 'turmas'] : ['locais', 'turmas', 'grupos', 'extras']).forEach(n => OUV.push(col(n, n)));
  if (prof && !admin) {
    // o professor não lê alunos, famílias nem pagamentos: o servidor manda só o que ele pode ver
    OUV.push(col(MOCK ? 'professoras' : 'profsPublico', 'profs'));
    carregarPainelProf();
  } else if (admin) {
    OUV.push(col('acordos', 'acordos')); OUV.push(col('contratos', 'contratos')); OUV.push(col('destratos', 'destratos'));
    OUV.push(col('professoras', 'profs')); OUV.push(col('profsPublico', 'profsPub')); OUV.push(col('responsaveis', 'resps')); OUV.push(col('alunas', 'alunas')); OUV.push(col('pagamentos', 'pags'));
    if (admin) { OUV.push(B.ouvirDoc(`${p}/config/mp`, d => { S.mpc = d || {}; agendar(); }, () => { })); OUV.push(col('lancamentos', 'lanc')); OUV.push(col('fixas', 'fixas')); OUV.push(col('membros', 'membros')); OUV.push(col('pedidosFamilia', 'pedidosFam')); OUV.push(col('pedidos', 'pedidos')); OUV.push(col('saude', 'saude')); OUV.push(col('docsAlunos', 'docs')); }
  } else {
    // a família só vê o nome de cada professor(a) (profsPublico, copiado pelo servidor); telefone e chave Pix ficam com a escola
    OUV.push(col(MOCK ? 'professoras' : 'profsPublico', 'profs'));
    const acordosPorRid = {}; S.acordos = {};
    OUV.push(B.ouvirDoc(`${p}/membros/${EU.uid}`, d => { S.eu = d || {}; agendar(); }, () => { S.eu = {}; agendar(); }));
    // responsável: só os cadastros ligados à conta dele, os alunos desses cadastros e a ficha de cada um
    const porRid = {}, porAluna = {}, alunasPorRid = {};
    const juntarAlunas = () => { S.alunas = Object.assign({}, ...Object.values(alunasPorRid)); S.carregado.add('alunas'); sincronizarFichas(); agendar(); };
    const sincronizarFichas = () => {
      for (const alid of Object.keys(S.alunas)) if (!porAluna[alid]) { const u1 = B.ouvirDoc(`${p}/pagamentos/${alid}`, d => { S.pags[alid] = d || {}; agendar(); }, () => { });
        // contratos assinados deste aluno (a família só lê os dos filhos dela)
        const u2 = B.ouvirCol(`${p}/contratos`, docs => { S.contratos = { ...Object.fromEntries(Object.entries(S.contratos || {}).filter(([, c]) => c.alid !== alid)), ...Object.fromEntries(docs.map(x => [x.id, x.data])) }; agendar(); }, () => { }, ['alid', alid]);
        const u3 = B.ouvirCol(`${p}/destratos`, docs => { S.destratos = { ...Object.fromEntries(Object.entries(S.destratos || {}).filter(([, c]) => c.alid !== alid)), ...Object.fromEntries(docs.map(x => [x.id, x.data])) }; agendar(); }, () => { }, ['alid', alid]);
        porAluna[alid] = () => { u1(); u2(); u3(); }; }
      for (const alid of Object.keys(porAluna)) if (!S.alunas[alid]) { porAluna[alid](); delete porAluna[alid]; delete S.pags[alid]; }
    };
    OUV.push(B.ouvirCol(`${p}/membros/${EU.uid}/vinculos`, docs => {
      const rids = new Set(docs.map(d => d.id)); S.carregado.add('vinc');
      for (const rid of rids) if (!porRid[rid]) porRid[rid] = [
        B.ouvirDoc(`${p}/responsaveis/${rid}`, d => { if (d) S.resps[rid] = d; else delete S.resps[rid]; agendar(); }, () => { }),
        B.ouvirCol(`${p}/alunas`, docs2 => { alunasPorRid[rid] = Object.fromEntries(docs2.map(x => [x.id, x.data])); juntarAlunas(); }, () => { }, ['responsavelId', rid]),
        B.ouvirCol(`${p}/saude`, docs3 => { for (const x of docs3) S.saude[x.id] = x.data; agendar(); }, () => { }, ['responsavelId', rid]),
        B.ouvirCol(`${p}/docsAlunos`, docs5 => { for (const x of docs5) S.docs[x.id] = x.data; agendar(); }, () => { }, ['responsavelId', rid]),
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
const FORMAS_PADRAO = { boleto: false, cartao: false, parcelado: false, maxParcelas: 3, jurosEscola: false, recorrente: false };
const taxasCfg = () => ({ ...TAXAS_PADRAO, ...(S.cfg.taxas || {}), parc: { ...TAXAS_PADRAO.parc, ...((S.cfg.taxas || {}).parc || {}) } });
const formasCfg = () => ({ ...FORMAS_PADRAO, ...(S.cfg.formas || {}) });
const COMISSAO = 0.01;
const TAXA_TRANSACAO = () => ((0.0099 + COMISSAO) * 100).toFixed(2).replace('.', ','); // Pix do Mercado Pago + app = 1,99%
// boleto e cartão: a escola liga em Ajustes → Formas de pagamento
const outrasFormas = () => { const f = formasCfg(); return f.boleto === true || f.cartao === true; };
// quanto a família paga em cada forma, para uma base (o que a escola tem que receber)
// valor de cada forma de pagamento; baseRep = parte em que quem paga cobre a taxa (padrão: a escolha da escola)
function valorForma(base, forma, n, baseRep) {
  // mesmo cálculo do servidor (regras.js); no parcelado, os juros o Mercado Pago soma na fatura de quem parcela
  const { valor } = C.valorForma(base, forma, S.cfg, COMISSAO, baseRep);
  return { total: valor, parcelas: n || 1, parcela: C.r2(valor / (n || 1)) };
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
  if (!neg && (p || (m && m.v > 0))) out.push({ k: `m:${mes}:${alid}`, tipo: 'm', alid, mes, v: p ? C.r2(p.v) : m.v, venc: C.vencAluna(S.alunas[alid], mes, S.cfg), pago: p, tipoExtra: null });
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
const profNome = t => { const ns = C.profsTurma(t).map(id => (S.profs[id] || {}).nome).filter(Boolean); return ns.length ? ns.join(' e ') : (t && t.professora) || ''; };
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
// (81) 99934-0203
const foneBR = t => { const d = C.soDigitos(t).replace(/^55(?=\d{10,11}$)/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : String(t || '').trim(); };
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
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
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
// bolinha com o número de avisos na aba (família: o que falta pagar e as taxas divididas sem resposta)
function bolhaAba(k) {
  if (!['pagar', 'feventos', 'filhas'].includes(k) || S.papel !== 'f' || !S.carregado || !S.carregado.has('alunas')) return '';
  let n = 0;
  // meus filhos: o que falta a família fazer (termo, atestado, documentos, contrato e cancelamento para assinar)
  if (k === 'filhas') { try { n = ((avisoTermos() + avisoContratos() + avisoDestratosFam() + avisoDocsFam()).match(/class="faixa-resumo/g) || []).length; } catch (e) { return ''; } }
  else
  // eventos: convites sem resposta (dentro do prazo) e inscrições que a família ainda precisa fazer com quem organiza
  if (k === 'feventos') { try { const h = hoje(), meus = Object.keys(S.alunas);
    for (const [, x] of eventosAtivos()) { if (fimDe(x) < h) continue; const cv = convidadosDe(x).filter(id => meus.includes(id));
      if (!C.prazoPassou(x)) n += cv.filter(id => !partDe(x, id)).length;
      n += new Set([...faltaInscEv(x, cv), ...faltaTamEv(x, cv)]).size; } } catch (e) { return ''; } }
  else try { for (const id of Object.keys(S.alunas || {})) n += itensDe(id).filter(i => !i.pago).length;
    for (const x of Object.values(S.extras || {})) if (x && x.tipo === 'taxa' && x.rateio && !C.rateioFechado(x)) n += (x.convidados || []).filter(id => S.alunas[id] && !rtSt(x, id)).length; } catch (e) { return ''; }
  return n ? `<span class="tab-bolha num" aria-label="${n} pendente${n > 1 ? 's' : ''}">${n > 99 ? '99+' : n}</span>` : '';
}
function render() {
  aplicarMarca(S.cfg);
  if (!S) return;
  setTimeout(abrirChamadaPendente, 0);
  const adm = S.admin, abas = {
    a: [['cobr', 'Pendências', 'pend'], ['alunas', 'Alunos', 'alunas'], ['turmas', 'Turmas', 'escola'], ['eventos', 'Eventos', 'evento'], ['fin', 'Financeiro', 'caixa']],
    p: [['pturmas', 'Turmas', 'escola'], ['palunos', 'Alunos', 'alunas'], ['pfin', 'Financeiro', 'caixa']],
    f: [['filhas', 'Meus filhos', 'filhas'], ['feventos', 'Eventos', 'evento'], ['pagar', 'Pagar', 'cobr']] }[S.papel];
  const comMes = (adm && S.tab === 'fin') || (S.papel === 'p' && S.tab === 'pfin');
  const titulo = adm ? 'Administração' : S.prof ? 'Professor(a) ' + ((S.profs[S.prof] || {}).nome || '') : (Object.values(S.resps)[0] || {}).nome || 'Responsável';
  const foco = document.activeElement && document.activeElement.id, selS = foco && document.activeElement.selectionStart;
  RAIZ().innerHTML = `<div class="wrap">
    <header class="top">
      <div class="brand">${S.cfg.logo ? `<img class="marca" src="${esc(S.cfg.logo)}" alt="">` : ''}<h1><small>${esc(titulo)}</small>${esc(S.escola.nome || 'Escola')}</h1>
        <div class="acts">${adm ? `<button class="icon-btn" id="hbusca" aria-label="Buscar aluno ou responsável">${ICO.lupa}</button>` : ''}<button class="icon-btn" id="hcfg" aria-label="Ajustes">${ICO.gear}</button></div></div>
      ${Object.keys(MINHAS).length > 1 ? `<button class="troca-btn" id="htroca">${ICO.troca}<span>Trocar escola</span></button>` : ''}
      ${comMes ? `<div class="monthbar"><button id="mprev" aria-label="Mês anterior">‹</button><div class="m num">${esc(nomeMesAno(S.mes))}</div><button id="mnext" aria-label="Próximo mês">›</button></div>` : ''}
    </header>
    <div id="faixa"></div>
    <main id="tela" style="display:flex;flex-direction:column;gap:16px"></main>
  </div>
  <nav class="tabs" aria-label="Seções"><div class="tabs-marca"><span class="marca-mini">${MARCA_SVG}</span><span>Turma em Dia</span></div><div class="in">${abas.map(([k, n, ic], i) => `<button data-tab="${k}" aria-current="${S.tab === k ? 'page' : 'false'}" title="Alt+${i + 1}"><span class="tab-ic">${ICO[ic]}${bolhaAba(k)}</span>${n}</button>`).join('')}</div><div class="tabs-atalhos"><b>Atalhos do teclado</b><span><kbd>Enter</kbd> próximo campo</span><span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> salvar</span><span><kbd>Esc</kbd> fechar janela</span>${adm ? '<span><kbd>/</kbd> buscar</span>' : ''}<span><kbd>Alt</kbd>+<kbd>1</kbd>… trocar de aba</span></div></nav>`;
  RAIZ().querySelectorAll('[data-tab]').forEach(b => b.onclick = () => irPara(b.dataset.tab));
  ABAS_ATUAIS = abas.map(([k]) => k);
  $('hcfg').onclick = () => sheetAjustes();
  if ($('hbusca')) $('hbusca').onclick = () => sheetBusca();
  if ($('htroca')) $('htroca').onclick = () => trocarEscola();
  if (comMes) { const muda = n => { S.mes = mesMais(S.mes, n); render(); if (S.papel === 'p') carregarPainelProf(); }; $('mprev').onclick = () => muda(-1); $('mnext').onclick = () => muda(1); }
  faixa();
  const v = $('tela');
  if (S.plano && sitPlano().fase === 'suspensa') return telaPlanoParado(v);
  if (S.papel === 'f' && S.eu && !S.eu.consentimento) return telaConsentimento(v);
  ({ cobr: tCobrancas, alunas: tAlunas, turmas: tTurmas, eventos: tEventos, fin: tFinanceiro, pagar: tPagar, filhas: tFilhas, lancar: tLancar, pturmas: tPTurmas, palunos: tPAlunos, feventos: tFEventos, pfin: tPFin })[S.tab](v);
  pedirFotos();
  if (foco && $(foco) && $(foco).tagName === 'INPUT' && $(foco).type !== 'checkbox') { $(foco).focus(); try { $(foco).setSelectionRange(selS, selS); } catch (e) { } }
  // a tela foi redesenhada com o campo (ou o seletor) em foco: se nada ficou em foco, a barra de abas volta
  setTimeout(() => { const a = document.activeElement; if (!(a && a.matches && a.matches('input:not([type=checkbox]):not([type=radio]),textarea,select'))) document.body.classList.remove('digitando'); }, 150);
}
function irPara(tab, extra) { if (S.tab !== tab) { S.hist = (S.hist || []).concat(S.tab).slice(-20); } S.tab = tab; Object.assign(S, extra || {}); ls.set('escolinha.tab.' + S.papel, tab); render(); scrollTo(0, 0); }
function faixa() {
  const PAP = { a: ['administração', 'admin@teste.com'], p: ['professor(a)', 'professor@teste.com'], f: ['responsável', 'familia@teste.com'] };
  const f = $('faixa'); let h = MOCK ? `<div class="banner" style="margin-bottom:8px"><span>Modo de teste, com dados de exemplo. Você está como <b>${PAP[S.papel][0]}</b>.</span><span class="actions">${Object.entries(PAP).filter(([k]) => k !== S.papel).map(([k, [n, e]]) => `<button data-ver="${e}">Ver como ${n}</button>`).join('')}${S.admin ? `<button id="mano">${S.anoRef ? 'Voltar para hoje' : 'Simular janeiro de ' + (Number(hoje().slice(0, 4)) + 1)}</button>` : ''}</span></div>` : '';
  if (S.admin) {
    h += faixaPlano() + avisoLimitePlano();
    if (!S.cfg.mpConectadoEm) h += `<div class="banner"><span>O <b>Pix automático</b> ainda não está ligado. Conecte a conta do Mercado Pago da escola para os responsáveis pagarem pelo app.</span><button id="fpix">Ligar Pix</button></div>`;
    else if (S.mpc && S.mpc.conta && S.mpc.confirmada === false) h += `<div class="banner"><span>Confira a conta conectada: <b>${esc(S.mpc.conta.nome || '')}</b> ${esc(S.mpc.conta.doc || '')}</span><button id="fpix">Conferir</button></div>`;
  }
  f.innerHTML = h; if ($('fpix')) $('fpix').onclick = () => sheetAjustes(); if ($('fplano')) $('fplano').onclick = () => sheetPlano(); if ($('fplano2')) $('fplano2').onclick = () => sheetPlano();
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
    ${m.dPrimeiro > 0 ? contaL(`Primeiro mês${m.primeiro && m.primeiro.tipo === 'prop' ? ` (${m.primeiro.dias} de ${m.primeiro.de} dias)` : m.primeiro && m.primeiro.tipo === 'metade' ? ' (metade)' : ''}`, '− ' + brl(m.dPrimeiro), 'desc') : ''}
    ${m.dAjuste > 0 ? contaL((a && a.desc && a.desc.isenta ? 'Bolsa' : a && a.desc && a.desc.pct ? `Desconto (${Math.round(a.desc.pct * 100)}%)` : a && a.desc && a.desc.menos ? 'Desconto em R$' : 'Desconto combinado com a escola') + (a && a.desc && a.desc.motivo ? `<span class="s" style="display:block">${esc(a.desc.motivo)}</span>` : ''), '− ' + brl(m.dAjuste), 'desc') : m.dAjuste < 0 ? contaL('Valor combinado com a escola' + (a && a.desc && a.desc.motivo ? `<span class="s" style="display:block">${esc(a.desc.motivo)}</span>` : ''), '+ ' + brl(-m.dAjuste)) : ''}
    ${contaL('<b>Total por mês</b>', `<b>${brl(m.v)}</b>`, 'total')}</div>`;
}
// cobrança feita pela escola (WhatsApp ou mensagem copiada): guarda o dia, para não cobrar a mesma coisa toda hora
// alunas/{alid}.cobrado = { pend: ms (cadastro: termo, documentos, atestado), pag: ms (pagamentos) }
function marcarCobrado(alids, tipo) {
  if (!S.admin) return; const agora = Date.now();
  const ops = [...new Set(alids)].filter(id => S.alunas[id]).map(id => { const a = S.alunas[id]; a.cobrado = { ...(a.cobrado || {}), [tipo]: agora }; return { op: 'merge', p: `escolas/${S.eid}/alunas/${id}`, d: { cobrado: a.cobrado } }; });
  if (ops.length) B.lote(ops).catch(() => { });
}
const cobradoEm = (alid, tipo) => (((S.alunas[alid] || {}).cobrado) || {})[tipo] || 0;
// "Cobrado hoje", "Cobrado ontem", "Cobrado em 05/11"
function cobradoTxt(alid, tipo) {
  const ms = cobradoEm(alid, tipo); if (!ms) return '';
  const dia = new Date(ms - 3 * 36e5).toISOString().slice(0, 10), h = hoje(), ontem = new Date(Date.parse(h + 'T12:00') - 864e5).toISOString().slice(0, 10);
  return dia === h ? 'Cobrado hoje' : dia === ontem ? 'Cobrado ontem' : `Cobrado em ${dataBR(dia)}`;
}
const cobradoHTML = (alid, tipo) => { const t = cobradoTxt(alid, tipo); return t ? `<span class="cobrado">${t}</span>` : ''; };
document.addEventListener('click', e => { const el = e.target.closest && e.target.closest('[data-cobr]'); if (!el) return; const [ids, tipo] = el.dataset.cobr.split(':'); marcarCobrado(ids.split(','), tipo); }, true);
function linhaAluna(alid, valor, status, subs, depois) {
  const a = S.alunas[alid] || {};
  return `<li class="tap" data-aluna="${esc(alid)}">${avatarAluno(alid, a.nome)}<div class="grow"><div class="t">${esc(a.nome || 'Aluno(a)')}</div>${linhas(subs || [esc(respDe(alid).nome || 'Sem responsável')])}</div>${valorCol(brl(valor), status ? `<span class="chip ${status}">${ROT[status]}</span>` : '')}${depois || ''}</li>`;
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
  const cur = brl;
  // quem deve: uma lista só, com filtros
  const filtro = S.filtroCobr || 'aberto', q = (S.buscaC || '').trim().toLowerCase(), mesAtual = mesHoje();
  const todos = Object.keys(S.alunas).map(alid => ({ alid, ...resumoAluna(alid) })).filter(r => r.it.length);
  const antigos = atr.porAluna.map(x => ({ ...x, vAntes: C.r2(x.it.filter(i => String(i.venc).slice(0, 7) < mesAtual).reduce((s, i) => s + i.v, 0)) })).filter(x => x.vAntes > 0);
  const cont = { aberto: todos.filter(r => r.aberto > 0).length, vencido: todos.filter(r => r.status === 'vencido').length, antigos: antigos.length, pago: todos.filter(r => r.status === 'pago').length, todas: todos.length };
  const busca = alid => !q || String(S.alunas[alid].nome).toLowerCase().includes(q) || String(respDe(alid).nome || '').toLowerCase().includes(q);
  const WA_VAZIO = '<span class="wa wa-vazio" aria-hidden="true"></span>';
  const waDe = (alid, itens) => { const r = respDe(alid), wa = waLink(r.telefone, textoMsg('atraso', alid, itens)); return wa ? `<a class="wa" href="${esc(wa)}" target="_blank" rel="noopener" data-cobr="${esc(alid)}:pag" aria-label="WhatsApp de ${esc(r.nome || '')}">${ICO_WA}</a>` : '<span class="wa wa-vazio" aria-hidden="true"></span>'; };
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
    lista = rows.length ? `<ul class="list">${rows.map(r => linhaAluna(r.alid, r.status === 'pago' ? 0 : r.aberto, r.status, [esc(respDe(r.alid).nome || 'Sem responsável'), r.vencido && r.vencido < r.aberto ? `<span class="num">${cur(r.vencido)} já vencido</span>` : '', r.status !== 'pago' ? cobradoHTML(r.alid, 'pag') : ''], r.vencido ? waDe(r.alid, r.it.filter(i => !i.pago && st(i) === 'vencido')) : WA_VAZIO)).join('')}</ul>`
      : `<div class="empty">${Object.keys(S.alunas).length ? 'Nenhum aluno neste filtro.' : '<b>Nenhum aluno cadastrado.</b><span>Cadastre os alunos na aba Alunos.</span>'}</div>`;
  }
  const ext = Object.entries(S.extras).filter(([, x]) => !eventoNovo(x) || pelaEscola(x)).sort((a, b) => String(b[1].venc).localeCompare(String(a[1].venc)));
  const fil = (k, n) => `<button class="pick" data-fl="${k}" aria-pressed="${filtro === k}">${n} <span class="num">${cont[k]}</span></button>`;
  v.innerHTML = `${cardPrimeirosPassos()}${cardPedidosFamilia()}${avisoDestratosAdm()}${avisoMudancasTermo()}${mudFx.length ? blocoFaixa(mudFx) : ''}${avisoAtestadosAdm()}${avisoPendenciasAdm()}
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
        return `<li class="tap" data-x="${esc(xid)}"><div class="grow"><div class="t">${esc(x.nome)}</div>${linhas(`<span class="num">${ehEvento(x) && x.data ? `Evento ${x.dataFim && x.dataFim !== x.data ? 'de ' : 'em '}${periodoTxt(x)}` : esc(C.TIPOS_EXTRA[x.tipo] || 'Extra')} · vence ${dataBR(x.venc)}</span>`, para.length ? 'Para: ' + esc(para.join(', ')) : '', (x.rateio ? `<span class="num">${rateioLinha(x)}</span>` : `<span class="num">${alvo.length} aluno${alvo.length === 1 ? '' : 's'} · ${Object.keys(x.valores || {}).length ? 'valores diferentes' : brl(x.v) + ' cada'}</span>`), 'Recebe: ' + esc(nomeRec(C.recDe(x))))}</div>${x.rateio && !C.rateioFechado(x) ? valorCol(cur(x.rateio.porAluno || x.rateio.total), '<span class="chip aberto">Respostas abertas</span>') : valorCol(cur(tot), `<span class="s num">${pg} de ${alvo.length} pagas</span>`)}</li>`; }).join('')}</ul>`
        : `<div class="empty"><span>Lance aqui taxas, como a da federação, ajuda de custo ou uniforme. Dá para lançar só para os inscritos de um evento. Escolha para quais grupos, turmas ou alunos cada um vale e o vencimento de cada um.</span></div>`}
    </section>`;
  ligarFaixa(v);
  ligarPrimeirosPassos(v); ligarPedidosFamilia(v);
  if ($('vatlist')) $('vatlist').onclick = () => sheetAtestadosEscola();
  if ($('vpend')) $('vpend').onclick = () => sheetPendencias();
  v.querySelectorAll('[data-vmud]').forEach(b => b.onclick = () => { const f = termosParaVer(), i = f.indexOf(b.dataset.vmud); sheetVerTermo(b.dataset.vmud, i >= 0 ? f.filter(id => id !== b.dataset.vmud) : []); });
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
  atestado: 'Olá, {responsavel}! Aqui é da {escola}. Para {aluno} fazer as aulas com segurança, precisamos de um atestado médico dizendo que pode fazer a atividade física.\n\nÉ só tirar uma foto do atestado e enviar pelo app, em Meus filhos: {link}\n{codigo}',
  pendencias: 'Olá, {responsavel}! Aqui é da {escola}. Para deixar o cadastro de {aluno} em dia, falta:\n{pendencias}\n\nÉ só fazer pelo app, em Meus filhos: {link}\n{codigo}'
};
const MODELOS_NOME = { lembrete: 'Lembrete', atraso: 'Atraso', acordo: 'Acordo', atestado: 'Atestado', pendencias: 'Cadastro pendente' };
const CAMPOS_MSG = [['responsavel', 'Responsável'], ['aluno', 'Aluno(a)'], ['escola', 'Escola'], ['lista', 'Lista de cobranças'], ['total', 'Total'], ['parcelas', 'Parcelas do acordo'], ['pendencias', 'O que falta no cadastro'], ['link', 'Link do app'], ['codigo', 'Código de acesso']];
const modeloDe = tipo => ((S.cfg.modelos || {})[tipo] || MODELOS_PADRAO[tipo]);
function preencherModelo(modelo, v) {
  return String(modelo).replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? v[k] : m).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function camposMsg(tipo, alid, itens) {
  const r = respDe(alid), a = S.alunas[alid] || {};
  const A = tipo === 'acordo' ? Object.entries(S.acordos).filter(([, x]) => x.alid === alid && !x.cancelado && !x.perdao).map(([, x]) => x).pop() : null;
  const tot = A ? A.total : itens.reduce((s, i) => s + i.v, 0);
  return { responsavel: primeiro(r.nome) || 'responsável', aluno: primeiro(a.nome) || 'seu filho(a)', escola: S.escola.nome || 'escola',
    lista: itens.map(i => `• ${i.desc}: ${brl(i.v)} (${st(i) === 'vencido' ? 'venceu' : 'vence'} ${dataBR(i.venc)}${i.enc ? ', com multa e juros' : i.perdao && i.perdao.ate ? `, sem multa e juros se pago até ${dataBR(i.perdao.ate)}` : ''})`).join('\n'),
    total: brl(tot) + (A && A.desconto > 0 ? ` (com desconto de ${brl(A.desconto)})` : ''),
    parcelas: A ? A.parcelas.map(q => `• Parcela ${q.n} de ${A.parcelas.length}: ${brl(q.v)}, vence ${dataBR(q.venc)}`).join('\n') : '',
    pendencias: tipo === 'pendencias' ? faltaCadastro(alid).map(x => '• ' + x).join('\n') : '',
    link: LINK_APP, codigo: r.codigo ? `No primeiro acesso, use o código: ${r.codigo}` : '' };
}
// o que falta no cadastro do aluno, para a família resolver pelo app (termo, atestado, documentos, contrato)
function faltaCadastro(alid) {
  const a = S.alunas[alid] || {}; if (!C.ativaNoMes(a, mesHoje()) || a.anonimizadoEm) return [];
  const out = [], x = termoDe(alid);
  if (x.pend && x.pend.length) out.push('confirmar o termo de matrícula, que mudou');
  else if (x.st === 'vencido') out.push('atualizar o termo de matrícula (já tem mais de 1 ano)');
  else if (x.st !== 'ok') out.push('preencher o termo de matrícula');
  if (x.atest) { const rec = (((S.saude[alid] || {}).atestado) || {}).recusa; out.push(x.as === 'recusado' && rec ? `mandar outro atestado médico (o anterior não deu: ${rec.motivo})` : 'mandar o atestado médico'); }
  for (const T of tiposDoc()) { const s_ = situacaoDoc(docDe(alid, T.id)).st; if (s_ === 'falta') out.push(`mandar: ${T.nome}`); else if (s_ === 'vencido') out.push(`mandar de novo: ${T.nome} (venceu)`); else if (s_ === 'vence') out.push(`mandar de novo: ${T.nome} (vai vencer)`); }
  if (ctPede() && !ctAssinado(alid)) out.push('assinar o contrato');
  return out;
}
// mensagem pronta (WhatsApp) com o que falta no cadastro de um ou mais filhos do mesmo responsável
function msgPendencias(alids) {
  const com = alids.map(id => [id, faltaCadastro(id)]).filter(([, f]) => f.length); if (!com.length) return null;
  const r = respDe(com[0][0]), v = camposMsg('pendencias', com[0][0], []);
  v.aluno = com.map(([id]) => primeiro((S.alunas[id] || {}).nome)).join(' e ');
  v.pendencias = com.length === 1 ? com[0][1].map(x => '• ' + x).join('\n') : com.map(([id, f]) => `${primeiro((S.alunas[id] || {}).nome)}:\n${f.map(x => '• ' + x).join('\n')}`).join('\n\n');
  const txt = preencherModelo(modeloDe('pendencias'), v);
  return { txt, wa: waLink(r.telefone, txt), resp: r };
}
const WA_MINI_VAZIO = '<span class="wa wa-mini wa-vazio" aria-hidden="true"></span>';
// botão do WhatsApp (no cabeçalho do responsável e na lista de pendências); sem pendência ou sem telefone, o espaço vazio
function waPendencias(alids) {
  const m = msgPendencias(alids);
  return m && m.wa ? `<a class="wa wa-mini" href="${esc(m.wa)}" target="_blank" rel="noopener" data-cobr="${esc(alids.join(','))}:pend" data-nao-abre aria-label="Cobrar pelo WhatsApp o que falta no cadastro">${ICO_WA}</a>` : WA_MINI_VAZIO;
}
// família: documentos que a escola pede e ainda faltam (ou venceram), com o botão para enviar
function avisoDocsFam() {
  const out = [];
  for (const [id, a] of porNome(S.alunas)) { if (a.anonimizadoEm || !C.ativaNoMes(a, mesHoje())) continue;
    for (const T of tiposDoc()) { const st_ = situacaoDoc(docDe(id, T.id)).st; if (!['falta', 'vencido', 'vence'].includes(st_)) continue;
      out.push(`<button class="faixa-resumo" data-pfdoc="${esc(id)}" data-pfdt="${esc(T.id)}"><span class="grow"><b>${st_ === 'falta' ? 'Enviar' : 'Enviar de novo'}: ${esc(T.nome)} de ${esc(primeiro(a.nome))}</b><span class="s">${st_ === 'falta' ? 'A escola pede este documento. Tire uma foto e envie por aqui.' : st_ === 'vencido' ? 'O documento venceu. Envie o novo.' : 'O documento vai vencer. Envie o novo.'}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`); } }
  return out.join('');
}
// faixa na tela de Cobranças: alunos com algo faltando no cadastro
function avisoPendenciasAdm() {
  const n = porNome(S.alunas).filter(([id]) => faltaCadastro(id).length).length; if (!n) return '';
  return `<button class="faixa-resumo" id="vpend"><span class="grow"><b>Pendências dos alunos</b><span class="s"><b>${n}</b> aluno${n === 1 ? '' : 's'} com algo faltando no cadastro: termo, atestado, documentos ou contrato</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`;
}
const FILTROS_PEND = [['todos', 'Todos'], ['termo', 'Termo'], ['atestado', 'Atestado'], ['doc', 'Documentos'], ['contrato', 'Contrato']];
function sheetPendencias(filtro = 'todos') {
  const volta = () => sheetPendencias(filtro), casa = x => filtro === 'todos' || (filtro === 'termo' ? /termo/.test(x) : filtro === 'atestado' ? /atestado/.test(x) : filtro === 'contrato' ? /contrato/.test(x) : /^mandar( de novo)?:/.test(x));
  const L = porNome(S.alunas).map(([id, a]) => [id, a, faltaCadastro(id)]).filter(([, , f]) => f.some(casa));
  sheet(`<h3>Pendências dos alunos</h3><div class="sub">O que falta no cadastro de cada aluno. A família também vê esses avisos quando abre o app. Toque no WhatsApp para mandar a mensagem pronta com tudo o que falta.</div>
    <div class="seg" style="margin:10px 0;flex-wrap:wrap">${FILTROS_PEND.map(([v, t]) => `<button type="button" data-pf="${v}" aria-pressed="${filtro === v}">${t}</button>`).join('')}</div>
    ${L.length ? `<ul class="list">${L.map(([id, a, f]) => `<li class="tap pend-lin" data-pal="${esc(id)}">${avatarAluno(id, a.nome)}<div class="grow"><div class="t">${esc(a.nome)}</div><span class="s">${esc(respDe(id).nome || 'Sem responsável')}</span>${cobradoHTML(id, 'pend')}
      <ul class="pend-itens">${f.map(x => `<li>${esc(x.charAt(0).toUpperCase() + x.slice(1))}</li>`).join('')}</ul></div>${waPendencias([id])}</li>`).join('')}</ul>`
      : '<div class="empty"><b>Nada pendente aqui.</b></div>'}
    <button class="btn ghost" data-fechar>Fechar</button>`, sh => {
    sh.querySelectorAll('[data-pf]').forEach(b => b.onclick = () => sheetPendencias(b.dataset.pf));
    sh.querySelectorAll('[data-pal]').forEach(li => li.onclick = e => { if (e.target.closest('[data-nao-abre]')) return; abrirDe(volta, () => sheetPerfilAluno(li.dataset.pal, volta)); });
  });
}
// perfil do aluno: o que falta, com a mensagem pronta
function blocoPendPerfil(alid) {
  const f = faltaCadastro(alid); if (!f.length) return '';
  const m = msgPendencias([alid]);
  // documento e atestado: a escola pode adicionar aqui o que a família mandou por fora (WhatsApp, papel)
  const acao = x => { if (/atestado/.test(x)) return 'at'; const m = /^mandar(?: de novo)?: (.+?)(?: \((?:venceu|vai vencer)\))?$/.exec(x); const T = m && tiposDoc().find(T => T.nome === m[1]); return T ? 'd:' + T.id : ''; };
  const lin = x => { const t = esc(x.charAt(0).toUpperCase() + x.slice(1)), k = acao(x);
    return k ? `<button type="button" class="plinha" data-ppa="${esc(k)}"><span class="grow">${t}</span><span class="chip aberto">Falta</span></button>`
      : `<div class="plinha"><span class="grow">${t}</span><span class="chip aberto">Falta</span></div>`; };
  return `<section class="psec"><div class="psec-cab"><h2>Pendências</h2>${cobradoHTML(alid, 'pend')}</div><div class="plista">${f.map(lin).join('')}</div>
    <div class="actions" style="margin-top:10px">${m && m.wa ? `<a class="btn wa-btn" href="${esc(m.wa)}" target="_blank" rel="noopener" data-cobr="${esc(alid)}:pend">${ICO_WA} Cobrar pelo WhatsApp</a>` : ''}<button type="button" class="btn ghost" id="ppcop" data-cobr="${esc(alid)}:pend">Copiar mensagem</button></div>
    <span class="s" style="display:block;margin-top:6px">A família também vê esses avisos no app, na tela de pagar.</span></section>`;
}
function textoMsg(tipo, alid, itens) {
  if (tipo === 'acordo' && !Object.values(S.acordos).some(x => x.alid === alid && !x.cancelado && !x.perdao)) tipo = 'lembrete';
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
    const temAcordo = acordosAl.some(([, A]) => !A.perdao);
    let tipoMsg = abertos.some(i => st(i) === 'vencido') ? 'atraso' : temAcordo ? 'acordo' : 'lembrete';
    sheet(`<div class="headrow"><h3>${esc(a.nome)}</h3><button class="chip" id="cfich">Ficha do(a) aluno(a)</button></div>
      ${ddl([['Nascimento', esc(nascTxt(a))], ['Turmas', esc(turmasTxt(a) || 'Sem turma')], ['Responsável', esc(r.nome || '—')], ['WhatsApp', r.telefone ? `<span class="num" style="user-select:all">${esc(r.telefone)}</span>` : '']])}
      ${abertos.length ? `<div class="tot"><span>Em aberto</span><b class="num">${brl(tot)}</b></div>
        <div class="checks full">${abertos.map(i => `<label><input type="checkbox" data-i="${esc(i.k)}" checked><span class="grow"><span class="t" style="display:block">${esc(i.desc)}</span><span class="s">${esc(tipoItem(i))}${i.tipo === 'm' && i.detalhe ? ' · ' + esc(i.detalhe) : ''}</span><span class="s num">Vence ${dataBR(i.venc)}</span>${linhaEnc(i)}${i.enc ? `<button type="button" class="link enc-tirar" data-semenc="${esc(i.k)}">Tirar multa e juros</button>` : i.perdao ? `<button type="button" class="link enc-tirar" data-volenc="${esc(i.k)}">Voltar a cobrar multa e juros</button>` : ''}</span><span class="valor-col"><b class="num">${brl(i.v)}</b>${st(i) === 'vencido' ? '<span class="chip vencido">Vencida</span>' : ''}</span></label>`).join('')}</div>
        <div class="tot"><span>Marcado</span><b class="num" id="ftot"></b></div>
        <div class="actions"><button class="btn" id="fqr" ${S.cfg.mpConectadoEm ? '' : 'disabled'}>Cobrar na hora com QR</button><button class="btn ghost" id="fdin">Recebi em dinheiro</button></div>
        ${nfFamLigada() ? `<label class="check" style="font-weight:500;font-size:.9rem"><input type="checkbox" id="fnf" checked> Emitir nota fiscal do que foi recebido em dinheiro</label>` : ''}
        ${S.cfg.mpConectadoEm ? '' : '<div class="note">Ligue o Pix automático em Ajustes para gerar o QR Code.</div>'}
        ${abertos.some(i => st(i) === 'vencido' && i.tipo !== 'a') ? `<button class="btn ghost" id="facordo">Fazer acordo dos atrasados</button>` : ''}
        <div class="hero" style="padding:14px;gap:10px"><div class="label">Mensagem para ${esc(primeiro(r.nome) || 'o responsável')}</div>${cobradoTxt(alid, 'pag') ? `<div class="aviso-cobr">${cobradoTxt(alid, 'pag')} pelo WhatsApp. Confira antes de mandar de novo.</div>` : ''}
          <div class="seg"><button data-mt="lembrete">Lembrete</button><button data-mt="atraso">Atraso</button>${temAcordo ? '<button data-mt="acordo">Acordo</button>' : ''}</div>
          <textarea id="fmtxt" class="msg-edit" rows="8" aria-label="Mensagem"></textarea>
          <div class="note">Pode mexer no texto antes de enviar. Para mudar o texto de todas as próximas vezes, <button type="button" class="link" id="fmod">edite o modelo</button>.</div>
          ${S.cfg.mpConectadoEm ? `<label class="liga"><span class="grow"><b>Incluir código Pix</b><span class="s" id="fpixs">Coloca o Pix copia e cola no fim da mensagem. Vale por 24 horas e a baixa é automática.</span></span><input type="checkbox" role="switch" id="fpix"><span class="trilho" aria-hidden="true"></span></label>` : ''}
          <div class="actions">${numeroWa(r.telefone) ? `<a class="btn wa-btn" id="fwa" target="_blank" rel="noopener" data-cobr="${esc(alid)}:pag">${ICO_WA} Abrir no WhatsApp</span></a>` : ''}<button class="btn ghost" id="fmsg" data-cobr="${esc(alid)}:pag">Copiar</button></div>
          ${numeroWa(r.telefone) ? `<div class="note">Abre a conversa com ${esc(r.telefone)} e a mensagem já escrita. Você confere e toca em enviar.</div>` : '<div class="note">Cadastre o WhatsApp do responsável para enviar direto.</div>'}
          <div id="fpixc" class="actions" style="flex-direction:column"></div></div>`
        : `<div class="empty"><b>${it.length ? 'Nada em aberto. Tudo pago!' : 'Nenhuma cobrança.'}</b></div>`}
      ${acordosAl.map(([aid, A]) => { const pg = A.parcelas.filter(q => C.stPag((((S.pags[alid] || {}).acordos || {})[aid] || {})[q.n])).length; const quem = `${A.porNome ? ` por ${esc(A.porNome)}` : ''} em ${dataBR(A.criadoEm)}`, por = A.obs ? `<span class="s" style="display:block;margin-top:4px">“${esc(A.obs)}”</span>` : '';
        return A.perdao ? `<div class="banner ok"><span><b>Dívida perdoada</b>${quem}: ${brl(A.original)} (${esc(A.resumo || '')}).${por}</span><button data-cancac="${esc(aid)}">Desfazer perdão</button></div>`
          : `<div class="banner ok"><span><b>Acordo</b>${quem}: ${A.parcelas.length}x, total ${brl(A.total)}${A.desconto > 0 ? ` (desconto de ${brl(A.desconto)})` : ''} · ${pg} de ${A.parcelas.length} paga${pg === 1 ? '' : 's'}.${por}</span>${pg ? '' : `<button data-cancac="${esc(aid)}">Cancelar acordo</button>`}</div>`; }).join('')}
      ${pagos.length ? `<details class="historico"><summary><span class="grow"><b>Histórico de pagamentos</b><span class="s">${pagos.length} pagamento${pagos.length === 1 ? '' : 's'} · ${brl(C.r2(pagos.reduce((x, i) => x + i.v, 0)))}</span></span><span class="seta" aria-hidden="true">▾</span></summary><ul class="list">${pagos.map(i => `<li><div class="grow"><div class="t">${esc(i.desc)}</div>${linhas(`<span class="num">${nomeVia(i.pago)}${i.pago.d ? ' em ' + dataBR(i.pago.d) : ''}</span>`)}</div>${valorCol(brl(i.v), ONLINE(i.pago.via) ? `<span class="chip pix">${NOME_VIA[i.pago.via]}</span>` : `<button class="chip" data-desf="${esc(i.k)}">Desfazer</button>`, 'in')}</li>`).join('')}</ul>
        <div class="note">O que foi pago por Pix fica travado: só o que foi recebido em dinheiro pode ser desfeito.</div></details>` : ''}
      <div class="err" id="ferr" role="alert"></div>
      <button class="btn ghost" data-fechar>Fechar</button>`, s => {
      $('cfich').onclick = () => abrirDe(() => sheetCobrancaAluna(alid), () => sheetAluna(alid));
      const upd = () => { const t = abertos.filter(i => sel.has(i.k)).reduce((x, i) => x + i.v, 0); if ($('ftot')) $('ftot').textContent = brl(t); ['fqr', 'fdin'].forEach(id => { if ($(id) && !(id === 'fqr' && !S.cfg.mpConectadoEm)) $(id).disabled = !t; }); };
      s.querySelectorAll('[data-i]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.i) : sel.delete(c.dataset.i); upd(); }); upd();
      const marcados = () => abertos.filter(i => sel.has(i.k));
      const atualizaWa = () => { if ($('fwa')) $('fwa').href = waLink(r.telefone, $('fmtxt').value); };
      // código Pix no fim da mensagem: gerado na hora, para o que está marcado; muda a marcação, gera de novo
      let pixTxt = '', pixVez = 0;
      const msg = () => { if (!$('fmtxt')) return; $('fmtxt').value = textoMsg(tipoMsg, alid, marcados().length ? marcados() : abertos) + pixTxt; atualizaWa(); s.querySelectorAll('[data-mt]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mt === tipoMsg)); };
      const gerarPix = async () => {
        const vez = ++pixVez; pixTxt = ''; if ($('fpixc')) $('fpixc').innerHTML = ''; msg();
        if (!$('fpix') || !$('fpix').checked) { $('fpixs').textContent = 'Coloca o Pix copia e cola no fim da mensagem. Vale por 24 horas e a baixa é automática.'; return; }
        const ks = (marcados().length ? marcados() : abertos).map(i => i.k);
        $('fpixs').textContent = 'Gerando o código Pix…'; $('fpix').disabled = true;
        try {
          const lotes = await pixCriar(ks); if (vez !== pixVez) return;
          const ate = quandoRT(Math.min(...lotes.map(l => l.expira)));
          // o código vai numa mensagem separada: no WhatsApp a família copia a mensagem inteira, e o banco só aceita o código sozinho
          const N = lotes.length;
          pixTxt = `\n\nSe preferir, pague agora pelo Pix copia e cola. ${N > 1 ? `Vou mandar ${N} códigos nas próximas mensagens (são ${N} Pix porque vão para contas diferentes)` : 'Vou mandar o código na próxima mensagem'}. É só copiar e colar no app do seu banco.`
            + lotes.map(l => `\n${N > 1 ? `Pix para ${nomeRec(l.rec)}: ` : 'Valor: '}${brl(l.valor)}${C.r2(l.valor - l.base) > 0 ? ' (com a taxa de transação)' : ''}`).join('')
            + `\n${N > 1 ? 'Os códigos valem' : 'O código vale'} até ${ate}.`;
          $('fpixs').textContent = `Pronto. Vale até ${ate}. Envie a mensagem e depois ${N > 1 ? 'cada código' : 'o código'}, em mensagem separada, para a família copiar fácil.`;
          $('fpixc').innerHTML = lotes.map((l, i) => `<button type="button" class="btn ghost" data-pixc="${i}">Copiar código Pix${N > 1 ? ' · ' + esc(primeiro(nomeRec(l.rec))) : ''}</button>`).join('');
          $('fpixc').querySelectorAll('[data-pixc]').forEach(b => b.onclick = () => copiar(lotes[b.dataset.pixc].qr, 'Código copiado. Cole no WhatsApp, numa mensagem separada.'));
        } catch (e) { if (vez !== pixVez) return; $('fpix').checked = false; $('fpixs').textContent = msgErro(e); }
        finally { if ($('fpix')) $('fpix').disabled = false; }
        msg();
      };
      if ($('fpix')) $('fpix').onchange = gerarPix;
      if ($('fmtxt')) $('fmtxt').addEventListener('input', atualizaWa);
      if ($('fmod')) $('fmod').onclick = () => abrirDe(() => sheetCobrancaAluna(alid), () => sheetModelos(tipoMsg));
      s.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { tipoMsg = b.dataset.mt; msg(); });
      s.querySelectorAll('[data-i]').forEach(c => c.addEventListener('change', () => $('fpix') && $('fpix').checked ? gerarPix() : msg())); msg();
      if ($('fmsg')) $('fmsg').onclick = () => copiar($('fmtxt').value, 'Mensagem copiada. Cole no WhatsApp do responsável.');
      if ($('facordo')) $('facordo').onclick = () => abrirDe(() => sheetCobrancaAluna(alid), () => sheetAcordo(alid));
      s.querySelectorAll('[data-cancac]').forEach(b => b.onclick = () => { const pd = (S.acordos[b.dataset.cancac] || {}).perdao; confirmar(pd ? 'Desfazer o perdão?' : 'Cancelar acordo?', 'As cobranças antigas voltam para a lista de atraso, com os valores originais.', pd ? 'Desfazer perdão' : 'Cancelar acordo', async () => { await cancelarAcordo(b.dataset.cancac); setTimeout(() => sheetCobrancaAluna(alid), 80); }); });
      if ($('fqr')) $('fqr').onclick = () => sheetPix(marcados().map(i => i.k), () => sheetCobrancaAluna(alid));
      if ($('fdin')) $('fdin').onclick = () => duploToque($('fdin'), receberDinheiro, 'Toque de novo');
      const receberDinheiro = async () => {
        $('fdin').disabled = true;
        const val = i => ({ s: 'pago', d: hoje(), v: i.v, via: 'dinheiro', obs: 'Marcado pela administração', por: EU.uid, ...(i.enc ? { enc: { base: i.enc.base, multa: i.enc.multa || 0, juros: i.enc.juros || 0 } } : {}) });
        const up = { mens: {}, extras: {}, acordos: {} };
        marcados().forEach(i => { if (i.tipo === 'm') up.mens[i.mes] = val(i); else if (i.tipo === 'a') (up.acordos[i.aid] = up.acordos[i.aid] || {})[i.n] = val(i); else up.extras[i.xid] = val(i); });
        const emitir = $('fnf') && $('fnf').checked, ks = marcados().map(i => i.k);
        try { await B.set(`escolas/${S.eid}/pagamentos/${alid}`, up, { merge: true }); aviso('Pagamento registrado'); setTimeout(desenhar, 60);
          if (emitir) setTimeout(async () => { try { const r = await nfServidor('baixa', { alid, chaves: ks }), v = Object.values(r.res || {});
            aviso(v.includes('ok') ? 'Pagamento registrado e nota fiscal emitida' : v.includes('sem_dados') ? 'Pagamento registrado. A nota espera o CPF do responsável' : v.includes('erro') ? 'Pagamento registrado. A nota não saiu: veja em Notas emitidas' : 'Pagamento registrado'); }
            catch (e) { aviso('Pagamento registrado. A nota não saiu: ' + msgErro(e)); } }, 250); }
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
  if (!S.admin) return; // acordo e perdão: só a administração da escola (as regras do banco também barram o professor)
  const a = S.alunas[alid], r = respDe(alid), venc = itensDe(alid).filter(i => !i.pago && st(i) === 'vencido' && i.tipo !== 'a');
  const sel = new Set(venc.map(i => i.k)), d7 = new Date(Date.now() + 7 * 864e5), prim = `${d7.getFullYear()}-${pad(d7.getMonth() + 1)}-${pad(d7.getDate())}`;
  sheet(`<h3>Acordo · ${esc(a.nome)}</h3>
    <div class="sub">Responsável: ${esc(r.nome || '—')}. Junte as cobranças atrasadas, dê um desconto se quiser e divida em parcelas. As parcelas aparecem para pagar pelo app, e as cobranças antigas saem da lista de atraso.</div>
    <div class="checks full">${venc.map(i => `<label><input type="checkbox" data-ai="${esc(i.k)}" checked><span class="grow"><span class="t" style="display:block">${esc(i.desc)}</span><span class="s">venceu ${dataBR(i.venc)}</span></span><b class="num">${brl(i.v)}</b></label>`).join('')}</div>
    <div class="tot"><span>Total atrasado</span><b class="num" id="aqtot"></b></div>
    <div class="two"><div class="field"><label for="aqdt">Desconto</label><select id="aqdt"><option value="0">Sem desconto</option><option value="pct">Em %</option><option value="rs">Em R$</option><option value="tudo">Perdoar tudo</option></select></div>
    <div class="field" id="aqdvw" hidden><label for="aqdv" id="aqdl">Valor</label><input id="aqdv" inputmode="decimal"></div></div>
    <div id="aqparcw"><div class="two"><div class="field"><label for="aqn">Parcelas</label><select id="aqn">${[1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n === 1 ? 'À vista' : n + 'x'}</option>`).join('')}</select></div>
    <div class="field"><label for="aqv">1º vencimento</label><input id="aqv" type="date" value="${prim}" min="${hoje()}"></div></div>
    <div class="field"><label for="aqrec">As parcelas caem na conta de</label><select id="aqrec"><option value="" id="aqrec0">Conta original</option>${opcoesRec('__nenhum')}</select>
      <div class="note" id="aqrecnota"></div></div></div>
    <div class="items" id="aqprev"></div>
    <div class="field"><label for="aqobs" id="aqobsl">Observação (opcional)</label><textarea id="aqobs" rows="2" maxlength="300" placeholder="Ex.: combinado por telefone com o responsável"></textarea>
      <div class="note">Fica registrado quem fez e quando: ${esc(EU.nome || EU.email || 'você')}, hoje.</div></div>
    <div class="err" id="aqerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="aqok">Fechar acordo</button></div>`, s => {
    let plano = null;
    const calc = () => {
      const its = venc.filter(i => sel.has(i.k)), bruto = C.r2(its.reduce((x, i) => x + i.v, 0)), t = $('aqdt').value, dv = parseValor($('aqdv').value);
      $('aqdvw').hidden = t === '0'; $('aqdl').textContent = t === 'pct' ? 'Desconto (%)' : 'Desconto (R$)';
      $('aqdvw').hidden = t === '0' || t === 'tudo';
      const desc = t === 'tudo' ? bruto : t === 'pct' && dv > 0 ? C.r2(bruto * Math.min(dv, 100) / 100) : t === 'rs' && dv > 0 ? Math.min(bruto, C.r2(dv)) : 0, total = C.r2(bruto - desc), n = Number($('aqn').value);
      const base = Math.floor(total / n * 100) / 100, parcelas = [];
      for (let k = 1; k <= n; k++) { const dt = new Date($('aqv').value + 'T12:00'); dt.setMonth(dt.getMonth() + k - 1); parcelas.push({ n: k, v: k === n ? C.r2(total - base * (n - 1)) : base, venc: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` }); }
      // quem recebe as parcelas: na mesma proporção das cobranças que entraram
      const porRec = {}; its.forEach(i => Object.entries(i.partes || { escola: i.v }).forEach(([rc, x]) => porRec[rc] = (porRec[rc] || 0) + x));
      const original = Object.fromEntries(Object.entries(porRec).map(([rc, x]) => [rc, bruto ? x / bruto : 1]));
      // conta original (de quem recebia as cobranças) ou outra conta escolhida pela escola
      const nomeRc = rc => rc === 'escola' ? `${S.escola.nome || 'Escola'} (escola)` : ((S.profs[rc] || {}).nome || 'Professor(a)');
      const nomeC = rc => rc === 'escola' ? (S.escola.nome || 'Escola') : ((S.profs[rc] || {}).nome || 'Professor(a)');
      const ks = Object.keys(original), txtOrig = ks.length > 1 ? ks.map(rc => `${nomeC(rc)} ${Math.round(original[rc] * 100)}%`).join(' · ') : nomeC(ks[0] || 'escola');
      $('aqrec0').textContent = `Original: ${txtOrig}`;
      // a conta original não se repete na lista das outras
      $('aqrec').querySelectorAll('option[value]:not([value=""])').forEach(o => { const rep = ks.length === 1 && o.value === ks[0]; o.hidden = o.disabled = rep; if (rep && $('aqrec').value === o.value) $('aqrec').value = ''; });
      const outra = $('aqrec').value, fracoes = outra ? { [outra]: 1 } : original;
      $('aqrecnota').textContent = outra ? `Todas as parcelas vão para a conta de ${nomeRc(outra)}${recConectado(outra) ? '' : ', que ainda não ligou o Pix'}.` : ks.length > 1 ? 'Cada parcela é dividida entre essas contas, como as cobranças originais.' : 'A mesma conta que recebia essas cobranças.';
      // perdão (desconto de 100%): não tem parcelas; com desconto, a explicação é obrigatória
      const perdao = its.length > 0 && !(total > 0);
      $('aqparcw').hidden = perdao;
      $('aqobsl').textContent = desc > 0 ? (perdao ? 'Por que a dívida foi perdoada? (obrigatório)' : 'Explique o acordo e o desconto (obrigatório)') : 'Observação (opcional)';
      $('aqok').textContent = perdao ? 'Perdoar dívida' : 'Fechar acordo';
      plano = { its, bruto, desc, total, parcelas: perdao ? [] : parcelas, fracoes, perdao };
      $('aqtot').textContent = brl(bruto);
      $('aqprev').innerHTML = its.length ? `${desc > 0 ? `<div class="item"><span>Desconto</span><b class="num" style="color:var(--in)">− ${brl(desc)}</b></div>` : ''}<div class="item"><span><b>Total do acordo</b></span><b class="num">${brl(total)}</b></div>${parcelas.map(q => `<div class="item sub"><span>${n === 1 ? 'À vista' : `Parcela ${q.n} de ${n}`} · vence ${dataBR(q.venc)}</span><span class="num">${brl(q.v)}</span></div>`).join('')}<div class="item sub"><span>Recebe: ${esc(Object.keys(fracoes).map(nomeRec).join(', '))}</span></div>` : '';
      if (perdao) $('aqprev').innerHTML = `<div class="item"><span>Perdoado</span><b class="num" style="color:var(--in)">− ${brl(bruto)}</b></div><div class="item"><span><b>Fica devendo</b></span><b class="num">${brl(0)}</b></div><div class="note">As cobranças marcadas saem do "Quem deve" e ficam no histórico como perdoadas. Não entram no caixa, nem geram Pix ou nota fiscal. Dá para desfazer depois.</div>`;
    };
    s.querySelectorAll('[data-ai]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.ai) : sel.delete(c.dataset.ai); calc(); });
    ['aqdt', 'aqdv', 'aqn', 'aqv', 'aqrec'].forEach(id => $(id).addEventListener('input', calc)); $('aqrec').addEventListener('change', calc); calc();
    $('aqok').onclick = () => {
      const err = m => $('aqerr').textContent = m; err('');
      if (!plano.its.length) return err('Marque ao menos uma cobrança atrasada.');
      if (plano.desc > 0 && $('aqobs').value.trim().length < 5) { $('aqobs').focus(); return err(plano.perdao ? 'Explique por que a dívida foi perdoada.' : 'Explique o acordo e o desconto.'); }
      if (!plano.perdao && !$('aqv').value) return err('Escolha o vencimento da primeira parcela.');
      duploToque($('aqok'), fechar, 'Toque de novo para confirmar');
    };
    const fechar = async () => {
      const err = m => $('aqerr').textContent = m;
      $('aqok').disabled = true;
      const aid = novoId(), A = { alid, rid: S.alunas[alid].responsavelId || null, itens: plano.its.map(i => ({ k: i.k, tipo: i.tipo, mes: i.mes || null, xid: i.xid || null, v: i.v, desc: i.desc })), original: plano.bruto, desconto: plano.desc, total: plano.total,
        parcelas: plano.parcelas, fracoes: plano.fracoes, resumo: `${plano.its.length} cobrança${plano.its.length > 1 ? 's' : ''} atrasada${plano.its.length > 1 ? 's' : ''}`, obs: $('aqobs').value.trim(), criadoEm: hoje(), em: Date.now(), por: EU.uid, porNome: EU.nome || EU.email || '', ...(plano.perdao ? { perdao: true } : {}) };
      const marca = i => ({ s: 'acordo', acordo: aid, v: i.v, d: hoje() }), up = { mens: {}, extras: {} };
      plano.its.forEach(i => { if (i.tipo === 'm') up.mens[i.mes] = marca(i); else up.extras[i.xid] = marca(i); });
      try { await B.lote([{ op: 'set', p: `escolas/${S.eid}/acordos/${aid}`, d: A }, { op: 'merge', p: `escolas/${S.eid}/pagamentos/${alid}`, d: up }]); aviso(plano.perdao ? 'Dívida perdoada' : 'Acordo fechado. Mande as parcelas para o responsável.'); setTimeout(() => sheetCobrancaAluna(alid), 80); }
      catch (e) { err(msgErro(e)); $('aqok').disabled = false; }
    };
  });
}
async function cancelarAcordo(aid) {
  const A = S.acordos[aid]; if (!A) return;
  for (const i of A.itens || []) await B.tirar(`escolas/${S.eid}/pagamentos/${A.alid}`, i.tipo === 'm' ? `mens.${i.mes}` : `extras.${i.xid}`).catch(() => { });
  await B.set(`escolas/${S.eid}/acordos/${aid}`, { cancelado: true, canceladoEm: hoje(), canceladoPor: EU.uid, canceladoPorNome: EU.nome || EU.email || '' }, { merge: true });
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
  // nota fiscal do Pix, como o servidor faz
  try { await nfMockEmitir(cob.rec || 'escola', 'pix_' + chave.replace(/[^A-Za-z0-9_-]/g, ''), (S.alunas[(cob.itens[0] || {}).alid] || {}).responsavelId, cob.itens, 'pix'); } catch (e) { console.warn('nota teste', e); }
}
const opcoesRec = atual => [['escola', (S.escola.nome || 'Escola') + ' (escola)'], ...porNome(S.profs).map(([id, P]) => [id, P.nome])].map(([id, n]) => `<option value="${esc(id)}" ${(atual || 'escola') === id ? 'selected' : ''}>${esc(n)}${recConectado(id) ? '' : ' (Pix não ligado)'}</option>`).join('');
// a família escolhe como pagar, vendo quanto fica em cada forma
function sheetFormas(chaves) {
  const quer = new Set(chaves), itens = [...new Set(chaves.map(k => k.split(':')[2]))].flatMap(alid => itensDe(alid)).filter(i => quer.has(i.k) && !i.pago);
  const lotes = dividirPorRecebedor(itens), base = C.r2(itens.reduce((x, i) => x + i.v, 0)), f = formasCfg(), N = lotes.length;
  const tot = forma => C.r2(lotes.reduce((x, l) => x + valorForma(l.base, forma, 1, repLote(l)).total, 0));
  const pix = tot('pix'), maxP = f.parcelado ? Math.max(2, Number(f.maxParcelas) || 2) : 1;
  const ops = [['pix', 'Pix', 'Cai na hora · mais barato', ICO.cobr]];
  if (f.boleto) ops.push(['boleto', 'Boleto', 'Compensa em até 3 dias úteis', ICO.caixa]);
  if (f.cartao) ops.push(['cartao', 'Cartão de crédito', f.parcelado ? `À vista ou em até ${maxP}x` : 'À vista, na fatura do cartão', ICO.caixa]);
  sheet(`<h3>Como você quer pagar?</h3>
    <div class="conta">${contaL('Cobranças escolhidas', brl(base))}</div>
    ${N > 1 && ops.length > 1 ? `<div class="banner"><span>Essas cobranças vão para ${N} recebedores (${lotes.map(l => esc(nomeRec(l.rec))).join(', ')}). O Pix já separa sozinho. Para boleto ou cartão, escolha as cobranças de um recebedor por vez.</span></div>` : ''}
    <div class="formas">${ops.map(([fo, t, d, ic]) => { const v = tot(fo), trava = fo !== 'pix' && N > 1;
      return `<button type="button" class="forma" data-fo="${fo}" ${trava ? 'disabled' : ''}><span class="vant-ic">${ic}</span><span class="grow"><b>${esc(t)}</b><span class="s">${esc(d)}</span></span><span class="valor-col"><b class="num">${brl(v)}</b>${fo !== 'pix' && v > pix ? `<span class="s num">+ ${brl(C.r2(v - pix))} que o Pix</span>` : fo === 'pix' && ops.length > 1 ? '<span class="chip pago">Melhor preço</span>' : ''}</span></button>`; }).join('')}</div>
    ${f.cartao && f.parcelado ? '<div class="note">No parcelado, os juros aparecem antes de você confirmar.</div>' : ''}
    <button class="btn ghost" data-fechar>Cancelar</button>`, sh => {
    sh.querySelectorAll('[data-fo]').forEach(b => b.onclick = () => { const fo = b.dataset.fo, volta = () => sheetFormas(chaves);
      abrirDe(volta, () => fo === 'pix' ? sheetPix(chaves) : fo === 'boleto' ? sheetBoletoFam(chaves) : sheetCartaoFam(chaves)); });
  });
}

/* ---------- cartão de crédito dentro do app (o número vai direto do celular para o Mercado Pago) ---------- */
let MP_SDK = null;
function carregarMP() {
  if (window.MercadoPago) return Promise.resolve();
  if (!MP_SDK) MP_SDK = new Promise((ok, nao) => { const s = document.createElement('script'); s.src = 'https://sdk.mercadopago.com/js/v2'; s.onload = ok; s.onerror = () => { MP_SDK = null; nao(new Error('Não deu para abrir o Mercado Pago. Verifique a internet e tente de novo.')); }; document.head.appendChild(s); });
  return MP_SDK;
}
/* campos do cartão: no app publicado, cada campo é uma janelinha do próprio Mercado Pago (o app não lê o número);
   no modo de teste, campos comuns. ids: { num, val, cvv } (só cvv, para o cartão salvo). */
async function camposCartao(pk, ids, aoBin) {
  if (MOCK) {
    const pl = { num: '0000 0000 0000 0000', val: 'MM/AA', cvv: '123' };
    for (const [k, id] of Object.entries(ids)) if ($(id)) $(id).innerHTML = `<input inputmode="numeric" aria-label="${k === 'num' ? 'Número do cartão' : k === 'val' ? 'Validade' : 'Código de segurança'}" placeholder="${pl[k]}" id="${id}i">`;
    if (ids.num && $(ids.num + 'i')) $(ids.num + 'i').addEventListener('input', e => { const d = C.soDigitos(e.target.value); if (d.length >= 6 && aoBin) aoBin(d.slice(0, 6)); });
    return { mock: true, token: async () => { const d = C.soDigitos(($(ids.num + 'i') || {}).value || '4235647728025682'); if (ids.cvv && !C.soDigitos(($(ids.cvv + 'i') || {}).value).length) throw new Error('Digite o código de segurança.'); return { id: 'tok_' + Date.now(), last_four_digits: d.slice(-4) || '4242', first_six_digits: d.slice(0, 6) }; },
      metodo: async bin => ({ id: /^5/.test(bin) ? 'master' : 'visa', name: /^5/.test(bin) ? 'Mastercard' : 'Visa' }),
      parcelas: async (valor, bin, max) => Array.from({ length: max }, (_, i) => { const n = i + 1, tot = C.r2(valor * (n === 1 ? 1 : 1 + 0.0199 * n)); return { n, total: tot, parcela: C.r2(tot / n), juros: n > 1 }; }), sair: () => { } };
  }
  await carregarMP();
  const mp = new window.MercadoPago(pk, { locale: 'pt-BR' }), cor = getComputedStyle(document.body).color || '#222';
  const est = { style: { fontSize: '16px', color: cor, fontFamily: 'system-ui, sans-serif' } }, f = {};
  if (ids.num) { f.num = mp.fields.create('cardNumber', { placeholder: '0000 0000 0000 0000', ...est }).mount(ids.num); f.num.on('binChange', e => aoBin && e && e.bin && aoBin(e.bin)); }
  if (ids.val) f.val = mp.fields.create('expirationDate', { placeholder: 'MM/AA', ...est }).mount(ids.val);
  f.cvv = mp.fields.create('securityCode', { placeholder: '123', ...est }).mount(ids.cvv);
  return {
    token: async extra => { try { return await mp.fields.createCardToken(extra || {}); } catch (e) { const m = JSON.stringify(e || {}); throw new Error(/securityCode|security_code/i.test(m) ? 'Confira o código de segurança.' : /expiration/i.test(m) ? 'Confira a validade do cartão.' : /cardNumber|card_number/i.test(m) ? 'Confira o número do cartão.' : /identification/i.test(m) ? 'Confira o CPF do titular.' : 'Confira os dados do cartão.'); } },
    metodo: async bin => { const r = await mp.getPaymentMethods({ bin }); const x = (r && r.results || [])[0]; return x ? { id: x.id, name: x.name, emissor: x.issuer && x.issuer.id } : null; },
    parcelas: async (valor, bin, max) => { const r = await mp.getInstallments({ amount: String(valor), bin, paymentTypeId: 'credit_card' }); const pc = ((r || [])[0] || {}).payer_costs || [];
      return pc.filter(p => p.installments <= max).map(p => ({ n: p.installments, total: p.total_amount, parcela: p.installment_amount, juros: p.installment_rate > 0 })); },
    sair: () => Object.values(f).forEach(x => { try { x.unmount(); } catch (e) { } })
  };
}
const linhaParcela = p => p.n === 1 ? `À vista · ${brl(p.total)}` : `${p.n}x de ${brl(p.parcela)}${p.juros ? ` · total ${brl(p.total)}` : ' sem juros'}`;
// cartões salvos da família nesta escola (um por recebedor), lidos pelo servidor
async function meusCartoes(recarregar) {
  if (S.cartoes && !recarregar) return S.cartoes;
  try { S.cartoes = MOCK ? (MOCK_CARTOES[S.eid] || []) : ((await servidor('pagar', { acao: 'cartoes', eid: S.eid })).cartoes || []); } catch (e) { S.cartoes = []; }
  return S.cartoes;
}
const MOCK_CARTOES = {};
function sheetCartaoFam(chaves) {
  let campos = null;
  const sair = () => { if (campos) campos.sair(); campos = null; };
  sheet(`<h3>Cartão de crédito</h3><div id="cfc" class="empty">Preparando…</div><button class="btn ghost" data-fechar>Fechar</button>`, async () => {
    let P;
    try { P = MOCK ? await mockPagar({ acao: 'preparar', itens: chaves }) : await servidor('pagar', { acao: 'preparar', eid: S.eid, itens: chaves }); }
    catch (e) { $('cfc').innerHTML = `<b>${e.code === 'reconectar' ? 'Cartão ainda não disponível' : 'Não deu para preparar.'}</b><span>${esc(msgErro(e))}</span>`; return; }
    let usarSalvo = !!P.cartao, bin = P.cartao ? P.cartao.bin : '', metodo = P.cartao ? { id: P.cartao.metodo, name: P.cartao.marca } : null, ops = [{ n: 1, total: P.valor, parcela: P.valor }];
    const r = respPagador();
    const desenhar = async () => {
      sair();
      $('cfc').outerHTML = `<div id="cfc" style="display:flex;flex-direction:column;gap:12px">
        <div class="conta">${contaL('Cobranças', brl(P.base))}${P.valor > P.base ? contaL('Taxa de pagamento', brl(C.r2(P.valor - P.base))) : ''}${contaL('<b>Total</b>', `<b>${brl(P.valor)}</b>`, 'total')}</div>
        ${P.cartao ? `<div class="pl-meios">
          <button type="button" class="pl-meio ${usarSalvo ? 'sel' : ''}" id="cfsalvo"><span class="pl-ico" aria-hidden="true">💳</span><span class="grow"><b>${esc(P.cartao.marca)} •••• ${esc(P.cartao.fim)}</b><span class="s">Cartão salvo${P.cartao.validade ? ' · vence ' + esc(P.cartao.validade) : ''}</span></span>${usarSalvo ? '<span class="pl-ok">✓</span>' : ''}</button>
          <button type="button" class="pl-meio ${usarSalvo ? '' : 'sel'}" id="cfnovo"><span class="pl-ico" aria-hidden="true">＋</span><span class="grow"><b>Usar outro cartão</b></span>${usarSalvo ? '' : '<span class="pl-ok">✓</span>'}</button></div>` : ''}
        ${usarSalvo ? `<div class="field"><label>Código de segurança do ${esc(P.cartao.marca)} •••• ${esc(P.cartao.fim)}</label><div class="mpcampo" id="cfcvv"></div><span class="s">Os 3 números atrás do cartão (4 na frente, no Amex).</span></div>`
          : `<div class="field"><label>Número do cartão</label><div class="mpcampo" id="cfnum"></div></div>
          <div class="two"><div class="field"><label>Validade</label><div class="mpcampo" id="cfval"></div></div><div class="field"><label>Código de segurança</label><div class="mpcampo" id="cfcvv"></div></div></div>
          <div class="field"><label for="cfnome">Nome no cartão</label><input id="cfnome" autocomplete="cc-name" placeholder="Como está no cartão" value="${esc(r.nome || '')}"></div>
          <div class="field"><label for="cfdoc">CPF do titular do cartão</label><input id="cfdoc" inputmode="numeric" autocomplete="off" value="${esc(r.cpf ? fmtCpf(r.cpf) : '')}"></div>
          <label class="liga"><span class="grow"><b>Salvar este cartão</b><span class="s">Na próxima vez, você digita só o código de segurança.</span></span><input type="checkbox" role="switch" id="cfsalvar" checked><span class="trilho" aria-hidden="true"></span></label>
          ${P.automatico ? '<label class="liga"><span class="grow"><b>Pagar sempre com este cartão</b><span class="s">As próximas cobranças da escola são pagas sozinhas no vencimento. Você desliga quando quiser, na tela Pagar.</span></span><input type="checkbox" role="switch" id="cfauto"><span class="trilho" aria-hidden="true"></span></label>' : ''}`}
        ${P.maxParcelas > 1 ? `<div class="field"><label for="cfparc">Parcelas</label><select id="cfparc">${ops.map(p => `<option value="${p.n}">${esc(linhaParcela(p))}</option>`).join('')}</select>${bin ? '' : '<span class="s">As opções de parcelas aparecem depois do número do cartão.</span>'}</div>` : ''}
        <div class="note">🔒 Pagamento seguro pelo Mercado Pago. O número do cartão vai direto para o Mercado Pago: não passa pelo app nem fica com a escola.</div>
        <div class="err" id="cferr" role="alert"></div>
        <button class="btn" id="cfpag">Pagar ${brl(P.valor)}</button>
        ${P.cartao ? '<button type="button" class="link" id="cfesq" style="align-self:center">Esquecer o cartão salvo</button>' : ''}
      </div>`;
      const atualizarParcelas = async () => {
        if (!(P.maxParcelas > 1) || !bin || !campos) return;
        try { const l = await campos.parcelas(P.valor, bin, P.maxParcelas); if (l && l.length) { ops = l; if ($('cfparc')) $('cfparc').innerHTML = ops.map(p => `<option value="${p.n}">${esc(linhaParcela(p))}</option>`).join(''); } } catch (e) { }
      };
      const aoBin = async b => { if (b === bin) return; bin = b; try { metodo = await campos.metodo(b); } catch (e) { metodo = null; } atualizarParcelas(); };
      try { campos = await camposCartao(P.publicKey, usarSalvo ? { cvv: 'cfcvv' } : { num: 'cfnum', val: 'cfval', cvv: 'cfcvv' }, aoBin); }
      catch (e) { $('cferr').textContent = msgErro(e); $('cfpag').disabled = true; return; }
      if (usarSalvo) atualizarParcelas();
      if ($('cfdoc')) $('cfdoc').addEventListener('input', e => { e.target.value = fmtCpf(e.target.value); });
      if ($('cfsalvo')) $('cfsalvo').onclick = () => { if (!usarSalvo) { usarSalvo = true; bin = P.cartao.bin || ''; metodo = { id: P.cartao.metodo, name: P.cartao.marca }; ops = [{ n: 1, total: P.valor, parcela: P.valor }]; desenhar(); } };
      if ($('cfnovo')) $('cfnovo').onclick = () => { if (usarSalvo) { usarSalvo = false; bin = ''; metodo = null; ops = [{ n: 1, total: P.valor, parcela: P.valor }]; desenhar(); } };
      if ($('cfesq')) $('cfesq').onclick = () => duploToque($('cfesq'), async () => { try { if (MOCK) MOCK_CARTOES[S.eid] = []; else await servidor('pagar', { acao: 'esquecer', eid: S.eid, rec: P.rec }); S.cartoes = null; P.cartao = null; usarSalvo = false; aviso('Cartão esquecido'); desenhar(); } catch (e) { $('cferr').textContent = msgErro(e); } }, 'Toque de novo para esquecer');
      $('cfpag').onclick = async () => {
        const err = m => { $('cferr').textContent = m; $('cfpag').disabled = false; $('cfpag').textContent = `Pagar ${brl(P.valor)}`; };
        const parcelas = $('cfparc') ? Number($('cfparc').value) || 1 : 1;
        let corpo;
        $('cfpag').disabled = true; $('cfpag').textContent = 'Pagando…'; $('cferr').textContent = '';
        try {
          if (usarSalvo) { const t = await campos.token({ cardId: P.cartao.cardId }); corpo = { token: t.id, cardId: P.cartao.cardId, parcelas }; }
          else {
            const nome = $('cfnome').value.trim(), doc = C.soDigitos($('cfdoc').value);
            if (nome.length < 3) return err('Escreva o nome como está no cartão.');
            if (!C.cpfValido(doc)) return err('O CPF do titular não está certo.');
            if (!metodo) { try { metodo = bin ? await campos.metodo(bin) : null; } catch (e) { } }
            if (!metodo) return err('Confira o número do cartão.');
            const dados = { cardholderName: nome, identificationType: 'CPF', identificationNumber: doc };
            const t = await campos.token(dados), salvar = $('cfsalvar').checked;
            // para guardar o cartão, um segundo código (cada código vale uma vez só)
            let t2 = null; if (salvar) { try { t2 = await campos.token(dados); } catch (e) { } }
            corpo = { token: t.id, token2: t2 && t2.id, salvar, auto: !!($('cfauto') && $('cfauto').checked), metodo: metodo.id, emissor: metodo.emissor || null, doc, parcelas, fim: t.last_four_digits, bin: t.first_six_digits };
          }
        } catch (e) { return err(msgErro(e)); }
        try {
          const R = MOCK ? await mockPagar({ acao: 'cartao', itens: chaves, ...corpo, marca: metodo && metodo.name }) : await servidor('pagar', { acao: 'cartao', eid: S.eid, itens: chaves, ...corpo });
          if (R.cartao) S.cartoes = null;
          sair(); S.sel = null;
          $('cfc').innerHTML = `<div class="done"><div class="ok">✓</div><h3>Pagamento aprovado!</h3><span class="sub">${brl(R.valor || P.valor)} no cartão${R.parcelas > 1 ? ` em ${R.parcelas}x` : ''}. A baixa já foi feita. Obrigado!</span>${R.cartao ? `<span class="s">Cartão ${esc(R.cartao.marca)} •••• ${esc(R.cartao.fim)} salvo${R.cartao.auto ? ', com cobrança automática ligada' : ''}.</span>` : ''}</div>`;
        } catch (e) { err(msgErro(e)); }
      };
    };
    desenhar();
  }, sair);
}
// nome, CPF e endereço de quem paga, do cadastro do responsável (para boleto e cartão)
function respPagador() {
  const r = Object.values(S.resps || {})[0] || {};
  return { nome: r.nome || (EU && EU.nome) || '', cpf: r.cpf || '', endereco: r.endereco || '' };
}
function sheetBoletoFam(chaves) {
  const r = respPagador(), salvo = (() => { try { return JSON.parse(ls.get('escolinha.boleto') || 'null') || {}; } catch (e) { return {}; } })();
  sheet(`<h3>Pagar com boleto</h3><div id="bfc" style="display:flex;flex-direction:column;gap:12px"><div class="empty">Preparando…</div></div><button class="btn ghost" data-fechar>Fechar</button>`, async () => {
    let P;
    try { P = MOCK ? await mockPagar({ acao: 'preparar', itens: chaves, forma: 'boleto' }) : await servidor('pagar', { acao: 'preparar', eid: S.eid, itens: chaves, forma: 'boleto' }); }
    catch (e) { if (e.code !== 'reconectar') { $('bfc').innerHTML = `<div class="empty"><b>Não deu para preparar.</b><span>${esc(msgErro(e))}</span></div>`; return; } P = null; }
    const conta = v => `<div class="conta">${contaL('Cobranças', brl(v.base))}${v.valor > v.base ? contaL('Taxa de pagamento', brl(C.r2(v.valor - v.base))) : ''}${contaL('<b>Total</b>', `<b>${brl(v.valor)}</b>`, 'total')}</div>`;
    $('bfc').innerHTML = `${P ? conta(P) : ''}
      <div class="sub">O banco pede o nome, o CPF e o endereço de quem paga o boleto.</div>
      <div class="field"><label for="bfnome">Nome completo</label><input id="bfnome" autocomplete="name" value="${esc(salvo.nome || r.nome)}"></div>
      <div class="field"><label for="bfcpf">CPF</label><input id="bfcpf" inputmode="numeric" value="${esc(fmtCpf(salvo.cpf || r.cpf || ''))}"></div>
      <div class="two"><div class="field"><label for="bfcep">CEP</label><input id="bfcep" inputmode="numeric" autocomplete="postal-code" value="${esc(salvo.cep || '')}" placeholder="00000-000"></div><div class="field"><label for="bfnum">Número</label><input id="bfnum" value="${esc(salvo.numero || '')}"></div></div>
      <div class="field"><label for="bfrua">Rua</label><input id="bfrua" autocomplete="address-line1" value="${esc(salvo.rua || '')}"></div>
      <div class="field"><label for="bfbai">Bairro</label><input id="bfbai" value="${esc(salvo.bairro || '')}"></div>
      <div class="two"><div class="field"><label for="bfcid">Cidade</label><input id="bfcid" autocomplete="address-level2" value="${esc(salvo.cidade || '')}"></div><div class="field"><label for="bfuf">Estado</label><select id="bfuf"><option value="">—</option>${UFS.map(u => `<option ${salvo.uf === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
      <div class="err" id="bferr" role="alert"></div>
      <button class="btn" id="bfok">Gerar boleto</button>`;
    $('bfcpf').addEventListener('input', e => { e.target.value = fmtCpf(e.target.value); });
    $('bfcep').addEventListener('input', async e => {
      const d = C.soDigitos(e.target.value).slice(0, 8); e.target.value = d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
      if (d.length !== 8 || MOCK) return;
      try { const j = await (await fetch(`https://viacep.com.br/ws/${d}/json/`)).json(); if (j && !j.erro) { if (j.logradouro) $('bfrua').value = j.logradouro; if (j.bairro) $('bfbai').value = j.bairro; if (j.localidade) $('bfcid').value = j.localidade; if (j.uf) $('bfuf').value = j.uf; $('bfnum').focus(); } } catch (x) { }
    });
    $('bfok').onclick = async () => {
      const x = { nome: $('bfnome').value.trim(), cpf: C.soDigitos($('bfcpf').value), cep: C.soDigitos($('bfcep').value), numero: $('bfnum').value.trim(), rua: $('bfrua').value.trim(), bairro: $('bfbai').value.trim(), cidade: $('bfcid').value.trim(), uf: $('bfuf').value };
      const err = m => { $('bferr').textContent = m; $('bfok').disabled = false; };
      if (x.nome.split(/\s+/).length < 2) return err('Escreva o nome completo.');
      if (!C.cpfValido(x.cpf)) return err('O CPF não está certo.');
      if (x.cep.length !== 8 || !x.numero || !x.rua || !x.bairro || !x.cidade || !x.uf) return err('Preencha o endereço completo, com CEP.');
      $('bfok').disabled = true; $('bfok').textContent = 'Gerando…';
      try {
        const R = MOCK ? await mockPagar({ acao: 'boleto', itens: chaves, pagador: x }) : await servidor('pagar', { acao: 'boleto', eid: S.eid, itens: chaves, pagador: x });
        try { ls.set('escolinha.boleto', JSON.stringify(x)); } catch (e) { }
        const b = R.boleto;
        $('bfc').innerHTML = `${conta(b)}
          <div class="pl-boleto"><div class="lb">Linha digitável</div><div class="num" style="word-break:break-all">${esc(b.linha)}</div><div class="s">Vence em ${dataBR(new Date(b.expira - 3 * 36e5).toISOString().slice(0, 10))} · pague no app do banco ou numa lotérica</div></div>
          <div class="actions"><button class="btn ghost" id="bfcop">Copiar código</button>${b.link ? `<a class="btn" href="${esc(b.link)}" target="_blank" rel="noopener">Abrir boleto</a>` : ''}</div>
          <div class="note">Quando o banco compensar (até 3 dias úteis), a baixa aparece sozinha no app.</div>
          ${MOCK ? '<button class="btn ghost" id="bfmock">Teste: simular boleto pago</button>' : ''}`;
        $('bfcop').onclick = () => copiar(String(b.linha).replace(/\s/g, ''), 'Código do boleto copiado. Cole no app do banco.');
        if ($('bfmock')) $('bfmock').onclick = async () => { await mockAprovar(b.chave, 'boleto'); S.sel = null; $('bfc').innerHTML = '<div class="done"><div class="ok">✓</div><h3>Boleto pago!</h3><span class="sub">A baixa já foi feita. Obrigado!</span></div>'; };
      } catch (e) { $('bfok').textContent = 'Gerar boleto'; err(msgErro(e)); }
    };
  });
}
// modo de teste: o que o servidor "pagar" faria
async function mockPagar(b) {
  const lotes = await pixCriar(b.itens);
  if (lotes.length > 1) throw new Error('Essas cobranças vão para contas diferentes. No cartão ou no boleto, pague as de um recebedor por vez (ou use o Pix).');
  const l = lotes[0], forma = b.acao === 'boleto' || b.forma === 'boleto' ? 'boleto' : 'cartao', { valor } = C.valorForma(l.base, forma, S.cfg, COMISSAO, repLote(l)), f = formasCfg();
  if (b.acao === 'preparar') return { rec: l.rec, base: l.base, valor, publicKey: 'TEST-PUB', maxParcelas: f.parcelado ? Number(f.maxParcelas) || 1 : 1, cartao: (MOCK_CARTOES[S.eid] || [])[0] || null, automatico: false };
  if (b.acao === 'boleto') return { boleto: { chave: l.chave, valor, base: l.base, linha: `23793.38128 60082.677324 15000.063304 8 ${String(9500 + Math.round(valor)).padStart(10, '0')}`, link: '', expira: Date.now() + 3 * 864e5 } };
  if (b.token === 'tok_recusa' || /0000$/.test(b.fim || '')) throw new Error('O cartão foi recusado. Tente outro cartão ou o Pix.');
  await mockAprovar(l.chave, 'cartao', b.parcelas || 1);
  let cartao = null;
  if (b.salvar) { cartao = { rec: l.rec, cardId: 'card1', metodo: b.metodo, marca: b.marca || 'Visa', fim: b.fim || '4242', bin: b.bin || '423564', validade: '08/30', auto: false }; MOCK_CARTOES[S.eid] = [cartao]; }
  return { ok: true, valor, parcelas: b.parcelas || 1, cartao };
}
function sheetPix(chaves, voltar) {
  let parar = null;
  sheet(`<h3>Pagar com Pix</h3><div id="pxc" class="empty">Gerando o Pix…</div><div class="err" id="pxerr" role="alert"></div><button class="btn ghost" id="pxf">Fechar</button>`, async () => {
    $('pxf').onclick = () => { fecharSheet(); voltar && voltar(); };
    let lotes;
    try { lotes = await pixCriar(chaves); } catch (e) { $('pxc').innerHTML = `<b>Não deu para gerar o Pix.</b><span>${esc(msgErro(e))}</span>`; return; }
    const total = C.r2(lotes.reduce((s, l) => s + l.valor, 0));
    const passo = n => {
      if (!$('pxc')) return; parar && parar(); parar = null; $('pxf').hidden = false;
      const d = lotes[n], N = lotes.length, repasse = C.r2(d.valor - d.base), porAluna = {};
      (d.itens || []).forEach(i => (porAluna[i.nome || 'Aluno(a)'] = porAluna[i.nome || 'Aluno(a)'] || []).push(i));
      $('pxc').outerHTML = `<div id="pxc" style="display:flex;flex-direction:column;gap:12px">
        ${N > 1 ? `<div class="pix-topo"><div class="pix-ok-passos">${lotes.map((l, i) => `<span class="${i < n ? 'ok' : i === n ? 'prox' : ''}">${i < n ? '✓' : i + 1}</span>`).join('<i></i>')}</div><span class="sub">${N} Pix, um para cada recebedor · total ${brl(total)}</span></div>` : ''}
        <div class="headrow"><h2 class="pix-tit">${N > 1 ? `Pix ${n + 1} de ${N}` : 'Pix'} · para ${esc(nomeRec(d.rec))}</h2></div>
        <div class="tot"><span>Valor deste Pix</span><b class="num">${brl(d.valor)}</b></div>
        <div class="qrbox">${d.qr64 ? `<img src="data:image/png;base64,${d.qr64}" alt="QR Code do Pix">` : qrSVG(d.qr)}</div>
        <div class="code">${esc(d.qr)}</div>
        <button class="btn" id="pxcopy">Copiar código Pix</button>
        <div class="pix-st" id="pxst"><i></i>Aguardando o pagamento. ${n + 1 < N ? 'Quando este Pix cair, aparece o próximo.' : 'Esta tela muda sozinha quando o Pix cair.'}</div>
        <div class="note">O QR vale por 24 horas. No app do banco, escolha Pix → Pagar com QR Code ou Pix copia e cola.</div>
        <details class="pix-itens"><summary>O que está neste Pix</summary>
        ${(() => { // só o que está sendo pago, sem valor de cada coisa; a taxa vai junto do último item ("+ taxa de transação")
          const grupos = Object.entries(porAluna), ult = grupos.length - 1;
          return grupos.map(([nm, l], g) => `<div class="items"><div class="label">${esc(nm)}</div>${l.map((i, k) => `<div class="item"><span>${esc(i.desc)}${i.v < i.total ? ' <span class="sub">(parte da ' + esc(nomeRec(d.rec).split(' ')[0]) + ')</span>' : ''}${repasse > 0 && g === ult && k === l.length - 1 ? ' + taxa de transação' : ''}</span></div>`).join('')}</div>`).join(''); })()}
        </details>
        ${MOCK ? `<button class="btn ghost" id="pxmock">Teste: simular Pix pago</button>` : ''}
      </div>`;
      $('pxcopy').onclick = () => copiar(d.qr, 'Código Pix copiado. Cole no app do banco.');
      if ($('pxmock')) $('pxmock').onclick = () => mockAprovar(d.chave);
      parar = B.ouvirDoc(`escolas/${S.eid}/cobrancas/${d.chave}`, c => {
        if (!c || !$('pxst')) return;
        if (c.status === 'approved') {
          // um Pix de vários pago: mostra bem claro "1 de 3 pago ✓" antes de passar para o próximo QR Code
          if (n + 1 < N) { parar && parar(); parar = null;
            // "Pix 1 de N pago" no mesmo desenho da tela do QR Code: o ✔ no lugar do QR, o aviso no lugar do código e o botão no lugar de "Copiar"
            const shA = $('pxc').closest('.sheet'); if (shA) shA.scrollTop = 0;
            const altA = shA ? shA.offsetHeight : 0, base = $('pxc').getBoundingClientRect().top;
            const pos = sel => { const e = $('pxc').querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { t: Math.round(r.top - base), h: Math.round(r.height) }; };
            const pT = pos('.pix-topo'), pQ = pos('.qrbox'), pC = pos('.code'), pB = pos('#pxcopy'), altC = $('pxc').offsetHeight;
            const lugar = (p, extra = '') => p ? `position:absolute;left:0;right:0;top:${p.t}px;height:${p.h}px;${extra}` : '';
            $('pxc').innerHTML = `<div class="pix-ok" role="status" style="position:relative;height:${altC}px;display:block;padding:0">
              <div class="pix-topo" style="${lugar(pT)}"><div class="pix-ok-passos">${lotes.map((l, i) => `<span class="${i <= n ? 'ok' : i === n + 1 ? 'prox' : ''}">${i <= n ? '✓' : i + 1}</span>`).join('<i></i>')}</div><span class="sub">${N} Pix, um para cada recebedor · total ${brl(total)}</span></div>
              <div style="${lugar(pQ, 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px')}"><svg class="pix-ok-ic" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>
                <h3>Pix ${n + 1} de ${N} pago</h3><span class="sub">${brl(d.valor)} para ${esc(nomeRec(d.rec))}</span></div>
              <div class="pix-ok-prox" style="${lugar(pC, 'display:flex;align-items:center;justify-content:center')}"><span>Agora falta ${N - n - 1 === 1 ? 'o último Pix' : `${N - n - 1} Pix`}: <b>${brl(lotes[n + 1].valor)}</b> para ${esc(nomeRec(lotes[n + 1].rec))}</span></div>
              <button type="button" class="btn" id="pxprox" style="${lugar(pB)}">Ir para o Pix ${n + 2} de ${N}</button>
              <div class="pix-ok-barra" style="${pB ? `position:absolute;left:0;right:0;top:${pB.t + pB.h + 14}px` : ''}"><i></i></div></div>`;
            $('pxf').hidden = true; // nesta tela só o caminho para o próximo Pix
            // a janela fica da mesma altura (o Fechar sumiu: o espaço dele vai para o fim)
            if (shA) { const resto = altA - shA.offsetHeight; if (resto > 0) $('pxc').querySelector('.pix-ok').style.height = (altC + resto) + 'px'; }
            let foi = false; const ir = () => { if (foi || !$('pxprox')) return; foi = true; passo(n + 1); const sh = $('pxc') && $('pxc').closest('.sheet'); if (sh) sh.scrollTop = 0; };
            $('pxprox').onclick = ir; setTimeout(ir, 4500); return; }
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
// localização e links do evento, para mostrar às famílias e à escola
const ehUrl = v => /^(https?:\/\/|www\.)/i.test(String(v || '').trim());
const urlDe = v => { const t = String(v).trim(); return /^www\./i.test(t) ? 'https://' + t : t; };
const ehTel = v => { const d = String(v || '').replace(/\D/g, ''); return !ehUrl(v) && /^[\d\s()+.\-]+$/.test(String(v).trim()) && d.length >= 10 && d.length <= 13; };
function mapaDe(x) { const e = String(x.endereco || '').trim(); if (!e) return ''; return ehUrl(e) ? urlDe(e) : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(e); }
function localEventoHTML(x) {
  const e = String(x.endereco || '').trim(), m = mapaDe(x), links = x.links || [];
  if (!e && !links.length) return arquivosEvHTML(x);
  const item = l => { const v = String(l.v || '').trim();
    if (ehUrl(v)) return `<a class="ev-link" href="${esc(urlDe(v))}" target="_blank" rel="noopener"><span class="grow"><b>${esc(l.d)}</b><span class="s">${esc(v.replace(/^https?:\/\//, '').slice(0, 60))}</span></span><span aria-hidden="true">↗</span></a>`;
    if (ehTel(v)) { const wa = waLink(v, ''); return `<div class="ev-link"><span class="grow"><b>${esc(l.d)}</b><a class="s num" href="tel:${esc(v.replace(/[^\d+]/g, ''))}">${esc(v)}</a></span>${wa ? `<a class="wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp de ${esc(l.d)}">${ICO_WA}</a>` : ''}</div>`; }
    return `<div class="ev-link"><span class="grow"><b>${esc(l.d)}</b><span class="s">${esc(v)}</span></span></div>`; };
  return arquivosEvHTML(x) + `<div class="ev-local">${e ? `<a class="ev-link" href="${esc(m)}" target="_blank" rel="noopener"><span class="grow"><b>Como chegar</b><span class="s">${esc(ehUrl(e) ? 'Abrir no mapa' : e)}</span></span><span aria-hidden="true">📍</span></a>` : ''}${links.map(item).join('')}</div>`;
}
// arquivos do evento (PDF): a lista fica no evento (x.arquivos), cada arquivo num documento à parte (arquivosEventos)
const ARQ_EV_MAX = 3, ARQ_EV_BYTES = 700 * 1024;
const arquivosEvHTML = x => arqLista(x).length ? `<div class="ev-arqs">${arqLista(x).map(a => `<button type="button" class="arq-lnk" data-verarq="${esc(a.id)}">📄 <u>${esc(a.nome)}</u> <span class="s num">${kb(a.tam || 0)}</span></button>`).join('')}</div>` : '';
// arquivos do evento + os das taxas ligadas a ele (as famílias veem tudo na página do evento)
function arqLista(x) { const k = ehEvento(x) ? xidDe(x) : null; return [...(x.arquivos || []), ...(k ? Object.values(S.extras || {}).filter(t => t && t.tipo === 'taxa' && t.evento === k).flatMap(t => t.arquivos || []) : [])]; }
// campo "Arquivos (PDF)" dos formulários de evento e de taxa (p = prefixo dos ids)
const formArqsHTML = (p, titulo, dica) => `<div class="field"><span class="lb">${titulo}</span><span class="sub">${dica} Até ${ARQ_EV_MAX} arquivos de até ${kb(ARQ_EV_BYTES)}.</span>
      <div class="ev-links" id="${p}arqs"></div><button type="button" class="add-disc add-largo" id="${p}arqadd">+ Arquivo</button><input type="file" id="${p}arq" accept="application/pdf,.pdf" hidden><div class="err" id="${p}arqerr" role="alert"></div></div>`;
function ligarFormArqs(x, p) {
  // novos ficam na memória até salvar; os tirados são apagados ao salvar
  let arqs = ((x && x.arquivos) || []).map(a => ({ ...a })); const tirados = [];
  const ver = () => { $(p + 'arqs').innerHTML = arqs.map((a, i) => `<div class="ev-link"><span class="grow"><b>${esc(a.nome)}</b><span class="s">PDF · ${kb(a.tam || 0)}${a.dados ? ' · novo' : ''}</span></span><button type="button" class="link arq-exc" data-ax="${i}">Excluir</button></div>`).join('');
    $(p + 'arqadd').hidden = arqs.length >= ARQ_EV_MAX;
    $(p + 'arqs').querySelectorAll('[data-ax]').forEach(b => b.onclick = () => duploToque(b, () => { const [a] = arqs.splice(Number(b.dataset.ax), 1); if (!a.dados) tirados.push(a.id); ver(); }, 'Toque de novo')); };
  ver();
  $(p + 'arqadd').onclick = () => $(p + 'arq').click();
  $(p + 'arq').onchange = async () => { const f = $(p + 'arq').files[0]; $(p + 'arq').value = ''; $(p + 'arqerr').textContent = ''; if (!f) return;
    if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''))) return $(p + 'arqerr').textContent = 'Escolha um arquivo PDF.';
    if (f.size > ARQ_EV_BYTES) return $(p + 'arqerr').textContent = `Esse PDF tem ${kb(f.size)}. O limite é ${kb(ARQ_EV_BYTES)}: tente uma versão menor ou mande as páginas como foto.`;
    arqs.push({ id: novoId(), nome: (f.name || 'arquivo.pdf').slice(0, 80), tam: f.size, dados: await lerDataUrl(f) }); ver(); };
  return {
    lista: () => arqs.map(({ id, nome, tam }) => ({ id, nome, tam })),
    gravar: async xid => { for (const a of arqs.filter(a => a.dados)) await B.set(`escolas/${S.eid}/arquivosEventos/${a.id}`, { xid, nome: a.nome, tipo: 'pdf', tam: a.tam, dados: a.dados, em: Date.now() });
      if (tirados.length) await B.lote(tirados.map(aid => ({ op: 'del', p: `escolas/${S.eid}/arquivosEventos/${aid}` }))); }
  };
}
const bytesDeDataUrl = u => { const b = atob(String(u).split(',')[1] || ''), r = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) r[i] = b.charCodeAt(i); return r; };
function ligarArquivosEv(raiz) {
  raiz.querySelectorAll('[data-verarq]').forEach(b => b.onclick = async () => {
    // abre a janela já no toque (o iPhone só deixa abrir dentro do toque) e põe o PDF quando chegar
    const w = window.open('', '_blank'); b.disabled = true;
    try { const d = await B.get(`escolas/${S.eid}/arquivosEventos/${b.dataset.verarq}`); if (!d || !d.dados) throw new Error('Arquivo não encontrado.');
      const u = URL.createObjectURL(new Blob([bytesDeDataUrl(d.dados)], { type: 'application/pdf' })); if (w) w.location.href = u; else verPdf(bytesDeDataUrl(d.dados), d.nome); }
    catch (e) { if (w) w.close(); aviso(msgErro(e)); } finally { b.disabled = false; } });
}
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
  ligarArquivosEv(raiz);
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
  for (const c of categorias()) q.push(['c:' + c.id, `Categoria ${c.nome}`, ativos.filter(id => (catDe(id) || {}).id === c.id)]);
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

/* ---- Tamanho do uniforme numa taxa: a escola escolhe letras ou numeração; a família (ou a escola) escolhe o de cada aluno ---- */
const TAM_PADRAO = { letras: ['PP', 'P', 'M', 'G', 'GG'], numeros: ['2', '4', '6', '8', '10', '12', '14', '16'] };
const tamRot = (x, t) => t;
const tamEsc = (x, id) => ((((x || {}).tamEsc || {})[id]) || {}).t || '';
// bloco "Pedir tamanho do uniforme" dos formulários de taxa e de evento (p = prefixo dos ids)
const formTamHTML = (x, p, txt) => `<label class="liga"><span class="grow"><b>Pedir tamanho do uniforme</b><span class="s">${txt}</span></span><input type="checkbox" role="switch" id="${p}tam" ${x && x.tamanhos ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>
    <div id="${p}tamw" ${x && x.tamanhos ? '' : 'hidden'}><div class="field"><span class="lb">Tamanhos por</span><div class="seg"><button type="button" data-${p}tt="letras" aria-pressed="${!(x && x.tamanhos && x.tamanhos.tipo === 'numeros')}">Letras</button><button type="button" data-${p}tt="numeros" aria-pressed="${!!(x && x.tamanhos && x.tamanhos.tipo === 'numeros')}">Numeração</button></div></div>
      <div class="field"><label for="${p}tamop">Tamanhos · lista editável</label><input id="${p}tamop" maxlength="120" value="${esc(((x && x.tamanhos && x.tamanhos.opcoes) || TAM_PADRAO.letras).join(', '))}"><span class="sub">Você pode mudar esta lista: escreva os tamanhos que o fornecedor usa, separados por vírgula.</span></div></div>`;
function ligarFormTam(sh, x, p) {
  let tipo = x && x.tamanhos && x.tamanhos.tipo === 'numeros' ? 'numeros' : 'letras';
  $(p + 'tam').onchange = () => { $(p + 'tamw').hidden = !$(p + 'tam').checked; };
  sh.querySelectorAll(`[data-${p}tt]`).forEach(b => b.onclick = () => { tipo = b.getAttribute(`data-${p}tt`); sh.querySelectorAll(`[data-${p}tt]`).forEach(c => c.setAttribute('aria-pressed', String(c === b))); $(p + 'tamop').value = TAM_PADRAO[tipo].join(', '); });
  return () => { if (!$(p + 'tam').checked) return null; const op = [...new Set($(p + 'tamop').value.split(',').map(t => t.trim().toUpperCase()).filter(Boolean))].slice(0, 20); return op.length ? { tipo, opcoes: op } : null; };
}
const alvoTam = x => ehEvento(x) ? convidadosDe(x).filter(id => S.alunas[id] && ['interesse', 'inscrito'].includes(partDe(x, id))) : [...new Set([...(x.alunas || []), ...(x.convidados || [])])].filter(id => S.alunas[id]);
// a escola: resumo para o fornecedor e o tamanho de cada aluno
function sheetTamanhos(xid) {
  const x = S.extras[xid]; if (!x || !x.tamanhos) return fecharSheet();
  const ids = porNome(Object.fromEntries(alvoTam(x).map(id => [id, S.alunas[id]]))).map(([id]) => id), op = x.tamanhos.opcoes || [];
  const cont = op.map(t => [t, ids.filter(id => tamEsc(x, id) === t).length]).filter(([, n]) => n), faltam = ids.filter(id => !tamEsc(x, id));
  sheet(`<h3>Tamanhos · ${esc(x.nome)}</h3>
    <div class="faixa-card" style="background:var(--bg)"><b class="num">${cont.length ? esc(cont.map(([t, n]) => `${n} ${t}`).join(' · ')) : 'Ninguém escolheu ainda'}</b>
      <span class="s">${faltam.length ? `Faltam ${faltam.length} escolher${faltam.length <= 5 ? ': ' + esc(faltam.map(id => primeiro(S.alunas[id].nome)).join(', ')) : ''}.` : 'Todos já escolheram.'} A família escolhe no app. A escola também pode escolher aqui.</span></div>
    <ul class="list">${ids.map(id => `<li><div class="grow"><div class="t">${esc(S.alunas[id].nome)}</div>${linhas(esc(idade(S.alunas[id].nascimento) || ''))}</div>
      <select data-tm="${esc(id)}" aria-label="Tamanho de ${esc(S.alunas[id].nome)}" style="width:auto;min-width:92px"><option value="">—</option>${op.map(t => `<option ${tamEsc(x, id) === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></li>`).join('')}</ul>
    <div class="err" id="tmerr" role="alert"></div><button type="button" class="btn ghost" data-fechar>Fechar</button>`, sh => {
    sh.querySelectorAll('[data-tm]').forEach(sl => sl.onchange = async () => { try { await B.set(`escolas/${S.eid}/extras/${xid}`, { tamEsc: { [sl.dataset.tm]: sl.value ? { t: sl.value, em: Date.now(), quem: 'escola' } : null } }, { merge: true }); setTimeout(() => sheetTamanhos(xid), 60); } catch (e) { $('tmerr').textContent = msgErro(e); } });
  });
}
// a família: escolher o tamanho de cada filho (na tela Pagar)
function avisoTamanhoFam() {
  const travadas = Object.entries(S.extras || {}).filter(([, x]) => x && x.tipo === 'taxa' && !x.tamanhos && x.evento && (S.extras[x.evento] || {}).tamanhos).map(([xid, x]) => {
    const ev = S.extras[x.evento], meus = alvoTam(x).filter(id => !x.rateio || x.rateio.fechadoEm ? (x.alunas || []).includes(id) : rtSt(x, id) !== 'nao'); if (!meus.length) return '';
    return `<div class="rt-card tam-card"><b class="rt-tit">${esc(x.nome)}: tamanho do uniforme</b>
      ${meus.map(id => `<div class="tam-lin"><span class="chip">${esc(primeiro(S.alunas[id].nome))}</span><span class="grow s">Escolhido no evento ${esc(ev.nome)}</span><button type="button" class="tam-trava" data-tamtrava="1" aria-label="Tamanho já escolhido no evento">${esc(tamEsc(ev, id) || '—')} 🔒</button></div>`).join('')}</div>`; }).join('');
  return travadas + Object.entries(S.extras || {}).filter(([, x]) => x && x.tipo === 'taxa' && x.tamanhos && !(x.rateio && !x.rateio.fechadoEm && C.rateioFechado(x))).map(([xid, x]) => {
    const meus = alvoTam(x).filter(id => !x.rateio || x.rateio.fechadoEm ? (x.alunas || []).includes(id) : rtSt(x, id) !== 'nao'); if (!meus.length) return '';
    return `<div class="rt-card tam-card"><b class="rt-tit">${esc(x.nome)}: tamanho do uniforme</b>
      ${meus.map(id => { const t = tamEsc(x, id);
        return `<label class="tam-lin"><span class="chip">${esc(primeiro(S.alunas[id].nome))}</span><span class="grow">${t ? '' : '<span class="ev-pend">Falta escolher</span>'}</span>
          <select data-tmx="${esc(xid)}" data-tmi="${esc(id)}" aria-label="Tamanho de ${esc(primeiro(S.alunas[id].nome))}"><option value="">Tamanho</option>${x.tamanhos.opcoes.map(o => `<option ${t === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`; }).join('')}</div>`; }).join('');
}
function ligarTamanhoFam(v, depois) {
  v.querySelectorAll('[data-tamtrava]').forEach(b => b.onclick = () => aviso('Tamanho já escolhido no evento. Não pode ser editado.'));
  v.querySelectorAll('[data-tmx]').forEach(b => b.onchange = async () => { if (!b.value) return; b.disabled = true;
    try { if (!MOCK && S.papel === 'f') await servidor('eventoResposta', { eid: S.eid, xid: b.dataset.tmx, alid: b.dataset.tmi, tam: b.value });
      else await B.set(`escolas/${S.eid}/extras/${b.dataset.tmx}`, { tamEsc: { [b.dataset.tmi]: { t: b.value, em: Date.now(), quem: 'familia' } } }, { merge: true });
      aviso('✓ Tamanho escolhido'); setTimeout(depois || render, 60); } catch (e) { aviso(msgErro(e)); b.disabled = false; } });
}
// ---- Taxas (e cobranças antigas de eventos) ----
function sheetExtra(xid, op = {}) {
  const x = xid ? S.extras[xid] : null, ed = !!x;
  if (x && eventoNovo(x)) return sheetVerEvento(xid);
  if (!ed && op.tipo === 'evento') return sheetEvento(null);
  if (x && x.rateio) return sheetRateio(xid);
  let dividir = false, todos = true;
  const convite = () => !todos; // desligado: os marcados recebem um convite e só paga quem aceitar
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
    ${!legado && evsTaxa.length ? `<div class="field"><label for="xev">É de algum evento?</label><select id="xev"><option value="">Não, é uma taxa avulsa</option>${evsTaxa.map(([id, e]) => `<option value="${esc(id)}" ${id === evento ? 'selected' : ''}>${esc(e.nome)} · ${esc(periodoTxt(e))}</option>`).join('')}</select>
      <span class="sub" id="xevnota"></span></div>` : ''}
    ${legado ? `<div class="note">Evento ${esc(periodoTxt(x))}${x.local ? ' · ' + esc(x.local) : ''}. Esta é uma cobrança antiga, feita pelo app.</div>` : ''}
    ${ed || evento ? '' : `<div class="field"><span class="lb">Como cobrar</span><div class="insc-ops" id="xmodo">
      <button type="button" class="insc-op" data-xm="aluno" aria-pressed="true"><span class="insc-bola" aria-hidden="true"></span><span class="grow"><b>Valor por aluno</b><span class="s">Cada aluno paga o mesmo valor.</span></span></button>
      <button type="button" class="insc-op" data-xm="dividir" aria-pressed="false"><span class="insc-bola" aria-hidden="true"></span><span class="grow"><b>Dividir um valor total</b><span class="s">O valor total é dividido entre os alunos.</span></span></button></div></div>
    <label class="liga"><span class="grow"><b>Todos pagam?</b><span class="s" id="xtodoss"></span></span><input type="checkbox" role="switch" id="xtodos" checked><span class="trilho" aria-hidden="true"></span></label>
    <div id="xdivw" hidden><div class="field"><label for="xtot">Valor total (R$)</label><input id="xtot" inputmode="decimal" placeholder="0,00"></div></div>
    <div id="xprazow" hidden><div class="field"><span class="lb">Responder até</span><div class="two"><input id="xpdia" type="date" aria-label="Dia" value="${esc(somaDias(hoje(), 7))}"><input id="xphora" type="time" aria-label="Horário" value="18:00"></div>
      <span class="s">Depois desse dia e horário, ninguém mais entra e a cobrança chega para quem aceitou. A escola também pode fechar antes.</span></div></div>`}
    <div class="two"><div class="field" id="xvalw"><label for="xval">Valor padrão (R$)</label><input id="xval" inputmode="decimal" value="${esc(fmtValor(x && x.v))}" placeholder="0,00" ${temPag ? 'disabled' : ''}></div>
    <div class="field"><label for="xven">Vencimento</label><input id="xven" type="date" value="${esc(x ? x.venc : hoje())}" ${temPag ? 'disabled' : ''}></div></div>
    ${temPag ? '<div class="note">Já há pagamentos desta cobrança: o valor padrão e o vencimento não mudam mais. Quem já pagou fica como está; dá para incluir alunos e mudar o valor de quem ainda não pagou.</div>' : ''}
    ${S.admin ? `<div class="field"><label for="xrec">O pagamento vai para</label><select id="xrec" ${temPag ? 'disabled' : ''}>${opcoesRec(x ? x.recebedor : 'escola')}</select></div>` : `<div class="note">A escola escolhe para quem vai o pagamento desta cobrança.</div>`}
    <div id="xtamblk">${formTamHTML(x, 'x', 'A família escolhe o tamanho no app, e você vê o resumo para o fornecedor.')}
    ${x && x.tamanhos ? `<button type="button" class="btn ghost" id="xtamver">Ver os tamanhos escolhidos</button>` : ''}</div>
    <div id="xtamev" hidden><label class="liga trava" id="xtamtrava"><span class="grow"><b>Pedir tamanho do uniforme</b><span class="s">Evento com tamanho do uniforme já escolhido. Os tamanhos vêm do evento e não mudam aqui.</span></span><input type="checkbox" role="switch" checked disabled><span class="trilho" aria-hidden="true"></span></label>
      <button type="button" class="btn ghost" id="xtamevver">Ver os tamanhos do evento</button></div>
    ${formArqsHTML('x', 'Arquivos da taxa (PDF)', 'Orçamento, regulamento, autorização. As famílias abrem junto com a taxa.')}
    ${blocoNota('xnota', !!(x && x.nota === true), 'Ligue se esta cobrança leva nota. Uniforme e taxa repassada à federação, deixe desligado.', x && x.recebedor)}
    <div class="field"><span class="lb" id="xparalb">Para quem? Toque num quadro para escolher os atletas</span><div id="xquadros"></div></div>
    <div class="xresumo" id="xcont"></div>
    <div class="err" id="xerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="xok">Salvar</button></div>
    ${ed ? `<button class="btn ghost" id="xdel" style="color:var(--out)">Excluir cobrança</button>` : ''}`, s => {
    const resumo = () => {
      if (dividir && todos) { const n = [...selA].filter(id => S.alunas[id]).length, tot = parseValor(($('xtot') || {}).value || ''); $('xcont').innerHTML = n ? `<div class="note">${n} aluno${n === 1 ? '' : 's'}${tot > 0 ? `: ${brl(C.rateioCada(tot, n))} para cada um` : ''}. A cobrança chega na hora.</div>` : '<div class="note">Nenhum aluno marcado ainda.</div>'; return; }
      if (convite()) { const n = [...selA].filter(id => S.alunas[id]).length; $('xcont').innerHTML = n ? `<div class="note">${n} aluno${n === 1 ? '' : 's'} convidado${n === 1 ? '' : 's'}. Ninguém é cobrado agora: a cobrança chega só para quem aceitar, quando as respostas fecharem.</div>` : '<div class="note">Nenhum aluno convidado ainda.</div>'; return; }
      const ids = [...selA].filter(id => S.alunas[id]), tot = C.r2(ids.reduce((t, id) => t + sel.valDe(id), 0)), dif = ids.filter(id => vals[id] != null && vals[id] !== padrao());
      $('xcont').innerHTML = ids.length ? `<details class="historico"><summary><span class="grow"><b>${ids.length} aluno${ids.length === 1 ? '' : 's'} · total ${brl(tot)}</b><span class="s">${dif.length ? `${dif.length} com valor diferente do padrão` : padrao() ? `${brl(padrao())} cada` : 'Informe o valor padrão'} · toque para ver a lista</span></span><span class="seta" aria-hidden="true">▾</span></summary>
        <div class="conta" style="padding:0 14px 14px">${porNome(Object.fromEntries(ids.map(id => [id, S.alunas[id]]))).map(([id, a]) => contaL(esc(a.nome), brl(sel.valDe(id)), vals[id] != null && vals[id] !== padrao() ? 'dif' : '')).join('')}${contaL('<b>Total</b>', `<b>${brl(tot)}</b>`, 'total')}</div></details>`
        : '<div class="note">Nenhum aluno marcado ainda.</div>';
    };
    const opSel = () => ({ quadros, selA, usados, vals, comValor: !dividir && todos, padrao, travado: pagou, subDe: id => { if (pagou(id)) return 'Já pagou'; const e = evento && S.extras[evento], st = e && partDe(e, id); return st === 'inscrito' ? 'Inscrição confirmada' : st === 'interesse' ? 'Disse que vai' : turmasTxt(S.alunas[id]) || 'Sem turma'; }, aoMudar: () => resumo() });
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
    ligarBlocoNota('xnota', 'xrec');
    const tamSalvar0 = ligarFormTam(s, x, 'x'), arqsX = ligarFormArqs(x, 'x');
    // taxa ligada a um evento que já pede o tamanho: vale o do evento, e aqui fica fechado
    const tamDoEvento = () => { const e = evento && S.extras[evento]; return !!(e && e.tamanhos); };
    const tamSalvar = () => tamDoEvento() ? null : tamSalvar0();
    function verTamEv() { if (!$('xtamev')) return; const t = tamDoEvento(); $('xtamblk').hidden = t; $('xtamev').hidden = !t; }
    $('xtamevver').onclick = () => abrirDe(() => sheetExtra(xid, op), () => sheetTamanhos(evento));
    $('xtamtrava').onclick = e => { e.preventDefault(); aviso('Tamanho já escolhido no evento. Não pode ser editado.'); };
    verTamEv();
    if ($('xtamver')) $('xtamver').onclick = () => abrirDe(() => sheetExtra(xid), () => sheetTamanhos(xid));
    s.querySelectorAll('[data-xm]').forEach(b => b.onclick = () => { dividir = b.dataset.xm === 'dividir';
      s.querySelectorAll('[data-xm]').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
      $('xdivw').hidden = !dividir; $('xvalw').hidden = dividir; verTodos();
      $('xok').textContent = convite() ? 'Convidar' : 'Salvar'; sel = seletorAtletas($('xquadros'), opSel()); sel.desenhar(); resumo(); });
    // "Todos pagam?": ligado, todos os marcados pagam; desligado, recebem um convite e só paga quem aceitar até o prazo
    function verTodos() { if (!$('xtodos')) return;
      $('xtodoss').textContent = todos ? 'Todos os marcados pagam. A cobrança chega na hora.' : 'Só paga quem aceitar o convite, até o prazo.';
      $('xprazow').hidden = todos;
      $('xparalb').textContent = convite() ? 'Quem pode participar? Toque num quadro para escolher os atletas' : 'Para quem? Toque num quadro para escolher os atletas';
      $('xok').textContent = convite() ? 'Convidar' : 'Salvar';
      if (convite() && $('xven').value < $('xpdia').value) $('xven').value = somaDias($('xpdia').value, 5); }
    if ($('xtodos')) { $('xtodos').onchange = () => { todos = $('xtodos').checked; verTodos(); sel = seletorAtletas($('xquadros'), opSel()); sel.desenhar(); resumo(); }; verTodos(); }
    if ($('xtot')) $('xtot').oninput = () => resumo();
    if ($('xev')) $('xev').onchange = () => { evento = $('xev').value || null; escolherEvento(true); verTamEv(); };
    if (evento) setTimeout(() => escolherEvento(false), 0);
    s.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { if (b.dataset.t === 'evento') sheetEvento(null); });
    $('xval').oninput = () => { s.querySelectorAll('[data-xv]').forEach(i => { if (vals[i.dataset.xv] == null && !i.classList.contains('pend')) i.value = fmtValor(padrao()); }); resumo(); };
    sel.desenhar();
    $('xok').onclick = async () => {
      const nome = $('xnome').value.trim(), v = padrao(), venc = $('xven').value, err = m => $('xerr').textContent = m;
      if (dividir && todos) { // dividido entre todos os marcados, cobrado na hora (fica registrado como uma divisão já fechada)
        const total = parseValor($('xtot').value);
        if (!nome) { $('xnome').focus(); return err('Preencha a descrição, como "Ônibus para a Copa".'); }
        if (!(total > 0)) return err('Informe o valor total a dividir, como 1.000,00.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(venc)) return err('Escolha a data de vencimento.');
        const ids = [...selA].filter(id => S.alunas[id]); if (!ids.length) return err('Toque num quadro e marque quem paga.');
        $('xok').disabled = true; const agora = Date.now();
        const idT = novoId();
        try { await B.set(`escolas/${S.eid}/extras/${idT}`, { tipo: 'taxa', arquivos: arqsX.lista(), nome, v: C.rateioCada(total, ids.length), venc, nota: notaSalvar('xnota', 'xrec', false), convidados: ids, alunas: ids, valores: {}, grupos: [], turmas: [], part: Object.fromEntries(ids.map(id => [id, { st: 'interesse', quem: 'escola' }])), rateio: { total: C.r2(total), prazoEm: agora, fechadoEm: agora, todos: true }, tamanhos: tamSalvar(), origem: sel.origem(), evento: evento || null, recebedor: S.admin && $('xrec') ? $('xrec').value : 'escola', lancadoPor: S.prof || 'admin', criadoEm: agora }); await arqsX.gravar(idT).catch(() => aviso('A taxa foi salva, mas algum arquivo não. Tente de novo.'));
          fecharSheet(); aviso(`✓ Taxa salva. ${brl(C.rateioCada(total, ids.length))} para cada um dos ${ids.length}.`); } catch (e) { err(msgErro(e)); $('xok').disabled = false; }
        return;
      }
      if (convite()) { // convite: só paga quem aceitar até o prazo (dividido entre eles, ou o valor por aluno)
        const total = dividir ? parseValor($('xtot').value) : 0, dia = $('xpdia').value, hora = $('xphora').value || '18:00';
        if (!nome) { $('xnome').focus(); return err('Preencha a descrição, como "Ônibus para a Copa".'); }
        if (dividir && !(total > 0)) return err('Informe o valor total a dividir, como 1.000,00.');
        if (!dividir && !(v > 0)) return err('Informe o valor por aluno(a), como 85,00.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return err('Escolha até que dia as famílias podem responder.');
        const prazoEm = new Date(`${dia}T${hora}:00-03:00`).getTime();
        if (!(prazoEm > Date.now())) return err('O prazo para responder precisa ser depois de agora.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(venc)) return err('Escolha a data de vencimento.');
        if (venc < dia) return err('O vencimento precisa ser no dia em que as respostas fecham ou depois.');
        const ids = [...selA].filter(id => S.alunas[id]); if (!ids.length) return err('Toque num quadro e marque quem pode participar.');
        $('xok').disabled = true;
        const idT = novoId();
        try { await B.set(`escolas/${S.eid}/extras/${idT}`, { tipo: 'taxa', arquivos: arqsX.lista(), nome, v: 0, venc, nota: notaSalvar('xnota', 'xrec', false), convidados: ids, alunas: [], valores: {}, grupos: [], turmas: [], part: {}, rateio: { ...(dividir ? { total: C.r2(total) } : { porAluno: C.r2(v), total: null }), prazoEm, fechadoEm: null }, tamanhos: tamSalvar(), origem: sel.origem(), evento: evento || null, recebedor: S.admin && $('xrec') ? $('xrec').value : 'escola', lancadoPor: S.prof || 'admin', criadoEm: Date.now() }); await arqsX.gravar(idT).catch(() => aviso('A taxa foi salva, mas algum arquivo não. Tente de novo.'));
          fecharSheet(); aviso('✓ Taxa salva. O convite foi enviado às famílias.'); } catch (e) { err(msgErro(e)); $('xok').disabled = false; }
        return;
      }
      if (!nome) { $('xnome').focus(); $('xnome').scrollIntoView({ block: 'center', behavior: 'smooth' }); return err('Preencha a descrição da taxa, como "Ajuda de custo · Copa" ou "Taxa da federação".'); }
      if (!(v > 0)) return err('Informe o valor padrão por aluno(a), como 85,00.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(venc)) return err('Escolha a data de vencimento.');
      const p = sel.pendente(); if (p) return err(`Toque em OK para confirmar o valor de ${p.nome}, ou volte ao valor anterior.`);
      const ids = [...selA].filter(id => S.alunas[id]); if (!ids.length) return err('Toque num quadro e marque os atletas desta cobrança.');
      const valores = {}; for (const id of ids) if (vals[id] != null && C.r2(vals[id]) !== C.r2(v)) { if (!(vals[id] > 0)) return err(`Confira o valor de ${S.alunas[id].nome}.`); valores[id] = C.r2(vals[id]); }
      $('xok').disabled = true;
      const base = legado ? { tipo: x.tipo, data: x.data || null, dataFim: x.dataFim || null, local: x.local || null } : { tipo: 'taxa' };
      const idT = xid || novoId();
      try { await B.set(`escolas/${S.eid}/extras/${idT}`, { ...base, arquivos: arqsX.lista(), nome, v, venc, tamanhos: tamSalvar(), nota: notaSalvar('xnota', 'xrec', x && x.nota === true), alunas: ids, valores, grupos: [], turmas: [], origem: sel.origem(), evento: evento || null, recebedor: S.admin && $('xrec') ? $('xrec').value : (x ? x.recebedor || 'escola' : 'escola'), lancadoPor: x ? x.lancadoPor || null : (S.prof || 'admin'), criadoEm: x ? x.criadoEm || Date.now() : Date.now() }); await arqsX.gravar(idT).catch(() => aviso('A taxa foi salva, mas algum arquivo não. Tente de novo.')); fecharSheet(); aviso(ed ? 'Cobrança atualizada' : 'Taxa lançada'); }
      catch (e) { err(msgErro(e)); $('xok').disabled = false; }
    };
    if ($('xdel')) $('xdel').onclick = () => temPag ? ($('xerr').textContent = 'Esta cobrança já tem pagamentos e não pode ser excluída. Desmarque os alunos que não vão participar.') : confirmar('Excluir cobrança?', `"${esc(x.nome)}" sai da lista de todos os alunos.`, 'Excluir', () => B.del(`escolas/${S.eid}/extras/${xid}`));
  });
}

// ---- Eventos: calendário e inscrições (a inscrição é paga ao organizador, fora do app) ----
// "10/11 às 18h" (eventos antigos, sem horário: só o dia)
const prazoTxt = x => x && x.prazo ? (x.prazoHora ? quandoRT(C.prazoEmMs(x)) : dataBR(x.prazo)) : '';
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
    <div class="two"><div class="field"><label for="elocal">Local</label><input id="elocal" maxlength="60" value="${esc((x && x.local) || '')}" placeholder="Ex.: Ginásio do Sesc"></div>
    <div class="field"><label for="eorg">Quem organiza</label><input id="eorg" maxlength="60" value="${esc((x && x.organizador) || '')}" placeholder="Ex.: Clube Náutico"></div></div>
    <div class="field"><label for="eend">Localização</label><input id="eend" maxlength="300" value="${esc((x && x.endereco) || '')}" placeholder="Endereço ou link do Google Maps">
      <span class="sub">As famílias tocam em "Como chegar" e o mapa abre no celular.</span></div>
    <div class="field"><span class="lb">Links e contatos</span><span class="sub">Regulamento, site da inscrição, telefone de quem organiza… Cada um com uma descrição curta.</span>
      <div class="ev-links" id="elinks"></div><button type="button" class="add-disc add-largo" id="elinkadd">+ Link ou contato</button></div>
    <div class="field"><span class="lb">Onde a família paga?</span><div class="insc-ops" id="ecob">${MODOS_INSC.map(([k, n]) => `<button type="button" class="insc-op" data-cob="${k}" aria-pressed="${cob === k}" ${temPagEv && k !== 'app' ? 'disabled' : ''}><span class="insc-bola" aria-hidden="true"></span><span class="grow"><b>${n}</b><span class="s">${k === 'app' ? 'A família paga por Pix no app. Pagou, a baixa é automática.' : 'A família paga direto com quem organiza. Depois confirma no app.'}</span></span></button>`).join('')}</div>
      ${temPagEv ? '<div class="note">Já há inscrições pagas pelo app, então o valor e a forma de pagar não mudam mais.</div>' : ''}</div>
    <div class="field"><span class="lb">Responder até</span><div class="two"><input id="eprazo" type="date" aria-label="Dia" value="${esc((x && x.prazo) || '')}"><input id="ephora" type="time" aria-label="Horário" value="${esc((x && x.prazoHora) || '18:00')}"></div>
      <span class="s">Depois desse dia e horário, as famílias não respondem mais. Deixe o dia em branco para não ter prazo.</span></div>
    <div class="field so-app"><span class="lb">Vencimento</span><div class="two"><input id="even" type="date" aria-label="Dia do vencimento" value="${esc((x && x.venc) || '')}" ${temPagEv ? 'disabled' : ''}><input id="evhora" type="time" aria-label="Horário limite" value="${esc((x && x.vencHora) || '18:00')}" ${temPagEv ? 'disabled' : ''}></div>
      <span class="s">Dia e horário limite para pagar.</span></div>
    <div class="grade2">
      <div class="field"><label for="einsc">Valor (R$)</label><input id="einsc" inputmode="decimal" value="${esc(x && (x.cobranca === 'app' ? x.v : x.valorInscricao) ? fmtValor(x.cobranca === 'app' ? x.v : x.valorInscricao) : '')}" placeholder="0,00" ${temPagEv ? 'disabled' : ''}></div>
      ${S.admin ? `<div class="field so-app"><label for="erec">Recebe</label><select id="erec" ${temPagEv ? 'disabled' : ''}>${opcoesRec(x ? x.recebedor : 'escola')}</select></div>` : ''}
    </div>
    <div id="eappw">
    <label class="check"><input type="checkbox" id="erep" ${x && x.pixRepassa === true ? 'checked' : ''}> <span class="grow">Quem paga cobre a taxa do Pix (${TAXA_TRANSACAO()}%)<span class="s" style="display:block;color:var(--muted);font-size:.82rem">Vale para a inscrição e para as taxas deste evento.</span></span></label>
    ${simTaxaHTML('esim', 0, true)}
    ${blocoNota('enota', !!(x && x.nota === true), 'Vale para a inscrição paga pelo app. Se for só repasse ao organizador, deixe desligado.', x && x.recebedor)}</div>
    ${formTamHTML(x, 'e', 'O evento dá camisa ou uniforme? Quem vai escolhe o tamanho no app.')}
    <div class="field"><span class="lb">Fotos do evento</span><span class="sub">Cartaz, regulamento, horários. Os responsáveis veem junto com o evento. Até ${FOTOS_EV_MAX} fotos.</span>
      <div class="ev-fotos" id="efotos"></div><input type="file" id="efoto" accept="image/*" hidden><div class="err" id="eferr" role="alert"></div></div>
    ${formArqsHTML('e', 'Arquivos do evento (PDF)', 'Regulamento, programação, ficha de inscrição. Os responsáveis abrem junto com o evento.')}
    <div class="field"><span class="lb">Quem pode ir? Os responsáveis recebem o convite no app</span><div id="equadros"></div></div>
    <div class="err" id="eerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="eok">Salvar</button></div>
    ${ed ? `<button class="btn ghost" id="edel" style="color:var(--out)">Excluir evento</button>` : ''}`, s => {
    const sel = seletorAtletas($('equadros'), { quadros, selA, usados, subDe: id => ST_PART[partDe(x, id)] || turmasTxt(S.alunas[id]) || 'Sem turma' });
    sel.desenhar();
    s.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { if (b.dataset.t === 'taxa') sheetExtra(null, { tipo: 'taxa' }); });
    const tamSalvarE = ligarFormTam(s, x, 'e');
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
    const arqsE = ligarFormArqs(x, 'e');
    // links e contatos: descrição curta + link, telefone ou outra informação
    let links = ((x && x.links) || []).map(l => ({ ...l }));
    const verLinks = () => { $('elinks').innerHTML = links.map((l, i) => `<div class="ev-link-ed"><input data-ld="${i}" maxlength="40" value="${esc(l.d || '')}" placeholder="Descrição" aria-label="Descrição curta (ex.: Regulamento)"><input data-lv="${i}" maxlength="300" value="${esc(l.v || '')}" placeholder="Link ou telefone" aria-label="Link, telefone ou informação"><button type="button" class="ev-foto-x" data-lx="${i}" aria-label="Tirar">×</button></div>`).join('');
      $('elinks').querySelectorAll('[data-ld]').forEach(e => e.oninput = () => { links[Number(e.dataset.ld)].d = e.value; });
      $('elinks').querySelectorAll('[data-lv]').forEach(e => e.oninput = () => { links[Number(e.dataset.lv)].v = e.value; });
      $('elinks').querySelectorAll('[data-lx]').forEach(b => b.onclick = () => { links.splice(Number(b.dataset.lx), 1); verLinks(); });
      $('elinkadd').hidden = links.length >= 8; };
    verLinks();
    $('elinkadd').onclick = () => { links.push({ d: '', v: '' }); verLinks(); const ult = $('elinks').querySelector(`[data-ld="${links.length - 1}"]`); if (ult) ult.focus(); };
    $('efoto').onchange = async () => { const f = $('efoto').files[0]; $('efoto').value = ''; $('eferr').textContent = ''; if (!f) return;
      try { fotos.push({ src: await fotoReduzida(f), em: Date.now() }); fotosMudou = true; verFotos(); } catch (e) { $('eferr').textContent = msgErro(e); } };
    // quanto a família paga e a escola recebe pela inscrição, conforme a caixa da taxa (só quando a inscrição é paga pelo app)
    ligarBlocoNota('enota', 'erec');
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
      const pz = $('eprazo').value ? { prazo: $('eprazo').value, prazoHora: $('ephora').value || '18:00' } : null;
      if (pz && (!x || x.prazo !== pz.prazo || (x.prazoHora || '') !== pz.prazoHora) && C.prazoPassou(pz)) return err('O prazo para responder precisa ser depois de agora.');
      $('eok').disabled = true;
      const part = { ...((x && x.part) || {}) }; sai.forEach(id => delete part[id]);
      const app = cob === 'app', cobrados = app ? ids.filter(id => ['interesse', 'inscrito'].includes((part[id] || {}).st) || (x && pagouEvento(x, id))) : [];
      const linksOk = links.map(l => ({ d: String(l.d || '').trim(), v: String(l.v || '').trim() })).filter(l => l.d || l.v);
      if (linksOk.some(l => !l.v)) { $('eok').disabled = false; return err('Falta o link, telefone ou informação de um dos itens em "Links e contatos".'); }
      if (linksOk.some(l => !l.d)) { $('eok').disabled = false; return err('Dê uma descrição curta para cada item em "Links e contatos".'); }
      const id = xid || novoId();
      try { await B.set(`escolas/${S.eid}/extras/${id}`, { tipo: 'evento', arquivos: arqsE.lista(), nota: S.admin ? notaSalvar('enota', 'erec', x && x.nota === true) : !!(x && x.nota === true), fotos: fotos.length, endereco: $('eend').value.trim() || null, links: linksOk, cobranca: app ? 'app' : 'familia', semCobranca: !app, pixRepassa: $('erep').checked, nome, data, dataFim: dataFim !== data ? dataFim : null, local: $('elocal').value.trim() || null, organizador: $('eorg').value.trim() || null,
          valorInscricao: !app && insc > 0 ? C.r2(insc) : null, tamanhos: tamSalvarE(), prazo: $('eprazo').value || null, prazoHora: $('eprazo').value ? ($('ephora').value || '18:00') : null, convidados: ids, origem: sel.origem(), part,
          v: app ? C.r2(insc) : 0, venc: app ? venc : null, vencHora: app ? ($('evhora').value || '18:00') : null, recebedor: app ? (S.admin && $('erec') ? $('erec').value : (x && x.recebedor) || 'escola') : null, valores: {}, alunas: cobrados, grupos: [], turmas: [], lancadoPor: x ? x.lancadoPor || null : (S.prof || 'admin'), criadoEm: x ? x.criadoEm || Date.now() : Date.now() });
        if (fotosMudou && (fotos.length || (x && x.fotos))) { // sem foto nenhuma, antes e agora: nada a guardar
          try { await B.set(`escolas/${S.eid}/midiaEventos/${id}`, { fotos }); delete MIDIA_EV[id]; }
          catch (e) { fecharSheet(); aviso('O evento foi salvo, mas as fotos não. Tente adicionar as fotos de novo daqui a pouco.'); return; }
        }
        try { await arqsE.gravar(id); } catch (e) { fecharSheet(); aviso('O evento foi salvo, mas algum arquivo não. Tente adicionar o arquivo de novo daqui a pouco.'); return; }
        fecharSheet(); aviso(ed ? '✓ Evento salvo' : '✓ Evento salvo. Os responsáveis já podem responder.'); }
      catch (e) { err(msgErro(e)); $('eok').disabled = false; }
    };
    if ($('edel')) $('edel').onclick = () => temPagEv ? ($('eerr').textContent = 'Este evento já tem inscrições pagas pelo app e não pode ser excluído.') : confirmar('Excluir evento?', `"${esc(x.nome)}" sai do calendário, com as respostas e inscrições.`, 'Excluir', () => B.del(`escolas/${S.eid}/extras/${xid}`));
  });
}
// pedir resposta pelo WhatsApp
function waEvento(xid, id) {
  const x = S.extras[xid], r = respDe(id), a = S.alunas[id] || {};
  const txt = `Olá, ${primeiro(r.nome) || 'tudo bem'}! Aqui é da ${S.escola.nome || 'escola'}. Vamos participar de ${x.nome} (${periodoTxt(x)}${x.local ? ', ' + x.local : ''}). ${primeiro(a.nome)} vai?${x.prazo ? ` Responda até ${prazoTxt(x)}.` : ''}\n\nÉ só responder pelo app, em Meus filhos: ${LINK_APP}`;
  return waLink(r.telefone, txt);
}
/* ---- Taxa dividida (rateio): convite, respostas até dia e horário, fechar e cobrar ---- */
const quandoRT = ms => { const d = new Date(Number(ms) - 3 * 36e5), hh = d.toISOString().slice(11, 16); return `${dataBR(d.toISOString().slice(0, 10))} às ${hh.endsWith(':00') ? String(Number(hh.slice(0, 2))) + 'h' : hh.replace(':', 'h')}`; };
const rtConv = x => (x.convidados || []).filter(id => S.alunas[id]);
const rtSt = (x, id) => (((x.part || {})[id]) || {}).st || null;
function rateioLinha(x) {
  const n = C.rateioParticipantes(x).length;
  if (x.rateio.fechadoEm) return `Dividido: ${brl(x.v)} para cada um de ${(x.alunas || []).length}`;
  if (C.rateioFechado(x)) return `Respostas fechadas · ${n ? `${brl(C.rateioValor(x, n))} para cada um de ${n}` : 'ninguém aderiu'}`;
  return `${x.rateio.porAluno ? `${brl(x.rateio.porAluno)} por aluno` : `${brl(x.rateio.total)} divididos`} · ${n} de ${rtConv(x).length} vão participar · respostas até ${quandoRT(x.rateio.prazoEm)}`;
}
function waRateio(xid, id) {
  const x = S.extras[xid], r = respDe(id), a = S.alunas[id] || {}, n = C.rateioParticipantes(x).length;
  const txt = `Olá, ${primeiro(r.nome) || 'tudo bem'}! Aqui é da ${S.escola.nome || 'escola'}. ${x.rateio.porAluno ? `"${x.nome}" custa ${brl(x.rateio.porAluno)} por aluno.` : `Vamos dividir ${brl(x.rateio.total)} de "${x.nome}" entre os alunos que participarem${n ? ` (até agora, ${n} vão: cerca de ${brl(C.rateioCada(x.rateio.total, n))} para cada um)` : ''}.`} ${primeiro(a.nome)} vai participar? Responda até ${quandoRT(x.rateio.prazoEm)}.\n\nÉ só responder pelo app, na tela Pagar: ${LINK_APP}`;
  return waLink(r.telefone, txt);
}
// a escola abre uma taxa que fechou pelo horário: grava o valor e a lista (assim mais nada muda)
async function congelarRateio(xid) {
  const x = S.extras[xid]; if (!x || !x.rateio || x.rateio.fechadoEm || !C.rateioFechado(x)) return;
  const ids = C.rateioParticipantes(x).filter(id => S.alunas[id]);
  await B.set(`escolas/${S.eid}/extras/${xid}`, { rateio: { ...x.rateio, fechadoEm: Math.min(Date.now(), Number(x.rateio.prazoEm) || Date.now()) }, alunas: ids, v: C.rateioValor(x, ids.length) }, { merge: true });
}
function sheetRateio(xid) {
  const x = S.extras[xid]; if (!x) return fecharSheet();
  if (S.admin && !x.rateio.fechadoEm && C.rateioFechado(x)) { congelarRateio(xid).then(() => sheetRateio(xid)).catch(() => { }); }
  const conv = rtConv(x), fechado = C.rateioFechado(x), part = x.rateio.fechadoEm ? (x.alunas || []).filter(id => S.alunas[id]) : C.rateioParticipantes(x).filter(id => S.alunas[id]);
  const nNao = conv.filter(id => rtSt(x, id) === 'nao').length, nSem = conv.length - part.length - nNao, cada = x.rateio.fechadoEm ? x.v : C.rateioValor(x, part.length);
  const pagou = id => !!C.stPag(((S.pags[id] || {}).extras || {})[xid]), nPg = part.filter(pagou).length;
  const ordem = id => ({ interesse: 0, nao: 2 }[rtSt(x, id)] ?? 1);
  const lista = [...conv].sort((a, b) => ordem(a) - ordem(b) || String(S.alunas[a].nome).localeCompare(S.alunas[b].nome)).map(id => {
    const st = x.rateio.fechadoEm ? (part.includes(id) ? 'interesse' : rtSt(x, id) === 'nao' ? 'nao' : null) : rtSt(x, id), wa = !fechado && !st ? waRateio(xid, id) : '';
    const dir = fechado ? (st === 'interesse' ? (pagou(id) ? '<span class="chip pago">Pagou</span>' : '<span class="chip aberto">Participa</span>') : `<span class="s">${st === 'nao' ? 'Não vai' : 'Não respondeu'}</span>`)
      : `<div class="seg rt-seg"><button type="button" data-rp="${esc(id)}" data-rs="interesse" aria-pressed="${st === 'interesse'}">Vai</button><button type="button" data-rp="${esc(id)}" data-rs="nao" aria-pressed="${st === 'nao'}">Não</button></div>`;
    return `<li><div class="grow"><div class="t">${esc(S.alunas[id].nome)}</div>${linhas(esc(primeiro(respDe(id).nome || '')))}</div>${dir}${fechado ? '' : wa ? `<a class="wa wa-mini" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Perguntar pelo WhatsApp">${ICO_WA}</a>` : WA_MINI_VAZIO}</li>`; }).join('');
  sheet(`<h3>${esc(x.nome)}</h3>
    <div class="rt-big"><span>${x.rateio.porAluno ? `${part.length} participante${part.length === 1 ? '' : 's'} × ${brl(x.rateio.porAluno)}` : `${brl(x.rateio.total)} ÷ ${part.length} participante${part.length === 1 ? '' : 's'}`}</span><b class="num">${part.length ? brl(cada) : '—'}</b></div>
    <div class="rt-conta"><div>Vão participar<b class="num">${part.length}</b></div><div>Não vão<b class="num">${nNao}</b></div><div>${fechado ? 'Pagaram' : 'Sem resposta'}<b class="num">${fechado ? nPg : nSem}</b></div></div>
    <div class="note">${x.rateio.fechadoEm || fechado ? `Respostas fechadas. Cada participante recebeu a cobrança de ${brl(cada)}, com vencimento em ${dataBR(x.venc)}.${!x.rateio.porAluno && part.length && C.r2(cada * part.length) > x.rateio.total ? ` A divisão não é exata: os ${brl(C.r2(cada * part.length - x.rateio.total))} a mais ficam no caixa.` : ''}`
      : `As respostas fecham sozinhas em ${quandoRT(x.rateio.prazoEm)}. Ao fechar, cada participante recebe a cobrança, com vencimento em ${dataBR(x.venc)}. Ninguém é cobrado antes disso.${nSem ? ' O botão verde pergunta pelo WhatsApp a quem ainda não respondeu.' : ''}`}</div>
    <ul class="list rt-lista">${lista || '<li class="empty">Ninguém convidado.</li>'}</ul>
    ${arquivosEvHTML(x)}${x.tamanhos ? '<button type="button" class="btn ghost" id="rttam">Tamanhos do uniforme</button>' : ''}
    <div class="err" id="rterr" role="alert"></div>
    ${fechado ? '<button class="btn ghost" data-fechar>Fechar</button>' : `<div class="actions"><button class="btn ghost" data-fechar>Voltar</button><button class="btn" id="rtfim">Fechar agora e cobrar</button></div>`}
    ${!nPg ? '<button class="btn ghost" id="rtdel" style="color:var(--out)">Excluir taxa</button>' : ''}`, sh => {
    sh.querySelectorAll('[data-rp]').forEach(b => b.onclick = async () => { const id = b.dataset.rp, st = rtSt(x, id) === b.dataset.rs ? null : b.dataset.rs;
      try { await B.set(`escolas/${S.eid}/extras/${xid}`, { part: { [id]: st ? { st, em: Date.now(), por: EU.uid, quem: 'escola' } : null } }, { merge: true }); setTimeout(() => sheetRateio(xid), 60); } catch (e) { $('rterr').textContent = msgErro(e); } });
    ligarArquivosEv($('overlay'));
    if ($('rttam')) $('rttam').onclick = () => abrirDe(() => sheetRateio(xid), () => sheetTamanhos(xid));
    if ($('rtfim')) $('rtfim').onclick = () => { if (!part.length) return $('rterr').textContent = 'Ninguém disse que vai participar ainda. Não há com quem dividir.';
      duploToque($('rtfim'), async () => { try { await B.set(`escolas/${S.eid}/extras/${xid}`, { rateio: { ...x.rateio, fechadoEm: Date.now() }, alunas: part, v: cada }, { merge: true }); aviso(`Cobrança de ${brl(cada)} enviada a ${part.length} participante${part.length === 1 ? '' : 's'}`); setTimeout(() => sheetRateio(xid), 60); } catch (e) { $('rterr').textContent = msgErro(e); } }, `Cobrar ${brl(cada)} de ${part.length}?`); };
    if ($('rtdel')) $('rtdel').onclick = () => confirmar('Excluir taxa?', `"${esc(x.nome)}" sai da lista de todos.`, 'Excluir', () => B.del(`escolas/${S.eid}/extras/${xid}`));
  });
}
// família: o convite das taxas divididas com as respostas abertas (na tela Pagar)
function avisoRateioFam() {
  return Object.entries(S.extras || {}).filter(([, x]) => x && x.tipo === 'taxa' && x.rateio && !C.rateioFechado(x)).map(([xid, x]) => {
    const meus = (x.convidados || []).filter(id => S.alunas[id]); if (!meus.length) return '';
    const n = C.rateioParticipantes(x).length;
    return `<div class="rt-card"><b class="rt-tit">${esc(x.nome)}</b>
      <span class="s">${x.rateio.porAluno ? `Custa <b>${brl(x.rateio.porAluno)}</b> por aluno. Só paga quem participar.` : `A escola vai dividir <b>${brl(x.rateio.total)}</b> entre os alunos que participarem. ${n ? `Até agora, <b>${n} ${n === 1 ? 'vai' : 'vão'} participar</b>: cerca de <b>${brl(C.rateioCada(x.rateio.total, n))}</b> para cada um. ` : ''}Quanto mais gente, menor o valor.`}</span>
      ${meus.map(id => { const st = rtSt(x, id);
        return `<div class="rt-fil"><div class="ev-ja-lin"><span class="chip">${esc(primeiro(S.alunas[id].nome))}</span>${st ? `<span class="s">${st === 'interesse' ? 'Vai participar' : 'Não vai'}</span>` : '<span class="ev-pend">Resposta pendente</span>'}</div>
          <div class="actions"><button type="button" class="btn ghost" data-rtx="${esc(xid)}" data-rti="${esc(id)}" data-rts="nao" aria-pressed="${st === 'nao'}">Não vou</button><button type="button" class="btn ${st === 'interesse' ? 'ok' : ''}" data-rtx="${esc(xid)}" data-rti="${esc(id)}" data-rts="interesse" aria-pressed="${st === 'interesse'}">${st === 'interesse' ? '✓ Vai participar' : 'Quero participar'}</button></div></div>`; }).join('')}
      <span class="s">Responda até ${quandoRT(x.rateio.prazoEm)}. A cobrança chega aqui quando as respostas fecharem.</span></div>`; }).join('');
}
function ligarRateioFam(v) {
  v.querySelectorAll('[data-rtx]').forEach(b => b.onclick = async () => { b.disabled = true;
    try { await marcarPart(b.dataset.rtx, b.dataset.rti, b.dataset.rts); aviso(b.dataset.rts === 'interesse' ? 'Combinado! A cobrança chega quando as respostas fecharem.' : 'Resposta enviada'); setTimeout(render, 60); } catch (e) { aviso(msgErro(e)); b.disabled = false; } });
}
const marcarPart = (xid, id, st) => { if (!MOCK && S.papel === 'f') return servidor('eventoResposta', { eid: S.eid, xid, alid: id, st });
  const x = S.extras[xid], d = { part: { [id]: { st, em: Date.now(), por: EU.uid, quem: S.papel === 'f' ? 'familia' : 'escola' } } };
  // pelo caixa da escola: a lista de quem é cobrado acompanha quem disse que vai
  if (pelaEscola(x)) { const novo = { ...(x.part || {}), [id]: { st } }; d.alunas = (x.convidados || []).filter(a => ['interesse', 'inscrito'].includes((novo[a] || {}).st) || pagouEvento(x, a)); }
  return B.set(`escolas/${S.eid}/extras/${xid}`, d, { merge: true }); };
// administração: quem vai, quem já está inscrito
const EV_LIBERADOS = new Set(); // eventos encerrados que a administração confirmou que quer editar (até fechar o app)
function sheetVerEvento(xid) {
  const x = S.extras[xid]; if (!x) return fecharSheet();
  const cv = porNome(Object.fromEntries(convidadosDe(x).map(id => [id, S.alunas[id]]))).map(([id]) => id);
  const g = { inscrito: [], interesse: [], sem: [], nao: [] }; cv.forEach(id => g[partDe(x, id) || 'sem'].push(id));
  const taxas = Object.entries(S.extras).filter(([, t]) => t.evento === xid), app = pelaEscola(x), fam = modoInsc(x) === 'familia';
  const volta = () => sheetVerEvento(xid);
  const lin = (id, acoes) => { const a = S.alunas[id], P = (x.part || {})[id] || {}; return `<li>${avatarAluno(id, a.nome)}<div class="grow"><div class="t">${esc(a.nome)}</div>${linhas(esc(respDe(id).nome || 'Sem responsável'), P.em ? `${P.quem === 'escola' ? 'Marcado pela escola' : 'Respondeu'} em ${dataCurta(P.em)}` : '')}</div>${typeof acoes === 'object' ? (acoes.valor || '') + `<span class="ev-acoes">${acoes.acoes}</span>` : `<span class="ev-acoes">${acoes}</span>`}</li>`; };
  const bt = (id, st, txt, cls = 'ghost') => `<button type="button" class="btn ${cls} btn-mini" data-pst="${esc(st)}" data-pid="${esc(id)}">${txt}</button>`;
  // "Vai" e "Não vai" sempre aparecem; o escolhido fica pintado (verde ou vermelho) e tocar nele de novo não faz nada
  const vaiNao = id => { const st = partDe(x, id), vai = st === 'interesse' || st === 'inscrito', nao = st === 'nao';
    const b = (on, est, txt, cls) => `<button type="button" class="btn ghost btn-mini ${cls}${on ? ' on' : ''}" ${on ? '' : `data-pst="${est}" data-pid="${esc(id)}"`} aria-pressed="${on}">${txt}</button>`;
    return b(vai, 'interesse', 'Vai', 'ev-v') + b(nao, 'nao', 'Não vai', 'ev-n'); };
  const sec = (tit, ids, acoes, vazio) => `<section><h2>${tit} <span class="sub num">${ids.length}</span></h2>${ids.length ? `<ul class="list">${ids.map(id => lin(id, acoes(id))).join('')}</ul>` : `<div class="note">${vazio}</div>`}</section>`;
  sheet(`<h3>${esc(x.nome)}</h3>
    ${ddl([['Quando', esc(periodoTxt(x))], ['Local', esc(x.local || '')], ['Organiza', esc(x.organizador || '')], ['Inscrição', app ? `<span class="num">${brl(x.v)}</span> <span class="sub">pelo caixa da escola · vence ${dataBR(x.venc)}${x.vencHora ? ' às ' + x.vencHora.replace(':00', 'h').replace(':', 'h') : ''}</span>` : x.valorInscricao ? `<span class="num">${brl(x.valorInscricao)}</span> <span class="sub">paga ao organizador</span>` : ''], ['Responder até', x.prazo ? prazoTxt(x) : '']])}
    ${fimDe(x) < hoje() ? `<div class="banner"><span><b>Evento encerrado</b> em ${dataBR(fimDe(x))}. Para mudar alguma coisa, o app pede confirmação.</span></div>` : ''}
    ${localEventoHTML(x)}
    ${fotosHTML(xid, fotosDoEvento(xid, x, () => { if ($('evmsg')) sheetVerEvento(xid); }))}
    <div class="tiles"><div class="tile"><span class="lbl">Inscritos</span><b class="num">${g.inscrito.length}</b></div><div class="tile"><span class="lbl">${app ? 'A pagar' : fam ? 'Falta confirmar' : 'Querem ir'}</span><b class="num">${g.interesse.length}</b></div><div class="tile"><span class="lbl">Sem resposta</span><b class="num">${g.sem.length}</b></div></div>
    <button type="button" class="btn ghost btn-ico" id="evmsg">${ICO_WA}<span>Mensagem para o grupo</span></button>
    ${x.tamanhos ? '<button type="button" class="btn ghost" id="evtam">Tamanhos do uniforme</button>' : ''}
    <button type="button" class="btn ghost" id="evdocs">Lista dos atletas (PDF)</button>
    ${app ? sec('Vão · aguardando pagamento', g.interesse, id => ({ valor: valorCol(brl(C.valorExtra(x, id)), '<span class="chip aberto">A pagar</span>'), acoes: vaiNao(id) }), 'Ninguém com inscrição a pagar.')
      : fam ? sec('Vão · falta confirmar a inscrição', g.interesse, id => ({ valor: x.valorInscricao > 0 ? valorCol(brl(x.valorInscricao)) : '', acoes: `${vaiNao(id)}${bt(id, 'inscrito', 'Já inscrito', 'ghost ev-insc')}` }), 'Todos que vão já confirmaram a inscrição.')
      : sec('Querem ir', g.interesse, id => ({ valor: x.valorInscricao > 0 ? valorCol(brl(x.valorInscricao)) : '', acoes: `${vaiNao(id)}${bt(id, 'inscrito', 'Inscrever', 'ev-insc')}` }), 'Ninguém aguardando inscrição.')}
    ${app ? sec('Inscritos · pagos', g.inscrito, () => '<span class="chip pago">Pago</span>', 'Quem pagar a inscrição pelo app aparece aqui.')
      : sec(fam ? 'Inscrição confirmada' : 'Inscritos', g.inscrito, id => `<span class="chip pago">${fam && ((x.part || {})[id] || {}).quem === 'familia' ? 'Família confirmou' : 'Inscrito(a)'}</span>${bt(id, 'interesse', 'Desfazer')}`, fam ? 'Quando a família fizer a inscrição e confirmar no app, aparece aqui.' : 'Quando a inscrição for paga ao organizador, toque em "Inscrever".')}
    ${sec('Sem resposta', g.sem, id => vaiNao(id), 'Todos responderam.')}
    ${sec('Não vão', g.nao, id => vaiNao(id), 'Ninguém respondeu que não vai.')}
    ${taxas.length ? `<section><h2>Taxas deste evento</h2><ul class="list">${taxas.map(([tid, t]) => { const al = [...C.alvoExtra(t, S.alunas, S.grupos)]; return `<li class="tap" data-tx="${esc(tid)}"><div class="grow"><div class="t">${esc(t.nome)}</div>${linhas(`<span class="num">${al.length} aluno${al.length === 1 ? '' : 's'} · vence ${dataBR(t.venc)}</span>`)}</div>${valorCol(brl(C.r2(al.reduce((s, id) => s + C.valorExtra(t, id), 0))))}</li>`; }).join('')}</ul></section>` : ''}
    <button type="button" class="btn" id="evtaxa" ${g.inscrito.length + g.interesse.length ? '' : 'disabled'}>Lançar taxa deste evento</button>
    <div class="note">${g.inscrito.length + g.interesse.length ? `Já vem marcado quem ${g.inscrito.length ? 'confirmou a inscrição' : 'disse que vai'}; dá para ajustar. Serve para ajuda de custo, uniforme, transporte.` : 'Disponível quando alguém disser que vai.'}</div>
    <div class="actions"><button type="button" class="btn ghost" id="evedit">Editar evento</button><button type="button" class="btn ghost" data-fechar>Fechar</button></div>`, sh => {
    $('evmsg').onclick = () => abrirDe(volta, () => sheetMsgEvento(xid));
    if ($('evtam')) $('evtam').onclick = () => abrirDe(volta, () => sheetTamanhos(xid));
    $('evdocs').onclick = () => { const cv = convidadosDe(x), vao = cv.filter(id => ['interesse', 'inscrito'].includes(partDe(x, id)));
      abrirDe(volta, () => sheetJuntarDocs({ titulo: x.nome, evento: xid, pre: vao, volta })); };
    ligarFotos(sh);
    // evento já encerrado: qualquer mudança pede confirmação antes (uma vez por abertura da tela)
    const seLiberado = f => (fimDe(x) >= hoje() || EV_LIBERADOS.has(xid)) ? f() : confirmar('Evento encerrado', `${esc(x.nome)} terminou em ${dataBR(fimDe(x))}. Deseja realmente editar?`, 'Sim, editar', () => { EV_LIBERADOS.add(xid); f(); });
    const fazPart = async b => { b.disabled = true; await marcarPart(xid, b.dataset.pid, b.dataset.pst); if (b.dataset.pst === 'inscrito') aviso(`${primeiro(S.alunas[b.dataset.pid].nome)} inscrito(a)`); setTimeout(volta, 60); };
    // inscrever pede toque duplo (evita marcar sem querer); "Vai" e "Não vai" são um toque só
    sh.querySelectorAll('[data-pst]').forEach(b => b.onclick = () => seLiberado(() => b.dataset.pst === 'inscrito' ? duploToque(b, () => fazPart(b), 'Confirmar?') : fazPart(b)));
    sh.querySelectorAll('[data-tx]').forEach(li => li.onclick = () => abrirDe(volta, () => sheetExtra(li.dataset.tx)));
    $('evedit').onclick = () => seLiberado(() => abrirDe(volta, () => sheetEvento(xid)));
    $('evtaxa').onclick = () => seLiberado(() => abrirDe(volta, () => sheetExtra(null, { tipo: 'taxa', pre: { ids: g.inscrito.length ? g.inscrito : g.interesse, evento: xid, quadro: (g.inscrito.length ? 'ei:' : 'ev:') + xid } })));
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
  const L = [`🏆 *${x.nome}*`, [`📅 ${periodoTxt(x)}`, x.local ? `📍 ${x.local}` : '', x.endereco ? `🗺️ Como chegar: ${mapaDe(x)}` : ''].filter(Boolean).join('\n')];
  if ((x.links || []).length) L.push(x.links.map(l => `🔗 ${l.d}: ${l.v}`).join('\n'));
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
    ${ddl([['Quando', esc(periodoTxt(x))], ['Local', esc(x.local || '')], ['Organiza', esc(x.organizador || '')], ['Inscrição', pelaEscola(x) ? `<span class="num">${brl(x.v)}</span> <span class="sub">pelo app, vence ${dataBR(x.venc)}${x.vencHora ? ' às ' + x.vencHora.replace(':00', 'h').replace(':', 'h') : ''}</span>` : x.valorInscricao ? `<span class="num">${brl(x.valorInscricao)}</span> <span class="sub">paga ao organizador</span>` : ''], ['Responder até', x.prazo ? prazoTxt(x) : '']])}
    ${localEventoHTML(x)}
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
  // evento encerrado ou prazo passado: só mostra como ficou, sem botões
  const h = hoje(), acabou = fimDe(x) < h, fechou = C.prazoPassou(x);
  if (acabou || fechou) {
    const ficou = st === 'inscrito' ? 'Inscrito(a)' : st === 'interesse' ? 'Vai' : st === 'nao' ? 'Não vai' : 'Não respondeu';
    return `<div class="ev-resp"><span class="grow"><b>${nm}</b><span class="s">${acabou ? 'Evento encerrado' : `Respostas encerradas em ${prazoTxt(x)}`}</span></span><span class="chip ${st === 'inscrito' ? 'pago' : ''}">${ficou}</span></div>`;
  }
  if (st === 'inscrito') {
    sub = modo === 'app' ? 'Inscrição paga' : modo === 'familia' ? `Inscrição confirmada${P.quem === 'familia' ? ' por você' : ' pela escola'}${P.em ? ' em ' + dataCurta(P.em) : ''}` : 'Inscrição feita pela escola';
    direita = '<span class="chip pago">Inscrito(a)</span>';
    if (modo === 'familia' && P.quem === 'familia') extra = `<button type="button" class="link ev-desfaz" data-fx="${esc(xid)}" data-fid="${esc(id)}" data-fst="interesse">Desfazer confirmação</button>`;
  } else if (st === 'interesse') {
    sub = modo === 'app' ? 'A inscrição está na tela Pagar' : modo === 'familia' ? `Faça a inscrição com ${esc(x.organizador || 'quem organiza')} e depois confirme aqui` : 'A escola vai cuidar da inscrição';
    if (modo === 'familia') extra = `<span class="ev-ja-lin"><button type="button" class="btn btn-mini ev-ja" data-fx="${esc(xid)}" data-fid="${esc(id)}" data-fst="inscrito">Já fiz a inscrição</button><span class="ev-pend">Inscrição pendente</span></span>`;
  }
  const tam = x.tamanhos && (st === 'interesse' || st === 'inscrito') ? `<label class="tam-lin"><span class="grow"><b style="font-size:.92rem">Tamanho do uniforme</b>${tamEsc(x, id) ? '' : ' <span class="ev-pend">falta escolher</span>'}</span><select data-tmx="${esc(xid)}" data-tmi="${esc(id)}" aria-label="Tamanho de ${nm}"><option value="">Tamanho</option>${x.tamanhos.opcoes.map(o => `<option ${tamEsc(x, id) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>` : '';
  return `<div class="ev-resp"><span class="grow"><b>${nm}</b><span class="s">${sub}</span>${extra}</span>${direita}</div>${tam}`;
}
// família: disse que vai, mas a inscrição é com quem organiza e ainda não confirmou que fez
// quem disse que vai e ainda tem coisa a fazer no evento: fazer a inscrição com quem organiza e/ou escolher o tamanho.
// Um aviso só por evento, dizendo o que falta; resolvida uma parte, o aviso passa a falar só da outra.
const faltaTamEv = (x, ids) => x && x.tamanhos ? ids.filter(id => ['interesse', 'inscrito'].includes(partDe(x, id)) && !tamEsc(x, id)) : [];
const faltaInscEv = (x, ids) => modoInsc(x) === 'familia' ? ids.filter(id => partDe(x, id) === 'interesse') : [];
function avisoInscricaoPendente() {
  const h = hoje(), meus = Object.keys(S.alunas), nomes = ids => ids.map(id => primeiro(S.alunas[id].nome)).join(' e ');
  return eventosAtivos().filter(([, x]) => fimDe(x) >= h).map(([xid, x]) => { const cv = convidadosDe(x).filter(id => meus.includes(id)); return { xid, x, insc: faltaInscEv(x, cv), tam: faltaTamEv(x, cv) }; })
    .filter(e => e.insc.length || e.tam.length).map(({ xid, x, insc, tam }) => {
      const quem = nomes([...new Set([...insc, ...tam])]), org = x.organizador || 'quem organiza';
      const tit = insc.length && tam.length ? `${esc(x.nome)}: falta inscrição e tamanho` : insc.length ? `Confirme a inscrição: ${esc(nomes(insc))} no ${esc(x.nome)}` : `${esc(x.nome)}: falta o tamanho do uniforme`;
      const sub = insc.length && tam.length ? `${esc(quem)} vai. Falta confirmar a inscrição (com ${esc(org)}) e escolher o tamanho do uniforme.`
        : insc.length ? `Faça a inscrição com ${esc(org)} e depois toque em "Já fiz a inscrição".` : `${esc(quem)} vai. Toque para escolher o tamanho.`;
      return `<button class="faixa-resumo alerta" data-insc="${esc(xid)}"><span class="grow"><b>${tit}</b><span class="s">${sub}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`; }).join('');
}
function avisoTamEventoFam() { return ''; }
function avisoEventosFamilia() {
  const h = hoje(), meus = Object.keys(S.alunas);
  return eventosAtivos().filter(([, x]) => fimDe(x) >= h && !C.prazoPassou(x)).map(([xid, x]) => ({ xid, x, ids: convidadosDe(x).filter(id => meus.includes(id) && !partDe(x, id)) })).filter(e => e.ids.length)
    .map(({ xid, x, ids }) => `<button class="faixa-resumo" data-abrev="${esc(xid)}"><span class="grow"><b>${esc(x.nome)}: ${esc(ids.map(id => primeiro(S.alunas[id].nome)).join(' e '))} ${ids.length > 1 ? 'vão' : 'vai'}?</b><span class="s">${esc(periodoTxt(x))}${x.prazo ? ` · responda até ${dataBR(x.prazo)}` : ''}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`).join('');
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
    ${S.admin ? (() => { let venc = 0, logo = 0; for (const [id, a] of Object.entries(S.alunas)) { if (!C.ativaNoMes(a, mes) || a.anonimizadoEm) continue; const pd = piorDoc(id); if (pd === 'vencido') venc++; else if (pd === 'vence') logo++; }
      return `<button type="button" class="faixa-resumo ${venc || logo ? '' : 'neutra'}" id="adocs" style="margin-bottom:12px"><span class="grow"><b>Documentos dos alunos</b><span class="s">${venc || logo ? [venc ? `${venc} com documento vencido` : '', logo ? `${logo} vence${logo === 1 ? '' : 'm'} em até 30 dias` : ''].filter(Boolean).join(' · ') : 'Parecer cardiológico, identidade… e juntar em PDF para competição'}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`; })() : ''}
    ${reps.map(x => `<div class="banner"><span><b>${esc(S.resps[x.a].nome)}</b> (${esc(alunasDoResp(x.a).map(([, a]) => primeiro(a.nome)).join(', ') || 'sem alunos')}) e <b>${esc(S.resps[x.b].nome)}</b> (${esc(alunasDoResp(x.b).map(([, a]) => primeiro(a.nome)).join(', ') || 'sem alunos')}) têm o mesmo ${x.por}. É a mesma pessoa?</span><span class="actions"><button data-junta="${esc(x.par)}">Agrupar</button><button data-nao="${esc(x.par)}" style="color:var(--muted)">Não é</button></span></div>`).join('')}
    <div class="field"><input id="abusca" type="search" placeholder="Buscar aluno(a), responsável ou telefone" value="${esc(S.busca || '')}" aria-label="Buscar"></div>
    ${vis.length ? vis.map(({ rid, r, al }) => `<ul class="list">
        <li class="resp-cab ${rid ? 'tap' : ''}" ${rid ? `data-resp="${esc(rid)}"` : ''}><div class="grow"><div class="label">Responsável</div><div class="resp-l1"><span class="t">${esc(r.nome)}</span>${rid ? `<span class="resp-fone num">– ${esc(foneBR(r.telefone) || 'sem telefone')}</span>` : ''}</div></div>${rid && r.codigo ? `<span class="chip resp-cod">${esc(r.codigo)}</span>` : ''}${rid && S.admin ? waPendencias(al.map(([id]) => id)) : ''}</li>
        ${al.map(([id, a]) => { const m = C.mensalidade(S.alunas, id, mes, S.turmas, S.cfg), at = C.ativaNoMes(a, mes); return `<li class="tap" data-al="${esc(id)}" style="${at ? '' : 'opacity:.55'}">${avatarAluno(id, a.nome)}<div class="grow"><div class="t">${esc(a.nome)}</div>${linhas(esc([idade(a.nascimento) || 'Sem data de nascimento', catNome(id)].filter(Boolean).join(' · ')) + (catErrada(id) ? ' <span class="fx-pend atraso">Categoria?</span>' : ''), esc(turmasTxt(a) || 'Sem turma'))}</div>${valorCol(m ? brl(m.v) : '—', [mudancasFaixa(id).length ? '<span class="chip vencido">Faixa etária</span>' : '', at ? '' : '<span class="chip">Inativo(a)</span>', (() => { if (!at || a.anonimizadoEm) return ''; const x = termoDe(id); return x.pend && x.pend.length ? '<span class="chip vencido">Termo mudou</span>' : x.atest ? '<span class="chip vencido">Falta atestado</span>' : x.st !== 'ok' ? '<span class="chip aberto">Sem termo</span>' : ''; })(), (() => { if (!at || a.anonimizadoEm || !S.admin) return ''; const pd = piorDoc(id); return pd === 'vencido' ? '<span class="chip vencido">Documento vencido</span>' : pd === 'vence' ? '<span class="chip vencido">Documento vencendo</span>' : ''; })()].filter(Boolean).slice(0, 1).join(''))}</li>`; }).join('')}
        ${rid ? `<li class="tap" data-nova="${esc(rid)}" style="min-height:44px"><span class="sub">+ Outro(a) aluno(a) com ${esc(primeiro(r.nome))}</span></li>` : ''}
      </ul>`).join('') : `<div class="empty">${q ? 'Nada encontrado.' : '<b>Nenhum aluno cadastrado.</b><span>Cadastre cada aluno(a) com a turma e o responsável. Se o telefone ou o CPF do responsável já existir, o app sugere agrupar os irmãos.</span>'}</div>`}`;
  $('abusca').oninput = e => { S.busca = e.target.value; render(); };
  $('ana').onclick = () => sheetAluna();
  if ($('adocs')) $('adocs').onclick = () => sheetDocsEscola();
  v.querySelectorAll('[data-resp]').forEach(li => li.onclick = e => { if (e.target.closest('[data-nao-abre]')) return; sheetResp(li.dataset.resp); });
  v.querySelectorAll('[data-al]').forEach(li => li.onclick = e => { if (e.target.closest('[data-nao-abre]')) return; S.admin ? sheetPerfilAluno(li.dataset.al) : sheetAluna(li.dataset.al); });
  v.querySelectorAll('[data-vmud]').forEach(b => b.onclick = () => { const f = termosParaVer(), i = f.indexOf(b.dataset.vmud); sheetVerTermo(b.dataset.vmud, i >= 0 ? f.filter(id => id !== b.dataset.vmud) : []); });
  v.querySelectorAll('[data-nova]').forEach(li => li.onclick = () => sheetAluna(null, li.dataset.nova));
  v.querySelectorAll('[data-nao]').forEach(b => b.onclick = () => B.set(`escolas/${S.eid}/config/geral`, { naoRepetidos: [...(S.cfg.naoRepetidos || []), b.dataset.nao] }, { merge: true }));
  v.querySelectorAll('[data-junta]').forEach(b => b.onclick = () => juntarResps(...b.dataset.junta.split('+')));
}
function juntarResps(a, b) {
  // fica o cadastro com mais alunos (ou o mais antigo); o outro é apagado. Quem já usa o app continua entrando normalmente:
  // o servidor passa o acesso dessas famílias para o cadastro que fica, e o código antigo continua valendo (aponta para ele)
  const [fica, sai] = alunasDoResp(b).length > alunasDoResp(a).length ? [b, a] : [a, b], F = S.resps[fica], X = S.resps[sai];
  const nomes = alunasDoResp(sai).map(([, x]) => x.nome);
  confirmar('Agrupar responsáveis?', `${esc(nomes.join(', ') || 'Os alunos')} passa${nomes.length > 1 ? 'm' : ''} para ${esc(F.nome)}. Os irmãos ficam juntos no mesmo responsável. Quem já usa o app continua entrando normalmente.`, 'Agrupar', async () => {
    await vinculosServidor('agrupar', sai, fica);
    const ops = alunasDoResp(sai).map(([id]) => ({ op: 'merge', p: `escolas/${S.eid}/alunas/${id}`, d: { responsavelId: fica } }));
    const comp = {}; ['telefone', 'cpf', 'email'].forEach(k => { if (!F[k] && X[k]) comp[k] = X[k]; });
    const antigos = [...(F.codigosAntigos || []), ...(X.codigo ? [X.codigo] : []), ...(X.codigosAntigos || [])];
    if (antigos.length) comp.codigosAntigos = [...new Set(antigos)];
    if (Object.keys(comp).length) ops.push({ op: 'merge', p: `escolas/${S.eid}/responsaveis/${fica}`, d: comp });
    ops.push({ op: 'del', p: `escolas/${S.eid}/responsaveis/${sai}` });
    antigos.forEach(c => ops.push({ op: 'set', p: 'codigos/' + c, d: { eid: S.eid, rid: fica } }));
    await B.lote(ops); aviso('Responsáveis agrupados');
  });
}
// códigos do responsável: o dele e os que vieram de cadastros agrupados
const codigosDoResp = r => [...new Set([r.codigo, ...(r.codigosAntigos || [])].filter(Boolean))];
function convite(r) { return `Olá${r.nome ? ', ' + primeiro(r.nome) : ''}! A ${S.escola.nome || 'escola'} agora recebe as mensalidades e as taxas pelo app. Você vê cada cobrança e escolhe o que pagar, por Pix.\n1. Abra ${LINK_APP}\n2. Crie sua conta (ou entre com Google)\n3. Digite o código: ${r.codigo}`; }
// nota fiscal para as famílias: ligada pela escola ou por algum professor?
const nfFamLigada = () => !!((S.cfg.nfFam || {}).ligado || Object.values((S.admin ? S.profsPub : S.profs) || {}).some(p => p && p.nf && p.nf.ligado));
const nfModo = () => (S.cfg.nfFam || {}).modo || 'todas';
const notaDaFamilia = r => r && r.nota ? r.nota === 'sim' : nfModo() !== 'pedido';
// CPF com pontos e traço enquanto digita
const fmtCpf = c => { const d = C.soDigitos(c).slice(0, 11); return d.length <= 3 ? d : d.length <= 6 ? `${d.slice(0, 3)}.${d.slice(3)}` : d.length <= 9 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}` : `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`; };
document.addEventListener('input', e => { if (e.target && e.target.id === 'rcpf') { const v = fmtCpf(e.target.value); if (v !== e.target.value) e.target.value = v; } });
function sheetResp(rid) {
  const r = S.resps[rid]; if (!r) return;
  const al = alunasDoResp(rid), noApp = Object.values(S.membros).filter(m => m.codigo === r.codigo).length;
  sheet(`<h3>${esc(r.nome)}</h3>
    <div class="sub">Responsável por ${esc(al.map(([, a]) => a.nome).join(', ') || 'nenhum aluno')}</div>
    <div class="field"><label for="rnome">Nome</label><input id="rnome" maxlength="60" value="${esc(r.nome || '')}"></div>
    <div class="two"><div class="field"><label for="rtel">WhatsApp</label><input id="rtel" inputmode="tel" maxlength="20" value="${esc(r.telefone || '')}"></div>
    <div class="field"><label for="rcpf">CPF</label><input id="rcpf" inputmode="numeric" maxlength="14" value="${esc(fmtCpf(r.cpf))}" placeholder="000.000.000-00" required></div></div>
    <div class="field"><label for="rmail">E-mail</label><input id="rmail" type="email" maxlength="80" value="${esc(r.email || '')}"></div>
    <div class="field"><label for="rend">Endereço</label><input id="rend" maxlength="160" value="${esc(r.endereco || '')}" placeholder="Rua, número, bairro, cidade/UF" autocomplete="street-address"></div>
    ${nfFamLigada() ? ligaNota('rnf', notaDaFamilia(r), nfModo() === 'pedido' ? 'Você escolheu emitir só para quem pede. Ligue se esta família pediu.' : 'Desligue se esta família disse que não precisa de nota.') : ''}
    <div class="hero" style="padding:14px;gap:8px"><div class="label">Código de acesso</div><div class="big num" style="font-size:1.8rem;letter-spacing:.18em;user-select:all">${esc(r.codigo || '')}</div>
      <div class="sub">${noApp ? `${noApp} pessoa${noApp > 1 ? 's' : ''} entrou no app com este código.` : 'Ninguém entrou no app com este código ainda.'}</div>
      <div class="actions">${numeroWa(r.telefone) ? `<a class="btn wa-btn" href="${esc(waLink(r.telefone, convite(r)))}" target="_blank" rel="noopener">${ICO_WA} Enviar convite</a>` : ''}<button class="btn ghost" id="rconv">Copiar convite</button></div></div>
    <div class="err" id="rerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="rok">Salvar</button></div>
    <button class="btn ghost" id="rdel" style="color:var(--out)">Excluir responsável</button>`, () => {
    $('rconv').onclick = () => copiar(convite(r), 'Convite copiado. Cole no WhatsApp do responsável.');
    $('rok').onclick = async () => {
      const nome = $('rnome').value.trim(); if (!nome) return $('rerr').textContent = 'Digite o nome do responsável.';
      if (!C.soDigitos($('rcpf').value)) return $('rerr').textContent = 'Informe o CPF do responsável. Ele é obrigatório (vai na nota fiscal).';
      if (!C.cpfValido($('rcpf').value)) return $('rerr').textContent = 'Esse CPF não confere. Veja se algum número foi digitado errado.';
      try { await B.set(`escolas/${S.eid}/responsaveis/${rid}`, { nome, telefone: $('rtel').value.trim(), cpf: $('rcpf').value.trim(), email: $('rmail').value.trim(), endereco: $('rend').value.trim(), ...($('rnf') && $('rnf').checked !== notaDaFamilia(r) ? { nota: $('rnf').checked ? 'sim' : 'nao' } : {}) }, { merge: true }); fecharSheet(); aviso('Responsável atualizado'); }
      catch (e) { $('rerr').textContent = msgErro(e); }
    };
    $('rdel').onclick = () => al.length ? ($('rerr').textContent = 'Este responsável tem alunos. Troque o responsável deles antes.') : confirmar('Excluir responsável?', `${esc(r.nome)} e o código ${esc(r.codigo || '')} deixam de existir.`, 'Excluir', () => B.lote([{ op: 'del', p: `escolas/${S.eid}/responsaveis/${rid}` }, ...codigosDoResp(r).map(c => ({ op: 'del', p: 'codigos/' + c }))]));
  });
}
// mês no formato mês/ano (11/2026), de 3 anos atrás a 1 ano à frente
const opcoesMes = atual => { const h = mesHoje(), l = []; for (let k = -36; k <= 12; k++) l.push(mesMais(h, k)); if (atual && !l.includes(atual)) l.push(atual); l.sort();
  return l.map(m => `<option value="${m}" ${m === atual ? 'selected' : ''}>${m.slice(5)}/${m.slice(0, 4)}</option>`).join(''); };
/* ---- Categorias: a escola define pelo ano/data de nascimento ("nascidos de … até …"); o app distribui e avisa quando não bate ---- */
const categorias = () => ((S.cfg || {}).categorias || []).filter(c => c && c.id && c.nome).sort((a, b) => String(b.de || '').localeCompare(String(a.de || '')) || a.nome.localeCompare(b.nome, 'pt-BR'));
const catPorNasc = n => n ? categorias().find(c => (!c.de || n >= c.de) && (!c.ate || n <= c.ate)) || null : null;
const catSugerida = id => catPorNasc((S.alunas[id] || {}).nascimento);
// a categoria do aluno: a escolhida à mão, se houver; senão a da data de nascimento
const catDe = id => { const a = S.alunas[id] || {}, m = a.categoria && categorias().find(c => c.id === a.categoria); return m || catSugerida(id); };
const catNome = id => (catDe(id) || {}).nome || '';
// escolhida à mão e diferente da data de nascimento: o app sugere mudar
const catErrada = id => { const a = S.alunas[id] || {}, sg = catSugerida(id); return !!(a.categoria && sg && a.categoria !== sg.id && categorias().some(c => c.id === a.categoria)); };
function sheetCategorias() {
  const ano = new Date().getFullYear();
  let L = categorias().map(c => ({ ...c }));
  const linhaC = (c, i) => `<div class="cat-lin"><div class="field"><label for="ctn${i}">Nome</label><input id="ctn${i}" data-cn="${i}" maxlength="30" value="${esc(c.nome || '')}" placeholder="Ex.: Sub-11"></div>
    <div class="two"><div class="field"><label for="ctd${i}">Nascidos de</label><input id="ctd${i}" type="date" data-cd="${i}" value="${esc(c.de || '')}"></div><div class="field"><label for="cta${i}">até</label><input id="cta${i}" type="date" data-ca="${i}" value="${esc(c.ate || '')}"></div></div>
    <button type="button" class="link" data-cx="${i}" style="color:var(--out);align-self:flex-start">Tirar esta categoria</button></div>`;
  sheet(`<h3>Categorias</h3>
    <div class="sub">Diga quem entra em cada categoria pela data de nascimento. O app coloca cada aluno na categoria certa e avisa quando alguma escolhida à mão não bate.</div>
    <div id="ctl"></div><button type="button" class="add-disc add-largo" id="ctadd">+ Categoria</button>
    <div id="ctres"></div>
    <div class="err" id="cterr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Voltar</button><button type="button" class="btn" id="ctok">Salvar categorias</button></div>`, sh => {
    const ler = () => sh.querySelectorAll('[data-cn]').forEach(i => { const k = Number(i.dataset.cn); L[k].nome = i.value.trim(); L[k].de = $('ctd' + k).value; L[k].ate = $('cta' + k).value; });
    const resumo = () => { // conta com as categorias da tela (ainda sem salvar)
      const ok = L.filter(c => c.nome), por = n => n ? ok.find(c => (!c.de || n >= c.de) && (!c.ate || n <= c.ate)) : null;
      const al = Object.entries(S.alunas).filter(([, a]) => !a.anonimizadoEm && C.ativaNoMes(a, mesHoje()));
      const sem = al.filter(([, a]) => !a.categoria && !por(a.nascimento)), erradas = al.filter(([, a]) => a.categoria && por(a.nascimento) && por(a.nascimento).id !== a.categoria);
      $('ctres').innerHTML = !ok.length ? '' : `<div class="faixa-card" style="background:var(--bg)"><b>Como ficam os ${al.length} alunos</b>
        <span class="s num">${ok.map(c => `${esc(c.nome)}: ${al.filter(([, a]) => (a.categoria && ok.some(x => x.id === a.categoria) ? a.categoria : (por(a.nascimento) || {}).id) === c.id).length}`).join(' · ')}</span>
        ${sem.length ? `<span class="s">Sem categoria: ${sem.length} (${esc(sem.slice(0, 4).map(([, a]) => primeiro(a.nome)).join(', '))}${sem.length > 4 ? '…' : ''}). Confira as datas ou o nascimento deles.</span>` : ''}
        ${erradas.length ? `<span class="s" style="color:var(--out)">${erradas.length} escolhida${erradas.length === 1 ? '' : 's'} à mão não bate${erradas.length === 1 ? '' : 'm'} com a data de nascimento: ${esc(erradas.slice(0, 4).map(([, a]) => primeiro(a.nome)).join(', '))}${erradas.length > 4 ? '…' : ''}.</span><button type="button" class="btn ghost" id="ctfix" data-ids="${esc(erradas.map(([id]) => id).join(','))}">Usar a data de nascimento para ${erradas.length === 1 ? 'ele(a)' : 'eles'}</button>` : ''}</div>`;
      if ($('ctfix')) $('ctfix').onclick = async () => { try { await B.lote($('ctfix').dataset.ids.split(',').map(id => ({ op: 'merge', p: `escolas/${S.eid}/alunas/${id}`, d: { categoria: null } }))); aviso('Categorias corrigidas'); setTimeout(resumo, 80); } catch (e) { $('cterr').textContent = msgErro(e); } };
    };
    const desenhar = () => { $('ctl').innerHTML = L.length ? L.map(linhaC).join('') : '<div class="note">Nenhuma categoria ainda.</div>';
      sh.querySelectorAll('[data-cx]').forEach(b => b.onclick = () => { ler(); L.splice(Number(b.dataset.cx), 1); desenhar(); });
      sh.querySelectorAll('#ctl input').forEach(i => i.addEventListener('change', () => { ler(); resumo(); })); resumo(); };
    $('ctadd').onclick = () => { ler(); const ult = L[L.length - 1], y = ult && ult.de ? Number(ult.de.slice(0, 4)) - 2 : ano - 10;
      L.push({ id: novoId(), nome: '', de: `${y}-01-01`, ate: `${y + 1}-12-31` }); desenhar(); const i = $('ctn' + (L.length - 1)); i && i.focus(); };
    desenhar();
    $('ctok').onclick = async () => { ler(); const err = m => $('cterr').textContent = m;
      if (L.some(c => !c.nome)) return err('Dê um nome para cada categoria, como "Sub-11".');
      if (L.some(c => c.de && c.ate && c.de > c.ate)) return err('Em alguma categoria, o "de" está depois do "até".');
      const dup = L.find((c, i) => L.some((d, j) => j < i && d.nome.toLowerCase() === c.nome.toLowerCase())); if (dup) return err(`Há duas categorias "${dup.nome}".`);
      $('ctok').disabled = true;
      try { await B.set(`escolas/${S.eid}/config/geral`, { categorias: L.map(({ id, nome, de, ate }) => ({ id, nome, de: de || null, ate: ate || null })) }, { merge: true }); aviso('✓ Categorias salvas'); fecharSheet(); }
      catch (e) { err(msgErro(e)); $('ctok').disabled = false; } };
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
  const listaT = ordenar(S.turmas).filter(([tid, t]) => adm || C.daTurma(t, S.prof) || minhas.has(tid));
  sheet(`<h3>${ed ? esc(a.nome) : 'Novo(a) aluno(a)'}</h3>
    ${ed && adm ? cartaoTermo(alid) : ''}
    ${mudA.map(m => cartaoFaixa(m, false)).join('')}
    <div class="foto-campo"><label class="foto-av" id="afotobox" aria-label="Foto da criança">${FOTOS[alid] ? `<img src="${FOTOS[alid]}" alt="">` : `<span>${a ? esc(iniciais(a.nome)) : ICO_CAM}</span>`}<input type="file" id="afoto" accept="image/*" hidden></label>
      <div class="grow"><b>Foto da criança</b><span class="sub">Tire uma foto ou escolha da galeria. A família também pode colocar pelo app.</span>
        <label class="pacao foto-bt" for="afoto" id="afotobt">${FOTOS[alid] ? 'Trocar foto' : 'Adicionar foto'}</label></div></div>
    <div class="field"><label for="anome">Nome do(a) aluno(a)</label><input id="anome" maxlength="60" value="${esc(a ? a.nome : '')}"></div>
    <div class="two"><div class="field"><label for="anasc">Data de nascimento</label><input id="anasc" type="date" max="${hoje()}" value="${esc(a ? a.nascimento || '' : '')}"></div>
    <div class="field"><span class="lb">Idade</span><div id="aidade" class="num campo-fixo">${esc(idade(a && a.nascimento) || '—')}</div></div></div>
    ${categorias().length ? `<div class="field"><label for="acat">Categoria</label><select id="acat"><option value="">Pela data de nascimento</option>${categorias().map(c => `<option value="${esc(c.id)}" ${a && a.categoria === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
      <span class="sub" id="acatnota"></span></div>` : ''}
    <div class="field"><span class="lb">Turma</span>
      <div class="checks">${listaT.map(([tid, t]) => { const n = alunasDaTurma(tid).length, cheia = t.vagas && n >= t.vagas && !minhas.has(tid); return `<label><input type="checkbox" data-tu="${esc(tid)}" ${minhas.has(tid) ? 'checked' : ''}><span class="grow"><span class="t" style="display:block">${esc(t.nome)}</span><span class="s">${esc(C.faixaTxt(t))}</span>${t.horario ? `<span class="s">${esc(t.horario)}</span>` : ''}${profNome(t) || localDe(t) ? `<span class="s">${esc([profNome(t), localDe(t)].filter(Boolean).join(' · '))}</span>` : ''}${t.vagas && !cheia ? `<span class="s num">${t.vagas - n === 1 ? 'Resta 1 vaga' : `Restam ${t.vagas - n} vagas`}</span>` : ''}<span class="s fora" data-fx="${esc(tid)}" style="color:var(--out);font-weight:700"></span></span><span class="valor-col">${adm ? `<b class="num">${brl(t.preco)}</b>` : ''}${cheia ? '<span class="chip vencido">Cheia</span>' : ''}</span></label>`; }).join('') || '<div class="grp">Nenhuma turma cadastrada ainda</div>'}</div></div>
    ${Object.keys(S.grupos).length ? `<div class="field"><span class="lb">Grupos</span><div class="chips">${porNome(S.grupos).map(([g, G]) => `<button type="button" class="pick" data-gr="${esc(g)}" aria-pressed="${meusG.has(g)}">${esc(G.nome)}</button>`).join('')}</div></div>` : ''}
    ${adm && !ed ? '<div class="note">Os documentos e as notas da equipe ficam no perfil do aluno, depois de salvar o cadastro.</div>' : ''}
    <div class="hero" style="padding:14px;gap:10px"><div class="label">Responsável</div>
      <div class="field"><label for="rnome">Nome</label><input id="rnome" maxlength="60" value="${esc(r0.nome || '')}" placeholder="Quem paga"></div>
      <div class="two"><div class="field"><label for="rtel">WhatsApp</label><input id="rtel" inputmode="tel" maxlength="20" value="${esc(r0.telefone || '')}" placeholder="(81) 99999-9999"></div>
      <div class="field"><label for="rcpf">CPF</label><input id="rcpf" inputmode="numeric" maxlength="14" value="${esc(fmtCpf(r0.cpf))}" placeholder="000.000.000-00" required></div></div>
      <div class="field"><label for="rend">Endereço</label><input id="rend" maxlength="160" value="${esc(r0.endereco || '')}" placeholder="Rua, número, bairro, cidade/UF" autocomplete="street-address"></div>
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
    <div class="two"><div class="field"><label for="aini">Cobrar a partir de</label><select id="aini">${opcoesMes(a ? a.inicio || mes : mes)}</select></div>
    <div class="field" id="afimw"><label for="afim">Último mês cobrado</label><select id="afim">${opcoesMes(a && a.fim ? a.fim : mesMais(mes, -1))}</select></div></div>
    ${adm ? `<div class="field"><label for="apm">Desconto no primeiro mês</label>
      <div class="banner" id="apmaviso" hidden style="margin-bottom:8px"><span>A matrícula é depois do dia 15. Quer dar desconto no primeiro mês?</span></div>
      <select id="apm">${[['inteiro', 'Sem desconto: cobrar o mês inteiro'], ['metade', 'Metade do mês (50%)'], ['prop', 'Proporcional aos dias que faltam'], ['isento', 'Não cobrar o primeiro mês'], ['valor', 'Outro valor']].map(([k, n]) => `<option value="${k}" ${((a && a.primeiroMes && a.primeiroMes.tipo) || 'inteiro') === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <input id="apmv" inputmode="decimal" placeholder="Valor do primeiro mês (R$)" value="${esc(a && a.primeiroMes && a.primeiroMes.tipo === 'valor' ? fmtValor(a.primeiroMes.v) : '')}" style="margin-top:8px" hidden>
      <div class="note" id="apmnota"></div></div>` : ''}
    ${ed ? `<label class="check"><input type="checkbox" id="aativa" ${ativa ? 'checked' : ''}> Aluno(a) ativo(a)</label>` : ''}
    ${!ed && adm && ((S.cfg.matricula || {}).valor > 0) ? `<label class="check" style="font-weight:500"><input type="checkbox" id="amat" checked> Cobrar a taxa de matrícula (${brl(S.cfg.matricula.valor)})</label>` : ''}
    <div class="err" id="aerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="aok">Salvar</button></div>
    ${ed && adm ? `<div class="actions"><button class="btn ghost" id="acob">Ver cobranças</button><button class="btn ghost" id="adel" style="color:var(--out)">Excluir aluno(a)</button></div>${a && !a.anonimizadoEm ? '<button class="btn ghost" id="aanon" style="color:var(--out)">Apagar dados pessoais (LGPD)</button>' : ''}` : ''}`, s => {
    ligarFaixa(s, () => sheetAluna(alid));
    // foto: guardada junto com o cadastro (no aluno novo, só depois de salvar)
    let novaFoto = null;
    const verFoto = f => { if (!$('afotobox')) return; $('afotobox').firstElementChild.outerHTML = f ? `<img src="${f}" alt="">` : `<span>${a ? esc(iniciais(a.nome)) : ICO_CAM}</span>`; $('afotobt').textContent = f ? 'Trocar foto' : 'Adicionar foto'; };
    if (alid && FOTOS[alid] === undefined) fotoAluno(alid).then(f => { if (f && !novaFoto) verFoto(f); });
    $('afoto').onchange = async e => { const arq = e.target.files[0]; e.target.value = ''; if (!arq) return; try { const f = await fotoQuadrada(arq); if (!f) return; novaFoto = f; verFoto(novaFoto); } catch (er) { $('aerr').textContent = er.message; } };
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
      $('rsim').onclick = () => { rid = mid; $('rnome').value = m.nome || ''; $('rend').value = m.endereco || ''; $('rtel').value = m.telefone || ''; $('rcpf').value = m.cpf || ''; sugerir(); prev(); aviso('Agrupada com ' + primeiro(m.nome)); };
      $('rnao').onclick = () => { recusado.add(mid); sugerir(); };
    };
    // primeiro mês: dias que faltam no mês de início (contando hoje, se começa neste mês)
    const primeiroMes = () => { if (!$('apm')) return undefined; const t = $('apm').value, ini = $('aini').value || mes;
      if (t === 'inteiro') return null;
      const [y, m] = ini.split('-').map(Number), dias = new Date(y, m, 0).getDate(), hj = new Date(), dia = ini === mesHoje() ? hj.getDate() : 1, restam = dias - dia + 1;
      if (t === 'metade') return { mes: ini, tipo: 'metade', fator: 0.5 };
      if (t === 'isento') return { mes: ini, tipo: 'isento', fator: 0 };
      if (t === 'prop') return { mes: ini, tipo: 'prop', fator: Math.round(restam / dias * 1000) / 1000, dias: restam, de: dias };
      return { mes: ini, tipo: 'valor', v: parseValor($('apmv').value) || 0 }; };
    const verPrimeiro = () => { if (!$('apm')) return; const ini = $('aini').value || mes, t = $('apm').value, pm = primeiroMes();
      $('apmaviso').hidden = !(ini === mesHoje() && new Date().getDate() > 15); $('apmv').hidden = t !== 'valor';
      $('apmnota').textContent = !pm ? `${C.nomeMes(ini)[0].toUpperCase() + C.nomeMes(ini).slice(1)} é cobrado inteiro.` : pm.tipo === 'prop' ? `Cobra ${pm.dias} de ${pm.de} dias de ${C.nomeMes(ini)} (${Math.round(pm.fator * 100)}% da mensalidade). Depois, valor cheio.`
        : pm.tipo === 'isento' ? `${C.nomeMes(ini)[0].toUpperCase() + C.nomeMes(ini).slice(1)} não é cobrado. Depois, valor cheio.` : pm.tipo === 'metade' ? `${C.nomeMes(ini)[0].toUpperCase() + C.nomeMes(ini).slice(1)} sai pela metade. Depois, valor cheio.` : `Só em ${C.nomeMes(ini)}. Depois, valor cheio.`; };
    const prev = () => {
      $('afimw').hidden = $('aativa') ? $('aativa').checked : true; marcaFaixa(); verPrimeiro();
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
    $('anasc').addEventListener('input', () => { $('aidade').textContent = idade($('anasc').value) || '—'; verCat(); });
    function verCat() { if (!$('acat')) return; const sg = catPorNasc($('anasc').value), v = $('acat').value, n = $('acatnota');
      if (!v) { n.innerHTML = sg ? `Pela data de nascimento: <b>${esc(sg.nome)}</b>.` : $('anasc').value ? 'Nenhuma categoria pega essa data de nascimento. Confira as categorias em Ajustes.' : ''; return; }
      if (sg && sg.id !== v) { n.innerHTML = `<span style="color:var(--out)">Pela data de nascimento seria <b>${esc(sg.nome)}</b>.</span> <button type="button" class="link" id="acatusa">Usar ${esc(sg.nome)}</button>`; $('acatusa').onclick = () => { $('acat').value = ''; verCat(); }; }
      else n.textContent = 'Escolhida à mão.'; }
    if ($('acat')) { $('acat').onchange = verCat; verCat(); }
    s.querySelectorAll('input,select').forEach(el => el.addEventListener('input', prev)); sugerir(); prev();
    if (adm) {
      const toca = id => { $(id).checked = !$(id).checked; prev(); };
      $('bqirma').onclick = () => toca('adirma'); $('bqmulti').onclick = () => toca('admulti');
      s.querySelectorAll('[data-aj]').forEach(b => b.onclick = () => { const antes = $('aaj').value; $('aaj').value = b.dataset.aj; if (antes !== b.dataset.aj) $('aajn').value = ''; prev(); if (!$('aajv').hidden) $('aajn').focus(); });
      s.querySelectorAll('[data-pc]').forEach(b => b.onclick = () => { $('aajn').value = b.dataset.pc; prev(); });
      s.querySelectorAll('[data-mot]').forEach(b => b.onclick = () => { $('ajmot').value = $('ajmot').value.trim() === b.dataset.mot ? '' : b.dataset.mot; prev(); });
    }
    if ($('acob')) $('acob').onclick = () => sheetCobrancaAluna(alid);
    const voltaAl = () => sheetAluna(alid);
    s.querySelectorAll('[data-adoc]').forEach(b => b.onclick = () => abrirDe(voltaAl, () => sheetDocAluno(alid, b.dataset.adoc, voltaAl)));
    if ($('atipos')) $('atipos').onclick = () => abrirDe(voltaAl, () => sheetTiposDoc(voltaAl));
    if ($('avtermo')) $('avtermo').onclick = () => abrirDe(() => sheetAluna(alid), () => sheetVerTermo(alid));
    $('aok').onclick = async () => {
      const nome = $('anome').value.trim(), ts = [...s.querySelectorAll('[data-tu]')].filter(c => c.checked).map(c => c.dataset.tu), err = m => $('aerr').textContent = m;
      const rn = $('rnome').value.trim(), rt = $('rtel').value.trim(), rc = $('rcpf').value.trim();
      if (!nome) return err('Digite o nome do(a) aluno(a).');
      if (!idade($('anasc').value)) return err('Informe a data de nascimento do(a) aluno(a).');
      if (!rn) return err('Digite o nome do responsável.');
      if (!rc) { $('rcpf').focus(); return err('Informe o CPF do responsável. Ele é obrigatório (vai na nota fiscal).'); }
      if (!C.cpfValido(rc)) { $('rcpf').focus(); return err('Esse CPF não confere. Veja se algum número foi digitado errado.'); }
      const m = adm ? $('aaj').value : '', n = adm ? parseValor($('aajn').value) : 0;
      if (m === 'pct' && !(n > 0 && n <= 100)) return err('O desconto vai de 1 a 100%.');
      if (m === 'menos' && !(n > 0)) return err('Informe quanto abater da mensalidade, como 30,00.');
      if (m === 'valor' && !(n >= 0)) return err('Informe o valor combinado, como 120,00.');
      if (!ts.length) return err('Escolha a turma do(a) aluno(a).');
      const ativaN = $('aativa') ? $('aativa').checked : true, ini = $('aini').value || mes, fim = ativaN ? null : ($('afim').value || mesMais(mes, -1));
      if (fim && fim < ini) return err('O último mês cobrado não pode ser antes do primeiro.');
      const contava = a && a.ativa !== false && !a.anonimizadoEm && C.ativaNoMes(a, mesHoje()), lim = S.plano ? planoAtual() : null;
      if (ativaN && !contava && ini <= mesHoje() && lim && !C.cabePlano(lim, ativosPlano() + 1)) return limitePlanoNoForm($('aerr'), () => $('aok').click());
      $('aok').disabled = true;
      try {
        const id = alid || novoId(), ops = []; let r = rid;
        if (r) ops.push({ op: 'merge', p: `escolas/${S.eid}/responsaveis/${r}`, d: { nome: rn, telefone: rt, cpf: rc, endereco: $('rend').value.trim() } });
        else { r = novoId(); const cod = novoCodigo(); ops.push({ op: 'set', p: `escolas/${S.eid}/responsaveis/${r}`, d: { nome: rn, telefone: rt, cpf: rc, endereco: $('rend').value.trim(), codigo: cod, criadoEm: Date.now() } }, { op: 'set', p: 'codigos/' + cod, d: { eid: S.eid, rid: r } }); }
        ops.push({ op: 'set', p: `escolas/${S.eid}/alunas/${id}`, d: { ...(a || {}), nome, responsavelId: r, nascimento: $('anasc').value || null, ...($('acat') ? { categoria: $('acat').value || null } : {}), turmas: ts, desc: descAtual(), ...(adm ? { descIrmaOk: $('adirma').checked, descMultiOk: $('admulti').checked } : {}), inicio: ini, fim, ...(primeiroMes() !== undefined ? { primeiroMes: primeiroMes() } : {}),
          // aluno novo depois do vencimento do mês: a primeira mensalidade vence em 3 dias, sem multa
          ...(!ed && C.vencMens(ini, S.cfg) < hoje() ? { vencPrimeiro: new Date(Date.now() + 3 * 864e5 - 3 * 36e5).toISOString().slice(0, 10) } : {}), ativa: ativaN, ...(a ? {} : { cadastradaPor: S.prof ? 'professora' : 'administracao' }) } });
        if (S.docs[id] && S.docs[id].responsavelId !== r) ops.push({ op: 'merge', p: `escolas/${S.eid}/docsAlunos/${id}`, d: { responsavelId: r } });
        for (const [g, G] of Object.entries(S.grupos)) { const tem = (G.alunas || []).includes(id); if (tem !== meusG.has(g)) ops.push({ op: 'merge', p: `escolas/${S.eid}/grupos/${g}`, d: { alunas: meusG.has(g) ? [...(G.alunas || []), id] : (G.alunas || []).filter(x => x !== id) } }); }
        if (novaFoto) ops.push({ op: 'set', p: `escolas/${S.eid}/fotosAlunos/${id}`, d: { foto: novaFoto, responsavelId: r, em: Date.now(), por: 'escola' } });
        // aluno novo: taxa de matrícula (uma cobrança extra só dele, vence em 3 dias)
        if ($('amat') && $('amat').checked) { const d7 = new Date(Date.now() + 3 * 864e5 - 3 * 36e5).toISOString().slice(0, 10);
          ops.push({ op: 'set', p: `escolas/${S.eid}/extras/${novoId()}`, d: { tipo: 'taxa', matricula: true, nome: 'Taxa de matrícula', v: C.r2(S.cfg.matricula.valor), venc: d7, alunas: [id], valores: {}, grupos: [], turmas: [], recebedor: 'escola', nota: false, criadoEm: Date.now() } }); }
        await B.lote(ops); if (novaFoto) FOTOS[id] = novaFoto; fecharSheet(); aviso(ed ? 'Aluno(a) atualizado(a)' : 'Aluno(a) cadastrado(a)');
      } catch (e) { err(msgErro(e)); $('aok').disabled = false; }
    };
    if ($('aanon')) $('aanon').onclick = () => confirmarApagar([alid], null);
    if ($('adel')) $('adel').onclick = () => {
      const p = S.pags[alid] || {};
      if (Object.keys(p.mens || {}).length || Object.keys(p.extras || {}).length) return $('aerr').textContent = 'Este(a) aluno(a) tem pagamentos registrados. Para sair, desmarque "Aluno(a) ativo(a)"; o histórico fica guardado. Se a família pediu, use "Apagar dados pessoais".';
      confirmar('Excluir aluno(a)?', `${esc(a.nome)} sai da escola e das cobranças.${S.docs[alid] ? ' Os documentos guardados também são apagados.' : ''}`, 'Excluir', async () => B.lote([{ op: 'del', p: `escolas/${S.eid}/alunas/${alid}` }, ...opsApagarDocs(alid), ...(await B.meus(`escolas/${S.eid}/notasAlunos`, 'alid', alid).catch(() => [])).map(nid => ({ op: 'del', p: `escolas/${S.eid}/notasAlunos/${nid}` }))]));
    };
  });
}


/* ================= Perfil do aluno, notas da equipe e busca ================= */
// Notas: escolas/{eid}/notasAlunos/{nid} = { alid, texto, tag, autorUid, autorNome, em, editadoEm }
// Só a equipe da escola vê (as famílias não). Quem escreveu edita; a administração pode apagar.
const TAGS_NOTA = [['desempenho', 'Desempenho', '#2F6FB5'], ['comportamento', 'Comportamento', '#8A5A2B'], ['saude', 'Saúde', '#B23B2B'], ['familia', 'Família', '#2B8A6B'], ['outro', 'Outro', '#6B6B6B']];
const tagNota = k => TAGS_NOTA.find(t => t[0] === k) || null;
const dataHoraTxt = ms => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${pad(d.getHours())}h${pad(d.getMinutes())}`; };
const meuNome = () => (S.prof && (S.profs[S.prof] || {}).nome) || EU.nome || EU.email || 'Equipe';
// pendências de um aluno (para o perfil e para os filtros da busca)
function pendenciasAluno(alid) {
  const a = S.alunas[alid] || {}, mes = mesHoje(), ativo = C.ativaNoMes(a, mes) && !a.anonimizadoEm;
  const venc = S.admin ? itensDe(alid).filter(i => !i.pago && st(i) === 'vencido') : [];
  const docs = S.admin ? tiposDoc().map(T => [T, situacaoDoc(docDe(alid, T.id)).st]).filter(([, s]) => s !== 'ok') : [];
  return { ativo, atraso: venc.length ? venc.reduce((s, i) => s + (Number(i.v) || 0), 0) : 0, nAtraso: venc.length, termo: ativo && termoDe(alid).st !== 'ok', docs,
    docRuim: docs.some(([, s]) => s === 'vencido' || s === 'vence'), docFalta: docs.some(([, s]) => s === 'falta'),
    aniver: !!(a.nascimento && a.nascimento.slice(5, 7) === mes.slice(5, 7)) };
}
const categoriaTxt = a => a && /^\d{4}/.test(a.nascimento || '') ? `Categoria ${a.nascimento.slice(0, 4)}` : 'Sem data de nascimento';

// perfil (professor): a saúde do aluno, do termo de matrícula, para a aula ser segura
function saudeProfHTML(alid) {
  const x = ((S.pp || {}).saude || {})[alid], cab = '<section class="psec"><div class="psec-cab"><h2>Saúde</h2></div>';
  if (!x) return `${cab}<div class="plista"><div class="plinha sub">A família ainda não preencheu o termo de matrícula. Na dúvida, fale com a escola.</div></div></section>`;
  const it = [];
  x.itens.forEach(t => it.push(['Saúde', t]));
  if (x.detalhes) it.push(['Detalhes', x.detalhes]);
  if (C.temInfo(x.alergias)) it.push(['Alergias', C.temInfo(x.alergias)]);
  if (C.temInfo(x.remedios)) it.push(['Remédios', C.temInfo(x.remedios)]);
  if (x.semPrimeiros) it.push(['Atenção', 'A família não autoriza os primeiros socorros pela escola: em caso de problema, ligue para o contato de emergência']);
  if (x.atestado) it.push(['Atestado', { ok: 'Entregue e conferido pela escola', conferir: 'Enviado; a escola ainda vai conferir', recusado: 'A escola pediu outro', falta: 'Ainda não foi entregue' }[x.atestado]]);
  const e = x.emergencia, tel = e && e.telefone ? C.soDigitos(e.telefone) : '';
  return `${cab}<div class="plista">${it.length ? it.map(([r, v]) => `<div class="plinha psaude"><span class="psaude-r">${esc(r)}</span><span class="grow">${esc(v)}</span></div>`).join('') : '<div class="plinha sub">No termo, tudo "não": nada de saúde a observar.</div>'}
    ${e ? `<div class="plinha psaude"><span class="psaude-r">Emergência</span><span class="grow">${esc(e.nome)}${e.parentesco ? ` (${esc(e.parentesco)})` : ''}${tel ? ` · <a href="tel:${esc(tel)}" class="num">${esc(foneBR(e.telefone) || e.telefone)}</a>` : ''}</span></div>` : ''}</div>
    <span class="s" style="display:block;margin-top:6px">Dados de saúde são sigilosos: use só para cuidar do aluno na aula.</span></section>`;
}
// perfil (escola): o que o termo de matrícula tem de diferente de "não" (o que a equipe precisa saber)
const SAUDE_CURTA = C.SAUDE_CURTA;
function saudePerfilHTML(alid) {
  const x = termoDe(alid), t = x.t;
  const cab = `<section class="psec"><div class="psec-cab"><h2>Saúde</h2>${x.st === 'ok' ? `<button type="button" class="pacao" data-psaude="${esc(alid)}">Ver termo</button>` : ''}</div>`;
  if (!t) return `${cab}<div class="plista"><div class="plinha sub">O termo de matrícula ainda não foi preenchido pela família.</div></div></section>`;
  const it = [];
  PERGUNTAS_SAUDE.forEach(([k]) => { if ((t.respostas || {})[k]) it.push(['Saúde', SAUDE_CURTA[k]]); });
  if (t.detalhes) it.push(['Detalhes', t.detalhes]);
  if (C.temInfo(t.alergias)) it.push(['Alergias', C.temInfo(t.alergias)]);
  if (C.temInfo(t.remedios)) it.push(['Remédios', C.temInfo(t.remedios)]);
  if (t.primeirosSocorros === false) it.push(['Atenção', 'Não autoriza os primeiros socorros pela escola']);
  if (t.imagem === false) it.push(['Imagem', 'Não autoriza o uso de imagem (fotos e vídeos)']);
  if (x.atest) it.push(['Atestado', x.as === 'recusado' ? 'Atestado recusado: a família precisa mandar outro' : x.as === 'conferir' ? 'Atestado enviado: falta a escola conferir' : 'Falta o atestado médico']);
  if (x.st === 'vencido') it.push(['Termo', 'Vencido: tem mais de 1 ano']);
  return `${cab}<div class="plista">${it.length ? it.map(([r, v]) => `<div class="plinha psaude"><span class="psaude-r">${esc(r)}</span><span class="grow">${esc(v)}</span></div>`).join('')
    : '<div class="plinha sub">No termo, tudo "não": nada de saúde a observar.</div>'}</div></section>`;
}
// perfil (escola): cancelamento em andamento ou encerrado, em destaque
function blocoCancelPerfil(alid) {
  const x = dtrDe(alid); if (!x) return ''; const d = x[1];
  const txt = d.status === 'pedido' ? 'Pedido de cancelamento · falta confirmar' : d.status === 'confirmado' ? `Matrícula cancelada · último dia ${dataBR(d.ultimo)}` : `Matrícula encerrada em ${dataBR(d.ultimo)}`;
  return `<button class="faixa-resumo ${d.status === 'encerrado' ? 'neutra' : 'alerta'}" data-dtr="${esc(x[0])}" style="margin:12px 0"><span class="grow"><b>${txt}</b><span class="s">${d.status === 'confirmado' && !d.assinatura ? 'A família ainda não assinou o termo' : 'Ver o pedido e o termo'}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`;
}
function sheetPerfilAluno(alid, volta) {
  const a = S.alunas[alid]; if (!a) return;
  const eu = () => sheetPerfilAluno(alid, volta), adm = !!S.admin, prof = !!S.prof && !adm;
  const A = prof ? ((S.pp || {}).alunos || []).find(x => x.id === alid) || {} : null;
  const r = adm ? respDe(alid) : prof ? (A.resp || {}) : {};
  const ts = (prof ? A.turmas || [] : a.turmas || []).map(t => S.turmas[t]).filter(Boolean);
  const gs = prof ? A.grupos || [] : porNome(S.grupos).filter(([, G]) => (G.alunas || []).includes(alid)).map(([, G]) => G.nome);
  const wa = (adm || prof) && r.telefone ? waLink(r.telefone, prof ? `Olá, ${primeiro(r.nome || '')}! Aqui é ${primeiro(((S.profs || {})[S.prof] || {}).nome || EU.nome || '')}, professor(a) de ${primeiro(a.nome)} na ${S.escola.nome || 'escola'}.` : `Olá, ${primeiro(r.nome || '')}! Aqui é da ${S.escola.nome || 'escola'}, sobre ${primeiro(a.nome)}.`) : '';
  const cor = hexOk(S.cfg.cor) ? S.cfg.cor : COR_PADRAO;
  let filtro = '', notas = null, parar = null;
  const desenharNotas = () => {
    if (!$('pnotas')) return;
    if (!notas) { $('pnotas').innerHTML = '<div class="sub">Carregando…</div>'; return; }
    const usadas = TAGS_NOTA.filter(([k]) => notas.some(n => n.tag === k));
    $('pfilt').innerHTML = usadas.length > 1 ? [['', 'Todas'], ...usadas].map(([k, n]) => `<button type="button" class="pilula" data-nf="${k}" aria-pressed="${filtro === k}">${esc(n)}</button>`).join('') : '';
    $('pfilt').querySelectorAll('[data-nf]').forEach(b => b.onclick = () => { filtro = b.dataset.nf; desenharNotas(); });
    const lista = notas.filter(n => !filtro || n.tag === filtro);
    $('pnotas').innerHTML = lista.length ? lista.map(n => { const T = tagNota(n.tag), meu = n.autorUid === EU.uid;
      return `<article class="nota" style="--tc:${T ? T[2] : 'var(--line)'}">
        <div class="nota-cab">${T ? `<span class="nota-tag">${esc(T[1])}</span>` : ''}<span class="s">${esc(dataHoraTxt(n.em))}${n.editadoEm ? ' · editada' : ''}</span></div>
        <div class="nota-txt" data-nx>${esc(n.texto)}</div>
        <div class="nota-pe"><span class="nota-autor">${esc(n.autorNome || 'Equipe')}${n.papel === 'professor' ? ' · professor(a)' : ''}</span>${meu || adm ? `<span class="nota-acoes">${meu ? `<button type="button" class="link" data-ned="${esc(n.id)}">Editar</button>` : ''}<button type="button" class="link" data-ndel="${esc(n.id)}" style="color:var(--out)">Apagar</button></span>` : ''}</div></article>`; }).join('')
      : `<div class="empty"><b>${filtro ? 'Nenhuma nota com essa etiqueta.' : 'Nenhuma nota ainda.'}</b>${filtro ? '' : '<span>Anote o que a equipe precisa saber: evolução, comportamento, cuidados, conversas com a família. A família não vê.</span>'}</div>`;
    $('pnotas').querySelectorAll('[data-nx]').forEach(el => { if (el.scrollHeight > el.clientHeight + 4) { el.classList.add('corta'); el.onclick = () => el.classList.toggle('aberta'); } });
    $('pnotas').querySelectorAll('[data-ned]').forEach(b => b.onclick = () => abrirDe(eu, () => sheetNota(alid, notas.find(n => n.id === b.dataset.ned), eu)));
    $('pnotas').querySelectorAll('[data-ndel]').forEach(b => b.onclick = () => confirmar('Apagar esta nota?', 'Ela sai do perfil para toda a equipe.', 'Apagar', async () => {
      if (prof) await profServidor('apagarNota', { alid, id: b.dataset.ndel }); else await B.del(`escolas/${S.eid}/notasAlunos/${b.dataset.ndel}`); setTimeout(eu, 60); }));
  };
  const fotoHTML = f => f ? `<img src="${f}" alt="Foto de ${esc(a.nome)}">` : `<span class="pfoto-ini">${esc(iniciais(a.nome))}</span>`;
  sheet(`<div class="pcard" style="--pc:${esc(cor)}">
      <${adm ? 'label' : 'div'} class="pfoto ${adm ? 'pode' : ''}" id="pfoto" ${adm ? 'aria-label="Trocar a foto"' : ''}>${fotoHTML(FOTOS[alid])}${adm ? `<span class="pfoto-cam" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span><input type="file" id="pfotoarq" accept="image/*" hidden>` : ''}</${adm ? 'label' : 'div'}>
      <div class="pcard-id">
        <div class="pcard-nome">${esc(a.nome)}</div>
        ${idade(a.nascimento) ? `<div class="pcard-meta num">${esc(idade(a.nascimento))}</div>` : ''}
        ${ts.length ? `<div class="pcard-turmas">${ts.map(t => `<span>${esc(t.nome)}</span>`).join(' · ')}</div>` : ''}
        ${gs.length ? `<div class="pcard-grupos">${gs.map(g => `<span>${esc(g)}</span>`).join(' · ')}</div>` : ''}
        ${(adm || prof) && r.nome ? `<div class="pcard-resp"><span>${prof ? "Responsável: " : ""}${esc(r.nome)}</span>${wa ? `<a class="pcard-wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp de ${esc(r.nome)}">${ICO_WA}</a>` : ''}</div>` : ''}
      </div>
    </div>
    ${adm ? '<div class="pacoes"><button type="button" class="pacao" id="pedit">Editar cadastro</button><button type="button" class="pacao" id="pcob">Cobranças</button></div>' : ''}
    ${adm ? blocoCancelPerfil(alid) + blocoPendPerfil(alid) + saudePerfilHTML(alid) : prof ? saudeProfHTML(alid) : ''}${alid && (adm || prof) ? '<div id="afreq"></div>' : ''}
    ${adm ? `<section class="psec"><div class="psec-cab"><h2>Documentos</h2><button type="button" class="pacao pacao-forte" id="pnovodoc">+ Documento</button></div><div class="plista">${(() => { const ok = ctAssinado(alid), ult = ok || ctUltimo(alid); if (!ult && !ctPede()) return '';
      return `<button type="button" class="plinha" ${ult ? `data-pvct="${esc(alid)}"` : 'disabled'}><span class="grow">Contrato</span>${ok ? `<span class="chip pago">Assinado em ${dataBR(new Date(ok.em).toISOString().slice(0, 10))}</span>` : '<span class="chip vencido">Falta assinar</span>'}<span class="seta" aria-hidden="true">${ult ? '›' : ''}</span></button>`; })()}${docsDoAluno(alid).map(t => { const d = docDe(alid, t);
      return `<button type="button" class="plinha" data-adoc="${esc(t)}"><span class="grow">${esc(tipoDoc(t).nome)}</span>${chipDoc(d)}<span class="seta" aria-hidden="true">›</span></button>`; }).join('') || '<div class="plinha sub">Nenhum documento. Toque em "+ Documento".</div>'}</div></section>` : ''}
    <section class="psec"><div class="psec-cab"><h2>Notas da equipe</h2><button type="button" class="pacao pacao-forte" id="pnova">+ Nota</button></div>
      <div class="pfiltros" id="pfilt"></div>
      <div id="pnotas"></div></section>
    ${adm && !dtrDe(alid) ? `<button type="button" class="link pcancel" data-dtrnovo="${esc(alid)}">Cancelar a matrícula</button>` : ''}
    <button type="button" class="btn ghost" data-fechar>Fechar</button>`, sh => {
    if ($('afreq')) freqAlunoHTML(alid).then(h => { if ($('afreq')) $('afreq').innerHTML = h; }).catch(() => { });
    if (volta) SHEET_VOLTAR = volta;
    desenharNotas();
    if (FOTOS[alid] === undefined) fotoAluno(alid).then(f => { if (f && $('pfoto')) $('pfoto').firstElementChild.outerHTML = fotoHTML(f); });
    if (prof) profServidor('notas', { alid }).then(x => { notas = x.notas || []; desenharNotas(); }).catch(e => { if ($('pnotas')) $('pnotas').innerHTML = `<div class="sub">Não deu para carregar as notas. ${esc(msgErroTexto(e))}</div>`; });
    else parar = B.ouvirCol(`escolas/${S.eid}/notasAlunos`, docs => { notas = docs.map(d => ({ id: d.id, ...d.data })).sort((x, y) => (y.em || 0) - (x.em || 0)); desenharNotas(); },
      e => { if ($('pnotas')) $('pnotas').innerHTML = `<div class="sub">Não deu para carregar as notas. ${esc(msgErroTexto(e))}</div>`; }, ['alid', alid]);
    $('pnova').onclick = () => abrirDe(eu, () => sheetNota(alid, null, eu));
    if ($('pfotoarq')) $('pfotoarq').onchange = async e => { const arq = e.target.files[0]; e.target.value = ''; if (!arq) return;
      try { const f = await fotoQuadrada(arq); if (!f) return; await B.set(`escolas/${S.eid}/fotosAlunos/${alid}`, { foto: f, responsavelId: a.responsavelId || null, em: Date.now() }); FOTOS[alid] = f; $('pfoto').firstElementChild.outerHTML = fotoHTML(f); aviso('Foto salva'); agendar(); }
      catch (er) { aviso(msgErro(er)); } };
    if ($('pedit')) $('pedit').onclick = () => abrirDe(eu, () => sheetAluna(alid));
    if ($('pcob')) $('pcob').onclick = () => abrirDe(eu, () => sheetCobrancaAluna(alid));
    sh.querySelectorAll('[data-adoc]').forEach(b => b.onclick = () => abrirDe(eu, () => sheetDocAluno(alid, b.dataset.adoc, eu)));
    if ($('pnovodoc')) $('pnovodoc').onclick = () => abrirDe(eu, () => sheetDocAluno(alid, null, eu));
    sh.querySelectorAll('[data-pvct]').forEach(b => b.onclick = () => abrirDe(eu, () => sheetVerContrato(alid)));
    sh.querySelectorAll('[data-psaude]').forEach(b => b.onclick = () => abrirDe(eu, () => sheetVerTermo(alid)));
    sh.querySelectorAll('[data-ppa]').forEach(b => b.onclick = () => { const k = b.dataset.ppa; abrirDe(eu, () => k === 'at' ? sheetEnviarAtestado(alid, { volta: eu }) : sheetDocAluno(alid, k.slice(2), eu)); });
    if ($('ppcop')) $('ppcop').onclick = () => { const m = msgPendencias([alid]); if (m) copiar(m.txt, 'Mensagem copiada. Cole no WhatsApp ou onde quiser.'); };
  }, () => { if (parar) parar(); });
}

function sheetNota(alid, n, volta) {
  const a = S.alunas[alid] || {}; let tag = (n && n.tag) || '';
  sheet(`<h3>${n ? 'Editar nota' : 'Nova nota'}</h3><div class="sub">${esc(a.nome || '')}</div>
    <div class="field"><span class="lb">Etiqueta (opcional)</span><div class="opcoes" id="ntags">${TAGS_NOTA.map(([k, nm, c]) => `<button type="button" class="pick tag-pick" data-tg="${k}" style="--tc:${c}" aria-pressed="${tag === k}">${esc(nm)}</button>`).join('')}</div></div>
    <div class="field"><label for="ntxt">Nota</label><textarea id="ntxt" rows="6" maxlength="2000" placeholder="Ex.: Melhorou muito no passe. Precisa trabalhar o chute de perna esquerda.">${esc((n && n.texto) || '')}</textarea><span class="sub num" id="nconta"></span></div>
    <div class="note">Fica salva com o seu nome (${esc(meuNome())}) e a data. Só a equipe da escola vê; a família não.</div>
    <div class="err" id="nerr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn" id="nok">Salvar nota</button></div>`, sh => {
    if (volta) SHEET_VOLTAR = volta;
    const conta = () => { const k = $('ntxt').value.length; $('nconta').textContent = k > 1500 ? `${k} de 2000` : ''; };
    $('ntxt').oninput = conta; conta(); if (!n) setTimeout(() => $('ntxt').focus(), 50);
    sh.querySelectorAll('[data-tg]').forEach(b => b.onclick = () => { tag = tag === b.dataset.tg ? '' : b.dataset.tg; sh.querySelectorAll('[data-tg]').forEach(x => x.setAttribute('aria-pressed', x.dataset.tg === tag)); });
    $('nok').onclick = async () => {
      const texto = $('ntxt').value.trim(); if (!texto) return $('nerr').textContent = 'Escreva a nota.';
      $('nok').disabled = true;
      try {
        if (S.prof && !S.admin) await profServidor('nota', { alid, id: n ? n.id : null, texto, tag: tag || null });
        else if (n) await B.set(`escolas/${S.eid}/notasAlunos/${n.id}`, { texto, tag: tag || null, editadoEm: Date.now() }, { merge: true });
        else await B.set(`escolas/${S.eid}/notasAlunos/${novoId()}`, { alid, texto, tag: tag || null, autorUid: EU.uid, autorNome: meuNome(), em: Date.now() });
        fecharSheet(); aviso(n ? 'Nota atualizada' : 'Nota salva'); if (volta) setTimeout(volta, 60);
      } catch (e) { $('nerr').textContent = msgErro(e); $('nok').disabled = false; }
    };
  });
}

// foto do aluno: pequena (até 360 px, ~20 KB), em escolas/{eid}/fotosAlunos/{alid}; a administração tira ou troca
const FOTOS = {}, ICO_CAM = '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
async function fotoAluno(alid) {
  if (FOTOS[alid] !== undefined) return FOTOS[alid];
  if (S.prof) return (FOTOS[alid] = ((S.pp || {}).fotos || {})[alid] || null);
  const d = await B.get(`escolas/${S.eid}/fotosAlunos/${alid}`).catch(() => null); return (FOTOS[alid] = (d && d.foto) || null);
}
// foto da criança: abre para enquadrar (arrastar e aumentar/diminuir dentro do círculo) e devolve 360x360, ou null se cancelar
async function fotoQuadrada(arq) {
  const img = await abrirImagem(arq, 1600), W = img.width, H = img.height;
  return new Promise(ok => {
    const el = document.createElement('div'); el.className = 'scan enq'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Enquadrar a foto');
    el.innerHTML = `<div class="scan-topo"><button type="button" class="scan-bt" data-e="cancela">Cancelar</button><span class="scan-tit">Enquadre a criança</span><button type="button" class="scan-bt forte" data-e="ok">Pronto</button></div>
      <div class="enq-area"><div class="enq-palco"><canvas></canvas><div class="enq-mascara" aria-hidden="true"></div></div></div>
      <div class="enq-baixo"><span class="enq-dica">Arraste para posicionar · use dois dedos ou a barra para aproximar</span>
        <div class="enq-zoom"><span aria-hidden="true">−</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Aproximar"><span aria-hidden="true">+</span></div></div>`;
    document.body.appendChild(el);
    const palco = el.querySelector('.enq-palco'), cv = el.querySelector('canvas'), zr = el.querySelector('input[type=range]');
    let S = 300, z = 1, ox = 0, oy = 0;
    const base = () => Math.max(S / W, S / H), esc = () => base() * z;
    const prender = () => { const w = W * esc(), h = H * esc(); ox = Math.min(0, Math.max(S - w, ox)); oy = Math.min(0, Math.max(S - h, oy)); };
    const desenhar = () => { const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr); cv.style.width = cv.style.height = S + 'px';
      const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, ox * dpr, oy * dpr, W * esc() * dpr, H * esc() * dpr); };
    const medir = () => { const a = el.querySelector('.enq-area'); const novo = Math.max(160, Math.floor(Math.min(a.clientWidth - 32, a.clientHeight - 16)));
      if (novo !== S) { const f = novo / S; ox *= f; oy *= f; S = novo; } palco.style.width = palco.style.height = S + 'px'; prender(); desenhar(); };
    // começa mostrando a foto inteira na largura, um pouco para cima (onde costuma estar o rosto)
    S = Math.max(160, Math.floor(Math.min(window.innerWidth - 32, window.innerHeight * 0.6)));
    ox = (S - W * esc()) / 2; oy = (S - H * esc()) * 0.3; medir();
    const aoGirar = () => medir(); window.addEventListener('resize', aoGirar);
    // aproximar mantendo fixo o ponto (px, py) do quadro
    const zoom = (nz, px = S / 2, py = S / 2) => { nz = Math.max(1, Math.min(4, nz)); const k = nz / z; ox = px - (px - ox) * k; oy = py - (py - oy) * k; z = nz; zr.value = String(z); prender(); desenhar(); };
    zr.addEventListener('input', () => zoom(Number(zr.value)));
    const dedos = new Map(); let ini = null;
    const estado = () => { const p = [...dedos.values()]; if (p.length >= 2) { const r = palco.getBoundingClientRect(); return { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), mx: (p[0].x + p[1].x) / 2 - r.left, my: (p[0].y + p[1].y) / 2 - r.top, z }; } return null; };
    palco.addEventListener('pointerdown', e => { palco.setPointerCapture(e.pointerId); dedos.set(e.pointerId, { x: e.clientX, y: e.clientY }); ini = estado(); e.preventDefault(); });
    palco.addEventListener('pointermove', e => { const a = dedos.get(e.pointerId); if (!a) return;
      if (dedos.size === 1) { ox += e.clientX - a.x; oy += e.clientY - a.y; dedos.set(e.pointerId, { x: e.clientX, y: e.clientY }); prender(); desenhar(); return; }
      dedos.set(e.pointerId, { x: e.clientX, y: e.clientY }); const agora = estado(); if (ini && agora) zoom(ini.z * agora.d / ini.d, agora.mx, agora.my); });
    const solta = e => { dedos.delete(e.pointerId); ini = estado(); };
    palco.addEventListener('pointerup', solta); palco.addEventListener('pointercancel', solta);
    palco.addEventListener('wheel', e => { e.preventDefault(); const r = palco.getBoundingClientRect(); zoom(z * (e.deltaY < 0 ? 1.08 : 0.93), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    const fechar = v => { window.removeEventListener('resize', aoGirar); el.remove(); ok(v); };
    el.querySelector('[data-e="cancela"]').onclick = () => fechar(null);
    el.querySelector('[data-e="ok"]').onclick = () => { const o = document.createElement('canvas'), k = 360 / S; o.width = o.height = 360;
      const g = o.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 360, 360); g.imageSmoothingQuality = 'high'; g.drawImage(img, ox * k, oy * k, W * esc() * k, H * esc() * k); fechar(o.toDataURL('image/jpeg', 0.82)); };
  });
}
const avatarAluno = (alid, nome, cls = '') => { const f = FOTOS[alid] || (((S && S.pp) || {}).fotos || {})[alid]; return f ? `<img class="dot dot-al foto-dot ${cls}" src="${f}" alt="">` : `<div class="dot dot-al ${cls}" ${FOTOS[alid] === undefined && !(S && S.prof) ? `data-fav="${esc(alid)}"` : ''}>${esc(iniciais(nome))}</div>`; };
// fotos das listas: busca as que aparecem na tela (uma vez cada) e redesenha quando chegam
const FOTOS_PEDIDAS = new Set();
function pedirFotos() {
  if (!S || !(S.admin || S.papel === 'f')) return;
  const ids = [...document.querySelectorAll('[data-fav]')].map(e => e.dataset.fav).filter(id => !FOTOS_PEDIDAS.has(id) && FOTOS[id] === undefined);
  if (!ids.length) return;
  ids.forEach(id => FOTOS_PEDIDAS.add(id));
  Promise.all(ids.map(id => fotoAluno(id).catch(() => null))).then(fs => { if (fs.some(Boolean)) agendar(); });
}
const chipMensal = m => !m ? '' : m.st === 'pago' ? '<span class="chip pago">Pago</span>' : m.st === 'atrasado' ? `<span class="chip vencido">Vencido ${m.venc ? esc(dataBR(m.venc)) : ''}</span>` : m.st === 'acordo' ? '<span class="chip">Em acordo</span>' : `<span class="chip aberto">Vence ${esc(dataBR(m.venc))}</span>`;

/* ---- Área do professor: o servidor monta só o que ele pode ver ---- */
async function profServidor(acao, d = {}) {
  if (!MOCK) return servidor('professor', { acao, eid: S && S.eid, ...d });
  return profMock(acao, d);
}
// no modo de teste não há servidor: faz o mesmo aqui, com os dados de exemplo
const colMock = p => new Promise(ok => { let feito = false, u = null; u = B.ouvirCol(p, docs => { if (feito) return; feito = true; ok(Object.fromEntries(docs.map(x => [x.id, x.data]))); setTimeout(() => u && u(), 0); }, () => ok({})); });
async function profMock(acao, d) {
  if (acao === 'vincular') {
    const m = (await B.get('convitesProf/' + chaveEmail(EU.email))) || {}, out = [];
    for (const c of Object.values(m)) { if (!c) continue; const P = await B.get(`escolas/${c.eid}/professoras/${c.pid}`), E = await B.get('escolas/' + c.eid);
      if (!P || !E || String(P.emailApp || '').toLowerCase() !== String(EU.email || '').toLowerCase()) continue;
      await B.set(`escolas/${c.eid}/equipe/${EU.uid}`, { pid: c.pid, email: EU.email, nome: P.nome || '', em: Date.now() });
      await B.set('users/' + EU.uid, { escolas: { [c.eid]: { nome: E.nome || 'Escola', papel: 'professora', prof: P.nome || '' } } }, { merge: true });
      out.push({ eid: c.eid, nome: E.nome || 'Escola', prof: P.nome || '' }); }
    return { escolas: out };
  }
  const p = `escolas/${S.eid}`, eq = await B.get(`${p}/equipe/${EU.uid}`); if (!eq) throw new Error('Você não é professor(a) desta escola.');
  const pid = eq.pid, P = (await B.get(`${p}/professoras/${pid}`)) || {};
  const turmas = await colMock(`${p}/turmas`), minhas = Object.keys(turmas).filter(t => C.daTurma(turmas[t], pid));
  const alunas = Object.fromEntries(Object.entries(await colMock(`${p}/alunas`)).filter(([, a]) => (a.turmas || []).some(t => minhas.includes(t))));
  if (acao === 'painel') {
    const pags = {}; for (const id of Object.keys(alunas)) pags[id] = (await B.get(`${p}/pagamentos/${id}`)) || {};
    const [extras, grupos, acordos, cfg] = await Promise.all([colMock(`${p}/extras`), colMock(`${p}/grupos`), colMock(`${p}/acordos`), B.get(`${p}/config/geral`)]);
    const mes = d.mes || mesHoje(), r = C.painelProfessor({ alunas, turmas, extras, grupos, acordos, cfg: cfg || {}, pags }, pid, mes, hoje()), fotos = {};
    const saude = {};
    for (const a of r.alunos) { const rr = await B.get(`${p}/responsaveis/${(alunas[a.id] || {}).responsavelId}`); if (rr) a.resp = { nome: rr.nome || '', telefone: rr.telefone || '' }; }
    for (const a of r.alunos) { const f = await B.get(`${p}/fotosAlunos/${a.id}`); if (f && f.foto) fotos[a.id] = f.foto; const x = C.saudeProfessor(await B.get(`${p}/saude/${a.id}`)); if (x) saude[a.id] = x; }
    const chamadas = {}; for (const c of Object.values(await colMock(`${p}/chamadas`))) if (minhas.includes(c.tid) && c.data >= somaDias(hoje(), -21)) (chamadas[c.tid] = chamadas[c.tid] || []).push(c.data);
    return { pid, nome: P.nome || '', mes, ...r, fotos, saude, chamadas, fixoEscola: Number(salDoMes(P, mes).liq) > 0 ? C.r2(Number(salDoMes(P, mes).liq)) : null, salVaria: !!P.salVaria };
  }
  if (acao === 'chamada' || acao === 'salvarChamada') {
    if (!minhas.includes(d.tid)) throw new Error('Esta turma não é sua.'); if (d.data > hoje()) throw new Error('Ainda não chegou esse dia.');
    const als = Object.entries(alunas).filter(([, a]) => (a.turmas || []).includes(d.tid) && a.ativa !== false && C.ativaNoMes(a, d.data.slice(0, 7))).map(([id, a]) => ({ id, nome: a.nome })), ref = `${p}/chamadas/${C.chaveChamada(d.tid, d.data)}`, atual = await B.get(ref);
    if (acao === 'chamada') return { alunos: als, doc: atual, recentes: Object.values(await colMock(`${p}/chamadas`)).filter(c => c.tid === d.tid && c.data !== d.data) };
    const ok = new Set(als.map(a => a.id)), pres = d.semAula ? {} : Object.fromEntries(Object.entries(d.pres || {}).filter(([id, st]) => ok.has(id) && ['p', 'f', 'j'].includes(st)));
    const quem = { uid: EU.uid, nome: P.nome || 'Professor(a)', papel: 'professor', em: Date.now() };
    await B.set(ref, { tid: d.tid, data: d.data, pres, alunos: Object.keys(pres), obs: String(d.obs || '').slice(0, 300), semAula: !!d.semAula, motivo: d.semAula ? String(d.motivo || '').slice(0, 120) : '', extra: !ehAula(turmas[d.tid], d.data), por: atual && atual.por ? atual.por : quem, editado: atual ? quem : null, hist: [...((atual || {}).hist || []), quem] }); return { ok: true };
  }
  if (acao === 'caderneta') { if (!minhas.includes(d.tid)) throw new Error('Esta turma não é sua.');
    const chs = Object.values(await colMock(`${p}/chamadas`)).filter(c => c.tid === d.tid && String(c.data).slice(0, 7) === d.mes), na = new Set(chs.flatMap(c => Object.keys(c.pres || {})));
    return { alunos: Object.entries(alunas).filter(([id, a]) => (a.turmas || []).includes(d.tid) && (na.has(id) || (a.ativa !== false && C.ativaNoMes(a, d.mes)))).map(([id, a]) => ({ id, nome: a.nome })), chamadas: chs }; }
  if (acao === 'freq') { if (!alunas[d.alid]) throw new Error('Este aluno não está nas suas turmas.');
    return { chamadas: Object.values(await colMock(`${p}/chamadas`)).filter(c => minhas.includes(c.tid) && (c.alunos || []).includes(d.alid)), turmas: Object.fromEntries(minhas.map(t => [t, { nome: (turmas[t] || {}).nome || '' }])) }; }
  if (!alunas[d.alid]) throw new Error('Este aluno não está nas suas turmas.');
  if (acao === 'notas') return { notas: Object.entries(await colMock(`${p}/notasAlunos`)).filter(([, n]) => n.alid === d.alid).map(([id, n]) => ({ id, ...n })).sort((x, y) => (y.em || 0) - (x.em || 0)) };
  if (acao === 'apagarNota') { const n = await B.get(`${p}/notasAlunos/${d.id}`); if (!n || n.autorUid !== EU.uid) throw new Error('Você só pode apagar as suas notas.'); await B.del(`${p}/notasAlunos/${d.id}`); return { ok: true }; }
  if (d.id) { const n = await B.get(`${p}/notasAlunos/${d.id}`); if (!n || n.autorUid !== EU.uid) throw new Error('Você só pode editar as suas notas.'); await B.set(`${p}/notasAlunos/${d.id}`, { texto: d.texto, tag: d.tag || null, editadoEm: Date.now() }, { merge: true }); return { ok: true }; }
  const id = novoId(); await B.set(`${p}/notasAlunos/${id}`, { alid: d.alid, texto: d.texto, tag: d.tag || null, autorUid: EU.uid, autorNome: P.nome || EU.nome || 'Professor(a)', papel: 'professor', em: Date.now() }); return { ok: true, id };
}
// ao entrar: se o e-mail da conta foi cadastrado por alguma escola como professor, a escola aparece em "Minhas escolas"
let PROF_PEND = [];
async function vincularProf() {
  if (!EU || !EU.email) return null;
  try { const r = await profServidor('vincular'); for (const e of r.escolas || []) MINHAS[e.eid] = { nome: e.nome, papel: 'professora', prof: e.prof }; PROF_PEND = r.confirmar ? r.pendentes || [] : []; return r; }
  catch (e) { return null; }
}
async function carregarPainelProf() {
  const eid = S.eid, mes = S.mes;
  try {
    const r = await profServidor('painel', { mes });
    if (!S || S.eid !== eid) return;
    S.pp = r; S.ppErro = null; S.alunas = Object.fromEntries(r.alunos.map(a => [a.id, { nome: a.nome, nascimento: a.nascimento, turmas: a.turmas, grupos: a.grupos }]));
    Object.assign(FOTOS, r.fotos || {});
    ativarPush(true).catch(() => { });
  } catch (e) { if (!S || S.eid !== eid) return; S.ppErro = msgErroTexto(e); if (e.code === 'sem-acesso') delete MINHAS[eid]; }
  agendar();
}
function ppCarregando(v) {
  if (S.pp && S.pp.mes === S.mes) return false;
  v.innerHTML = S.ppErro ? `<div class="empty"><b>Não deu para abrir.</b><span>${esc(S.ppErro)}</span><button class="btn" id="pptenta">Tentar de novo</button></div>` : '<div class="empty">Carregando…</div>';
  if ($('pptenta')) $('pptenta').onclick = () => { S.ppErro = null; render(); carregarPainelProf(); };
  return true;
}
function tPTurmas(v) {
  if (ppCarregando(v)) return;
  // o professor vê as turmas dele no mesmo cartão da escola, só para consultar (sem editar e sem valores)
  const pp = S.pp, q = semAcento((S.busca || '').trim()), ts = ordenar(S.turmas).filter(([t]) => pp.turmas.includes(t));
  const ativos = pp.alunos.filter(a => a.ativo), abertas = S.turmasAbertas = S.turmasAbertas || new Set();
  const cartao = (tid, t) => {
    const todos = ativos.filter(a => a.turmas.includes(tid)), al = todos.filter(a => !q || semAcento(a.nome).includes(q)), n = todos.length;
    if (q && !al.length) return '';
    const aberta = !!q || abertas.has(tid), nSaude = todos.filter(a => ((pp.saude || {})[a.id] || {}).alerta).length;
    const alunosTxt = `${n} aluno${n === 1 ? '' : 's'}${t.vagas ? ` · ${n >= t.vagas ? 'turma cheia' : t.vagas - n === 1 ? 'resta 1 vaga' : `restam ${t.vagas - n} vagas`}` : ''}`;
    return `<div class="local turma-card">
      <div class="hd"><div class="grow"><div class="t">${esc(t.nome)}</div></div></div>
      <div class="turma-info">${ddl([['Dias e horário', esc(t.horario || '—')], ['Local', esc(localDe(t) || '—')], ['Faixa etária', esc(C.faixaTxt(t))], ['Alunos', `<span class="num">${alunosTxt}</span>`], nSaude && ['Saúde', `<span class="saude-ic">✚</span> ${nSaude} com atenção à saúde`]])}</div>
      ${t.chamada !== false ? `<button class="mostrar" data-cham="${esc(tid)}">✓ Fazer chamada<span aria-hidden="true">›</span></button><button class="mostrar" data-cad="${esc(tid)}">▦ Caderneta de chamada<span aria-hidden="true">›</span></button>` : ''}
      <button class="mostrar" data-pabre="${esc(tid)}" aria-expanded="${aberta}">${aberta ? 'Esconder alunos' : `Mostrar alunos${n ? ` (${n})` : ''}`}<span aria-hidden="true">${aberta ? '▴' : '▾'}</span></button>
      ${aberta ? `<div class="ativ">${al.map(a => `<div class="turma" data-pal="${esc(a.id)}">${avatarAluno(a.id, a.nome, 'dot-mini')}<div class="grow"><div class="t">${esc(a.nome)}${((pp.saude || {})[a.id] || {}).alerta ? ' <span class="saude-ic" title="Atenção à saúde" aria-label="Atenção à saúde">✚</span>' : ''}</div>${linhas(esc([idade(a.nascimento), categoriaTxt(a)].filter(Boolean).join(' · ')))}</div></div>`).join('') || '<div class="sub">Nenhum aluno nesta turma ainda.</div>'}</div>` : ''}</div>`;
  };
  v.innerHTML = `${avisosChamadaProf(ts.map(([tid]) => tid))}<div class="headrow"><h2>Minhas turmas</h2></div>
    <div class="sub num">${ts.length} turma${ts.length === 1 ? '' : 's'} · ${ativos.length} aluno${ativos.length === 1 ? '' : 's'}</div>
    <div class="field"><input id="ppbusca" type="search" placeholder="Buscar aluno" aria-label="Buscar aluno" value="${esc(S.busca || '')}"></div>
    <div class="tree">${ts.map(([tid, t]) => cartao(tid, t)).join('') || (q ? '<div class="empty"><b>Nenhum aluno com esse nome.</b></div>' : '<div class="empty"><b>Nenhuma turma ainda.</b><span>A escola coloca você como professor(a) das turmas.</span></div>')}</div>
    <div class="note">Aqui você consulta as suas turmas e os alunos. Para mudar uma turma, fale com a escola. Toque no aluno para ver a saúde e escrever notas.</div>`;
  $('ppbusca').oninput = e => { S.busca = e.target.value; render(); };
  v.querySelectorAll('[data-cham]').forEach(e => e.onclick = () => sheetChamada(e.dataset.cham, e.dataset.chd || null));
  v.querySelectorAll('[data-cad]').forEach(e => e.onclick = () => sheetCaderneta(e.dataset.cad));
  if ($('pushon')) $('pushon').onclick = async () => { $('pushon').disabled = true; try { await ativarPush(false); if (MOCK) { ls.set('escolinha.push.mock', '1'); render(); } } catch (e) { aviso(msgErro(e)); $('pushon').disabled = false; } };
  v.querySelectorAll('[data-pabre]').forEach(b => b.onclick = () => { const t = b.dataset.pabre; abertas.has(t) ? abertas.delete(t) : abertas.add(t); render(); });
  v.querySelectorAll('[data-pal]').forEach(li => li.onclick = () => sheetPerfilAluno(li.dataset.pal));
}
// professor: todos os alunos das turmas dele, em ordem alfabética, só para consultar (busca, filtro por turma e saúde)
function tPAlunos(v) {
  if (ppCarregando(v)) return;
  const pp = S.pp, q = semAcento((S.buscaPA || '').trim()), f = S.paFiltro || 'todos', nomeT = id => (S.turmas[id] || {}).nome || '';
  const sau = a => ((pp.saude || {})[a.id] || {}).alerta, ativos = pp.alunos.filter(a => a.ativo).sort((x, y) => String(x.nome).localeCompare(String(y.nome), 'pt-BR'));
  const lista = ativos.filter(a => (!q || semAcento(a.nome).includes(q)) && (f === 'todos' || (f === 'saude' ? sau(a) : a.turmas.includes(f))));
  const ts = ordenar(S.turmas).filter(([t]) => pp.turmas.includes(t)), nS = ativos.filter(sau).length;
  v.innerHTML = `<div class="headrow"><h2>Alunos</h2></div>
    <div class="sub num">${ativos.length} aluno${ativos.length === 1 ? '' : 's'} nas suas turmas${nS ? ` · <span class="saude-ic">✚</span> ${nS} com atenção à saúde` : ''}</div>
    <div class="field"><input id="pabusca" type="search" placeholder="Buscar aluno" aria-label="Buscar aluno" value="${esc(S.buscaPA || '')}"></div>
    <div class="field"><select id="pafil" aria-label="Filtrar"><option value="todos">Todas as turmas</option>${nS ? `<option value="saude" ${f === 'saude' ? 'selected' : ''}>✚ Atenção à saúde</option>` : ''}${ts.map(([t, x]) => `<option value="${esc(t)}" ${f === t ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></div>
    ${lista.length ? `<ul class="list">${lista.map(a => `<li class="tap" data-pal="${esc(a.id)}">${avatarAluno(a.id, a.nome)}<div class="grow"><div class="t">${esc(a.nome)}${sau(a) ? ' <span class="saude-ic" title="Atenção à saúde" aria-label="Atenção à saúde">✚</span>' : ''}</div>${linhas(esc([idade(a.nascimento), a.turmas.filter(t => pp.turmas.includes(t)).map(nomeT).join(', ')].filter(Boolean).join(' · ')))}</div></li>`).join('')}</ul>`
      : '<div class="empty"><b>Nenhum aluno encontrado.</b><span>Confira o nome ou mude o filtro.</span></div>'}
    <div class="note">Toque no aluno para ver a saúde e escrever notas. Para mudar o cadastro, fale com a escola.</div>`;
  $('pabusca').oninput = e => { S.buscaPA = e.target.value; render(); };
  $('pafil').onchange = e => { S.paFiltro = e.target.value; render(); };
  v.querySelectorAll('[data-pal]').forEach(li => li.onclick = () => sheetPerfilAluno(li.dataset.pal));
}
function tPFin(v) {
  if (ppCarregando(v)) return;
  // só o que é dele: mensalidades das turmas em que ele recebe (parte > 0) e cobranças com parte dele
  const pp = S.pp, T = pp.totais, f = S.pfFiltro || 'todos', ativos = pp.alunos.filter(a => a.mensal && a.mensal.v > 0);
  const lista = ativos.filter(a => f === 'todos' || (f === 'pagos' ? a.mensal.st === 'pago' : a.mensal.st !== 'pago'));
  const nPag = ativos.filter(a => a.mensal.st === 'pago').length, nomeT = id => (S.turmas[id] || {}).nome || '';
  const nfP = (S.profs[S.prof] || {}).nf || {}, mostrar = !!S.pfMostrar, modo = S.pfAtr || 'todos', abre = S.pfAbre = S.pfAbre || new Set();
  const atr = pp.atr || [], porAluno = {}; atr.forEach(x => (porAluno[x.alid] = porAluno[x.alid] || []).push(x));
  const al = id => pp.alunos.find(a => a.id === id) || {}, soma = l => C.r2(l.reduce((s, x) => s + x.v, 0));
  const dividas = l => `<ul class="list pf-div">${l.map(x => `<li><div class="grow"><div class="t">${esc(x.cobranca)}</div>${linhas(`Venceu ${esc(dataBR(x.venc))}`)}</div>${valorCol(brl(x.v), '', 'out')}</li>`).join('')}</ul>`;
  const linhaAl = (id, chave) => { const l = porAluno[id] || [], k = chave + id, aberto = abre.has(k);
    return `<li class="tap pf-ab" data-pfab="${esc(k)}"><div class="grow"><div class="t">${esc(al(id).nome || l[0].aluno)}</div>${linhas(`${l.length} cobrança${l.length === 1 ? '' : 's'} em atraso`)}</div>${valorCol(brl(soma(l)), '', 'out')}<span class="pf-seta" aria-hidden="true">${aberto ? '▴' : '▾'}</span></li>${aberto ? `<li class="pf-sub">${dividas(l)}</li>` : ''}`; };
  const idsAtr = Object.keys(porAluno).sort((x, y) => String(al(x).nome || porAluno[x][0].aluno).localeCompare(String(al(y).nome || porAluno[y][0].aluno), 'pt-BR'));
  let atrHTML = '';
  if (modo === 'todos') atrHTML = `<ul class="list">${idsAtr.map(id => linhaAl(id, 'a:')).join('')}</ul>`;
  else if (modo === 'turma') { const ts = [...new Set(idsAtr.flatMap(id => al(id).turmas || []))].sort((a, b) => nomeT(a).localeCompare(nomeT(b), 'pt-BR'));
    atrHTML = `<ul class="list">${ts.map(t => { const ids = idsAtr.filter(id => (al(id).turmas || []).includes(t)), k = 't:' + t, aberto = abre.has(k);
      return `<li class="tap pf-ab" data-pfab="${esc(k)}"><div class="grow"><div class="t">${esc(nomeT(t) || 'Turma')}</div>${linhas(`${ids.length} aluno${ids.length === 1 ? '' : 's'} em atraso`)}</div>${valorCol(brl(soma(ids.flatMap(id => porAluno[id]))), '', 'out')}<span class="pf-seta" aria-hidden="true">${aberto ? '▴' : '▾'}</span></li>${aberto ? `<li class="pf-sub"><ul class="list">${ids.map(id => linhaAl(id, k + ':')).join('')}</ul></li>` : ''}`; }).join('')}</ul>`; }
  else { const meses = [...new Set(atr.map(x => String(x.venc).slice(0, 7)))].sort().reverse();
    atrHTML = meses.map(m => { const l = atr.filter(x => String(x.venc).slice(0, 7) === m).sort((a, b) => String(a.aluno).localeCompare(String(b.aluno), 'pt-BR'));
      return `<div class="pf-mes"><div class="label">${esc(nomeMesAno(m))} · <span class="num">${brl(soma(l))}</span></div><ul class="list">${l.map(x => `<li><div class="grow"><div class="t">${esc(x.aluno)}</div>${linhas(esc(x.cobranca))}</div>${valorCol(brl(x.v), '', 'out')}</li>`).join('')}</ul></div>`; }).join(''); }
  v.innerHTML = `<div class="headrow"><h2>Financeiro</h2></div>
    <div class="sub">A parte que cabe a você nas suas turmas. Quem cobra as famílias é a escola.</div>
    <button type="button" class="linha-botao" id="pnf" style="margin:10px 0"><span class="grow"><b>Minha nota fiscal</b><span class="s">${nfP.ligado ? 'Ligada: sai sozinha, no seu CNPJ' : 'Para emitir nota da sua parte, com o seu CNPJ'}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>
    <div class="pf-resumo"><div><span>Recebido</span><b class="num">${brl(T.recebido)}</b></div><div><span>A receber</span><b class="num">${brl(T.aVencer)}</b></div><div class="${T.atrasado ? 'ruim' : ''}"><span>Atrasado</span><b class="num">${brl(T.atrasado)}</b></div></div>
    ${pp.fixoEscola ? `<div class="pf-fixo"><span>Recebe da escola</span><b class="num">${brl(pp.fixoEscola)}</b><span class="s">${pp.salVaria ? 'em ' + esc(C.nomeMes(S.mes)) : 'por mês, valor fixo'}</span></div>` : ''}
    <section><h2>Mensalidades de ${esc(C.nomeMes(S.mes))}</h2>
      <div class="opcoes c3" id="pfiltro">${[['todos', `Todos (${ativos.length})`], ['pagos', `Pagaram (${nPag})`], ['faltam', `Faltam (${ativos.length - nPag})`]].map(([k, n]) => `<button type="button" class="pick" data-pff="${k}" aria-pressed="${f === k}">${n}</button>`).join('')}</div>
      <button type="button" class="btn ghost pf-mostra" id="pfmostra">${mostrar ? 'Esconder alunos' : 'Mostrar alunos'}</button>
      ${mostrar ? `<ul class="list" style="margin-top:10px">${lista.map(a => `<li class="tap" data-pal="${esc(a.id)}">${avatarAluno(a.id, a.nome)}<div class="grow"><div class="t">${esc(a.nome)}</div>${linhas(esc(a.turmas.map(nomeT).join(' · ')), a.mensal.st === 'pago' && a.mensal.d ? `Pago em ${esc(dataBR(String(a.mensal.d).slice(0, 10)))}` : '')}</div>${valorCol(brl(a.mensal.v), chipMensal(a.mensal))}</li>`).join('') || '<li><span class="sub">Ninguém aqui.</span></li>'}</ul>` : ''}</section>
    ${atr.length ? `<section><h2>Atrasados</h2>
      <div class="opcoes c3" id="pfatr">${[['todos', 'Todos'], ['turma', 'Por turma'], ['mes', 'Por mês']].map(([k, n]) => `<button type="button" class="pick" data-pfa="${k}" aria-pressed="${modo === k}">${n}</button>`).join('')}</div>
      <div style="margin-top:10px">${atrHTML}</div></section>` : ''}
    <div class="note">Aparece só o que é seu: as mensalidades das turmas em que você recebe e as cobranças com parte sua.</div>`;
  v.querySelectorAll('[data-pff]').forEach(b => b.onclick = () => { S.pfFiltro = b.dataset.pff; S.pfMostrar = true; render(); });
  $('pfmostra').onclick = () => { S.pfMostrar = !mostrar; render(); };
  v.querySelectorAll('[data-pfa]').forEach(b => b.onclick = () => { S.pfAtr = b.dataset.pfa; S.pfAbre = new Set(); render(); });
  v.querySelectorAll('[data-pfab]').forEach(li => li.onclick = () => { const k = li.dataset.pfab; abre.has(k) ? abre.delete(k) : abre.add(k); render(); });
  if ($('pnf')) $('pnf').onclick = () => sheetNotaFiscal();
  v.querySelectorAll('[data-pal]').forEach(li => li.onclick = () => sheetPerfilAluno(li.dataset.pal));
}

// busca de aluno e responsável, com filtros
const BUSCA = { q: '', sit: 'ativos', turma: '', pend: '' };
const FILTROS_BUSCA = [['atraso', 'Mensalidade atrasada'], ['docs', 'Documento pendente'], ['termo', 'Sem termo'], ['aniver', 'Aniversário no mês']];
const semAcento = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function sheetBusca() {
  const adm = !!S.admin, filtros = FILTROS_BUSCA.filter(([k]) => adm || k === 'aniver' || k === 'termo');
  sheet(`<h3>Buscar</h3>
    <div class="field busca-campo"><input id="bq" type="search" autocomplete="off" placeholder="Nome, telefone ou CPF" aria-label="Buscar por nome do aluno ou do responsável, telefone ou CPF" value="${esc(BUSCA.q)}"></div>
    <div class="busca-filtros">
      <div class="opcoes c3" id="bsit">${[['ativos', 'Ativos'], ['inativos', 'Inativos'], ['todos', 'Todos']].map(([k, n]) => `<button type="button" class="pick" data-bs="${k}" aria-pressed="${BUSCA.sit === k}">${n}</button>`).join('')}</div>
      <select id="bturma" aria-label="Turma"><option value="">Todas as turmas</option>${ordenar(S.turmas).map(([t, T]) => `<option value="${esc(t)}" ${BUSCA.turma === t ? 'selected' : ''}>${esc(T.nome)}</option>`).join('')}<option value="_sem" ${BUSCA.turma === '_sem' ? 'selected' : ''}>Sem turma</option></select>
      <div class="opcoes" id="bpend">${filtros.map(([k, n]) => `<button type="button" class="pick" data-bp="${k}" aria-pressed="${BUSCA.pend === k}">${n}</button>`).join('')}</div>
    </div>
    <div class="sub num" id="bconta"></div>
    <div id="bres"></div>
    <button type="button" class="btn ghost" data-fechar>Fechar</button>`, sh => {
    const desenhar = () => {
      const q = semAcento(BUSCA.q.trim()), dig = C.soDigitos(BUSCA.q), mes = mesHoje();
      const bate = (id, a) => { if (!q && !dig) return true; const r = S.resps[a.responsavelId] || {};
        return semAcento(a.nome).includes(q) || (q && semAcento(r.nome).includes(q)) || (dig.length >= 3 && (C.soDigitos(r.telefone).includes(dig) || C.soDigitos(r.cpf).includes(dig))); };
      const al = porNome(S.alunas).filter(([id, a]) => {
        if (a.anonimizadoEm) return false; const at = C.ativaNoMes(a, mes) || (a.inicio && a.inicio > mes);
        if (BUSCA.sit === 'ativos' && !at) return false; if (BUSCA.sit === 'inativos' && at) return false;
        if (BUSCA.turma === '_sem' ? (a.turmas || []).some(t => S.turmas[t]) : BUSCA.turma && !(a.turmas || []).includes(BUSCA.turma)) return false;
        if (BUSCA.pend) { const P = pendenciasAluno(id); if (BUSCA.pend === 'atraso' && !P.nAtraso) return false; if (BUSCA.pend === 'docs' && !P.docRuim && !P.docFalta) return false; if (BUSCA.pend === 'termo' && !P.termo) return false; if (BUSCA.pend === 'aniver' && !P.aniver) return false; }
        return bate(id, a); });
      const marca = t => { if (!q) return esc(t); const s = semAcento(t), i = s.indexOf(q); return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)); };
      $('bconta').textContent = `${al.length} aluno${al.length === 1 ? '' : 's'}`;
      $('bres').innerHTML = al.length ? `<ul class="list">${al.slice(0, 200).map(([id, a]) => { const r = S.resps[a.responsavelId] || {}, P = BUSCA.pend ? pendenciasAluno(id) : null;
        const extra = !P ? '' : BUSCA.pend === 'atraso' ? `<span class="chip vencido">${brl(P.atraso)}</span>` : BUSCA.pend === 'aniver' ? `<span class="chip">Dia ${esc(a.nascimento.slice(8, 10))}</span>` : BUSCA.pend === 'docs' ? `<span class="chip vencido">${esc(P.docs.map(([T]) => T.nome).join(', '))}</span>` : '';
        return `<li class="tap" data-pf="${esc(id)}">${avatarAluno(id, a.nome)}<div class="grow"><div class="t">${marca(a.nome)}</div>${linhas(esc([idade(a.nascimento), turmasTxt(a) || 'Sem turma'].filter(Boolean).join(' · ')), `Resp.: ${marca(r.nome || '—')}${dig.length >= 3 && r.telefone ? ` · <span class="num">${esc(r.telefone)}</span>` : ''}`)}</div>${extra}</li>`; }).join('')}</ul>`
        : '<div class="empty"><b>Nenhum aluno encontrado.</b><span>Confira o nome ou tire algum filtro.</span></div>';
      $('bres').querySelectorAll('[data-pf]').forEach(li => li.onclick = () => abrirDe(sheetBusca, () => sheetPerfilAluno(li.dataset.pf, sheetBusca)));
    };
    $('bq').oninput = e => { BUSCA.q = e.target.value; desenhar(); };
    sh.querySelectorAll('[data-bs]').forEach(b => b.onclick = () => { BUSCA.sit = b.dataset.bs; sh.querySelectorAll('[data-bs]').forEach(x => x.setAttribute('aria-pressed', x.dataset.bs === BUSCA.sit)); desenhar(); });
    sh.querySelectorAll('[data-bp]').forEach(b => b.onclick = () => { BUSCA.pend = BUSCA.pend === b.dataset.bp ? '' : b.dataset.bp; sh.querySelectorAll('[data-bp]').forEach(x => x.setAttribute('aria-pressed', x.dataset.bp === BUSCA.pend)); desenhar(); });
    $('bturma').onchange = e => { BUSCA.turma = e.target.value; desenhar(); };
    desenhar(); if (!BUSCA.q) setTimeout(() => $('bq').focus(), 60);
  });
}

/* ================= Aviso da chamada no celular (push) =================
   Turma com chamada obrigatória: na hora da aula, os professores da turma recebem o aviso (o servidor manda, avisos.js).
   No iPhone só funciona com o app adicionado à Tela de Início (iOS 16.4 ou mais novo). */
// app das lojas (Capacitor, com o plugin do Firebase Messaging) ou site/app da tela de início (web push)
const NATIVO = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const FMN = () => NATIVO() && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseMessaging;
const PUSH_OK = () => !MOCK && (!!FMN() || ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window));
const ehIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalado = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
let SW_REG = null, PEND_CH = null;
function registrarSW() {
  if (FMN()) { FMN().addListener('notificationActionPerformed', e => { const u = ((e.notification || {}).data || {}).url; if (u) { lerLinkChamada(u); render(); } }); return; }
  if (MOCK || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(r => { SW_REG = r; }).catch(() => { });
  navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.abrir) { lerLinkChamada(e.data.abrir); render(); } });
}
// ?chamada=eid.tid (vem do toque no aviso): abre a chamada de hoje dessa turma
// links dos avisos no celular: ?chamada=eid.tid (professor), ?pagar=eid~chave (abre o pagamento daquela cobrança),
// ?evento=eid~xid (abre os eventos para responder), ?filhos=1 (pendências do cadastro)
function lerLinkChamada(url) {
  try {
    const q = new URL(url, location.href).searchParams, v = q.get('chamada'), pg = q.get('pagar'), ev = q.get('evento');
    if (v && v.includes('.')) { const [eid, tid] = v.split('.'); PEND_CH = { eid, tid }; }
    else if (pg && pg.includes('~')) { const i = pg.indexOf('~'); PEND_CH = { eid: pg.slice(0, i), k: pg.slice(i + 1) }; }
    else if (ev && ev.includes('~')) { const i = ev.indexOf('~'); PEND_CH = { eid: ev.slice(0, i), xid: ev.slice(i + 1) }; }
    else if (q.get('filhos') && S && S.eid) PEND_CH = { eid: S.eid, filhos: true };
  } catch (e) { }
}
function abrirChamadaPendente() {
  if (!PEND_CH || !S) return;
  if (S.eid !== PEND_CH.eid) { if (MINHAS[PEND_CH.eid]) { const x = PEND_CH; PEND_CH = null; abrirEscola(x.eid).then(() => { PEND_CH = x; }); } return; }
  if ($('overlay').innerHTML) return;
  if (PEND_CH.k || PEND_CH.xid || PEND_CH.filhos) {
    if (S.papel !== 'f' || !S.carregado.has('alunas')) return;
    const x = PEND_CH; PEND_CH = null;
    if (x.filhos) return irPara('filhas');
    if (x.xid) { const e = S.extras[x.xid]; return irPara(e && e.tipo === 'taxa' ? 'pagar' : 'feventos'); }
    const it = Object.keys(S.alunas).flatMap(id => itensDe(id)).find(i => i.k === x.k && !i.pago);
    irPara('pagar'); if (!it) return aviso('Esta cobrança já foi paga.');
    S.sel = new Set([it.k]); render(); return setTimeout(() => (outrasFormas() ? sheetFormas : sheetPix)([it.k]), 80);
  }
  if (!S.turmas[PEND_CH.tid]) return;
  const tid = PEND_CH.tid; PEND_CH = null; setTimeout(() => sheetChamada(tid, hoje()), 50);
}
// professor: aviso da chamada; família: avisos de vencimento, pendências e eventos (o servidor guarda o aparelho)
const pushGuardar = token => S.papel === 'f' ? servidor('familiaPush', { eid: S.eid, token }) : profServidor('push', { token });
const pushPronto = () => aviso(S.papel === 'f' ? 'Pronto! Você recebe os avisos da escola no celular.' : 'Pronto! Você recebe o aviso na hora da aula.');
async function ativarPush(silencioso) {
  if (MOCK) { if (!silencioso) aviso(S.papel === 'f' ? 'No app publicado, este celular passa a receber os avisos da escola.' : 'No app publicado, este celular passa a receber o aviso na hora da aula.'); return; }
  if (!PUSH_OK()) throw new Error('Este celular não recebe avisos do app.');
  if (FMN()) { // app das lojas: permissão e código do aparelho pelo sistema (Apple ou Android)
    const p = silencioso ? await FMN().checkPermissions() : await FMN().requestPermissions();
    if (p.receive !== 'granted') { if (silencioso) return; throw new Error('Os avisos ficaram bloqueados. Libere as notificações do Turma em Dia nas configurações do celular.'); }
    const { token } = await FMN().getToken(); const k = `escolinha.push.${S.eid}`; if (silencioso && ls.get(k) === token) return;
    await pushGuardar(token); ls.set(k, token); if (!silencioso) { pushPronto(); render(); } return;
  }
  if (silencioso && Notification.permission !== 'granted') return;
  if (!silencioso && (await Notification.requestPermission()) !== 'granted') throw new Error('Os avisos ficaram bloqueados. Libere as notificações do Turma em Dia nas configurações do celular.');
  const reg = SW_REG || await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready;
  const tk = await B.pushToken(reg); if (!tk) throw new Error('Este celular não recebe avisos do app.');
  const k = `escolinha.push.${S.eid}`; if (silencioso && ls.get(k) === tk) return;
  await pushGuardar(tk); ls.set(k, tk);
  if (!silencioso) { pushPronto(); render(); }
}
const agoraHM = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(11, 16);
const horaTxt = h => h ? (h.endsWith(':00') ? String(Number(h.slice(0, 2))) + 'h' : h.replace(':', 'h')) : '';
const chObrig = t => !!t && t.chamada !== false && !!t.chamadaObrig;
// professor: a chamada obrigatória de hoje que ainda não foi feita (depois que a aula começa; some quando um dos dois faz)
// família: convite para receber no celular os avisos de vencimento, pendências e eventos (se a escola não desligou)
let PUSH_FAM_VISTO = null;
function avisoPushFam() {
  if (S.cfg.pushFamilias === false || !Object.keys(S.alunas).length) return '';
  if (!MOCK && PUSH_FAM_VISTO !== S.eid) { PUSH_FAM_VISTO = S.eid; ativarPush(true).catch(() => { }); } // aparelho já liberado: renova o código em silêncio
  if (ls.get(`escolinha.pushfam.nao.${S.eid}`)) return '';
  const perm = FMN() ? (ls.get(`escolinha.push.${S.eid}`) ? 'granted' : 'default') : 'Notification' in window ? Notification.permission : 'x';
  const fechar = '<button type="button" class="link" id="pushfamx">Agora não</button>';
  if (!MOCK && !NATIVO() && ehIOS() && !instalado()) return `<div class="banner"><span><b>Avisos da escola no celular:</b> no iPhone, primeiro adicione o app à Tela de Início (botão Compartilhar → "Adicionar à Tela de Início"), abra por lá e ative.</span>${fechar}</div>`;
  if (!MOCK && perm === 'denied') return '';
  if (MOCK ? !ls.get('escolinha.push.mock') : (PUSH_OK() && perm !== 'granted')) return `<div class="banner"><span><b>Receba os avisos da escola no celular</b>: vencimentos, documentos que faltam e eventos.</span><span class="banner-bts"><button id="pushfam">Ativar</button>${fechar}</span></div>`;
  return '';
}
function avisosChamadaProf(tids) {
  const h = hoje(), ag = agoraHM(), feitas = (S.pp && S.pp.chamadas) || {};
  const pend = tids.map(tid => [tid, S.turmas[tid]]).filter(([tid, t]) => chObrig(t) && horaNoDia(t, h) && ehAula(t, h) && ag >= horaNoDia(t, h) && !(feitas[tid] || []).includes(h));
  let out = pend.map(([tid, t]) => `<button class="faixa-resumo alerta" data-cham="${esc(tid)}"><span class="grow"><b>Fazer chamada: ${esc(t.nome)}</b><span class="s">Hoje · a aula começou às ${esc(horaTxt(horaNoDia(t, h)))}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`).join('');
  // convite para receber o aviso no celular (só quem tem turma com chamada obrigatória)
  if (tids.some(tid => chObrig(S.turmas[tid]))) {
    const perm = FMN() ? (ls.get(`escolinha.push.${S.eid}`) ? 'granted' : 'default') : 'Notification' in window ? Notification.permission : 'x';
    if (!MOCK && !NATIVO() && ehIOS() && !instalado()) out += `<div class="banner"><span><b>Aviso da chamada no celular:</b> no iPhone, primeiro adicione o app à Tela de Início (botão Compartilhar → "Adicionar à Tela de Início"), abra por lá e ative.</span></div>`;
    else if (!MOCK && perm === 'denied') out += `<div class="banner"><span><b>Os avisos estão bloqueados.</b> Para receber o aviso da chamada na hora da aula, libere as notificações do Turma em Dia nas configurações do celular.</span></div>`;
    else if (MOCK ? !ls.get('escolinha.push.mock') : (PUSH_OK() && perm !== 'granted')) out += `<div class="banner"><span><b>Receba o aviso da chamada no celular</b>, na hora em que a aula começa.</span><button id="pushon">Ativar</button></div>`;
  }
  return out;
}

/* ================= Chamada (presença) =================
   Um registro por turma e dia (chamadas/{tid}_{data}). A escola grava direto; o professor, pelo servidor.
   Fica registrado quem fez (por) e quem mudou depois (editado, hist). A família não vê. */
const diaSem = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
const diaLongo = iso => { const x = new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); return x[0].toUpperCase() + x.slice(1); };
const ehAula = (t, iso) => !((t && t.dias) || []).length || t.dias.includes(diaSem(iso));
function passoAula(t, iso, dir) { for (let i = 1; i <= 14; i++) { const d = somaDias(iso, dir * i); if (ehAula(t, d)) return d; } return somaDias(iso, dir); }
const ultimaAula = t => ehAula(t, hoje()) ? hoje() : passoAula(t, hoje(), -1);
const quemTxt = q => q ? `${esc(q.nome || '')} (${q.papel === 'professor' ? 'professor(a)' : 'escola'}) em ${dataBR(new Date(q.em - 3 * 36e5).toISOString().slice(0, 10))} às ${new Date(q.em - 3 * 36e5).toISOString().slice(11, 16).replace(':', 'h')}` : '';
async function chamadaDados(tid, data) {
  if (!S.admin) return profServidor('chamada', { tid, data });
  const alunos = alunasDaTurma(tid, data.slice(0, 7)).filter(([, a]) => a.ativa !== false && !a.anonimizadoEm).map(([id, a]) => ({ id, nome: a.nome }));
  const [doc, rec] = await Promise.all([B.get(`escolas/${S.eid}/chamadas/${C.chaveChamada(tid, data)}`), B.onde(`escolas/${S.eid}/chamadas`, 'data', '>=', somaDias(hoje(), -120))]);
  return { alunos, doc, recentes: rec.map(x => x.data).filter(c => c.tid === tid && c.data !== data) };
}
async function chamadaSalvar(tid, data, pres, obs, atual, mais = {}) {
  if (!S.admin) return profServidor('salvarChamada', { tid, data, pres, obs, ...mais });
  const quem = { uid: EU.uid, nome: (S.eu && S.eu.nome) || EU.nome || EU.email || 'Escola', papel: 'escola', em: Date.now() };
  await B.set(`escolas/${S.eid}/chamadas/${C.chaveChamada(tid, data)}`, { tid, data, pres, alunos: Object.keys(pres), obs: String(obs || '').trim().slice(0, 300), semAula: !!mais.semAula, motivo: mais.motivo || '', extra: !ehAula(S.turmas[tid], data), por: atual && atual.por ? atual.por : quem, editado: atual ? quem : null, hist: [...((atual || {}).hist || []).slice(-30), quem] });
}
// rascunho da chamada no aparelho: se a pessoa sair do app no meio, as marcações voltam quando abrir de novo
const RASC_CH = (tid, data) => `chRasc_${S.eid}_${tid}_${data}`;
const lerRasc = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const gravarRasc = (k, v) => { try { v ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k); } catch (e) { } };
function sheetChamada(tid, data) {
  const t = S.turmas[tid]; if (!t) return;
  data = data || ultimaAula(t);
  const casca = h => `<h3>Chamada · ${esc(t.nome)}</h3>${h}`;
  sheet(casca('<div class="empty">Carregando…</div>'));
  chamadaDados(tid, data).then(D => {
    D.alunos.sort((x, y) => String(x.nome).localeCompare(String(y.nome), 'pt-BR', { sensitivity: 'base' })); // ordem alfabética
    const k = RASC_CH(tid, data), rasc = lerRasc(k), doc = D.doc || {};
    const pres = { ...(rasc ? rasc.pres : doc.pres || {}) };
    let semAula = rasc ? !!rasc.semAula : !!doc.semAula, sujo = !!rasc, saindo = null;
    const ant = passoAula(t, data, -1), prox = passoAula(t, data, 1), extra = !ehAula(t, data);
    const seguidas = id => pres[id] === 'f' ? C.freqAluno([...D.recentes, { data, pres }], id).seguidas : 0;
    const mexeu = () => { sujo = true; gravarRasc(k, { pres, semAula, obs: $('chobs') ? $('chobs').value : '' }); };
    // sair com marcações sem salvar: pergunta antes (fechar, trocar de dia, voltar)
    const sair = depois => { if (!sujo) return false; saindo = depois; $('chsair').hidden = false; $('chsair').scrollIntoView({ block: 'center', behavior: 'smooth' }); return true; };
    const irPara = d => { if (!sair(() => sheetChamada(tid, d))) sheetChamada(tid, d); };
    const desenhar = () => {
      $('chcorpo').hidden = semAula; $('chsem').setAttribute('aria-pressed', String(semAula)); $('chsemw').hidden = !semAula;
      const n = st => D.alunos.filter(a => pres[a.id] === st).length, sem = D.alunos.filter(a => !pres[a.id]).length;
      $('chres').innerHTML = `<div>Presentes<b class="num">${n('p')}</b></div><div>Faltas<b class="num">${n('f') + n('j')}</b></div><div>Sem marcar<b class="num">${sem}</b></div>`;
      $('chl').innerHTML = D.alunos.map(a => { const st = pres[a.id], sg = seguidas(a.id);
        return `<li class="ch-lin"><div class="grow"><div class="t">${esc(a.nome)}</div>${st === 'j' ? '<span class="s">Falta justificada</span>' : sg >= 2 ? `<span class="s" style="color:var(--out)">${sg}ª falta seguida</span>` : ''}</div>
          <div class="ch-bt"><button type="button" data-chp="${esc(a.id)}" class="${st === 'p' ? 'p' : ''}" aria-pressed="${st === 'p'}" aria-label="Presente">P</button><button type="button" data-chf="${esc(a.id)}" class="${st === 'f' ? 'f' : st === 'j' ? 'j' : ''}" aria-pressed="${st === 'f' || st === 'j'}" aria-label="${st === 'j' ? 'Falta justificada' : 'Falta'}">${st === 'j' ? 'J' : 'F'}</button></div></li>`; }).join('') || '<li class="empty">Nenhum aluno ativo nesta turma.</li>';
      $('chl').querySelectorAll('[data-chp]').forEach(b => b.onclick = () => { pres[b.dataset.chp] = 'p'; mexeu(); desenhar(); });
      $('chl').querySelectorAll('[data-chf]').forEach(b => b.onclick = () => { const id = b.dataset.chf; pres[id] = pres[id] === 'f' ? 'j' : 'f'; mexeu(); desenhar(); });
    };
    sheet(casca(`<div class="ch-dia"><button type="button" class="icon-btn" id="chant" aria-label="Aula anterior">‹</button><span style="text-align:center"><b>${esc(diaLongo(data))}</b><span class="s" style="display:block">${extra ? '<b style="color:var(--accent)">Aula extra</b> · fora dos dias de aula' : esc([t.horario, localDe(t)].filter(Boolean).join(' · '))}</span></span><button type="button" class="icon-btn" id="chprox" aria-label="Próxima aula" ${prox > hoje() ? 'disabled' : ''}>›</button></div>
      <div class="ch-outros"><button type="button" class="ch-op" id="chsem" aria-pressed="false">Não teve aula</button><label class="ch-op">Aula extra (outro dia)<input type="date" id="chdia" max="${hoje()}" value="${esc(data)}" aria-label="Escolher o dia da aula extra"></label></div>
      ${rasc ? '<div class="banner"><span>Estas marcações ainda <b>não foram salvas</b>. Confira e toque em Salvar.</span></div>' : ''}
      ${doc.por ? `<div class="note">${doc.semAula ? 'Marcado sem aula' : 'Feita'} por ${quemTxt(doc.por)}.${doc.editado ? ` Mudada por ${quemTxt(doc.editado)}.` : ''}</div>` : ''}
      <div id="chsemw" hidden><div class="field"><label for="chmot">Por que não teve aula? (opcional)</label><input id="chmot" maxlength="120" value="${esc((rasc ? rasc.motivo : doc.motivo) || '')}" placeholder="Ex.: feriado, chuva, professor doente"></div>
        <span class="s">Esse dia não conta na frequência de ninguém.</span></div>
      <div id="chcorpo">
        <div class="ch-res" id="chres"></div>
        <button type="button" class="btn ghost" id="chtodos" style="width:100%;margin-top:12px">Marcar todos presentes</button>
        <span class="s" style="display:block;margin:8px 0">Toque em F de novo para virar J (falta justificada).</span>
        <ul class="list" id="chl"></ul>
        <div class="field" style="margin-top:12px"><label for="chobs">Observação da aula (opcional)</label><input id="chobs" maxlength="300" value="${esc((rasc ? rasc.obs : doc.obs) || '')}" placeholder="Ex.: treino de saltos; aula na quadra 2"></div>
      </div>
      <div class="err" id="cherr" role="alert"></div>
      <div class="ch-sair" id="chsair" hidden><b>Sair sem salvar?</b><span>As marcações desta chamada ficam guardadas só neste aparelho até você salvar.</span>
        <div class="actions"><button type="button" class="btn ghost" id="chsfica">Continuar a chamada</button><button type="button" class="btn danger" id="chsvai">Sair sem salvar</button></div></div>
      <div class="actions"><button class="btn ghost" data-fechar>Fechar</button><button class="btn" id="chok">Salvar</button></div>`), () => {
      desenhar();
      sair.sujo = () => sujo; SHEET_SAIR = sair;
      $('chant').onclick = () => irPara(ant);
      $('chprox').onclick = () => prox <= hoje() && irPara(prox);
      $('chdia').onchange = e => { const d = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d <= hoje() && d !== data) irPara(d); };
      $('chsem').onclick = () => { semAula = !semAula; mexeu(); desenhar(); };
      $('chobs').oninput = mexeu; $('chmot').oninput = () => { sujo = true; gravarRasc(k, { pres, semAula, obs: $('chobs').value, motivo: $('chmot').value }); };
      $('chsfica').onclick = () => { saindo = null; $('chsair').hidden = true; };
      $('chsvai').onclick = () => { sujo = false; const f = saindo; saindo = null; f && f(); };
      $('chtodos').onclick = () => { D.alunos.forEach(a => { if (!pres[a.id]) pres[a.id] = 'p'; }); mexeu(); desenhar(); };
      $('chok').onclick = async () => {
        const sem = semAula ? 0 : D.alunos.filter(a => !pres[a.id]).length;
        if (sem) return $('cherr').textContent = `Falta marcar ${sem} aluno${sem === 1 ? '' : 's'}. Toque em P ou F, ou em "Marcar todos presentes".`;
        $('chok').disabled = true;
        try { await chamadaSalvar(tid, data, semAula ? {} : Object.fromEntries(D.alunos.map(a => [a.id, pres[a.id]])), $('chobs').value, D.doc, semAula ? { semAula: true, motivo: $('chmot').value.trim().slice(0, 120) } : { semAula: false, motivo: '' });
          sujo = false; gravarRasc(k, null);
          if (S.pp) { const c = S.pp.chamadas = S.pp.chamadas || {}; c[tid] = [...new Set([...(c[tid] || []), data])]; }
          aviso(semAula ? 'Registrado: não teve aula' : 'Chamada salva'); fecharSheet(true); render(); }
        catch (e) { $('cherr').textContent = msgErro(e); $('chok').disabled = false; } };
    });
  }).catch(e => sheet(casca(`<div class="empty"><b>Não deu para abrir a chamada.</b><span>${esc(msgErro(e))}</span></div><button class="btn ghost" data-fechar>Fechar</button>`)));
}
// frequência na ficha do aluno (escola e professor)
async function freqAlunoHTML(alid) {
  const r = S.admin ? { chamadas: (await B.onde(`escolas/${S.eid}/chamadas`, 'alunos', 'array-contains', alid)).map(x => x.data) } : await profServidor('freq', { alid });
  const L = r.chamadas || []; if (!L.length) return '';
  const mes = mesHoje(), ano = mes.slice(0, 4), tids = [...new Set(L.map(c => c.tid))];
  return tids.map(tid => { const nome = ((S.turmas[tid] || (r.turmas || {})[tid]) || {}).nome || 'Turma';
    const doT = c => c.tid === tid, fm = C.freqAluno(L, alid, c => doT(c) && c.data.slice(0, 7) === mes), fa = C.freqAluno(L, alid, c => doT(c) && c.data.slice(0, 4) === ano), tudo = C.freqAluno(L, alid, doT);
    const dias = (fm.dias.length ? fm.dias : tudo.dias.slice(-10));
    const rr = S.admin ? respDe(alid) : ((((S.pp || {}).alunos || []).find(a => a.id === alid) || {}).resp || {}), tel = rr.telefone, a = S.alunas[alid] || {};
    const wa = tudo.seguidas >= 3 && tel ? waLink(tel, `Olá, ${primeiro(rr.nome) || 'tudo bem'}! Aqui é da ${S.escola.nome || 'escola'}. Sentimos falta de ${primeiro(a.nome)} nas últimas aulas de ${nome}. Está tudo bem? Se precisar de algo, é só falar com a gente.`) : '';
    return `<div class="field"><span class="lb">Frequência · ${esc(nome)}</span>
      <div class="ch-res"><div>Este mês<b class="num">${fm.pct == null ? '—' : fm.pct + '%'}</b></div><div>Faltas no mês<b class="num">${fm.f + fm.j}</b></div><div>No ano<b class="num">${fa.pct == null ? '—' : fa.pct + '%'}</b></div></div>
      <div class="freq">${dias.map(d => `<i class="${d.st}" title="${esc(dataBR(d.data))}">${Number(d.data.slice(8))}</i>`).join('')}</div>
      <span class="s">${fm.dias.length ? 'Este mês' : 'Últimas aulas'}: verde presente, vermelho falta, amarelo justificada. A justificada também conta como falta; se quiser, a escola ou o professor muda para presente na chamada.</span>
      ${tudo.seguidas >= 3 ? `<div class="banner alerta" style="margin-top:8px;flex-wrap:nowrap"><span><b>${tudo.seguidas} faltas seguidas.</b> Vale falar com a família.</span>${wa ? `<a class="wa wa-mini" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Falar pelo WhatsApp">${ICO_WA}</a>` : ''}</div>` : ''}</div>`; }).join('');
}

// caderneta: tabela de presença da turma no mês (alunos x dias de aula), como a caderneta de chamada
async function cadernetaDados(tid, mes) {
  if (!S.admin) return profServidor('caderneta', { tid, mes });
  const chs = (await B.onde(`escolas/${S.eid}/chamadas`, 'data', '>=', mes + '-01')).map(x => x.data).filter(c => c.tid === tid && String(c.data).slice(0, 7) === mes);
  const na = new Set(chs.flatMap(c => Object.keys(c.pres || {})));
  return { chamadas: chs, alunos: Object.entries(S.alunas).filter(([id, a]) => (a.turmas || []).includes(tid) && !a.anonimizadoEm && (na.has(id) || (a.ativa !== false && C.ativaNoMes(a, mes)))).map(([id, a]) => ({ id, nome: a.nome })) };
}
// caderneta em PDF (A4), para imprimir ou mandar pelo WhatsApp (só a escola)
function cadernetaPdf(t, mes, L, al, pctDe) {
  const P = window.PdfSimples, d = P.Documento(), M = 36, larN = 150, larP = 36;
  const col = Math.min(28, (d.w - 2 * M - larN - larP) / Math.max(1, L.length)), larT = larN + col * L.length + larP, linhaH = 17;
  let y = 0, pag = 0;
  const cabec = () => {
    if (pag++) d.novaPagina();
    d.texto(M, 46, S.escola.nome || 'Escola', { tam: 9, cor: '#777777' });
    d.texto(M, 66, `Caderneta de chamada · ${t.nome}`, { tam: 16, neg: true });
    d.texto(M, 84, `${nomeMesAno(mes)}${t.horario ? ' · ' + t.horario : ''}${profNome(t) ? ' · ' + profNome(t) : ''}`, { tam: 9, cor: '#555555', max: d.w - 2 * M });
    y = 104; d.ret(M, y, larT, 26, '#f1ece4');
    d.texto(M + 6, y + 16, 'Aluno', { tam: 8, neg: true });
    L.forEach((c, i) => { const x = M + larN + col * i + col / 2; d.texto(x, y + 11, String(Number(c.data.slice(8))), { tam: 8, neg: true, alinha: 'meio' }); d.texto(x, y + 21, C.DIAS_SEM[diaSem(c.data)].slice(0, 3), { tam: 6, cor: '#777777', alinha: 'meio' }); });
    d.texto(M + larT - 6, y + 16, '%', { tam: 8, neg: true, alinha: 'dir' }); y += 26;
  };
  cabec();
  al.forEach((a, k) => {
    if (y + linhaH > d.h - 60) cabec();
    if (k % 2) d.ret(M, y, larT, linhaH, '#faf8f4');
    d.texto(M + 6, y + 12, a.nome, { tam: 8, max: larN - 10 });
    L.forEach((c, i) => { const x = M + larN + col * i + col / 2; if (c.semAula) { d.ret(M + larN + col * i, y, col, linhaH, '#ebe7e0'); return; }
      const st = (c.pres || {})[a.id]; if (st) d.texto(x, y + 12, st.toUpperCase(), { tam: 8, neg: true, alinha: 'meio', cor: st === 'p' ? '#1b7f6b' : st === 'f' ? '#b0402a' : '#9a6b00' }); });
    const p = pctDe(a.id); d.texto(M + larT - 6, y + 12, p == null ? '—' : p + '%', { tam: 8, neg: true, alinha: 'dir', cor: p != null && p < 75 ? '#b0402a' : '#222222' });
    d.linha(M, y + linhaH, M + larT, y + linhaH, '#e2ddd3'); y += linhaH;
  });
  d.texto(M, Math.min(y + 18, d.h - 40), 'P presente · F falta · J falta justificada · coluna cinza: não teve aula.', { tam: 7, cor: '#777777' });
  return d.bytes(`Caderneta ${t.nome} ${nomeMesAno(mes)}`);
}
function sheetCaderneta(tid, mes) {
  const t = S.turmas[tid]; if (!t) return; mes = mes || mesHoje();
  const titulo = `<h3>Caderneta · ${esc(t.nome)}</h3><div class="cal-topo"><button type="button" class="icon-btn" id="cdant" aria-label="Mês anterior">‹</button><h2 style="font-size:1.05rem">${esc(nomeMesAno(mes))}</h2><button type="button" class="icon-btn" id="cdprox" aria-label="Próximo mês" ${mes >= mesHoje() ? 'disabled' : ''}>›</button></div>`;
  const ligar = () => { $('cdant').onclick = () => sheetCaderneta(tid, mesMais(mes, -1)); $('cdprox').onclick = () => mes < mesHoje() && sheetCaderneta(tid, mesMais(mes, 1)); };
  sheet(titulo + '<div class="empty">Carregando…</div>', ligar);
  cadernetaDados(tid, mes).then(D => {
    const L = (D.chamadas || []).sort((a, b) => String(a.data).localeCompare(b.data)), aulas = L.filter(c => !c.semAula);
    const al = (D.alunos || []).sort((x, y) => String(x.nome).localeCompare(String(y.nome), 'pt-BR', { sensitivity: 'base' }));
    const pctDe = id => { const f = C.freqAluno(aulas, id); return f.pct; }, sem = L.length - aulas.length;
    const medias = al.map(a => pctDe(a.id)).filter(x => x != null), media = medias.length ? Math.round(medias.reduce((s, x) => s + x, 0) / medias.length) : null;
    const dsem = d => C.DIAS_SEM[diaSem(d)].slice(0, 3);
    const corpo = !L.length ? `<div class="empty"><b>Nenhuma chamada em ${esc(C.nomeMes(mes))}.</b><span>As chamadas feitas aparecem aqui, uma coluna por aula.</span></div>`
      : `<div class="ch-res"><div>Aulas<b class="num">${aulas.length}</b></div><div>Presença média<b class="num">${media == null ? '—' : media + '%'}</b></div><div>Sem aula<b class="num">${sem}</b></div></div>
      <div class="cad-wrap"><table class="cad">
        <thead><tr><th class="cad-nome">Aluno</th>${L.map(c => `<th class="${c.semAula ? 'cad-sem' : ''}${c.extra ? ' cad-extra' : ''}" data-cdd="${esc(c.data)}" title="${esc(c.semAula ? 'Não teve aula' + (c.motivo ? ': ' + c.motivo : '') : c.extra ? 'Aula extra' : '')}"><b class="num">${Number(c.data.slice(8))}</b><span>${dsem(c.data)}</span></th>`).join('')}<th class="cad-pct">%</th></tr></thead>
        <tbody>${al.map(a => { const p = pctDe(a.id);
          return `<tr><td class="cad-nome">${esc(a.nome)}</td>${L.map(c => { const st = c.semAula ? '' : (c.pres || {})[a.id]; return `<td class="${c.semAula ? 'cad-sem' : ''}">${st ? `<i class="${st}">${st.toUpperCase()}</i>` : c.semAula ? '' : '<span class="cad-vazio">·</span>'}</td>`; }).join('')}<td class="cad-pct num ${p != null && p < 75 ? 'baixa' : ''}">${p == null ? '—' : p + '%'}</td></tr>`; }).join('')}</tbody>
        <tfoot><tr><td class="cad-nome">Presentes</td>${L.map(c => `<td class="num ${c.semAula ? 'cad-sem' : ''}">${c.semAula ? '' : Object.values(c.pres || {}).filter(x => x === 'p').length}</td>`).join('')}<td></td></tr></tfoot>
      </table></div>
      <span class="s">P presente · F falta · J falta justificada. Coluna cinza: não teve aula. Toque no dia para abrir a chamada. Em vermelho, presença abaixo de 75%.</span>`;
    sheet(titulo + corpo + (S.admin && L.length ? '<button class="btn ghost" id="cdver" style="width:100%;margin-top:10px">Visualizar o PDF</button><div class="actions"><button class="btn ghost" data-fechar>Fechar</button><button class="btn" id="cdpdf">Baixar PDF</button></div>' : '<button class="btn ghost" data-fechar style="width:100%">Fechar</button>'), sh => {
      ligar();
      if ($('cdver')) $('cdver').onclick = () => { try { verPdf(cadernetaPdf(t, mes, L, al, pctDe), `Caderneta ${t.nome}.pdf`); } catch (e) { aviso(msgErro(e)); } };
      if ($('cdpdf')) $('cdpdf').onclick = async () => { try { const r = await salvarArquivo(`Caderneta ${t.nome} ${nomeMesAno(mes)}.pdf`.replace(/[\\/:*?"<>|]/g, '-'), cadernetaPdf(t, mes, L, al, pctDe), 'application/pdf'); if (r === 'baixado') aviso('PDF baixado'); } catch (e) { aviso(msgErro(e)); } };
      sh.querySelectorAll('[data-cdd]').forEach(th => th.onclick = () => abrirDe(() => sheetCaderneta(tid, mes), () => sheetChamada(tid, th.dataset.cdd)));
    });
  }).catch(e => sheet(titulo + `<div class="empty"><b>Não deu para abrir a caderneta.</b><span>${esc(msgErro(e))}</span></div><button class="btn ghost" data-fechar>Fechar</button>`, ligar));
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
    ${t.chamada !== false ? `<button class="mostrar" data-cham="${esc(tid)}">✓ Fazer chamada<span aria-hidden="true">›</span></button><button class="mostrar" data-cad="${esc(tid)}">▦ Caderneta de chamada<span aria-hidden="true">›</span></button>` : ''}
    <button class="mostrar" data-abre="${esc(tid)}" aria-expanded="${aberta}">${aberta ? 'Esconder alunos' : `Mostrar alunos${n ? ` (${n})` : ''}`}<span aria-hidden="true">${aberta ? '▴' : '▾'}</span></button>
    ${aberta ? `<div class="ativ">${al.map(x => { const [id, a] = x;
      return `<div class="turma" data-al="${esc(id)}">${avatarAluno(id, a.nome, 'dot-mini')}<div class="grow"><div class="t">${esc(a.nome)}</div>${linhas(esc(idade(a.nascimento) || 'Sem data de nascimento'), respDe(id).nome ? 'Responsável: ' + esc(respDe(id).nome) : '')}</div>${fora(x) ? '<span class="chip vencido">Faixa etária</span>' : ''}</div>`; }).join('') || '<div class="sub">Nenhum aluno nesta turma ainda.</div>'}
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
  const prof = S.prof, turmas = ordenar(S.turmas).filter(([, t]) => !prof || C.daTurma(t, prof));
  const mud = mudancasFaixa().filter(m => !prof || C.daTurma(S.turmas[m.tid], prof));
  const meu = prof ? porRecebedor(mesHoje())[prof] || { esp: 0, rec: 0 } : null, P = prof ? S.profs[prof] || {} : null;
  v.innerHTML = `${prof ? `<div class="hero"><div class="headrow" style="align-items:flex-end"><div><div class="label">Recebido por você em ${esc(C.nomeMes(mesHoje()))}</div><div class="big num">${brl(meu.rec)}</div></div><div style="text-align:right"><div class="label">Previsto</div><div class="num" style="font-weight:800">${brl(meu.esp)}</div></div></div>
      ${P.mpConectadoEm ? '<div class="sub">Os Pix que a escola direciona para você caem direto na sua conta do Mercado Pago.</div>' : '<div class="banner"><span>Seu Mercado Pago ainda não está ligado.</span><button id="pligar">Ligar agora</button></div>'}</div>` : ''}
    ${mud.length ? blocoFaixa(mud) : ''}
    <section><div class="headrow"><h2>${prof ? 'Minhas turmas' : 'Turmas'}</h2>${S.admin ? '<button class="add" id="tnov">+ Turma</button>' : ''}</div>
      ${turmas.length ? `<div class="tree">${turmas.map(([tid, t]) => cartaoTurma(tid, t)).join('')}</div>`
        : `<div class="empty">${prof ? 'Nenhuma turma está com você ainda. A administração escolhe o(a) professor(a) de cada turma.' : '<b>Nenhuma turma ainda.</b><span>Cadastre as turmas uma a uma: nome, faixa etária, professor(a), local, valor e horário. Depois cadastre os alunos dentro de cada turma.</span>'}</div>`}
    </section>
    ${S.admin ? `<section><div class="headrow"><h2>Professores</h2><button class="add" id="pnov">+ Professor(a)</button></div>
      ${Object.keys(S.profs).length ? `<ul class="list">${porNome(S.profs).map(([pid, P]) => { const ts = Object.values(S.turmas).filter(t => C.daTurma(t, pid)).map(t => t.nome); return `<li class="tap" data-pr="${esc(pid)}"><div class="grow"><div class="t">${esc(P.nome)}</div><div class="s">${esc(ts.join(', ') || 'Sem turma')}</div></div><span class="chip ${P.mpConectadoEm ? 'pago' : 'aberto'}">${P.mpConectadoEm ? 'Pix ligado' : 'Pix não ligado'}</span></li>`; }).join('')}</ul>` : '<div class="note">Cadastre os professores para escolher quem dá cada turma.</div>'}
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
  v.querySelectorAll('[data-cham]').forEach(e => e.onclick = () => sheetChamada(e.dataset.cham));
  v.querySelectorAll('[data-cad]').forEach(e => e.onclick = () => sheetCaderneta(e.dataset.cad));
  v.querySelectorAll('[data-abre]').forEach(b => b.onclick = () => { S.turmasAbertas = S.turmasAbertas || new Set(); const k = b.dataset.abre; S.turmasAbertas.has(k) ? S.turmasAbertas.delete(k) : S.turmasAbertas.add(k); render(); });
  v.querySelectorAll('[data-al]').forEach(e => e.onclick = () => S.admin ? sheetPerfilAluno(e.dataset.al) : sheetAluna(e.dataset.al));
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
// no modo de teste não há servidor: faz o que o servidor faz quando a escola muda o e-mail do professor
async function espelhoProfMock(pid, antes, depois) {
  const k = `${S.eid}_${pid}`;
  if (antes) { await B.set('convitesProf/' + chaveEmail(antes), { [k]: null }, { merge: true });
    for (const uid of await B.meus(`escolas/${S.eid}/equipe`, 'pid', pid).catch(() => [])) { await B.del(`escolas/${S.eid}/equipe/${uid}`); await B.set('users/' + uid, { escolas: { [S.eid]: null } }, { merge: true }); } }
  if (depois) await B.set('convitesProf/' + chaveEmail(depois), { [k]: { eid: S.eid, pid, em: Date.now() } }, { merge: true });
}
function sheetProf(pid) {
  const P = pid ? S.profs[pid] : null, n = pid ? Object.values(S.turmas).filter(t => C.daTurma(t, pid)).length : 0;
  sheetSimples({ titulo: P ? 'Editar professor(a)' : 'Novo(a) professor(a)',
    campos: `<div class="field"><label for="pnome">Nome</label><input id="pnome" maxlength="60" value="${esc(P ? P.nome : '')}"></div>
      <div class="field"><label for="ptel">WhatsApp</label><input id="ptel" inputmode="tel" maxlength="20" value="${esc(P ? P.telefone || '' : '')}" placeholder="(81) 99999-9999"></div>
      <div class="sal-quadro">
        <label class="liga"><span class="grow"><b>Pagamento ao professor</b><span class="s">A escola paga um salário a ele(a)</span></span><input type="checkbox" role="switch" id="psal" ${P && (P.salVaria || P.fixoEscola) ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>
        <div id="psalw">
          <label class="sal-op"><span class="grow"><b>Salário fixo</b><span class="s">O mesmo valor todo mês</span></span><input type="radio" name="pstipo" id="psfixo" value="fixo" ${P && P.salVaria ? '' : 'checked'}></label>
          <label class="sal-op"><span class="grow"><b>Salário variável</b><span class="s">Muda a cada mês (comissão, dias)</span></span><input type="radio" name="pstipo" value="varia" ${P && P.salVaria ? 'checked' : ''}></label>
          <div id="psfixw"><div class="two"><div class="field"><label for="pfixo">Salário líquido</label><input id="pfixo" inputmode="decimal" value="${esc(P && P.fixoEscola ? fmtValor(P.fixoEscola) : '')}" placeholder="0,00"></div>
        <div class="field"><label for="psimp">Impostos e encargos</label><input id="psimp" inputmode="decimal" value="${esc(P && P.salImpostos ? fmtValor(P.salImpostos) : '')}" placeholder="0,00"></div></div>
        <div class="field"><label for="psben">Benefícios</label><input id="psben" inputmode="decimal" value="${esc(P && P.salBeneficios ? fmtValor(P.salBeneficios) : '')}" placeholder="Vale-transporte, alimentação…"></div>
        <div class="sal-calc num" id="pscalc"></div></div>
          <span class="sub" id="psfixs"></span>
          <span class="sub">O professor vê só o salário líquido. Impostos, benefícios e o custo total ficam só com a escola.</span></div></div>
      <div class="field"><label for="pemail">E-mail para entrar no app</label><input id="pemail" type="email" inputmode="email" autocomplete="off" autocapitalize="none" maxlength="120" value="${esc(P ? P.emailApp || '' : '')}" placeholder="email@exemplo.com">
        ${P && P.emailApp ? `<span class="sub">${P.appEm ? `Já entrou no app em ${esc(dataCurta(P.appEm))}.` : 'Ainda não entrou no app.'}</span>` : ''}
        <span class="sub">Com o e-mail, ele(a) entra no app e vê só as turmas dele(a): escreve notas sobre os alunos e acompanha os pagamentos que cabem a ele(a). Não vê telefone, CPF nem documentos das famílias, e não cobra ninguém. Para tirar o acesso, apague o e-mail.</span>
        ${P && P.emailApp && P.telefone && !P.appEm ? `<a class="btn ghost btn-ico" style="margin-top:8px" target="_blank" rel="noopener" href="${esc(waLink(P.telefone, `Olá, ${primeiro(P.nome)}! Cadastrei você no app Turma em Dia da ${S.escola.nome || 'escola'}. Abra ${LINK_APP} e entre com o e-mail ${P.emailApp}. Lá você vê as suas turmas, escreve notas sobre os alunos e acompanha os pagamentos.`))}">${ICO_WA}<span>Avisar pelo WhatsApp</span></a>` : ''}</div>
      ${P ? `<div class="field"><span class="lb">Conta que recebe o Pix</span>${blocoConta(pid, P)}</div>` : '<div class="note">Depois de salvar, você adiciona a conta que recebe o Pix.</div>'}`,
    montar: () => { const calc = () => { const v = k => parseValor($(k).value) || 0, liq = v('pfixo'), imp = v('psimp'), ben = v('psben');
        $('pscalc').innerHTML = liq || imp || ben ? `Bruto (salário + impostos): <b>${brl(C.r2(liq + imp))}</b> · Custo total: <b>${brl(C.r2(liq + imp + ben))}</b>` : ''; };
      ['pfixo', 'psimp', 'psben'].forEach(k => $(k).addEventListener('input', calc)); calc();
      const verFixo = () => { const lig = $('psal').checked, f = $('psfixo').checked; $('psalw').hidden = !lig; $('psfixw').hidden = !f;
        $('psfixs').textContent = f ? '' : 'O valor de cada mês você adiciona em Financeiro → Professores.'; $('psfixs').hidden = f; };
      $('psal').onchange = verFixo; document.querySelectorAll('.sheet [name=pstipo]').forEach(r => r.onchange = verFixo); verFixo();
      document.querySelectorAll('.sheet [data-conta]').forEach(b => b.onclick = () => abrirDe(() => sheetProf(pid), () => sheetConta(pid)));
      // professor(a) que já fez o cadastro no app: ao digitar o e-mail, os dados dele(a) preenchem o que está vazio
      $('pemail').addEventListener('change', async () => { const em = $('pemail').value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) || MOCK) return;
        try { const r = await servidor('perfilProf', { eid: S.eid, email: em }); const q = r && r.perfil; if (!q) return;
          if (!$('pnome').value.trim()) $('pnome').value = q.nome || ''; if (!$('ptel').value.trim()) $('ptel').value = q.telefone || '';
          aviso(`Achamos o cadastro de ${primeiro(q.nome) || 'quem tem esse e-mail'}`); } catch (e) { } }); },
    salvar: async () => { const nome = $('pnome').value.trim(); if (!nome) return 'Digite o nome do(a) professor(a).';
      const email = $('pemail').value.trim().toLowerCase(); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Confira o e-mail.';
      const outro = Object.entries(S.profs).find(([id, x]) => id !== pid && email && String(x.emailApp || '').toLowerCase() === email); if (outro) return `Este e-mail já está com ${outro[1].nome}.`;
      const id = pid || novoId(), antes = String((P && P.emailApp) || '').toLowerCase();
      const vv = k => parseValor($(k).value) > 0 ? C.r2(parseValor($(k).value)) : null;
      await B.set(`escolas/${S.eid}/professoras/${id}`, { nome, ...($('psal').checked ? { salVaria: !$('psfixo').checked, fixoEscola: $('psfixo').checked ? vv('pfixo') : null, salImpostos: $('psfixo').checked ? vv('psimp') : null, salBeneficios: $('psfixo').checked ? vv('psben') : null } : { salVaria: false, fixoEscola: null, salImpostos: null, salBeneficios: null }), telefone: $('ptel').value.trim(), emailApp: email || null, ...(email !== antes ? { appEm: null, appUid: null } : {}) }, { merge: true });
      if (MOCK && email !== antes) await espelhoProfMock(id, antes, email); },
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
// liga/desliga "Emitir nota fiscal" de cada turma, taxa e evento (padrão: desligado; a escola liga o que quiser)
const ligaNota = (id, on, dica) => `<label class="liga"><span class="grow"><b>Emitir nota fiscal</b><span class="s">${dica || 'Ligue se esta cobrança leva nota.'}</span></span><input type="checkbox" role="switch" id="${id}" ${on === true ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>`;
// nota da turma/taxa/evento: se o dinheiro vai para um professor, quem liga ou desliga é ele (na área dele)
const blocoNota = (id, on, dica, rec) => `<div data-notaw="${id}" ${rec && rec !== 'escola' ? 'hidden' : ''}>${ligaNota(id, on, dica)}</div><div class="note" data-notap="${id}" ${rec && rec !== 'escola' ? '' : 'hidden'} style="margin-bottom:12px">A nota fiscal desta cobrança é de quem recebe: o(a) professor(a) liga ou desliga em <b>Minha nota fiscal</b>, na área dele(a).</div>`;
const ligarBlocoNota = (id, sel) => { const s = $(sel); if (!s) return; s.addEventListener('change', () => { const p = s.value && s.value !== 'escola'; document.querySelector(`[data-notaw="${id}"]`).hidden = p; document.querySelector(`[data-notap="${id}"]`).hidden = !p; }); };
const notaSalvar = (id, sel, antes) => { const s = $(sel), rec = s ? s.value : 'escola'; return rec && rec !== 'escola' ? !!antes : $(id).checked; };
/* Horários da turma: cada horário tem os dias e o "das / até" (ex.: Seg e Qua 14h-15h; Ter e Qui 18h-19h).
   t.horarios = [{ dias: [1, 3], ini: '14:00', fim: '15:00' }]; continuam junto t.dias (todos os dias), t.hora (início do 1º)
   e t.horario (o texto que aparece nas telas e no contrato). */
const hhTxt = h => { const [a, b] = String(h || '').split(':'); return a ? `${Number(a)}h${b && b !== '00' ? b : ''}` : ''; };
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];
const juntarDias = ds => { const n = ORDEM_DIAS.filter(d => ds.includes(d)).map(d => C.DIAS_SEM[d]); return n.length > 1 ? n.slice(0, -1).join(', ') + ' e ' + n.at(-1) : n[0] || ''; };
const textoHorarios = hs => hs.filter(h => h.dias.length).map(h => `${juntarDias(h.dias)}${h.ini ? `, ${hhTxt(h.ini)}${h.fim ? ` às ${hhTxt(h.fim)}` : ''}` : ''}`).join('; ');
const horariosDe = t => t && Array.isArray(t.horarios) && t.horarios.length ? t.horarios.map(h => ({ dias: [...(h.dias || [])], ini: h.ini || '', fim: h.fim || '' }))
  : [{ dias: [...((t && t.dias) || [])], ini: (t && t.hora) || '', fim: '' }];
// início da aula no dia da semana (para a chamada): o horário que tem esse dia; sem horários, t.hora
const horaNoDia = (t, iso) => { const d = new Date(iso + 'T12:00:00').getDay(), h = (t.horarios || []).find(x => (x.dias || []).includes(d)); return h ? h.ini : t.hora; };
function camposTurmaHorarios(hs) {
  const cont = $('hors');
  const desenhar = () => {
    cont.innerHTML = hs.map((h, i) => `<div class="hor" data-h="${i}"><div class="hor-cab"><span>${hs.length > 1 ? `Horário ${i + 1}` : 'Horário'}</span>${hs.length > 1 ? `<button type="button" data-hrem="${i}">Remover</button>` : ''}</div>
      <div class="seg dias-seg">${ORDEM_DIAS.map(d => `<button type="button" data-hd="${d}" aria-pressed="${h.dias.includes(d)}">${C.DIAS_SEM[d]}</button>`).join('')}</div>
      <div class="two"><div class="field"><label>Das</label><input type="time" data-hini value="${esc(h.ini)}"></div><div class="field"><label>Até</label><input type="time" data-hfim value="${esc(h.fim)}"></div></div></div>`).join('');
    cont.querySelectorAll('.hor').forEach(el => { const h = hs[Number(el.dataset.h)];
      el.querySelectorAll('[data-hd]').forEach(b => b.onclick = () => { hs.mexeu = true; const d = Number(b.dataset.hd); h.dias = h.dias.includes(d) ? h.dias.filter(x => x !== d) : [...h.dias, d]; b.setAttribute('aria-pressed', String(h.dias.includes(d))); });
      el.querySelector('[data-hini]').onchange = e => { hs.mexeu = true; h.ini = e.target.value; }; el.querySelector('[data-hfim]').onchange = e => { hs.mexeu = true; h.fim = e.target.value; }; });
    cont.querySelectorAll('[data-hrem]').forEach(b => b.onclick = () => { hs.mexeu = true; hs.splice(Number(b.dataset.hrem), 1); desenhar(); });
  };
  desenhar();
  $('hormais').onclick = () => { hs.mexeu = true; hs.push({ dias: [], ini: '', fim: '' }); desenhar(); };
  return hs;
}
const camposHorariosHTML = () => '<div id="hors" class="hors"></div><button type="button" class="hor-mais" id="hormais">+ Acrescentar horário</button>';
// o que vai para a turma: horários válidos, todos os dias, início do primeiro e o texto
function salvarHorarios(hs, textoAntigo) {
  const ok = hs.filter(h => h.dias.length);
  if (ok.some(h => h.ini && h.fim && h.fim <= h.ini)) return { erro: 'O horário de saída tem que ser depois do de entrada.' };
  const dias = ORDEM_DIAS.filter(d => ok.some(h => h.dias.includes(d))).sort();
  return { horarios: ok.map(h => ({ dias: ORDEM_DIAS.filter(d => h.dias.includes(d)), ini: h.ini || null, fim: h.fim || null })), dias, hora: (ok.find(h => h.ini) || {}).ini || null, horario: ok.length && (hs.mexeu || !textoAntigo) ? textoHorarios(ok) : (textoAntigo || '') };
}
let HS_TURMA = [];
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
      <div class="field"><label for="tprof2">2º professor(a)</label><select id="tprof2"><option value="">Nenhum</option>${porNome(S.profs).map(([id, P]) => `<option value="${esc(id)}" ${t && (t.professoraIds || [])[0] === id ? 'selected' : ''}>${esc(P.nome)}</option>`).join('')}</select></div></div>
      <span class="s" style="margin-top:-8px">Os dois veem a turma e os alunos e fazem a chamada.</span>
      <div class="two"><div class="field"><label for="tloc">Local</label><select id="tloc"><option value="">Sem local</option>${ordenar(S.locais).map(([id, l]) => `<option value="${esc(id)}" ${t && t.localId === id ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</select></div>
      <div class="field"><label for="tpreco">Valor mensal (R$)</label><input id="tpreco" inputmode="decimal" value="${esc(fmtValor(t && t.preco))}" placeholder="0,00"></div></div>
      <div class="field"><label for="tvag">Limite de alunos (opcional)</label><input id="tvag" type="number" min="0" value="${esc(t && t.vagas ? t.vagas : '')}"></div>
      <div class="field"><span class="lb">Dias e horários</span>${camposHorariosHTML()}<span class="s">Horários diferentes em dias diferentes? Toque em "Acrescentar horário".</span></div>
      <label class="liga"><span class="grow"><b>Fazer chamada nesta turma</b><span class="s">Ligada, a turma tem o botão "Fazer chamada" para o professor e para a escola. Desligada, a turma fica sem chamada.</span></span><input type="checkbox" role="switch" id="tcham" ${!t || t.chamada !== false ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>
      <label class="liga" id="tobw"><span class="grow"><b>Chamada obrigatória</b><span class="s">Na hora da aula, o professor (e o 2º professor) vê "Fazer chamada" no app e recebe o aviso no celular. Quando um dos dois faz a chamada, o aviso some para os dois.</span></span><input type="checkbox" role="switch" id="tobrig" ${t && t.chamadaObrig ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>
      <div class="field"><label for="trec">A mensalidade vai para</label><select id="trec">${opcoesRec(t && t.recebedor)}</select>
        <div class="note">O Pix da mensalidade cai direto na conta do Mercado Pago de quem você escolher aqui.</div></div>
      ${blocoNota('tnota', !!(t && t.nota === true), 'A nota sai no nome da escola, quando o pagamento entra.', t && t.recebedor)}
      ${n ? `<div class="note">${n} aluno${n === 1 ? '' : 's'} nesta turma. Mudar o valor vale para os meses que ainda não foram pagos.</div>` : ''}`,
    montar: () => { const vob = () => { $('tobw').hidden = !$('tcham').checked; }; $('tcham').addEventListener('change', vob); vob();
      HS_TURMA = camposTurmaHorarios(horariosDe(t)); ligarBlocoNota('tnota', 'trec'); $('ttodas').onchange = e => { $('tmin').disabled = $('tmax').disabled = e.target.checked; }; if (!t) $('tprof').onchange = e => { if (e.target.value) $('trec').value = e.target.value; }; },
    salvar: async () => {
      const nome = $('tnome').value.trim(), preco = parseValor($('tpreco').value), todasN = $('ttodas').checked;
      const mn = $('tmin').value === '' ? null : Number($('tmin').value), mx = $('tmax').value === '' ? null : Number($('tmax').value);
      if (!nome) return 'Digite o nome da turma.';
      if (!todasN && mn == null && mx == null) return 'Informe a faixa etária ou marque "Todas as faixas etárias".';
      if (!todasN && mn != null && mx != null && mn > mx) return 'A idade inicial não pode ser maior que a final.';
      if (!(preco >= 0)) return 'Informe o valor mensal da turma, como 150,00.';
      const H = salvarHorarios(HS_TURMA, t && t.horario); if (H.erro) return H.erro;
      if ($('tcham').checked && $('tobrig').checked && (!H.dias.length || H.horarios.some(h => !h.ini))) return 'Para a chamada obrigatória, marque os dias de aula e o horário em que a aula começa.';
      await B.set(`escolas/${S.eid}/turmas/${novoTid}`, { ...(t || {}), nome, todasIdades: todasN, idadeMin: todasN ? null : mn, idadeMax: todasN ? null : mx, professoraId: $('tprof').value || null, professoraIds: $('tprof2').value && $('tprof2').value !== $('tprof').value ? [$('tprof2').value] : [], ...H, chamada: $('tcham').checked, chamadaObrig: $('tcham').checked && $('tobrig').checked, recebedor: $('trec').value || 'escola', localId: $('tloc').value || null, nota: notaSalvar('tnota', 'trec', t && t.nota === true), preco, vagas: Number($('tvag').value) || null, ordem: t ? t.ordem ?? 0 : Object.keys(S.turmas).length + 1 });
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
// vários arquivos de uma vez: no celular, um compartilhar só (WhatsApp, e-mail); senão baixa um por um
// abrir um PDF para ver antes de enviar (abre o leitor de PDF do celular ou do navegador)
function verPdf(bytes, nome) {
  const u = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const w = window.open(u, '_blank');
  if (!w) { const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; if (nome) a.title = nome; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(u), 120000);
}
async function salvarArquivos(arqs, tipo) {
  if (arqs.length === 1) return salvarArquivo(arqs[0].nome, arqs[0].bytes, tipo);
  try { if (window.claude && window.claude.use) { const dl = await window.claude.use('downloads'); if (dl) { for (const a of arqs) await dl.save({ filename: a.nome, data: new Blob([a.bytes], { type: tipo }) }); return 'salvo'; } } }
  catch (e) { if (e && e.code === 'declined') return 'cancelado'; }
  const fs = arqs.map(a => new File([a.bytes], a.nome, { type: tipo }));
  try { if (navigator.canShare && navigator.canShare({ files: fs })) { await navigator.share({ files: fs }); return 'compartilhado'; } } catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; }
  for (const f of fs) { const url = URL.createObjectURL(f), a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 8000); await new Promise(r => setTimeout(r, 350)); }
  return 'baixado';
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
// resumo das cobranças do mês (recebido, a vencer, vencido): fica no topo do Financeiro
function heroCobrMes(mes) {
  const h = hoje();
  const tot = { esp: 0, pix: 0, din: 0, aVencer: 0, vencido: 0 };
  for (const alid of Object.keys(S.alunas)) for (const i of itensDoMes(alid, mes)) {
    tot.esp += i.v; if (i.pago) { if (ONLINE(i.pago.via)) tot.pix += i.v; else tot.din += i.v; } else if (i.venc < h) tot.vencido += i.v; else tot.aVencer += i.v;
  }
  const rec = tot.pix + tot.din, pc = x => tot.esp ? x / tot.esp * 100 : 0, cur = brl;
  return `<div class="hero">
      <div><div class="label">Recebido em ${esc(C.nomeMes(mes))}</div><div class="big num">${cur(rec)}</div>
        <div class="sub num">de ${cur(tot.esp)} previstos${tot.esp ? ` · ${Math.round(pc(rec))}%` : ''}</div></div>
      <div class="pizza">${pizzaSVG([{ v: rec, cor: 'var(--in, #2f7d6d)' }, { v: tot.aVencer, cor: 'var(--warn, #c9962b)' }, { v: tot.vencido, cor: 'var(--out, #b0402a)' }], `Recebido ${cur(rec)}, a vencer ${cur(tot.aVencer)}, vencido ${cur(tot.vencido)}`)}
        <ul class="pizza-leg">
          <li><i class="s-in"></i><span class="grow pz-nome">Recebido</span><span class="pz-val"><b class="num">${cur(rec)}</b><span class="s num">${Math.round(pc(rec))}%</span></span></li>
          <li><i class="s-warn"></i><span class="grow pz-nome">A vencer<span class="s">no prazo</span></span><span class="pz-val"><b class="num">${cur(tot.aVencer)}</b><span class="s num">${Math.round(pc(tot.aVencer))}%</span></span></li>
          <li><i class="s-out"></i><span class="grow pz-nome">Vencido<span class="s">deste mês</span></span><span class="pz-val"><b class="num" style="color:var(--out)">${cur(tot.vencido)}</b><span class="s num">${Math.round(pc(tot.vencido))}%</span></span></li>
        </ul></div>
      <div class="sub num" style="text-align:center">Recebido pelo app ${cur(tot.pix)} · em dinheiro ${cur(tot.din)}</div>
    </div>`;
}
function tFinanceiro(v) {
  const aba = S.abaFin || 'escola';
  v.innerHTML = `${heroCobrMes(S.mes)}<div class="seg"><button data-fa="escola" aria-pressed="${aba === 'escola'}">Contas da escola</button><button data-fa="prof" aria-pressed="${aba === 'prof'}">Professores</button></div><div id="fcorpo" style="display:flex;flex-direction:column;gap:16px"></div>`;
  v.querySelectorAll('[data-fa]').forEach(b => b.onclick = () => { S.abaFin = b.dataset.fa; render(); });
  (aba === 'prof' ? finProfessoras : finEscola)($('fcorpo'));
}
// contabilidade rápida da escola: o que caiu na conta da escola, saídas e saldo
// gráfico de pizza das saídas por categoria, com a legenda (valor e %)
const CORES_PIZZA = ['#8a6a48', '#c0533a', '#2f7d6d', '#d2a03c', '#5b6f9a', '#9c5d8a', '#6f8f3a', '#b9825a', '#4f9bb0', '#7a7266'];
// fatias: [{ v, cor }]; as de valor zero não aparecem
function pizzaSVG(fatias, rotulo) {
  const L = fatias.filter(f => f.v > 0), tot = L.reduce((s, f) => s + f.v, 0), R = 46, C0 = 50;
  if (!tot) return `<svg viewBox="0 0 100 100" role="img" aria-label="${esc(rotulo)}"><circle cx="${C0}" cy="${C0}" r="${R}" fill="var(--line)"/></svg>`;
  let a0 = -Math.PI / 2;
  const ps = L.map(f => { const ang = f.v / tot * Math.PI * 2, a1 = a0 + ang;
    const d = `M${C0},${C0} L${(C0 + R * Math.cos(a0)).toFixed(2)},${(C0 + R * Math.sin(a0)).toFixed(2)} A${R},${R} 0 ${ang > Math.PI ? 1 : 0} 1 ${(C0 + R * Math.cos(a1)).toFixed(2)},${(C0 + R * Math.sin(a1)).toFixed(2)} Z`;
    a0 = a1; return L.length === 1 ? `<circle cx="${C0}" cy="${C0}" r="${R}" fill="${f.cor}"/>` : `<path d="${d}" fill="${f.cor}" stroke="var(--surface)" stroke-width="1"/>`; }).join('');
  return `<svg viewBox="0 0 100 100" role="img" aria-label="${esc(rotulo)}">${ps}</svg>`;
}
function pizzaHTML(cats) {
  const tot = cats.reduce((s, [, x]) => s + x, 0) || 1;
  return `<div class="pizza">${pizzaSVG(cats.map(([, x], i) => ({ v: x, cor: CORES_PIZZA[i % CORES_PIZZA.length] })), 'Saídas por categoria')}
    <ul class="pizza-leg">${cats.map(([c, x], i) => `<li><i style="background:${CORES_PIZZA[i % CORES_PIZZA.length]}"></i><span class="grow pz-nome">${esc(c)}</span><span class="pz-val"><b class="num">${brl(x)}</b><span class="s num">${Math.round(x / tot * 100)}%</span></span></li>`).join('')}</ul></div>`;
}
function finEscola(v) {
  const mes = S.mes, rs = recebidosNoMes(mes).filter(r => r.rec === 'escola');
  const pix = C.r2(rs.filter(r => ONLINE(r.via)).reduce((s, r) => s + r.v, 0)), din = C.r2(rs.filter(r => !ONLINE(r.via)).reduce((s, r) => s + r.v, 0));
  const ls_ = Object.entries(S.lanc).filter(([, l]) => String(l.data).slice(0, 7) === mes).sort((a, b) => String(b[1].data).localeCompare(String(a[1].data)));
  const outras = C.r2(ls_.filter(([, l]) => l.tipo === 'entrada').reduce((s, [, l]) => s + l.v, 0)), sai = C.r2(ls_.filter(([, l]) => l.tipo === 'saida').reduce((s, [, l]) => s + l.v, 0));
  const ent = C.r2(pix + din + outras), saldo = C.r2(ent - sai), conta = (S.mpc || {}).conta;
  const fx = fixasDoMes(mes), fxFalta = C.r2(fx.filter(f => !f.pago && f.f.tipo !== 'entrada').reduce((s, f) => s + f.v, 0)), fxRec = C.r2(fx.filter(f => !f.pago && f.f.tipo === 'entrada').reduce((s, f) => s + f.v, 0));
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
        ${fxFalta || fxRec ? (fxRec ? contaL('Entradas fixas a receber', '+ ' + brl(fxRec)) : '') + (fxFalta ? contaL('Despesas fixas a pagar', '− ' + brl(fxFalta), 'saida') : '') + contaL('<b>Saldo previsto</b>', `<b>${brl(C.r2(saldo - fxFalta + fxRec))}</b>`, 'total') : ''}
      </div>
      <div class="note">Só o que é da escola: o que os professores recebem direto fica na aba Professores.</div>
    </div>
    <section class="dica" style="gap:6px"><div class="headrow"><h2>Pix da escola</h2><button class="chip" id="fcfg">Editar</button></div>
      ${ddl([['Mercado Pago', S.cfg.mpConectadoEm ? `${conta ? esc(conta.nome) : 'Conta da escola'} <span class="chip pago">Conectado</span>` : '<span class="chip vencido">Não conectado</span>'], ['Documento', conta && S.cfg.mpConectadoEm ? `<span class="num">${esc(conta.doc || '')}</span>` : ''], ['Chave Pix', S.cfg.pixChave ? `<span class="num" style="user-select:all">${esc(S.cfg.pixChave)}</span>` : '—']])}
    </section>
    ${rs.length ? `<details class="dica"><summary class="headrow" style="cursor:pointer"><h2>Entradas da escola</h2><span class="sub">${rs.length} pagamento${rs.length === 1 ? '' : 's'} · ver ›</span></summary>
      <ul class="list" style="margin-top:10px">${rs.map(r => `<li><div class="grow"><div class="t">${esc(r.aluna)}</div>${linhas(esc(r.cobranca), `<span class="num">${esc(r.forma)} em ${esc(r.data)}</span>`)}</div>${valorCol(brl(r.v), '', 'in')}</li>`).join('')}</ul></details>` : ''}
    <section><h2>Para onde foi o dinheiro</h2>${cats.length ? pizzaHTML(cats) : '<div class="sub">Nenhuma saída registrada neste mês.</div>'}</section>
    ${blocoFixas(fx, mes)}
    <section><div class="headrow"><h2>Lançamentos</h2><button class="add" id="cnl">+ Lançamento</button></div>
      ${ls_.length ? `<ul class="list">${ls_.map(([id, l]) => `<li class="tap" data-l="${esc(id)}"><div class="grow"><div class="t">${esc(l.desc || l.cat)}</div>${linhas(esc(l.cat), `<span class="num">${dataBR(l.data)}${l.localId && S.locais[l.localId] ? ' · ' + esc(S.locais[l.localId].nome) : ''}</span>`)}</div>${valorCol(`${l.tipo === 'entrada' ? '+' : '−'} ${brl(l.v)}`, '', l.tipo === 'entrada' ? 'in' : 'out')}</li>`).join('')}</ul>`
        : `<div class="empty"><span>Registre aqui aluguel, salários, compra de aparelhos, inscrições, patrocínios. O que é pago pelo app entra sozinho.</span></div>`}
    </section>`;
  $('fcfg').onclick = () => sheetAjustes(); $('cnl').onclick = () => sheetLanc();
  // pendente: tocar abre o pagamento (de lá dá para editar a fixa); pago: abre a fixa
  v.querySelectorAll('[data-fx]').forEach(li => li.onclick = () => li.dataset.fxp ? sheetPagarFixa(li.dataset.fx, mes) : sheetFixa(li.dataset.fx));
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
// pagamento ao professor: o líquido (o que ele recebe, aparece para ele) e quanto a escola gasta (salário + impostos + benefícios)
// salário fixo (o mesmo todo mês) ou que varia (comissão, dias trabalhados): aí a escola põe o valor de cada mês (salMes)
const salDoMes = (P, mes) => P.salVaria ? (((P.salMes || {})[mes]) || {}) : { liq: P.fixoEscola, imp: P.salImpostos, ben: P.salBeneficios };
function custoProf(P, mes) { const x = salDoMes(P, mes), liq = Number(x.liq) || 0, imp = Number(x.imp) || 0, ben = Number(x.ben) || 0; return { liq, imp, ben, bruto: C.r2(liq + imp), total: C.r2(liq + imp + ben) }; }
function sheetSalMes(pid, mes) {
  const P = S.profs[pid] || {}, x = ((P.salMes || {})[mes]) || {};
  sheetSimples({ titulo: `${esc(primeiro(P.nome))} · ${esc(nomeMesAno(mes))}`,
    campos: `<div class="sub">Salário que varia (comissão, dias trabalhados). Valores só deste mês.</div>
      <div class="two"><div class="field"><label for="smliq">Salário líquido</label><input id="smliq" inputmode="decimal" value="${esc(x.liq ? fmtValor(x.liq) : '')}" placeholder="0,00"></div>
      <div class="field"><label for="smimp">Impostos e encargos</label><input id="smimp" inputmode="decimal" value="${esc(x.imp ? fmtValor(x.imp) : '')}" placeholder="0,00"></div></div>
      <div class="field"><label for="smben">Benefícios</label><input id="smben" inputmode="decimal" value="${esc(x.ben ? fmtValor(x.ben) : '')}" placeholder="0,00"></div>
      <div class="sal-calc num" id="smcalc"></div>`,
    montar: () => { const calc = () => { const v = k => parseValor($(k).value) || 0, l = v('smliq'), i = v('smimp'), b = v('smben'); $('smcalc').innerHTML = l || i || b ? `Bruto (salário + impostos): <b>${brl(C.r2(l + i))}</b> · Custo total: <b>${brl(C.r2(l + i + b))}</b>` : ''; };
      ['smliq', 'smimp', 'smben'].forEach(k => $(k).addEventListener('input', calc)); calc(); },
    salvar: async () => { const vv = k => parseValor($(k).value) > 0 ? C.r2(parseValor($(k).value)) : null;
      await B.set(`escolas/${S.eid}/professoras/${pid}`, { salMes: { [mes]: { liq: vv('smliq'), imp: vv('smimp'), ben: vv('smben') } } }, { merge: true }); } });
}
function blocoSalario(P, pid, mes) {
  const c = custoProf(P, mes);
  if (P.salVaria && !c.total) return `<div class="sal-box"><div class="headrow"><span class="label">Pagamento ao professor · ${esc(C.nomeMes(mes))}</span><button type="button" class="link" data-salmes="${esc(pid)}">Adicionar valores</button></div><span class="s">Salário que varia: ainda sem valor neste mês.</span></div>`;
  if (!c.total) return '';
  return `<div class="sal-box"><div class="headrow"><span class="label">Pagamento ao professor · ${P.salVaria ? esc(C.nomeMes(mes)) : 'por mês'}</span>${P.salVaria ? `<button type="button" class="link" data-salmes="${esc(pid)}">Editar</button>` : ''}</div>
    ${ddl([['Salário líquido', `<b class="num">${brl(c.liq)}</b> <span class="s">o que ele(a) recebe</span>`], ...(c.imp ? [['Impostos e encargos', `<span class="num">${brl(c.imp)}</span>`]] : []), ['Bruto (salário + impostos)', `<span class="num">${brl(c.bruto)}</span>`], ...(c.ben ? [['Benefícios', `<span class="num">${brl(c.ben)}</span>`]] : []), ['Custo total para a escola', `<b class="num">${brl(c.total)}</b>`]])}</div>`;
}
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
        ${(() => { const Rr = D.resumo, tot = C.r2(Rr.recebido + Rr.atraso + Rr.aVencer), pc = v => tot ? Math.round(v / tot * 100) : 0;
          return `<div class="pizza pz-prof">${pizzaSVG([{ v: Rr.recebido, cor: 'var(--in, #2f7d6d)' }, { v: Rr.aVencer, cor: 'var(--warn, #c9962b)' }, { v: Rr.atraso, cor: 'var(--out, #b0402a)' }], `Recebido ${brl(Rr.recebido)}, a vencer ${brl(Rr.aVencer)}, em atraso ${brl(Rr.atraso)}`)}
          <ul class="pizza-leg">
            <li><i class="s-in"></i><span class="grow pz-nome">Recebido<span class="s">${Rr.nRec} pagamento${Rr.nRec === 1 ? '' : 's'}</span></span><span class="pz-val"><b class="num">${brl(Rr.recebido)}</b><span class="s num">${pc(Rr.recebido)}%</span></span></li>
            <li><i class="s-warn"></i><span class="grow pz-nome">A vencer<span class="s">no mês</span></span><span class="pz-val"><b class="num">${brl(Rr.aVencer)}</b><span class="s num">${pc(Rr.aVencer)}%</span></span></li>
            <li><i class="s-out"></i><span class="grow pz-nome">Em atraso<span class="s">até hoje</span></span><span class="pz-val"><b class="num" style="color:var(--out)">${brl(Rr.atraso)}</b><span class="s num">${pc(Rr.atraso)}%</span></span></li>
          </ul></div>`; })()}
        ${blocoSalario(P, pid, mes)}
        ${(() => { // alunos com pagamento em atraso com este professor: um por linha, abre os débitos
          const por = {}; D.atrasados.forEach(a => (por[a.aluna] = por[a.aluna] || []).push(a)); const nomes = Object.keys(por).sort((a, b) => a.localeCompare(b, 'pt-BR'));
          return nomes.length ? `<details class="pf-atr"><summary><b>Alunos em atraso (${nomes.length})</b><span class="s num">${brl(D.resumo.atraso)} · ver ›</span></summary>
            <ul class="list">${nomes.map(n => { const l = por[n], t = C.r2(l.reduce((s, x) => s + x.v, 0));
              return `<li style="display:block"><details><summary class="pf-atr-al"><span class="grow"><b>${esc(n)}</b><span class="s">${l.length} cobrança${l.length === 1 ? '' : 's'}${l[0].resp ? ' · resp. ' + esc(l[0].resp) : ''}</span></span><b class="num" style="color:var(--out)">${brl(t)}</b></summary>
                <ul class="list pf-div">${l.map(x => `<li><div class="grow"><div class="t">${esc(x.cobranca)}</div>${linhas(`Venceu ${esc(x.venc)} · ${x.dias} dia${x.dias === 1 ? '' : 's'} de atraso`)}</div>${valorCol(brl(x.v), '', 'out')}</li>`).join('')}</ul></details></li>`; }).join('')}</ul></details>` : '<div class="sub">Nenhum aluno em atraso com este professor. 🎉</div>'; })()}
        <button class="btn wa-btn" data-envia="${esc(pid)}">${ICO_WA} Enviar relatório em PDF no WhatsApp</button>
        <div class="actions"><button class="btn ghost" data-pdf="${esc(pid)}">Baixar PDF</button><button class="btn ghost" data-txt="${esc(pid)}">Copiar resumo</button></div>
      </div>`; }).join('') : `<div class="empty"><b>Nenhum(a) professor(a) cadastrado(a).</b><span>Cadastre os professores na aba Turmas e escolha, em cada turma, para quem vai a mensalidade.</span></div>`}`;
  v.querySelectorAll('[data-envia]').forEach(b => b.onclick = () => sheetEnviarRelatorio(b.dataset.envia, mes));
  v.querySelectorAll('[data-pdf]').forEach(b => b.onclick = async () => { b.disabled = true; try { await gerarPdfProfessora(b.dataset.pdf, mes); } catch (e) { aviso('Não deu para gerar o PDF agora.'); console.warn(e); } b.disabled = false; });
  v.querySelectorAll('[data-txt]').forEach(b => b.onclick = () => copiar(textoRelatorio(b.dataset.txt, mes), 'Resumo copiado. Cole no WhatsApp do(a) professor(a).'));
  v.querySelectorAll('[data-edp]').forEach(b => b.onclick = () => sheetProf(b.dataset.edp));
  v.querySelectorAll('[data-salmes]').forEach(b => b.onclick = () => sheetSalMes(b.dataset.salmes, mes));
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
    <button type="button" class="btn ghost" id="ever">Visualizar o PDF</button>
    ${!numeroWa(P.telefone) ? `<div class="banner"><span>Cadastre o WhatsApp do(a) professor(a) para abrir a conversa direto.</span><button id="eedit">Cadastrar</button></div>` : ''}
    ${podeArquivo ? `<button class="btn wa-btn" id="eshare">${ICO_WA} Enviar PDF</button>
      <div class="note">Abre o compartilhar do celular com o PDF anexado. Escolha WhatsApp e ${esc(primeiro(P.nome))}.</div>`
      : `<div class="passos"><div class="passo"><span class="nump">1</span><div class="grow"><b>Salve o PDF</b><div class="s">Fica nos arquivos do celular ou do computador.</div></div><button class="btn" id="esave">Salvar</button></div>
        <div class="passo"><span class="nump">2</span><div class="grow"><b>Abra a conversa com ${esc(primeiro(P.nome))}</b><div class="s">O resumo já vai escrito. Toque no clipe 📎 → Documento e escolha o PDF.</div></div>${wa ? `<a class="btn wa-btn" href="${esc(wa)}" target="_blank" rel="noopener">${ICO_WA}</a>` : ''}</div></div>
      <div class="note">O WhatsApp não deixa um site anexar o arquivo sozinho numa conversa. No app publicado, no celular, este botão abre o compartilhar com o PDF já anexado.</div>`}
    <button class="btn ghost" data-fechar>Fechar</button>`, () => {
    if ($('eedit')) $('eedit').onclick = () => sheetProf(pid);
    $('ever').onclick = () => verPdf(bytes, nome);
    if ($('esave')) $('esave').onclick = async () => { const r = await salvarArquivo(nome, bytes, 'application/pdf'); if (r !== 'cancelado') { aviso('PDF salvo. Agora abra a conversa.'); $('esave').textContent = 'Salvo ✓'; } };
    if ($('eshare')) $('eshare').onclick = async () => { try { await navigator.share({ files: [arq], title: nome, text: txt }); aviso('Relatório enviado'); fecharSheet(); } catch (e) { if (e.name !== 'AbortError') aviso('Não deu para compartilhar. Use Baixar PDF.'); } };
  });
}

/* ================= Caixa (administração) ================= */
const CAT_SAI = ['Professores e equipe', 'Aluguel do espaço', 'Material esportivo', 'Uniforme e figurino', 'Competições e inscrições', 'Viagens', 'Taxas da federação', 'Material e manutenção', 'Contas (água, luz, internet)', 'Contador e impostos', 'Outros'];
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
    <section><h2>Para onde foi o dinheiro</h2>${cats.length ? pizzaHTML(cats) : '<div class="sub">Nenhuma saída registrada neste mês.</div>'}</section>
    <section><div class="headrow"><h2>Lançamentos</h2><button class="add" id="cnl">+ Lançamento</button></div>
      ${ls_.length ? `<ul class="list">${ls_.map(([id, l]) => `<li class="tap" data-l="${esc(id)}"><div class="grow"><div class="t">${esc(l.desc || l.cat)}</div><div class="s num">${dataBR(l.data)} · ${esc(l.cat)}${l.localId && S.locais[l.localId] ? ' · ' + esc(S.locais[l.localId].nome) : ''}</div></div><span class="amt num ${l.tipo === 'entrada' ? 'in' : 'out'}">${l.tipo === 'entrada' ? '+' : '−'} ${brl(l.v)}</span></li>`).join('')}</ul>`
        : `<div class="empty"><span>Registre aqui salários, aluguel, compra de aparelhos, inscrições em competições, patrocínios. Mensalidades e cobranças pagas entram sozinhas.</span></div>`}
    </section>`;
  $('cnl').onclick = () => sheetLanc();
  v.querySelectorAll('[data-l]').forEach(li => li.onclick = () => sheetLanc(li.dataset.l));
}
/* ---- Despesas fixas: aluguel, salários, internet… cadastradas uma vez e previstas em todo mês ----
   escolas/{eid}/fixas/{fid} = { desc, cat, v, dia, localId, inicio: 'AAAA-MM', fim: 'AAAA-MM' | null }.
   Pagar o mês cria o lançamento de saída fx_{fid}_{mes} (com o valor daquele mês), que entra no caixa. */
const idPagFixa = (fid, mes) => `fx_${fid}_${mes}`;
const diaFixa = (f, mes) => { const nd = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)), 0).getDate(); return `${mes}-${pad(Math.min(Number(f.dia) || 1, nd))}`; };
function fixasDoMes(mes) {
  return Object.entries(S.fixas || {}).filter(([, f]) => f && (!f.inicio || f.inicio <= mes) && (!f.fim || f.fim >= mes))
    .map(([fid, f]) => { const l = S.lanc[idPagFixa(fid, mes)]; return { fid, f, venc: diaFixa(f, mes), v: l ? l.v : f.v, pago: !!l, l }; })
    .sort((a, b) => a.venc.localeCompare(b.venc) || String(a.f.desc).localeCompare(b.f.desc));
}
function blocoFixas(fx, mes) {
  const h = hoje(), ent = x => x.f.tipo === 'entrada', soma = L => C.r2(L.reduce((s, x) => s + x.v, 0));
  const aPagar = soma(fx.filter(x => !ent(x) && !x.pago)), aReceber = soma(fx.filter(x => ent(x) && !x.pago));
  return `<section><div class="headrow"><h2>Lançamentos fixos</h2></div>
    ${fx.length ? `<div class="sub num" style="margin-bottom:8px">${[aPagar ? `<b>${brl(aPagar)} a pagar</b>` : '', aReceber ? `<b>${brl(aReceber)} a receber</b>` : '', !aPagar && !aReceber ? 'Tudo em dia neste mês' : ''].filter(Boolean).join(' · ')}</div>
      <ul class="list">${fx.map(x => `<li class="tap" data-fx="${esc(x.fid)}" data-fxp="${x.pago ? '' : '1'}"><div class="grow"><div class="t">${esc(x.f.desc || x.f.cat)}</div>${linhas(esc(x.f.cat), `<span class="num">${x.pago ? (ent(x) ? 'Recebido em ' : 'Pago em ') + dataBR(x.l.pagoEm || x.l.data) : ent(x) ? 'Previsto para ' + dataBR(x.venc) : (x.venc < h ? 'Venceu ' : 'Vence ') + dataBR(x.venc)}${x.f.fim ? ` · até ${esc(C.nomeMes(x.f.fim))}${x.f.fim.slice(0, 4) !== mes.slice(0, 4) ? ' de ' + x.f.fim.slice(0, 4) : ''}` : ''}</span>`)}</div>
        ${valorCol((ent(x) ? '+ ' : '') + brl(x.v), x.pago ? `<span class="chip pago">${ent(x) ? 'Recebido' : 'Pago'}</span>` : `<span class="fx-pend ${!ent(x) && x.venc < h ? 'atraso' : ''}">Pendente</span>`, x.pago ? (ent(x) ? 'in' : 'saida') : '')}</li>`).join('')}</ul>`
      : `<div class="empty"><span>Aluguel, salários, internet, patrocínio mensal… Ao fazer um lançamento, ligue <b>"Despesa fixa"</b> (ou "Entrada fixa") e ele aparece aqui todo mês.</span></div>`}</section>`;
}
function sheetFixa(fid) {
  const f = fid ? S.fixas[fid] : null, mes = S.mes, rec = !!f && f.tipo === 'entrada', CATS = rec ? CAT_ENT : CAT_SAI;
  sheet(`<h3>${rec ? 'Entrada fixa' : 'Despesa fixa'}</h3>
    <div class="sub">Repete todo mês, no mesmo dia${f && f.fim ? `, até ${esc(nomeMesAno(f.fim))}` : ', até cancelar'}.</div>
    <div class="field"><label for="fxdesc">Descrição</label><input id="fxdesc" maxlength="100" value="${esc(f ? f.desc || '' : '')}" placeholder="Ex.: Aluguel da quadra"></div>
    <div class="field"><label for="fxcat">Categoria</label><select id="fxcat">${CATS.map(c => `<option ${f && c === f.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="two"><div class="field"><label for="fxval">Valor por mês (R$)</label><input id="fxval" inputmode="decimal" value="${esc(fmtValor(f && f.v))}" placeholder="0,00"></div>
    <div class="field"><label for="fxdia">Vence todo dia</label><select id="fxdia">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${(f ? Number(f.dia) : 5) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div></div>
    <div class="field"><label for="fxini">Começa em</label><select id="fxini">${[...new Set([...(f && f.inicio ? [f.inicio] : []), ...Array.from({ length: 15 }, (_, i) => mesMais(mesHoje(), i - 12))])].sort().map(m => `<option value="${m}" ${(f ? f.inicio : mes) === m ? 'selected' : ''}>${esc(nomeMesAno(m))}</option>`).join('')}</select></div>
    ${f ? `<div class="note">Mudar o valor vale para os meses ainda não pagos. Para mudar só um mês, toque em Pagar e ajuste o valor daquele mês.${f.fim ? ` <b>Encerrada: a última foi ${esc(nomeMesAno(f.fim))}.</b>` : ''}</div>` : ''}
    <div class="err" id="fxerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="fxok">Salvar</button></div>
    ${f && !f.fim ? `<button class="btn ghost" id="fxfim" style="color:var(--out)">Encerrar (não repetir mais)</button>` : f ? `<button class="btn ghost" id="fxvolta">Voltar a valer todo mês</button>` : ''}`, () => {
    $('fxok').onclick = async () => {
      const v = parseValor($('fxval').value), desc = $('fxdesc').value.trim();
      if (!desc) return $('fxerr').textContent = 'Escreva a descrição, como "Aluguel da quadra".';
      if (!(v > 0)) return $('fxerr').textContent = 'Informe o valor por mês, como 1.500,00.';
      $('fxok').disabled = true;
      try { await B.set(`escolas/${S.eid}/fixas/${fid || novoId()}`, { ...(f || {}), desc, cat: $('fxcat').value, v, dia: Number($('fxdia').value), inicio: $('fxini').value, fim: f ? f.fim || null : null, criadoEm: f ? f.criadoEm || Date.now() : Date.now() }); fecharSheet(); aviso('Salvo'); }
      catch (e) { $('fxerr').textContent = msgErro(e); $('fxok').disabled = false; } };
    // encerrar: o mês atual continua se já foi pago; senão, a última é a do mês anterior
    if ($('fxfim')) $('fxfim').onclick = () => duploToque($('fxfim'), async () => { const fim = S.lanc[idPagFixa(fid, mes)] ? mes : mesMais(mes, -1);
      try { await B.set(`escolas/${S.eid}/fixas/${fid}`, { fim }, { merge: true }); fecharSheet(); aviso(`Encerrada. A última foi ${nomeMesAno(fim)}.`); } catch (e) { $('fxerr').textContent = msgErro(e); } }, 'Toque de novo para encerrar');
    if ($('fxvolta')) $('fxvolta').onclick = async () => { try { await B.set(`escolas/${S.eid}/fixas/${fid}`, { fim: null }, { merge: true }); fecharSheet(); aviso('Voltou a valer todo mês'); } catch (e) { $('fxerr').textContent = msgErro(e); } };
  });
}
// pagar a despesa fixa de um mês: vira um lançamento de saída (dá para ajustar o valor e a data só deste mês)
function sheetPagarFixa(fid, mes) {
  const f = S.fixas[fid]; if (!f) return;
  const rec = f.tipo === 'entrada';
  sheet(`<h3>${rec ? 'Receber' : 'Pagar'} · ${esc(f.desc || f.cat)}</h3><div class="sub">${esc(nomeMesAno(mes))} · ${rec ? 'previsto para' : 'vence'} ${dataBR(diaFixa(f, mes))}</div>
    <div class="two"><div class="field"><label for="pfval">Valor deste mês (R$)</label><input id="pfval" inputmode="decimal" value="${esc(fmtValor(f.v))}"></div>
    <div class="field"><label for="pfdata">${rec ? 'Recebido em' : 'Pago em'}</label><input id="pfdata" type="date" value="${esc(mes === mesHoje() ? hoje() : diaFixa(f, mes))}"></div></div>
    <div class="note">Entra nas ${rec ? 'entradas' : 'saídas'} do caixa de ${esc(C.nomeMes(mes))}. Mudar o valor aqui vale só para este mês.</div>
    <div class="err" id="pferr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="pfok">${rec ? 'Marcar como recebido' : 'Marcar como pago'}</button></div>
    <button class="btn ghost" id="pfedit">Editar ou encerrar ${rec ? 'esta entrada fixa' : 'esta despesa fixa'}</button>`, () => {
    $('pfedit').onclick = () => abrirDe(() => sheetPagarFixa(fid, mes), () => sheetFixa(fid));
    $('pfok').onclick = async () => { const v = parseValor($('pfval').value), data = $('pfdata').value;
      if (!(v > 0)) return $('pferr').textContent = rec ? 'Informe o valor recebido.' : 'Informe o valor pago.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return $('pferr').textContent = 'Escolha a data.';
      $('pfok').disabled = true;
      // o lançamento fica no mês da despesa (para o caixa daquele mês), com a data em que foi pago
      try { await B.set(`escolas/${S.eid}/lancamentos/${idPagFixa(fid, mes)}`, { tipo: rec ? 'entrada' : 'saida', cat: f.cat, desc: f.desc, v, data: data.slice(0, 7) === mes ? data : diaFixa(f, mes), pagoEm: data, fixa: fid, mes }); fecharSheet(); aviso(rec ? 'Recebido' : 'Pago'); }
      catch (e) { $('pferr').textContent = msgErro(e); $('pfok').disabled = false; } };
  });
}
function sheetLanc(id) {
  const l = id ? S.lanc[id] : null; let tipo = l ? l.tipo : 'saida';
  const opts = (tp, sel) => (tp === 'entrada' ? CAT_ENT : CAT_SAI).map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const dataPad = l ? l.data : (S.mes === mesHoje() ? hoje() : S.mes + '-01');
  sheet(`<h3>${l ? 'Editar lançamento' : 'Novo lançamento'}</h3>${l && l.fixa ? `<div class="note">Lançamento ${l.tipo === 'entrada' ? 'de uma entrada fixa. Excluir volta para "a receber"' : 'de uma despesa fixa. Excluir volta para "a pagar"'}.</div>` : ''}
    <div class="seg"><button type="button" data-t="saida" aria-pressed="${tipo === 'saida'}">Saída</button><button type="button" data-t="entrada" aria-pressed="${tipo === 'entrada'}">Entrada</button></div>
    <div class="field"><label for="lcat">Categoria</label><select id="lcat">${opts(tipo, l && l.cat)}</select></div>
    <div class="field"><label for="ldesc">Descrição</label><input id="ldesc" maxlength="100" value="${esc(l ? l.desc || '' : '')}" placeholder="Ex.: Salário do professor"></div>
    <div class="two"><div class="field"><label for="lval">Valor (R$)</label><input id="lval" inputmode="decimal" value="${esc(fmtValor(l && l.v))}" placeholder="0,00"></div>
    <div class="field" id="ldataw"><label for="ldata">Data</label><input id="ldata" type="date" value="${esc(dataPad)}"></div></div>
    ${l ? '' : `<label class="liga"><span class="grow"><b id="lfixt">Despesa fixa</b><span class="s" id="lfixs">Repete todo mês, como aluguel ou salário.</span></span><input type="checkbox" role="switch" id="lfix"><span class="trilho" aria-hidden="true"></span></label>
    <div class="two" id="lfixc" hidden><div class="field"><label for="lini">1º lançamento</label><input id="lini" type="date" value="${esc(dataPad)}"></div>
      <div class="field"><label for="lqtd">Quantos lançamentos</label><select id="lqtd"><option value="0">Até cancelar</option>${Array.from({ length: 35 }, (_, k) => `<option value="${k + 2}">${k + 2} meses</option>`).join('')}</select></div></div>
    <span class="s" id="lfixd" hidden style="margin-top:-6px">Depois do 1º, repete todo mês no mesmo dia.</span>`}
    <div class="err" id="lerr2" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="lok2">Salvar</button></div>
    ${l ? `<button class="btn ghost" id="ldel" style="color:var(--out)">Excluir lançamento</button>` : ''}`, s => {
    const fixa = () => !!($('lfix') && $('lfix').checked);
    const vfix = () => { if (!$('lfix')) return; $('lfixt').textContent = tipo === 'entrada' ? 'Entrada fixa' : 'Despesa fixa';
      $('lfixs').textContent = tipo === 'entrada' ? 'Repete todo mês, como um patrocínio mensal.' : 'Repete todo mês, como aluguel ou salário.';
      $('lfixc').hidden = $('lfixd').hidden = !fixa(); $('ldataw').hidden = fixa(); };
    if ($('lfix')) { $('lfix').onchange = vfix; vfix(); }
    s.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tipo = b.dataset.t; s.querySelectorAll('[data-t]').forEach(y => y.setAttribute('aria-pressed', y === b)); $('lcat').innerHTML = opts(tipo); vfix(); });
    $('lok2').onclick = async () => {
      const v = parseValor($('lval').value), data = fixa() ? $('lini').value : $('ldata').value;
      if (!(v > 0)) return $('lerr2').textContent = 'Informe um valor maior que zero, como 150,00.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return $('lerr2').textContent = fixa() ? 'Escolha o dia do 1º lançamento.' : 'Escolha a data.';
      $('lok2').disabled = true;
      // fixa: todo mês no mesmo dia, até cancelar ou por N meses; nenhum entra no caixa sozinho: cada mês é marcado como pago/recebido
      if (fixa()) {
        const fid = novoId(), mes = data.slice(0, 7), n = Number($('lqtd').value) || 0, desc = $('ldesc').value.trim() || $('lcat').value;
        const ops = [{ op: 'set', p: `escolas/${S.eid}/fixas/${fid}`, d: { tipo, desc, cat: $('lcat').value, v, dia: Number(data.slice(8)), inicio: mes, fim: n ? mesMais(mes, n - 1) : null, criadoEm: Date.now() } }];
        try { await B.lote(ops); fecharSheet(); aviso(`${tipo === 'entrada' ? 'Entrada' : 'Despesa'} fixa salva: ${n ? n + ' meses' : 'todo mês, até cancelar'}.`); if (mes !== S.mes) { S.mes = mes; render(); } }
        catch (e) { $('lerr2').textContent = msgErro(e); $('lok2').disabled = false; }
        return;
      }
      try { await B.set(`escolas/${S.eid}/lancamentos/${id || novoId()}`, { ...(l || {}), tipo, cat: $('lcat').value, desc: $('ldesc').value.trim(), v, data }); fecharSheet(); aviso('Lançamento salvo'); if (data.slice(0, 7) !== S.mes) { S.mes = data.slice(0, 7); render(); } }
      catch (e) { $('lerr2').textContent = msgErro(e); $('lok2').disabled = false; }
    };
    if ($('ldel')) $('ldel').onclick = () => confirmar('Excluir lançamento?', esc(l.desc || l.cat), 'Excluir', () => B.del(`escolas/${S.eid}/lancamentos/${id}`));
  });
}

/* ================= Área do responsável ================= */
async function vinculosServidor(acao, rid, fica) {
  if (MOCK) {
    if (acao === 'agrupar') { const st_ = window.__mock.store, p = `escolas/${S.eid}/membros/`;
      for (const k of [...st_.keys()].filter(k => k.startsWith(p) && k.endsWith('/vinculos/' + rid))) { await B.lote([{ op: 'set', p: k.slice(0, -rid.length) + fica, d: { em: Date.now(), via: 'agrupado' } }, { op: 'del', p: k }]); }
      return {}; }
    const st_ = window.__mock.store, p = `escolas/${S.eid}`, meus = Object.keys(S.resps);
    const minhasR = meus.map(r => st_.get(`${p}/responsaveis/${r}`)).filter(Boolean);
    const mem = st_.get(`${p}/membros/${EU.uid}`) || {}, recus = new Set(mem.recusados || []);
    const todos = [...st_.keys()].filter(k => k.startsWith(`${p}/responsaveis/`) && k.split('/').length === 4).map(k => [k.split('/').pop(), st_.get(k)]);
    if (acao === 'vincular') { await B.set(`${p}/membros/${EU.uid}/vinculos/${rid}`, { em: Date.now(), via: 'sugestao' }); return {}; }
    if (acao === 'recusar') { await B.set(`${p}/membros/${EU.uid}`, { recusados: [...recus, rid] }, { merge: true }); return {}; }
    return { sugestoes: todos.filter(([id, r]) => !meus.includes(id) && !recus.has(id) && minhasR.some(m => mesmoContato(m, r))).map(([id, r]) => ({ rid: id, responsavel: r.nome, alunas: [...st_.keys()].filter(k => k.startsWith(`${p}/alunas/`) && st_.get(k).responsavelId === id).map(k => primeiro(st_.get(k).nome)), por: C.telNorm(r.telefone) && minhasR.some(m => C.telNorm(m.telefone) === C.telNorm(r.telefone)) ? 'telefone' : 'CPF' })).filter(x => x.alunas.length) };
  }
  const t = await B.token().catch(() => null); if (!t) throw new Error('Entre na sua conta de novo.');
  const r = await fetch(URLF('vinculos'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ eid: S.eid, acao, rid, fica }) });
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
    ${avisoPushFam()}${avisoRateioFam()}${avisoTamanhoFam()}${avisoEventosFamilia()}${avisoTamEventoFam()}${avisoInscricaoPendente()}${avisoDestratosFam()}${avisoTermos()}${avisoContratos()}${avisoDocsFam()}
    ${(() => { const c = (S.cartoes || []).find(x => x.auto); return c ? `<div class="banner ok"><span><b>Cobrança automática ligada</b> · ${esc(c.marca)} •••• ${esc(c.fim)}. As cobranças ${c.rec === 'escola' ? 'da escola' : 'de ' + esc(nomeRec(c.rec))} são pagas sozinhas no vencimento.</span><button type="button" id="pfdesl" data-rec="${esc(c.rec)}">Desligar</button></div>` : ''; })()}
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
    ${(() => { const pd = Object.values(S.acordos || {}).filter(A => A.perdao && !A.cancelado && S.alunas[A.alid]); return pd.length ? `<section><h2>Perdoado pela escola</h2><ul class="list">${pd.map(A => `<li><div class="grow"><div class="t">${esc(A.resumo || 'Cobranças atrasadas')}</div>${linhas(esc(primeiro(S.alunas[A.alid].nome)), `em ${dataBR(A.criadoEm)}`)}</div>${valorCol(brl(A.original), '<span class="chip pago">Perdoado</span>', 'in')}</li>`).join('')}</ul></section>` : ''; })()}
    ${nfFamLigada() ? `<button type="button" class="linha-botao" id="pnfam" style="margin-top:12px"><span class="grow"><b>Notas fiscais</b><span class="s">Baixar as notas dos pagamentos, ou pedir e dispensar a nota</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>` : ''}
    ${abertos.length ? `<div class="paybar"><div class="grow"><div class="label">${marcados.length ? (() => { const n = dividirPorRecebedor(marcados).length; return `${marcados.length} ite${marcados.length === 1 ? 'm' : 'ns'}${n > 1 ? ` · ${n} Pix` : ''}`; })() : 'Escolha o que pagar'}</div><b class="num" style="font-size:1.25rem">${brl(totSel)}</b></div><button class="btn" id="ppagar" ${pixOk && totSel > 0 ? '' : 'disabled'}>${outrasFormas() ? 'Pagar' : 'Pagar com Pix'}</button></div>` : ''}`;
  v.querySelectorAll('[data-k]').forEach(c => c.onchange = () => { c.checked ? S.sel.add(c.dataset.k) : S.sel.delete(c.dataset.k); render(); });
  v.querySelectorAll('[data-tudo]').forEach(b => b.onclick = () => { const ab = itensDe(b.dataset.tudo).filter(i => !i.pago), todos = ab.every(i => S.sel.has(i.k)); ab.forEach(i => todos ? S.sel.delete(i.k) : S.sel.add(i.k)); render(); });
  v.querySelectorAll('[data-vinc]').forEach(b => b.onclick = async () => { b.disabled = true; try { await vinculosServidor('vincular', b.dataset.vinc); S.sug = S.sug.filter(x => x.rid !== b.dataset.vinc); S.sel = null; aviso('Pronto! Agora você vê essas cobranças também.'); } catch (e) { aviso(msgErro(e)); b.disabled = false; } });
  v.querySelectorAll('[data-recusa]').forEach(b => b.onclick = async () => { try { await vinculosServidor('recusar', b.dataset.recusa); } catch (e) { } S.sug = S.sug.filter(x => x.rid !== b.dataset.recusa); render(); });
  v.querySelectorAll('[data-termo]').forEach(b => b.onclick = () => sheetTermo(b.dataset.termo));
  v.querySelectorAll('[data-atest]').forEach(b => b.onclick = () => sheetEnviarAtestado(b.dataset.atest));
  v.querySelectorAll('[data-ctass]').forEach(b => b.onclick = () => sheetAssinarContrato(b.dataset.ctass));
  // o aviso abre direto aquele evento, com as respostas (vai / não vai) e o pagamento
  v.querySelectorAll('[data-abrev]').forEach(b => b.onclick = () => sheetEventoFam(b.dataset.abrev));
  if ($('pushfam')) $('pushfam').onclick = async () => { $('pushfam').disabled = true; try { await ativarPush(false); if (MOCK) ls.set('escolinha.push.mock', '1'); render(); } catch (e) { aviso(msgErro(e)); $('pushfam').disabled = false; } };
  if ($('pushfamx')) $('pushfamx').onclick = () => { ls.set(`escolinha.pushfam.nao.${S.eid}`, '1'); render(); };
  v.querySelectorAll('[data-insc]').forEach(b => b.onclick = () => sheetEventoFam(b.dataset.insc));
  if ($('ppagar')) $('ppagar').onclick = () => (outrasFormas() ? sheetFormas : sheetPix)(marcados.map(i => i.k));
  if ($('pvenc')) $('pvenc').onclick = () => { abertos.filter(i => i.venc < h).forEach(i => S.sel.add(i.k)); render(); };
  if ($('pnfam')) $('pnfam').onclick = () => sheetNotasFamilia();
  v.querySelectorAll('[data-pfdoc]').forEach(b => b.onclick = () => sheetDocAluno(b.dataset.pfdoc, b.dataset.pfdt));
  if (formasCfg().cartao && !S.cartoesPedido) { S.cartoesPedido = true; meusCartoes(true).then(() => agendar()); }
  if ($('pfdesl')) $('pfdesl').onclick = () => { const recD = $('pfdesl').dataset.rec; confirmar('Desligar a cobrança automática?', 'As próximas cobranças voltam a ser pagas por você, pelo app. O cartão continua salvo.', 'Desligar', async () => {
    try { if (!MOCK) await servidor('pagar', { acao: 'automatico', eid: S.eid, rec: recD, ligar: false }); (S.cartoes || []).forEach(c => c.auto = false); aviso('Cobrança automática desligada'); render(); } catch (e) { aviso(msgErro(e)); } }); };
  if ($('plimpa')) $('plimpa').onclick = () => { S.sel.clear(); render(); };
  ligarRateioFam(v); ligarTamanhoFam(v); ligarArquivosEv(v);
}
// Meus filhos: termo, atestado, documentos e contrato numa lista só (nome à esquerda, situação à direita; toque para agir)
function docsFilhaHTML(id) {
  const lin = (attrs, nome, chip, sub) => `<button type="button" class="plinha" ${attrs}><span class="grow">${esc(nome)}${sub ? `<span class="s" style="display:block">${sub}</span>` : ''}</span>${chip}<span class="seta" aria-hidden="true">›</span></button>`;
  const out = [], x = termoDe(id);
  if (x.st === 'ok') { const ult = ((x.t || {}).alteracoes || []).filter(m => (m.mudou || []).length).pop();
    out.push(lin(`data-vtermo="${esc(id)}"`, 'Termo de matrícula', x.pend.length ? '<span class="chip">Aguardando a escola</span>' : '<span class="chip pago">Assinado</span>', !x.pend.length && ult && ult.cienteEm ? `Mudança de ${dataCurta(ult.em)} vista pela escola` : ''));
    if (x.as) { const at = (x.t || {}).atestado || {};
      out.push(lin(`data-atest="${esc(id)}"`, 'Atestado médico', { ok: '<span class="chip pago">Conferido</span>', conferir: '<span class="chip">Aguardando a escola</span>', recusado: '<span class="chip vencido">Mandar outro</span>', falta: '<span class="chip vencido">Falta enviar</span>' }[x.as] || '', x.as === 'recusado' && at.recusa ? esc(at.recusa.motivo || '') : '')); } }
  else out.push(lin(`data-termo="${esc(id)}"`, 'Termo de matrícula', `<span class="chip vencido">${x.st === 'vencido' ? 'Renovar' : 'Preencher'}</span>`, ''));
  for (const T of [...tiposDoc(), ...avulsosDe(id).map(tipoDoc)].filter(T => T.familia !== false || docDe(id, T.id))) out.push(lin(`data-fdoc="${esc(id)}" data-fdt="${esc(T.id)}"`, T.nome, chipDoc(docDe(id, T.id)), ''));
  const ct = ctAssinado(id) || ctUltimo(id);
  if (ct || ctPede()) out.push(ctAssinado(id) ? lin(`data-vct="${esc(id)}"`, 'Contrato', `<span class="chip pago">Assinado</span>`, `Em ${dataBR(new Date(ct.em).toISOString().slice(0, 10))}`) : lin(`data-ctass="${esc(id)}"`, 'Contrato', '<span class="chip vencido">Assinar</span>', ''));
  return out.join('');
}
// respostas "vai / não vai / já fiz a inscrição" da família
function ligarRespostas(v, depois) {
  ligarTamanhoFam(v, depois);
  v.querySelectorAll('[data-fx]').forEach(b => b.onclick = async () => { b.disabled = true; try { await marcarPart(b.dataset.fx, b.dataset.fid, b.dataset.fst); if (depois) setTimeout(depois, 60); const m = modoInsc(S.extras[b.dataset.fx]), f = b.dataset.fst;
    aviso(f === 'inscrito' ? 'Inscrição confirmada. A escola já está sabendo.' : f === 'nao' ? 'Resposta enviada' : m === 'app' ? 'Combinado! A inscrição já está na tela Pagar.' : m === 'familia' ? 'Combinado! Faça a inscrição com quem organiza e depois toque em "Já fiz a inscrição".' : 'Combinado! A escola vai cuidar da inscrição.'); } catch (e) { aviso(msgErro(e)); b.disabled = false; } });
}
// família: aba Eventos. Em cima, os eventos dos filhos (para responder); embaixo, o calendário da escola, só para ver.
// Os eventos com os filhos ficam em destaque, com o nome de quem vai.
function tFEventos(v) {
  const h = hoje(); if (!S.evMes) S.evMes = h.slice(0, 7);
  const ano = Number(S.evMes.slice(0, 4)), mes = Number(S.evMes.slice(5, 7)), nomeM = C.MESES[mes - 1];
  // na aba da família, conta como "com seus filhos" todo evento em que eles foram chamados (menos quem já disse que não vai)
  const marca = c => { c.meus = convidadosDe(c.x).filter(id => S.alunas[id]); c.meu = c.meus.some(id => partDe(c.x, id) !== 'nao'); return c; };
  const doMes = eventosDoMes(ano, mes).map(marca), prox = eventosDoAno().map(marca).filter(c => fimDe(c.x) >= h);
  const linha = c => { const d = new Date(c.x.data + 'T12:00');
    const quem = c.meu ? c.meus.map(id => { const st = partDe(c.x, id), nm = esc(primeiro((S.alunas[id] || {}).nome)); return `<span class="chip ${st === 'inscrito' || st === 'interesse' || !eventoNovo(c.x) ? 'pago' : st === 'nao' ? '' : 'aberto'}">${nm}: ${st === 'inscrito' ? 'inscrito(a)' : st === 'nao' ? 'não vai' : st === 'interesse' || !eventoNovo(c.x) ? 'vai' : 'falta responder'}</span>`; }).join(' ') : '';
    return `<li class="cal-ev tap ${c.meu ? 'meu' : 'outro'}" data-fev="${esc(c.xid)}"><div class="cal-dia"><b class="num">${d.getDate()}</b><span>${C.MESES[d.getMonth()].slice(0, 3)}</span></div>
      <div class="grow"><div class="t">${esc(c.x.nome)}</div>${linhas(`<span class="num">${esc(periodoTxt(c.x))}</span>${c.x.local ? ' · ' + esc(c.x.local) : ''}`)}${quem ? `<div class="ev-quem">${quem}</div>` : ''}</div><span class="seta" aria-hidden="true">›</span></li>`; };
  const N = 3, todos = !!S.feTodos, vis = todos ? prox : prox.slice(0, N);
  v.innerHTML = `${avisoTamEventoFam()}${avisoInscricaoPendente()}<section><div class="cal-topo"><button type="button" class="icon-btn" id="feant" aria-label="Mês anterior">‹</button><h2>${nomeM[0].toUpperCase() + nomeM.slice(1)} de ${ano}</h2><button type="button" class="icon-btn" id="feprox" aria-label="Próximo mês">›</button></div>
      ${gradeMes(ano, mes, doMes)}
      <div class="cal-legenda"><span><i class="lg-meu"></i>Com seus filhos</span><span><i class="lg-outro"></i>Outros eventos da escola</span></div>
      <button type="button" class="btn ghost" id="feano">Ver o ano inteiro</button></section>
    <section><h2>Próximos eventos <span class="sub num">${prox.length}</span></h2>
      ${prox.length ? `<ul class="list">${vis.map(linha).join('')}</ul>${prox.length > N ? `<button type="button" class="mostrar" id="femais" aria-expanded="${todos}">${todos ? 'Ver menos' : `Ver mais ${prox.length - N} evento${prox.length - N === 1 ? '' : 's'}`}<span aria-hidden="true">${todos ? '▴' : '▾'}</span></button>` : ''}` : '<div class="empty"><span>Nenhum evento marcado pela escola.</span></div>'}</section>
    ${blocoEventosFamilia().replace('<section><h2>Eventos</h2>', '<section><h2>Com seus filhos</h2>')}
    <div class="note">O calendário é da escola: só ela muda os eventos. Dúvidas, fale com a escola.</div>`;
  if ($('femais')) $('femais').onclick = () => { S.feTodos = !todos; render(); };
  const vai = n => { let a = ano, m = mes + n; if (m < 1) { m = 12; a--; } if (m > 12) { m = 1; a++; } S.evMes = `${a}-${String(m).padStart(2, '0')}`; render(); };
  $('feant').onclick = () => vai(-1); $('feprox').onclick = () => vai(1);
  $('feano').onclick = () => sheetCalendario(ano);
  v.querySelectorAll('[data-fev], .mg [data-ev]').forEach(li => li.onclick = () => sheetEventoFam(li.dataset.fev || li.dataset.ev));
  v.querySelectorAll('[data-abrev]').forEach(b => b.onclick = () => sheetEventoFam(b.dataset.abrev));
  let x0 = null; const g = v.querySelector('.mg');
  g.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  g.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) vai(dx < 0 ? 1 : -1); });
  v.querySelectorAll('[data-insc]').forEach(b => b.onclick = () => sheetEventoFam(b.dataset.insc));
  ligarRespostas(v); ligarFotos(v);
}
// família: o evento, só para ver (e responder, se for com os filhos)
function sheetEventoFam(xid) {
  const x = S.extras[xid]; if (!x) return;
  const ids = convidadosDe(x).filter(id => S.alunas[id]);
  sheet(`<h3>${esc(x.nome)}</h3>
    ${ids.length ? `<div class="banner ok"><span><b>${ids.map(id => esc(primeiro(S.alunas[id].nome))).join(' e ')}</b> ${ids.length > 1 ? 'participam' : 'participa'} deste evento.</span></div>` : '<div class="sub">Evento da escola. Seus filhos não estão neste.</div>'}
    ${ddl([['Quando', esc(periodoTxt(x))], ['Local', esc(x.local || '')], ['Organiza', esc(x.organizador || '')], ['Responder até', x.prazo ? prazoTxt(x) : '']])}
    ${localEventoHTML(x)}
    ${ids.length ? ids.map(id => respFamilia(xid, x, id)).join('') : ''}
    <button class="btn ghost" data-fechar>Fechar</button>`, sh => { ligarRespostas(sh, () => sheetEventoFam(xid)); });
}
function tFilhas(v) {
  const mes = mesHoje(), al = porNome(S.alunas);
  const linha = (rot, val) => val ? `<dt>${esc(rot)}</dt><dd>${val}</dd>` : '';
  v.innerHTML = `<h2>Meus filhos</h2>
    ${al.length ? al.map(([id, a]) => { const ts = (a.turmas || []).map(t => S.turmas[t]).filter(Boolean), m = C.mensalidade(S.alunas, id, mes, S.turmas, S.cfg), gs = Object.values(S.grupos).filter(g => (g.alunas || []).includes(id)).map(g => g.nome);
      return `<div class="filha">
        <div class="filha-topo"><label class="filha-foto" aria-label="${FOTOS[id] ? 'Trocar a foto' : 'Adicionar uma foto'} de ${esc(primeiro(a.nome))}">${FOTOS[id] ? `<img src="${FOTOS[id]}" alt="">` : `<span>${esc(iniciais(a.nome))}</span>`}<span class="filha-cam" aria-hidden="true">${ICO_CAM}</span><input type="file" accept="image/*" data-ffoto="${esc(id)}" hidden></label><div class="grow"><div class="t" style="font-size:1.05rem">${esc(a.nome)}</div>${C.ativaNoMes(a, mes) ? '' : '<span class="chip">Inativo(a)</span>'}</div></div>
        <dl class="dl">
          ${linha('Nascimento', a.nascimento ? `${esc(dataBR(a.nascimento))}/${esc(a.nascimento.slice(0, 4))} <span class="sub">(${esc(idade(a.nascimento))})</span>` : '')}
        </dl>
        <div class="filha-docs"><div class="label">Documentos</div><div class="plista">${docsFilhaHTML(id)}</div></div>
        <dl class="dl">
          ${linha('Grupos', gs.length ? gs.map(g => `<span class="chip">${esc(g)}</span>`).join(' ') : '')}
          ${linha('Matrícula', linhaMatricula(id, false))}
        </dl>
        ${ts.map(t => `<div class="filha-turma"><div class="label">Turma</div><div class="t">${esc(t.nome)}</div>
          <dl class="dl">${linha('Dias e horário', esc(t.horario || '—'))}${linha('Local', esc(localDe(t) || '—'))}${linha('Professor(a)', esc(profNome(t) || '—'))}${linha('Faixa etária', esc(C.faixaTxt(t)))}${linha('Valor', `<span class="num">${brl(t.preco)}</span> <span class="sub">por mês</span>`)}</dl></div>`).join('') || '<div class="sub">Sem turma</div>'}
        ${m ? `<div class="filha-turma">${contaMensalidade(m, a, 'Mensalidade de ' + C.nomeMes(mes))}</div>` : ''}
      </div>`; }).join('') : `<div class="empty">Nenhum aluno ligado à sua conta ainda. Fale com a escola.</div>`}
    <div class="note">Mensalidade vence todo dia ${Number(S.cfg.vencDia) || 10}. Descontos são combinados com a escola.${(S.cfg.atraso || {}).ativo ? ` Depois do vencimento: multa de ${String(S.cfg.atraso.multa).replace('.', ',')}% e juros de ${String(S.cfg.atraso.juros).replace('.', ',')}% ao mês.` : ''}</div>`;
  v.querySelectorAll('[data-termo]').forEach(b => b.onclick = () => sheetTermo(b.dataset.termo));
  v.querySelectorAll('[data-atest]').forEach(b => b.onclick = () => sheetEnviarAtestado(b.dataset.atest));
  v.querySelectorAll('[data-vtermo]').forEach(b => b.onclick = () => sheetVerTermo(b.dataset.vtermo));
  v.querySelectorAll('[data-ctass]').forEach(b => b.onclick = () => sheetAssinarContrato(b.dataset.ctass));
  v.querySelectorAll('[data-vct]').forEach(b => b.onclick = () => sheetVerContrato(b.dataset.vct));
  v.querySelectorAll('[data-fdoc]').forEach(b => b.onclick = () => sheetDocAluno(b.dataset.fdoc, b.dataset.fdt));
  // fotos dos filhos: busca uma vez; a família adiciona ou troca
  al.forEach(([id]) => { if (FOTOS[id] === undefined) fotoAluno(id).then(f => { if (f) agendar(); }); });
  v.querySelectorAll('[data-ffoto]').forEach(inp => inp.onchange = async e => { const id = inp.dataset.ffoto, arq = e.target.files[0]; e.target.value = ''; if (!arq) return;
    try { const f = await fotoQuadrada(arq); if (!f) return; await B.set(`escolas/${S.eid}/fotosAlunos/${id}`, { foto: f, responsavelId: (S.alunas[id] || {}).responsavelId || null, em: Date.now(), por: 'familia' }); FOTOS[id] = f; render(); aviso('Foto salva'); }
    catch (er) { aviso(msgErro(er)); } });
  if ($('fcal')) $('fcal').onclick = () => sheetCalendario();
  ligarFotos(v);
  ligarRespostas(v);
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


/* ================= Notas fiscais da comissão =================
   A empresa do app (Kathy) emite, todo mês, uma nota fiscal da comissão de 1% para cada escola (e para cada professor(a)
   que recebe com conta própria), no CPF/CNPJ do dono da conta do Mercado Pago. Emissão automática pelo Emissor Nacional
   (servidor/nfse.js), quando o certificado digital estiver instalado.
   - a escola baixa as notas dela: Ajustes da escola → Notas fiscais da comissão;
   - a empresa vê o relatório do mês (só e-mails liberados no servidor): Ajustes → Conta → Notas fiscais (empresa). */
let NOTAS_PLAT; // undefined: ainda não sabe; true/false
const NF_MOCK = () => (window.__nfMock = window.__nfMock || [
  { gid: 'esc1~escola', eid: 'esc1', rec: 'escola', grupo: 'Escolinha Movimento', qtd: 38, total: 52.4, nome: 'Movimento Esportes Ltda', doc: '11444777000161', tipoDoc: 'CNPJ', email: 'contato@movimento.com' },
  { gid: 'esc1~p1', eid: 'esc1', rec: 'p1', grupo: 'Escolinha Movimento · Juliana Costa', qtd: 9, total: 11.7, nome: 'Juliana Costa', doc: '', tipoDoc: '', email: '' },
  { gid: 'e2~escola', eid: 'e2', rec: 'escola', grupo: 'Ballet Arte', qtd: 21, total: 27.3, nome: 'Ana Paula Ribeiro', doc: '52998224725', tipoDoc: 'CPF', email: 'ballet@exemplo.com' }]);
// dono do app: a nota da comissão (1% dos Pix) que a empresa do app emite para cada escola e professor
async function sheetNotaDono(volta) {
  const ajuda = `<div class="nf-ajuda" id="ndajuda" hidden>
    <h4>O que é isto</h4><p>É a nota fiscal da <b>sua empresa</b> (a do app) para cada escola e cada professor que recebe Pix pelo app, no valor da comissão de 1% do mês. Não tem nada a ver com a nota que a escola emite para as famílias.</p>
    <h4>O que você precisa</h4><ol>
      <li><b>Certificado digital A1</b> do CNPJ da empresa: um arquivo .pfx ou .p12 com senha. O mesmo que o Pelota FC usa serve.</li>
      <li>Da contadora: o <b>código do serviço</b> (6 números; o serviço do app é intermediação de pagamentos, diferente da escolinha), o <b>tipo de empresa</b> e o <b>percentual de tributos</b>.</li>
      <li>O CNPJ habilitado no Emissor Nacional (nfse.gov.br), com um primeiro acesso.</li></ol>
    <h4>Passo a passo</h4><ol>
      <li>Escolha o arquivo do certificado, digite a senha e toque em <b>Instalar certificado</b>. A senha fica só no servidor.</li>
      <li>Confira o CNPJ (vem do certificado), escolha o tipo de empresa e coloque o código do serviço.</li>
      <li>A <b>série</b> já vem 901, para não misturar com as notas do Pelota FC (900).</li>
      <li>Comece em <b>Teste</b>, ligue <b>Emitir sozinho todo dia 1º</b> e salve. Na tela de notas, toque em <b>Emitir as notas deste mês agora</b> para ver se sai certo.</li>
      <li>Deu certo? Volte aqui e mude para <b>Valendo</b>.</li></ol>
    <h4>Depois de ligado</h4><ul><li>Todo dia 1º, o app emite a nota do mês anterior para cada escola e professor, no CPF ou CNPJ da conta do Mercado Pago.</li>
      <li>A escola baixa o PDF em Ajustes → Notas fiscais do Turma em Dia.</li><li>Se faltar o CPF ou CNPJ de alguém, aparece "Preencher dados" na tela de notas.</li></ul></div>`;
  const casca = h => `<div class="headrow"><h3>Minha nota fiscal</h3><button type="button" class="chip" id="ndexp">Explique-me como</button></div>${ajuda}${h}`;
  const ligarAj = () => { if ($('ndexp')) $('ndexp').onclick = () => { const a = $('ndajuda'); a.hidden = !a.hidden; $('ndexp').textContent = a.hidden ? 'Explique-me como' : 'Fechar explicação'; }; };
  sheet(casca('<div class="empty">Carregando…</div>'), ligarAj);
  let E; try { E = await notasServidor('donoEstado'); } catch (e) { return sheet(casca(`<div class="banner"><span>${esc(e.message)}</span></div><button class="btn ghost" data-fechar>Fechar</button>`), ligarAj); }
  const c = E.cfg, cert = E.cert; let regime = c.regime || '', amb = c.ambiente || 'restrita';
  const n2 = v => v == null ? '' : String(v).replace('.', ',');
  sheet(casca(`<div class="sub">Nota da comissão do app (1% dos Pix) para cada escola e professor, todo mês.</div>
    ${c.ligado ? `<div class="banner ok"><span><b>Ligada</b>${amb === 'restrita' ? ' · em teste (sem valor fiscal)' : ' · valendo'}. Sai sozinha todo dia 1º.</span></div>` : E.falta.length ? `<div class="banner"><span><b>Desligada.</b> Para ligar, falta: ${esc(E.falta.join(', '))}.</span></div>` : ''}
    <div class="field"><span class="lb">Certificado digital A1</span>
      ${cert ? `<div class="linha-botao" style="cursor:default"><span class="grow"><b>${esc(cert.titular || 'Certificado instalado')}</b><span class="s">Válido até ${new Date(cert.validade).toLocaleDateString('pt-BR')}${cert.validade - Date.now() < 30 * 864e5 ? ' · vence em breve: renove' : ''}</span></span><button type="button" class="chip" id="ndtroca">Trocar</button></div>` : ''}
      <div id="ndcertw" ${cert ? 'hidden' : ''}><input id="ndarq" type="file" accept=".pfx,.p12,application/x-pkcs12" hidden>
        <label for="ndarq" class="linha-botao" style="cursor:pointer;margin-bottom:10px"><span class="grow"><b id="ndarqn">Escolher o arquivo</b><span class="s">O certificado A1 é um arquivo .pfx ou .p12</span></span><span aria-hidden="true" style="font-weight:800">›</span></label>
        <div class="field"><label for="ndsenha">Senha do certificado</label><input id="ndsenha" type="password" autocomplete="off"></div>
        <button type="button" class="btn ghost" id="ndinst" style="width:100%;margin-top:10px">Instalar certificado</button>
        <div class="note">A senha fica só no servidor, protegida.${MOCK ? ' (No teste: qualquer arquivo, senha 1234.)' : ''}</div></div></div>
    <div class="field"><label for="ndcnpj">CNPJ da empresa</label><input id="ndcnpj" inputmode="numeric" maxlength="18" value="${esc(fmtCnpj(c.cnpj || ''))}" placeholder="00.000.000/0000-00"></div>
    <div class="field"><span class="lb">Tipo de empresa</span><div class="opcoes c3" id="ndreg">${REGIMES_NF.map(([k, n]) => `<button type="button" class="pick" data-rg="${k}" aria-pressed="${regime === k}">${n}</button>`).join('')}</div>
      <div class="note">Simples = Simples Nacional (ME ou EPP). Outro = Lucro Presumido ou Real.</div></div>
    <div class="two"><div class="field"><label for="ndcod">Código do serviço</label><input id="ndcod" inputmode="numeric" maxlength="8" value="${esc(c.cTribNac || '')}" placeholder="6 números"></div>
      <div class="field"><label for="ndnbs">Código NBS (opcional)</label><input id="ndnbs" inputmode="numeric" maxlength="9" value="${esc(c.cNBS || '')}"></div></div>
    <div class="note" style="margin-top:-6px;margin-bottom:12px">A contadora informa. O serviço do app é intermediação de pagamentos, por isso o código é diferente do das escolinhas.</div>
    <div id="ndimp" class="two"><div class="field"><label for="ndiss">Alíquota do ISS (%)</label><input id="ndiss" inputmode="decimal" value="${esc(n2(c.aliqIss))}" placeholder="Ex.: 5"></div>
      <div class="field"><label for="ndtrib">Tributos aproximados (%)</label><input id="ndtrib" inputmode="decimal" value="${esc(n2(c.pTrib))}" placeholder="Ex.: 6"></div></div>
    <div class="field"><label for="ndim">Inscrição municipal no Recife (opcional)</label><input id="ndim" inputmode="numeric" maxlength="15" value="${esc(c.im || '')}"></div>
    <div class="two"><div class="field"><label for="ndserie">Série das notas</label><input id="ndserie" inputmode="numeric" maxlength="4" value="${esc(c.serie || '901')}"></div>
      <div class="field"><label for="ndnini">Primeiro número</label><input id="ndnini" inputmode="numeric" maxlength="6" value="${esc(c.nInicial || 1)}"></div></div>
    <div class="note" style="margin-top:-6px;margin-bottom:12px">O Pelota FC usa a série 900. Deixe 901 aqui para as notas não se misturarem.</div>
    <div class="field"><span class="lb">Ambiente</span><div class="opcoes" id="ndamb">${[['restrita', 'Teste'], ['producao', 'Valendo']].map(([k, n]) => `<button type="button" class="pick" data-am="${k}" aria-pressed="${amb === k}">${n}</button>`).join('')}</div><div class="note" id="ndambn"></div></div>
    <label class="liga"><span class="grow"><b>Emitir sozinho todo dia 1º</b><span class="s">A nota do mês anterior, para cada escola e professor que recebeu Pix.</span></span><input type="checkbox" role="switch" id="ndlig" ${c.ligado ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>
    <div class="err" id="nderr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="ndok">Salvar</button></div>`), s => {
    ligarAj();
    const err = m => { $('nderr').textContent = m; };
    const verReg = () => { $('ndimp').hidden = regime === 'mei' || !regime; s.querySelectorAll('[data-rg]').forEach(b => b.setAttribute('aria-pressed', b.dataset.rg === regime)); };
    const verAmb = () => { s.querySelectorAll('[data-am]').forEach(b => b.setAttribute('aria-pressed', b.dataset.am === amb)); $('ndambn').textContent = amb === 'producao' ? 'As notas têm valor fiscal e geram imposto.' : 'As notas saem sem valor fiscal, só para conferir. Comece por aqui.'; };
    verReg(); verAmb();
    s.querySelectorAll('[data-rg]').forEach(b => b.onclick = () => { regime = b.dataset.rg; verReg(); });
    s.querySelectorAll('[data-am]').forEach(b => b.onclick = () => { amb = b.dataset.am; verAmb(); });
    $('ndcnpj').oninput = () => { const v = fmtCnpj($('ndcnpj').value); if (v !== $('ndcnpj').value) $('ndcnpj').value = v; };
    $('ndarq').onchange = () => { const f = $('ndarq').files[0]; $('ndarqn').textContent = f ? f.name : 'Escolher o arquivo'; };
    if ($('ndtroca')) $('ndtroca').onclick = () => { $('ndcertw').hidden = false; };
    $('ndinst').onclick = async () => {
      const f = $('ndarq').files[0]; if (!f) return err('Escolha o arquivo do certificado (.pfx ou .p12).'); if (!$('ndsenha').value) return err('Digite a senha do certificado.');
      $('ndinst').disabled = true; $('ndinst').textContent = 'Instalando…';
      try { const b64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });
        await notasServidor('donoCert', { pfx: b64, senha: $('ndsenha').value }); aviso('Certificado instalado'); sheetNotaDono(volta); }
      catch (e) { err(msgErro(e)); $('ndinst').disabled = false; $('ndinst').textContent = 'Instalar certificado'; }
    };
    $('ndok').onclick = async () => {
      const cfg = { cnpj: $('ndcnpj').value, regime, cTribNac: $('ndcod').value, cNBS: $('ndnbs').value, aliqIss: $('ndiss').value, pTrib: $('ndtrib').value, im: $('ndim').value, serie: $('ndserie').value, nInicial: $('ndnini').value, ambiente: amb, ligado: $('ndlig').checked };
      if (cfg.ligado && amb === 'producao' && c.ambiente !== 'producao') { const ok = await new Promise(r => confirmar('Emitir notas valendo?', 'A partir de agora as notas da comissão têm valor fiscal. Fez o teste antes?', 'Sim, valendo', () => r(true))); if (!ok) return; }
      $('ndok').disabled = true;
      try { await notasServidor('donoSalvar', { cfg }); aviso(cfg.ligado ? 'Nota da comissão ligada' : 'Salvo'); if (volta) volta(); else fecharSheet(); }
      catch (e) { err(msgErro(e)); $('ndok').disabled = false; }
    };
  });
}
const DONO_MOCK = { cfg: { serie: '901', nInicial: 1, ambiente: 'restrita', ligado: false }, cert: null };
async function notasServidor(acao, extra) {
  if (MOCK) {
    if (acao === 'acesso') return { ok: true };
    const L = NF_MOCK();
    if (acao === 'emitir') { let n = 0; L.forEach(l => { if (l.doc && !(l.nota && l.nota.status === 'ok')) { l.nota = { status: 'ok', chave: '26116062211444777000161000000000000126091234567890', ambiente: 'restrita' }; n++; } }); return { ok: n }; }
    if (acao === 'pdf') throw new Error('No modo de teste não há PDF.');
    if (acao === 'tomador') { const l = L.find(x => x.gid === extra.gid), d = extra.doc.replace(/\D/g, ''); if (l) Object.assign(l, { nome: extra.nome, doc: d, email: extra.email, tipoDoc: d.length === 14 ? 'CNPJ' : 'CPF' }); return { ok: true }; }
    // configuração da nota do dono, no modo de teste
    const D = DONO_MOCK, estadoD = () => { const c = D.cfg, f = []; if (!/^\d{14}$/.test(c.cnpj || '')) f.push('CNPJ da empresa'); if (!/^\d{6}$/.test(c.cTribNac || '')) f.push('código do serviço (cTribNac)');
      if (c.regime === 'simples' && !(c.pTrib > 0)) f.push('percentual de tributos do Simples'); if (!D.cert) f.push('certificado digital A1'); return { cfg: { ...c }, cert: D.cert, falta: f }; };
    if (acao === 'donoEstado') return estadoD();
    if (acao === 'donoCert') { if (extra.senha !== '1234') throw new Error('Não abriu: a senha está errada ou o arquivo não é um certificado A1. (No teste, a senha é 1234.)'); D.cert = { titular: 'EMPRESA DO APP LTDA', validade: Date.now() + 330 * 864e5 }; if (!D.cfg.cnpj) D.cfg.cnpj = '11222333000181'; return estadoD(); }
    if (acao === 'donoSalvar') { const c = extra.cfg; Object.assign(D.cfg, { ...c, cnpj: C.soDigitos(c.cnpj), cTribNac: C.soDigitos(c.cTribNac), aliqIss: c.regime === 'mei' ? null : parseValor(c.aliqIss) || null, pTrib: c.regime === 'mei' ? null : parseValor(c.pTrib) || null, ligado: false });
      const e = estadoD(); if (c.ligado && e.falta.length) throw new Error('Para ligar, falta: ' + e.falta.join(', ') + '.'); D.cfg.ligado = !!c.ligado; return estadoD(); }
    const eD = estadoD();
    return { mes: extra.mes, linhas: L, total: C.r2(L.reduce((x, l) => x + l.total, 0)), nfse: { ligado: eD.cfg.ligado, ambiente: eD.cfg.ambiente || 'restrita', falta: eD.falta, validade: D.cert ? D.cert.validade : null } };
  }
  return servidor('notasPlataforma', { acao, ...(extra || {}) });
}
function baixarPdf(r) {
  const b = atob(r.pdf), u8 = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
  const u = URL.createObjectURL(new Blob([u8], { type: 'application/pdf' })), el = document.createElement('a'); el.href = u; el.download = r.nome || 'nota.pdf'; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
}
// botão da empresa nos Ajustes: só aparece para os e-mails liberados (o servidor confere)
function ligarNotasPlataforma(volta) {
  const mostrar = () => { const el = $('jnotasplat'); if (!el || !NOTAS_PLAT) return;
    el.innerHTML = '<button type="button" class="linha-botao" id="jnfplat"><span class="grow"><b>Painel do dono</b><span class="s">Uso do app por região e notas fiscais da comissão</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>' + (MOCK ? '' : '<a class="linha-botao" href="' + LINK_APP + '?mock=1" target="_blank" rel="noopener" style="margin-top:8px;text-decoration:none;color:inherit"><span class="grow"><b>Demonstração: ver como professor ou responsável</b><span class="s">Abre o app de teste, com dados de exemplo. Troque de perfil no aviso amarelo do alto.</span></span><span aria-hidden="true" style="font-weight:800">›</span></a>');
    $('jnfplat').onclick = () => abrirDe(volta, () => sheetPainelDono()); };
  if (NOTAS_PLAT === undefined) { NOTAS_PLAT = null; notasServidor('acesso').then(() => { NOTAS_PLAT = true; mostrar(); }, e => { NOTAS_PLAT = false;
    // dono com e-mail ainda não confirmado: mostra como confirmar
    const el = $('jnotasplat'); if (el && /Confirme o seu e-mail/.test(e && e.message || '')) { el.innerHTML = '<div class="banner"><span><b>Painel do dono:</b> confirme o seu e-mail para abrir.</span><button id="jverif">Enviar e-mail</button></div>'; $('jverif').onclick = async () => { try { await B.verificarEmail(); aviso('E-mail enviado. Abra o link e depois entre de novo no app.'); } catch (x) { aviso(msgErroTexto(x)); } }; NOTAS_PLAT = undefined; } }); }
  else mostrar();
}
const fmtDoc = d => d && d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d && d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : '';
function textoNota(l, mes) { const [a, m] = mes.split('-');
  return `Tomador: ${l.nome}\n${l.tipoDoc || 'CPF'}: ${l.doc}\n${l.email ? 'E-mail: ' + l.email + '\n' : ''}Valor: ${Number(l.total).toFixed(2).replace('.', ',')}\nDescrição: Comissão de intermediação de pagamentos via aplicativo Turma em Dia (${l.grupo}), competência ${m}/${a}. ${l.qtd} pagamento${l.qtd === 1 ? '' : 's'} por Pix.`; }
const mesAnteriorNF = () => { const d = new Date(Date.now() - 3 * 36e5); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
// relatório da empresa: comissão do mês por escola/professor(a), situação de cada nota, dados do tomador
async function sheetNotasPlataforma(mes, editar) {
  mes = mes || mesAnteriorNF();
  const [ano, mm] = mes.split('-'), nomeM = C.MESES[Number(mm) - 1];
  const topo = `${abasDono('notas')}<h3>Notas fiscais</h3><div class="sub">Comissão de 1% dos Pix, separada por quem recebe (escola ou professor com conta própria). Uma nota para cada um, uma vez por mês.</div>
    <button type="button" class="linha-botao" id="nfdono" style="margin:4px 0 12px"><span class="grow"><b>Minha nota fiscal (empresa do app)</b><span class="s">Certificado, CNPJ, código do serviço e ligar a emissão, com o passo a passo</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>
    <div class="cal-topo"><button type="button" class="icon-btn" id="nfant" aria-label="Mês anterior">‹</button><h2>${nomeM[0].toUpperCase() + nomeM.slice(1)} de ${ano}</h2><button type="button" class="icon-btn" id="nfprox" aria-label="Próximo mês">›</button></div>`;
  const nav = () => { const vai = n => { const [y, m] = mes.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1)); sheetNotasPlataforma(d.toISOString().slice(0, 7)); }; $('nfant').onclick = () => vai(-1); $('nfprox').onclick = () => vai(1); $('nfdono').onclick = () => abrirDe(() => sheetNotasPlataforma(mes), () => sheetNotaDono(() => sheetNotasPlataforma(mes))); ligarAbasDono(); };
  sheet(`${topo}<div class="empty">Somando as comissões…</div><button class="btn ghost" data-fechar>Fechar</button>`, nav);
  let D; try { D = await notasServidor('relatorio', { mes }); } catch (e) { return sheet(`${topo}<div class="banner"><span>${esc(e.message)}</span></div><button class="btn ghost" data-fechar>Fechar</button>`, nav); }
  const L = D.linhas || [], F = D.nfse || null;
  const situacao = l => { const n = l.nota; if (!n) return '<span class="s">Nota ainda não emitida.</span>';
    if (n.status === 'ok') return `<span class="chip pago" style="align-self:flex-start">Nota emitida${n.ambiente !== 'producao' ? ' · teste' : ''}</span>`;
    if (n.status === 'pendente' || n.status === 'emitindo') return '<span class="s">Enviando ao Emissor Nacional… o app tenta de novo sozinho.</span>';
    if (n.status === 'erro') return `<div class="banner"><span><b>A nota foi recusada.</b> ${esc(n.motivo || '')}</span></div>`;
    if (n.status === 'sem_dados') return '<span class="s">Falta o CPF ou CNPJ para emitir.</span>';
    return ''; };
  const auto = !F ? '' : F.falta && F.falta.length ? `<div class="banner"><span><b>Emissão automática ainda não ligada.</b> Falta: ${esc(F.falta.join(', '))}. Enquanto isso, dá para emitir à mão (no fim da tela).</span></div>`
    : `<div class="nf-auto"><div><b>${F.ligado ? 'Emissão automática ligada' : 'Emissão automática desligada'}</b>${F.ligado ? ': todo dia 1º, o app emite a nota do mês anterior para cada um.' : '.'}${F.ambiente !== 'producao' ? ' <b>Modo de teste</b>: as notas não têm valor fiscal.' : ''}</div>
      ${F.validade ? `<span class="s">Certificado digital vale até ${new Date(F.validade).toLocaleDateString('pt-BR')}.${F.validade - Date.now() < 30 * 864e5 ? ' <b>Renove logo!</b>' : ''}</span>` : ''}
      ${L.some(l => l.doc && (!l.nota || l.nota.status === 'erro')) ? '<button type="button" class="btn btn-mini" id="nfemitir">Emitir as notas deste mês agora</button>' : ''}</div>`;
  const card = (l, i) => editar === l.gid ? `<li class="nf-card"><div class="grow"><b>${esc(l.grupo)}</b><span class="s">Dados de quem recebe os Pix (dono da conta do Mercado Pago).</span>
      <div class="field"><label for="nfnome">Nome completo ou razão social</label><input id="nfnome" value="${esc(l.nome)}"></div>
      <div class="field"><label for="nfdoc">CPF ou CNPJ</label><input id="nfdoc" inputmode="numeric" value="${esc(fmtDoc(l.doc))}"></div>
      <div class="field"><label for="nfemail">E-mail (para mandar a nota)</label><input id="nfemail" type="email" value="${esc(l.email)}"></div>
      <div class="err" id="nferr" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" id="nfcanc">Cancelar</button><button type="button" class="btn" id="nfsalva" data-gid="${esc(l.gid)}">Salvar</button></div></div></li>`
    : `<li class="nf-card"><div class="grow"><div class="nf-lin"><b>${esc(l.grupo)}</b><b class="num">${brl(l.total)}</b></div>
      <span class="s">${l.qtd} Pix aprovado${l.qtd === 1 ? '' : 's'} no mês</span>
      <span class="s">Tomador: <b>${esc(l.nome || '—')}</b>${l.doc ? ` · ${esc(l.tipoDoc || 'CPF')} <span class="num">${fmtDoc(l.doc)}</span>` : ''}${l.email ? `<br>${esc(l.email)}` : ''}</span>
      ${l.doc ? '' : '<div class="banner"><span>O Mercado Pago não informou o CPF ou CNPJ. Peça e preencha para emitir a nota.</span></div>'}
      ${situacao(l)}
      <div class="nf-acoes">${l.nota && l.nota.status === 'ok' ? `<button type="button" class="btn btn-mini" data-nfpdf="${esc(l.gid)}">Baixar PDF</button>` : l.doc ? `<button type="button" class="btn ghost btn-mini" data-nfcop="${i}">Copiar dados da nota</button>` : ''}<button type="button" class="btn ghost btn-mini" data-nfed="${esc(l.gid)}">${l.doc ? 'Corrigir dados' : 'Preencher dados'}</button></div></div></li>`;
  sheet(`${topo}
    ${!L.length ? '<div class="empty"><span>Nenhuma comissão neste mês. Não precisa emitir nota.</span></div>' : `${auto}
    <div class="conta">${contaL(`Total do mês · ${L.length} nota${L.length === 1 ? '' : 's'}`, `<b>${brl(D.total)}</b>`, 'total')}</div>
    <ul class="list">${L.map(card).join('')}</ul>
    <button type="button" class="btn ghost" id="nfplan">Baixar planilha do mês</button>`}
    <details class="historico"><summary><span class="grow"><b>Emitir à mão (se precisar)</b><span class="s">Pelo site gratuito do governo</span></span><span class="seta" aria-hidden="true">▾</span></summary>
      <div style="padding:0 14px 14px;display:flex;flex-direction:column;gap:10px"><a class="btn ghost" href="https://www.nfse.gov.br/EmissorNacional/" target="_blank" rel="noopener">Abrir o Emissor Nacional</a>
      <ol class="nf-passos"><li>Entre no Emissor Nacional com o gov.br da Kathy ou com o certificado da empresa.</li><li>Toque em <b>Emitir NFS-e</b> e informe o CPF ou CNPJ e o nome do tomador (a escola ou o professor).</li>
      <li>Serviço: use o código de <b>agenciamento e intermediação</b> que a contadora indicar.</li><li>Valor e descrição: toque em <b>Copiar dados da nota</b> aqui e cole.</li><li>Emita e mande a nota para o e-mail do tomador.</li></ol>
      <span class="s">Conta como comissão o Pix aprovado dentro do mês, pelo horário do Recife.</span></div></details>
    <button class="btn ghost" data-fechar>Fechar</button>`, sh => {
    nav();
    sh.querySelectorAll('[data-nfed]').forEach(b => b.onclick = () => sheetNotasPlataforma(mes, b.dataset.nfed));
    if ($('nfcanc')) $('nfcanc').onclick = () => sheetNotasPlataforma(mes);
    if ($('nfsalva')) $('nfsalva').onclick = async () => { const doc = $('nfdoc').value.replace(/\D/g, ''), nome = $('nfnome').value.trim();
      if (!nome) return $('nferr').textContent = 'Coloque o nome completo.'; if (doc.length !== 11 && doc.length !== 14) return $('nferr').textContent = 'CPF ou CNPJ incompleto.';
      $('nfsalva').disabled = true; try { await notasServidor('tomador', { gid: $('nfsalva').dataset.gid, nome, doc, email: $('nfemail').value.trim() }); aviso('Dados salvos'); sheetNotasPlataforma(mes); } catch (e) { $('nferr').textContent = e.message; $('nfsalva').disabled = false; } };
    sh.querySelectorAll('[data-nfcop]').forEach(b => b.onclick = () => copiar(textoNota(L[Number(b.dataset.nfcop)], mes), 'Dados da nota copiados'));
    sh.querySelectorAll('[data-nfpdf]').forEach(b => b.onclick = async () => { b.disabled = true; try { baixarPdf(await notasServidor('pdf', { mes, gid: b.dataset.nfpdf })); } catch (e) { aviso(e.message); } b.disabled = false; });
    if ($('nfemitir')) $('nfemitir').onclick = async () => { const b = $('nfemitir'); b.disabled = true; b.textContent = 'Emitindo… (pode levar um minuto)';
      try { const r = await notasServidor('emitir', { mes }); aviso(r.ok ? `${r.ok} nota${r.ok === 1 ? '' : 's'} emitida${r.ok === 1 ? '' : 's'}` : 'Nenhuma nota nova emitida. Veja a situação de cada uma.'); } catch (e) { aviso(e.message); } sheetNotasPlataforma(mes); };
    if ($('nfplan')) $('nfplan').onclick = () => { const q = x => '"' + String(x ?? '').replace(/"/g, '""') + '"';
      const linhas = [['Escola / professor(a)', 'Tomador', 'Tipo', 'CPF/CNPJ', 'E-mail', 'Pix aprovados', 'Comissão (R$)', 'Descrição'].map(q).join(';')]
        .concat(L.map(l => [l.grupo, l.nome, l.tipoDoc, l.doc, l.email, l.qtd, Number(l.total).toFixed(2).replace('.', ','), textoNota(l, mes).split('Descrição: ')[1]].map(q).join(';')));
      const u = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' })), el = document.createElement('a');
      el.href = u; el.download = `TurmaEmDia_notas_${mes}.csv`; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); };
  });
}
// abas do painel do dono: visão geral e notas fiscais
const abasDono = at => `<div class="seg" style="margin-bottom:4px"><button type="button" data-dono="geral" aria-pressed="${at === 'geral'}">Visão geral</button><button type="button" data-dono="escolas" aria-pressed="${at === 'escolas'}">Escolas</button><button type="button" data-dono="notas" aria-pressed="${at === 'notas'}">Notas fiscais</button><button type="button" data-dono="erros" aria-pressed="${at === 'erros'}">Erros</button></div>`;
function ligarAbasDono() { document.querySelectorAll('#overlay [data-dono]').forEach(b => b.onclick = () => { if (b.getAttribute('aria-pressed') === 'true') return; ({ geral: sheetPainelDono, escolas: () => sheetEscolasDono(true), notas: sheetNotasPlataforma, erros: sheetErros })[b.dataset.dono](); }); }
// registro técnico de erros, agrupado pelo tipo de erro (só o dono da plataforma lê: regras do Firestore)
const topN = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`).join(', ') || '—';
const dataHoraErro = ms => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function gruposErros(lista) {
  const G = {};
  for (const { id, data: d } of lista) { const k = d.chave || d.msg; const g = G[k] = G[k] || { chave: k, msg: d.msg, ids: [], uids: new Set(), versoes: new Set(), telas: {}, acoes: {}, primeiro: d.em, ultimo: 0, ult: d };
    g.ids.push(id); if (d.uid) g.uids.add(d.uid); if (d.versao) g.versoes.add(d.versao); if (d.tela) g.telas[d.tela] = (g.telas[d.tela] || 0) + 1; if (d.acao) g.acoes[d.acao] = (g.acoes[d.acao] || 0) + 1;
    if (d.em < g.primeiro) g.primeiro = d.em; if (d.em > g.ultimo) { g.ultimo = d.em; g.ult = d; } }
  return Object.values(G).sort((a, b) => b.ids.length - a.ids.length || b.ultimo - a.ultimo);
}
function textoErro(g) { const d = g.ult;
  return ['Turma em Dia · erro registrado', `Mensagem: ${g.msg}`, d.cod ? `Código: ${d.cod}` : '', `Vezes: ${g.ids.length} · pessoas: ${g.uids.size}`, `Primeira: ${dataHoraErro(g.primeiro)} · última: ${dataHoraErro(g.ultimo)}`,
    `Versões: ${[...g.versoes].join(', ') || '—'}`, `Telas: ${topN(g.telas, 5)}`, `Ações: ${topN(g.acoes, 5)}`, `Origem: ${d.origem || '—'}`,
    `Aparelho (último): ${d.aparelho || '—'} · ${d.telaPx || ''}${d.pwa ? ' · app instalado' : ''}`, `Endereço: ${d.url || '—'}`, '', 'Stack (último):', d.stack || '(sem stack)'].filter(x => x !== '').join('\n'); }
async function sheetErros() {
  const desenhar = (corpo, ligar) => sheet(`${abasDono('erros')}<h3>Erros do app</h3><div class="sub">Registro automático dos erros que acontecem no celular das pessoas. Só você vê esta tela. Não guarda nome, e-mail, CPF, telefone nem dados de saúde.</div>
    <div class="nf-acoes"><button type="button" class="btn ghost btn-mini" id="eatual">Atualizar</button><button type="button" class="btn ghost btn-mini" id="eteste">Gerar erro de teste</button></div>${corpo}<button class="btn ghost" data-fechar>Fechar</button>`,
    sh => { ligarAbasDono(); $('eatual').onclick = () => sheetErros();
      $('eteste').onclick = () => { ls.set('ted.errosVistos', null); ERR_N = 0; Object.keys(ERR_MEM).forEach(x => delete ERR_MEM[x]); registrarErro(new Error('Teste do registro de erros (pode apagar)'), 'teste'); aviso('Erro de teste registrado'); setTimeout(sheetErros, 1200); };
      ligar && ligar(sh); });
  desenhar('<div class="empty">Carregando…</div>');
  let lista; try { lista = await B.ultimos('erros', 'em', 500); }
  catch (e) { return desenhar(`<div class="banner"><span>${e.code === 'permission-denied' ? 'Sem permissão para ler os erros. Rode o comando do Cloud Shell para atualizar as regras, e confira se o seu e-mail está confirmado.' : 'Não consegui carregar os erros. Tente de novo.'}</span></div>`); }
  const G = gruposErros(lista);
  desenhar(`<span class="s">${lista.length} registro${lista.length === 1 ? '' : 's'} (os 500 mais recentes) em ${G.length} tipo${G.length === 1 ? '' : 's'} de erro. Cada registro some sozinho depois de 90 dias.</span>
    ${!G.length ? '<div class="empty"><span>Nenhum erro registrado.</span></div>' : `<ul class="list">${G.map((g, i) => `<li class="nf-card"><div class="grow">
      <div class="nf-lin"><b class="erro-msg">${esc(g.msg)}</b><span class="erro-n num">${g.ids.length}×</span></div>
      <span class="s">${g.uids.size} pessoa${g.uids.size === 1 ? '' : 's'} · última vez ${dataHoraErro(g.ultimo)} · versão ${esc([...g.versoes].slice(0, 3).join(', ') || '—')}</span>
      <span class="s">Tela: ${esc(topN(g.telas, 2))} · Ação: ${esc(topN(g.acoes, 2))}</span>
      <details class="erro-det"><summary>Ver detalhe</summary><pre>${esc(textoErro(g))}</pre></details>
      <div class="nf-acoes"><button type="button" class="btn btn-mini" data-ecop="${i}">Copiar detalhe</button><button type="button" class="btn ghost btn-mini" data-edel="${i}">Apagar</button></div></div></li>`).join('')}</ul>`}`, sh => {
    sh.querySelectorAll('[data-ecop]').forEach(b => b.onclick = () => copiar(textoErro(G[Number(b.dataset.ecop)]), 'Detalhe copiado. É só colar na conversa.'));
    sh.querySelectorAll('[data-edel]').forEach(b => b.onclick = async () => { const g = G[Number(b.dataset.edel)];
      // apagar pede um segundo toque
      if (b.dataset.ok !== '1') { b.dataset.ok = '1'; b.textContent = `Toque de novo para apagar ${g.ids.length}`; setTimeout(() => { if (b.isConnected) { b.dataset.ok = ''; b.textContent = 'Apagar'; } }, 4000); return; }
      b.disabled = true; try { for (let i = 0; i < g.ids.length; i += 400) await B.lote(g.ids.slice(i, i + 400).map(id => ({ op: 'del', p: 'erros/' + id }))); aviso('Erros apagados'); sheetErros(); } catch (e) { aviso('Não deu para apagar. Tente de novo.'); b.disabled = false; } });
  });
}
const REG_ORDEM = ['Nordeste', 'Sudeste', 'Sul', 'Centro-Oeste', 'Norte', 'Sem cidade informada'];
let PAINEL = null, PAINEL_MET = 'escolas';
function painelMock() { const r = (nome, escolas, ativas, alunos, contas, pagantes) => ({ nome, escolas, ativas, alunos, contas, pagantes, comissaoMes: pagantes * 18.2 });
  return { em: Date.now(), mes: new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 7), contas: { total: 268, novas30: 41, ativas30: 203 },
    totais: { escolas: 14, ativas: 11, alunos: 612, familias: 233, comPix: 8, pagantes: 6, pixMes: 389, volumeMes: 52740.5, comissaoMes: 527.41, semCidade: 1 },
    regioes: [r('Nordeste', 11, 9, 498, 196, 5), r('Sudeste', 2, 2, 89, 52, 1), r('Sem cidade informada', 1, 0, 25, 9, 0)],
    estados: [r('PE', 8, 7, 362, 141, 4), r('PB', 2, 1, 81, 31, 1), r('SP', 2, 2, 89, 52, 1), r('AL', 1, 1, 55, 24, 0)],
    cidades: [r('Recife · PE', 5, 5, 241, 98, 3), r('Olinda · PE', 2, 1, 76, 27, 1), r('Jaboatão dos Guararapes · PE', 1, 1, 45, 16, 0), r('João Pessoa · PB', 2, 1, 81, 31, 1), r('São Paulo · SP', 2, 2, 89, 52, 1), r('Maceió · AL', 1, 1, 55, 24, 0)] }; }
async function sheetPainelDono(recarregar) {
  const desenhar = (corpo, ligar) => sheet(`${abasDono('geral')}<h3>Painel do dono</h3><div class="sub">Como o app está sendo usado. Só você e a empresa veem esta tela.</div>${corpo}<button class="btn ghost" data-fechar>Fechar</button>`, sh => { ligarAbasDono(); ligar && ligar(sh); });
  if (!PAINEL || recarregar) {
    desenhar('<div class="empty">Contando contas, escolas e alunos…</div>');
    try { PAINEL = MOCK ? painelMock() : await notasServidor('painel'); } catch (e) { return desenhar(`<div class="banner"><span>${esc(e.message)}</span></div><button type="button" class="btn" id="dnovo">Tentar de novo</button>`, () => { $('dnovo').onclick = () => sheetPainelDono(true); }); }
  }
  const D = PAINEL, T = D.totais, Ct = D.contas, [, m] = D.mes.split('-'), met = PAINEL_MET;
  const n = v => Number(v || 0).toLocaleString('pt-BR'), pl = (v, um, varios) => n(v) + ' ' + (Number(v) === 1 ? um : (varios || um + 's'));
  const tile = (rot, val, sub) => `<div class="dono-tile"><span class="lbl">${rot}</span><b class="num">${val}</b>${sub ? `<span class="s">${sub}</span>` : ''}</div>`;
  const MET = { escolas: 'Escolas', alunos: 'Alunos', contas: 'Contas', pagantes: 'Pagantes' };
  const barras = (lista, ord) => { const L = ord ? lista.slice().sort((x, y) => ord.indexOf(x.nome) - ord.indexOf(y.nome)) : lista, max = Math.max(1, ...L.map(r => r[met] || 0));
    return L.length ? `<div class="dono-barras">${L.map(r => `<div><div class="dono-lin"><b>${esc(r.nome)}</b><b class="num">${n(r[met])}</b></div>
      <div class="dono-trilho"><i style="width:${Math.round((r[met] || 0) / max * 100)}%" class="${r.nome === 'Sem cidade informada' ? 'cinza' : ''}"></i></div>
      <span class="s">${pl(r.escolas, 'escola')} · ${pl(r.ativas, 'ativa')} · ${pl(r.alunos, 'aluno')} · ${pl(r.contas, 'conta')} · ${pl(r.pagantes, 'pagante')}</span></div>`).join('')}</div>` : '<span class="s">Nada ainda.</span>'; };
  desenhar(`<div class="dono-tiles">
      ${tile('Contas criadas', n(Ct.total), `+${n(Ct.novas30)} nos últimos 30 dias`)}
      ${tile('Contas ativas', n(Ct.ativas30), 'usaram nos últimos 30 dias')}
      ${tile('Escolas', n(T.escolas), `${n(T.ativas)} com Pix nos últimos 30 dias`)}
      ${tile('Alunos ativos', n(T.alunos), `${n(T.familias)} famílias com conta`)}
      ${tile('Escolas com Pix', n(T.comPix), 'Mercado Pago conectado')}
      ${tile('Escolas pagantes', n(T.pagantes), `geraram comissão em ${C.MESES[Number(m) - 1]}`)}
      ${tile('Pix no mês', n(T.pixMes), brl(T.volumeMes) + ' movimentados')}
      ${tile('Comissão no mês', brl(T.comissaoMes), '1% dos Pix aprovados')}</div>
    <span class="s">"Pagantes" conta quem gerou comissão no Pix. Quando houver assinatura, ela entra aqui também.</span>
    <section class="dono-bloco"><h2>Uso por região</h2>
      <div class="seg">${Object.entries(MET).map(([k, v]) => `<button type="button" data-met="${k}" aria-pressed="${met === k}">${v}</button>`).join('')}</div>
      ${barras(D.regioes, REG_ORDEM)}
      ${T.semCidade ? `<span class="s">${pl(T.semCidade, 'escola')} sem cidade. A administração preenche em engrenagem → Ajustes da escola → Cidade e Estado.</span>` : ''}</section>
    <section class="dono-bloco"><h2>Por estado</h2>${barras(D.estados)}</section>
    <section class="dono-bloco"><h2>Cidades</h2><div class="dono-tab"><table><thead><tr><th>Cidade</th><th>Escolas</th><th>Alunos</th><th>Contas</th><th>Pag.</th></tr></thead>
      <tbody>${D.cidades.length ? D.cidades.map(c => `<tr><td>${esc(c.nome)}</td><td class="num">${n(c.escolas)}</td><td class="num">${n(c.alunos)}</td><td class="num">${n(c.contas)}</td><td class="num">${n(c.pagantes)}</td></tr>`).join('') : '<tr><td colspan="5">Nenhuma cidade informada ainda.</td></tr>'}</tbody></table></div></section>
    <span class="s" style="text-align:center">Atualizado às ${new Date(D.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
    <button type="button" class="btn ghost" id="datual">Atualizar números</button>`, sh => {
    sh.querySelectorAll('[data-met]').forEach(b => b.onclick = () => { PAINEL_MET = b.dataset.met; const y = sh.scrollTop; sheetPainelDono(); const ns = document.querySelector('#overlay .sheet'); if (ns) ns.scrollTop = y; });
    $('datual').onclick = () => sheetPainelDono(true);
  });
}
/* ================= Nota fiscal para as famílias (da escola e de cada professor) =================
   Cada um emite com o próprio CNPJ e certificado A1. O servidor (notaFamilia.js) guarda o certificado e emite no
   Emissor Nacional quando o Pix entra ou quando a escola registra um pagamento em dinheiro. */
const SERVICOS_NF = [['060401', '06.04.01', 'Esportes, dança, ginástica, natação, lutas e atividades físicas', 'O mais comum para escolinha de futebol, vôlei, natação, ballet, judô…'],
  ['080201', '08.02.01', 'Ensino e instrução (cursos livres)', 'Para quando a escola é registrada como curso ou ensino.']];
const REGIMES_NF = [['mei', 'MEI'], ['simples', 'Simples'], ['normal', 'Outro']];
const ST_NF = { ok: ['Emitida', 'ok'], emitindo: ['Emitindo…', 'esp'], pendente: ['Aguardando o Emissor', 'esp'], erro: ['Não saiu', 'erro'], sem_dados: ['Falta CPF', 'erro'], cancelada: ['Cancelada', ''] };
const fmtCnpj = x => { const d = C.soDigitos(x).slice(0, 14), p = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8, 12), d.slice(12)];
  return p[0] + (p[1] ? '.' + p[1] : '') + (p[2] ? '.' + p[2] : '') + (p[3] ? '/' + p[3] : '') + (p[4] ? '-' + p[4] : ''); };
async function nfServidor(acao, d = {}) {
  if (!MOCK) return servidor('notaFiscal', { acao, eid: S.eid, ...d });
  return nfMock(acao, d);
}
// no modo de teste: faz o mesmo que o servidor, sem Emissor Nacional (as notas saem como "teste")
async function nfMock(acao, d) {
  const p = `escolas/${S.eid}`, rec = S.admin ? 'escola' : S.prof || null;
  const ler = async x => (await B.get(x)) || null;
  const estado = async r => { const cfg = (await ler(`${p}/segredos/nfseCfg_${r}`)) || {}, c = await ler(`${p}/segredos/nfseCert_${r}`);
    const f = []; if (!c) f.push('certificado digital A1'); if (!/^\d{14}$/.test(cfg.cnpj || '')) f.push('CNPJ'); if (!cfg.regime) f.push('tipo de empresa (MEI, Simples ou outro)');
    if (!/^\d{6}$/.test(cfg.cTribNac || '')) f.push('código do serviço'); if (cfg.regime && cfg.regime !== 'mei' && !(cfg.aliqIss > 0)) f.push('alíquota do ISS'); if (cfg.regime && cfg.regime !== 'mei' && !(cfg.pTrib > 0)) f.push('percentual aproximado de tributos');
    const it = cfg.itens || {}, meus = r === 'escola' ? undefined : [...Object.entries(S.turmas).filter(([, t]) => C.recDe(t) === r).map(([id, t]) => ({ id, nome: t.nome, tipo: 'turma', nota: it[id] === true })),
      ...Object.entries((await colMock(`${p}/extras`))).filter(([, x]) => x.recebedor === r && !(x.tipo === 'evento' && x.cobranca !== 'app')).map(([id, x]) => ({ id, nome: x.nome, tipo: x.tipo === 'taxa' ? 'taxa' : 'evento', nota: it[id] === true }))];
    return { cfg: { modo: 'todas', ambiente: 'restrita', ...cfg }, cert: c ? { titular: c.titular, doc: c.doc, validade: c.validade } : null, falta: f, meus, papel: S.admin ? 'admin' : 'prof' }; };
  const publicar = async (r, ligado, modo) => { const v = { ligado, modo: modo || 'todas' };
    if (r === 'escola') await B.set(`${p}/config/geral`, { nfFam: v }, { merge: true }); else { await B.set(`${p}/profsPublico/${r}`, { nf: v }, { merge: true }); await B.set(`${p}/professoras/${r}`, { nf: v }, { merge: true }); } };
  if (acao === 'estado') return estado(rec);
  if (acao === 'certificado') { if (d.senha !== '1234') throw new Error('Não abriu: a senha está errada ou o arquivo não é um certificado A1. (No teste, a senha é 1234.)');
    await B.set(`${p}/segredos/nfseCert_${rec}`, { titular: rec === 'escola' ? 'ESCOLINHA MOVIMENTO LTDA' : 'JULIANA COSTA', doc: '11444777000161', validade: Date.now() + 320 * 864e5 });
    const c = (await ler(`${p}/segredos/nfseCfg_${rec}`)) || {}; if (!c.cnpj) await B.set(`${p}/segredos/nfseCfg_${rec}`, { cnpj: '11444777000161' }, { merge: true }); return estado(rec); }
  if (acao === 'tirarCertificado') { await B.del(`${p}/segredos/nfseCert_${rec}`); await B.set(`${p}/segredos/nfseCfg_${rec}`, { ligado: false }, { merge: true }); await publicar(rec, false); return estado(rec); }
  if (acao === 'salvar') { const c = { ...d.cfg, cnpj: C.soDigitos(d.cfg.cnpj), cTribNac: C.soDigitos(d.cfg.cTribNac), aliqIss: d.cfg.regime === 'mei' ? null : parseValor(d.cfg.aliqIss) || null, pTrib: d.cfg.regime === 'mei' ? null : parseValor(d.cfg.pTrib) || null };
    if (c.aliqIss != null && !(c.aliqIss >= 2 && c.aliqIss <= 5)) throw new Error('A alíquota do ISS fica entre 2% e 5%.');
    await B.set(`${p}/segredos/nfseCfg_${rec}`, { ...c, ligado: false }, { merge: true }); const e = await estado(rec);
    if (d.cfg.ligado && e.falta.length) throw new Error('Para ligar, falta: ' + e.falta.join(', ') + '.');
    await B.set(`${p}/segredos/nfseCfg_${rec}`, { ligado: !!d.cfg.ligado }, { merge: true }); await publicar(rec, !!d.cfg.ligado, c.modo); return estado(rec); }
  if (acao === 'aliquota') { if (!(await ler(`${p}/segredos/nfseCert_${rec}`))) throw new Error('Instale o certificado antes: a busca usa ele para entrar no sistema nacional.'); return { aliquota: 5 }; }
  if (acao === 'notas') { const all = await colMock(`${p}/notasFamilia`); return { notas: Object.entries(all).filter(([, n]) => n.rec === rec).map(([nid, n]) => ({ nid, ...n, teste: true, tomador: (n.tomador || {}).nome })).sort((a, b) => String(b.data).localeCompare(String(a.data))) }; }
  if (acao === 'retentar') { const n = await ler(`${p}/notasFamilia/${d.nid}`), r = S.resps[n.rid] || {}; if (!C.cpfValido(r.cpf)) return { status: 'sem_dados' };
    await B.set(`${p}/notasFamilia/${d.nid}`, { status: 'ok', motivo: null, tomador: { nome: r.nome, cpf: C.soDigitos(r.cpf) }, chave: 'TESTE' + Date.now() }, { merge: true }); return { status: 'ok' }; }
  if (acao === 'cancelar') { await B.set(`${p}/notasFamilia/${d.nid}`, { status: 'cancelada', motivo: d.motivo || '' }, { merge: true }); return { status: 'cancelada' }; }
  if (acao === 'pdf' || acao === 'famPdf') return nfPdfTeste(await ler(`${p}/notasFamilia/${d.nid}`));
  if (acao === 'baixa') { const out = {}, a = S.alunas[d.alid], pag = S.pags[d.alid] || {};
    const its = itensDe(d.alid).filter(i => d.chaves.includes(i.k) && i.pago), por = {};
    for (const i of its) { const partes = i.tipo === 'm' ? C.partesMens(a, S.turmas, i.pago.v) : i.tipo === 'a' ? C.partesAcordo(S.acordos[i.aid] || {}, i.pago.v) : { [C.recDe(S.extras[i.xid])]: i.pago.v };
      for (const [r, v] of Object.entries(partes)) (por[r] = por[r] || []).push({ ...i, v, enc: i.pago.enc || null }); }
    for (const [r, l] of Object.entries(por)) out[r] = await nfMockEmitir(r, `din_${d.alid}_${l.map(i => i.k).join('-').replace(/[^A-Za-z0-9_-]/g, '')}_${r}`.slice(0, 140), a.responsavelId, l, 'dinheiro');
    void pag; return { res: out }; }
  if (acao === 'famNotas') { const all = await colMock(`${p}/notasFamilia`), rids = new Set(Object.values(S.alunas).map(a => a.responsavelId));
    const pref = {}; for (const r of rids) { const x = await ler(`${p}/responsaveis/${r}`); pref[r] = (x && x.nota) || null; }
    return { notas: Object.entries(all).filter(([, n]) => rids.has(n.rid) && (n.status === 'ok' || n.status === 'cancelada')).map(([nid, n]) => ({ nid, ...n, teste: true })), pref }; }
  if (acao === 'famPref') { await B.set(`${p}/responsaveis/${d.rid}`, { nota: d.quer ? 'sim' : 'nao' }, { merge: true }); return { ok: true }; }
  throw new Error('Pedido inválido.');
}
async function nfMockEmitir(rec, nid, rid, itens, origem) {
  const p = `escolas/${S.eid}`, cfg = (await B.get(`${p}/segredos/nfseCfg_${rec}`)) || {};
  if (!cfg.ligado) return 'desligado'; if (!(await B.get(`${p}/segredos/nfseCert_${rec}`))) return 'sem_certificado';
  const r = (await B.get(`${p}/responsaveis/${rid}`)) || {}; if (r.nota === 'nao') return 'familia_nao'; if (cfg.modo === 'pedido' && r.nota !== 'sim') return 'nao_pediu';
  const ja = await B.get(`${p}/notasFamilia/${nid}`); if (ja && ja.status !== 'erro') return 'pulou';
  let valor = 0; const porAl = {};
  const it = cfg.itens || {}, troca = m => rec === 'escola' ? m : Object.fromEntries(Object.entries(m || {}).map(([id, x]) => [id, C.recDe(x) === rec ? { ...x, nota: it[id] === true } : x]));
  const TT = troca(S.turmas), XX = troca(S.extras);
  for (const i of itens) { const a = S.alunas[i.alid] || {}; if (!C.emiteNota(i, rec, a, TT, XX)) continue;
    const f = i.enc && i.enc.base > 0 ? i.enc.base / (i.enc.base + (i.enc.multa || 0) + (i.enc.juros || 0)) : 1; valor = C.r2(valor + C.r2(i.v * f)); (porAl[a.nome || ''] = porAl[a.nome || ''] || []).push(i.desc); }
  const lin = Object.entries(porAl).map(([n, l]) => `${n}: ${l.join(', ')}`);
  if (!(valor > 0)) return 'sem_itens';
  const ok = C.cpfValido(r.cpf);
  await B.set(`${p}/notasFamilia/${nid}`, { rec, rid, origem, data: hoje(), valor, itens: lin, status: ok ? 'ok' : 'sem_dados', motivo: ok ? null : 'Falta o CPF certo ou o nome do responsável. Corrija o cadastro e toque em "Tentar de novo".', tomador: { nome: r.nome || '', cpf: C.soDigitos(r.cpf) }, chave: ok ? 'TESTE' + Date.now() : null, ambiente: 'restrita' });
  return ok ? 'ok' : 'sem_dados';
}
// PDF de mentira, só para ver no modo de teste (o de verdade é o DANFSe oficial, gerado no servidor)
async function nfPdfTeste(n) {
  const L = await carregarPdfLib(), doc = await L.PDFDocument.create(), pg = doc.addPage([595, 842]), f = await doc.embedFont(L.StandardFonts.Helvetica), fb = await doc.embedFont(L.StandardFonts.HelveticaBold);
  const sem = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');
  let y = 790; const tx = (t, o = {}) => { pg.drawText(sem(t), { x: 50, y, size: o.s || 11, font: o.b ? fb : f, color: L.rgb(0.1, 0.1, 0.1) }); y -= (o.s || 11) + 8; };
  tx('DANFSe - Documento Auxiliar da NFS-e', { b: 1, s: 15 }); tx('SEM VALOR FISCAL - modo de teste do app', { b: 1 }); y -= 6;
  tx('Tomador: ' + ((n.tomador || {}).nome || '')); tx('CPF: ' + fmtCpf((n.tomador || {}).cpf)); tx('Data: ' + (n.data || '')); tx('Valor do servico: ' + brl(n.valor)); y -= 6; tx('Discriminacao:', { b: 1 });
  (n.itens || []).forEach(i => tx('- ' + i, { s: 10 }));
  return { pdf: btoa(String.fromCharCode(...await doc.save())), nome: `nota_fiscal_${n.data || ''}.pdf` };
}

// o "Explique-me como", para a escola e para o professor
function ajudaNF(prof) {
  const cnpj = prof ? 'o seu CNPJ (MEI serve)' : 'o CNPJ da escola';
  return `<div class="nf-ajuda" id="nfajuda" hidden>
    <h4>O que é isto</h4><p>Quando a família paga, o app emite a nota fiscal de serviço (NFS-e) sozinho, ${prof ? 'no seu nome' : 'no nome da escola'}, e a família baixa o PDF no app. A nota sai no Emissor Nacional do governo (nfse.gov.br), o mesmo sistema que Recife e quase todas as cidades usam desde 2026.${prof ? ' Você emite só da sua parte: das turmas em que a mensalidade cai para você.' : ''}</p>
    <h4>O que ${prof ? 'você' : 'a escola'} precisa ter</h4><ol>
      <li><b>${cnpj[0].toUpperCase() + cnpj.slice(1)}</b>.</li>
      <li><b>Certificado digital A1</b> desse CNPJ: um arquivo (.pfx ou .p12) com senha. Compra-se numa certificadora (Serasa, Certisign, Soluti, Valid…) e vale 1 ano. Peça o <b>A1</b> (arquivo), não o A3 (cartão ou token).</li>
      <li><b>Primeiro acesso no Emissor Nacional</b>: entre uma vez em nfse.gov.br → Emissor Nacional, com o gov.br ou com o certificado, para o CNPJ ficar habilitado.</li></ol>
    <h4>Passo a passo aqui no app</h4><ol>
      <li>Em <b>Certificado digital</b>, escolha o arquivo e digite a senha. A senha fica guardada só no servidor, protegida. Ninguém da escola vê.</li>
      <li>Escolha o <b>tipo de empresa</b> e o <b>código do serviço</b>.</li>
      <li>Se não for MEI, toque em <b>Buscar na prefeitura</b> para preencher a alíquota do ISS, e coloque o percentual de tributos que o contador informar.</li>
      <li>Deixe em <b>Teste</b> primeiro: as notas saem sem valor fiscal, para conferir. Quando estiver tudo certo, mude para <b>Valendo</b>.</li>
      <li>Ligue <b>Emitir notas automaticamente</b> e salve.</li>
      <li>${prof ? 'Em <b>O que leva nota</b>, ligue as suas turmas (e taxas ou eventos) que levam nota. Quem decide é você, não a escola.' : 'Ligue o <b>Emitir nota fiscal</b> nas turmas (e nas taxas e eventos que levam nota). Nas turmas em que o dinheiro cai para um professor, quem decide é ele.'}</li></ol>
    <h4>Depois de ligado</h4><ul>
      <li><b>Pix pelo app</b>: a nota sai sozinha quando o pagamento entra.</li>
      <li><b>Dinheiro</b>: com a nota ligada, "Recebi em dinheiro" também emite. A caixinha "Emitir nota fiscal" já vem marcada; desmarque se não quiser naquela vez.</li>
      <li>Cada <b>turma, taxa e evento</b> tem o seu liga/desliga "Emitir nota fiscal", que começa <b>desligado</b>. Ligue só no que leva nota (as mensalidades, por exemplo). Uniforme, taxa da federação e outros repasses: deixe desligado, para não pagar imposto à toa.</li>
      <li>Escolha <b>todas as famílias</b> ou <b>só quem pedir</b>. A família pede ou dispensa no app, e ${prof ? 'a escola' : 'você'} também pode mudar no cadastro do responsável.</li>
      <li>Saiu errado? Em <b>Notas emitidas</b>, toque em Cancelar.</li></ul>
    <h4>As palavras difíceis</h4><ul>
      <li><b>Código do serviço</b>: o tipo de serviço numa lista nacional, igual em todo o Brasil. Para escolinha, quase sempre 06.04.01 (esportes e atividades físicas).</li>
      <li><b>Alíquota do ISS</b>: o imposto da prefeitura, de 2% a 5%, conforme a cidade. MEI não preenche: já paga na guia fixa do mês. No Simples, o ISS vai junto no DAS.</li>
      <li><b>Tributos aproximados</b>: quanto de imposto, em %, vai embutido no preço. A lei manda mostrar na nota. O contador informa.</li>
      <li><b>MEI</b>: em 2026, a nota para pessoa física só é obrigatória se a família pedir. A partir de 2027, passa a ser sempre.</li></ul>
    <p class="s" style="color:var(--muted)">Na dúvida sobre código, alíquota ou tipo de empresa, confirme com o seu contador. O app só sugere.</p></div>`;
}

async function sheetNotaFiscal(volta) {
  const prof = !S.admin, tit = prof ? 'Minha nota fiscal' : 'Nota fiscal para as famílias';
  const casca = h => `<div class="headrow"><h3>${tit}</h3><button type="button" class="chip" id="nfexp">Explique-me como</button></div>${ajudaNF(prof)}${h}`;
  const ligarAjuda = () => { if ($('nfexp')) $('nfexp').onclick = () => { const a = $('nfajuda'); a.hidden = !a.hidden; $('nfexp').textContent = a.hidden ? 'Explique-me como' : 'Fechar explicação'; if (!a.hidden) a.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }; };
  sheet(casca('<div class="empty">Carregando…</div>'), ligarAjuda);
  let E; try { E = await nfServidor('estado'); } catch (e) { return sheet(casca(`<div class="banner"><span>${esc(e.message)}</span></div><button class="btn ghost" data-fechar>Fechar</button>`), ligarAjuda); }
  const c = E.cfg, cert = E.cert, serv0 = SERVICOS_NF.some(([k]) => k === c.cTribNac) ? c.cTribNac : c.cTribNac ? 'outro' : '060401';
  let regime = c.regime || '', modo = c.modo || 'todas', amb = c.ambiente || 'restrita', serv = serv0;
  const vencer = cert && cert.validade && cert.validade - Date.now() < 30 * 864e5;
  sheet(casca(`<div class="sub">${prof ? 'Notas da sua parte (as turmas em que a mensalidade cai para você), com o seu CNPJ e o seu certificado. Sem certificado, nada é emitido.' : 'A nota sai sozinha no nome da escola quando a família paga, e a família baixa no app.'}</div>
    ${c.ligado ? `<div class="banner ok"><span><b>Ligada</b>${amb === 'restrita' ? ' · em teste (sem valor fiscal)' : ' · valendo'}. As notas saem sozinhas.</span></div>` : E.falta.length ? `<div class="banner"><span><b>Desligada.</b> Para ligar, falta: ${esc(E.falta.join(', '))}.</span></div>` : ''}
    <div class="field"><span class="lb">Certificado digital A1</span>
      ${cert ? `<div class="linha-botao" style="cursor:default"><span class="grow"><b>${esc(cert.titular || 'Certificado instalado')}</b><span class="s">Válido até ${new Date(cert.validade).toLocaleDateString('pt-BR')}${vencer ? ' · vence em breve: renove' : ''}</span></span><button type="button" class="chip" id="nftroca">Trocar</button></div>` : ''}
      <div id="nfcertw" ${cert ? 'hidden' : ''}><input id="nfarq" type="file" accept=".pfx,.p12,application/x-pkcs12" hidden>
        <label for="nfarq" class="linha-botao" style="cursor:pointer;margin-bottom:10px"><span class="grow"><b id="nfarqn">Escolher o arquivo</b><span class="s">O certificado A1 é um arquivo .pfx ou .p12</span></span><span aria-hidden="true" style="font-weight:800">›</span></label>
        <div class="field"><label for="nfsenha">Senha do certificado</label><input id="nfsenha" type="password" autocomplete="off"></div>
        <button type="button" class="btn ghost" id="nfinst" style="width:100%;margin-top:10px">Instalar certificado</button>
        <div class="note">A senha fica só no servidor, protegida. Ninguém vê, nem a escola.${MOCK ? ' (No teste: qualquer arquivo, senha 1234.)' : ''}</div></div></div>
    <div class="field"><label for="nfcnpj">CNPJ</label><input id="nfcnpj" inputmode="numeric" maxlength="18" value="${esc(fmtCnpj(c.cnpj || ''))}" placeholder="00.000.000/0000-00"></div>
    <div class="field"><span class="lb">Tipo de empresa</span><div class="opcoes c3" id="nfreg">${REGIMES_NF.map(([k, n]) => `<button type="button" class="pick" data-rg="${k}" aria-pressed="${regime === k}">${n}</button>`).join('')}</div>
      <div class="note">Simples = Simples Nacional (ME ou EPP). Outro = Lucro Presumido ou Real.</div></div>
    <div class="field"><span class="lb">Código do serviço</span><div class="checks full" id="nfserv">${[...SERVICOS_NF, ['outro', '', 'Outro código', 'Se o contador indicar outro']].map(([k, cod, n, d]) => `<label><input type="radio" name="nfs" value="${k}" ${serv === k ? 'checked' : ''}><span class="grow"><span class="t" style="display:block">${cod ? `<span class="num">${cod}</span> · ` : ''}${esc(n)}</span><span class="s">${esc(d)}</span></span></label>`).join('')}</div>
      <input id="nfcod" inputmode="numeric" maxlength="8" placeholder="Código de 6 números, como 060401" value="${esc(serv === 'outro' ? c.cTribNac : '')}" ${serv === 'outro' ? '' : 'hidden'} style="margin-top:8px"></div>
    <div id="nfimp"><div class="two"><div class="field"><label for="nfiss">Alíquota do ISS (%)</label><input id="nfiss" inputmode="decimal" value="${esc(c.aliqIss != null ? String(c.aliqIss).replace('.', ',') : '')}" placeholder="Ex.: 5"></div>
      <div class="field"><label for="nftrib">Tributos aproximados (%)</label><input id="nftrib" inputmode="decimal" value="${esc(c.pTrib != null ? String(c.pTrib).replace('.', ',') : '')}" placeholder="Ex.: 6"></div></div>
      <button type="button" class="link" id="nfbusca">Buscar a alíquota na prefeitura</button><div class="note" id="nfbuscanota">Usa o certificado para consultar o sistema nacional. O percentual de tributos, o contador informa.</div></div>
    <div class="note" id="nfmei" hidden>MEI não preenche ISS nem tributos: o imposto já está na guia fixa do mês.</div>
    <div class="field"><label for="nfim">Inscrição municipal (opcional)</label><input id="nfim" inputmode="numeric" maxlength="15" value="${esc(c.im || '')}"></div>
    <div class="field"><label for="nfdesc">Texto no começo da descrição (opcional)</label><input id="nfdesc" maxlength="120" value="${esc(c.descricao || '')}" placeholder="Ex.: Aulas de futebol"></div>
    ${prof ? `<div class="field"><span class="lb">O que leva nota</span><span class="sub">Só as cobranças que caem para você. Você liga e desliga aqui, sem depender da escola.</span>
      ${(E.meus || []).length ? E.meus.map(m => ligaNota('nfi_' + m.id, m.nota, m.tipo === 'turma' ? 'Mensalidade da turma' : m.tipo === 'taxa' ? 'Taxa' : 'Inscrição do evento').replace('<b>Emitir nota fiscal</b>', `<b>${esc(m.nome)}</b>`)).join('') : '<div class="note">Nenhuma turma ou cobrança cai para você ainda.</div>'}</div>` : ''}
    <div class="field"><span class="lb">Emitir para</span><div class="opcoes" id="nfmodo">${[['todas', 'Todas'], ['pedido', 'Só quem pedir']].map(([k, n]) => `<button type="button" class="pick" data-md="${k}" aria-pressed="${modo === k}">${n}</button>`).join('')}</div>
      <div class="note" id="nfmodonota"></div></div>
    <div class="field"><span class="lb">Ambiente</span><div class="opcoes" id="nfamb">${[['restrita', 'Teste'], ['producao', 'Valendo']].map(([k, n]) => `<button type="button" class="pick" data-am="${k}" aria-pressed="${amb === k}">${n}</button>`).join('')}</div>
      <div class="note" id="nfambnota"></div></div>
    <label class="liga"><span class="grow"><b>Emitir notas automaticamente</b><span class="s">Quando o Pix entra e quando a escola registra pagamento em dinheiro.</span></span><input type="checkbox" role="switch" id="nfligado" ${c.ligado ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>
    <div class="err" id="nferr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="nfok">Salvar</button></div>
    <button type="button" class="linha-botao" id="nflista"><span class="grow"><b>Notas emitidas</b><span class="s">Baixar o PDF, tentar de novo ou cancelar</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`), s => {
    ligarAjuda();
    const err = m => { $('nferr').textContent = m; };
    const verReg = () => { const mei = regime === 'mei'; $('nfimp').hidden = mei || !regime; $('nfmei').hidden = !mei; s.querySelectorAll('[data-rg]').forEach(b => b.setAttribute('aria-pressed', b.dataset.rg === regime)); };
    verReg();
    s.querySelectorAll('[data-rg]').forEach(b => b.onclick = () => { regime = b.dataset.rg; verReg(); });
    const notas = () => { $('nfmodonota').textContent = modo === 'pedido' ? 'Emite só para quem pedir no app, ou para quem você marcar no cadastro do responsável.' : 'Emite para todas, menos para quem dispensar no app ou você desmarcar no cadastro do responsável.';
      $('nfambnota').textContent = amb === 'producao' ? 'As notas têm valor fiscal e geram imposto.' : 'As notas saem sem valor fiscal, só para conferir. Comece por aqui.'; };
    notas();
    s.querySelectorAll('[data-md]').forEach(b => b.onclick = () => { modo = b.dataset.md; s.querySelectorAll('[data-md]').forEach(x => x.setAttribute('aria-pressed', x.dataset.md === modo)); notas(); });
    s.querySelectorAll('[data-am]').forEach(b => b.onclick = () => { amb = b.dataset.am; s.querySelectorAll('[data-am]').forEach(x => x.setAttribute('aria-pressed', x.dataset.am === amb)); notas(); });
    s.querySelectorAll('[name=nfs]').forEach(r => r.onchange = () => { serv = r.value; $('nfcod').hidden = serv !== 'outro'; if (serv === 'outro') $('nfcod').focus(); });
    $('nfcnpj').oninput = () => { const v = fmtCnpj($('nfcnpj').value); if (v !== $('nfcnpj').value) $('nfcnpj').value = v; };
    $('nfarq').onchange = () => { const f = $('nfarq').files[0]; $('nfarqn').textContent = f ? f.name : 'Escolher o arquivo'; };
    if ($('nftroca')) $('nftroca').onclick = () => { $('nfcertw').hidden = false; $('nfarq').focus(); };
    const codigo = () => serv === 'outro' ? C.soDigitos($('nfcod').value) : serv;
    $('nfinst').onclick = async () => {
      const f = $('nfarq').files[0]; if (!f) return err('Escolha o arquivo do certificado (.pfx ou .p12).');
      if (!$('nfsenha').value) return err('Digite a senha do certificado.');
      $('nfinst').disabled = true; $('nfinst').textContent = 'Instalando…';
      try { const b64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });
        await nfServidor('certificado', { pfx: b64, senha: $('nfsenha').value }); aviso('Certificado instalado'); sheetNotaFiscal(volta); }
      catch (e) { err(msgErro(e)); $('nfinst').disabled = false; $('nfinst').textContent = 'Instalar certificado'; }
    };
    $('nfbusca').onclick = async () => {
      const cod = codigo(); if (!/^\d{6}$/.test(cod)) return err('Escolha o código do serviço primeiro.');
      $('nfbuscanota').textContent = 'Buscando…';
      try { const r = await nfServidor('aliquota', { cTribNac: cod }); if (r.aliquota != null) { $('nfiss').value = String(r.aliquota).replace('.', ','); $('nfbuscanota').textContent = `A prefeitura informa ${String(r.aliquota).replace('.', ',')}% para este serviço.`; } else $('nfbuscanota').textContent = r.mensagem || 'A prefeitura não informou. Pergunte ao contador.'; }
      catch (e) { $('nfbuscanota').textContent = msgErro(e); }
    };
    $('nfok').onclick = async () => {
      const cod = codigo(); if (serv === 'outro' && !/^\d{6}$/.test(cod)) return err('O código do serviço tem 6 números, como 060401.');
      const cfg = { cnpj: $('nfcnpj').value, regime, cTribNac: cod, aliqIss: $('nfiss').value, pTrib: $('nftrib').value, im: $('nfim').value, descricao: $('nfdesc').value, modo, ambiente: amb, ligado: $('nfligado').checked,
        ...(prof ? { itens: Object.fromEntries((E.meus || []).map(m => [m.id, !!($('nfi_' + m.id) || {}).checked])) } : {}) };
      if (cfg.ligado && amb === 'producao' && c.ambiente !== 'producao') { const ok = await new Promise(r => confirmar('Emitir notas valendo?', 'A partir de agora as notas têm valor fiscal e geram imposto. Fez o teste antes?', 'Sim, valendo', () => r(true))); if (!ok) return; }
      $('nfok').disabled = true;
      try { await nfServidor('salvar', { cfg }); aviso(cfg.ligado ? 'Nota fiscal ligada' : 'Salvo'); if (volta) volta(); else fecharSheet(); }
      catch (e) { err(msgErro(e)); $('nfok').disabled = false; }
    };
    $('nflista').onclick = () => abrirDe(() => sheetNotaFiscal(volta), () => sheetNotasEmitidas());
  });
}

async function sheetNotasEmitidas() {
  const corpo = h => `<h3>Notas emitidas</h3>${h}<button class="btn ghost" data-fechar>Fechar</button>`;
  sheet(corpo('<div class="empty">Buscando as notas…</div>'));
  let R; try { R = await nfServidor('notas'); } catch (e) { return sheet(corpo(`<div class="banner"><span>${esc(e.message)}</span></div>`)); }
  const N = R.notas || [], nome = rid => (S.resps && S.resps[rid] && S.resps[rid].nome) || '';
  sheet(corpo(!N.length ? '<div class="empty"><span>Nenhuma nota ainda. Elas aparecem aqui quando as famílias pagarem.</span></div>'
    : `<ul class="list">${N.map(n => { const [st, cl] = ST_NF[n.status] || [n.status, '']; return `<li><div class="grow"><div class="t">${esc(n.tomador || nome(n.rid) || 'Família')}</div>${linhas(esc((n.itens || []).join('; ')), `<span class="num">${dataBR(n.data)}/${String(n.data).slice(2, 4)}</span> · ${n.origem === 'pix' ? 'Pix' : 'Dinheiro'}${n.teste ? ' · teste' : ''}`, n.motivo && n.status !== 'ok' ? `<span style="color:var(--out)">${esc(n.motivo)}</span>` : '')}
      <div class="nf-acoes">${n.status === 'ok' ? `<button class="chip" data-nfpdf="${esc(n.nid)}">PDF</button><button class="chip" data-nfcan="${esc(n.nid)}">Cancelar</button>` : n.status === 'cancelada' ? '' : `<button class="chip" data-nfre="${esc(n.nid)}">Tentar de novo</button><button class="chip" data-nfcan="${esc(n.nid)}">Descartar</button>`}</div></div>
      ${valorCol(brl(n.valor), `<span class="nf-st ${cl}">${st}</span>`)}</li>`; }).join('')}</ul>`), s => {
    s.querySelectorAll('[data-nfpdf]').forEach(b => b.onclick = async () => { b.disabled = true; try { baixarPdf(await nfServidor('pdf', { nid: b.dataset.nfpdf })); } catch (e) { aviso(msgErro(e)); } b.disabled = false; });
    s.querySelectorAll('[data-nfre]').forEach(b => b.onclick = async () => { b.disabled = true; try { const r = await nfServidor('retentar', { nid: b.dataset.nfre }); aviso(r.status === 'ok' ? 'Nota emitida' : r.status === 'sem_dados' ? 'Ainda falta o CPF do responsável' : 'Ainda não saiu'); sheetNotasEmitidas(); } catch (e) { aviso(msgErro(e)); b.disabled = false; } });
    s.querySelectorAll('[data-nfcan]').forEach(b => b.onclick = () => confirmar('Cancelar esta nota?', 'Ela deixa de valer no Emissor Nacional. Use quando foi emitida por engano.', 'Cancelar nota', async () => {
      try { await nfServidor('cancelar', { nid: b.dataset.nfcan, motivo: 'Emitida por engano' }); aviso('Nota cancelada'); } catch (e) { aviso(msgErro(e)); } setTimeout(sheetNotasEmitidas, 80); }));
  });
}

// família: as notas recebidas e o "quero nota"
async function sheetNotasFamilia() {
  const corpo = h => `<h3>Notas fiscais</h3>${h}<button class="btn ghost" data-fechar>Fechar</button>`;
  sheet(corpo('<div class="empty">Buscando…</div>'));
  let R; try { R = await nfServidor('famNotas'); } catch (e) { return sheet(corpo(`<div class="banner"><span>${esc(e.message)}</span></div>`)); }
  const rids = Object.keys(R.pref || {}), N = R.notas || [], pedido = nfModo() === 'pedido';
  // um liga/desliga só, que vale para todos os cadastros desta conta
  const p0 = rids.map(r => R.pref[r]).find(Boolean), quer = p0 ? p0 === 'sim' : !pedido;
  sheet(corpo(`${rids.length ? ligaNota('fnf', quer, pedido ? 'A escola emite só para quem pede. Ligue para receber a nota dos seus pagamentos.' : 'Desligue se você não precisa de nota fiscal.').replace('<b>Emitir nota fiscal</b>', '<b>Quero nota fiscal</b>') : ''}
    ${N.length ? `<ul class="list">${N.map(n => `<li><div class="grow"><div class="t">${esc((n.itens || []).join('; ') || 'Serviço')}</div>${linhas(`<span class="num">${dataBR(n.data)}/${String(n.data).slice(2, 4)}</span>${n.teste ? ' · teste' : ''}`)}</div>${valorCol(brl(n.valor), n.status === 'ok' ? `<button class="chip" data-fpdf="${esc(n.nid)}">PDF</button>` : '<span class="nf-st">Cancelada</span>')}</li>`).join('')}</ul>`
      : '<div class="empty"><span>Nenhuma nota ainda. Ela aparece aqui depois do pagamento.</span></div>'}`), s => {
    const c = $('fnf'); if (c) c.onchange = async () => { try { for (const rid of rids) await nfServidor('famPref', { rid, quer: c.checked }); aviso(c.checked ? 'Pronto: você vai receber a nota' : 'Pronto: sem nota fiscal'); } catch (e) { aviso(msgErro(e)); c.checked = !c.checked; } };
    s.querySelectorAll('[data-fpdf]').forEach(b => b.onclick = async () => { b.disabled = true; try { baixarPdf(await nfServidor('famPdf', { nid: b.dataset.fpdf })); } catch (e) { aviso(msgErro(e)); } b.disabled = false; });
  });
}

// a administração baixa as notas da escola
async function sheetNotasEscola() {
  const corpo = h => `<h3>Notas fiscais do Turma em Dia</h3><div class="sub">A nota fiscal do serviço do app, emitida todo mês no CPF ou CNPJ do dono da conta do Mercado Pago que recebe pelo app. Ela aparece aqui para baixar.</div>${h}
    <span class="s">Cada nota tem uma chave de acesso e um QR Code no PDF para conferir no site oficial (nfse.gov.br).</span><button class="btn ghost" data-fechar>Fechar</button>`;
  sheet(corpo('<div class="empty">Buscando as notas…</div>'));
  let R; try { R = MOCK ? { notas: [{ mes: '2026-09', valor: 52.4, chave: 'x', teste: true }] } : await servidor('notaComissao', { eid: S.eid }); }
  catch (e) { return sheet(corpo(`<div class="banner"><span>${esc(e.message)}</span></div>`)); }
  const N = R.notas || [];
  sheet(corpo(!N.length ? '<div class="empty"><span>Nenhuma nota ainda. A primeira sai no dia 1º do mês seguinte ao primeiro Pix pelo app.</span></div>'
    : `<ul class="list">${N.map(n => { const [a, m] = n.mes.split('-'), nm = C.MESES[Number(m) - 1]; return `<li><div class="grow"><div class="t">${nm[0].toUpperCase() + nm.slice(1)} de ${a}</div>${linhas(`<span class="num">${brl(n.valor)}</span>${n.teste ? ' · teste, sem valor fiscal' : ''}`)}</div><button type="button" class="btn btn-mini" data-nfm="${esc(n.mes)}">Baixar PDF</button></li>`; }).join('')}</ul>`), sh => {
    sh.querySelectorAll('[data-nfm]').forEach(b => b.onclick = async () => { b.disabled = true; const t0 = b.textContent; b.textContent = 'Gerando…';
      try { if (MOCK) throw new Error('No modo de teste não há PDF.'); baixarPdf(await servidor('notaComissao', { eid: S.eid, acao: 'pdf', mes: b.dataset.nfm })); } catch (e) { aviso(e.message); } b.disabled = false; b.textContent = t0; });
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
      <div class="field"><label for="talerg">Alergias</label><input id="talerg" maxlength="200" value="${esc(t.alergias || '')}" placeholder="Deixe em branco se não tiver"></div>
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
    sh.addEventListener('change', () => erroPerto(null)); sh.addEventListener('click', e => { if (e.target.closest('[data-q],[data-img]')) erroPerto(null); });
    $('tok').onclick = async () => {
      // o aviso aparece logo abaixo do que falta, e a janela rola só até ali
      const err = (m, alvo) => { if (alvo) return erroPerto(alvo, m); erroPerto(null); $('terr').textContent = m; };
      $('terr').textContent = ''; erroPerto(null);
      const falta = PERGUNTAS_SAUDE.filter(([k]) => typeof resp_[k] !== 'boolean'); if (falta.length) return err(`Responda todas as perguntas de saúde (falta${falta.length > 1 ? 'm' : ''} ${falta.length}).`, sh.querySelector(`[data-q="${falta[0][0]}"]`).closest('.pq'));
      const sim = PERGUNTAS_SAUDE.some(([k]) => resp_[k]); if (sim && !$('tsim').value.trim()) return err('Conte um pouco sobre o que marcou "sim".', $('tsim'));
      if (!$('tenome').value.trim()) return err('Informe o nome do contato de emergência.', $('tenome').closest('.field'));
      if (C.soDigitos($('tetel').value).length < 10) return err('Informe o telefone do contato de emergência, com DDD.', $('tetel').closest('.two'));
      if (!$('tsocorro').checked) return err('Para a criança participar das aulas, é preciso autorizar os primeiros socorros.', $('tsocorro').closest('label'));
      if (img === null) return err('Escolha se autoriza ou não o uso de imagem.', sh.querySelector('[data-img]').closest('.seg'));
      if (!$('tsens').checked) return err('Marque esta declaração.', $('tsens').closest('label'));
      if (!$('tverd').checked) return err('Marque esta declaração.', $('tverd').closest('label'));
      if ($('tassin').value.trim().split(/\s+/).length < 2) return err('Digite seu nome completo para assinar.', $('tassin').closest('.field'));
      $('tok').disabled = true;
      const d = { responsavelId: a.responsavelId || null, respostas: resp_, detalhes: sim ? $('tsim').value.trim() : '', alergias: C.temInfo($('talerg').value), remedios: C.temInfo($('tremed').value), plano: $('tplano').value.trim(),
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
    <section><h2>Para a escola saber</h2>${ddl([['Alergias', m('Alergias', esc(C.temInfo(t.alergias) || 'Nenhuma'))], ['Remédios', m('Remédios', esc(C.temInfo(t.remedios) || 'Nenhum'))], ['Plano de saúde', m('Plano de saúde', esc(t.plano || '—'))],
      ['Emergência', (emerg ? s => `<mark class="mudou">${s}</mark>` : s => s)(`${esc(e.nome || '')}${e.parentesco ? ' (' + esc(e.parentesco) + ')' : ''}<br><span class="num">${esc(e.telefone || '')}</span>`)]])}</section>
    <section><h2>Autorizações</h2>${ddl([['Primeiros socorros', 'Autorizado'], ['Uso de imagem', m('Uso de imagem', t.imagem ? 'Autorizado' : '<b style="color:var(--out)">Não autorizado</b>')]])}</section>`;
}
// leitura do termo: a escola vê o que mudou, dá ciente e vê o histórico; a família vê o termo e pode informar uma mudança
// termos que a administração ainda precisa ver: assinados e não abertos, ou mudados sem ciente
const termosParaVer = () => porNome(S.alunas).filter(([id, a]) => !a.anonimizadoEm && (termoNovo(id) || (termoDe(id).pend || []).length)).map(([id]) => id);
function sheetVerTermo(alid, fila) {
  const a = S.alunas[alid] || {}, x = termoDe(alid), t = x.t, adm = !!S.admin; if (!t) return;
  const alts = t.alteracoes || [], pend = x.pend || [], marcar = new Set(adm ? pend.flatMap(p => itensMudou(p.mudou).map(([k]) => k)) : []);
  const ult = alts.filter(m => (m.mudou || []).length).pop();
  sheet(`${fila ? `<div class="label">Termos para ver · ${fila.length ? `faltam ${fila.length} depois deste` : 'último'}</div>` : ''}<div class="headrow"><h3 style="margin:0">Termo de ${esc(primeiro(a.nome))}</h3>${adm || S.prof ? '<button type="button" class="btn ghost btn-mini" id="vtperfil">Ver perfil</button>' : ''}</div>
    <div class="sub">${alts.length ? 'Última versão assinada' : 'Assinado'} por ${esc(t.assinatura.nome)} em ${horaCurta(t.em)}${x.st === 'vencido' ? ' · <b style="color:var(--out)">vencido, ' + (adm ? 'pedir renovação' : 'precisa renovar') + '</b>' : ''}</div>
    ${adm && pend.length ? `<div class="mud-alerta"><b>O termo mudou</b>
      ${pend.map(p => `<div class="mud-item"><span class="sub">${p.tipo === 'renovar' ? 'Renovado' : 'Mudado'} por ${esc(p.assinatura.nome)} em ${horaCurta(p.em)}</span>${listaMudou(p.mudou)}</div>`).join('')}
      <span class="sub">O que mudou está marcado no termo abaixo. Basta uma pessoa da administração tocar em "Visto": fica registrado quem viu, a data e a hora, e o aviso some para todas.</span></div>` : ''}
    ${!adm && ult ? `<div class="aviso-lei ${ult.cienteEm ? 'ok' : ''}"><b>${ult.cienteEm ? 'Escola ciente' : 'Aguardando a escola'}</b><span>Mudança enviada em ${horaCurta(ult.em)}${ult.cienteEm ? `, vista pela escola em ${horaCurta(ult.cienteEm)}` : '. A escola já recebeu o aviso.'}</span></div>` : ''}
    ${adm ? blocoAtestadoAdm(alid, x) : ''}
    ${corpoTermo(t, marcar)}
    ${adm && alts.length ? `<details class="historico"><summary><span class="grow"><b>Histórico de mudanças</b><span class="s">${alts.length} mudança${alts.length === 1 ? '' : 's'} desde a primeira assinatura</span></span><span class="seta" aria-hidden="true">▾</span></summary>
      <div class="hist-corpo">${alts.slice().reverse().map(m => `<div class="mud-item"><b>${m.tipo === 'renovar' ? 'Renovação' : 'Mudança'} em ${horaCurta(m.em)}</b><span class="sub">Assinado por ${esc(m.assinatura.nome)}</span>
        ${(m.mudou || []).length ? listaMudou(m.mudou) : '<span class="sub">Renovado sem mudanças.</span>'}
        <span class="sub">${m.cienteEm ? ((m.mudou || []).length ? `Escola ciente em ${horaCurta(m.cienteEm)} (${esc(m.cienteNome || 'administração')})` : '') : '<b style="color:var(--out)">Aguardando ciência da escola</b>'}</span>
        <details class="antes"><summary>Ver como estava antes</summary><div class="sub">Versão assinada por ${esc((m.anterior.assinatura || {}).nome || '')} em ${horaCurta(m.anterior.em)}</div>${corpoTermo(m.anterior)}</details></div>`).join('')}</div></details>` : ''}
    ${adm ? (termoNovo(alid) || pend.length ? `<div class="actions"><button type="button" class="btn ghost" data-fechar>Fechar</button><button type="button" class="btn" id="vtvisto">${fila && fila.length ? 'Visto · próximo' : 'Visto'}</button></div>
      <span class="s" style="text-align:center;display:block">Fechar não marca como visto. "Visto" guarda que a escola viu${fila && fila.length ? ' e já abre o próximo' : ''}.</span>` : '<button class="btn ghost" data-fechar>Fechar</button>') : `<div class="note">Se algo mudou na saúde de ${esc(primeiro(a.nome))} (alergia, remédio, contato de emergência) ou se quiser mudar a autorização de imagem, informe aqui. A escola é avisada e a versão anterior fica guardada.</div>
      <div class="actions"><button type="button" class="btn ghost" data-fechar>Fechar</button><button type="button" class="btn" id="vtmudar">${x.st === 'vencido' ? 'Renovar termo' : 'Informar mudança'}</button></div>`}`, () => {
    if (adm) ligarAtestadoAdm(alid, () => sheetVerTermo(alid));
    // ver o perfil do aluno e, ao voltar, cair de novo neste termo
    if ($('vtperfil')) $('vtperfil').onclick = () => abrirDe(() => sheetVerTermo(alid, fila), () => sheetPerfilAluno(alid, () => sheetVerTermo(alid, fila)));
    if ($('vtmudar')) $('vtmudar').onclick = () => sheetTermo(alid);
    // Visto (dois toques): guarda que a escola viu (e dá ciente nas mudanças); na fila, abre o próximo
    if ($('vtvisto')) $('vtvisto').onclick = () => duploToque($('vtvisto'), async () => {
      const agora = Date.now(), novas = alts.map(m => (m.mudou || []).length && !m.cienteEm ? { ...m, cienteEm: agora, cientePor: EU.uid, cienteNome: EU.nome || 'Administração' } : m);
      try { await B.set(`escolas/${S.eid}/saude/${alid}`, { vistoAdm: t.em, ...(pend.length ? { alteracoes: novas } : {}) }, { merge: true });
        const prox = (fila || []).filter(id => id !== alid && (termoNovo(id) || (termoDe(id).pend || []).length));
        if (prox.length) { aviso(`Visto. Faltam ${prox.length}.`); setTimeout(() => sheetVerTermo(prox[0], prox.slice(1)), 60); } else { fecharSheet(); aviso(fila ? 'Pronto: todos vistos' : 'Visto'); } }
      catch (e) { aviso(msgErro(e)); }
    }, 'Toque de novo para confirmar');
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
  const destaque = [...sims.map(n => ['Saúde', n]), C.temInfo(t.alergias) ? ['Alergia', C.temInfo(t.alergias)] : null, C.temInfo(t.remedios) ? ['Remédio', C.temInfo(t.remedios)] : null, t.imagem === false ? ['Imagem', 'não autoriza uso de imagem'] : null].filter(Boolean);
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
  const faixaNovos = novos.length ? `<button class="faixa-resumo ok" data-vmud="${esc(novos[0][0])}"><span class="grow"><b>${novos.length === 1 ? `Termo de matrícula assinado: ${esc(primeiro(novos[0][1].nome))}` : `${novos.length} termos de matrícula assinados`}</b><span class="s">${novos.length === 1 ? 'Toque para ver as informações de saúde.' : esc(novos.map(([, a]) => primeiro(a.nome)).join(', ')) + '. Toque para ver um por um.'}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>` : '';
  return faixaNovos + 
porNome(S.alunas).map(([id, a]) => ({ id, a, x: termoDe(id) })).filter(r => r.x.pend && r.x.pend.length).map(({ id, a, x }) => {
    const campos = [...new Set(x.pend.flatMap(p => itensMudou(p.mudou).map(([k]) => k)))];
    return `<button class="faixa-resumo alerta" data-vmud="${esc(id)}"><span class="grow"><b>O termo de ${esc(primeiro(a.nome))} mudou</b><span class="s">${esc(campos.slice(0, 3).join(', '))}${campos.length > 3 ? ` e mais ${campos.length - 3}` : ''} · ${dataCurta(x.pend.at(-1).em)}. Toque para ver e dar ciente.</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`;
  }).join('');
}
// aviso para a família: termo a preencher
/* ================= Contrato escola-família (um por aluno) =================
   A escola escreve o modelo uma vez (config/contrato), com campos automáticos entre chaves. A família lê o contrato
   já preenchido e aceita no app; fica guardada uma cópia exata do texto assinado, com nome, CPF, conta, data e hora
   (contratos/{alid}_v{versão}). Sem assinar, a família usa o app normalmente: só aparece o aviso. */
const CAMPOS_CONTRATO = [['escola', 'Nome da escola'], ['cnpj_escola', 'CNPJ da escola'], ['endereco_escola', 'Endereço da escola'], ['responsavel', 'Responsável'], ['cpf', 'CPF do responsável'],
  ['endereco_responsavel', 'Endereço do responsável'], ['telefone', 'WhatsApp'], ['email', 'E-mail'], ['aluno', 'Aluno(a)'], ['nascimento', 'Nascimento'], ['turmas', 'Turmas'], ['horarios', 'Dias e horários'],
  ['mensalidade', 'Mensalidade'], ['matricula', 'Taxa de matrícula'], ['vencimento', 'Dia do vencimento'], ['aviso_previo', 'Aviso prévio'], ['multa_cancelamento', 'Multa de cancelamento'], ['multa', 'Multa por atraso'], ['juros', 'Juros ao mês'], ['cidade', 'Cidade'], ['data', 'Data de hoje']];
const MODELO_CONTRATO = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ESPORTIVOS

CONTRATADA: {escola}, CNPJ {cnpj_escola}, com endereço em {endereco_escola}.

CONTRATANTE: {responsavel}, CPF {cpf}, residente em {endereco_responsavel}, WhatsApp {telefone}, responsável pelo(a) aluno(a) {aluno}, nascido(a) em {nascimento}.

1. OBJETO. A CONTRATADA oferece ao(à) aluno(a) aulas de {turmas}, nos dias e horários {horarios}, conforme o calendário da escola.

2. VALOR E PAGAMENTO. A taxa de matrícula é de {matricula}, paga uma vez, no ato da matrícula. A mensalidade é de {mensalidade}, com vencimento todo dia {vencimento} de cada mês, paga pelo aplicativo Turma em Dia ou diretamente na escola.

3. ATRASO. Em caso de atraso, incidem multa de {multa} e juros de {juros} ao mês.

4. TAXAS E EVENTOS. Uniforme, inscrições em competições, eventos e outras taxas não estão incluídos na mensalidade e são informados com antecedência.

5. CANCELAMENTO. O CONTRATANTE pode cancelar a matrícula a qualquer momento, pelo aplicativo ou na escola, com aviso prévio de {aviso_previo}. São devidas as mensalidades que vencerem até o fim do aviso e as que já estiverem em atraso. Multa por cancelamento: {multa_cancelamento}.

6. FALTAS. Aulas perdidas pelo(a) aluno(a) não geram desconto. A reposição fica a critério da escola.

7. SAÚDE. O CONTRATANTE declara que o(a) aluno(a) pode praticar atividade física e avisará a escola de qualquer mudança de saúde, conforme o termo de matrícula.

8. DADOS PESSOAIS. Os dados são tratados conforme a Lei Geral de Proteção de Dados e a Política de Privacidade do aplicativo.

9. VIGÊNCIA. Este contrato vale a partir da assinatura, por prazo indeterminado, até o cancelamento.

10. FORO. Fica eleito o foro da comarca de {cidade} para resolver questões deste contrato.

{cidade}, {data}.`;
const ctCfg = () => S.contratoCfg || {};
const ctId = (alid, v) => `${alid}_v${v || ctCfg().versao || 1}`;
const ctAssinado = alid => (S.contratos || {})[ctId(alid)] || null;
const ctUltimo = alid => Object.values(S.contratos || {}).filter(c => c.alid === alid).sort((a, b) => (b.em || 0) - (a.em || 0))[0] || null;
const ctPede = () => !!(ctCfg().ativo && ctCfg().texto);
// troca {campo} pelos dados do aluno, do responsável e da escola
function preencherContrato(texto, alid) {
  const a = S.alunas[alid] || {}, r = respDe(alid) || {}, c = ctCfg(), cfg = S.cfg || {}, at = cfg.atraso || {};
  const ts = (a.turmas || []).map(t => S.turmas[t]).filter(Boolean), m = C.mensalidade(S.alunas, alid, mesHoje(), S.turmas, cfg);
  const nasc = a.nascimento ? `${dataBR(a.nascimento)}/${a.nascimento.slice(0, 4)}` : '', d = new Date();
  const v = { escola: c.razao || S.escola.nome || '', cnpj_escola: c.cnpj ? fmtCnpj(c.cnpj) : '', endereco_escola: c.endereco || '', responsavel: r.nome || '', cpf: r.cpf ? fmtCpf(r.cpf) : '',
    endereco_responsavel: r.endereco || '', telefone: r.telefone ? foneBR(r.telefone) : '', email: r.email || '', aluno: a.nome || '', nascimento: nasc, turmas: ts.map(t => t.nome).join(', '),
    horarios: ts.map(t => t.horario).filter(Boolean).join('; '), mensalidade: m ? brl(m.v) : '', vencimento: String(Number(cfg.vencDia) || 10),
    multa: at.ativo ? `${String(Math.min(Number(at.multa) || 0, 2)).replace('.', ',')}%` : '0%', juros: at.ativo ? `${String(Math.min(Number(at.juros) || 0, 1)).replace('.', ',')}%` : '0%',
    matricula: (cfg.matricula || {}).valor > 0 ? brl(cfg.matricula.valor) : 'isenta (R$ 0,00)',
    aviso_previo: `${Number(c.avisoDias ?? 30)} dias`, multa_cancelamento: textoMultaCancel(c),
    cidade: [cfg.cidade, cfg.uf].filter(Boolean).join('/'), data: `${d.getDate()} de ${C.MESES[d.getMonth()]} de ${d.getFullYear()}` };
  return String(texto || '').replace(/\{([a-z_]+)\}/g, (x, k) => k in v ? (v[k] || '______') : x);
}
// multa por cancelamento antes do período mínimo (o CDC proíbe multa abusiva: o app limita a 20% do que faltaria)
const textoMultaCancel = c => { const m = (c || {}).multaCancel || {};
  return m.ativo && m.pct > 0 && m.meses > 0 ? `${String(m.pct).replace('.', ',')}% do valor das mensalidades que faltarem para completar ${m.meses} meses de matrícula, cobrada só se o cancelamento for antes desse prazo` : 'não há'; };
const textoContratoHTML = t => `<div class="ct-texto">${esc(t).replace(/\n/g, '<br>')}</div>`;

// administração: o modelo, os dados da escola e quem já assinou
let CT_RASC = null; // rascunho do modelo enquanto a escola olha "Ver como fica"
function sheetContratoModelo(volta) {
  const r0 = CT_RASC; CT_RASC = null;
  const c = { ...ctCfg(), ...(r0 || {}) }, ver = c.versao || 1, al = porNome(S.alunas).filter(([, a]) => a.ativa !== false && !a.anonimizadoEm);
  const ass = al.filter(([id]) => (S.contratos || {})[ctId(id, ver)]), falta = al.filter(([id]) => !(S.contratos || {})[ctId(id, ver)]);
  sheet(`<h3>Contrato</h3>
    <div class="sub">Um contrato por aluno. Escreva o modelo uma vez: o app troca os campos entre chaves pelos dados de cada aluno, e a família assina no app. Sem assinar, ela continua usando o app normalmente.</div>
    <section><h2>Dados da escola no contrato</h2>
      <div class="field"><label for="ctraz">Razão social</label><input id="ctraz" maxlength="120" value="${esc(c.razao || '')}" placeholder="${esc(S.escola.nome || 'Como está no CNPJ')}"></div>
      <div class="two"><div class="field"><label for="ctcnpj">CNPJ</label><input id="ctcnpj" inputmode="numeric" maxlength="18" value="${esc(fmtCnpj(c.cnpj || ''))}" placeholder="00.000.000/0000-00"></div><div></div></div>
      <div class="field"><label for="ctend">Endereço da escola</label><input id="ctend" maxlength="160" value="${esc(c.endereco || '')}" placeholder="Rua, número, bairro, cidade/UF"></div></section>
    <section><h2>Modelo</h2>
      <div class="note">Toque num campo para colocar no texto, onde está o cursor. Um advogado deve revisar o modelo uma vez.</div>
      <div class="chips ct-campos">${CAMPOS_CONTRATO.map(([k, n]) => `<button type="button" class="pick" data-ctc="${k}">${esc(n)}</button>`).join('')}</div>
      <textarea id="cttxt" rows="14" class="ct-edit">${esc(c.texto || MODELO_CONTRATO)}</textarea>
      <div class="actions"><button type="button" class="btn ghost" id="ctver" ${al.length ? '' : 'disabled'}>Ver como fica</button><button type="button" class="btn ghost" id="ctpadrao">Voltar ao modelo pronto</button></div></section>
    <section><h2>Cancelamento</h2>
      <div class="two"><div class="field"><label for="ctaviso">Aviso prévio (dias)</label><input id="ctaviso" type="number" min="0" max="90" inputmode="numeric" value="${esc(c.avisoDias ?? 30)}"></div><div></div></div>
      <label class="liga"><span class="grow"><b>Multa se cancelar antes de um período mínimo</b><span class="s">Fica escrita no contrato. Pela lei, multa abusiva é proibida: o app aceita até 20% do que faltaria; o comum é 10%.</span></span><input type="checkbox" role="switch" id="ctmulta" ${(c.multaCancel || {}).ativo ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>
      <div class="two" id="ctmultaw" ${(c.multaCancel || {}).ativo ? '' : 'hidden'}><div class="field"><label for="ctmpct">Multa (%)</label><input id="ctmpct" inputmode="decimal" value="${esc(String((c.multaCancel || {}).pct ?? 10).replace('.', ','))}"></div>
        <div class="field"><label for="ctmmes">Período mínimo (meses)</label><input id="ctmmes" type="number" min="1" max="24" inputmode="numeric" value="${esc((c.multaCancel || {}).meses ?? 6)}"></div></div></section>
    <label class="liga"><span class="grow"><b>Pedir a assinatura das famílias</b><span class="s">Ligado: aparece "Assinar o contrato" para cada família que ainda não assinou.</span></span><input type="checkbox" role="switch" id="ctativo" ${c.ativo ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>
    ${c.texto ? `<section><h2>Assinaturas <span class="sub num">${ass.length} de ${al.length}</span></h2>
      ${falta.length ? `<div class="note">Faltam: ${esc(falta.map(([, a]) => primeiro(a.nome)).join(', '))}.</div>` : '<div class="note">Todos assinaram.</div>'}
      <button type="button" class="btn ghost" id="ctnova" style="width:100%">Pedir nova assinatura de todos</button>
      <div class="note">Use quando mudar o contrato ou no começo do ano. Os contratos já assinados continuam guardados no perfil de cada aluno.</div></section>` : ''}
    <div class="err" id="cterr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" id="ctok">Salvar</button></div>`, s => {
    let cur = null; $('cttxt').addEventListener('blur', () => { cur = [$('cttxt').selectionStart, $('cttxt').selectionEnd]; });
    s.querySelectorAll('[data-ctc]').forEach(b => b.onclick = () => { const t = $('cttxt'), [i, j] = cur || [t.value.length, t.value.length], ins = `{${b.dataset.ctc}}`;
      t.value = t.value.slice(0, i) + ins + t.value.slice(j); t.focus(); t.selectionStart = t.selectionEnd = i + ins.length; cur = [i + ins.length, i + ins.length]; });
    $('ctcnpj').oninput = () => { const v = fmtCnpj($('ctcnpj').value); if (v !== $('ctcnpj').value) $('ctcnpj').value = v; };
    $('ctpadrao').onclick = () => confirmar('Voltar ao modelo pronto?', 'O texto que você escreveu é trocado pelo modelo do app.', 'Voltar', () => { $('cttxt').value = MODELO_CONTRATO; });
    $('ctmulta').onchange = () => { $('ctmultaw').hidden = !$('ctmulta').checked; };
    const dados = () => ({ razao: $('ctraz').value.trim(), cnpj: C.soDigitos($('ctcnpj').value), endereco: $('ctend').value.trim(), texto: $('cttxt').value.trim(), ativo: $('ctativo').checked,
      avisoDias: Math.max(0, Math.min(90, parseInt($('ctaviso').value, 10) || 0)), multaCancel: { ativo: $('ctmulta').checked, pct: parseValor($('ctmpct').value) || 0, meses: parseInt($('ctmmes').value, 10) || 0 } });
    $('ctver').onclick = () => { const d = dados(), salvo = S.contratoCfg; CT_RASC = d; S.contratoCfg = { ...c, ...d }; const t = preencherContrato(d.texto, al[0][0]); S.contratoCfg = salvo;
      abrirDe(() => sheetContratoModelo(volta), () => sheet(`<h3>Como fica</h3><div class="sub">Com os dados de ${esc(al[0][1].nome)}. Os campos sem dado aparecem como ______.</div>${textoContratoHTML(t)}<button class="btn ghost" id="ctvolta" style="width:100%">Voltar ao modelo</button>`, () => { $('ctvolta').onclick = () => sheetContratoModelo(volta); })); };
    const salvar = async extra => { const d = dados(); if (d.ativo && d.texto.length < 50) return $('cterr').textContent = 'Escreva o contrato antes de pedir a assinatura.';
      if (d.cnpj && d.cnpj.length !== 14) return $('cterr').textContent = 'O CNPJ tem 14 números.';
      if (d.multaCancel.ativo && !(d.multaCancel.pct > 0 && d.multaCancel.pct <= 20)) return $('cterr').textContent = 'A multa de cancelamento vai de 1% a 20%.';
      if (d.multaCancel.ativo && !(d.multaCancel.meses >= 1)) return $('cterr').textContent = 'Informe o período mínimo em meses.';
      await B.set(`escolas/${S.eid}/config/contrato`, { ...d, versao: ver, ...extra, atualizadoEm: Date.now(), atualizadoPor: EU.nome || EU.email || '' }, { merge: true }); };
    $('ctok').onclick = async () => { $('ctok').disabled = true; try { if (await salvar({}) === undefined) { aviso('Contrato salvo'); volta ? volta() : fecharSheet(); } else $('ctok').disabled = false; } catch (e) { $('cterr').textContent = msgErro(e); $('ctok').disabled = false; } };
    if ($('ctnova')) $('ctnova').onclick = () => confirmar('Pedir nova assinatura?', 'Todas as famílias vão ver "Assinar o contrato" de novo. Os contratos já assinados continuam guardados.', 'Pedir de novo', async () => {
      try { await salvar({ versao: ver + 1, ativo: true }); aviso('Pronto: as famílias vão assinar a nova versão'); setTimeout(() => sheetContratoModelo(volta), 80); } catch (e) { aviso(msgErro(e)); } });
  });
}

// família: ler e assinar
function sheetAssinarContrato(alid) {
  const a = S.alunas[alid], r = respDe(alid) || {}, c = ctCfg(), t = preencherContrato(c.texto, alid);
  sheet(`<h3>Contrato de ${esc(primeiro(a.nome))}</h3>
    <div class="sub">Leia com calma. Se algum dado estiver errado, fale com a escola antes de assinar.</div>
    ${textoContratoHTML(t)}
    <div class="field"><label for="casnome">Seu nome completo</label><input id="casnome" maxlength="80" value="${esc(r.nome || '')}" autocomplete="name"></div>
    <label class="check aceite"><input type="checkbox" id="casok"><span>Li o contrato e aceito, como responsável por ${esc(a.nome)}.</span></label>
    <div class="note">Fica registrado o seu nome, CPF ${r.cpf ? esc(fmtCpf(r.cpf)) : ''}, a sua conta do app, a data e a hora. Esta assinatura vale como assinatura eletrônica.</div>
    <div class="err" id="caserr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Depois</button><button class="btn" id="casbtn">Assinar contrato</button></div>`, () => {
    $('casbtn').onclick = () => {
      const nome = $('casnome').value.trim(), err = m => $('caserr').textContent = m;
      if (nome.split(/\s+/).length < 2) return err('Digite o seu nome completo.');
      if (!$('casok').checked) return err('Marque que leu e aceita o contrato.');
      duploToque($('casbtn'), async () => {
        $('casbtn').disabled = true;
        try { await B.set(`escolas/${S.eid}/contratos/${ctId(alid)}`, { alid, rid: a.responsavelId || null, versao: c.versao || 1, texto: t, nome, cpf: C.soDigitos(r.cpf), uid: EU.uid, email: EU.email || '', em: Date.now() });
          aviso('Contrato assinado'); fecharSheet(); }
        catch (e) { err(msgErro(e)); $('casbtn').disabled = false; }
      }, 'Toque de novo para assinar');
    };
  });
}
// ver o contrato assinado (escola e família) e baixar o PDF
function sheetVerContrato(alid, cid) {
  const k = cid || Object.keys(S.contratos || {}).filter(x => (S.contratos[x] || {}).alid === alid).sort((x, y) => (S.contratos[y].em || 0) - (S.contratos[x].em || 0))[0], ct = (S.contratos || {})[k];
  if (!ct) return;
  const quando = new Date(ct.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  sheet(`<h3>Contrato assinado</h3>
    <div class="banner ok"><span>Assinado por <b>${esc(ct.nome)}</b>${ct.cpf ? `, CPF ${esc(fmtCpf(ct.cpf))}` : ''}, em ${esc(quando)}${ct.versao > 1 ? ` (versão ${ct.versao})` : ''}.</span></div>
    ${textoContratoHTML(ct.texto)}
    <div class="actions"><button class="btn ghost" data-fechar>Fechar</button><button class="btn" id="ctpdf">Baixar PDF</button></div>`, () => {
    $('ctpdf').onclick = async () => { $('ctpdf').disabled = true; try { baixarPdf(await pdfContrato(ct)); } catch (e) { aviso(msgErro(e)); } $('ctpdf').disabled = false; };
  });
}
async function pdfContrato(ct) {
  const L = await carregarPdfLib(), doc = await L.PDFDocument.create(), f = await doc.embedFont(L.StandardFonts.Helvetica), fb = await doc.embedFont(L.StandardFonts.HelveticaBold);
  const sem = t => String(t || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '');
  let pg = doc.addPage([595, 842]), y = 790; const W = 495, tam = 10.5, lh = 15;
  const linha = (t, fonte = f, s = tam) => { if (y < 60) { pg = doc.addPage([595, 842]); y = 790; } pg.drawText(t, { x: 50, y, size: s, font: fonte, color: L.rgb(0.1, 0.1, 0.1) }); y -= lh; };
  for (const par of sem(ct.texto).split('\n')) {
    if (!par.trim()) { y -= 6; continue; }
    let atual = ''; for (const w of par.split(' ')) { const tent = atual ? atual + ' ' + w : w; if (f.widthOfTextAtSize(tent, tam) > W) { linha(atual); atual = w; } else atual = tent; } if (atual) linha(atual);
  }
  y -= 14; const quando = new Date(ct.em).toLocaleString('pt-BR');
  linha('Assinatura eletronica', fb);
  linha(sem(`${ct.nome}${ct.cpf ? ' - CPF ' + fmtCpf(ct.cpf) : ''}`)); linha(sem(`Aceito no app Turma em Dia em ${quando}, pela conta ${ct.email || ct.uid}.`)); linha(sem(`Versao do contrato: ${ct.versao || 1}`));
  return { pdf: btoa(Array.from(await doc.save(), b => String.fromCharCode(b)).join('')), nome: sem(`contrato_${(S.alunas[ct.alid] || {}).nome || ''}.pdf`).replace(/\s+/g, '_') };
}
// aviso para a família: contratos a assinar
function avisoContratos() {
  if (!ctPede()) return '';
  return porNome(S.alunas).filter(([id, a]) => !a.anonimizadoEm && !ctAssinado(id)).map(([id, a]) => `<button class="faixa-resumo" data-ctass="${esc(id)}"><span class="grow"><b>Assinar o contrato de ${esc(primeiro(a.nome))}</b><span class="s">Leia e aceite pelo app, leva um minuto</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`).join('');
}
/* ================= Cancelamento da matrícula (destrato) =================
   A família pede pelo app (ou a escola registra em nome dela). O fim sai do aviso prévio do contrato; são devidas as
   mensalidades que vencem até o último dia e o que já está atrasado; multa só se o contrato tiver e a escola cobrar.
   A escola confirma (pode dispensar o aviso e a multa), a família assina o termo no app e o aluno fica inativo.
   Sem a assinatura, a escola pode encerrar assim mesmo: fica registrado que a família pediu.
   Cada pedido: escolas/{eid}/destratos/{alid}_{ms}. */
const MOTIVOS_CANCEL = [['mudanca', 'Mudança de cidade ou bairro'], ['horario', 'Horário'], ['financeiro', 'Financeiro'], ['saude', 'Saúde'], ['outra', 'Outra atividade'], ['outro', 'Outro motivo']];
const dtrDe = alid => Object.entries(S.destratos || {}).filter(([, d]) => d.alid === alid && d.status !== 'desistiu').sort((a, b) => (b[1].pedidoEm || 0) - (a[1].pedidoEm || 0))[0] || null;
const isoDia = ms => new Date(ms - 3 * 36e5).toISOString().slice(0, 10);
const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// o que fica valendo num cancelamento pedido em "pedidoEm" (ms), com ou sem o aviso prévio e a multa
function contaCancel(alid, pedidoEm, op = {}) {
  const a = S.alunas[alid] || {}, c = ctCfg(), aviso = op.semAviso ? 0 : Number(c.avisoDias ?? 30), ultimo = somaDias(isoDia(pedidoEm), aviso);
  let fim = ultimo.slice(0, 7); if (C.vencMens(fim, S.cfg) > ultimo) fim = C.mesMais(fim, -1);
  if (a.inicio && fim < a.inicio) fim = C.mesMais(a.inicio, -1);
  const devidas = itensDe(alid).filter(i => !i.pago && i.venc <= ultimo), totalDevido = C.r2(devidas.reduce((x, i) => x + i.v, 0));
  const m = c.multaCancel || {}; let multa = 0, meses = 0;
  if (!op.semMulta && m.ativo && m.pct > 0 && m.meses > 0 && a.inicio) {
    const [y0, m0] = a.inicio.split('-').map(Number), [y1, m1] = fim.split('-').map(Number); meses = Math.max(0, (y1 - y0) * 12 + (m1 - m0) + 1);
    const falta = Math.max(0, m.meses - meses), mens = (C.mensalidade(S.alunas, alid, mesHoje(), S.turmas, S.cfg) || {}).v || 0;
    multa = C.r2(falta * mens * m.pct / 100);
  }
  return { aviso, ultimo, fim, devidas, totalDevido, multa, meses };
}
const resumoCancelHTML = (alid, k) => `<div class="items">
    <div class="item"><span>Último dia de aulas</span><b class="num">${dataBR(k.ultimo)}/${k.ultimo.slice(0, 4)}</b></div>
    <div class="item"><span>Última mensalidade</span><b>${esc(C.nomeMes(k.fim))}</b></div>
    ${k.devidas.length ? `<div class="item"><span>Ainda a pagar (${k.devidas.length} cobrança${k.devidas.length > 1 ? 's' : ''})</span><b class="num">${brl(k.totalDevido)}</b></div>` : '<div class="item"><span>Ainda a pagar</span><b>nada</b></div>'}
    ${k.multa > 0 ? `<div class="item"><span>Multa de cancelamento</span><b class="num">${brl(k.multa)}</b></div>` : ''}</div>
  <div class="note">Aviso prévio de ${k.aviso} dia${k.aviso === 1 ? '' : 's'}. ${k.multa > 0 ? `A multa vale porque a matrícula tem ${k.meses} ${k.meses === 1 ? 'mês' : 'meses'}, menos que o mínimo do contrato.` : ''}</div>`;
function termoDestrato(alid, d) {
  const a = S.alunas[alid] || {}, r = respDe(alid) || {}, c = ctCfg(), esc0 = c.razao || S.escola.nome || '';
  return `TERMO DE CANCELAMENTO DE MATRÍCULA (DESTRATO)

CONTRATADA: ${esc0}${c.cnpj ? ', CNPJ ' + fmtCnpj(c.cnpj) : ''}.
CONTRATANTE: ${r.nome || ''}${r.cpf ? ', CPF ' + fmtCpf(r.cpf) : ''}, responsável pelo(a) aluno(a) ${a.nome || ''}.

1. O CONTRATANTE pediu o cancelamento da matrícula em ${dataBR(isoDia(d.pedidoEm))}/${isoDia(d.pedidoEm).slice(0, 4)}${d.motivo ? `, pelo motivo: ${(MOTIVOS_CANCEL.find(m => m[0] === d.motivo) || [, d.motivo])[1]}${d.obs ? ' (' + d.obs + ')' : ''}` : ''}.
2. O último dia de aulas é ${dataBR(d.ultimo)}/${d.ultimo.slice(0, 4)}${d.dispensouAviso ? ', com o aviso prévio dispensado pela escola' : ''}. A última mensalidade é a de ${C.nomeMes(d.fim)}.
3. Ficam devidos ${brl(d.totalDevido || 0)} em cobranças que vencem até o último dia ou já estão em atraso${d.multa > 0 ? `, mais ${brl(d.multa)} de multa de cancelamento, conforme o contrato` : ''}. Nada mais é cobrado depois disso.
4. Pagos esses valores, as partes dão quitação do contrato de prestação de serviços, sem mais nada a reclamar.

${[S.cfg.cidade, S.cfg.uf].filter(Boolean).join('/')}${S.cfg.cidade ? ', ' : ''}${new Date().getDate()} de ${C.MESES[new Date().getMonth()]} de ${new Date().getFullYear()}.`;
}

// família (ou escola em nome dela): pedir o cancelamento
function sheetPedirCancel(alid, pelaEscola) {
  const a = S.alunas[alid], k = contaCancel(alid, Date.now()); let motivo = '';
  sheet(`<h3>Cancelar a matrícula de ${esc(primeiro(a.nome))}</h3>
    <div class="sub">${pelaEscola ? 'Registre o pedido que a família fez por WhatsApp ou pessoalmente. Ela recebe o termo para assinar no app.' : 'O pedido vai para a escola. Até o último dia, as aulas continuam normalmente.'}</div>
    <div class="field"><span class="lb">Motivo</span><div class="chips" id="pcmot">${MOTIVOS_CANCEL.map(([k2, n]) => `<button type="button" class="pick" data-mot="${k2}">${esc(n)}</button>`).join('')}</div></div>
    <div class="field"><label for="pcobs">Quer contar mais? (opcional)</label><textarea id="pcobs" rows="2" maxlength="300"></textarea></div>
    ${resumoCancelHTML(alid, k)}
    <div class="err" id="pcerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Voltar</button><button class="btn" id="pcok">Pedir cancelamento</button></div>`, s => {
    s.querySelectorAll('[data-mot]').forEach(b => b.onclick = () => { motivo = b.dataset.mot; s.querySelectorAll('[data-mot]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
    $('pcok').onclick = () => { if (!motivo) return $('pcerr').textContent = 'Escolha o motivo.';
      duploToque($('pcok'), async () => { $('pcok').disabled = true; const em = Date.now(), k2 = contaCancel(alid, em);
        try { await B.set(`escolas/${S.eid}/destratos/${alid}_${em}`, { alid, rid: a.responsavelId || null, motivo, obs: $('pcobs').value.trim(), pedidoEm: em, status: 'pedido',
            pedidoPor: { uid: EU.uid, nome: EU.nome || EU.email || '', quem: pelaEscola ? 'escola' : 'familia' }, aviso: k2.aviso, ultimo: k2.ultimo, fim: k2.fim, multa: k2.multa, totalDevido: k2.totalDevido });
          aviso(pelaEscola ? 'Pedido registrado' : 'Pedido enviado à escola'); fecharSheet(); }
        catch (e) { $('pcerr').textContent = msgErro(e); $('pcok').disabled = false; } }, 'Toque de novo para confirmar'); };
  });
}
// escola: ver, confirmar, dispensar aviso/multa, encerrar
function sheetDestrato(did) {
  const d = (S.destratos || {})[did]; if (!d) return; const a = S.alunas[d.alid] || {}, nm = esc(a.nome || 'Aluno(a)');
  const mot = (MOTIVOS_CANCEL.find(m => m[0] === d.motivo) || [, d.motivo || ''])[1];
  const st = { pedido: 'Pedido · falta a escola confirmar', confirmado: d.assinatura ? 'Confirmado · termo assinado' : 'Confirmado · falta a família assinar o termo', encerrado: 'Matrícula encerrada', desistiu: 'A família desistiu' }[d.status];
  let semAviso = !!d.dispensouAviso, semMulta = d.multa === 0 && d.status !== 'pedido';
  const corpo = () => { const k = d.status === 'pedido' ? contaCancel(d.alid, d.pedidoEm, { semAviso, semMulta }) : { aviso: d.aviso, ultimo: d.ultimo, fim: d.fim, devidas: [], totalDevido: d.totalDevido, multa: d.multa, meses: 0 };
    return { k, html: resumoCancelHTML(d.alid, d.status === 'pedido' ? k : { ...k, meses: d.meses || 0, devidas: k.totalDevido ? [{}] : [] }) }; };
  const desenhar = () => { const { html } = corpo();
    sheet(`<h3>Cancelamento · ${nm}</h3>
    <div class="banner ${d.status === 'encerrado' ? 'ok' : ''}"><span><b>${esc(st)}</b><br>Pedido ${d.pedidoPor && d.pedidoPor.quem === 'escola' ? `registrado pela escola (${esc(d.pedidoPor.nome || '')})` : 'pela família'} em ${dataBR(isoDia(d.pedidoEm))}. Motivo: ${esc(mot)}${d.obs ? ` · “${esc(d.obs)}”` : ''}</span></div>
    ${html}
    ${d.status === 'pedido' ? `<label class="liga"><span class="grow"><b>Dispensar o aviso prévio</b><span class="s">A matrícula acaba hoje, sem cobrar o período do aviso.</span></span><input type="checkbox" role="switch" id="dsaviso" ${semAviso ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>
      ${(ctCfg().multaCancel || {}).ativo ? `<label class="liga"><span class="grow"><b>Não cobrar a multa</b><span class="s">Mesmo que o contrato preveja.</span></span><input type="checkbox" role="switch" id="dsmulta" ${semMulta ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>` : ''}
      <div class="actions"><button class="btn ghost" id="dsrec">Não confirmar</button><button class="btn" id="dsok">Confirmar cancelamento</button></div>` : ''}
    ${d.status === 'confirmado' ? `<div class="actions"><button class="btn ghost" id="dsver">Ver o termo</button><button class="btn" id="dsenc">Encerrar a matrícula</button></div>
      ${d.assinatura ? '' : '<div class="note">A família ainda não assinou. Dá para encerrar assim mesmo: fica registrado que ela pediu pelo app.</div>'}` : ''}
    ${d.status === 'encerrado' ? `<button class="btn ghost" id="dsver" style="width:100%">Ver o termo${d.assinatura ? ' assinado' : ''}</button>` : ''}
    <div class="err" id="dserr" role="alert"></div><button class="btn ghost" data-fechar>Fechar</button>`, s => {
      if ($('dsaviso')) $('dsaviso').onchange = () => { semAviso = $('dsaviso').checked; desenhar(); };
      if ($('dsmulta')) $('dsmulta').onchange = () => { semMulta = $('dsmulta').checked; desenhar(); };
      if ($('dsrec')) $('dsrec').onclick = () => confirmar('Não confirmar o pedido?', 'O pedido fica como "a família desistiu". Use quando conversaram e a família vai continuar.', 'Não confirmar', async () => {
        await B.set(`escolas/${S.eid}/destratos/${did}`, { status: 'desistiu', desistiuEm: Date.now(), desistiuPor: EU.nome || EU.email || '' }, { merge: true }); aviso('Pedido encerrado'); fecharSheet(); });
      if ($('dsok')) $('dsok').onclick = () => duploToque($('dsok'), async () => { const { k } = corpo(), dd = { ...d, ultimo: k.ultimo, fim: k.fim, multa: k.multa, totalDevido: k.totalDevido, dispensouAviso: semAviso };
        const ops = [{ op: 'merge', p: `escolas/${S.eid}/destratos/${did}`, d: { status: 'confirmado', confirmadoEm: Date.now(), confirmadoPor: EU.nome || EU.email || '', ultimo: k.ultimo, fim: k.fim, aviso: k.aviso, multa: k.multa, meses: k.meses, totalDevido: k.totalDevido, dispensouAviso: semAviso, termo: termoDestrato(d.alid, dd) } },
          // a última mensalidade é a do fim do aviso: daí em diante o app não cobra mais
          { op: 'merge', p: `escolas/${S.eid}/alunas/${d.alid}`, d: { fim: k.fim, saida: k.ultimo } }];
        if (k.multa > 0) ops.push({ op: 'set', p: `escolas/${S.eid}/extras/${novoId()}`, d: { tipo: 'taxa', nome: 'Multa de cancelamento', v: k.multa, venc: somaDias(hoje(), 7), alunas: [d.alid], valores: {}, grupos: [], turmas: [], recebedor: 'escola', nota: false, cancelamento: did, criadoEm: Date.now() } });
        try { await B.lote(ops); aviso('Cancelamento confirmado. A família assina o termo no app.'); setTimeout(() => sheetDestrato(did), 80); } catch (e) { $('dserr').textContent = msgErro(e); } }, 'Toque de novo para confirmar');
      if ($('dsenc')) $('dsenc').onclick = () => duploToque($('dsenc'), async () => {
        try { await B.lote([{ op: 'merge', p: `escolas/${S.eid}/destratos/${did}`, d: { status: 'encerrado', encerradoEm: Date.now(), encerradoPor: EU.nome || EU.email || '', semAssinatura: !d.assinatura } },
          { op: 'merge', p: `escolas/${S.eid}/alunas/${d.alid}`, d: { ativa: false, fim: d.fim, saida: d.ultimo } }]); aviso('Matrícula encerrada'); setTimeout(() => sheetDestrato(did), 80); } catch (e) { $('dserr').textContent = msgErro(e); } }, 'Toque de novo para encerrar');
      if ($('dsver')) $('dsver').onclick = () => abrirDe(() => sheetDestrato(did), () => sheetVerDestrato(did));
    }); };
  desenhar();
}
// o termo (para a família assinar ou para ver depois) e o PDF
function sheetVerDestrato(did, assinar) {
  const d = (S.destratos || {})[did]; if (!d || !d.termo) return; const a = S.alunas[d.alid] || {}, r = respDe(d.alid) || {}, as = d.assinatura;
  sheet(`<h3>Termo de cancelamento</h3>
    ${as ? `<div class="banner ok"><span>Assinado por <b>${esc(as.nome)}</b>${as.cpf ? `, CPF ${esc(fmtCpf(as.cpf))}` : ''}, em ${esc(new Date(as.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}.</span></div>` : d.semAssinatura ? '<div class="banner"><span>Encerrado pela escola sem a assinatura do termo. A família pediu o cancelamento pelo app.</span></div>' : ''}
    ${textoContratoHTML(d.termo)}
    ${assinar && !as ? `<div class="field"><label for="dtnome">Seu nome completo</label><input id="dtnome" maxlength="80" value="${esc(r.nome || '')}"></div>
      <label class="check aceite"><input type="checkbox" id="dtok"><span>Li e concordo com o cancelamento da matrícula de ${esc(a.nome || '')}.</span></label>
      <div class="err" id="dterr" role="alert"></div>
      <div class="actions"><button class="btn ghost" data-fechar>Depois</button><button class="btn" id="dtass">Assinar</button></div>`
      : `<div class="actions"><button class="btn ghost" data-fechar>Fechar</button><button class="btn" id="dtpdf">Baixar PDF</button></div>`}`, () => {
    if ($('dtpdf')) $('dtpdf').onclick = async () => { try { baixarPdf(await pdfContrato({ ...(as || {}), nome: as ? as.nome : '(sem assinatura)', cpf: as ? as.cpf : '', em: as ? as.em : d.encerradoEm || d.confirmadoEm, email: as ? as.email : '', uid: as ? as.uid : '', versao: 1, texto: d.termo, alid: d.alid })); } catch (e) { aviso(msgErro(e)); } };
    if ($('dtass')) $('dtass').onclick = () => { const nome = $('dtnome').value.trim();
      if (nome.split(/\s+/).length < 2) return $('dterr').textContent = 'Digite o seu nome completo.'; if (!$('dtok').checked) return $('dterr').textContent = 'Marque que leu e concorda.';
      duploToque($('dtass'), async () => { try { await B.set(`escolas/${S.eid}/destratos/${did}`, { assinatura: { nome, cpf: C.soDigitos(r.cpf), uid: EU.uid, email: EU.email || '', em: Date.now() } }, { merge: true }); aviso('Termo assinado'); fecharSheet(); }
        catch (e) { $('dterr').textContent = msgErro(e); } }, 'Toque de novo para assinar'); };
  });
}
// avisos: para a escola (pedidos a confirmar) e para a família (termo a assinar)
const DTR_AUTO = new Set();
function avisoDestratosAdm() {
  if (!S.admin) return '';
  // passou o último dia de um cancelamento confirmado: o aluno fica inativo sozinho (fica registrado se foi sem assinatura)
  Object.entries(S.destratos || {}).filter(([did, d]) => d.status === 'confirmado' && d.ultimo < hoje() && !DTR_AUTO.has(did)).forEach(([did, d]) => { DTR_AUTO.add(did);
    B.lote([{ op: 'merge', p: `escolas/${S.eid}/destratos/${did}`, d: { status: 'encerrado', encerradoEm: Date.now(), encerradoPor: 'automático (fim do aviso)', semAssinatura: !d.assinatura } },
      { op: 'merge', p: `escolas/${S.eid}/alunas/${d.alid}`, d: { ativa: false, fim: d.fim, saida: d.ultimo } }]).catch(() => DTR_AUTO.delete(did)); });
  return Object.entries(S.destratos || {}).filter(([, d]) => d.status === 'pedido' || (d.status === 'confirmado' && d.ultimo < hoje())).map(([did, d]) => { const a = S.alunas[d.alid] || {};
    return `<button class="faixa-resumo alerta" data-dtr="${esc(did)}"><span class="grow"><b>${d.status === 'pedido' ? `Pedido de cancelamento: ${esc(a.nome || '')}` : `Encerrar a matrícula de ${esc(primeiro(a.nome || ''))}`}</b><span class="s">${d.status === 'pedido' ? `Pedido em ${dataBR(isoDia(d.pedidoEm))} · confirme ou converse com a família` : `O último dia foi ${dataBR(d.ultimo)}`}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`; }).join('');
}
function avisoDestratosFam() {
  return porNome(S.alunas).map(([id, a]) => { const x = dtrDe(id); return x && x[1].status === 'confirmado' && !x[1].assinatura ? `<button class="faixa-resumo" data-dtrass="${esc(x[0])}"><span class="grow"><b>Assinar o cancelamento de ${esc(primeiro(a.nome))}</b><span class="s">A escola confirmou. Último dia: ${dataBR(x[1].ultimo)}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>` : ''; }).join('');
}
// linha "Matrícula" em Meus filhos e no perfil do aluno
function linhaMatricula(id, adm) {
  const x = dtrDe(id), d = x && x[1];
  if (!d) return adm ? `<button type="button" class="plinha" data-dtrnovo="${esc(id)}"><span class="grow">Cancelar matrícula</span><span class="seta" aria-hidden="true">›</span></button>`
    : `<span class="dd-col"><span class="chip pago">Ativa</span><button type="button" class="link" data-dtrpedir="${esc(id)}">Pedir cancelamento</button></span>`;
  const txt = d.status === 'pedido' ? 'Cancelamento pedido' : d.status === 'confirmado' ? `Cancelada · até ${dataBR(d.ultimo)}` : `Encerrada ${dataBR(d.ultimo)}`;
  if (adm) return `<button type="button" class="plinha" data-dtr="${esc(x[0])}"><span class="grow">Matrícula</span><span class="chip ${d.status === 'encerrado' ? '' : 'vencido'}">${txt}</span><span class="seta" aria-hidden="true">›</span></button>`;
  return `<span class="dd-col"><span class="chip ${d.status === 'encerrado' ? '' : 'vencido'}">${txt}</span>${d.status === 'pedido' ? `<button type="button" class="link" data-dtrdesiste="${esc(x[0])}">Desistir do cancelamento</button>` : ''}${d.status === 'confirmado' && !d.assinatura ? `<button type="button" class="link" data-dtrass="${esc(x[0])}">Assinar o termo</button>` : ''}${d.termo && (d.assinatura || d.status === 'encerrado') ? `<button type="button" class="link" data-dtrver="${esc(x[0])}">Ver o termo</button>` : ''}</span>`;
}
// cliques dos botões de cancelamento (em qualquer tela)
document.addEventListener('click', e => {
  const b = e.target.closest('[data-dtr],[data-dtrass],[data-dtrpedir],[data-dtrnovo],[data-dtrdesiste],[data-dtrver]'); if (!b || !S) return;
  if (b.dataset.dtr) return sheetDestrato(b.dataset.dtr);
  if (b.dataset.dtrass) return sheetVerDestrato(b.dataset.dtrass, true);
  if (b.dataset.dtrver) return sheetVerDestrato(b.dataset.dtrver);
  if (b.dataset.dtrpedir) return sheetPedirCancel(b.dataset.dtrpedir);
  if (b.dataset.dtrnovo) return sheetPedirCancel(b.dataset.dtrnovo, true);
  if (b.dataset.dtrdesiste) return confirmar('Desistir do cancelamento?', 'A matrícula continua normalmente.', 'Desistir', async () => { await B.set(`escolas/${S.eid}/destratos/${b.dataset.dtrdesiste}`, { status: 'desistiu', desistiuEm: Date.now() }, { merge: true }); aviso('Pronto: a matrícula continua'); });
});
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
async function prepararAtestado(arq, o = {}) {
  const maxImg = o.img || ATEST_MAX_IMG, oque = o.oque || 'atestado';
  if (!arq) throw new Error('Escolha um arquivo.');
  if (arq.type === 'application/pdf' || /\.pdf$/i.test(arq.name || '')) {
    if (arq.size > ATEST_MAX_PDF) throw new Error(`Esse PDF tem ${kb(arq.size)}. Tire uma foto do ${oque} (o app reduz sozinho) ou mande um PDF de até ${kb(ATEST_MAX_PDF)}.`);
    return { arquivo: await lerDataUrl(arq), tipo: 'pdf', nome: arq.name || oque + '.pdf', tam: arq.size, original: arq.size };
  }
  if (!/^image\//.test(arq.type || '')) throw new Error('Escolha uma foto ou um PDF.');
  let fonte = await abrirImagem(arq, 1600), url = '';
  for (let lado = 1600; lado >= 700; lado = Math.round(lado * 0.8)) {
    const f = Math.min(1, lado / Math.max(fonte.width, fonte.height)), c = document.createElement('canvas');
    c.width = Math.round(fonte.width * f); c.height = Math.round(fonte.height * f);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(fonte, 0, 0, c.width, c.height);
    for (const q of [0.72, 0.6, 0.5]) { url = c.toDataURL('image/jpeg', q); if (url.length * 0.75 <= maxImg) break; }
    if (url.length * 0.75 <= maxImg) break;
  }
  return { arquivo: url, tipo: 'img', nome: (arq.name || oque).replace(/\.\w+$/, '') + '.jpg', tam: Math.round(url.length * 0.75), original: arq.size };
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
  const nome = `atestado-${(primeiro((S.alunas[alid] || {}).nome) || 'aluno').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()}.${f.tipo === 'pdf' ? 'pdf' : 'jpg'}`;
  return abrirArquivo(f, nome, 'Atestado médico', 'Atestado salvo');
}
// foto: abre grande por cima, com botão de salvar; PDF: salva (no celular, abre o compartilhar)
async function abrirArquivo(f, nome, alt, msg) {
  const tipo = f.tipo === 'pdf' ? 'application/pdf' : 'image/jpeg';
  if (f.tipo !== 'pdf') {
    const el = document.createElement('div'); el.className = 'doc-legal-bg atest-zoom';
    el.innerHTML = `<div class="atest-zoom-box"><img src="${f.arquivo}" alt="${esc(alt)}"><div class="actions"><button type="button" class="btn ghost" data-z="0">Fechar</button><button type="button" class="btn" data-z="1">Salvar no celular</button></div></div>`;
    document.body.appendChild(el);
    el.onclick = async e => { const b = e.target.closest('[data-z]'); if (e.target === el || (b && b.dataset.z === '0')) return el.remove(); if (b) { const r = await salvarArquivo(nome, bytesDe(f.arquivo), tipo); if (r !== 'cancelado') aviso(msg); } };
    return;
  }
  const r = await salvarArquivo(nome, bytesDe(f.arquivo), tipo); if (r !== 'cancelado') aviso(msg);
}
const carregarAtestado = alid => B.get(`escolas/${S.eid}/atestados/${alid}`).catch(() => null);

// ---- Documentos dos alunos: parecer cardiológico, identidade e outros que a escola quiser ----
// Tipos (a escola escolhe): config/geral.tiposDoc = [{ id, nome, meses (0 = sem validade), familia (a família envia pelo app) }]
// Situação de cada aluno (leve, para listas): escolas/{eid}/docsAlunos/{alid} = { responsavelId, docs: { tipo: { em, por, familia, data, validade, formato, paginas, tam } } }
// Arquivo: escolas/{eid}/documentos/{alid}__{tipo} = { alid, tipo, responsavelId, formato ('img' | 'pdf'), arquivos: [até 2 fotos ou 1 PDF], nome, em }
const TIPOS_DOC_PADRAO = [{ id: 'cardio', nome: 'Parecer cardiológico', meses: 12, familia: true }, { id: 'ident', nome: 'Documento de identidade', meses: 0, familia: true }];
const SUGESTOES_DOC = ['Certidão de nascimento', 'Atestado médico', 'Declaração escolar', 'Foto 3x4', 'Comprovante de residência', 'Autorização de viagem'];
const VALIDADES_DOC = [[0, 'Sem validade'], [6, '6 meses'], [12, '1 ano'], [24, '2 anos']];
const DOC_AVISO_DIAS = 30, DOC_MAX_1 = 380 * 1024, DOC_MAX_2 = 320 * 1024;
const tiposDoc = () => Array.isArray(S.cfg.tiposDoc) ? S.cfg.tiposDoc : TIPOS_DOC_PADRAO;
const tipoDoc = tid => tid === '_atest' ? { id: '_atest', nome: 'Atestado médico (do termo)', meses: 12 } : tid === '_outros' ? { id: '_outros', nome: 'Outros documentos', meses: 0 } : tiposDoc().find(t => t.id === tid) || avulsoMeta(tid) || { id: tid, nome: 'Documento', meses: 0 };
// documento avulso: guardado só para um aluno, com o nome que a escola quiser (fora dos tipos da escola)
const ehAvulso = tid => !!tid && tid[0] === 'x' && !tiposDoc().some(t => t.id === tid);
function avulsoMeta(tid) { for (const x of Object.values((S && S.docs) || {})) { const m = x && x.docs && x.docs[tid]; if (m && m.nome) return { id: tid, nome: m.nome, meses: 0, avulso: true, familia: false }; } return null; }
const avulsosDe = alid => Object.entries((((S.docs || {})[alid] || {}).docs) || {}).filter(([k, m]) => m && ehAvulso(k)).sort((x, y) => String(x[1].nome).localeCompare(String(y[1].nome), 'pt-BR')).map(([k]) => k);
const docsDoAluno = alid => [...tiposDoc().map(t => t.id), ...avulsosDe(alid)];
const docDe = (alid, tid) => ((((S.docs || {})[alid] || {}).docs) || {})[tid] || null;
const dataBRA = iso => iso ? `${dataBR(iso)}/${iso.slice(0, 4)}` : '';
const mesesTxt = n => n === 12 ? '1 ano' : n === 24 ? '2 anos' : n % 12 === 0 ? `${n / 12} anos` : `${n} meses`;
function maisMeses(iso, n) { const d = new Date(iso + 'T12:00'), dia = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(dia, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return isoDe(d); }
// falta, vencido, vence (nos próximos 30 dias) ou ok
function situacaoDoc(d) {
  if (!d) return { st: 'falta' };
  if (!d.validade) return { st: 'ok' };
  const dias = Math.round((new Date(d.validade + 'T12:00') - new Date(hoje() + 'T12:00')) / 864e5);
  return { st: dias < 0 ? 'vencido' : dias <= DOC_AVISO_DIAS ? 'vence' : 'ok', dias };
}
function chipDoc(d) {
  const s = situacaoDoc(d);
  if (s.st === 'falta') return '<span class="chip aberto">Falta</span>';
  if (s.st === 'vencido') return `<span class="chip vencido">Venceu ${esc(dataBRA(d.validade))}</span>`;
  if (s.st === 'vence') return `<span class="chip vencido">Vence ${s.dias === 0 ? 'hoje' : s.dias === 1 ? 'amanhã' : `em ${s.dias} dias`}</span>`;
  return d.validade ? `<span class="chip pago">Até ${esc(dataBRA(d.validade))}</span>` : '<span class="chip pago">Guardado</span>';
}
// o pior caso entre os documentos de um aluno (para a etiqueta na lista)
function piorDoc(alid) {
  let pior = null;
  for (const t of docsDoAluno(alid)) { const s = situacaoDoc(docDe(alid, t)).st; if (s === 'vencido') return 'vencido'; if (s === 'vence') pior = 'vence'; }
  return pior;
}
// atestado médico do termo (para juntar junto, se a escola quiser)
function atestadoMeta(alid) {
  const at = ((S.saude[alid] || {}).atestado) || {}, em = at.recebidoEm || at.enviadoEm;
  return em && !(at.recusa && at.recusa.em > (at.enviadoEm || 0)) ? { em, validade: isoDe(new Date(em + ANO_MS)), formato: null } : null;
}
// apagar os documentos de um aluno (exclusão ou LGPD)
const opsApagarDocs = alid => [{ op: 'del', p: `escolas/${S.eid}/fotosAlunos/${alid}` }, ...opsApagarDocs0(alid)];
const opsApagarDocs0 = alid => S.docs[alid] ? [...Object.keys(S.docs[alid].docs || {}).map(t => ({ op: 'del', p: `escolas/${S.eid}/documentos/${alid}__${t}` })), { op: 'del', p: `escolas/${S.eid}/docsAlunos/${alid}` }] : [];
// "Outros documentos" vira os documentos avulsos de cada aluno
const expandeTipos = (alid, tids) => tids.flatMap(t => t === '_outros' ? avulsosDe(alid) : [t]);
const metaJunta = (alid, tid) => tid === '_atest' ? atestadoMeta(alid) : docDe(alid, tid);
async function arquivosDoc(alid, tid) {
  if (tid === '_atest') { const f = await carregarAtestado(alid); return f && f.arquivo ? { formato: f.tipo === 'pdf' ? 'pdf' : 'img', arquivos: [f.arquivo] } : null; }
  return B.get(`escolas/${S.eid}/documentos/${alid}__${tid}`).catch(() => null);
}
function previaDoc(f) {
  if (!f || !(f.arquivos || []).length) return '<div class="sub">Arquivo não encontrado.</div>';
  if (f.formato === 'pdf') return `<div class="atest-pdf"><span class="atest-ic" aria-hidden="true">PDF</span><span class="grow"><b>${esc(f.nome || 'documento.pdf')}</b><span class="s">${kb(f.tam || Math.round(f.arquivos[0].length * 0.75))}</span></span><button type="button" class="btn ghost btn-mini" data-dabrir="0">Abrir</button></div>`;
  return `<div class="doc-fotos">${f.arquivos.map((u, i) => `<img class="atest-img" src="${u}" alt="${i ? 'Verso' : 'Frente'} do documento" data-dabrir="${i}">`).join('')}</div>`;
}
const nomeArqDoc = (alid, tid, ext) => `${tipoDoc(tid).nome} ${(S.alunas[alid] || {}).nome || 'aluno'}.${ext}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .-]/g, '');
function ligarPreviaDoc(raiz, f, alid, tid) {
  raiz.querySelectorAll('[data-dabrir]').forEach(b => b.onclick = () => {
    const u = f.arquivos[Number(b.dataset.dabrir)];
    abrirArquivo({ arquivo: u, tipo: f.formato === 'pdf' ? 'pdf' : 'img' }, nomeArqDoc(alid, tid, f.formato === 'pdf' ? 'pdf' : 'jpg'), tipoDoc(tid).nome, 'Documento salvo');
  });
}

// "escanear": depois da foto, acha as bordas do documento, deixa ajustar os 4 cantos e endireita (scanner.js)
async function ajustarFoto(arq) {
  if (!arq || !/^image\//.test(arq.type || '') || !window.Scanner) return arq;
  let fonte; try { fonte = await abrirImagem(arq, 2000); } catch (e) { return arq; }
  const W = fonte.width, H = fonte.height; let q = null;
  try { q = Scanner.detectar(fonte); } catch (e) { q = null; }
  const achou = !!q; if (!q) q = [{ x: W * .06, y: H * .06 }, { x: W * .94, y: H * .06 }, { x: W * .94, y: H * .94 }, { x: W * .06, y: H * .94 }];
  let modo = 'cor';
  return new Promise(ok => {
    const el = document.createElement('div'); el.className = 'scan'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Ajustar o documento');
    el.innerHTML = `<div class="scan-topo"><button type="button" class="scan-bt" data-s="cancela">Cancelar</button><span class="scan-tit">${achou ? 'Confira os cantos' : 'Arraste os cantos até as bordas'}</span><button type="button" class="scan-bt forte" data-s="ok">Pronto</button></div>
      <div class="scan-palco"><canvas></canvas><svg aria-hidden="true"><polygon></polygon></svg>${[0, 1, 2, 3].map(i => `<div class="scan-canto" data-c="${i}" aria-hidden="true"></div>`).join('')}</div>
      <div class="scan-baixo"><div class="scan-modos">${[['cor', 'Cor'], ['realce', 'Realçado']].map(([k, n]) => `<button type="button" data-m="${k}" aria-pressed="${k === modo}">${n}</button>`).join('')}</div>
        <button type="button" class="scan-bt" data-s="inteira">Usar a foto inteira</button></div>`;
    document.body.appendChild(el);
    const palco = el.querySelector('.scan-palco'), cv = el.querySelector('canvas'), pol = el.querySelector('polygon'), cantos = [...el.querySelectorAll('.scan-canto')];
    let s = 1, ox = 0, oy = 0;
    const desenhar = () => {
      const pw = palco.clientWidth, ph = palco.clientHeight; s = Math.min(pw / W, ph / H); const cw = W * s, ch = H * s; ox = (pw - cw) / 2; oy = (ph - ch) / 2;
      const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
      Object.assign(cv.style, { width: cw + 'px', height: ch + 'px', left: ox + 'px', top: oy + 'px' }); cv.getContext('2d').drawImage(fonte, 0, 0, cv.width, cv.height); posicionar(); };
    const posicionar = () => { cantos.forEach((c, i) => { c.style.left = (ox + q[i].x * s) + 'px'; c.style.top = (oy + q[i].y * s) + 'px'; }); pol.setAttribute('points', q.map(p => `${ox + p.x * s},${oy + p.y * s}`).join(' ')); };
    desenhar(); const aoGirar = () => desenhar(); window.addEventListener('resize', aoGirar);
    let ativo = -1;
    palco.addEventListener('pointerdown', e => { const c = e.target.closest('.scan-canto'); if (!c) return; ativo = Number(c.dataset.c); c.classList.add('arrasta'); palco.setPointerCapture(e.pointerId); e.preventDefault(); });
    palco.addEventListener('pointermove', e => { if (ativo < 0) return; const r = palco.getBoundingClientRect();
      q[ativo] = { x: Math.max(0, Math.min(W, (e.clientX - r.left - ox) / s)), y: Math.max(0, Math.min(H, (e.clientY - r.top - oy) / s)) }; posicionar(); });
    const solta = () => { if (ativo >= 0) cantos[ativo].classList.remove('arrasta'); ativo = -1; };
    palco.addEventListener('pointerup', solta); palco.addEventListener('pointercancel', solta);
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { modo = b.dataset.m; el.querySelectorAll('[data-m]').forEach(x => x.setAttribute('aria-pressed', x.dataset.m === modo)); });
    const fechar = v => { window.removeEventListener('resize', aoGirar); el.remove(); ok(v); };
    const gerar = async inteira => {
      el.querySelector('.scan-tit').textContent = 'Preparando…';
      await new Promise(r => setTimeout(r, 30));
      let c = fonte;
      if (!inteira) { const cx = q.reduce((a, p) => a + p.x, 0) / 4, cy = q.reduce((a, p) => a + p.y, 0) / 4; // um fio para dentro: sem sobra do fundo na borda
        c = Scanner.endireitar(fonte, Scanner.ordenar(q.map(p => ({ x: p.x + (cx - p.x) * 0.006, y: p.y + (cy - p.y) * 0.006 }))), 1800); }
      if (modo === 'realce') c = Scanner.realcar(c);
      c.toBlob(b => fechar(b ? new File([b], (arq.name || 'documento').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : arq), 'image/jpeg', 0.9);
    };
    el.querySelector('[data-s="cancela"]').onclick = () => fechar(null);
    el.querySelector('[data-s="ok"]').onclick = () => gerar(false);
    el.querySelector('[data-s="inteira"]').onclick = () => gerar(true);
  });
}
// guardar ou ver um documento de um aluno (escola ou família)
function sheetDocAluno(alid, tid, volta) {
  const avulso = !tid || ehAvulso(tid);
  if (!tid) tid = 'x' + novoId().replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
  const a = S.alunas[alid] || {}, d0 = docDe(alid, tid), T = avulso ? { id: tid, nome: (d0 && d0.nome) || 'Outro documento', meses: 0, familia: false } : tipoDoc(tid), adm = !!S.admin, s0 = situacaoDoc(d0);
  let novos = [], valMexida = !!(d0 && d0.validade && d0.data && T.meses && d0.validade !== maisMeses(d0.data, T.meses));
  const ehPdf = () => novos.length && novos[0].tipo === 'pdf';
  sheet(`<h3>${esc(T.nome)}</h3><div class="sub">${esc(a.nome || '')}</div>
    ${avulso && adm ? `<div class="field"><label for="dnome">Nome do documento</label><input id="dnome" maxlength="50" value="${esc((d0 && d0.nome) || '')}" placeholder="Ex.: Carteirinha da federação"><span class="sub">Fica guardado só para ${esc(primeiro(a.nome || 'este aluno'))}. Para pedir a todos os alunos, use os tipos de documento em Ajustes.</span></div>` : ''}
    ${d0 ? `<div class="field"><span class="lb">Guardado</span><div class="doc-box" id="dgprev"><div class="sub">Carregando…</div></div>
      <div class="doc-meta">${chipDoc(d0)}<span class="sub">Enviado em ${esc(dataCurta(d0.em))} ${d0.familia ? 'pela família' : 'pela escola'}${d0.data ? ` · documento de ${esc(dataBRA(d0.data))}` : ''}</span></div></div>`
      : avulso ? '' : `<div class="sub">${adm ? (T.familia === false ? 'Tire uma foto do documento ou escolha o PDF.' : 'A família também pode enviar pelo app, em Meus filhos. Ou tire a foto aqui do documento que você recebeu.') : 'Tire uma foto do documento inteiro, bem legível. Se tiver frente e verso, mande as duas.'}</div>`}
    ${d0 && s0.st !== 'ok' && !adm ? `<div class="aviso-lei"><b>${s0.st === 'vencido' ? 'Este documento venceu' : 'Este documento vence logo'}</b><span>Mande um novo para a escola.</span></div>` : ''}
    <div class="field" id="dnovo" hidden><span class="lb">${d0 ? 'Novo' : 'Documento'}</span><div class="doc-box" id="dnprev"></div><div class="sub num" id="dtam"></div></div>
    <div class="doc-botoes"><span class="btn ${d0 ? 'ghost' : ''} toque-arquivo" id="dbtn">${d0 ? 'Trocar o documento' : 'Tirar foto ou escolher arquivo'}<input type="file" id="darq" accept="image/*,application/pdf" aria-label="Escolher o documento"></span>
      <span class="btn ghost toque-arquivo" id="dversob" hidden>+ Foto do verso<input type="file" id="dverso" accept="image/*" aria-label="Foto do verso"></span></div>
    <div class="two"><div class="field"><label for="ddata">Data do documento</label><input type="date" id="ddata" max="${hoje()}" value="${esc((d0 && d0.data) || '')}"></div>
    ${T.meses || avulso ? `<div class="field"><label for="dval">Válido até${avulso ? ' (se tiver)' : ''}</label><input type="date" id="dval" value="${esc((d0 && d0.validade) || '')}"></div>` : '<div></div>'}</div>
    ${T.meses ? `<div class="note">Vale ${mesesTxt(T.meses)} a partir da data do documento. Se estiver escrito outro prazo, mude o "Válido até".</div>` : ''}
    <div class="err" id="derr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Fechar</button><button type="button" class="btn" id="dok" ${d0 ? '' : 'hidden'}>${adm ? 'Guardar' : 'Enviar para a escola'}</button></div>
    ${d0 && adm ? '<button type="button" class="btn ghost" id="ddel" style="color:var(--out)">Apagar este documento</button>' : ''}`, sh => {
    if (volta) SHEET_VOLTAR = volta;
    const err = m => { $('derr').textContent = m || ''; };
    if (d0) arquivosDoc(alid, tid).then(f => { if (!$('dgprev')) return; $('dgprev').innerHTML = previaDoc(f); if (f) ligarPreviaDoc($('dgprev'), f, alid, tid); });
    const verNovos = () => {
      $('dnovo').hidden = !novos.length; $('dok').hidden = !novos.length && !d0;
      const f = { formato: ehPdf() ? 'pdf' : 'img', arquivos: novos.map(n => n.arquivo), nome: novos[0] && novos[0].nome, tam: novos.reduce((s, n) => s + n.tam, 0) };
      $('dnprev').innerHTML = novos.length ? previaDoc(f) : ''; if (novos.length) ligarPreviaDoc($('dnprev'), f, alid, tid);
      $('dtam').textContent = novos.length && !ehPdf() ? `${novos.length === 2 ? 'Frente e verso · ' : ''}${kb(f.tam)}` : '';
      $('dversob').hidden = !(novos.length === 1 && !ehPdf());
      $('dbtn').firstChild.textContent = novos.length ? 'Escolher outro' : (d0 ? 'Trocar o documento' : 'Tirar foto ou escolher arquivo');
      $('dbtn').classList.toggle('ghost', !!(novos.length || d0));
    };
    const ler = async (arq, max) => { err(''); try { return await prepararAtestado(arq, { img: max, oque: 'documento' }); } catch (e) { err(e.message); return null; } };
    let frente = null; // a foto original da frente, para reduzir mais se vier o verso
    $('darq').onchange = async e => { let arq = e.target.files[0]; e.target.value = ''; if (!arq) return; arq = await ajustarFoto(arq); if (!arq) return; const n = await ler(arq, DOC_MAX_1); if (n) { novos = [n]; frente = arq; verNovos(); } };
    $('dverso').onchange = async e => { let arq = e.target.files[0]; e.target.value = ''; if (!arq || !novos.length) return; arq = await ajustarFoto(arq); if (!arq) return;
      // com duas fotos, cada uma fica um pouco menor para caber no mesmo documento
      const n = await ler(arq, DOC_MAX_2); if (!n) return;
      if (novos[0].tam > DOC_MAX_2 && frente) { const r = await ler(frente, DOC_MAX_2); if (r) novos[0] = r; }
      if (novos[0].tam + n.tam > 2 * DOC_MAX_2 + 60 * 1024) return err('As duas fotos ficaram grandes demais. Tente tirar de novo, mais de perto.');
      novos = [novos[0], n]; verNovos(); };
    if (T.meses) {
      $('ddata').addEventListener('input', () => { const v = $('ddata').value; if (v && !valMexida) $('dval').value = maisMeses(v, T.meses); });
      $('dval').addEventListener('input', () => { valMexida = true; });
    }
    [$('ddata'), $('dval'), $('dnome')].filter(Boolean).forEach(el => el.addEventListener('input', () => { $('dok').hidden = false; }));
    if ($('dnome') && !d0) setTimeout(() => $('dnome').focus(), 60);
    $('dok').onclick = async () => {
      const data = $('ddata').value || null, validade = T.meses || avulso ? ($('dval').value || null) : null, nomeAv = $('dnome') ? $('dnome').value.trim() : '';
      if (avulso && adm && !nomeAv) return err('Dê um nome ao documento.');
      if (!novos.length && !d0) return err('Escolha a foto ou o PDF do documento.');
      if (data && data > hoje()) return err('A data do documento não pode ser depois de hoje.');
      if (validade && data && validade < data) return err('O "Válido até" não pode ser antes da data do documento.');
      if (T.meses && !validade && adm) return err('Informe até quando o documento vale.');
      if (T.meses && !validade && !data) return err('Informe a data do documento (está escrita nele).');
      $('dok').disabled = true; $('dok').textContent = 'Guardando…';
      try {
        const agora = Date.now(), rid = a.responsavelId || null;
        const val = validade || (T.meses && data ? maisMeses(data, T.meses) : null);
        let meta = { ...(d0 || {}), data, validade: val, ...(avulso && nomeAv ? { nome: nomeAv, avulso: true } : {}) };
        if (novos.length) {
          const pdf = ehPdf(), tam = novos.reduce((s, n) => s + n.tam, 0);
          await B.set(`escolas/${S.eid}/documentos/${alid}__${tid}`, { alid, tipo: tid, responsavelId: rid, formato: pdf ? 'pdf' : 'img', arquivos: novos.map(n => n.arquivo), nome: novos[0].nome, tam, em: agora, por: EU.uid });
          meta = { ...meta, em: agora, por: EU.uid, familia: !adm, formato: pdf ? 'pdf' : 'img', paginas: novos.length, tam };
        }
        await B.set(`escolas/${S.eid}/docsAlunos/${alid}`, { responsavelId: rid, docs: { [tid]: meta } }, { merge: true });
        S.docs[alid] = { ...(S.docs[alid] || {}), responsavelId: rid, docs: { ...((S.docs[alid] || {}).docs || {}), [tid]: meta } };
        fecharSheet(); aviso(adm ? 'Documento guardado' : 'Documento enviado para a escola'); if (volta) setTimeout(volta, 60);
      } catch (e) { err(msgErro(e)); $('dok').disabled = false; $('dok').textContent = adm ? 'Guardar' : 'Enviar para a escola'; }
    };
    if ($('ddel')) $('ddel').onclick = () => confirmar('Apagar este documento?', `${esc(T.nome)} de ${esc(a.nome || '')}. O arquivo sai do app.`, 'Apagar', async () => {
      await B.del(`escolas/${S.eid}/documentos/${alid}__${tid}`); await B.tirar(`escolas/${S.eid}/docsAlunos/${alid}`, `docs.${tid}`);
      if (S.docs[alid] && S.docs[alid].docs) delete S.docs[alid].docs[tid]; aviso('Documento apagado'); if (volta) setTimeout(volta, 60);
    });
  });
}

// tipos de documento que a escola pede
function sheetTiposDoc(volta) {
  let tipos = tiposDoc().map(t => ({ ...t }));
  const usados = tid => Object.values(S.docs || {}).filter(x => x && x.docs && x.docs[tid]).length;
  const desenhar = () => {
    $('tdlista').innerHTML = tipos.map((t, i) => `<div class="tipo-doc"><div class="tipo-doc-l1"><input data-tn="${i}" maxlength="40" value="${esc(t.nome)}" placeholder="Nome do documento" aria-label="Nome do documento"><button type="button" class="ev-foto-x" data-tx="${i}" aria-label="Tirar ${esc(t.nome)}">×</button></div>
      <div class="opcoes">${VALIDADES_DOC.map(([m, n]) => `<button type="button" class="pick" data-tv="${i}:${m}" aria-pressed="${Number(t.meses || 0) === m}">${n}</button>`).join('')}</div>
      <label class="check"><input type="checkbox" data-tf="${i}" ${t.familia !== false ? 'checked' : ''}> A família envia pelo app</label></div>`).join('') || '<div class="empty">Nenhum tipo de documento.</div>';
    $('tdsug').innerHTML = SUGESTOES_DOC.filter(n => !tipos.some(t => t.nome.toLowerCase() === n.toLowerCase())).map(n => `<button type="button" class="pick" data-ts="${esc(n)}">+ ${esc(n)}</button>`).join('');
    $('tdlista').querySelectorAll('[data-tn]').forEach(e => e.oninput = () => { tipos[Number(e.dataset.tn)].nome = e.value; });
    $('tdlista').querySelectorAll('[data-tv]').forEach(b => b.onclick = () => { const [i, m] = b.dataset.tv.split(':').map(Number); tipos[i].meses = m; desenhar(); });
    $('tdlista').querySelectorAll('[data-tf]').forEach(c => c.onchange = () => { tipos[Number(c.dataset.tf)].familia = c.checked; });
    $('tdlista').querySelectorAll('[data-tx]').forEach(b => b.onclick = () => { const t = tipos[Number(b.dataset.tx)], n = t.id ? usados(t.id) : 0;
      if (n) return $('tderr').textContent = `${n === 1 ? '1 aluno tem' : `${n} alunos têm`} "${t.nome}" guardado. Apague esses documentos antes, ou só mude o nome.`;
      tipos.splice(Number(b.dataset.tx), 1); desenhar(); });
    $('tdsug').querySelectorAll('[data-ts]').forEach(b => b.onclick = () => { tipos.push({ id: '', nome: b.dataset.ts, meses: /atestado/i.test(b.dataset.ts) ? 12 : 0, familia: true }); desenhar(); });
  };
  sheet(`<h3>Documentos dos alunos</h3>
    <div class="sub">Os documentos que a escola guarda de cada aluno. Com validade, o app avisa quando estiver perto de vencer. Nenhum é obrigatório.</div>
    <div id="tdlista"></div>
    <button type="button" class="add-disc add-largo" id="tdmais">+ Outro documento</button>
    <div class="field"><span class="lb">Sugestões</span><div class="opcoes" id="tdsug"></div></div>
    <div class="err" id="tderr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn" id="tdok">Salvar</button></div>`, () => {
    if (volta) SHEET_VOLTAR = volta;
    desenhar();
    $('tdmais').onclick = () => { tipos.push({ id: '', nome: '', meses: 0, familia: true }); desenhar(); const u = $('tdlista').querySelector(`[data-tn="${tipos.length - 1}"]`); if (u) u.focus(); };
    $('tdok').onclick = async () => {
      const lim = tipos.map(t => ({ ...t, nome: String(t.nome || '').trim() }));
      if (lim.some(t => !t.nome)) return $('tderr').textContent = 'Dê um nome para cada documento, ou tire o que ficou em branco.';
      const nomes = lim.map(t => t.nome.toLowerCase()); if (new Set(nomes).size !== nomes.length) return $('tderr').textContent = 'Tem dois documentos com o mesmo nome.';
      const final = lim.map(t => ({ id: t.id || ('d' + novoId().slice(0, 8)), nome: t.nome, meses: Number(t.meses) || 0, familia: t.familia !== false }));
      $('tdok').disabled = true;
      try { await B.set(`escolas/${S.eid}/config/geral`, { tiposDoc: final }, { merge: true }); S.cfg.tiposDoc = final; fecharSheet(); aviso('Documentos salvos'); if (volta) setTimeout(volta, 60); }
      catch (e) { $('tderr').textContent = msgErro(e); $('tdok').disabled = false; }
    };
  });
}

// mensagem de WhatsApp para pedir um documento à família
function waDoc(alid, tid) {
  const a = S.alunas[alid] || {}, r = respDe(alid), T = tipoDoc(tid), d = docDe(alid, tid), s = situacaoDoc(d);
  const como = s.st === 'vencido' ? `venceu em ${dataBRA(d.validade)}` : s.st === 'vence' ? `vence em ${dataBRA(d.validade)}` : 'ainda não está no app';
  return waLink(r.telefone, `Olá, ${primeiro(r.nome || '')}! Aqui é da ${S.escola.nome || 'escola'}. O documento "${T.nome}" de ${primeiro(a.nome || '')} ${como}. Pode mandar ${s.st === 'falta' ? 'uma foto' : 'o novo'} pelo app, em Meus filhos? ${LINK_APP}`);
}
// administração: visão geral dos documentos
function sheetDocsEscola() {
  const volta = () => sheetDocsEscola(), mes = mesHoje();
  const ativos = porNome(S.alunas).filter(([, a]) => C.ativaNoMes(a, mes) && !a.anonimizadoEm);
  const linha = (alid, tid) => { const a = S.alunas[alid], wa = situacaoDoc(docDe(alid, tid)).st !== 'ok' ? waDoc(alid, tid) : '';
    return `<li class="tap" data-dal="${esc(alid)}" data-dt="${esc(tid)}"><div class="grow"><div class="t">${esc(a.nome)}</div><span class="s">${esc(tipoDoc(tid).nome)}</span></div>${chipDoc(docDe(alid, tid))}${wa ? `<a class="wa" href="${esc(wa)}" target="_blank" rel="noopener" data-nao-abre data-cobr="${esc(alid)}:pend" aria-label="Pedir pelo WhatsApp">${ICO_WA}</a>` : '<span class="wa wa-vazio" aria-hidden="true"></span>'}</li>`; };
  const alertas = [];
  for (const [alid] of ativos) for (const t of docsDoAluno(alid)) { const st = situacaoDoc(docDe(alid, t)).st; if (st === 'vencido' || st === 'vence') alertas.push([alid, t, st]); }
  alertas.sort((x, y) => (x[2] === 'vencido' ? 0 : 1) - (y[2] === 'vencido' ? 0 : 1));
  sheet(`<h3>Documentos dos alunos</h3>
    <button type="button" class="btn" id="dejunta">Lista e documentos em PDF</button>
    <div class="note">Para mandar a uma competição: escolha os alunos e os documentos, e o app junta tudo num PDF só.</div>
    ${alertas.length ? `<section><h2>Vencidos ou vencendo</h2><ul class="list">${alertas.map(([al, t]) => linha(al, t)).join('')}</ul></section>` : ''}
    <section><h2>Por documento</h2>
    ${tiposDoc().map(T => { const tem = ativos.filter(([id]) => docDe(id, T.id)), falta = ativos.filter(([id]) => !docDe(id, T.id));
      return `<details class="doc-tipo"><summary><span class="grow"><b>${esc(T.nome)}</b><span class="s num">${tem.length} guardado${tem.length === 1 ? '' : 's'} · ${falta.length} falta${falta.length === 1 ? '' : 'm'}${T.meses ? ` · vale ${mesesTxt(T.meses)}` : ''}</span></span><span class="seta" aria-hidden="true">▾</span></summary>
        <ul class="list">${[...falta, ...tem].map(([id]) => linha(id, T.id)).join('') || '<li><span class="sub">Nenhum aluno ativo.</span></li>'}</ul></details>`; }).join('')}
    </section>
    <button type="button" class="linha-botao" id="detipos"><span class="grow"><b>Mudar os tipos de documento</b><span class="s">${esc(tiposDoc().map(t => t.nome).join(', ') || 'Nenhum')}</span></span><span aria-hidden="true">›</span></button>
    <button type="button" class="btn ghost" data-fechar>Fechar</button>`, sh => {
    $('dejunta').onclick = () => abrirDe(volta, () => sheetJuntarDocs({ volta, tipos: tiposDoc().map(t => t.id) }));
    $('detipos').onclick = () => abrirDe(volta, () => sheetTiposDoc(volta));
    sh.querySelectorAll('[data-dal]').forEach(li => li.onclick = e => { if (e.target.closest('[data-nao-abre]')) return; abrirDe(volta, () => sheetDocAluno(li.dataset.dal, li.dataset.dt, volta)); });
  });
}

// juntar os documentos dos alunos marcados num PDF só (para a competição)
// informações do aluno para a lista (PDF e WhatsApp), na ordem em que aparecem
const CAMPOS_LISTA = [['idade', 'Idade'], ['nasc', 'Data de nascimento'], ['cat', 'Categoria'], ['turma', 'Turma'], ['tam', 'Tamanho do uniforme'], ['resp', 'Responsável'], ['tel', 'Telefone']];
// tamanho do uniforme do aluno: o da taxa de uniforme mais recente em que foi escolhido (de preferência a do evento da lista)
const tamDoAluno = (id, evento) => { const ok = ([k, x]) => k === evento || x.evento === evento, ts = Object.entries(S.extras || {}).filter(([, x]) => x && x.tamanhos && tamEsc(x, id)).sort((a, b) => ok(b) - ok(a) || (b[1].criadoEm || 0) - (a[1].criadoEm || 0)); return ts.length ? 'Tam. ' + tamEsc(ts[0][1], id) : ''; };
function infoAluno(id, campos, evento) {
  const a = S.alunas[id] || {}, r = respDe(id) || {}, f = {
    idade: () => idade(a.nascimento), nasc: () => a.nascimento ? dataBRA(a.nascimento) : '', cat: () => catNome(id), turma: () => turmasTxt(a),
    resp: () => r.nome || '', tel: () => r.telefone ? foneBR(r.telefone) : '', tam: () => tamDoAluno(id, evento) };
  return campos.map(c => f[c] ? f[c]() : '').filter(Boolean);
}
function sheetJuntarDocs(op = {}) {
  const selA = new Set(op.pre || []), usados = new Set();
  const temAtest = Object.keys(S.alunas).some(id => atestadoMeta(id));
  const temOutros = Object.keys(S.alunas).some(id => avulsosDe(id).length);
  const tipos = [...tiposDoc().map(t => t.id), ...(temOutros ? ['_outros'] : []), ...(temAtest ? ['_atest'] : [])], selT = new Set(op.tipos || []);
  const camposOk = CAMPOS_LISTA.filter(([k]) => (k !== 'cat' || categorias().length) && (k !== 'tam' || Object.values(S.extras || {}).some(x => x && x.tamanhos))), selC = new Set(['idade', ...(categorias().length ? ['cat'] : [])]);
  sheet(`<h3>Lista dos alunos</h3>
    <div class="sub">Escolha quem entra e o que aparece de cada um. Sai um PDF, com os documentos se quiser, para mandar à competição ou ao grupo.</div>
    <div class="field"><label for="jdtit">Para qual competição?</label><input id="jdtit" maxlength="80" value="${esc(op.titulo || '')}" placeholder="Ex.: Copa Recife Sub-11"></div>
    <div class="field"><span class="lb">O que aparece de cada aluno? (o nome sempre aparece)</span><div class="opcoes" id="jdcampos">${camposOk.map(([k, n]) => `<button type="button" class="pick" data-jc="${k}" aria-pressed="${selC.has(k)}">${n}</button>`).join('')}</div></div>
    <div class="field"><span class="lb">Anexar documentos? (opcional)</span><div class="opcoes" id="jdtipos">${tipos.map(t => `<button type="button" class="pick" data-jt="${esc(t)}" aria-pressed="${selT.has(t)}">${esc(tipoDoc(t).nome)}</button>`).join('')}</div></div>
    <div class="field"><span class="lb">Quais alunos? Toque num quadro para escolher</span><div id="jdquadros"></div></div>
    <div id="jdresumo"></div>
    <div id="jddocw" hidden><div class="field"><span class="lb">Como enviar?</span><div class="insc-ops" id="jdmodo">${[['um', 'Um PDF só', 'Todos os documentos juntos, num arquivo.'], ['sep', 'Um arquivo para cada documento', 'Cada documento num PDF com o nome do aluno. Vão todos de uma vez.']].map(([k, n, d]) => `<button type="button" class="insc-op" data-jm="${k}" aria-pressed="${k === 'um'}"><span class="insc-bola" aria-hidden="true"></span><span class="grow"><b>${n}</b><span class="s">${d}</span></span></button>`).join('')}</div></div>
    <label class="check"><input type="checkbox" id="jdcapa" checked> <span id="jdcapat">Primeira página com a lista dos alunos</span></label></div>
    <div class="err" id="jderr" role="alert"></div>
    <div id="jdpronto"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Fechar</button><button type="button" class="btn" id="jdok">Gerar PDF</button></div>
    <div class="note">Depois de gerar, toque em Enviar. No celular, o compartilhar abre: escolha o WhatsApp ou o e-mail. No computador, os arquivos são baixados.</div>`, sh => {
    if (op.volta) SHEET_VOLTAR = op.volta;
    const resumo = () => {
      const al = [...selA].filter(id => S.alunas[id]), ts = tipos.filter(t => selT.has(t));
      let tem = 0; const faltam = [], vencidos = [];
      for (const id of al) for (const t of expandeTipos(id, ts)) { const m = metaJunta(id, t), st = situacaoDoc(m).st; if (!m) faltam.push([id, t]); else { tem++; if (st === 'vencido') vencidos.push([id, t]); } }
      const nomes = l => l.slice(0, 6).map(([id, t]) => `${primeiro(S.alunas[id].nome)} (${tipoDoc(t).nome.toLowerCase()})`).join(', ') + (l.length > 6 ? ` e mais ${l.length - 6}` : '');
      $('jddocw').hidden = !ts.length;
      if (al.length && !ts.length) { $('jdresumo').innerHTML = `<div class="faixa-card" style="background:var(--bg)"><b class="num">${al.length} aluno${al.length === 1 ? '' : 's'} na lista</b><span class="s">Sem documentos: o PDF é só a lista.</span></div>`; return; }
      $('jdresumo').innerHTML = !al.length || !ts.length ? '' : `<div class="faixa-card" style="background:var(--bg)"><b class="num">${al.length} aluno${al.length === 1 ? '' : 's'} · ${tem} documento${tem === 1 ? '' : 's'} no PDF</b>
        ${faltam.length ? `<span class="s">Faltam ${faltam.length}: ${esc(nomes(faltam))}. Na lista da primeira página aparece "falta".</span>` : '<span class="s">Todos os documentos estão no app.</span>'}
        ${vencidos.length ? `<span class="s" style="color:var(--out);font-weight:700">Vencidos: ${esc(nomes(vencidos))}.</span>` : ''}</div>`;
    };
    const sel = seletorAtletas($('jdquadros'), { quadros: quadrosDe(selA, true, op.evento), selA, usados, aoMudar: resumo });
    sel.desenhar();
    sh.querySelectorAll('[data-jt]').forEach(b => b.onclick = () => { const t = b.dataset.jt; selT.has(t) ? selT.delete(t) : selT.add(t); b.setAttribute('aria-pressed', selT.has(t)); resumo(); });
    sh.querySelectorAll('[data-jc]').forEach(b => b.onclick = () => { const k = b.dataset.jc; selC.has(k) ? selC.delete(k) : selC.add(k); b.setAttribute('aria-pressed', selC.has(k)); limparPronto(); });
    const camposSel = () => camposOk.map(([k]) => k).filter(k => selC.has(k));
    let modo = 'um';
    const limparPronto = () => { $('jdpronto').innerHTML = ''; $('jdok').hidden = false; $('jdok').textContent = 'Gerar PDF'; $('jdok').classList.remove('ghost'); };
    sh.querySelectorAll('[data-jm]').forEach(b => b.onclick = () => { modo = b.dataset.jm; sh.querySelectorAll('[data-jm]').forEach(x => x.setAttribute('aria-pressed', x.dataset.jm === modo));
      $('jdcapat').textContent = modo === 'sep' ? 'Junto, um arquivo com a lista dos alunos' : 'Primeira página com a lista dos alunos'; limparPronto(); });
    sh.addEventListener('change', e => { if (e.target.id === 'jdcapa' || e.target.closest('#jdquadros')) limparPronto(); });
    sh.querySelectorAll('[data-jt]').forEach(b => b.addEventListener('click', limparPronto));
    $('jdtit').addEventListener('input', limparPronto);
    // gerar e enviar são dois toques: o celular só abre o compartilhar logo depois de um toque
    const mostrarPronto = arqs => {
      const lotes = lotesDeArquivos(arqs), tot = arqs.reduce((s, a) => s + a.bytes.length, 0);
      const quantos = arqs.length === 1 ? `1 PDF pronto · ${kb(tot)}` : `${arqs.length} arquivos prontos · ${kb(tot)}`;
      $('jdpronto').innerHTML = `<div class="faixa-card doc-pronto"><b class="num">${quantos}</b>
        ${lotes.length > 1 ? `<span class="s">O celular manda até 10 arquivos de cada vez. Toque em cada botão, um depois do outro, e escolha a mesma conversa.</span>` : ''}
        ${lotes.map((l, i) => { const a = lotes.slice(0, i).reduce((s, x) => s + x.length, 0) + 1, z = a + l.length - 1;
          return `<button type="button" class="btn" data-lote="${i}">${lotes.length > 1 ? `Enviar ${a} a ${z}` : arqs.length === 1 ? 'Enviar o PDF' : `Enviar os ${arqs.length} arquivos`}</button>`; }).join('')}
        ${arqs.length === 1 ? '<button type="button" class="btn ghost" data-ver="0">Visualizar o PDF</button>' : `<details class="doc-lista" open><summary>Visualizar os arquivos</summary><ul>${arqs.map((a, i) => `<li><button type="button" class="link" data-ver="${i}">${esc(a.nome)}</button> <span class="s num">${kb(a.bytes.length)}</span></li>`).join('')}</ul></details>`}</div>`;
      $('jdpronto').querySelectorAll('[data-ver]').forEach(b => b.onclick = () => { const a = arqs[Number(b.dataset.ver)]; verPdf(a.bytes, a.nome); });
      $('jdok').hidden = true; // já gerou: para cancelar, é só fechar; mudou alguma escolha, o botão volta
      $('jdpronto').querySelectorAll('[data-lote]').forEach(b => b.onclick = async () => {
        const r = await salvarArquivos(lotes[Number(b.dataset.lote)], 'application/pdf');
        if (r === 'cancelado') return;
        b.dataset.rot = b.dataset.rot || b.textContent; b.classList.add('ghost');
        b.textContent = `${lotes.length > 1 ? b.dataset.rot.replace('Enviar', 'Enviados') : 'Enviado'} ✓ · enviar de novo`;
        aviso(r === 'baixado' ? (arqs.length === 1 ? 'PDF baixado' : 'Arquivos baixados') : 'Pronto');
      });
      $('jdpronto').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    $('jdok').onclick = async () => {
      const err = m => $('jderr').textContent = m || '', al = porNome(S.alunas).filter(([id]) => selA.has(id)).map(([id]) => id), ts = tipos.filter(t => selT.has(t));
      err(''); if (!al.length) return err('Escolha ao menos um aluno.');
      const titulo = $('jdtit').value.trim(), b = $('jdok'); b.disabled = true; $('jdpronto').innerHTML = '';
      try {
        const arqs = await juntarDocsArquivos({ titulo, alids: al, tids: ts, campos: camposSel(), evento: op.evento, capa: !ts.length || $('jdcapa').checked, separado: ts.length && modo === 'sep' }, txt => { b.textContent = txt; });
        b.disabled = false; b.textContent = 'Gerar PDF de novo'; b.classList.add('ghost'); mostrarPronto(arqs);
      } catch (e) { err(e.message || msgErro(e)); b.textContent = 'Gerar PDF'; b.disabled = false; }
    };
  });
}
let PDFLIB = null;
// toque duplo: o 1º toque pede confirmação no próprio botão ("Toque de novo"); o 2º, em até 4 s, faz a ação
function duploToque(b, acao, txt = 'Confirmar?') {
  if (b.dataset.armado === '1') { clearTimeout(b._t); b.dataset.armado = ''; b.classList.remove('armado'); b.textContent = b._orig; return acao(); }
  b._orig = b.textContent; b.dataset.armado = '1'; b.classList.add('armado'); b.textContent = txt;
  b._t = setTimeout(() => { b.dataset.armado = ''; b.classList.remove('armado'); b.textContent = b._orig; }, 4000);
}
// estados e municípios (IBGE), carregados só quando precisa (br.js, o mesmo do Pelota FC)
let BRP = null;
function carregarBR() {
  if (window.BR) return Promise.resolve(window.BR);
  return BRP || (BRP = new Promise((ok, falha) => { const s = document.createElement('script'); s.src = 'br.js?v=1';
    s.onload = () => ok(window.BR); s.onerror = () => { BRP = null; falha(new Error('Sem internet para carregar as cidades.')); }; document.head.appendChild(s); }));
}
// liga um seletor de estado a um de cidade: escolheu o estado, aparecem os municípios dele
function ligarEstadoCidade(selUf, selCid, atual) {
  const encher = () => { const uf = $(selUf).value, el = $(selCid);
    if (!uf) { el.innerHTML = '<option value="">Escolha o estado</option>'; el.disabled = true; return; }
    el.disabled = true; el.innerHTML = '<option value="">Carregando…</option>';
    carregarBR().then(BR => { const l = ((BR[uf] || {}).c || []), cur = $(selUf).value === uf ? atual : '';
      el.innerHTML = `<option value="">Escolha a cidade</option>${cur && !l.includes(cur) ? `<option selected>${esc(cur)}</option>` : ''}${l.map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}`; el.disabled = false; })
      .catch(e => { el.innerHTML = `<option value="">${esc(e.message)}</option>`; }); };
  $(selUf).addEventListener('change', () => { atual = ''; encher(); });
  if ($(selUf).value) encher();
}
function carregarPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  return PDFLIB || (PDFLIB = new Promise((ok, falha) => { const s = document.createElement('script'); s.src = 'pdf-lib.min.js';
    s.onload = () => ok(window.PDFLib); s.onerror = () => { PDFLIB = null; falha(new Error('Não deu para abrir o gerador de PDF. Confira a internet e tente de novo.')); }; document.head.appendChild(s); }));
}
// texto que a fonte padrão do PDF aceita (português sem problema; emoji e outros viram o mais próximo)
const WIN_EXTRA = '—–“”‘’…•€';
const pdfTxt = s => [...String(s ?? '')].map(ch => { const c = ch.charCodeAt(0); if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WIN_EXTRA.includes(ch)) return ch; const b = ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); return b && b.charCodeAt(0) < 127 ? b[0] : ''; }).join('');
// junta os documentos: num PDF só ou um PDF para cada documento (com a lista dos alunos à parte)
// devolve [{ nome, bytes }]
async function juntarDocsArquivos({ titulo, alids, tids, campos = ['nasc'], evento, capa, separado }, progresso = () => { }) {
  progresso('Preparando…');
  const L = await carregarPdfLib(), FONTES = new Map();
  const novoPdf = async () => { const d = await L.PDFDocument.create(); FONTES.set(d, { F: await d.embedFont(L.StandardFonts.Helvetica), FB: await d.embedFont(L.StandardFonts.HelveticaBold) }); return d; };
  const W = 595.28, H = 841.89, M = 36, cinza = L.rgb(0.42, 0.4, 0.37), preto = L.rgb(0.1, 0.1, 0.1), linhaC = L.rgb(0.85, 0.83, 0.8), vermelho = L.rgb(0.7, 0.15, 0.1);
  const hexRgb = h => { const x = String(h || '').replace('#', ''); return /^[0-9a-f]{6}$/i.test(x) ? L.rgb(...[0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16) / 255)) : preto; };
  const corEsc = hexOk(S.cfg.cor) ? hexRgb(S.cfg.cor) : preto, escola = S.escola.nome || 'Escola', agora = new Date();
  const geradoEm = `${pad(agora.getDate())}/${pad(agora.getMonth() + 1)}/${agora.getFullYear()}`;
  const caber = (t, f, tam, max) => { t = pdfTxt(t); if (f.widthOfTextAtSize(t, tam) <= max) return t; while (t && f.widthOfTextAtSize(t + '…', tam) > max) t = t.slice(0, -1); return t + '…'; };
  const escrever = (pg, t, x, y, o = {}) => { const fs = FONTES.get(pg.doc), f = o.neg ? fs.FB : fs.F, tam = o.tam || 10;
    pg.drawText(caber(t, f, tam, o.max || (W - x - M)), { x, y: H - y, size: tam, font: f, color: o.cor || preto }); };
  const nasc = id => { const n = (S.alunas[id] || {}).nascimento; return n ? dataBRA(n) : '—'; };
  const statusTxt = (id, t) => { const m = metaJunta(id, t), s = situacaoDoc(m); return !m ? 'falta' : s.st === 'vencido' ? `venceu ${dataBRA(m.validade)}` : m.validade ? `até ${dataBRA(m.validade)}` : 'ok'; };
  const tit = titulo || (tids.length ? 'Documentos dos alunos' : 'Lista dos alunos');
  const limpaNome = t => String(t || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  // lista dos alunos
  const desenharCapa = pdf => {
    let pg = pdf.addPage([W, H]), y = M + 8;
    const topo = cont => { pg.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: corEsc }); escrever(pg, escola, M, y + 4, { neg: true, tam: 10, cor: cinza }); y += 26;
      escrever(pg, cont ? `${tit} (continuação)` : tit, M, y, { neg: true, tam: 18 }); y += 18; escrever(pg, `${alids.length} aluno${alids.length === 1 ? '' : 's'} · gerado em ${geradoEm}`, M, y, { tam: 9.5, cor: cinza }); y += 22;
      escrever(pg, 'ALUNO(A)', M, y, { neg: true, tam: 8, cor: cinza }); y += 6; pg.drawLine({ start: { x: M, y: H - y }, end: { x: W - M, y: H - y }, thickness: 0.6, color: linhaC }); y += 14; };
    topo(false);
    alids.forEach((id, i) => {
      const info = infoAluno(id, campos, evento).join('  ·  '), linhas = expandeTipos(id, tids).map(t => [`${tipoDoc(t).nome}: ${statusTxt(id, t)}`, !metaJunta(id, t) || situacaoDoc(metaJunta(id, t)).st === 'vencido']), alto = 14 + (info ? 13 : 0) + Math.ceil(linhas.length / 2) * 12 + 8;
      if (y + alto > H - M) { pg = pdf.addPage([W, H]); y = M + 8; topo(true); }
      escrever(pg, `${i + 1}. ${(S.alunas[id] || {}).nome || ''}`, M, y, { neg: true, tam: 11 }); y += 14;
      if (info) { escrever(pg, info, M + 14, y, { tam: 9.5, cor: cinza }); y += 13; }
      linhas.forEach(([l, ruim], k) => { const col = k % 2; escrever(pg, l, M + 14 + col * ((W - 2 * M - 14) / 2), y, { tam: 9, cor: ruim ? vermelho : cinza, max: (W - 2 * M - 14) / 2 - 8 }); if (col === 1 || k === linhas.length - 1) y += 12; });
      y += 4; pg.drawLine({ start: { x: M, y: H - y }, end: { x: W - M, y: H - y }, thickness: 0.4, color: linhaC }); y += 14;
    });
  };
  // um cabeçalho em cada página de documento: quem é e que documento é
  const cab = (pg, id, t, extra) => { const m = metaJunta(id, t); pg.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: corEsc });
    escrever(pg, `${(S.alunas[id] || {}).nome || ''} · ${tipoDoc(t).nome}`, M, M + 10, { neg: true, tam: 12 });
    escrever(pg, [`Nascimento ${nasc(id)}`, m && m.validade ? `válido até ${dataBRA(m.validade)}` : '', extra || '', escola].filter(Boolean).join(' · '), M, M + 25, { tam: 9, cor: cinza }); };
  const TOPO = M + 38, caixaH = H - TOPO - M;
  const desenharDoc = async (pdf, id, t) => {
    const f = await arquivosDoc(id, t);
    if (!f || !(f.arquivos || []).length) { const pg = pdf.addPage([W, H]); cab(pg, id, t); escrever(pg, 'Não deu para abrir este arquivo no app.', M, TOPO + 20, { cor: cinza }); return; }
    if (f.formato === 'pdf') {
      try {
        const orig = await L.PDFDocument.load(bytesDe(f.arquivos[0]), { ignoreEncryption: true }), pags = await pdf.embedPdf(orig, orig.getPageIndices());
        pags.forEach((p, k) => { const pg = pdf.addPage([W, H]); cab(pg, id, t, pags.length > 1 ? `página ${k + 1} de ${pags.length}` : '');
          const e = Math.min((W - 2 * M) / p.width, caixaH / p.height), w = p.width * e, h = p.height * e;
          pg.drawPage(p, { x: (W - w) / 2, y: H - TOPO - h, width: w, height: h }); });
      } catch (e) { const pg = pdf.addPage([W, H]); cab(pg, id, t); escrever(pg, 'Este PDF é protegido e não deu para juntar. Mande-o à parte.', M, TOPO + 20, { cor: cinza }); }
      return;
    }
    // fotos: uma ocupa a página; frente e verso dividem a página
    const pg = pdf.addPage([W, H]); cab(pg, id, t);
    const ims = []; for (const u of f.arquivos) { try { ims.push(await pdf.embedJpg(bytesDe(u))); } catch (e) { try { ims.push(await pdf.embedPng(bytesDe(u))); } catch (e2) { } } }
    const vao = 12, cada = (caixaH - vao * (ims.length - 1)) / Math.max(1, ims.length);
    ims.forEach((im, k) => { const e = Math.min((W - 2 * M) / im.width, cada / im.height), w = im.width * e, h = im.height * e, topo = TOPO + k * (cada + vao);
      pg.drawImage(im, { x: (W - w) / 2, y: H - topo - h, width: w, height: h }); });
  };
  // um documento com problema não derruba o PDF: no lugar dele sai uma página avisando
  const docSeguro = async (pdf, id, t) => { try { await desenharDoc(pdf, id, t); } catch (e) { const pg = pdf.addPage([W, H]); cab(pg, id, t); escrever(pg, 'Não deu para juntar este arquivo. Mande-o à parte.', M, TOPO + 20, { cor: cinza }); } };
  const fechar = async (pdf, t) => { pdf.setTitle(pdfTxt(t)); pdf.setProducer('Turma em Dia'); pdf.setCreator('Turma em Dia'); return pdf.save(); };
  const lista = []; for (const id of alids) for (const t of expandeTipos(id, tids)) if (metaJunta(id, t)) lista.push([id, t]);
  if (!tids.length) { const pdf = await novoPdf(); desenharCapa(pdf); progresso('Finalizando…'); return [{ nome: limpaNome(`Lista ${titulo || escola}`) + '.pdf', bytes: await fechar(pdf, tit) }]; }
  if (!lista.length) { const pdf = await novoPdf(); desenharCapa(pdf); progresso('Finalizando…'); return [{ nome: limpaNome(`Lista ${titulo || escola}`) + '.pdf', bytes: await fechar(pdf, tit) }]; } // ninguém tem esses documentos: sai a lista, com "falta" em cada um
  if (!separado) {
    const pdf = await novoPdf(); if (capa) desenharCapa(pdf);
    let n = 0; for (const [id, t] of lista) { progresso(`Juntando ${++n} de ${lista.length}…`); await docSeguro(pdf, id, t); }
    progresso('Finalizando…');
    return [{ nome: limpaNome(`Documentos ${titulo || escola}`) + '.pdf', bytes: await fechar(pdf, tit) }];
  }
  // separados: um arquivo para cada documento, com o nome do aluno e do documento
  const saida = [], usados = new Set(), nomeUnico = base => { let n = limpaNome(base), k = 2; while (usados.has(n.toLowerCase())) n = limpaNome(base) + ` (${k++})`; usados.add(n.toLowerCase()); return n + '.pdf'; };
  if (capa) { const pdf = await novoPdf(); desenharCapa(pdf); saida.push({ nome: nomeUnico(`Lista dos alunos - ${titulo || escola}`), bytes: await fechar(pdf, tit) }); }
  let n = 0;
  for (const [id, t] of lista) {
    progresso(`Preparando ${++n} de ${lista.length}…`);
    const pdf = await novoPdf(); await docSeguro(pdf, id, t);
    saida.push({ nome: nomeUnico(`${(S.alunas[id] || {}).nome || 'Aluno'} - ${tipoDoc(t).nome}`), bytes: await fechar(pdf, `${(S.alunas[id] || {}).nome || ''} · ${tipoDoc(t).nome}`) });
  }
  return saida;
}
// o compartilhar do celular aceita até 10 arquivos e 45 MB de cada vez: divide em lotes
function lotesDeArquivos(arqs) {
  const lotes = []; let atual = [], tam = 0;
  for (const a of arqs) { if (atual.length && (atual.length >= 10 || tam + a.bytes.length > 45 * 1048576)) { lotes.push(atual); atual = []; tam = 0; } atual.push(a); tam += a.bytes.length; }
  if (atual.length) lotes.push(atual); return lotes;
}

// enviar (família) ou anexar o atestado recebido em papel (administração)
function sheetEnviarAtestado(alid, op = {}) {
  const a = S.alunas[alid] || {}, t = S.saude[alid] || {}, t_ = t, at = t.atestado || {}, x = termoDe(alid), adm = !!S.admin;
  const jaTem = !!at.enviadoEm && x.as !== 'recusado' && x.as !== 'falta';
  let novo = null;
  sheet(`<h3>Atestado médico de ${esc(primeiro(a.nome))}</h3>
    ${op.depoisTermo ? `<div class="aviso-lei"><b>${t_.alteracoes && t_.alteracoes.length ? 'Termo enviado!' : 'Termo assinado!'}</b><span>Como tem resposta "sim" no questionário, a escola precisa de um atestado médico dizendo que ${esc(primeiro(a.nome))} pode fazer a atividade. Pode enviar agora ou depois, em Meus filhos.</span></div>` : ''}
    ${!adm && x.as === 'recusado' ? `<div class="aviso-lei"><b>A escola pediu outro atestado</b><span>${esc(at.recusa.motivo)}</span></div>` : ''}
    ${adm ? ''
      : '<div class="sub">Tire uma foto do atestado inteiro, com o nome, a assinatura e o carimbo do médico bem legíveis.</div>'}
    ${jaTem ? `<div class="field"><span class="lb">${x.as === 'ok' ? `Conferido pela escola em ${dataCurta(at.recebidoEm)}` : `Enviado em ${dataCurta(at.enviadoEm)} · a escola vai conferir`}</span><div id="atatual" class="atest-box"><div class="sub">Carregando…</div></div></div>` : ''}
    <div class="field" id="atnovo" hidden><span class="lb">Novo atestado</span><div class="atest-box" id="atprev"></div><div class="sub" id="attam"></div></div>
    <span class="btn ${jaTem ? 'ghost' : ''} toque-arquivo" id="atbtn">${jaTem ? 'Trocar o atestado' : adm ? 'Anexar atestado' : 'Tirar foto ou escolher arquivo'}<input type="file" id="atarq" accept="image/*,application/pdf" aria-label="Escolher o atestado"></span>
    <div class="note">${adm ? 'Foto ou PDF. Só a escola e o(a) professor(a) da turma veem.' : 'Foto ou PDF. O app reduz a foto antes de guardar, para não ocupar espaço. Só a administração e o(a) professor(a) da turma veem.'}</div>
    <div class="err" id="aterr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>${op.depoisTermo ? 'Enviar depois' : 'Fechar'}</button><button type="button" class="btn" id="atok" hidden>${adm ? 'Guardar atestado' : 'Enviar atestado'}</button></div>`, sh => {
    if (jaTem) carregarAtestado(alid).then(f => { const box = $('atatual'); if (!box) return; box.innerHTML = previaAtestado(f); if (f) ligarPrevia(box, f, alid); });
    $('atarq').onchange = async e => {
      let arq = e.target.files[0]; e.target.value = ''; if (!arq) return;
      arq = await ajustarFoto(arq); if (!arq) return;
      $('aterr').textContent = ''; $('atbtn').firstChild.textContent = 'Preparando…';
      try { novo = await prepararAtestado(arq); } catch (er) { novo = null; $('aterr').textContent = er.message; }
      $('atbtn').firstChild.textContent = novo ? 'Escolher outro' : (jaTem ? 'Trocar o atestado' : adm ? 'Anexar atestado' : 'Tirar foto ou escolher arquivo');
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
  const anexar = `<button type="button" class="btn ghost btn-mini" id="vanexar">${x.as === 'ok' || x.as === 'conferir' ? 'Trocar o atestado' : 'Anexar atestado'}</button>`;
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
  const linha = (r, dir) => `<li class="tap" data-va="${esc(r.id)}"><div class="dot">${esc(iniciais(r.a.nome))}</div><div class="grow"><div class="t">${esc(r.a.nome)}</div>${linhas(esc(respDe(r.id).nome || 'Sem responsável'), dir)}</div>${r.x.as === 'falta' || r.x.as === 'recusado' ? (() => { const wa = waAtestado(r.id); return wa ? `<a class="wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Pedir pelo WhatsApp" data-nao-abre data-cobr="${esc(r.id)}:pend">${ICO_WA}</a>` : '<span class="wa wa-vazio" aria-hidden="true"></span>'; })() : '<span class="wa wa-vazio" aria-hidden="true"></span>'}</li>`;
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
  const f = formasCfg(), t = taxasCfg(), ex = 100, n2 = x => String(x).replace('.', ',');
  const tx = (pct, fixo) => fixo != null ? `R$ ${n2(fixo.toFixed(2))} + ${n2(COMISSAO * 100)}%` : `${n2(C.r2(pct + COMISSAO * 100))}%`;
  const semChave = S.cfg.mpConectadoEm && !S.cfg.mpChave;
  sheet(`<h3>Formas de pagamento</h3>
    <div class="sub">O Pix fica sempre ligado: é o mais barato e cai na hora. Ligue as outras formas se quiser dar opção às famílias.</div>
    ${semChave ? '<div class="banner"><span>Para aceitar <b>cartão</b>, conecte o Mercado Pago de novo uma vez (a conexão antiga não traz o que o cartão precisa). O Pix continua funcionando.</span><button type="button" id="frecon">Conectar de novo</button></div>' : ''}
    <div class="checks" style="max-height:none">
      <label><input type="checkbox" checked disabled><span class="grow"><b>Pix</b><span class="s">Taxa de pagamento ${tx(t.pix)} · cai na hora</span></span></label>
      <label><input type="checkbox" id="fbol" ${f.boleto ? 'checked' : ''}><span class="grow"><b>Boleto</b><span class="s">Taxa de pagamento ${tx(0, t.boleto)} por boleto pago · cai em até 3 dias úteis</span></span></label>
      <label><input type="checkbox" id="fcar" ${f.cartao ? 'checked' : ''}><span class="grow"><b>Cartão de crédito</b><span class="s">Taxa de pagamento ${tx(t.cartao)} · o prazo para cair depende da sua conta</span></span></label>
      <label><input type="checkbox" id="fpar" ${f.parcelado ? 'checked' : ''}><span class="grow"><b>Cartão parcelado</b><span class="s">A família escolhe em quantas vezes, até o limite abaixo</span></span></label>
    </div>
    <div id="fparw">
      <div class="field"><label for="fmax">Parcelar em até</label><select id="fmax">${[2, 3, 4, 5, 6, 8, 10, 12].map(n => `<option value="${n}" ${Number(f.maxParcelas) === n ? 'selected' : ''}>${n}x</option>`).join('')}</select></div>
      <div class="field"><span class="lb">Quem paga os juros do parcelamento</span><div class="seg" id="fjur"><button type="button" data-jur="familia" aria-pressed="${f.jurosEscola !== true}">A família</button><button type="button" data-jur="escola" aria-pressed="${f.jurosEscola === true}">A escola</button></div>
        <span class="s" id="fjurtx"></span></div>
    </div>
    <label class="liga" id="frecw"><span class="grow"><b>Cobrança automática no cartão</b><span class="s">A família pode deixar o cartão salvo e as cobranças são pagas sozinhas no vencimento. Ela liga e desliga quando quiser. Começa a funcionar assim que o Mercado Pago liberar para o Turma em Dia; até lá, a família paga com o cartão salvo digitando só o código de segurança.</span></span><input type="checkbox" role="switch" id="frec" ${f.recorrente ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span></label>
    <details class="historico"><summary><span class="grow"><b>Taxas da sua conta no Mercado Pago</b><span class="s">Confira no app do Mercado Pago, em "Todas as taxas", e ajuste aqui</span></span><span class="seta" aria-hidden="true">▾</span></summary>
      <div style="padding:0 14px 14px;display:flex;flex-direction:column;gap:10px">
        <div class="two"><div class="field"><label for="tpix">Pix (%)</label><input id="tpix" inputmode="decimal" value="${n2(t.pix)}"></div><div class="field"><label for="tbol">Boleto (R$)</label><input id="tbol" inputmode="decimal" value="${n2(t.boleto)}"></div></div>
        <div class="two"><div class="field"><label for="tcar">Cartão (%)</label><input id="tcar" inputmode="decimal" value="${n2(t.cartao)}"></div><div></div></div>
        <span class="s">Na taxa de pagamento, o app soma ${n2(COMISSAO * 100)}% a cada taxa da sua conta.</span>
      </div></details>
    <div class="note" id="fnota"></div>
    <div class="err" id="ferr2" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button type="button" class="btn" id="fok2">Salvar</button></div>`, sh => {
    let jurosEscola = f.jurosEscola === true;
    const ler = () => { const pn = id => parseValor($(id).value); return { formas: { boleto: $('fbol').checked, cartao: $('fcar').checked, parcelado: $('fcar').checked && $('fpar').checked, maxParcelas: Number($('fmax').value), jurosEscola, recorrente: $('fcar').checked && $('frec').checked },
      taxas: { pix: pn('tpix'), boleto: pn('tbol'), cartao: pn('tcar') } }; };
    const ver = () => { const l = ler(), old = S.cfg; S.cfg = { ...old, formas: l.formas, taxas: l.taxas };
      $('fparw').hidden = !(l.formas.cartao && l.formas.parcelado); $('fpar').disabled = !l.formas.cartao; $('frecw').hidden = !l.formas.cartao;
      sh.querySelectorAll('[data-jur]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.jur === 'escola') === jurosEscola)));
      $('fjurtx').textContent = jurosEscola ? `Para a família parcelar sem juros, ligue também o "parcelamento sem juros" na sua conta do Mercado Pago, até ${l.formas.maxParcelas}x. O Mercado Pago desconta os juros do que a escola recebe.` : 'O Mercado Pago soma os juros na fatura de quem parcela. A família vê o total antes de confirmar.';
      const rec = pct => C.r2(ex * (1 - pct / 100 - COMISSAO)), linhas_ = [['Pix', valorForma(ex, 'pix').total]];
      if (l.formas.boleto) linhas_.push(['Boleto', valorForma(ex, 'boleto').total]);
      if (l.formas.cartao) linhas_.push([l.formas.parcelado ? 'Cartão (à vista; parcelado + juros)' : 'Cartão', valorForma(ex, 'cartao').total]);
      S.cfg = old;
      $('fnota').textContent = S.cfg.pixRepassa === true ? 'Como "quem paga cobre a taxa" está ligado, a família paga a taxa da forma que escolher e a escola recebe o valor cheio.' : 'Como "quem paga cobre a taxa" está desligado, a taxa sai do valor que a escola recebe.'; };
    sh.querySelectorAll('[data-jur]').forEach(b => b.onclick = () => { jurosEscola = b.dataset.jur === 'escola'; ver(); });
    sh.querySelectorAll('input, select').forEach(el => el.addEventListener('input', ver)); sh.querySelectorAll('input[type=checkbox]').forEach(el => el.addEventListener('change', ver)); ver();
    if ($('frecon')) $('frecon').onclick = async () => { $('frecon').disabled = true; try { await mpConta('conectar'); if (MOCK) sheetFormasEscola(); } catch (e) { $('ferr2').textContent = msgErro(e); $('frecon').disabled = false; } };
    $('fok2').onclick = async () => { const l = ler();
      if ([l.taxas.pix, l.taxas.boleto, l.taxas.cartao].some(v => !(v >= 0) || v > 30)) return $('ferr2').textContent = 'Confira as taxas: use números como 4,98.';
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
const VERSAO_TERMOS = 2, VERSAO_PRIVACIDADE = 2;
const linksLegais = () => `<div class="legal"><button type="button" class="link" data-doc="privacidade">Política de privacidade</button><span aria-hidden="true">·</span><button type="button" class="link" data-doc="termos">Termos de uso</button></div>`;
// os textos ficam em privacidade.html e termos.html; aqui abrem dentro do app
document.addEventListener('click', e => { const b = e.target.closest('[data-doc]'); if (!b) return; e.preventDefault(); e.stopPropagation(); abrirDocLegal(b.dataset.doc); });
async function abrirDocLegal(tipo) {
  const volta = $('overlay').innerHTML ? null : null, url = '../' + tipo + '.html';
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
        // o registro técnico de erros ligado a esta conta sai na hora
        try { const ids = await B.meus('erros', 'uid', EU.uid); for (let i = 0; i < ids.length; i += 400) await B.lote(ids.slice(i, i + 400).map(id => ({ op: 'del', p: 'erros/' + id }))); } catch (x) { }
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
    ops.push(...opsApagarDocs(alid));
    for (const nid of await B.meus(`escolas/${S.eid}/notasAlunos`, 'alid', alid).catch(() => [])) ops.push({ op: 'del', p: `escolas/${S.eid}/notasAlunos/${nid}` });
    for (const [g, G] of Object.entries(S.grupos)) if ((G.alunas || []).includes(alid)) ops.push({ op: 'merge', p: `escolas/${S.eid}/grupos/${g}`, d: { alunas: G.alunas.filter(x => x !== alid) } });
  }
  // responsável só é apagado se não tiver outro aluno ativo
  for (const rid of rids) { const outros = Object.entries(S.alunas).filter(([id, a]) => a.responsavelId === rid && !alids.includes(id) && !a.anonimizadoEm); const r = S.resps[rid]; if (!r || outros.length) continue;
    ops.push({ op: 'set', p: `escolas/${S.eid}/responsaveis/${rid}`, d: { nome: 'Responsável removido', telefone: '', cpf: '', codigo: null, codigosAntigos: null, anonimizadoEm: Date.now() } });
    codigosDoResp(r).forEach(c => ops.push({ op: 'del', p: 'codigos/' + c })); }
  if (pedidoId) ops.push({ op: 'merge', p: `escolas/${S.eid}/pedidos/${pedidoId}`, d: { status: 'feito', feitoEm: Date.now(), por: EU.uid } });
  await B.lote(ops);
}
// excluir a escola: 1) explica o que acontece  2) pede para digitar "excluir"
function excluirEscolaPassos() {
  sheet(`<h3>Excluir a escola?</h3><p class="sub" style="margin:0"><b>${esc(S.escola.nome || 'A escola')}</b> some do app para todos: administração, professores e famílias. Alunos, turmas, cobranças e avisos param.</p>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn danger" id="exseg">Continuar</button></div>`, sh => {
    sh.classList.add('ex-passo'); $('exseg').onclick = () => excluirEscolaDigitar(); });
}
function excluirEscolaDigitar() {
  sheet(`<h3>Confirme a exclusão</h3><p class="sub" style="margin:0">Para excluir <b>${esc(S.escola.nome || 'a escola')}</b>, digite <b>excluir</b> abaixo. Não dá para desfazer.</p>
    <div class="field"><input id="exdig" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="excluir"></div><div class="err" id="exerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn danger" id="exok" disabled>Excluir escola</button></div>`, sh => {
    sh.classList.add('ex-passo');
    $('exdig').oninput = () => { $('exok').disabled = $('exdig').value.trim().toLowerCase() !== 'excluir'; };
    $('exok').onclick = async () => {
      $('exok').disabled = true; const eid = S.eid;
      try {
        if (MOCK) await B.set('users/' + EU.uid, { escolas: { [eid]: null } }, { merge: true }); else await servidor('excluirEscola', { eid, confirma: $('exdig').value });
        delete MINHAS[eid]; fecharSheet(); VOLTA_ESCOLA = null; aviso('Escola excluída'); telaInicio();
      } catch (e) { $('exerr').textContent = msgErro(e); $('exok').disabled = false; }
    };
  });
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

/* ================= Plano da escola (o que a escola paga para usar o app) =================
   Preço pela quantidade de alunos ativos; 30 dias de teste; cartão (cobrança automática) ou Pix a cada mês.
   Com o plano atrasado: até 5 dias, aviso; de 6 a 30, só leitura; mais de 30, suspensa. Quem decide é o servidor (config/plano). */
const sitPlano = () => C.situacaoPlano(S && S.plano, hoje());
/* App das lojas (Apple e Google): desde 09/11/2026 o plano é pago dentro do app igual ao site (cartão pelo Mercado Pago,
   como o MFIT faz; no Brasil a Apple permite pagamento alternativo desde o iOS 26.2). LOJA() fica sempre falso;
   para voltar a esconder o pagamento nas lojas: NATIVO() || new URLSearchParams(location.search).has('loja'). */
const LOJA = () => false;
const planoTrava = () => !!(S && S.admin && S.plano && (S.plano.bloqueio || ['leitura', 'suspensa'].includes(sitPlano().fase)));
const MSG_LEITURA = 'O plano do app está atrasado e a escola está só para leitura. Pague em Ajustes → Plano para voltar a editar.';
const MSG_PAUSA = 'O acesso da escola ao app e seus serviços está pausado. Fale com a escola.';
// com o plano atrasado, a administração não grava (as regras do Firestore também não deixam); o que o servidor grava passa
function travarEscritas(b) {
  const livres = /\/(config\/plano|cobrancas|planoPag|cartoes)(\/|$)/, pode = p => !(planoTrava() && String(p).startsWith(`escolas/${S.eid}`) && !livres.test(String(p)));
  const trava = () => Object.assign(new Error(MSG_LEITURA), { code: 'plano-leitura' });
  for (const k of ['set', 'del', 'tirar']) if (typeof b[k] === 'function') { const o = b[k]; b[k] = async (p, ...r) => { if (!pode(p)) throw trava(); return o(p, ...r); }; }
  const ol = b.lote; b.lote = async ops => { if (ops.some(o => !pode(o.p))) throw trava(); return ol(ops); };
}
const chamarPlano = corpo => MOCK ? mockPlano(corpo) : servidor('plano', { eid: S.eid, ...corpo });
// faixa no alto da tela (administração)
// alunos ativos agora (o mesmo que o servidor conta para o preço do plano)
const ativosPlano = () => Object.values(S.alunas || {}).filter(a => a.ativa !== false && !a.anonimizadoEm && C.ativaNoMes(a, mesHoje())).length;
// perto do limite da faixa (90% ou mais): avisa quanto passa a custar ao mudar de faixa
// o plano é escolhido pela escola (planoId); sem escolha ainda, vale a faixa dos alunos ativos
const planoAtual = () => C.planoDe(S.plano, ativosPlano());
const proxPlano = pl => C.PLANOS[C.PLANOS.indexOf(pl) + 1] || null;
function avisoLimitePlano() {
  if (!S.admin || !S.plano) return '';
  const n = ativosPlano(), pl = planoAtual(); if (!pl.ate || n < Math.ceil(pl.ate * 0.9)) return '';
  const prox = proxPlano(pl), falta = Math.max(0, pl.ate - n);
  if (LOJA()) return `<div class="banner"><span><b>Plano ${esc(pl.nome)} ${falta ? 'quase cheio' : 'cheio'}:</b> ${n} de ${pl.ate} alunos${falta ? ` (falta${falta > 1 ? 'm' : ''} ${falta})` : ''}. Para cadastrar mais de ${pl.ate}, a escola precisa de um plano maior.</span></div>`;
  return `<div class="banner"><span><b>Plano ${esc(pl.nome)} ${falta ? 'quase cheio' : 'cheio'}:</b> ${n} de ${pl.ate} alunos${falta ? ` (falta${falta > 1 ? 'm' : ''} ${falta})` : ''}. Para cadastrar mais de ${pl.ate}, mude para o <b>${esc(prox.nome)}</b>, de ${brl(prox.mes)} por mês.</span><button id="fplano2">Ver planos</button></div>`;
}
// cadastrar ou reativar acima do limite do plano escolhido: mostra o aviso com o botão de mudar (a ficha não se perde)
function limitePlanoNoForm(box, depois) {
  const pl = planoAtual(), prox = proxPlano(pl);
  if (LOJA()) { box.innerHTML = `<div class="pl-lim"><span><b>O plano ${esc(pl.nome)} vai até ${pl.ate} alunos ativos</b> e a escola já tem ${ativosPlano()}. Para cadastrar mais, a escola precisa de um plano maior.</span></div>`; return; }
  box.innerHTML = `<div class="pl-lim"><span><b>O plano ${esc(pl.nome)} vai até ${pl.ate} alunos ativos</b> e a escola já tem ${ativosPlano()}.${S.admin ? ` Para cadastrar mais, mude para o <b>${esc(prox.nome)}</b> (até ${prox.ate ? prox.ate + ' alunos' : 'quantos precisar'}, ${brl(prox.mes)} por mês). O novo valor vale a partir da próxima cobrança.` : ' Peça à administração da escola para mudar de plano.'}</span>
    ${S.admin ? `<button type="button" class="btn" id="plmudar">Mudar para o ${esc(prox.nome)}</button>` : ''}</div>`;
  if ($('plmudar')) $('plmudar').onclick = async () => { $('plmudar').disabled = true;
    try { await chamarPlano({ acao: 'escolher', planoId: prox.id }); aviso(`Plano ${prox.nome} escolhido`); box.innerHTML = ''; depois(); }
    catch (e) { box.textContent = msgErro(e); } };
}
function faixaPlano() {
  if (!S.admin || !S.plano) return '';
  const s = sitPlano(), bt = '<button id="fplano">Ver plano</button>', ate = d => dataBRA(d);
  if (LOJA()) { // sem pagamento no app da loja: só a situação
    if (s.fase === 'teste' && s.restam <= 7) return `<div class="banner"><span><b>Teste grátis:</b> ${s.restam === 0 ? 'termina hoje' : `falta${s.restam > 1 ? 'm' : ''} ${s.restam} dia${s.restam > 1 ? 's' : ''}`}.</span></div>`;
    if (s.fase === 'aviso') return `<div class="banner"><span><b>O plano do app venceu</b> em ${ate(s.venc)}. Em ${ate(C.maisDias(s.venc, 5))} a escola fica só para leitura.</span></div>`;
    if (s.fase === 'leitura') return `<div class="banner alerta"><span><b>Só leitura:</b> o plano está atrasado desde ${ate(s.venc)}. As famílias continuam pagando pelo app, mas a escola não edita nem registra dinheiro.</span></div>`;
    return '';
  }
  if (s.fase === 'teste' && s.restam <= 7) return `<div class="banner"><span><b>Teste grátis:</b> ${s.restam === 0 ? 'termina hoje' : `falta${s.restam > 1 ? 'm' : ''} ${s.restam} dia${s.restam > 1 ? 's' : ''}`}. Escolha como pagar para a escola seguir usando o app.</span>${bt}</div>`;
  if (s.fase === 'cortesia' && s.restam <= 7 && S.plano.forma !== 'cartao') return `<div class="banner"><span><b>Os meses grátis acabam ${s.restam === 0 ? 'hoje' : `em ${ate(s.venc)}`}.</b> Cadastre o cartão para a escola seguir usando o app.</span>${bt}</div>`;
  if (s.fase === 'aviso') return `<div class="banner"><span><b>O plano do app venceu</b> em ${ate(s.venc)}. Pague até ${ate(C.maisDias(s.venc, 5))} para a escola não ficar só para leitura.</span><button id="fplano">Pagar</button></div>`;
  if (s.fase === 'leitura') return `<div class="banner alerta"><span><b>Só leitura:</b> o plano está atrasado desde ${ate(s.venc)}. As famílias continuam pagando pelo app, mas a escola não edita nem registra dinheiro. Pague até ${ate(C.maisDias(s.venc, 30))} para não suspender.</span><button id="fplano">Pagar</button></div>`;
  return '';
}
// mais de 30 dias: a administração vê só o pagamento; as famílias e os professores, o aviso de pausa
function telaPlanoParado(v) {
  const s = sitPlano();
  if (!S.admin) { v.innerHTML = `<div class="empty pausa"><b>${MSG_PAUSA}</b></div>`; return; }
  v.innerHTML = `<div class="empty pausa"><b>A conta da escola está suspensa</b>
    <span>O plano do app venceu em ${dataBRA(s.venc)}. As famílias veem: "${MSG_PAUSA}"</span>
    ${s.encerrar ? '<span class="s"><b>Aviso de encerramento:</b> já passaram 90 dias do vencimento. Se o plano não for pago, a conta da escola pode ser encerrada.</span>' : ''}
    ${LOJA() ? '' : '<span>Pague para liberar tudo na hora.</span><button class="btn" id="spag">Pagar o plano</button>'}</div>`;
  if ($('spag')) $('spag').onclick = () => sheetPlano();
}
function sheetPlano() {
  if (LOJA()) return sheetPlanoLoja();
  let R = null, ciclo = (S.plano && S.plano.ciclo) || 'mensal', pixAberto = false, parar = null, escolha = null;
  const corpo = h => `<h3>Plano da escola</h3>${h}<button class="btn ghost" data-fechar style="width:100%;margin-top:8px">Fechar</button>`;
  const carregar = async () => { try { R = await chamarPlano({ acao: 'estado' }); ciclo = R.plano.ciclo || ciclo; desenhar(); } catch (e) { sheet(corpo(`<div class="empty"><b>Não deu para abrir o plano.</b><span>${esc(msgErro(e))}</span></div>`)); } };
  const desenhar = () => {
    const p = R.plano, s = R.situacao, pr = ciclo === 'anual' ? R.anual : R.mensal, pl = pr.plano, lim = pl.ate || Math.max(R.alunos, 1), pct = Math.min(100, Math.round(R.alunos / lim * 100));
    const d = pr.desconto, faixa = s.fase === 'teste' ? `<div class="banner ok"><span><b>Teste grátis</b> · ${s.restam ? `faltam ${s.restam} dia${s.restam > 1 ? 's' : ''} (até ${dataBRA(s.venc)})` : 'termina hoje'}. Tudo liberado.</span></div>`
      : s.fase === 'cortesia' ? `<div class="banner ok"><span><b>Grátis até ${dataBRA(p.cortesiaAte)}</b>, cortesia do Turma em Dia.${p.forma === 'cartao' ? ' O cartão volta a ser cobrado depois disso.' : ''}</span></div>`
      : s.fase === 'ativo' ? `<div class="banner ok"><span><b>Em dia</b> · pago até ${dataBRA(p.pagoAte)}.</span></div>`
      : s.fase === 'aviso' ? `<div class="banner"><span><b>Venceu em ${dataBRA(s.venc)}.</b> Pague até ${dataBRA(C.maisDias(s.venc, 5))} para não ficar só para leitura.</span></div>`
      : ['leitura', 'suspensa'].includes(s.fase) ? `<div class="banner alerta"><span><b>${s.fase === 'leitura' ? 'Só leitura' : 'Suspensa'}</b> · atrasado desde ${dataBRA(s.venc)}. Pague para liberar na hora.</span></div>` : '';
    const precoTxt = v => brl(v).replace(',00', ''), menor = C.PLANOS.find(x => C.cabePlano(x, R.alunos));
    sheet(corpo(`${faixa}
      ${!p.doc ? `<div class="field"><label for="pldoc">CPF ou CNPJ de quem responde pela escola</label><div class="pl-docrow"><input id="pldoc" inputmode="numeric" placeholder="Só números"><button type="button" class="btn ghost" id="pldocok">Salvar</button></div><span class="s">O teste grátis é um por CPF ou CNPJ.</span></div>` : ''}
      <div class="pl-uso"><div class="pl-uso-t"><span>Alunos ativos</span><b class="num">${R.alunos}${pl.ate ? ' de ' + pl.ate : ''}</b></div><div class="pl-barra"><i style="width:${pct}%"></i></div><span class="s">Plano <b>${esc(pl.nome)}</b>, escolhido pela escola.${pl.ate && R.alunos >= Math.ceil(pl.ate * 0.9) ? ` <b style="color:var(--out)">${R.alunos >= pl.ate ? 'Cheio' : 'Quase cheio'}: para cadastrar mais de ${pl.ate} alunos, mude para o ${esc(proxPlano(pl).nome)}.</b>` : ''}</span></div>
      ${menor && menor.id !== pl.id ? `<div class="banner ok pl-lembra"><span>Você tem ${R.alunos} aluno${R.alunos === 1 ? '' : 's'}: o <b>${esc(menor.nome)}</b> atende e custa ${precoTxt(C.r2(pl.mes - menor.mes))} a menos por mês.</span><button type="button" data-pl="${menor.id}">Ver</button></div>` : ''}
      <div class="seg pl-per"><button type="button" data-per="mensal" aria-pressed="${ciclo === 'mensal'}">Mensal</button><button type="button" data-per="anual" aria-pressed="${ciclo === 'anual'}">Anual · 2 meses grátis</button></div>
      <div class="pl-grade">${C.PLANOS.map(x => { const cabe = C.cabePlano(x, R.alunos), atual = x.id === pl.id;
        return `<button type="button" class="pl-card ${atual ? 'sel' : ''} ${escolha === x.id ? 'esc' : ''}" data-pl="${x.id}" ${!cabe ? 'disabled' : ''} aria-pressed="${atual}">${atual ? '<span class="pl-tag">Seu plano</span>' : ''}<span class="pl-nome">${x.nome}</span><span class="pl-ate">${x.ate ? 'até ' + x.ate + ' alunos' : 'acima de 250'}</span><span class="pl-preco num">${precoTxt(ciclo === 'anual' ? x.mes * 10 / 12 : x.mes)}</span><span class="pl-mes">${!cabe ? `você tem ${R.alunos} alunos` : ciclo === 'anual' ? 'por mês, no anual' : 'por mês'}</span></button>`; }).join('')}</div>
      ${escolha ? (() => { const x = C.PLANOS.find(y => y.id === escolha), sobe = x.mes > pl.mes;
        return `<div class="pl-conf"><span><b>Mudar para o ${esc(x.nome)}?</b> ${sobe ? (x.ate ? `O limite sobe na hora para ${x.ate} alunos.` : 'Na hora, a escola passa a não ter limite de alunos.') : `Vai até ${x.ate} alunos ativos.`} O novo valor, ${brl(ciclo === 'anual' ? x.mes * 10 : x.mes)} por ${ciclo === 'anual' ? 'ano' : 'mês'}, vale a partir da próxima cobrança.</span>
          <div class="actions"><button type="button" class="btn ghost" id="plnao">Cancelar</button><button type="button" class="btn" id="plsim">Mudar</button></div></div>`; })() : ''}
      <div class="conta">${contaL(`Plano ${esc(pl.nome)} · ${ciclo === 'anual' ? '1 ano' : '1 mês'}`, brl(pr.cheio))}${d ? contaL(`Desconto do Turma em Dia${d.pct ? ` (${d.pct}%)` : ''}${d.ate ? ` até ${dataBRA(d.ate)}` : ''}`, '− ' + brl(C.r2(pr.cheio - pr.valor)), 'desc') : ''}${contaL(`<b>${ciclo === 'anual' ? 'Total do ano' : 'Total por mês'}</b>`, `<b>${brl(pr.valor)}</b>`, 'total')}</div>
      <div class="lb" style="margin:4px 0 8px">Como pagar</div>
      <div class="pl-meios">
        ${p.cartao ? `<div class="pl-meio sel"><span class="pl-ico" aria-hidden="true">💳</span><span class="grow"><b>${esc(p.cartao.marca)} •••• ${esc(p.cartao.fim)}</b><span class="s">Cobrança automática ${p.ciclo === 'anual' ? 'todo ano' : 'todo mês'}${p.proxCobranca ? ` · próxima em ${dataBRA(p.proxCobranca)}` : ''}</span></span><span class="pl-ok">✓</span></div>
          <div class="actions"><button type="button" class="btn ghost" id="pltroca">Trocar cartão</button><button type="button" class="btn ghost" id="pltira" style="color:var(--out)">Tirar cartão</button></div>`
          : R.publicKey || MOCK ? `<button type="button" class="pl-add" id="pladd"><span class="pl-mais">+</span> Adicionar um cartão de crédito</button>` : '<div class="pl-meio"><span class="pl-ico">💳</span><span class="grow"><b>Cartão de crédito</b><span class="s">Em breve</span></span></div>'}
        <button type="button" class="pl-meio" id="plpix"><span class="pl-ico pl-pix" aria-hidden="true">◆</span><span class="grow"><b>Pagar com Pix · ${brl(pr.valor)}</b><span class="s">${ciclo === 'anual' ? 'Paga o ano inteiro de uma vez' : 'Você paga a cada mês pelo QR Code'}</span></span><span aria-hidden="true">›</span></button>
      </div>
      <div id="plpixc"></div>
      <div class="err" id="plerr" role="alert"></div>
      <div class="note">${p.cartao ? 'O cartão é cobrado sozinho no vencimento. ' : s.fase === 'teste' ? 'Com o cartão, a primeira cobrança é no fim do teste grátis. ' : ''}O Turma em Dia não vê nem guarda o número do cartão: ele vai direto para o Mercado Pago.</div>`), sh => {
      const err = m => $('plerr').textContent = m;
      sh.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => { const id = b.dataset.pl; escolha = id === R.plano.planoId || id === pl.id || escolha === id ? null : id; desenhar(); if (escolha) setTimeout(() => $('plsim') && $('plsim').scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30); });
      if ($('plnao')) $('plnao').onclick = () => { escolha = null; desenhar(); };
      if ($('plsim')) $('plsim').onclick = async () => { $('plsim').disabled = true;
        try { R = await chamarPlano({ acao: 'escolher', planoId: escolha }); aviso(`Plano ${R.mensal.plano.nome} escolhido`); escolha = null; desenhar(); } catch (e) { err(msgErro(e)); $('plsim').disabled = false; } };
      sh.querySelectorAll('[data-per]').forEach(b => b.onclick = async () => { if (b.dataset.per === ciclo) return; ciclo = b.dataset.per; if (parar) parar(); pixAberto = false; desenhar();
        if (R.plano.cartao) { try { R = await chamarPlano({ acao: 'ciclo', ciclo }); aviso(ciclo === 'anual' ? 'O cartão passa a ser cobrado uma vez por ano' : 'O cartão passa a ser cobrado todo mês'); desenhar(); } catch (e) { err(msgErro(e)); } } });
      if ($('pldoc')) { $('pldoc').addEventListener('input', e => { const x = C.soDigitos(e.target.value); e.target.value = x.length > 11 ? fmtCnpj(x) : fmtCpf(x); });
        $('pldocok').onclick = async () => { $('pldocok').disabled = true; try { R = await chamarPlano({ acao: 'documento', doc: $('pldoc').value }); if (R.aviso) aviso(R.aviso); else aviso('Salvo'); desenhar(); } catch (e) { err(msgErro(e)); $('pldocok').disabled = false; } }; }
      const abrirCartao = () => abrirDe(() => desenhar(), () => sheetCartaoPlano(R, ciclo, novo => { R = novo; desenhar(); }));
      if ($('pladd')) $('pladd').onclick = abrirCartao;
      if ($('pltroca')) $('pltroca').onclick = abrirCartao;
      if ($('pltira')) $('pltira').onclick = () => duploToque($('pltira'), async () => { try { R = await chamarPlano({ acao: 'tirarCartao' }); aviso('Cartão tirado. Pague por Pix a cada mês.'); desenhar(); } catch (e) { err(msgErro(e)); } }, 'Toque de novo para tirar');
      $('plpix').onclick = async () => {
        if (pixAberto) return; pixAberto = true; $('plpixc').innerHTML = '<div class="empty">Gerando o Pix…</div>';
        try {
          const { pix } = await chamarPlano({ acao: 'pix', ciclo });
          $('plpixc').innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;margin-top:12px"><div class="tot"><span>Pix do plano (${ciclo === 'anual' ? '1 ano' : '1 mês'})</span><b class="num">${brl(pix.valor)}</b></div>
            <div class="qrbox">${pix.qr64 ? `<img src="data:image/png;base64,${pix.qr64}" alt="QR Code do Pix">` : qrSVG(pix.qr)}</div><div class="code">${esc(pix.qr)}</div>
            <button class="btn" id="plcop">Copiar código Pix</button><div class="pix-st" id="plst"><i></i>Aguardando o pagamento. Esta tela muda sozinha quando o Pix cair.</div>
            ${MOCK ? '<button class="btn ghost" id="plmock">Teste: simular Pix pago</button>' : ''}</div>`;
          $('plcop').onclick = () => copiar(pix.qr, 'Código Pix copiado. Cole no app do banco.');
          if ($('plmock')) $('plmock').onclick = () => mockPlano({ acao: 'mockPago', ciclo });
          const antes = (S.plano || {}).pagoAte || '';
          if (parar) parar();
          parar = B.ouvirDoc(`escolas/${S.eid}/config/plano`, d => { if (d && (d.pagoAte || '') !== antes && $('plst')) { if (parar) parar(); parar = null; pixAberto = false; aviso('Pix do plano recebido. Obrigado!'); carregar(); } }, () => { });
        } catch (e) { pixAberto = false; $('plpixc').innerHTML = ''; err(msgErro(e)); }
      };
    }, () => { if (parar) parar(); parar = null; });
  };
  sheet(corpo('<div class="empty">Carregando…</div>'));
  carregar();
}
// app da loja: só a situação do plano e o uso (sem preço, pagamento ou troca de plano)
async function sheetPlanoLoja() {
  sheet('<h3>Plano da escola</h3><div class="empty">Carregando…</div>');
  let R; try { R = await chamarPlano({ acao: 'estado' }); } catch (e) { return sheet(`<h3>Plano da escola</h3><div class="empty"><b>Não deu para abrir o plano.</b><span>${esc(msgErro(e))}</span></div><button class="btn ghost" data-fechar>Fechar</button>`); }
  const p = R.plano, s = R.situacao, pl = R.mensal.plano, lim = pl.ate || Math.max(R.alunos, 1), pct = Math.min(100, Math.round(R.alunos / lim * 100));
  const fx = s.fase === 'teste' ? `<b>Teste grátis</b> · ${s.restam ? `faltam ${s.restam} dia${s.restam > 1 ? 's' : ''} (até ${dataBR(s.venc)})` : 'termina hoje'}`
    : s.fase === 'cortesia' ? `<b>Grátis até ${dataBR(p.cortesiaAte)}</b>` : s.fase === 'ativo' ? `<b>Em dia</b> · até ${dataBR(p.pagoAte)}`
    : s.fase === 'aviso' ? `<b>Venceu em ${dataBR(s.venc)}</b>` : `<b>${s.fase === 'leitura' ? 'Só leitura' : 'Suspensa'}</b> · atrasado desde ${dataBR(s.venc)}`;
  sheet(`<h3>Plano da escola</h3><div class="banner ${['leitura', 'suspensa'].includes(s.fase) ? 'alerta' : s.fase === 'aviso' ? '' : 'ok'}"><span>${fx}</span></div>
    <div class="pl-uso"><div class="pl-uso-t"><span>Alunos ativos</span><b class="num">${R.alunos}${pl.ate ? ' de ' + pl.ate : ''}</b></div><div class="pl-barra"><i style="width:${pct}%"></i></div><span class="s">Plano <b>${esc(pl.nome)}</b>.</span></div>
    <button class="btn ghost" data-fechar style="width:100%">Fechar</button>`);
}
// cartão da escola para o plano (na conta do Mercado Pago da empresa do app)
function sheetCartaoPlano(R, ciclo, pronto) {
  let campos = null, bin = '', metodo = null;
  const sair = () => { if (campos) campos.sair(); campos = null; };
  sheet(`<h3>Adicionar cartão</h3>
    <div class="pl-cartao-img"><span>•••• •••• •••• ••••</span><small>${esc((S.escola.nome || '').toUpperCase().slice(0, 30))}</small></div>
    <div class="field"><label>Número do cartão</label><div class="mpcampo" id="ccnum"></div></div>
    <div class="two"><div class="field"><label>Validade</label><div class="mpcampo" id="ccval"></div></div><div class="field"><label>Código de segurança</label><div class="mpcampo" id="cccvv"></div></div></div>
    <div class="field"><label for="ccnome">Nome no cartão</label><input id="ccnome" autocomplete="cc-name" placeholder="Como está no cartão"></div>
    <div class="field"><label for="ccdoc">CPF ou CNPJ do titular</label><input id="ccdoc" inputmode="numeric"></div>
    <div class="note">🔒 O número vai direto para o Mercado Pago. O Turma em Dia não vê nem guarda o número do cartão. ${R.situacao.fase === 'teste' || R.situacao.fase === 'cortesia' ? `A primeira cobrança é em ${dataBRA(R.situacao.venc)}.` : 'A primeira cobrança é agora.'}</div>
    <div class="err" id="ccerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" id="ccvolta">Voltar</button><button class="btn" id="ccok">Salvar cartão</button></div>`, async () => {
    $('ccvolta').onclick = () => { sair(); pronto(R); };
    $('ccdoc').addEventListener('input', e => { const x = C.soDigitos(e.target.value); e.target.value = x.length > 11 ? fmtCnpj(x) : fmtCpf(x); });
    try { campos = await camposCartao(R.publicKey || 'TEST-PUB', { num: 'ccnum', val: 'ccval', cvv: 'cccvv' }, async b => { bin = b; try { metodo = await campos.metodo(b); } catch (e) { } }); }
    catch (e) { $('ccerr').textContent = msgErro(e); $('ccok').disabled = true; return; }
    $('ccok').onclick = async () => {
      const nome = $('ccnome').value.trim(), doc = C.soDigitos($('ccdoc').value), err = m => { $('ccerr').textContent = m; $('ccok').disabled = false; $('ccok').textContent = 'Salvar cartão'; };
      if (nome.length < 3) return err('Escreva o nome como está no cartão.');
      if (!(doc.length === 11 ? C.cpfValido(doc) : doc.length === 14)) return err('Confira o CPF ou CNPJ do titular.');
      $('ccok').disabled = true; $('ccok').textContent = 'Salvando…';
      try {
        const t = await campos.token({ cardholderName: nome, identificationType: doc.length === 11 ? 'CPF' : 'CNPJ', identificationNumber: doc });
        const novo = await chamarPlano({ acao: 'cartao', token: t.id, ciclo, marca: (metodo && metodo.name) || 'Cartão', fim: t.last_four_digits });
        sair(); aviso('Cartão salvo. A cobrança é automática.'); pronto(novo);
      } catch (e) { err(msgErro(e)); }
    };
  }, sair);
}
// modo de teste: o que o servidor "plano" faria
async function mockPlano(b) {
  const ref = `escolas/${S.eid}/config/plano`, h = hoje(), n = Object.values(S.alunas).filter(a => a.ativa !== false && C.ativaNoMes(a, h.slice(0, 7))).length;
  let p = (await B.get(ref)) || null;
  const gravar = async mud => { const x = { ...(p || {}), ...mud }, s = C.situacaoPlano(x, h); p = { ...x, bloqueio: s.bloqueio, fase: s.fase }; await B.set(ref, p); return p; };
  const pub = () => ({ plano: p, situacao: C.situacaoPlano(p, h), alunos: n, mensal: C.precoPlano(n, 'mensal', p, h), anual: C.precoPlano(n, 'anual', p, h), publicKey: 'TEST-PUB' });
  if (!p) await gravar({ inicio: h, testeAte: C.maisDias(h, 30), ciclo: 'mensal', planoId: C.planoPara(n).id });
  else if (!p.planoId) await gravar({ planoId: C.planoPara(n).id });
  if (b.acao === 'escolher') { const pl = C.PLANOS.find(x => x.id === b.planoId); if (!pl) throw new Error('Plano inválido.');
    if (!C.cabePlano(pl, n)) throw new Error(`A escola tem ${n} alunos ativos e o ${pl.nome} vai até ${pl.ate}. Desative alunos ou escolha um plano maior.`);
    await gravar({ planoId: pl.id }); return pub(); }
  if (b.acao === 'documento') { const d = C.soDigitos(b.doc); if (!(d.length === 11 ? C.cpfValido(d) : d.length === 14)) throw new Error('Confira o CPF ou CNPJ.'); await gravar({ doc: d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : `**.***.${d.slice(5, 8)}/${d.slice(8, 12)}-**` }); return { ...pub(), aviso: null }; }
  if (b.acao === 'ciclo') { await gravar({ ciclo: b.ciclo }); return pub(); }
  if (b.acao === 'pix') { const v = C.precoPlano(n, b.ciclo, p, h).valor; return { pix: { mpId: 'mock', valor: v, ciclo: b.ciclo, qr: `00020126580014br.gov.bcb.pix0136turmaemdia-plano5204000053039865802BR5911TURMA EM DIA6006RECIFE62070503***6304PLAN`, expira: Date.now() + 864e5 } }; }
  if (b.acao === 'mockPago') { const venc = [p.testeAte || '', p.pagoAte || ''].sort().pop(); await gravar({ pagoAte: C.maisMeses(venc < C.maisDias(h, -30) ? h : venc, b.ciclo === 'anual' ? 12 : 1), pix: null }); return pub(); }
  if (b.acao === 'cartao') { const venc = [p.testeAte || '', p.pagoAte || '', p.cortesiaAte || ''].sort().pop(); await gravar({ forma: 'cartao', ciclo: b.ciclo, cartao: { marca: b.marca, fim: b.fim }, proxCobranca: venc > h ? venc : h, ...(venc > h ? {} : { pagoAte: C.maisMeses(h, b.ciclo === 'anual' ? 12 : 1) }) }); return pub(); }
  if (b.acao === 'tirarCartao') { await gravar({ forma: null, cartao: null, proxCobranca: null }); return pub(); }
  if (b.acao === 'codigo') { const c = String(b.codigo).trim().toUpperCase().replace(/\s+/g, ''), x = MOCK_CODIGOS.find(k => k.codigo === c);
    if (!x || !x.ativo) throw new Error('Código não encontrado. Confira as letras e os números.');
    if (p.cortesiaCodigo) throw new Error('Esta escola já usou um código de cortesia.');
    if (x.usos >= x.limite) throw new Error('Este código já foi usado por todas as escolas que ele permite.');
    x.usos++; x.escolas.push({ eid: S.eid, nome: (S.escola || {}).nome || 'Escola', em: Date.now() });
    await gravar({ cortesiaAte: C.maisMeses([h, p.testeAte || '', p.pagoAte || '', p.cortesiaAte || ''].sort().pop(), x.meses), cortesiaMotivo: 'Código ' + c, cortesiaCodigo: c }); return pub(); }
  return pub();
}

/* ---------- Painel do dono: escolas, meses grátis e desconto (como no Pelota FC) ---------- */
let DONO_ESC = null, DONO_F = { q: '', sit: 'todas' };
const FASE_TXT = { teste: ['Teste', 'aberto'], ativo: ['Em dia', 'pago'], cortesia: ['Grátis', 'pago'], aviso: ['Venceu', 'vencido'], leitura: ['Só leitura', 'vencido'], suspensa: ['Suspensa', 'vencido'], livre: ['Sem plano', ''] };
async function sheetEscolasDono(recarregar) {
  const casca = h => `${abasDono('escolas')}<h3>Escolas</h3><div class="sub">Todas as escolas do app. Dê meses grátis ou desconto no plano de quem você escolher.</div><button type="button" class="btn ghost" id="dcods" style="width:100%;margin-top:8px">🎁 Códigos de cortesia</button>${h}<button class="btn ghost" data-fechar>Fechar</button>`;
  if (!DONO_ESC || recarregar) {
    sheet(casca('<div class="empty">Carregando as escolas…</div>'), () => ligarAbasDono());
    try { DONO_ESC = (MOCK ? await mockDono({ acao: 'donoEscolas' }) : await servidor('plano', { acao: 'donoEscolas' })).escolas || []; }
    catch (e) { sheet(casca(`<div class="empty"><b>Não deu para carregar.</b><span>${esc(msgErro(e))}</span></div>`), () => ligarAbasDono()); return; }
  }
  const lista = () => { const q = DONO_F.q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return DONO_ESC.filter(e => (!q || `${e.nome} ${e.cidade} ${e.uf}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q))
      && (DONO_F.sit === 'todas' || (DONO_F.sit === 'atraso' ? ['aviso', 'leitura', 'suspensa'].includes(e.fase) : DONO_F.sit === 'beneficio' ? !!(e.desconto || e.cortesiaAte) : e.fase === DONO_F.sit))); };
  const cartao = e => { const [ft, cls] = FASE_TXT[e.fase] || ['', ''], d = e.desconto;
    return `<li class="nf-card dono-esc"><div class="grow"><div class="nf-lin"><b>${esc(e.nome)}</b><span class="chip ${cls}">${ft}</span></div>
      <span class="s">${esc([e.cidade, e.uf].filter(Boolean).join(' · ') || 'Sem cidade')} · ${e.alunos} aluno${e.alunos === 1 ? '' : 's'} · ${e.pix ? 'Pix ligado' : 'sem Pix'}</span>
      <span class="s">Plano ${esc(e.plano)} ${e.ciclo === 'anual' ? 'anual' : 'mensal'}: ${d ? `<s>${brl(e.cheio)}</s> <b>${brl(e.valor)}</b>` : `<b>${brl(e.valor)}</b>`}${e.forma === 'cartao' ? ' · no cartão' : ''}${e.venc ? ` · vence ${dataBRA(e.venc)}` : ''}</span>
      ${e.cortesiaAte ? `<span class="s dono-ben">🎁 Grátis até ${dataBRA(e.cortesiaAte)}${e.cortesiaMotivo ? ' · ' + esc(e.cortesiaMotivo) : ''}</span>` : ''}
      ${d ? `<span class="s dono-ben">🏷️ Desconto ${d.valor != null ? brl(d.valor) + ' por mês' : d.pct + '%'}${d.ate ? ' até ' + dataBRA(d.ate) : ', sem prazo'}${d.motivo ? ' · ' + esc(d.motivo) : ''}</span>` : ''}
      <div class="actions dono-acoes"><button type="button" class="btn ghost btn-mini" data-dcort="${esc(e.eid)}">Meses grátis</button><button type="button" class="btn ghost btn-mini" data-ddesc="${esc(e.eid)}">Desconto</button></div></div></li>`; };
  sheet(casca(`<div class="field" style="margin:8px 0"><input type="search" id="dqe" value="${esc(DONO_F.q)}" placeholder="Nome ou cidade da escola" aria-label="Procurar escola"></div>
    <div class="seg" style="margin-bottom:10px;flex-wrap:wrap">${[['todas', 'Todas'], ['teste', 'Teste'], ['ativo', 'Em dia'], ['atraso', 'Atrasadas'], ['beneficio', 'Com benefício']].map(([v, t]) => `<button type="button" data-dsit="${v}" aria-pressed="${DONO_F.sit === v}">${t}</button>`).join('')}</div>
    <div class="sub" id="dqn" style="margin-bottom:8px"></div><ul class="list" id="dql"></ul>`), sh => {
    ligarAbasDono(); $('dcods').onclick = () => sheetCodigosDono();
    const pinta = () => { const L = lista(); $('dqn').textContent = `${L.length} escola${L.length === 1 ? '' : 's'}`; $('dql').innerHTML = L.map(cartao).join('') || '<li class="empty">Nenhuma escola com esses filtros.</li>';
      $('dql').querySelectorAll('[data-dcort]').forEach(b => b.onclick = () => abrirDe(() => sheetEscolasDono(), () => sheetCortesiaDono(DONO_ESC.find(x => x.eid === b.dataset.dcort))));
      $('dql').querySelectorAll('[data-ddesc]').forEach(b => b.onclick = () => abrirDe(() => sheetEscolasDono(), () => sheetDescontoDono(DONO_ESC.find(x => x.eid === b.dataset.ddesc)))); };
    $('dqe').addEventListener('input', e => { DONO_F.q = e.target.value; pinta(); });
    sh.querySelectorAll('[data-dsit]').forEach(b => b.onclick = () => { DONO_F.sit = b.dataset.dsit; sh.querySelectorAll('[data-dsit]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); pinta(); });
    pinta();
  });
}
// códigos de cortesia: o dono cria um código com meses grátis e um limite de escolas; a escola usa no passo do cartão
async function sheetCodigosDono() {
  const casca = h => `<h3>Códigos de cortesia</h3><div class="sub">A escola digita o código no passo do cartão: ganha os meses grátis e só cadastra o cartão quando eles acabarem.</div>${h}<div class="actions"><button type="button" class="btn ghost" id="dkvolta">Voltar</button><button type="button" class="btn" id="dknovo">Criar código</button></div>`;
  const ligar = () => { $('dkvolta').onclick = () => sheetEscolasDono(); $('dknovo').onclick = () => sheetNovoCodigoDono(); };
  sheet(casca('<div class="empty">Carregando os códigos…</div>'), ligar);
  let L; try { L = (MOCK ? await mockCodigos({ acao: 'donoCodigos' }) : await servidor('plano', { acao: 'donoCodigos' })).codigos || []; }
  catch (e) { sheet(casca(`<div class="empty"><b>Não deu para carregar.</b><span>${esc(msgErro(e))}</span></div>`), ligar); return; }
  const item = k => { const cheio = k.usos >= k.limite, st = !k.ativo ? ['Desativado', 'vencido'] : cheio ? ['Esgotado', 'vencido'] : ['Ativo', 'pago'];
    return `<li class="nf-card dono-esc"><div class="grow"><div class="nf-lin"><b>${esc(k.codigo)}</b><span class="chip ${st[1]}">${st[0]}</span></div>
      <span class="s">${k.meses} ${k.meses === 1 ? 'mês grátis' : 'meses grátis'} · usado por ${k.usos} de ${k.limite} escola${k.limite === 1 ? '' : 's'}${k.motivo ? ' · ' + esc(k.motivo) : ''}</span>
      ${(k.escolas || []).length ? `<span class="s">Usaram: ${k.escolas.map(e => esc(e.nome)).join(', ')}</span>` : ''}
      ${k.ativo && !cheio ? `<button type="button" class="link" data-dkdes="${esc(k.codigo)}" style="align-self:flex-start;color:var(--out);font-size:.82rem">Desativar</button>` : ''}</div></li>`; };
  sheet(casca(`<ul class="list" style="margin-top:8px">${L.map(item).join('') || '<li class="empty">Nenhum código ainda.</li>'}</ul>`), sh => { ligar();
    sh.querySelectorAll('[data-dkdes]').forEach(b => b.onclick = () => duploToque(b, async () => {
      try { MOCK ? await mockCodigos({ acao: 'donoDesativarCodigo', codigo: b.dataset.dkdes }) : await servidor('plano', { acao: 'donoDesativarCodigo', codigo: b.dataset.dkdes }); aviso('Código desativado'); sheetCodigosDono(); } catch (e) { aviso(msgErro(e)); } }, 'Toque de novo para desativar')); });
}
function sheetNovoCodigoDono() {
  sheet(`<h3>Novo código</h3><div class="sub">Quando o número de escolas chegar ao limite, o código para de funcionar.</div>
    <div class="field"><label for="dkcod">Código</label><input id="dkcod" autocapitalize="characters" autocomplete="off" maxlength="30" placeholder="Ex.: ESCOLA-AMIGA"></div>
    <div class="dn-lin"><span class="lb">Meses grátis</span><span class="passador"><button type="button" data-p="dkmes" data-d="-1" aria-label="Menos um mês">−</button><input id="dkmes" inputmode="numeric" value="3" aria-label="Meses grátis"><button type="button" data-p="dkmes" data-d="1" aria-label="Mais um mês">+</button></span></div>
    <div class="dn-lin"><span class="lb">Quantas escolas</span><span class="passador"><button type="button" data-p="dklim" data-d="-1" aria-label="Menos uma escola">−</button><input id="dklim" inputmode="numeric" value="1" aria-label="Quantas escolas podem usar"><button type="button" data-p="dklim" data-d="1" aria-label="Mais uma escola">+</button></span></div>
    <div class="field"><label for="dkmot">Motivo (só você vê)</label><input id="dkmot" maxlength="200" placeholder="Ex.: escolas parceiras"></div>
    <div class="err" id="dkerr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" id="dkvolta">Voltar</button><button type="button" class="btn" id="dkok">Criar</button></div>`, sh => {
    const max = { dkmes: 36, dklim: 1000 };
    sh.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { const i = $(b.dataset.p); i.value = Math.max(1, Math.min(max[b.dataset.p], (Math.round(Number(i.value)) || 0) + Number(b.dataset.d))); });
    $('dkcod').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); });
    $('dkvolta').onclick = () => sheetCodigosDono();
    $('dkok').onclick = async () => { const corpo = { acao: 'donoCriarCodigo', codigo: $('dkcod').value, meses: Math.round(Number($('dkmes').value)), limite: Math.round(Number($('dklim').value)), motivo: $('dkmot').value };
      if (corpo.codigo.length < 3) return $('dkerr').textContent = 'O código precisa de pelo menos 3 letras ou números.';
      if (!(corpo.meses >= 1 && corpo.meses <= 36)) return $('dkerr').textContent = 'Escolha de 1 a 36 meses.';
      if (!(corpo.limite >= 1 && corpo.limite <= 1000)) return $('dkerr').textContent = 'Escolha de 1 a 1000 escolas.';
      $('dkok').disabled = true;
      try { MOCK ? await mockCodigos(corpo) : await servidor('plano', corpo); aviso(`Código ${corpo.codigo} criado`); sheetCodigosDono(); }
      catch (e) { $('dkerr').textContent = msgErro(e); $('dkok').disabled = false; } };
  });
}
async function acaoDono(corpo, ok) {
  DONO_ESC = (MOCK ? await mockDono(corpo) : await servidor('plano', corpo)).escolas || DONO_ESC; aviso(ok); sheetEscolasDono();
}
function sheetCortesiaDono(e) {
  sheet(`<h3>Meses grátis</h3><div class="sub"><b>${esc(e.nome)}</b> · ${esc(e.plano)}, ${brl(e.valor)} ${e.ciclo === 'anual' ? 'por ano' : 'por mês'}${e.cortesiaAte ? ` · já grátis até ${dataBRA(e.cortesiaAte)}` : ''}</div>
    <div class="dn-lin"><span class="lb">Quantos meses</span><span class="passador"><button type="button" id="dcmenos" aria-label="Menos um mês">−</button><input id="dco" inputmode="numeric" value="3" aria-label="Meses grátis"><button type="button" id="dcmais" aria-label="Mais um mês">+</button></span></div>
    <div class="field"><label for="dcmot">Motivo (só você vê)</label><input id="dcmot" maxlength="200" placeholder="Ex.: parceria, indicação"></div>
    <div class="sub" id="dcate"></div>
    <div class="err" id="dcerr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" id="dcvolta">Voltar</button><button type="button" class="btn" id="dcok">Salvar</button></div>
    ${e.cortesiaAte ? '<button type="button" class="link" id="dctira" style="align-self:center;color:var(--out)">Cancelar os meses grátis</button>' : ''}`, () => {
    const base = () => [hoje(), e.venc || '', e.cortesiaAte || ''].sort().pop(), m = () => Math.round(Number($('dco').value));
    const ver = () => { const n = m(); $('dcate').innerHTML = n >= 1 && n <= 36 ? `Fica grátis até <b>${dataBRA(C.maisMeses(base(), n))}</b>. Se paga no cartão, a cobrança pausa e volta sozinha.` : 'Escolha de 1 a 36 meses.'; };
    const soma = d => { $('dco').value = Math.max(1, Math.min(36, (m() || 0) + d)); ver(); };
    $('dcmenos').onclick = () => soma(-1); $('dcmais').onclick = () => soma(1); $('dco').addEventListener('input', ver); ver();
    $('dcvolta').onclick = () => sheetEscolasDono();
    $('dcok').onclick = async () => { const n = m(); if (!(n >= 1 && n <= 36)) return $('dcerr').textContent = 'Escolha de 1 a 36 meses.';
      $('dcok').disabled = true; try { await acaoDono({ acao: 'donoCortesia', eid: e.eid, meses: n, motivo: $('dcmot').value }, `${n} ${n === 1 ? 'mês grátis' : 'meses grátis'} para ${e.nome}`); } catch (x) { $('dcerr').textContent = msgErro(x); $('dcok').disabled = false; } };
    if ($('dctira')) $('dctira').onclick = () => duploToque($('dctira'), async () => { try { await acaoDono({ acao: 'donoTirarCortesia', eid: e.eid }, 'Meses grátis cancelados'); } catch (x) { $('dcerr').textContent = msgErro(x); } }, 'Toque de novo para cancelar');
  });
}
function sheetDescontoDono(e) {
  const d = e.desconto || {}; let tipo = d.valor != null ? 'valor' : 'pct';
  sheet(`<h3>Desconto no plano</h3><div class="sub"><b>${esc(e.nome)}</b> · ${esc(e.plano)}, ${brl(e.ciclo === 'anual' ? e.cheio / 10 : e.cheio)} por mês sem desconto</div>
    <div class="dn-lin"><span class="lb">Desconto</span><span class="dn-dir"><input id="ddn" class="dn-num" inputmode="decimal" value="${esc(d.valor != null ? fmtValor(d.valor) : d.pct != null ? String(d.pct) : '')}" placeholder="0" aria-label="Valor do desconto">
      <span class="seg dn-seg"><button type="button" data-t="pct" aria-pressed="${tipo === 'pct'}">%</button><button type="button" data-t="valor" aria-pressed="${tipo === 'valor'}">R$/mês</button></span></span></div>
    <div class="dn-lin"><span class="lb">Até</span><span class="dn-dir"><input type="date" id="dda" class="dn-data" value="${esc(d.ate || '')}" min="${hoje()}" aria-label="Último dia do desconto"></span></div>
    <span class="s" style="margin-top:-6px">Sem data, o desconto vale sem prazo. Em R$/mês, é o valor que a escola passa a pagar.</span>
    <div class="field"><label for="ddmot">Motivo (só você vê)</label><input id="ddmot" maxlength="200" value="${esc(d.motivo || '')}" placeholder="Ex.: escola parceira"></div>
    <div class="sub" id="ddres"></div>
    <div class="err" id="dderr" role="alert"></div>
    <div class="actions"><button type="button" class="btn ghost" id="ddvolta">Voltar</button><button type="button" class="btn" id="ddok">Salvar</button></div>
    ${e.desconto ? '<button type="button" class="link" id="ddtira" style="align-self:center;color:var(--out)">Tirar o desconto</button>' : ''}`, sh => {
    const mensal = e.ciclo === 'anual' ? e.cheio / 10 : e.cheio;
    const ver = () => { sh.querySelectorAll('[data-t]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.t === tipo)));
      const n = parseValor($('ddn').value), v = tipo === 'pct' ? C.r2(mensal * (1 - Math.min(100, n || 0) / 100)) : Math.min(mensal, n);
      $('ddres').innerHTML = v >= 0 ? `Passa a pagar <b>${brl(v)}</b> por mês${$('dda').value ? ` até ${dataBRA($('dda').value)}` : ', sem prazo'}.` : ''; };
    sh.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tipo = b.dataset.t; ver(); });
    ['ddn', 'dda'].forEach(id => $(id).addEventListener('input', ver)); ver();
    $('ddvolta').onclick = () => sheetEscolasDono();
    $('ddok').onclick = async () => { const n = parseValor($('ddn').value);
      const corpo = { acao: 'donoDesconto', eid: e.eid, motivo: $('ddmot').value, ate: $('dda').value || null, ...(tipo === 'pct' ? { pct: Math.round(n) } : { valor: n }) };
      if (tipo === 'pct' && !(corpo.pct >= 1 && corpo.pct <= 100)) return $('dderr').textContent = 'O desconto vai de 1% a 100%.';
      if (tipo === 'valor' && !(corpo.valor >= 0)) return $('dderr').textContent = 'Digite quanto a escola paga por mês.';
      $('ddok').disabled = true; try { await acaoDono(corpo, `Desconto salvo para ${e.nome}`); } catch (x) { $('dderr').textContent = msgErro(x); $('ddok').disabled = false; } };
    if ($('ddtira')) $('ddtira').onclick = () => duploToque($('ddtira'), async () => { try { await acaoDono({ acao: 'donoTirarDesconto', eid: e.eid }, 'Desconto retirado'); } catch (x) { $('dderr').textContent = msgErro(x); } }, 'Toque de novo para tirar');
  });
}
// modo de teste: as escolas do painel do dono
const MOCK_DONO = {}, MOCK_CODIGOS = [{ codigo: 'ESCOLA-AMIGA', meses: 3, limite: 5, usos: 1, escolas: [{ eid: 'e4', nome: 'Natação Golfinho', em: Date.now() - 864e6 }], motivo: 'Escolas parceiras', ativo: true, criadoEm: Date.now() - 2e9 }];
async function mockCodigos(b) {
  if (b.acao === 'donoCriarCodigo') { const c = String(b.codigo || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9-]{3,30}$/.test(c)) throw new Error('O código usa de 3 a 30 letras, números ou traço.');
    if (MOCK_CODIGOS.some(k => k.codigo === c)) throw new Error('Esse código já existe. Escolha outro.');
    MOCK_CODIGOS.unshift({ codigo: c, meses: b.meses, limite: b.limite, usos: 0, escolas: [], motivo: b.motivo || '', ativo: true, criadoEm: Date.now() }); }
  if (b.acao === 'donoDesativarCodigo') MOCK_CODIGOS.find(k => k.codigo === b.codigo).ativo = false;
  return { codigos: MOCK_CODIGOS.map(k => ({ ...k, escolas: [...k.escolas] })) };
}
async function mockDono(b) {
  const h = hoje(), base = [['e1', 'Escolinha Movimento', 'Recife', 'PE', 64, { testeAte: C.maisDias(h, 23) }], ['e2', 'Ballet Arte', 'Olinda', 'PE', 28, { testeAte: '2026-08-01', pagoAte: C.maisDias(h, 12), forma: 'cartao' }], ['e3', 'Escola de Futebol Craques do Amanhã', 'Recife', 'PE', 132, { testeAte: '2026-09-01', pagoAte: C.maisDias(h, -9) }], ['e4', 'Judô Kids', 'Caruaru', 'PE', 18, { testeAte: '2026-06-01', pagoAte: C.maisDias(h, -40) }]];
  for (const [eid, nome, cidade, uf, alunos, p] of base) if (!MOCK_DONO[eid]) MOCK_DONO[eid] = { eid, nome, cidade, uf, alunos, pix: eid !== 'e4', ciclo: 'mensal', ...p };
  const x = MOCK_DONO[b.eid];
  if (b.acao === 'donoCortesia') { const bs = [h, x.testeAte || '', x.pagoAte || '', x.cortesiaAte || ''].sort().pop(); x.cortesiaAte = C.maisMeses(bs, b.meses); x.cortesiaMotivo = b.motivo || ''; }
  if (b.acao === 'donoTirarCortesia') { x.cortesiaAte = null; x.cortesiaMotivo = ''; }
  if (b.acao === 'donoDesconto') x.desconto = { ...(b.pct != null ? { pct: b.pct } : { valor: b.valor }), ate: b.ate || null, motivo: b.motivo || '' };
  if (b.acao === 'donoTirarDesconto') x.desconto = null;
  return { escolas: Object.values(MOCK_DONO).map(e => { const s = C.situacaoPlano(e, h), pr = C.precoPlano(e.alunos, e.ciclo, e, h); return { ...e, fase: s.fase, venc: s.venc, plano: pr.plano.nome, cheio: pr.cheio, valor: pr.valor }; }).sort((a, c) => a.nome.localeCompare(c.nome, 'pt-BR')) };
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
    await B.set(`escolas/${S.eid}/config/geral`, { mpConectadoEm: Date.now(), mpTaxaApp: 0.01, mpChave: 'TEST-PUB' }, { merge: true }); await B.set(`escolas/${S.eid}/config/mp`, { conta: { nome: 'Maria Teste da Silva', doc: '***.456.789-**' }, confirmada: false }, { merge: true }); aviso('Mercado Pago conectado (teste)'); return {};
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
      <div id="jnotasplat"></div>
      <div class="actions"><button class="btn ghost" id="jtroca">Minhas escolas</button><button class="btn ghost" id="jsair">Sair da conta</button></div><button class="btn ghost" data-fechar>Fechar</button>`, () => {
      ligarNotasPlataforma(sheetAjustes);
      if ($('jprivf')) $('jprivf').onclick = () => abrirDe(sheetAjustes, sheetPrivFamilia);
      $('jtroca').onclick = () => { fecharSheet(); telaInicio(); }; $('jsair').onclick = () => { fecharSheet(); B.sair(); };
      // no teste, ligar/desligar é simulado; no app de verdade usa o mesmo OAuth da escola
      if ($('pmcon')) $('pmcon').onclick = async () => { if (!MOCK) return aviso('Disponível quando o servidor for atualizado.'); await B.set(`escolas/${S.eid}/professoras/${S.prof}`, { mpConectadoEm: Date.now(), mpConta: EU.nome || 'Professor(a)' }, { merge: true }); aviso('Mercado Pago ligado (teste)'); setTimeout(sheetAjustes, 60); };
      if ($('pmdes')) $('pmdes').onclick = async () => { await B.set(`escolas/${S.eid}/professoras/${S.prof}`, { mpConectadoEm: null }, { merge: true }); setTimeout(sheetAjustes, 60); };
    });
  }
  const c = S.cfg, conta = (S.mpc || {}).conta, taxaTot = (0.0099 + (Number(c.mpTaxaApp) || 0.01)) * 100;
  const sp = sitPlano(), pl = S.plano;
  const planoTxt = !pl ? (LOJA() ? 'Situação do plano' : 'Planos, teste grátis e como pagar') : sp.fase === 'teste' ? `Teste grátis · ${sp.restam ? `faltam ${sp.restam} dia${sp.restam > 1 ? 's' : ''}` : 'termina hoje'}` : sp.fase === 'cortesia' ? `Grátis até ${dataBRA(pl.cortesiaAte)}` : sp.fase === 'ativo' ? `Em dia · pago até ${dataBRA(pl.pagoAte)}${pl.cartao ? ' · cartão' : ''}` : sp.fase === 'aviso' ? `Venceu em ${dataBRA(sp.venc)}` : sp.fase === 'leitura' ? 'Atrasado · só leitura' : sp.fase === 'suspensa' ? 'Suspenso' : 'Planos e como pagar';
  sheet(`<h3>Ajustes da escola</h3>
    <section><button type="button" class="linha-botao" id="jplano"><span class="grow"><b>Plano do app</b><span class="s">${esc(planoTxt)}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button></section>
    <section><h2>Pix automático</h2>
      ${c.mpConectadoEm ? `<div class="banner ok"><span>Conectado${conta ? ` à conta de <b>${esc(conta.nome)}</b> ${esc(conta.doc || '')}` : ''}.</span></div>
        ${conta && S.mpc.confirmada === false ? `<div class="sub">É essa a conta que deve receber os pagamentos?</div><div class="actions"><button class="btn ok" id="mpsim">Sim, é essa conta</button><button class="btn ghost" id="mpout">Não, conectar outra</button></div>` : ''}
        <div class="actions"><button class="btn ghost" id="mpinfo">Atualizar dados da conta</button><button class="btn ghost" id="mpdes" style="color:var(--out)">Desconectar</button></div>
        <button type="button" class="linha-botao" id="jnotas"><span class="grow"><b>Notas fiscais do Turma em Dia</b><span class="s">As notas do serviço do app para a escola, para baixar</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>`
        : `<div class="sub">O dinheiro cai direto na conta do Mercado Pago da escola, e a baixa no app é automática. Antes de conectar, confira: conta no nome de quem recebe, maior de 18 anos, identidade confirmada e uma chave Pix cadastrada.</div>
        <div class="note">Se o Mercado Pago já estiver aberto neste celular, ele conecta direto com essa conta. Depois você confere o nome e o CPF.</div>
        <button class="btn" id="mpcon">Conectar Mercado Pago</button>`}
      <div class="field"><label for="jpix">Chave Pix da escola (para conferência)</label><input id="jpix" maxlength="80" value="${esc(c.pixChave || '')}" placeholder="CNPJ, e-mail, celular ou chave aleatória"></div>
      <label class="check"><input type="checkbox" id="jrep" ${c.pixRepassa === true ? 'checked' : ''}> Quem paga cobre a taxa do Pix (${taxaTot.toFixed(2).replace('.', ',')}%)</label>
      <div class="note">Ligado: o responsável paga um pouco a mais e a escola recebe o valor cheio. Desligado: a taxa sai do valor recebido.</div>
      ${simTaxaHTML('jsim', 100)}
    </section>
    <section><h2>Contrato e nota fiscal</h2>
      <button type="button" class="linha-botao" id="jct" style="margin-bottom:10px"><span class="grow"><b>Contrato com as famílias</b><span class="s">${(S.contratoCfg || {}).ativo ? `Pedindo assinatura · ${Object.values(S.contratos || {}).filter(x => x.versao === ((S.contratoCfg || {}).versao || 1)).length} assinado(s)` : 'Modelo pronto para editar; a família assina no app'}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>
      <button type="button" class="linha-botao" id="jnf"><span class="grow"><b>Nota fiscal para as famílias</b><span class="s">${(c.nfFam || {}).ligado ? 'Ligada: sai sozinha quando a família paga' : 'Desligada. Toque para configurar, com o passo a passo'}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button>
    </section>
    <section><h2>Mensalidade</h2>
      <div class="field"><label for="jnome">Nome da escola</label><input id="jnome" maxlength="60" value="${esc(S.escola.nome || '')}"></div>
      <div class="two"><div class="field"><label for="juf">Estado</label><select id="juf"><option value="">Escolha</option>${UFS.map(u => `<option ${c.uf === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="field"><label for="jcid">Cidade</label><select id="jcid" ${c.uf ? '' : 'disabled'}>${c.cidade ? `<option selected>${esc(c.cidade)}</option>` : `<option value="">${c.uf ? 'Carregando…' : 'Escolha o estado'}</option>`}</select></div></div>
      <div class="two"><div class="field"><label for="jvenc">Vencimento (dia)</label><input id="jvenc" type="number" min="1" max="28" value="${esc(c.vencDia || 10)}"></div>
      <div class="field"><label for="jmatv">Taxa de matrícula (R$)</label><input id="jmatv" inputmode="decimal" value="${esc((c.matricula || {}).valor ? fmtValor(c.matricula.valor) : '')}" placeholder="0,00 = não cobra"></div></div>
      <div class="note" style="margin-top:-6px;margin-bottom:12px">Com valor, ao cadastrar um aluno novo o app já lança a taxa de matrícula (dá para desmarcar na hora). Ela aparece no contrato.</div>
      <div class="two"><div class="field"><label for="jirm">Desconto de irmãos (%)</label><input id="jirm" type="number" min="0" max="100" value="${esc(Math.round((Number(c.descIrmas) || 0) * 100))}"></div>
      <div class="field"><label for="jmul">Mais de uma atividade (%)</label><input id="jmul" type="number" min="0" max="100" value="${esc(Math.round((Number(c.descMulti) || 0) * 100))}"></div></div>
      <div class="note">Estes são os percentuais dos botões rápidos. O desconto só vale para o(a) aluno(a) em que você escolher, no cadastro dele(a).</div>
    </section>
    ${true ? `<section><h2>Formas de pagamento</h2>
      <button type="button" class="linha-botao" id="jformas"><span class="grow"><b>Pix${formasCfg().boleto ? ', boleto' : ''}${formasCfg().cartao ? ', cartão' : ''}${formasCfg().cartao && formasCfg().parcelado ? ` (até ${formasCfg().maxParcelas}x)` : ''}</b><span class="s">Escolha o que a família pode usar e confira as taxas da sua conta</span></span><span aria-hidden="true">›</span></button>
    </section>` : ''}
    <section><h2>Avisos no celular das famílias</h2>
      <label class="check"><input type="checkbox" id="jpushf" ${c.pushFamilias === false ? '' : 'checked'}> Avisar as famílias automaticamente</label>
      <ul class="note" style="margin:6px 0 0;padding-left:18px;display:grid;gap:4px">
        <li><b>Evento ou taxa nova:</b> na hora em que você cria.</li>
        <li><b>Vencimentos:</b> 3 dias antes, no dia e, se atrasar, mais 4 lembretes (1 por semana).</li>
        <li><b>Prazo de resposta:</b> 1 dia antes, para quem ainda não respondeu.</li>
        <li><b>Documentos e termo:</b> 1 vez por semana, por até 4 semanas.</li>
      </ul><div class="note">Cada assunto chega num aviso separado. Só recebe quem ativou os avisos no app.</div>
    </section>
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
    <section><h2>Categorias</h2><button type="button" class="linha-botao" id="jcats"><span class="grow"><b>Categorias por data de nascimento</b><span class="s">${categorias().length ? esc(categorias().map(c => c.nome).join(', ')) : 'Ex.: Sub-9, Sub-11. O app distribui os alunos sozinho'}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button></section>
    <section><h2>Documentos dos alunos</h2><button type="button" class="linha-botao" id="jdocs"><span class="grow"><b>Tipos de documento</b><span class="s">${esc(tiposDoc().map(t => t.nome).join(', ') || 'Nenhum')}</span></span><span aria-hidden="true" style="font-weight:800">›</span></button></section>
    <div class="err" id="jerr" role="alert"></div>
    <div class="actions"><button class="btn ghost" data-fechar>Fechar</button><button class="btn" id="jok">Salvar ajustes</button></div>
    <section><h2>Conta</h2><div class="sub">${esc(EU.nome || '')} · ${esc(EU.email || '')}</div>
      <div id="jnotasplat"></div>
      <div class="actions"><button class="btn ghost" id="jtroca">Minhas escolas</button><button class="btn ghost" id="jsair">Sair da conta</button></div></section>
    ${(S.escola.dono || (S.escola.admins || [])[0]) === EU.uid ? '<p class="excluir-esc"><a href="#" id="jexcl">Excluir escola</a></p>' : ''}`, () => {
    if ($('jexcl')) $('jexcl').onclick = e => { e.preventDefault(); excluirEscolaPassos(); };
    if ($('jsimv')) { const verJ = ligarSimTaxa('jsim', () => $('jrep').checked); $('jrep').addEventListener('change', verJ); }
    const err = m => $('jerr').textContent = m;
    if ($('juf')) ligarEstadoCidade('juf', 'jcid', S.cfg.cidade || '');
    if ($('jnotas')) $('jnotas').onclick = () => abrirDe(sheetAjustes, sheetNotasEscola);
    if ($('jnf')) $('jnf').onclick = () => abrirDe(sheetAjustes, () => sheetNotaFiscal());
    if ($('jct')) $('jct').onclick = () => abrirDe(sheetAjustes, () => sheetContratoModelo());
    $('jdocs').onclick = () => abrirDe(sheetAjustes, () => sheetTiposDoc(sheetAjustes));
    $('jcats').onclick = () => abrirDe(sheetAjustes, () => sheetCategorias());
    ligarNotasPlataforma(sheetAjustes);
    $('japar').onclick = () => abrirDe(sheetAjustes, sheetAparencia);
    $('jmsgs').onclick = () => abrirDe(sheetAjustes, () => sheetModelos());
    $('jpriv').onclick = () => abrirDe(sheetAjustes, sheetPrivEscola);
    blocoAdms($('jadms'));
    if ($('jformas')) $('jformas').onclick = () => abrirDe(sheetAjustes, sheetFormasEscola);
    $('jplano').onclick = () => abrirDe(sheetAjustes, () => sheetPlano());
    const acao = (id, a) => { if ($(id)) $(id).onclick = async () => { $(id).disabled = true; try { await mpConta(a); if (a !== 'conectar' || MOCK) sheetAjustes(); } catch (e) { err(msgErro(e)); $(id).disabled = false; } }; };
    acao('mpcon', 'conectar'); acao('mpinfo', 'info'); acao('mpout', 'conectar');
    if ($('mpdes')) $('mpdes').onclick = () => confirmar('Desconectar o Mercado Pago?', 'Os responsáveis não vão conseguir pagar por Pix no app até você conectar de novo. Os pagamentos já feitos continuam registrados.', 'Desconectar', () => mpConta('desconectar'));
    if ($('mpsim')) $('mpsim').onclick = async () => { try { await B.set(`escolas/${S.eid}/config/mp`, { confirmada: true }, { merge: true }); aviso('Conta confirmada'); S.mpc.confirmada = true; sheetAjustes(); } catch (e) { err(msgErro(e)); } };
    $('jtroca').onclick = () => { fecharSheet(); telaInicio(); }; $('jsair').onclick = () => { fecharSheet(); B.sair(); };
    $('jok').onclick = async () => {
      const nome = $('jnome').value.trim(), venc = Number($('jvenc').value), irm = Number($('jirm').value), mul = Number($('jmul').value);
      if (!nome) return err('Digite o nome da escola.'); if (!(venc >= 1 && venc <= 28)) return err('O vencimento vai do dia 1 ao 28.');
      if (!(irm >= 0 && irm <= 100) || !(mul >= 0 && mul <= 100)) return err('Os descontos vão de 0 a 100%.');
      const aMul = parseValor($('jamul').value), aJur = parseValor($('jajur').value), matV = $('jmatv').value.trim() ? parseValor($('jmatv').value) : 0;
      if (!(matV >= 0)) return err('Confira o valor da taxa de matrícula, como 100,00.');
      if (!(aMul >= 0) || aMul > MULTA_MAX) return err('A multa por atraso pode ser de no máximo 2%, pela lei.');
      if (!(aJur >= 0) || aJur > JUROS_MAX) return err('Os juros por atraso podem ser de no máximo 1% ao mês, pela lei.');
      $('jok').disabled = true;
      try { await B.lote([{ op: 'merge', p: `escolas/${S.eid}/config/geral`, d: { vencDia: venc, pushFamilias: $('jpushf').checked, matricula: { valor: C.r2(matV) }, descIrmas: irm / 100, descMulti: mul / 100, pixRepassa: $('jrep').checked, pixChave: $('jpix').value.trim(), cidade: $('jcid').value.trim(), uf: $('juf').value, atraso: { ativo: $('jatr').checked, multa: aMul, juros: aJur } } }, { op: 'merge', p: 'escolas/' + S.eid, d: { nome } }]); fecharSheet(); aviso('Ajustes salvos'); }
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
  await B.cadastrar('Juliana Costa', 'professor@teste.com', '123456'); const uP = window.__mock.cur().uid; await B.sair();
  await B.cadastrar('Paula Diretora', 'admin@teste.com', '123456'); const uA = window.__mock.cur().uid;
  const eid = 'esc1', p = `escolas/${eid}`, m = mesHoje(), m1 = mesMais(m, -1), m2 = mesMais(m, -2), set = (q, d) => B.set(q, d);
  const qs = new URLSearchParams(location.search), formasTeste = qs.has('formas');
  const cfg = { categorias: [{ id: 'c7', nome: 'Sub-7', de: '2019-01-01', ate: '2020-12-31' }, { id: 'c9', nome: 'Sub-9', de: '2017-01-01', ate: '2018-12-31' }, { id: 'c11', nome: 'Sub-11', de: '2015-01-01', ate: '2016-12-31' }, { id: 'c13', nome: 'Sub-13', de: '2013-01-01', ate: '2014-12-31' }], atraso: { ativo: true, multa: 2, juros: 1 }, vencDia: 10, pixRepassa: false, descIrmas: 0.1, descMulti: 0.15, mpConectadoEm: Date.now(), mpTaxaApp: 0.01, mpChave: 'TEST-PUB', pixChave: '12.345.678/0001-90',
    ...(formasTeste ? { pixRepassa: true, formas: { boleto: true, cartao: true, parcelado: true, maxParcelas: 6, recorrente: true } } : {}) };
  // ?mock=1&marca=1: a escola de exemplo com cor e escudo próprios (para ver a abertura com a cara da escola)
  if (/[?&]marca=1/.test(location.search)) { cfg.cor = '#1E5A8A'; cfg.logo = 'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><path d='M40 4 70 14v24c0 19-13 32-30 38C23 70 10 57 10 38V14z' fill='#1E5A8A'/><path d='M40 12 62 19v19c0 14-9 24-22 29-13-5-22-15-22-29V19z' fill='#fff'/><text x='40' y='47' text-anchor='middle' font-family='Arial Black,Arial' font-weight='900' font-size='19' fill='#1E5A8A'>EM</text></svg>"); }
  await set(p, { nome: 'Escolinha Movimento', dono: uA, admins: [uA], adminsInfo: { [uA]: { nome: 'Paula Diretora', email: 'admin@teste.com', em: Date.now() - 200 * 864e5 } } });
  await set(`${p}/config/geral`, cfg);
  // plano do app no teste: ?plano=aviso | leitura | suspensa | ativo (padrão: teste grátis com 23 dias)
  { const h = hoje(), fase = qs.get('plano'), venc = { aviso: -3, leitura: -12, suspensa: -40 }[fase];
    const pl = fase === 'ativo' ? { inicio: '2026-08-01', testeAte: '2026-09-01', pagoAte: C.maisDias(h, 18), ciclo: 'mensal', forma: 'cartao', cartao: { marca: 'Visa', fim: '4821' }, proxCobranca: C.maisDias(h, 18) }
      : venc != null ? { inicio: '2026-08-01', testeAte: C.maisDias(h, venc), ciclo: 'mensal' } : { inicio: C.maisDias(h, -7), testeAte: C.maisDias(h, 23), ciclo: 'mensal' };
    const sit = C.situacaoPlano(pl, h); await set(`${p}/config/plano`, { ...pl, bloqueio: sit.bloqueio, fase: sit.fase }); }
  await set(`${p}/config/mp`, { conta: { nome: 'Paula Diretora Souza', doc: '***.456.789-**' }, confirmada: true });
  await set(`${p}/locais/l1`, { nome: 'Unidade Centro', ordem: 1 }); await set(`${p}/locais/l2`, { nome: 'Unidade Praia', ordem: 2 });
  await set(`${p}/equipe/${uP}`, { pid: 'p1', email: 'professor@teste.com', nome: 'Juliana Costa', em: Date.now() - 3 * 864e5 });
  await set('convitesProf/' + chaveEmail('professor@teste.com'), { [`${eid}_p1`]: { eid, pid: 'p1', em: Date.now() } });
  await set('users/' + uP, { escolas: { [eid]: { nome: 'Escolinha Movimento', papel: 'professora', prof: 'Juliana Costa' } } });
  await set(`${p}/professoras/p1`, { fixoEscola: 1500, salImpostos: 420, salBeneficios: 300, emailApp: 'professor@teste.com', appEm: Date.now() - 3 * 864e5, appUid: uP, nome: 'Juliana Costa', telefone: '(81) 95555-1111', mpConectadoEm: Date.now(), mpConta: 'Juliana Costa', mpContaInfo: 'juliana.costa@email.com', pixChave: '(81) 95555-1111' });
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
  const resps = { r1: ['Patrícia Lins', '(81) 99999-1001', '529.982.247-25', 'K7Q2MX'], r1b: ['Patrícia Lins', '81 999991001', '529.982.247-25', 'H4N8PW'], r2: ['Roberto Melo', '(81) 98888-2002', '111.444.777-35', 'P3T8ZA'], r3: ['Carla Andrade', '(81) 97777-3003', '390.533.447-05', 'B9W4HN'], r4: ['Fernanda Rocha', '(81) 96666-4004', '', 'R2D5KC'] };
  for (const [id, [nome, telefone, cpf, cod]] of Object.entries(resps)) { await set(`${p}/responsaveis/${id}`, { nome, telefone, cpf, codigo: cod }); await set('codigos/' + cod, { eid, rid: id }); }
  const alunas = { al1: { nome: 'Sofia Lins', responsavelId: 'r1', turmas: ['t2', 't3'], nascimento: '2016-03-14', descMultiOk: true }, al2: { nome: 'Helena Lins', responsavelId: 'r1b', turmas: ['t4'], nascimento: '2021-08-02' }, al3: { nome: 'Luíza Melo', responsavelId: 'r2', turmas: ['t1'], nascimento: '2018-11-20' },
    al4: { nome: 'Ana Beatriz Andrade', responsavelId: 'r3', turmas: ['t2'], desc: { pct: 0.5, motivo: 'Atleta destaque' }, nascimento: '2015-06-09' }, al5: { nome: 'Pedro Rocha', responsavelId: 'r4', turmas: ['t5'], nascimento: '2017-01-27' }, al6: { nome: 'Alice Rocha', responsavelId: 'r4', turmas: ['t4'], nascimento: '2022-04-15' } };
  for (const [k, v] of Object.entries(alunas)) { v.inicio = m2; v.ativa = true; v.desc = v.desc || null; await set(`${p}/alunas/${k}`, v); }
  await set(`${p}/pedidosFamilia/uped1`, { nome: 'Rafael Andrade', email: 'rafael@email.com', telefone: '81988887777', cpf: '', rids: ['r3'], em: Date.now() });
  await set(`${p}/grupos/g1`, { nome: 'Equipe competitiva', alunas: ['al1', 'al3', 'al4'] });
  await set(`${p}/grupos/g2`, { nome: 'Vai ao Estadual', alunas: ['al1', 'al4'] });
  await set(`${p}/extras/x1`, { tipo: 'evento', semCobranca: true, tamanhos: { tipo: 'letras', opcoes: ['PP', 'P', 'M', 'G', 'GG'] }, nome: 'Torneio Regional', data: `${mesMais(m, 1)}-06`, dataFim: `${mesMais(m, 1)}-09`, local: 'Caruaru', organizador: 'Federação Pernambucana', valorInscricao: 85, prazo: `${m}-28`, convidados: ['al1', 'al3', 'al4'], origem: { grupos: ['g1'] }, part: { al3: { st: 'inscrito', em: Date.now() - 3 * 864e5, quem: 'escola' }, al4: { st: 'interesse', em: Date.now() - 864e5, quem: 'familia' } }, v: 0, alunas: [], grupos: [], turmas: [] });
  await set(`${p}/extras/x2`, { tipo: 'taxa', nome: 'Taxa da federação 2027', v: 40, venc: `${m}-12`, grupos: ['g2'], turmas: [], alunas: [], recebedor: 'escola' });
  // chamada: dias de aula, um 2º professor e as chamadas das últimas semanas da Iniciação (falta a mais recente)
  { const D = { t1: [1, 3], t2: [2, 4, 6], t3: [5], t4: [6], t5: [2, 4], t6: [1, 3], t7: [1, 3], t8: [2, 4], t9: [5] };
    for (const [tid, d] of Object.entries(D)) if (await B.get(`${p}/turmas/${tid}`)) await B.set(`${p}/turmas/${tid}`, { dias: d, chamada: tid !== 't9', ...(tid === 't1' ? { chamadaObrig: true, hora: '08:00' } : {}) }, { merge: true });
    await B.set(`${p}/turmas/t3`, { professoraIds: ['p1'] }, { merge: true }); }
  // taxa dividida com as respostas abertas
  { const ids = Object.keys(alunas), pz = new Date(); pz.setDate(pz.getDate() + 8); pz.setHours(18, 0, 0, 0);
    await set(`${p}/extras/xrt`, { tipo: 'taxa', nome: 'Ônibus para a Copa Nordeste', v: 0, venc: isoDe(new Date(pz.getTime() + 5 * 864e5)), convidados: ids, alunas: [], valores: {}, grupos: [], turmas: [], recebedor: 'escola', origem: { todos: true },
      part: Object.fromEntries(ids.slice(2, 9).map((id, i) => [id, { st: i === 3 ? 'nao' : 'interesse', quem: 'familia' }])), rateio: { total: 1000, prazoEm: pz.getTime(), fechadoEm: null }, criadoEm: Date.now() }); }
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
  // despesas fixas: professor e aluguel já pagos no mês; internet e contador a pagar
  await set(`${p}/fixas/f1`, { desc: 'Professor de futebol', cat: 'Professores e equipe', v: 1800, dia: 5, inicio: mesMais(m, -6), fim: null });
  await set(`${p}/fixas/f2`, { desc: 'Aluguel · Unidade Centro', cat: 'Aluguel do espaço', v: 1200, dia: 5, inicio: mesMais(m, -6), fim: null, localId: 'l1' });
  await set(`${p}/fixas/f3`, { desc: 'Internet', cat: 'Contas (água, luz, internet)', v: 120, dia: 10, inicio: mesMais(m, -6), fim: null });
  await set(`${p}/fixas/f4`, { desc: 'Contador', cat: 'Contador e impostos', v: 350, dia: 20, inicio: mesMais(m, -6), fim: null });
  await set(`${p}/lancamentos/fx_f1_${m}`, { tipo: 'saida', cat: 'Professores e equipe', desc: 'Professor de futebol', v: 1800, data: `${m}-02`, fixa: 'f1', mes: m });
  await set(`${p}/lancamentos/fx_f2_${m}`, { tipo: 'saida', cat: 'Aluguel do espaço', desc: 'Aluguel · Unidade Centro', v: 1200, data: `${m}-02`, localId: 'l1', fixa: 'f2', mes: m });
  await set(`${p}/lancamentos/c3`, { tipo: 'saida', cat: 'Material esportivo', desc: 'Bolas e cones', v: 320, data: `${m}-03` });
  await set(`${p}/membros/${uF}`, { codigo: 'K7Q2MX', nome: 'Patrícia Lins', email: 'familia@teste.com' });
  const nao = { coracao: false, esforco: false, desmaio: false, doenca: false, ossos: false, outro: false };
  await set(`${p}/saude/al4`, { responsavelId: 'r3', respostas: { ...nao, doenca: true }, detalhes: 'Asma leve, usa bombinha antes de esforço intenso.', alergias: '', remedios: 'Bombinha (salbutamol) se precisar', plano: '', emergencia: { nome: 'Carla Andrade', telefone: '(81) 97777-3003', parentesco: 'mãe' }, primeirosSocorros: true, imagem: true, assinatura: { nome: 'Carla Andrade' }, em: Date.now() - 20 * 864e5, versao: 1, atestado: { pedidoEm: Date.now() - 20 * 864e5 } });
  await set(`${p}/saude/al3`, { responsavelId: 'r2', respostas: nao, detalhes: '', alergias: 'Dipirona', remedios: '', plano: 'Hapvida', emergencia: { nome: 'Roberto Melo', telefone: '(81) 98888-2002', parentesco: 'pai' }, primeirosSocorros: true, imagem: false, assinatura: { nome: 'Roberto Melo' }, em: Date.now() - 60 * 864e5, versao: 1, atestado: null });
  // ?limite=1: mais alunos, para ver o aviso de plano quase no limite
  if (qs.has('limite')) for (let i = 1; i <= 14; i++) { await set(`${p}/responsaveis/rl${i}`, { nome: `Responsável ${i}`, telefone: '', cpf: '', codigo: 'L' + (1000 + i) }); await set(`${p}/alunas/l${i}`, { nome: `Aluno Extra ${i}`, responsavelId: `rl${i}`, turmas: ['t3'], inicio: mesMais(m, -1) }); }
  // turmas cheias da professora Juliana (demonstração): 5 turmas com cerca de 15 alunos; os "João" têm algo de saúde no termo
  { const ano = Number(m.slice(0, 4)), novasT = {
      t7: { nome: 'Ballet Infantil', idadeMin: 5, idadeMax: 7, professoraId: 'p1', recebedor: 'p1', localId: 'l2', horario: 'Seg e Qua, 15h às 16h', preco: 170, vagas: 16, ordem: 7 },
      t8: { nome: 'GR Juvenil', idadeMin: 13, idadeMax: 17, professoraId: 'p1', recebedor: 'p1', localId: 'l1', horario: 'Ter e Qui, 19h às 20h30', preco: 240, vagas: 15, ordem: 8 },
      t9: { nome: 'Jazz Kids', idadeMin: 8, idadeMax: 11, professoraId: 'p1', recebedor: 'p1', localId: 'l2', horario: 'Sex, 14h às 15h30', preco: 160, vagas: 15, ordem: 9 } };
    for (const [k, v] of Object.entries(novasT)) await set(`${p}/turmas/${k}`, v);
    const NOMES = ['Laura', 'Helena', 'Alice', 'Manuela', 'Valentina', 'Cecília', 'Lívia', 'Isadora', 'Antonella', 'Lorena', 'Heloísa', 'Clara', 'Beatriz', 'Mariana', 'Elisa', 'Rafaela', 'Yasmin', 'Lara', 'Melissa', 'Gabriela', 'Arthur', 'Davi', 'Gael', 'Theo', 'Heitor', 'Bernardo', 'Samuel', 'Benício', 'Lorenzo', 'Matheus', 'Isabela', 'Luna', 'Ayla', 'Vitória', 'Esther', 'Sarah', 'Olívia', 'Pietra', 'Bianca', 'Nina', 'Emanuelly', 'Catarina', 'Marina', 'Agatha', 'Allana', 'Liz', 'Maitê', 'Ana Júlia', 'Maria Eduarda', 'Maria Clara', 'Rebeca', 'Giovanna', 'Luiza', 'Stella', 'Milena', 'Joana', 'Carolina', 'Débora', 'Vitor', 'Enzo', 'Miguel', 'Noah', 'Ravi', 'Pedro', 'Lucas', 'Gustavo', 'Bento', 'Benjamin', 'Caio', 'Leonardo'];
    const SOBRE = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Ferreira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Carvalho', 'Araújo', 'Ribeiro', 'Gomes', 'Barbosa', 'Cavalcanti', 'Monteiro', 'Teixeira', 'Freitas'];
    const MAES = ['Ana', 'Juliana', 'Fernanda', 'Patrícia', 'Aline', 'Camila', 'Renata', 'Priscila', 'Vanessa', 'Tatiana', 'Luciana', 'Daniela', 'Roberta', 'Simone', 'Cristiane'];
    // os João: um por turma, cada um com uma questão de saúde diferente
    const JOAO = {
      t1: ['João Pedro Silva', { doenca: true }, 'Asma. Usa bombinha antes de atividade intensa.', '', 'Bombinha (salbutamol) na mochila', true],
      t2: ['João Lucas Ferreira', {}, '', 'Amendoim e castanhas (alergia grave). Tem caneta de adrenalina.', 'Caneta de adrenalina (EpiPen) na mochila', true],
      t7: ['João Miguel Santos', { doenca: true }, 'Epilepsia controlada com remédio. Última crise há 2 anos.', '', 'Depakene 2x ao dia (em casa)', true],
      t8: ['João Gabriel Costa', { coracao: true, esforco: true }, 'Sopro no coração. Faz atividade com liberação do cardiologista.', '', '', false],
      t9: ['João Vitor Lima', { doenca: true }, 'Diabetes tipo 1. Mede a glicose antes da aula; se ficar tonto, dar suco.', 'Dipirona', 'Insulina (bomba)', true] };
    let n = 0;
    for (const [tid, t] of Object.entries({ t1: turmas.t1, t2: turmas.t2, ...novasT })) {
      for (let i = 0; i < 15; i++) {
        n++; const id = `d${n}`, rid = `rd${n}`, joao = i === 3 ? JOAO[tid] : null;
        const nome = joao ? joao[0] : `${NOMES[(n - 1) % NOMES.length]} ${SOBRE[(n * 7) % SOBRE.length]}`, sob = nome.split(' ').pop();
        const idadeA = t.idadeMin + (n % (t.idadeMax - t.idadeMin + 1)), nasc = `${ano - idadeA}-${pad(1 + (n % 12))}-${pad(1 + (n * 5) % 27)}`;
        const mae = `${MAES[n % MAES.length]} ${sob}`, tel = `(81) 9${String(8100 + n).padStart(4, '0')}-${String(1000 + n * 37).slice(-4)}`;
        await set(`${p}/responsaveis/${rid}`, { nome: mae, telefone: tel, cpf: '', codigo: 'D' + String(10000 + n) });
        await set(`${p}/alunas/${id}`, { nome, nascimento: nasc, responsavelId: rid, turmas: [tid], inicio: mesMais(m, -3 - (n % 5)) });
        // a maioria pagou o mês; alguns em aberto
        if (n % 4) await set(`${p}/pagamentos/${id}`, { mens: { [m]: { s: 'pago', d: `${m}-0${1 + (n % 8)}`, v: t.preco, via: n % 3 ? 'pix' : 'dinheiro', rec: t.recebedor } } });
        const resp = joao ? { ...nao, ...joao[1] } : nao; const emT = Date.now() - (20 + n) * 864e5;
        await set(`${p}/saude/${id}`, { responsavelId: rid, respostas: resp, detalhes: joao ? joao[2] : '', alergias: joao ? joao[3] : '', remedios: joao ? joao[4] : '', plano: n % 2 ? 'Hapvida' : '',
          emergencia: { nome: mae, telefone: tel, parentesco: 'mãe' }, primeirosSocorros: joao ? joao[5] : true, imagem: n % 6 !== 0, assinatura: { nome: mae }, em: emT, ...(joao ? {} : { vistoAdm: emT }), versao: 1, atestado: joao && (joao[1].coracao || joao[1].doenca) ? { pedidoEm: Date.now() - 10 * 864e5 } : null });
      }
    }
  }
  // chamadas das últimas semanas da Iniciação (falta a mais recente), com todos os alunos da turma; uma aula sem aula (feriado)
  { const t1 = (await B.onde(`${p}/alunas`, 'turmas', 'array-contains', 't1')).map(x => x.id), aulas = [];
    for (let i = 1; i <= 28; i++) { const d = somaDias(hoje(), -i); if ([1, 3].includes(diaSem(d))) aulas.push(d); }
    aulas.shift(); aulas.reverse();
    for (const [k, d] of aulas.entries()) {
      if (k === 3) { await set(`${p}/chamadas/t1_${d}`, { tid: 't1', data: d, pres: {}, alunos: [], semAula: true, motivo: 'Feriado', por: { nome: 'Juliana Costa', papel: 'professor', em: Date.now() } }); continue; }
      const pres = Object.fromEntries(t1.map((id, i) => [id, i === 0 && k >= aulas.length - 3 ? 'f' : (i * 7 + k) % 11 === 0 ? 'f' : i === 1 && k === 2 ? 'j' : 'p']));
      await set(`${p}/chamadas/t1_${d}`, { tid: 't1', data: d, pres, alunos: Object.keys(pres), obs: '', por: { nome: 'Juliana Costa', papel: 'professor', em: new Date(d + 'T21:10:00Z').getTime() }, editado: null, hist: [] }); } }
  // documentos de exemplo: Sofia em dia, Luíza com o parecer vencido, Ana Beatriz com o parecer vencendo
  const docFalso = (titulo, nome, w = 900, h = 1200) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, w, h); g.fillStyle = '#222'; g.font = `bold ${Math.round(w / 22)}px sans-serif`; g.fillText(titulo, w * 0.08, h * 0.1);
    g.font = `${Math.round(w / 32)}px sans-serif`; g.fillText('Nome: ' + nome, w * 0.08, h * 0.17); g.fillStyle = '#c9c4ba';
    for (let k = 0, y = h * 0.24; y < h * 0.78; k++, y += h * 0.045) g.fillRect(w * 0.08, y, w * (0.55 + (k * 37 % 30) / 100), h * 0.014);
    g.strokeStyle = '#2a3a6a'; g.lineWidth = 3; g.beginPath(); g.moveTo(w * 0.55, h * 0.9); g.bezierCurveTo(w * 0.65, h * 0.83, w * 0.72, h * 0.95, w * 0.88, h * 0.87); g.stroke(); return c.toDataURL('image/jpeg', 0.7); };
  const diaM = n => isoDe(new Date(Date.now() + n * 864e5));
  const docM = async (alid, rid, tid, arquivos, data, validade, familia) => { const em = Date.now() - 20 * 864e5;
    await set(`${p}/documentos/${alid}__${tid}`, { alid, tipo: tid, responsavelId: rid, formato: 'img', arquivos, nome: tid + '.jpg', tam: 95000 * arquivos.length, em });
    return [tid, { em, familia, data, validade, formato: 'img', paginas: arquivos.length, tam: 95000 * arquivos.length }]; };
  await set(`${p}/docsAlunos/al1`, { responsavelId: 'r1', docs: Object.fromEntries([await docM('al1', 'r1', 'cardio', [docFalso('PARECER CARDIOLÓGICO', 'Sofia Lins')], diaM(-90), maisMeses(diaM(-90), 12), true),
    await docM('al1', 'r1', 'ident', [docFalso('CERTIDÃO DE NASCIMENTO', 'Sofia Lins', 1200, 800), docFalso('CERTIDÃO · VERSO', 'Sofia Lins', 1200, 800)], null, null, true)]) });
  await set(`${p}/docsAlunos/al3`, { responsavelId: 'r2', docs: Object.fromEntries([await docM('al3', 'r2', 'cardio', [docFalso('PARECER CARDIOLÓGICO', 'Luíza Melo')], diaM(-377), diaM(-12), false)]) });
  await set(`${p}/docsAlunos/al4`, { responsavelId: 'r3', docs: Object.fromEntries([await docM('al4', 'r3', 'cardio', [docFalso('PARECER CARDIOLÓGICO', (alunas.al4 || {}).nome || 'Aluno')], diaM(-345), diaM(20), false)]) });
  await set(`${p}/notasAlunos/n1`, { alid: 'al1', texto: 'Evoluiu muito no passe curto e na leitura de jogo. Ainda precisa trabalhar o chute com a perna esquerda; combinamos exercícios extras no fim do treino de quinta.', tag: 'desempenho', autorUid: uA, autorNome: 'Paula Diretora', em: Date.now() - 6 * 864e5 });
  await set(`${p}/notasAlunos/n2`, { alid: 'al1', texto: 'A mãe avisou que ela vai faltar dia 20 por consulta médica.', tag: 'familia', autorUid: 'outro', autorNome: 'Camila Ribeiro', em: Date.now() - 2 * 864e5 });
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
  try { B = MOCK ? backendMock() : await backendReal(); travarEscritas(B); }
  catch (e) { RAIZ().innerHTML = `<div class="login"><div class="logo">Ops<span>.</span></div><p>Não deu para carregar o app. Verifique a internet e tente de novo.</p></div>`; return; }
  if (!MOCK && (!CFG.firebase || /COLE-AQUI|SEU-PROJETO/.test(JSON.stringify(CFG.firebase)))) { RAIZ().innerHTML = `<div class="login"><div class="logo">Quase lá<span>.</span></div><p>Falta colocar os dados do projeto Firebase no arquivo <b>config.js</b>. Para ver o app funcionando com dados de exemplo, abra com <b>?mock=1</b> no fim do endereço.</p></div>`; return; }
  if (MOCK) await semearMock();
  registrarSW(); lerLinkChamada(location.href);
  // professor: atualiza a tela de turmas a cada minuto e ao voltar ao app (a chamada feita pelo outro professor some)
  const atualizarProf = () => { if (S && S.papel === 'p' && S.tab === 'pturmas' && !$('overlay').innerHTML && document.visibilityState === 'visible') carregarPainelProf(); };
  setInterval(atualizarProf, 60000); document.addEventListener('visibilitychange', atualizarProf);
  // quem já entrou continua entrando direto (no app de verdade o Firebase guarda o login; no teste, guardamos aqui)
  if (MOCK && ls.get('escolinha.mockLogin')) { try { await B.login(ls.get('escolinha.mockLogin'), '123456'); } catch (e) { } }
  let vez = 0;
  B.onAuth(async u => {
    const minha = ++vez;
    const saiu = !!EU && !u; // tocou em Sair (não é a primeira abertura sem conta)
    pararOuvintes(); fecharSheet(); EU = u; $('toast').hidden = true;
    if (MOCK) ls.set('escolinha.mockLogin', u ? u.email || null : null);
    if (u) { INTRO_VISTA = true; ls.set('escolinha.introVista', '1'); } // já entrou: daqui em diante abre direto
    if (u) setTimeout(enviarErros, 3000); // erros guardados antes do login
    // o site de entrada (turmaemdia.com.br) manda direto para o app quem já entrou neste aparelho
    if (!MOCK) { try { if (u) localStorage.setItem('ted.entrou', '1'); else localStorage.removeItem('ted.entrou'); } catch (e) { } }
    // sem conta (abriu sem login ou saiu da conta): a apresentação do app aparece de novo antes do login
    // no computador, quem sai da conta volta para o site (turmaemdia.com.br); no celular continua na tela de entrar
    if (saiu && DESK() && !MOCK && /\/app\/?$/.test(location.pathname)) { location.replace('../'); return; }
    if (!u) { S = null; INTRO_VISTA = !!ENTRAR_PARAM; sairAbertura(); return telaLogin(ENTRAR_NOVO() ? 'criar' : 'entrar'); }
    const perfil = await B.get('users/' + u.uid).catch(() => null);
    if (minha !== vez) return;
    MINHAS = Object.fromEntries(Object.entries((perfil && perfil.escolas) || {}).filter(([, e]) => e));
    USR = perfil || {};
    // responsável que já fez o cadastro e ainda não tem escola: procura de novo (a escola pode ter cadastrado o e-mail dele)
    if (!Object.keys(MINHAS).length && USR.perfil && !MOCK) identificarFamilia().then(r => { if (minha !== vez || !(r.escolas || []).length || S) return; const ks = Object.keys(MINHAS); aviso('Achamos seus filhos!'); abrirEscola(ks[0]); }).catch(() => { });
    // convite para a administração: procura sem atrasar a abertura da escola
    vincularProf().then(r => { if (minha !== vez || !r) return; if (((r.escolas || []).length || PROF_PEND.length) && !S) telaInicio(); });
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

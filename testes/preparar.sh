#!/bin/bash
# Varredura do app no modo de teste com as regras de leitura do banco imitadas (só para testes; não vai para o site).
# Uso:  bash testes/preparar.sh && (cd /tmp/tt && python3 -m http.server 8766 &) && python3 /tmp/tt/varrer.py tudo
# Copia o app para /tmp/tt e liga as regras imitadas (regras-mock.js) no modo de teste.
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"; REPO="$(dirname "$AQUI")"
mkdir -p /tmp/tt && cp "$AQUI/regras-mock.js" "$AQUI/varrer.py" /tmp/tt/
cd "$REPO"
rm -rf /tmp/tt/app && cp -r app /tmp/tt/app && cp index.html 404.html /tmp/tt/ && cp -r img /tmp/tt/ 2>/dev/null || true
cd /tmp/tt/app
python3 - <<'PY'
p='app.js'; s=open(p).read()
neg = "Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied', name: 'FirebaseError' })"
def rep(old,new):
    global s
    assert old in s, old[:60]; s=s.replace(old,new,1)
rep("    get: async p => clone(store.get(p)) ?? null,", f"    get: async p => {{ if (window.__podeLer && !window.__podeLer(p, null, cur && cur.uid, false)) throw {neg}; return clone(store.get(p)) ?? null; }},")
rep("    ouvirDoc: (p, cb) => { setTimeout(() => cb(clone(store.get(p)) ?? null), 0); if (!docL.has(p)) docL.set(p, []); docL.get(p).push(cb); return () => docL.set(p, docL.get(p).filter(x => x !== cb)); },",
    f"    ouvirDoc: (p, cb, err) => {{ if (window.__podeLer && !window.__podeLer(p, null, cur && cur.uid, false)) {{ setTimeout(() => {{ const e = {neg}; if (err) err(e); else console.error('Uncaught Error in snapshot listener:', e); }}, 0); return () => {{ }}; }} setTimeout(() => cb(clone(store.get(p)) ?? null), 0); if (!docL.has(p)) docL.set(p, []); cb.__err = err; docL.get(p).push(cb); return () => docL.set(p, docL.get(p).filter(x => x !== cb)); }},")
rep("    ouvirCol: (c, cb, err, onde) => { const l = { c, cb, onde };", f"    ouvirCol: (c, cb, err, onde) => {{ if (window.__podeLer && !window.__podeLer(c, onde, cur && cur.uid, true)) {{ setTimeout(() => {{ const e = {neg}; if (err) err(e); else console.error('Uncaught Error in snapshot listener:', e); }}, 0); return () => {{ }}; }} const l = {{ c, cb, onde, err }};")
for old,col,onde in [("    ultimos: async (p, campo, n) => ","p","null"),("    meus: async (p, campo, v) => ","p","[campo, v]"),("    onde: async (p, campo, op, v) => ","p","op === '==' ? [campo, v] : null")]:
    i=s.index(old, s.index('function backendMock')); j=i+len(old)
    s=s[:j]+"{ "+f"if (window.__podeLer && !window.__podeLer({col}, {onde}, cur && cur.uid, true)) throw {neg}; "+"return "+s[j:]
    k=s.index('\n', j); s=s[:k-1]+" },"+s[k:]
# revogar: o banco corta todas as ligações com "sem permissão" (como no iPhone ao voltar do segundo plano)
rep("window.__mock = { store, users, cur: () => cur,", f"window.__mock = {{ colL, docL, revogar: () => {{ const e = () => {neg}; const ls_ = [...colL]; colL.length = 0; ls_.forEach(l => l.err && l.err(e())); for (const [p, a] of docL) {{ const cp = [...a]; docL.set(p, []); cp.forEach(cb => cb.__err && cb.__err(e())); }} }}, store, users, cur: () => cur,")
rep("window.registrarErro = registrarErro;", "window.registrarErro = registrarErro; window.__tela = () => telaAtual(); window.__S = () => S;")
open(p,'w').write(s)
p='index.html'; s=open(p).read()
s=s.replace('<script type="module" src="app.js', '<script src="../regras-mock.js"></script>\n<script type="module" src="app.js',1)
open(p,'w').write(s)
PY
node --check app.js && echo preparado

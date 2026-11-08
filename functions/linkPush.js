/* Turma em Dia · resposta direto no aviso do celular (botões "Vai" / "Não vai").
   O aviso leva um código assinado pelo servidor (quem, escola, evento, aluno, validade), porque o botão
   do aviso responde sem abrir o app (sem login). O segredo fica em servidor/pushSegredo (só o servidor lê). */
'use strict';
const crypto = require('crypto');
module.exports = db => {
  let cache = null;
  async function segredo() {
    if (cache) return cache;
    const ref = db.doc('servidor/pushSegredo'), d = (await ref.get()).data();
    if (d && d.s) return (cache = d.s);
    const s = crypto.randomBytes(32).toString('hex'); await ref.set({ s }); return (cache = s);
  }
  const hmac = async p => crypto.createHmac('sha256', await segredo()).update(p).digest('base64url');
  async function assinar(o) { const p = Buffer.from(JSON.stringify(o)).toString('base64url'); return `${p}.${await hmac(p)}`; }
  async function abrir(tk) {
    const [p, h] = String(tk || '').split('.'); if (!p || !h) return null;
    const ok = await hmac(p); if (ok.length !== h.length || !crypto.timingSafeEqual(Buffer.from(ok), Buffer.from(h))) return null;
    try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o && o.exp > Date.now() ? o : null; } catch (e) { return null; }
  }
  return { assinar, abrir };
};

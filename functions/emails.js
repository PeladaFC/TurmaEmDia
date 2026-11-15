/* Turma em Dia · e-mails com a cara do app (confirmar e-mail e trocar a senha).
   - O link de confirmação/troca é gerado pelo Firebase (o mesmo de sempre), mas o e-mail é montado aqui:
     logo do app, logo e nome da escola quando houver, texto que explica para que serve e um botão.
   - O texto muda conforme o motivo: professor(a) liberado(a) por uma escola, convite para administrar uma escola,
     Painel do dono, ou cadastro comum.
   - Envio pelo Resend (resend.com). A chave fica em servidor/email { chave, de } (configurar-email.sh), que o app não lê.
     Sem a chave, o servidor responde { semEnvio: true } e o app usa o e-mail padrão do Firebase, como antes.
   - logoEscola: devolve o logo da escola como imagem, para aparecer no e-mail (o app guarda o logo dentro do banco). */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

const SITE = 'https://www.turmaemdia.com.br';
const LOGO_APP = SITE + '/app/icon-192.png';
const idOk = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x);
const chaveEmail = e => String(e || '').trim().toLowerCase().replace('@', '_at_').replace(/[^a-z0-9_-]/g, '_');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const primeiro = n => String(n || '').trim().split(/\s+/)[0] || '';
const corOk = c => /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#8B6B47';

// ---------- o e-mail ----------
function montar({ nome, titulo, texto, botao, link, escola, aviso, cor }) {
  const c = corOk(cor);
  const blocoEscola = escola ? `
        <tr><td style="padding:22px 32px 0">
          <table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #E2D9CB;border-radius:12px;width:100%"><tr>
            ${escola.logo ? `<td style="padding:12px 0 12px 14px;width:56px"><img src="${esc(escola.logo)}" width="48" height="48" alt="" style="display:block;border-radius:10px;object-fit:contain;background:#fff"></td>` : ''}
            <td style="padding:12px 14px;font:600 15px/1.35 Arial,Helvetica,sans-serif;color:#221D17">${esc(escola.nome)}<br><span style="font-weight:400;font-size:13px;color:#6B6257">Escola no Turma em Dia</span></td>
          </tr></table>
        </td></tr>` : '';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:#F6F3EE">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EE"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#3A2B1C;padding:18px 32px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td><img src="${LOGO_APP}" width="36" height="36" alt="" style="display:block;border-radius:8px"></td>
          <td style="padding-left:10px;font:800 19px/1 Arial,Helvetica,sans-serif;color:#ffffff">Turma em Dia</td>
        </tr></table>
      </td></tr>
      ${blocoEscola}
      <tr><td style="padding:26px 32px 4px;font:400 16px/1.55 Arial,Helvetica,sans-serif;color:#221D17">
        <p style="margin:0 0 6px;color:#6B6257">Olá${nome ? ', ' + esc(primeiro(nome)) : ''}! Aqui é do Turma em Dia.</p>
        <h1 style="margin:0 0 14px;font:800 24px/1.2 Arial,Helvetica,sans-serif;color:#221D17">${esc(titulo)}</h1>
        ${texto.map(p => `<p style="margin:0 0 12px">${p}</p>`).join('')}
      </td></tr>
      <tr><td align="center" style="padding:14px 32px 8px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="${c}" style="border-radius:10px">
          <a href="${esc(link)}" target="_blank" style="display:inline-block;padding:16px 34px;font:800 17px/1 Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:10px">${esc(botao)}</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:14px 32px 26px;font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#6B6257">
        ${aviso ? `<p style="margin:0 0 10px">${aviso}</p>` : ''}
        <p style="margin:0">Se o botão não abrir, <a href="${esc(link)}" style="color:#6B6257">toque aqui</a>.</p>
      </td></tr>
      <tr><td style="background:#EEE7DC;padding:16px 32px;font:400 12px/1.5 Arial,Helvetica,sans-serif;color:#6B6257">
        Turma em Dia · a escolinha organizada, do pagamento à chamada<br><a href="${SITE}" style="color:#6B6257">www.turmaemdia.com.br</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const txt = [`Olá${nome ? ', ' + primeiro(nome) : ''}! Aqui é do Turma em Dia.`, '', titulo, '', ...texto.map(p => p.replace(/<[^>]+>/g, '')), '', `${botao}: ${link}`, '', aviso ? aviso.replace(/<[^>]+>/g, '') : '', 'Turma em Dia · www.turmaemdia.com.br'].join('\n');
  return { html, txt };
}

// o texto de cada motivo
function textos(motivo, ctx) {
  const naoFoi = 'Se não foi você que pediu, é só ignorar este e-mail. Nada muda na sua conta.';
  if (motivo === 'senha') return {
    assunto: 'Troque a sua senha do Turma em Dia', titulo: 'Vamos trocar a sua senha',
    texto: ['Recebemos um pedido para trocar a senha da sua conta no Turma em Dia.', 'Toque no botão abaixo e escolha uma senha nova. Depois é só entrar no app com ela.'],
    botao: 'Escolher senha nova', aviso: naoFoi + ' A sua senha atual continua valendo.' };
  const fim = 'Confirmar o e-mail é feito uma vez só. Ele mostra que este e-mail é mesmo seu, para ninguém criar uma conta no seu nome.';
  if (motivo === 'professor' && ctx.escola) return {
    assunto: `Confirme seu e-mail para entrar como professor(a) da ${ctx.escola.nome}`, titulo: 'Confirme o seu e-mail para entrar como professor(a)',
    texto: [`A <b>${esc(ctx.escola.nome)}</b> liberou o seu acesso como professor(a) no Turma em Dia.`, 'Toque no botão para confirmar o seu e-mail. Depois volte ao app e toque em <b>"Já confirmei"</b>: você vai ver as suas turmas, a chamada e os seus alunos.', fim],
    botao: 'Confirmar meu e-mail', aviso: naoFoi };
  if (motivo === 'admin' && ctx.escola) return {
    assunto: `Confirme seu e-mail para administrar a ${ctx.escola.nome}`, titulo: 'Confirme o seu e-mail para aceitar o convite',
    texto: [`Você foi convidado(a) para ajudar a administrar a <b>${esc(ctx.escola.nome)}</b> no Turma em Dia.`, 'Toque no botão para confirmar o seu e-mail. Depois entre de novo no app e toque em <b>"Aceitar"</b>.', fim],
    botao: 'Confirmar meu e-mail', aviso: naoFoi };
  if (motivo === 'dono') return {
    assunto: 'Confirme seu e-mail para abrir o Painel do dono', titulo: 'Confirme o seu e-mail para abrir o Painel do dono',
    texto: ['O Painel do dono mostra os números de todas as escolas, por isso só abre com o e-mail confirmado.', 'Toque no botão, volte ao app e toque em <b>"Já confirmei"</b>.'],
    botao: 'Confirmar meu e-mail', aviso: naoFoi };
  return {
    assunto: 'Confirme seu e-mail no Turma em Dia', titulo: 'Confirme o seu e-mail',
    texto: ['Falta só um passo para usar o Turma em Dia: confirmar que este e-mail é seu.', 'Toque no botão abaixo e volte ao app.', fim],
    botao: 'Confirmar meu e-mail', aviso: naoFoi };
}

module.exports = (db, opcoes = {}) => {
  const erro = (m, http) => Object.assign(new Error(m), { http });
  const ler = async p => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
  const verificar = opcoes.verificar || (async t => admin.auth().verifyIdToken(t));
  const auth = () => opcoes.auth || admin.auth();
  const enviarResend = opcoes.enviar || (async (cfg, msg) => {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.de || 'Turma em Dia <nao-responda@turmaemdia.com.br>', to: [msg.para], subject: msg.assunto, html: msg.html, text: msg.txt, ...(cfg.responder ? { reply_to: cfg.responder } : {}) }) });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('Resend ' + r.status + ' ' + t.slice(0, 200)); }
  });
  const cfgEnvio = async () => { const c = await ler('servidor/email'); return c && c.chave ? c : null; };

  // escola para mostrar no e-mail (nome, logo e cor)
  async function escolaInfo(eid) {
    if (!idOk(eid)) return null;
    const e = await ler(`escolas/${eid}`); if (!e || e.encerradaEm) return null;
    const g = (await ler(`escolas/${eid}/config/geral`)) || {};
    return { eid, nome: e.nome || 'Escola', logo: g.logo ? `${opcoes.base || ''}/logoEscola?eid=${eid}` : '', cor: corOk(g.cor) };
  }
  // a escola certa para cada motivo, conferida aqui (não vale a palavra do app)
  async function contexto(motivo, email, eid) {
    const k = chaveEmail(email);
    if (motivo === 'professor') {
      const mapa = (await ler(`convitesProf/${k}`)) || {};
      for (const c of Object.values(mapa)) {
        if (!c || !idOk(c.eid) || !idOk(c.pid) || (eid && c.eid !== eid)) continue;
        const P = await ler(`escolas/${c.eid}/professoras/${c.pid}`);
        if (P && String(P.emailApp || '').toLowerCase() === email) return { escola: await escolaInfo(c.eid) };
      }
    }
    if (motivo === 'admin') {
      const todos = (await ler(`convitesAdm/${k}`)) || {};
      const ok = Object.entries(todos).filter(([e, c]) => c && c.expira > Date.now() && (!eid || e === eid));
      if (ok.length) return { escola: await escolaInfo(ok[0][0]) };
    }
    return {};
  }
  const limite = async (chave, seg) => {
    const ref = db.doc(`limites/email_${chave}`), d = await ler(ref.path);
    if (d && Date.now() - (d.em || 0) < seg * 1000) throw erro('Já mandamos agora há pouco. Espere um minuto e tente de novo.', 429);
    await ref.set({ em: Date.now() });
  };

  // confirmar o e-mail (quem está logado)
  const mandarConfirmacao = onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const h = req.get('Authorization') || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
      if (!t) throw erro('Entre na sua conta.', 401);
      let u; try { u = await verificar(t); } catch (e) { throw erro('Entre na sua conta de novo.', 401); }
      const email = String(u.email || '').toLowerCase(); if (!email) throw erro('Esta conta não tem e-mail.', 400);
      const pessoa = await auth().getUser(u.uid);
      if (pessoa.emailVerified) return res.json({ ja: true });
      const cfg = await cfgEnvio(); if (!cfg) return res.json({ semEnvio: true });
      const b = req.body || {}, motivo = ['professor', 'admin', 'dono'].includes(b.motivo) ? b.motivo : 'geral';
      await limite(chaveEmail(email), 50);
      const ctx = await contexto(motivo, email, idOk(b.eid) ? b.eid : null);
      const link = await auth().generateEmailVerificationLink(email, { url: SITE + '/app/?confirmado=1' });
      const T = textos(ctx.escola || motivo === 'dono' ? motivo : 'geral', ctx), m = montar({ nome: pessoa.displayName || u.name, ...T, link, escola: ctx.escola, cor: ctx.escola && ctx.escola.cor });
      await enviarResend(cfg, { para: email, assunto: T.assunto, html: m.html, txt: m.txt });
      res.json({ ok: true });
    } catch (e) { if (!e.http) logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Não deu para mandar o e-mail agora. Tente de novo.' }); }
  });

  // trocar a senha (quem esqueceu: não está logado)
  const mandarSenha = onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const email = String((req.body || {}).email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw erro('Digite um e-mail válido.', 400);
      const cfg = await cfgEnvio(); if (!cfg) return res.json({ semEnvio: true });
      await limite('senha_' + chaveEmail(email), 50);
      let pessoa; try { pessoa = await auth().getUserByEmail(email); } catch (e) { return res.json({ ok: true }); } // não conta se o e-mail existe
      const link = await auth().generatePasswordResetLink(email, { url: SITE + '/app/' });
      const T = textos('senha', {}), m = montar({ nome: pessoa.displayName, ...T, link });
      await enviarResend(cfg, { para: email, assunto: T.assunto, html: m.html, txt: m.txt });
      res.json({ ok: true });
    } catch (e) { if (!e.http) logger.error(e); res.status(e.http || 500).json({ erro: e.http ? e.message : 'Não deu para mandar o e-mail agora. Tente de novo.' }); }
  });

  // logo da escola como imagem (para o e-mail)
  const logoEscola = onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
    try {
      const eid = String(req.query.eid || ''); if (!idOk(eid)) return res.status(404).end();
      const g = (await ler(`escolas/${eid}/config/geral`)) || {}, l = String(g.logo || '');
      const m = l.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
      if (m) { res.set('Cache-Control', 'public, max-age=86400').type(m[1]).send(Buffer.from(m[2], 'base64')); return; }
      if (/^https:\/\//.test(l)) return res.redirect(302, l);
      res.status(404).end();
    } catch (e) { logger.error(e); res.status(500).end(); }
  });

  return { mandarConfirmacao, mandarSenha, logoEscola, interno: { montar, textos } };
};

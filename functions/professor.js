/* Turma em Dia · área do professor.
   A administração coloca o e-mail do professor no cadastro dele (professoras/{pid}.emailApp). O servidor guarda
   o caminho em convitesProf/{e-mail} (espelho.js). Quando o professor entra com esse e-mail (confirmado), o app
   chama "vincular" e ele passa a ver a escola, com o papel de professor (escolas/{eid}/equipe/{uid}).
   O professor não lê os dados da escola direto: o servidor monta só o que ele pode ver (alunos das turmas
   dele, sem telefone, CPF, saúde ou documentos; a parte dele nos pagamentos) e cuida das notas dele.
   Se a escola trocar ou apagar o e-mail, o acesso acaba na hora (cada pedido confere de novo). */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const C = require('./calculo');

const idOk = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x);
const chaveEmail = e => String(e || '').trim().toLowerCase().replace('@', '_at_').replace(/[^a-z0-9_-]/g, '_');
const hojeRecife = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
const TAGS = ['desempenho', 'comportamento', 'saude', 'familia', 'outro'];

module.exports = db => {
  const erro = (m, http, codigo) => Object.assign(new Error(m), { http, codigo });
  const ler = async p => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
  const col = async p => Object.fromEntries((await db.collection(p).get()).docs.map(d => [d.id, d.data()]));
  async function usuario(req) {
    const h = req.get('Authorization') || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!t) throw erro('Entre na sua conta.', 401);
    try { return await admin.auth().verifyIdToken(t); } catch (e) { throw erro('Entre na sua conta de novo.', 401); }
  }
  // o professor desta conta nesta escola (confere que o e-mail ainda é o cadastrado pela escola)
  async function professorDe(u, eid) {
    if (!idOk(eid)) throw erro('Pedido inválido.', 400);
    const eq = await ler(`escolas/${eid}/equipe/${u.uid}`);
    if (!eq || !idOk(eq.pid)) throw erro('Você não é professor(a) desta escola.', 403);
    const P = await ler(`escolas/${eid}/professoras/${eq.pid}`);
    const email = String(u.email || '').toLowerCase();
    if (!P || !u.email_verified || String(P.emailApp || '').toLowerCase() !== email) {
      await desligar(eid, u.uid); throw erro('A escola tirou o seu acesso de professor(a).', 403, 'sem-acesso');
    }
    return { pid: eq.pid, P };
  }
  async function desligar(eid, uid) {
    await db.doc(`escolas/${eid}/equipe/${uid}`).delete().catch(() => { });
    await db.doc(`users/${uid}`).set({ escolas: { [eid]: FieldValue.delete() } }, { merge: true }).catch(() => { });
  }
  // os alunos que este professor pode ver: os das turmas dele
  async function meusAlunos(eid, pid) {
    const turmas = await col(`escolas/${eid}/turmas`), minhas = Object.keys(turmas).filter(t => turmas[t] && turmas[t].professoraId === pid);
    const alunas = {};
    for (let i = 0; i < minhas.length; i += 30) {
      const q = await db.collection(`escolas/${eid}/alunas`).where('turmas', 'array-contains-any', minhas.slice(i, i + 30)).get();
      q.docs.forEach(d => { alunas[d.id] = d.data(); });
    }
    return { turmas, minhas, alunas };
  }

  const professor = onRequest({ cors: true, maxInstances: 5 }, async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });
      const u = await usuario(req), b = req.body || {}, { acao, eid } = b;

      if (acao === 'vincular') {
        if (!u.email) return res.json({ escolas: [] });
        const mapa = (await ler(`convitesProf/${chaveEmail(u.email)}`)) || {}, email = u.email.toLowerCase(), achadas = [];
        for (const c of Object.values(mapa)) {
          if (!c || !idOk(c.eid) || !idOk(c.pid)) continue;
          const P = await ler(`escolas/${c.eid}/professoras/${c.pid}`), E = await ler(`escolas/${c.eid}`);
          if (!P || !E || String(P.emailApp || '').toLowerCase() !== email) continue;
          achadas.push({ eid: c.eid, pid: c.pid, nome: E.nome || 'Escola', prof: P.nome || '' });
        }
        // só com o e-mail confirmado: senão alguém criaria uma conta com o e-mail do professor
        if (achadas.length && !u.email_verified) return res.json({ escolas: [], confirmar: true, pendentes: achadas.map(a => a.nome) });
        for (const a of achadas) {
          await db.doc(`escolas/${a.eid}/equipe/${u.uid}`).set({ pid: a.pid, email, nome: a.prof, em: Date.now() });
          await db.doc(`users/${u.uid}`).set({ escolas: { [a.eid]: { nome: a.nome, papel: 'professora', prof: a.prof } } }, { merge: true });
          await db.doc(`escolas/${a.eid}/professoras/${a.pid}`).set({ appUid: u.uid, appEm: Date.now() }, { merge: true });
        }
        return res.json({ escolas: achadas.map(a => ({ eid: a.eid, nome: a.nome, prof: a.prof })) });
      }

      const { pid, P } = await professorDe(u, eid);

      if (acao === 'painel') {
        const mes = C.mesValido(b.mes) ? b.mes : hojeRecife().slice(0, 7);
        const { turmas, alunas } = await meusAlunos(eid, pid);
        const ids = Object.keys(alunas), pags = {};
        if (ids.length) (await db.getAll(...ids.map(id => db.doc(`escolas/${eid}/pagamentos/${id}`)))).forEach(s => { if (s.exists) pags[s.id] = s.data(); });
        const [extras, grupos, acordos, cfg] = await Promise.all([col(`escolas/${eid}/extras`), col(`escolas/${eid}/grupos`), col(`escolas/${eid}/acordos`), ler(`escolas/${eid}/config/geral`)]);
        const r = C.painelProfessor({ alunas, turmas, extras, grupos, acordos, cfg: cfg || {}, pags }, pid, mes, hojeRecife());
        // fotos (pequenas) dos alunos que ele vê
        const fotos = {}, vis = r.alunos.map(a => a.id);
        if (vis.length) (await db.getAll(...vis.map(id => db.doc(`escolas/${eid}/fotosAlunos/${id}`)))).forEach(s => { if (s.exists && s.data().foto) fotos[s.id] = s.data().foto; });
        // saúde: o resumo do termo de cada aluno (para a aula ser segura)
        const saude = {};
        if (vis.length) (await db.getAll(...vis.map(id => db.doc(`escolas/${eid}/saude/${id}`)))).forEach(s => { if (s.exists) { const x = C.saudeProfessor(s.data()); if (x) saude[s.id] = x; } });
        return res.json({ pid, nome: P.nome || '', mes, ...r, fotos, saude });
      }

      if (acao === 'notas' || acao === 'nota' || acao === 'apagarNota') {
        const alid = b.alid;
        if (!idOk(alid)) throw erro('Pedido inválido.', 400);
        const { minhas } = await meusAlunos(eid, pid), a = await ler(`escolas/${eid}/alunas/${alid}`);
        if (!a || !(a.turmas || []).some(t => minhas.includes(t))) throw erro('Este aluno não está nas suas turmas.', 403);
        const base = db.collection(`escolas/${eid}/notasAlunos`);
        if (acao === 'notas') {
          const q = await base.where('alid', '==', alid).get();
          return res.json({ notas: q.docs.map(d => ({ id: d.id, ...d.data() })).sort((x, y) => (y.em || 0) - (x.em || 0)) });
        }
        if (acao === 'apagarNota') {
          if (!idOk(b.id)) throw erro('Pedido inválido.', 400);
          const n = await ler(`escolas/${eid}/notasAlunos/${b.id}`);
          if (!n || n.alid !== alid || n.autorUid !== u.uid) throw erro('Você só pode apagar as suas notas.', 403);
          await base.doc(b.id).delete(); return res.json({ ok: true });
        }
        const texto = String(b.texto || '').trim().slice(0, 2000), tag = TAGS.includes(b.tag) ? b.tag : null;
        if (!texto) throw erro('Escreva a nota.', 400);
        if (b.id) {
          if (!idOk(b.id)) throw erro('Pedido inválido.', 400);
          const n = await ler(`escolas/${eid}/notasAlunos/${b.id}`);
          if (!n || n.alid !== alid || n.autorUid !== u.uid) throw erro('Você só pode editar as suas notas.', 403);
          await base.doc(b.id).update({ texto, tag, editadoEm: Date.now() }); return res.json({ ok: true, id: b.id });
        }
        const ref = await base.add({ alid, texto, tag, autorUid: u.uid, autorNome: P.nome || u.name || 'Professor(a)', papel: 'professor', em: Date.now() });
        return res.json({ ok: true, id: ref.id });
      }
      throw erro('Pedido inválido.', 400);
    } catch (e) {
      if (!e.http) logger.error(e);
      res.status(e.http || 500).json({ erro: e.http ? e.message : 'Algo deu errado. Tente de novo.', codigo: e.codigo || null });
    }
  });
  return { professor };
};

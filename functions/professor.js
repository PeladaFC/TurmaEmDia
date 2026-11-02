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
const maisDiasR = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
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
    const turmas = await col(`escolas/${eid}/turmas`), minhas = Object.keys(turmas).filter(t => turmas[t] && C.daTurma(turmas[t], pid));
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
        // responsável de cada aluno: só o nome e o WhatsApp, para o contato rápido do professor
        const rids = [...new Set(r.alunos.map(x => (alunas[x.id] || {}).responsavelId).filter(Boolean))], resps = {};
        if (rids.length) (await db.getAll(...rids.map(id => db.doc(`escolas/${eid}/responsaveis/${id}`)))).forEach(s => { if (s.exists) resps[s.id] = { nome: s.data().nome || '', telefone: s.data().telefone || '' }; });
        r.alunos.forEach(x => { const rr = resps[(alunas[x.id] || {}).responsavelId]; if (rr) x.resp = rr; });
        // saúde: o resumo do termo de cada aluno (para a aula ser segura)
        const saude = {};
        if (vis.length) (await db.getAll(...vis.map(id => db.doc(`escolas/${eid}/saude/${id}`)))).forEach(s => { if (s.exists) { const x = C.saudeProfessor(s.data()); if (x) saude[s.id] = x; } });
        // chamadas feitas nas turmas dele nos últimos 21 dias (para lembrar a que falta fazer)
        const minhasT = Object.keys(turmas).filter(t => C.daTurma(turmas[t], pid)), feitas = {};
        const qc = await db.collection(`escolas/${eid}/chamadas`).where('data', '>=', maisDiasR(hojeRecife(), -21)).get();
        qc.docs.forEach(x => { const c = x.data(); if (minhasT.includes(c.tid)) (feitas[c.tid] = feitas[c.tid] || []).push(c.data); });
        return res.json({ pid, nome: P.nome || '', mes, ...r, fotos, saude, chamadas: feitas });
      }

      // chamada: o professor abre e salva a chamada das turmas dele (fica registrado quem fez e cada mudança)
      if (acao === 'chamada' || acao === 'salvarChamada') {
        const { tid, data } = b;
        if (!idOk(tid) || !/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) throw erro('Pedido inválido.', 400);
        const t = await ler(`escolas/${eid}/turmas/${tid}`);
        if (!t || !C.daTurma(t, pid)) throw erro('Esta turma não é sua.', 403);
        const h = hojeRecife();
        if (data > h) throw erro('Ainda não chegou esse dia.', 400);
        const q = await db.collection(`escolas/${eid}/alunas`).where('turmas', 'array-contains', tid).get();
        const alunos = q.docs.map(x => ({ id: x.id, ...x.data() })).filter(a => !a.anonimizadoEm && a.ativa !== false && C.ativaNoMes(a, data.slice(0, 7))).map(a => ({ id: a.id, nome: a.nome || 'Aluno(a)' }));
        const ref = db.doc(`escolas/${eid}/chamadas/${C.chaveChamada(tid, data)}`);
        if (acao === 'chamada') {
          const rq = await db.collection(`escolas/${eid}/chamadas`).where('data', '>=', maisDiasR(h, -120)).get();
          const recentes = rq.docs.map(x => x.data()).filter(c => c.tid === tid && c.data !== data);
          return res.json({ alunos, doc: (await ref.get()).data() || null, recentes });
        }
        if (data < maisDiasR(h, -60)) throw erro('Só dá para mexer na chamada dos últimos 60 dias. Fale com a escola.', 400);
        const ok = new Set(alunos.map(a => a.id)), pres = {}, semAula = b.semAula === true;
        if (!semAula) for (const [id, st] of Object.entries(b.pres || {})) if (ok.has(id) && ['p', 'f', 'j'].includes(st)) pres[id] = st;
        const quem = { uid: u.uid, nome: P.nome || u.name || 'Professor(a)', papel: 'professor', em: Date.now() };
        const atual = (await ref.get()).data();
        await ref.set({ tid, data, pres, alunos: Object.keys(pres), obs: String(b.obs || '').trim().slice(0, 300), semAula, motivo: semAula ? String(b.motivo || '').trim().slice(0, 120) : '', extra: !!(t.dias || []).length && !t.dias.includes(new Date(data + 'T12:00:00Z').getUTCDay()), por: atual && atual.por ? atual.por : quem, editado: atual ? quem : null, hist: FieldValue.arrayUnion(quem) }, { merge: true });
        return res.json({ ok: true });
      }

      // caderneta: as chamadas de uma turma dele num mês (tabela de presença)
      if (acao === 'caderneta') {
        const { tid, mes } = b;
        if (!idOk(tid) || !C.mesValido(mes)) throw erro('Pedido inválido.', 400);
        const t = await ler(`escolas/${eid}/turmas/${tid}`);
        if (!t || !C.daTurma(t, pid)) throw erro('Esta turma não é sua.', 403);
        const q = await db.collection(`escolas/${eid}/chamadas`).where('data', '>=', mes + '-01').get();
        const chamadas = q.docs.map(x => x.data()).filter(c => c.tid === tid && String(c.data).slice(0, 7) === mes);
        const qa = await db.collection(`escolas/${eid}/alunas`).where('turmas', 'array-contains', tid).get();
        const naLista = new Set(chamadas.flatMap(c => Object.keys(c.pres || {})));
        const alunos = qa.docs.map(x => ({ id: x.id, ...x.data() })).filter(a => !a.anonimizadoEm && (naLista.has(a.id) || (a.ativa !== false && C.ativaNoMes(a, mes)))).map(a => ({ id: a.id, nome: a.nome || 'Aluno(a)' }));
        return res.json({ alunos, chamadas: chamadas.map(c => ({ data: c.data, pres: c.pres || {}, semAula: !!c.semAula, motivo: c.motivo || '', extra: !!c.extra })) });
      }

      // aviso da chamada no celular: guarda (ou tira) o aparelho deste professor
      if (acao === 'push') {
        const tk = String(b.token || ''); if (!tk || tk.length > 400) throw erro('Pedido inválido.', 400);
        const ref = db.doc(`escolas/${eid}/equipe/${u.uid}`), atual = ((await ref.get()).data() || {}).push || [];
        const nova = b.ligar === false ? atual.filter(x => x !== tk) : [...atual.filter(x => x !== tk), tk].slice(-5);
        await ref.set({ push: nova }, { merge: true });
        return res.json({ ok: true, aparelhos: nova.length });
      }

      // frequência de um aluno das turmas dele
      if (acao === 'freq') {
        if (!idOk(b.alid)) throw erro('Pedido inválido.', 400);
        const { turmas, minhas } = await meusAlunos(eid, pid), a = await ler(`escolas/${eid}/alunas/${b.alid}`);
        if (!a || !(a.turmas || []).some(t => minhas.includes(t))) throw erro('Este aluno não está nas suas turmas.', 403);
        const q = await db.collection(`escolas/${eid}/chamadas`).where('alunos', 'array-contains', b.alid).get();
        return res.json({ chamadas: q.docs.map(x => x.data()).filter(c => minhas.includes(c.tid)).map(c => ({ tid: c.tid, data: c.data, pres: { [b.alid]: (c.pres || {})[b.alid] } })), turmas: Object.fromEntries(minhas.map(t => [t, { nome: (turmas[t] || {}).nome || '' }])) });
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

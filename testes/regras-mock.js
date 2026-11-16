// Imitação das regras de LEITURA do firestore.rules, para o modo de teste (só para a varredura; não vai para o app).
// window.__podeLer(caminho, onde, uid) -> true/false.  window.__negados guarda tudo que foi recusado.
(function () {
  window.__negados = []; window.__leituras = [];
  const S = () => window.__mock.store;
  const get = p => S().get(p);
  const ex = p => S().has(p);
  const admin = (eid, uid) => !!uid && ex(`escolas/${eid}`) && (get(`escolas/${eid}`).admins || []).includes(uid);
  const membro = (eid, uid) => !!uid && ex(`escolas/${eid}/membros/${uid}`);
  const equipe = (eid, uid) => !!uid && ex(`escolas/${eid}/equipe/${uid}`);
  const meu = (eid, rid, uid) => !!uid && typeof rid === 'string' && ex(`escolas/${eid}/membros/${uid}/vinculos/${rid}`);
  const ridDaAluna = (eid, alid) => (get(`escolas/${eid}/alunas/${alid}`) || {}).responsavelId;
  const minhaAluna = (eid, alid, uid) => meu(eid, ridDaAluna(eid, alid), uid);
  // regra por documento: (eid, id, dados, uid) -> bool
  const R = {
    '': (e, id, d, u) => admin(e, u) || membro(e, u) || equipe(e, u),
    pedidosFamilia: (e, id, d, u) => admin(e, u), pedidosProf: (e, id, d, u) => admin(e, u), avisosEquipe: (e, id, d, u) => admin(e, u),
    responsaveis: (e, id, d, u) => admin(e, u) || meu(e, id, u),
    alunas: (e, id, d, u) => admin(e, u) || meu(e, (d || {}).responsavelId, u),
    pagamentos: (e, id, d, u) => admin(e, u) || minhaAluna(e, id, u),
    acordos: (e, id, d, u) => admin(e, u) || meu(e, (d || {}).rid, u),
    cobrancas: (e, id, d, u) => admin(e, u) || (d || {}).uid === u,
    segredos: () => false, planoPag: () => false,
    notasFamilia: (e, id, d, u) => admin(e, u),
    'config/mp': (e, id, d, u) => admin(e, u),
    'config/geral': (e, id, d, u) => admin(e, u) || membro(e, u) || equipe(e, u),
    'config/plano': (e, id, d, u) => admin(e, u) || membro(e, u) || equipe(e, u),
    'config/contrato': (e, id, d, u) => admin(e, u) || membro(e, u),
    cartoes: (e, id, d, u) => (d || {}).uid === u,
    destratos: (e, id, d, u) => admin(e, u) || minhaAluna(e, (d || {}).alid, u),
    contratos: (e, id, d, u) => admin(e, u) || minhaAluna(e, (d || {}).alid, u),
    chamadas: (e, id, d, u) => admin(e, u),
    turmas: (e, id, d, u) => admin(e, u) || membro(e, u) || equipe(e, u),
    locais: (e, id, d, u) => admin(e, u) || membro(e, u) || equipe(e, u),
    grupos: (e, id, d, u) => admin(e, u) || membro(e, u),
    extras: (e, id, d, u) => admin(e, u) || membro(e, u),
    midiaEventos: (e, id, d, u) => admin(e, u) || membro(e, u),
    arquivosEventos: (e, id, d, u) => admin(e, u) || membro(e, u),
    professoras: (e, id, d, u) => admin(e, u),
    profsPublico: (e, id, d, u) => admin(e, u) || membro(e, u) || equipe(e, u),
    lancamentos: (e, id, d, u) => admin(e, u), fixas: (e, id, d, u) => admin(e, u),
    pedidos: (e, id, d, u) => admin(e, u) || (d || {}).uid === u,
    saude: (e, id, d, u) => admin(e, u) || meu(e, (d || {}).responsavelId, u),
    notasAlunos: (e, id, d, u) => admin(e, u),
    equipe: (e, id, d, u) => admin(e, u) || u === id,
    fotosAlunos: (e, id, d, u) => admin(e, u) || minhaAluna(e, id, u),
    docsAlunos: (e, id, d, u) => admin(e, u) || meu(e, (d || {}).responsavelId, u),
    documentos: (e, id, d, u) => admin(e, u) || minhaAluna(e, (d || {}).alid, u),
    atestados: (e, id, d, u) => admin(e, u) || meu(e, (d || {}).responsavelId, u),
    membros: (e, id, d, u) => admin(e, u) || u === id,
  };
  // devolve a função de regra e os pedaços do caminho
  function regraDe(caminho) {
    const p = caminho.split('/');
    if (p[0] === 'users') return { f: (_, id, d, u) => u === p[1], eid: null, id: p[1] };
    if (['servidor', 'convitesAdm', 'convitesProf'].includes(p[0])) return { f: () => false };
    if (p[0] === 'codigos') return { f: (e, id, d, u) => !!u, lista: false };
    if (p[0] === 'erros') return { f: (e, id, d, u) => (d || {}).uid === u };
    if (p[0] !== 'escolas') return { f: () => true };
    const eid = p[1];
    if (p.length <= 2) return { f: R[''], eid, id: eid };
    if (p[2] === 'membros' && p[4] === 'vinculos') return { f: (e, id, d, u) => admin(e, u) || u === p[3], eid, id: p[5] };
    if (p[2] === 'config') return { f: R['config/' + p[3]] || (() => false), eid, id: p[3] };
    return { f: R[p[2]] || (() => { console.log('SEM REGRA', caminho); return false; }), eid, id: p[3] };
  }
  window.__podeLer = function (caminho, onde, uid, ehColecao) {
    if (!window.__regrasLigadas) return true;
    try {
      const r = regraDe(ehColecao ? caminho + '/x' : caminho);
      let ok;
      if (!ehColecao) ok = r.f(r.eid, r.id, get(caminho), uid);
      else {
        // consulta: o Firestore exige que a regra valha para QUALQUER documento que a consulta possa trazer.
        // Aproximação: testa contra um documento "de mentira" com o campo do filtro; e contra cada documento real que casa.
        const filtro = onde ? { [onde[0]]: onde[1] } : {};
        const docs = [...S().keys()].filter(k => k.split('/').slice(0, -1).join('/') === caminho).map(k => ({ id: k.split('/').pop(), d: get(k) })).filter(x => !onde || x.d[onde[0]] === onde[1]);
        ok = r.f(r.eid, 'qualquer', filtro, uid) || (docs.length > 0 && false);
        // regra que depende do id do documento (pagamentos/fotos: minhaAluna(id)) não serve para consulta sem id
      }
      window.__leituras.push({ caminho, onde: onde ? onde.join('=') : '', uid, ok });
      if (!ok) window.__negados.push({ caminho, onde: onde ? onde.join('=') : '', uid, tela: window.__tela ? window.__tela() : '', em: Date.now() });
      return ok;
    } catch (e) { console.log('regra erro', caminho, e); return true; }
  };
})();

/* Turma em Dia · servidor (Firebase Cloud Functions, 2ª geração, São Paulo).
   Pix automático (criarPix, mpWebhook, mpConectar, mpRetorno) e agrupamento de alunas pelo responsável (vinculos), em pagamentos.js.
   Nota fiscal da comissão (notasPlataforma, notaComissao, rotinaDiaria), em nfse.js.
   O cálculo do valor fica em calculo.js, o mesmo arquivo que o app usa para mostrar as cobranças. */
'use strict';
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 5, memory: '256MiB', timeoutSeconds: 60 });

const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');

const P = require('./pagamentos')(db);
exports.criarPix = P.criarPix;
exports.mpWebhook = P.mpWebhook;
exports.mpConectar = P.mpConectar;
exports.mpRetorno = P.mpRetorno;
exports.mpLigar = P.mpLigar;
exports.vinculos = P.vinculos;

const A = require('./acoes')(db);
exports.adminConvite = A.adminConvite;
exports.eventoResposta = A.eventoResposta;

const E = require('./espelho')(db);
exports.espelharProf = E.espelharProf;

/* Notas fiscais da comissão: relatório da empresa, emissão automática no Emissor Nacional e PDF para a escola */
const N = require('./nfse')(db, P.interno);
exports.notasPlataforma = N.notasPlataforma;
exports.notaComissao = N.notaComissao;
// Todo dia às 10h (Recife): no dia 1º emite as notas do mês anterior; nos outros dias tenta de novo as pendentes.
// Sem certificado instalado ou com a emissão desligada, não faz nada.
exports.rotinaDiaria = onSchedule({ schedule: '0 10 * * *', timeZone: 'America/Recife', maxInstances: 1, memory: '512MiB', timeoutSeconds: 540 }, async () => {
  const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
  try { await N.interno.tarefaDiaria(hoje); } catch (e) { logger.error('nota fiscal', e.message); }
});

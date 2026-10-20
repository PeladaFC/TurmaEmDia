/* Turma em Dia · servidor (Firebase Cloud Functions, 2ª geração, São Paulo).
   Pix automático (criarPix, mpWebhook, mpConectar, mpRetorno) e agrupamento de alunas pelo responsável (vinculos), em pagamentos.js.
   O cálculo do valor fica em calculo.js, o mesmo arquivo que o app usa para mostrar as cobranças. */
'use strict';
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 5, memory: '256MiB', timeoutSeconds: 60 });

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

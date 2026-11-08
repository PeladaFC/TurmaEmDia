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

/* Boleto e cartão das famílias (pagar) e plano da escola (plano, planoWebhook) */
const CA = require('./cartao')(db, P.interno);
exports.pagar = CA.pagar;
const AS = require('./assinatura')(db, P.interno);
exports.plano = AS.plano;
exports.planoWebhook = AS.planoWebhook;

const A = require('./acoes')(db);
exports.adminConvite = A.adminConvite;
exports.eventoResposta = A.eventoResposta;
exports.familiaPush = A.familiaPush;
exports.respostaPush = A.respostaPush;
// responsável que chega sem código: acha pelo e-mail (ou pede à escola, pelo CPF/WhatsApp)
const ID = require('./identificar')(db);
exports.indexarResp = ID.indexarResp;
exports.familiaIdentificar = ID.familiaIdentificar;
exports.familiaAprovar = ID.familiaAprovar;
exports.perfilProf = ID.perfilProf;

const E = require('./espelho')(db);
exports.espelharProf = E.espelharProf;

// área do professor: alunos das turmas dele, a parte dele nos pagamentos e as notas dele
const PR = require('./professor')(db);
exports.professor = PR.professor;
// aviso da chamada no celular do professor, na hora da aula
const AV = require('./avisos')(db);
exports.espelharTurma = AV.espelharTurma;
exports.avisoChamada = AV.avisoChamada;
// avisos automáticos no celular das famílias (rodam na rotina diária)
const AF = require('./avisosFamilia')(db);
exports.avisoNovoExtra = AF.avisoNovoExtra;

/* Nota fiscal da escola e dos professores para as famílias (cada um com o próprio CNPJ e certificado) */
const NF = require('./notaFamilia')(db, P.interno);
exports.notaFiscal = NF.notaFiscal;
P.interno.ganchos.aposPix = NF.interno.aposPix;

/* Notas fiscais da comissão: relatório da empresa, emissão automática no Emissor Nacional e PDF para a escola */
const N = require('./nfse')(db, P.interno);
exports.notasPlataforma = N.notasPlataforma;
exports.notaComissao = N.notaComissao;
// Todo dia às 10h (Recife): no dia 1º emite as notas do mês anterior; nos outros dias tenta de novo as pendentes.
// Também apaga os registros de erro com mais de 90 dias.
// Sem certificado instalado ou com a emissão desligada, não faz nada.
exports.rotinaDiaria = onSchedule({ schedule: '0 10 * * *', timeZone: 'America/Recife', maxInstances: 1, memory: '512MiB', timeoutSeconds: 540 }, async () => {
  const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
  try { await N.interno.tarefaDiaria(hoje); } catch (e) { logger.error('nota fiscal', e.message); }
  // plano das escolas: cartões, Pix e bloqueio por atraso
  try { await AS.interno.diario(); } catch (e) { logger.error('plano', e.message); }
  // avisos no celular das famílias: vencimentos, pendências do cadastro e eventos (1 por dia, no máximo)
  try { await AF.interno.diario(hoje); } catch (e) { logger.error('avisos famílias', e.message); }
  // cobrança automática no cartão salvo das famílias (só quando o Mercado Pago liberar: servidor/mp.automatico)
  try { await CA.interno.cobrarAutomatico(hoje); } catch (e) { logger.error('cobrança automática', e.message); }
  // registro técnico de erros do app: apaga o que tem mais de 90 dias (como diz a Política de Privacidade)
  try { const velhos = await db.collection('erros').where('em', '<', Date.now() - 90 * 864e5).limit(400).get(); const b = db.batch(); velhos.docs.forEach(d => b.delete(d.ref)); if (!velhos.empty) await b.commit(); }
  catch (e) { logger.error('limpar erros', e.message); }
});

// Turma em Dia · teste da nota fiscal (roda sem certificado e sem enviar nada ao governo).
// 1) monta a DPS com os mesmos dados que o servidor usa e valida no esquema oficial (XSD) da NFS-e Nacional
// 2) simula a emissão com o emissor de mentira da biblioteca e gera o PDF da nota
// Uso: node functions/teste-nfse.mjs   (o instalar.sh roda sozinho)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = await import('open-nfse');
const T = await import('open-nfse/testing');
const { interno } = require('./nfse.js')({ doc: () => ({}), collection: () => ({}) }, {});

const cfg = { cnpj: '11222333000181', cTribNac: '100201', pTotTribSN: 6, serie: '901', ambiente: 'restrita', opSimpNac: '3', regApTribSN: '1', regEspTrib: '0' };
const linha = { gid: 'esc1~escola', eid: 'esc1', rec: 'escola', grupo: 'Escolinha Movimento', qtd: 46, total: 37.62, nome: 'Maria Teste da Silva', doc: '52998224725', email: 'maria@exemplo.com' };
const ok = m => console.log('    ✓ ' + m);

const p = interno.parametros(cfg, linha, '2026-09');
const xml = L.buildDpsXml(L.buildDps({ ...p, nDPS: '1' }));
await L.validateDpsXml(xml);
ok('DPS válida no esquema oficial (pessoa física)');
const p2 = interno.parametros(cfg, { ...linha, doc: '11444777000161', nome: 'Escolinha Exemplo Ltda' }, '2026-09');
await L.validateDpsXml(L.buildDpsXml(L.buildDps({ ...p2, nDPS: '2' })));
ok('DPS válida no esquema oficial (empresa)');
if (interno.mesAnterior(Date.UTC(2026, 9, 1, 12)) !== '2026-09') throw new Error('mês anterior errado');
ok('mês da competência');

const fake = new T.NfseClientFake();
const r = await fake.emitir(p);
if (r.status !== 'ok' || !r.nfse.chaveAcesso) throw new Error('emissão simulada falhou');
ok('emissão simulada · chave ' + r.nfse.chaveAcesso);
const pdf = await L.gerarDanfse(r.nfse.nfse, { ambiente: L.Ambiente.ProducaoRestrita });
if (!pdf || pdf.length < 1000 || String(Buffer.from(pdf).subarray(0, 4)) !== '%PDF') throw new Error('PDF não gerado');
ok('PDF da nota gerado (' + Math.round(pdf.length / 1024) + ' KB)');
console.log('    ok');

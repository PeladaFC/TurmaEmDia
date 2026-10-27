#!/usr/bin/env bash
# Turma em Dia · liga a emissão automática da nota fiscal da comissão (Emissor Nacional de NFS-e).
# Antes de rodar:
#   1. Tenha o certificado digital A1 da empresa (arquivo .pfx ou .p12) e a senha dele.
#   2. No Cloud Shell, clique nos três pontinhos (⋮) → "Fazer upload" e envie o arquivo do certificado.
#   3. Tenha em mãos o que a contadora informou: código do serviço (6 dígitos) e o percentual de tributos do Simples.
# Rodar no Cloud Shell (https://shell.cloud.google.com/?project=turma-em-dia-57c1e):
#   curl -sL https://raw.githubusercontent.com/PeladaFC/TurmaEmDia/main/configurar-nfse.sh | bash
# O certificado e a configuração vão para servidor/nfse_cert e servidor/nfse, que o app não consegue ler.
set -euo pipefail
PROJ=turma-em-dia-57c1e
ler() { local v; read -r -p "$1" v </dev/tty; echo "$v"; }

echo "==> Dados da empresa (como estão no cartão CNPJ e no que a contadora informou)"
CNPJ=$(ler "CNPJ da empresa (só números): " | tr -cd '0-9')
[ ${#CNPJ} -eq 14 ] || { echo "CNPJ deve ter 14 números."; exit 1; }
IM=$(ler "Inscrição municipal no Recife (Enter se não tiver): " | tr -cd '0-9A-Za-z')
CTRIB=$(ler "Código de tributação nacional do serviço (6 números, a contadora informa): " | tr -cd '0-9')
[ ${#CTRIB} -eq 6 ] || { echo "O código do serviço deve ter 6 números."; exit 1; }
CNBS=$(ler "Código NBS (Enter se a contadora não informou): " | tr -cd '0-9')
PTRIB=$(ler "Percentual de tributos do Simples (ex.: 6): " | tr ',' '.')
SERIE=$(ler "Série das notas do Turma em Dia (diferente da do Pelota FC, que é 900) [901]: "); SERIE=${SERIE:-901}
NINI=$(ler "Primeiro número de nota [1]: "); NINI=${NINI:-1}
AMB=$(ler "Ambiente: 1 = teste (notas sem valor fiscal), 2 = produção (notas de verdade) [1]: "); AMB=${AMB:-1}
LIGA=$(ler "Emitir sozinho todo dia 1º? (s/n) [s]: "); LIGA=${LIGA:-s}

echo
echo "==> Certificado digital A1"
PADRAO=$(ls -t "$HOME"/*.pfx "$HOME"/*.p12 2>/dev/null | head -1 || true)
ARQ=$(ler "Arquivo do certificado [${PADRAO:-nenhum encontrado}]: "); ARQ=${ARQ:-$PADRAO}
[ -n "$ARQ" ] && [ -f "$ARQ" ] || { echo "Não achei o arquivo. Envie pelo menu ⋮ → Fazer upload e rode de novo."; exit 1; }
read -r -s -p "Senha do certificado (não aparece enquanto digita/cola): " SENHA </dev/tty; echo; export SENHA
INFO=$(openssl pkcs12 -in "$ARQ" -passin env:SENHA -nokeys -clcerts 2>/dev/null || openssl pkcs12 -legacy -in "$ARQ" -passin env:SENHA -nokeys -clcerts 2>/dev/null || true)
[ -n "$INFO" ] || { echo "Senha errada ou arquivo inválido."; exit 1; }
VALIDADE=$(echo "$INFO" | openssl x509 -noout -enddate | cut -d= -f2)
TITULAR=$(echo "$INFO" | openssl x509 -noout -subject -nameopt multiline | sed -n 's/^ *commonName *= //p' | head -1)
echo "    Titular: $TITULAR"
echo "    Vale até: $VALIDADE"
echo "$TITULAR" | tr -cd '0-9' | grep -q "$CNPJ" || echo "    ⚠️  O CNPJ digitado não aparece no certificado. Confira se é o certificado da empresa certa."

TOKEN=$(gcloud auth print-access-token)
gravar() { # $1 = documento, $2 = arquivo com o JSON do Firestore
  local mask; mask=$(python3 -c 'import json,sys;print("&".join("updateMask.fieldPaths="+k for k in json.load(open(sys.argv[1]))["fields"]))' "$2")
  curl -s -o /tmp/ted_resp.json -w '%{http_code}' -X PATCH "https://firestore.googleapis.com/v1/projects/$PROJ/databases/(default)/documents/servidor/$1?$mask" \
    -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJ" -H 'Content-Type: application/json' --data-binary @"$2"
}
T1=$(mktemp); T2=$(mktemp); trap 'rm -f "$T1" "$T2" /tmp/ted_resp.json' EXIT
ARQ="$ARQ" SENHA="$SENHA" VALIDADE="$VALIDADE" TITULAR="$TITULAR" python3 - "$T1" <<'PY'
import json,os,sys,base64,datetime
v=os.environ["VALIDADE"]
try: ms=int(datetime.datetime.strptime(v.replace("  "," "),"%b %d %H:%M:%S %Y %Z").replace(tzinfo=datetime.timezone.utc).timestamp()*1000)
except Exception: ms=0
pfx=base64.b64encode(open(os.environ["ARQ"],"rb").read()).decode()
json.dump({"fields":{"pfx":{"stringValue":pfx},"senha":{"stringValue":os.environ["SENHA"]},"validade":{"integerValue":str(ms)},"titular":{"stringValue":os.environ["TITULAR"]}}},open(sys.argv[1],"w"))
PY
CNPJ="$CNPJ" IM="$IM" CTRIB="$CTRIB" CNBS="$CNBS" PTRIB="$PTRIB" SERIE="$SERIE" NINI="$NINI" AMB="$AMB" LIGA="$LIGA" python3 - "$T2" <<'PY'
import json,os,sys
e=os.environ
p=float(e["PTRIB"] or "nan")
assert 0<=p<=100, "percentual de tributos inválido"
assert e["SERIE"].isdigit() and 1<=len(e["SERIE"])<=5, "série inválida"
assert e["NINI"].isdigit() and int(e["NINI"])>=1, "número inicial inválido"
f={"cnpj":{"stringValue":e["CNPJ"]},"cTribNac":{"stringValue":e["CTRIB"]},"pTotTribSN":{"doubleValue":p},
   "serie":{"stringValue":str(int(e["SERIE"]))},"nInicial":{"integerValue":str(int(e["NINI"]))},
   "ambiente":{"stringValue":"producao" if e["AMB"]=="2" else "restrita"},
   "ligado":{"booleanValue":e["LIGA"].lower().startswith("s")},"codMun":{"stringValue":"2611606"},
   "opSimpNac":{"stringValue":"3"},"regApTribSN":{"stringValue":"1"},"regEspTrib":{"stringValue":"0"},
   "im":{"stringValue":e["IM"]},"cNBS":{"stringValue":e["CNBS"]}}
json.dump({"fields":f},open(sys.argv[1],"w"))
PY
[ "$(gravar nfse_cert "$T1")" = "200" ] || { echo "Não deu para gravar o certificado. Mande uma foto desta tela."; exit 1; }
[ "$(gravar nfse "$T2")" = "200" ] || { echo "Não deu para gravar a configuração. Mande uma foto desta tela."; exit 1; }
unset SENHA
echo "    ✅ certificado e configuração gravados"
APAGA=$(ler "Apagar o arquivo do certificado do Cloud Shell agora? (s/n) [s]: "); APAGA=${APAGA:-s}
case "$APAGA" in [sS]*) rm -f "$ARQ"; echo "    arquivo apagado do Cloud Shell";; esac
echo
if [ "$AMB" = "2" ]; then echo "✅ Pronto! Notas de VERDADE ligadas."; else echo "✅ Pronto! Modo de TESTE: as notas vão para o ambiente de teste do governo, sem valor fiscal."; fi
echo "   Para conferir agora: no app, engrenagem → Notas fiscais da comissão → Emitir as notas deste mês agora."

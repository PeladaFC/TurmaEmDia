#!/usr/bin/env bash
# Turma em Dia · grava as credenciais da aplicação do Mercado Pago da PLATAFORMA (aplicação própria do Turma em Dia,
# criada na mesma conta do Mercado Pago que recebe a comissão do Pelada FC).
# Rodar no Cloud Shell, logado com a conta dona do projeto Firebase:
#   curl -sL https://raw.githubusercontent.com/PeladaFC/TurmaEmDia/main/configurar-mp.sh | bash
# Os dados vão direto para o banco (servidor/mp), que o app não consegue ler.
set -euo pipefail
PROJ="${1:-$(curl -sL https://raw.githubusercontent.com/PeladaFC/TurmaEmDia/main/.firebaserc | python3 -c 'import json,sys;print(json.load(sys.stdin)["projects"]["default"])')}"
[ -n "$PROJ" ] && [ "$PROJ" != "SEU-PROJETO" ] || { echo "Não achei o id do projeto. Use: bash configurar-mp.sh id-do-projeto"; exit 1; }
echo "Projeto: $PROJ"
echo "==> Credenciais da aplicação do Mercado Pago (Suas integrações → sua aplicação → Credenciais de produção)"
read -r -p "Client ID (só números): " CID </dev/tty
read -r -s -p "Client Secret (não aparece enquanto digita/cola): " CSEC </dev/tty; echo
read -r -p "Comissão do app em % [1]: " COM </dev/tty; COM=${COM:-1}
read -r -p "Domínio próprio do app, se tiver (deixe vazio se usa github.io): " DOM </dev/tty
CID=$(echo "$CID" | tr -d '[:space:]'); CSEC=$(echo "$CSEC" | tr -d '[:space:]'); DOM=$(echo "$DOM" | tr -d '[:space:]')
[[ "$CID" =~ ^[0-9]+$ ]] || { echo "Client ID inválido (deve ter só números)."; exit 1; }
[ -n "$CSEC" ] || { echo "Client Secret vazio."; exit 1; }
CORPO=$(CID="$CID" CSEC="$CSEC" COM="$COM" DOM="$DOM" python3 -c 'import json,os
c=float(os.environ["COM"].replace(",","."))/100; assert 0<=c<=0.1,"comissão fora do limite"
d=[x for x in [os.environ["DOM"]] if x]
print(json.dumps({"fields":{"clientId":{"stringValue":os.environ["CID"]},"clientSecret":{"stringValue":os.environ["CSEC"]},"comissao":{"doubleValue":c},"dominios":{"arrayValue":{"values":[{"stringValue":x} for x in d]}}}}))')
URL="https://firestore.googleapis.com/v1/projects/$PROJ/databases/(default)/documents/servidor/mp?updateMask.fieldPaths=clientId&updateMask.fieldPaths=clientSecret&updateMask.fieldPaths=comissao&updateMask.fieldPaths=dominios"
COD=$(curl -s -o /tmp/mp_resp.json -w '%{http_code}' -X PATCH "$URL" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: $PROJ" -H 'Content-Type: application/json' -d "$CORPO")
rm -f /tmp/mp_resp.json
if [ "$COD" = "200" ]; then echo; echo "✅ Pronto! Mercado Pago da plataforma configurado (comissão de ${COM}%)."; else echo "Não deu certo (código $COD). Mande uma foto desta tela."; exit 1; fi

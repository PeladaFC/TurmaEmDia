#!/usr/bin/env bash
# Turma em Dia · cartão de crédito do plano das escolas e cobrança automática das famílias.
# Grava em servidor/mp (que o app não lê):
#   - publicKey: a "Public Key" de produção da aplicação do Mercado Pago do Turma em Dia (é pública; serve para o cartão
#     da escola ir direto do celular para o Mercado Pago, no plano do app);
#   - automatico: ligue só quando o Mercado Pago liberar os "Pagamentos automáticos" para a aplicação.
# Rodar no Cloud Shell, logado com a conta dona do projeto Firebase:
#   curl -sL https://raw.githubusercontent.com/PeladaFC/TurmaEmDia/main/configurar-cartao.sh | bash
set -euo pipefail
PROJ="${1:-$(curl -sL https://raw.githubusercontent.com/PeladaFC/TurmaEmDia/main/.firebaserc | python3 -c 'import json,sys;print(json.load(sys.stdin)["projects"]["default"])')}"
[ -n "$PROJ" ] && [ "$PROJ" != "SEU-PROJETO" ] || { echo "Não achei o id do projeto. Use: bash configurar-cartao.sh id-do-projeto"; exit 1; }
echo "Projeto: $PROJ"
echo "==> No Mercado Pago: Suas integrações → aplicação do Turma em Dia → Credenciais de produção → Public Key"
read -r -p "Public Key (começa com APP_USR-; deixe vazio para não mudar): " PK </dev/tty
read -r -p "O Mercado Pago já liberou os Pagamentos automáticos? (s/N): " AUTO </dev/tty
PK=$(echo "$PK" | tr -d '[:space:]'); AUTO=$(echo "${AUTO:-n}" | tr '[:upper:]' '[:lower:]')
[ -z "$PK" ] || [[ "$PK" =~ ^(APP_USR|TEST)-[A-Za-z0-9-]+$ ]] || { echo "Public Key inválida (deve começar com APP_USR-)."; exit 1; }
CORPO=$(PK="$PK" AUTO="$AUTO" python3 -c 'import json,os
f={"automatico":{"booleanValue":os.environ["AUTO"].startswith("s")}}
if os.environ["PK"]: f["publicKey"]={"stringValue":os.environ["PK"]}
print(json.dumps({"fields":f}))')
MASK="updateMask.fieldPaths=automatico"; [ -z "$PK" ] || MASK="$MASK&updateMask.fieldPaths=publicKey"
URL="https://firestore.googleapis.com/v1/projects/$PROJ/databases/(default)/documents/servidor/mp?$MASK"
COD=$(curl -s -o /tmp/mp_resp.json -w '%{http_code}' -X PATCH "$URL" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: $PROJ" -H 'Content-Type: application/json' -d "$CORPO")
rm -f /tmp/mp_resp.json
if [ "$COD" = "200" ]; then echo; echo "✅ Pronto! Cartão configurado.$( [[ "$AUTO" == s* ]] && echo ' Cobrança automática das famílias ligada.' || echo ' Cobrança automática das famílias: desligada (ligue quando o Mercado Pago liberar).')"; else echo "Não deu certo (código $COD). Mande uma foto desta tela."; exit 1; fi

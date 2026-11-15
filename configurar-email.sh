#!/usr/bin/env bash
# Turma em Dia · liga os e-mails com a cara do app (confirmar e-mail e trocar senha), enviados pelo Resend (resend.com).
# Rodar no Cloud Shell, logado com a conta dona do projeto Firebase:
#   curl -sL https://raw.githubusercontent.com/PeladaFC/TurmaEmDia/main/configurar-email.sh | bash
# A chave vai direto para o banco (servidor/email), que o app não consegue ler.
set -euo pipefail
PROJ="${1:-$(curl -sL https://raw.githubusercontent.com/PeladaFC/TurmaEmDia/main/.firebaserc | python3 -c 'import json,sys;print(json.load(sys.stdin)["projects"]["default"])')}"
[ -n "$PROJ" ] && [ "$PROJ" != "SEU-PROJETO" ] || { echo "Não achei o id do projeto. Use: bash configurar-email.sh id-do-projeto"; exit 1; }
echo "Projeto: $PROJ"
echo "==> Chave do Resend (resend.com → API Keys → Create API Key). Começa com re_"
read -r -s -p "Chave (não aparece enquanto digita/cola): " CH </dev/tty; echo
CH=$(echo "$CH" | tr -d '[:space:]')
[[ "$CH" =~ ^re_[A-Za-z0-9_]+$ ]] || { echo "Essa chave não parece do Resend (deve começar com re_)."; exit 1; }
DE="Turma em Dia <nao-responda@turmaemdia.com.br>"
CORPO=$(CH="$CH" DE="$DE" python3 -c 'import json,os;print(json.dumps({"fields":{"chave":{"stringValue":os.environ["CH"]},"de":{"stringValue":os.environ["DE"]}}}))')
URL="https://firestore.googleapis.com/v1/projects/$PROJ/databases/(default)/documents/servidor/email?updateMask.fieldPaths=chave&updateMask.fieldPaths=de"
COD=$(curl -s -o /tmp/em_resp.json -w '%{http_code}' -X PATCH "$URL" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: $PROJ" -H 'Content-Type: application/json' -d "$CORPO")
rm -f /tmp/em_resp.json
if [ "$COD" = "200" ]; then echo; echo "✅ Pronto! Os e-mails do Turma em Dia saem por $DE."; else echo "Não deu certo (código $COD). Mande uma foto desta tela."; exit 1; fi

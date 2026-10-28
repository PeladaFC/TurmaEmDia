#!/usr/bin/env bash
# Turma em Dia · instala/atualiza o servidor (Pix automático, convites, eventos) e as regras de segurança do banco.
# Rodar no Cloud Shell do Google (shell.cloud.google.com), logado com a conta dona do projeto:
#   curl -sL https://raw.githubusercontent.com/PeladaFC/TurmaEmDia/main/instalar.sh | bash
set -euo pipefail
REPO="${1:-PeladaFC/TurmaEmDia}"
DIR="$HOME/$(basename "$REPO")"
echo "==> Baixando a versão mais nova do Turma em Dia"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch -q origin main && git -C "$DIR" reset -q --hard origin/main; else git clone -q "https://github.com/$REPO.git" "$DIR"; fi
cd "$DIR"
PROJ=$(python3 -c 'import json;print(json.load(open(".firebaserc"))["projects"]["default"])')
[ "$PROJ" != "SEU-PROJETO" ] || { echo "Falta o id do projeto Firebase no arquivo .firebaserc."; exit 1; }
echo "==> Testando o cálculo, o Pix, os convites e os eventos"
node functions/teste.js >/dev/null && echo "    ok"
echo "==> Instalando dependências do servidor"
(cd functions && npm install --omit=dev --no-audit --no-fund --loglevel=error)
echo "==> Testando a nota fiscal (sem certificado, sem enviar nada)"
node functions/teste-nfse.mjs || echo "    ⚠️  o teste da nota fiscal falhou (o resto continua). Mande uma foto desta parte."
gcloud config set project "$PROJ" >/dev/null 2>&1 || true
echo "==> Registro de erros: apagar sozinho depois de 90 dias"
if gcloud firestore fields ttls list --project "$PROJ" --format='value(name)' 2>/dev/null | grep -q "erros/fields/expiraEm"; then
  echo "    já está ligado"
else
  gcloud firestore fields ttls update expiraEm --collection-group=erros --enable-ttl --async --project "$PROJ" >/dev/null 2>&1 \
    && echo "    ligado" || echo "    ⚠️  não deu para ligar agora (o resto continua; a rotina diária do servidor também apaga)."
fi
FB="npx --yes firebase-tools@latest"
publicar() { $FB deploy --only functions,firestore:rules --project "$PROJ" --force --non-interactive; }
# Se o Google falhar em alguma função (acontece de vez em quando, principalmente na primeira vez), publica uma por uma.
uma_a_uma() {
  local FALHAS=""
  $FB deploy --only firestore:rules --project "$PROJ" --force --non-interactive || FALHAS="regras"
  for f in $(cd functions && node -e "console.log(Object.keys(require('./index.js')).join(' '))" 2>/dev/null); do
    echo "    · $f"
    if ! $FB deploy --only "functions:$f" --project "$PROJ" --force --non-interactive >/tmp/ted-deploy.log 2>&1; then
      sleep 20
      $FB deploy --only "functions:$f" --project "$PROJ" --force --non-interactive >/tmp/ted-deploy.log 2>&1 || FALHAS="$FALHAS $f"
    fi
  done
  if [ -n "$FALHAS" ]; then echo "⚠️  Não foi possível publicar:$FALHAS. Rode o comando de novo daqui a alguns minutos."; return 1; fi
}
echo "==> Publicando (a primeira vez demora uns 5 a 10 minutos)"
if ! publicar; then
  echo "==> O Google recusou alguma parte. Publicando em etapas, uma função por vez..."
  sleep 30
  if ! uma_a_uma; then
    if ! $FB projects:list >/dev/null 2>&1; then
      echo "==> Precisa entrar com sua conta Google no Firebase uma vez."
      $FB login --no-localhost
      publicar || uma_a_uma
    else
      exit 1
    fi
  fi
fi
echo "==> Cópia de segurança diária do banco de dados"
if gcloud firestore backups schedules list --database='(default)' --project "$PROJ" --format='value(name)' 2>/dev/null | grep -q .; then
  echo "    já está ligada"
else
  gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=4w --project "$PROJ" >/dev/null 2>&1 \
    && echo "    ligada: uma cópia por dia, guardada por 4 semanas" \
    || echo "    ⚠️  não deu para ligar agora (o resto foi publicado). Rode o comando de novo mais tarde."
fi
echo "==> Limpando cópias antigas do servidor (evita custo de armazenamento)"
$FB functions:artifacts:setpolicy --project "$PROJ" --location southamerica-east1 --days 1 --force >/dev/null 2>&1 || true
echo
echo "✅ Pronto! Servidor e regras publicados no projeto $PROJ."
echo "   Endereço de retorno para cadastrar na aplicação do Mercado Pago:"
echo "   https://southamerica-east1-$PROJ.cloudfunctions.net/mpRetorno"

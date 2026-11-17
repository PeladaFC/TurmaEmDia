#!/usr/bin/env bash
# Turma em Dia · deixa o GitHub publicar sozinho no Firebase (site, servidor e regras) quando a branch main muda.
# Roda UMA VEZ no Cloud Shell, logado com a conta dona do projeto, ANTES de o repositório ficar privado:
#   (repositório privado desde a Fase 5) o Claude manda num bloco só: cat > configurar-publicacao.sh <<'FIM' … FIM; depois: bash configurar-publicacao.sh
# Não guarda senha nem chave em lugar nenhum: o Google só aceita o pedido se vier do repositório PeladaFC/TurmaEmDia
# (federação de identidade do Google Cloud, sem custo). Pode rodar de novo sem problema: o que já existe é mantido.
set -uo pipefail
PROJ="turma-em-dia-57c1e"
REPO="PeladaFC/TurmaEmDia"
CONTA="github-publicar"
SA="$CONTA@$PROJ.iam.gserviceaccount.com"
ok() { echo "    ok"; }
falhou() { echo "    ⚠️  $1"; FALHAS="${FALHAS:-} $2"; }

gcloud config set project "$PROJ" >/dev/null 2>&1
NUM=$(gcloud projects describe "$PROJ" --format='value(projectNumber)') || { echo "Não achei o projeto $PROJ. Confira se entrou com a conta dona do projeto."; exit 1; }
echo "Projeto: $PROJ ($NUM)"

echo "==> Ligando os serviços de identidade do Google (sem custo)"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com firebasehosting.googleapis.com --project "$PROJ" >/dev/null 2>&1 && ok || falhou "não deu para ligar os serviços" servicos

echo "==> Criando a conta que publica (só serve para publicar este app)"
if gcloud iam service-accounts describe "$SA" --project "$PROJ" >/dev/null 2>&1; then echo "    já existe"
else gcloud iam service-accounts create "$CONTA" --display-name="GitHub publica o Turma em Dia" --project "$PROJ" >/dev/null 2>&1 && ok || falhou "não deu para criar a conta" conta; fi

echo "==> Dando à conta só as permissões de publicar (site, servidor, regras e rotinas)"
for R in roles/firebasehosting.admin roles/firebaserules.admin roles/cloudfunctions.admin roles/run.admin \
         roles/iam.serviceAccountUser roles/artifactregistry.admin roles/cloudbuild.builds.editor \
         roles/cloudscheduler.admin roles/eventarc.admin roles/pubsub.admin roles/serviceusage.serviceUsageConsumer \
         roles/firebaseextensions.viewer; do
  # conta recém-criada demora alguns segundos para o Google enxergar: tenta até 4 vezes
  for T in 1 2 3 4; do
    if gcloud projects add-iam-policy-binding "$PROJ" --member="serviceAccount:$SA" --role="$R" --condition=None >/tmp/perm.log 2>&1; then break; fi
    if [ "$T" = 4 ]; then falhou "permissão $R: $(tail -1 /tmp/perm.log | cut -c1-150)" "$R"; else sleep 15; fi
  done
done
echo "    feito"

echo "==> Ligando o GitHub ao Google (só o repositório $REPO pode usar)"
if gcloud iam workload-identity-pools describe github --location=global --project "$PROJ" >/dev/null 2>&1; then echo "    grupo já existe"
else gcloud iam workload-identity-pools create github --location=global --display-name="GitHub" --project "$PROJ" >/dev/null 2>&1 && ok || falhou "não deu para criar o grupo" grupo; fi
if gcloud iam workload-identity-pools providers describe github --workload-identity-pool=github --location=global --project "$PROJ" >/dev/null 2>&1; then echo "    ligação já existe"
else gcloud iam workload-identity-pools providers create-oidc github --workload-identity-pool=github --location=global \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='$REPO'" --project "$PROJ" >/dev/null 2>&1 && ok || falhou "não deu para criar a ligação" ligacao; fi
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJ" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" >/dev/null 2>&1 && echo "    ligado à conta que publica" || falhou "não deu para ligar à conta" vinculo

echo "==> Criando o endereço do site no Firebase Hosting (se ainda não existir)"
TOKEN=$(gcloud auth print-access-token)
COD=$(curl -s -o /dev/null -w '%{http_code}' "https://firebasehosting.googleapis.com/v1beta1/projects/$PROJ/sites/$PROJ" -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJ")
if [ "$COD" = "200" ]; then echo "    já existe: https://$PROJ.web.app"
else
  COD=$(curl -s -o /tmp/site.json -w '%{http_code}' -X POST "https://firebasehosting.googleapis.com/v1beta1/projects/$PROJ/sites?siteId=$PROJ" -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJ" -H 'Content-Type: application/json' -d '{}')
  if [ "$COD" = "200" ]; then echo "    criado: https://$PROJ.web.app"; else falhou "não deu para criar o site (código $COD)" site; fi
fi

echo
if [ -z "${FALHAS:-}" ]; then
  echo "✅ Pronto! O GitHub já pode publicar o Turma em Dia no Firebase."
else
  echo "⚠️  Quase pronto. Faltou:${FALHAS}. Mande uma foto desta tela."
fi

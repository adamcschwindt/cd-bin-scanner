#!/usr/bin/env bash
# Builds and deploys the backend to Cloud Run, then prints the URL to put in
# web/config.js. Safe to re-run.
set -euo pipefail
PROJECT="${PROJECT:-remington-automation}"
REGION="${REGION:-us-central1}"
SERVICE=cd-bin-scanner
SA="cdbin-run@${PROJECT}.iam.gserviceaccount.com"
ORIGINS="${ALLOWED_ORIGINS:-https://adamcschwindt.github.io}"
CATEGORY="${EBAY_CD_CATEGORY_ID:-176984}"
cd "$(dirname "$0")/.."

gcloud auth print-access-token >/dev/null 2>&1 || { echo "gcloud login expired. Run: gcloud auth login"; exit 1; }

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project "$PROJECT"

if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create cdbin-run --project "$PROJECT" --display-name "CD Bin Scanner (Cloud Run)"
fi
for s in cdbin-ebay-client-id cdbin-ebay-client-secret cdbin-anthropic-key cdbin-app-passcode; do
  gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT" \
    --member "serviceAccount:${SA}" --role roles/secretmanager.secretAccessor >/dev/null
done

# max-instances=1 keeps rate limits and the price cache in one process.
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" \
  --source server \
  --service-account "$SA" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 1 --concurrency 40 \
  --memory 512Mi --cpu 1 --timeout 120 \
  --set-secrets "EBAY_CLIENT_ID=cdbin-ebay-client-id:latest,EBAY_CLIENT_SECRET=cdbin-ebay-client-secret:latest,ANTHROPIC_API_KEY=cdbin-anthropic-key:latest,APP_PASSCODE=cdbin-app-passcode:latest" \
  --set-env-vars "^|^ALLOWED_ORIGINS=${ORIGINS}|EBAY_CD_CATEGORY_ID=${CATEGORY}|EBAY_ENV=production"

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')
echo
echo "Backend URL: $URL"
curl -fsS "$URL/health" && echo "  <- health OK"
echo "Put this in web/config.js as API_BASE, commit, and push."

#!/usr/bin/env bash
# Stores the four backend secrets in Google Secret Manager.
# You type each value at a hidden prompt; nothing lands in shell history.
# Re-run any time to rotate a value (adds a new version).
set -euo pipefail
PROJECT="${PROJECT:-remington-automation}"

add_secret() {
  local name="$1" prompt="$2" value=""
  read -rsp "$prompt: " value; echo
  if [[ -z "$value" ]]; then echo "  skipped (empty)"; return; fi
  if ! gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud secrets create "$name" --project "$PROJECT" --replication-policy=automatic >/dev/null
  fi
  printf '%s' "$value" | gcloud secrets versions add "$name" --project "$PROJECT" --data-file=- >/dev/null
  unset value
  # gcloud exits 0 even if the payload was empty, so check the stored length.
  local len
  len=$(gcloud secrets versions access latest --secret "$name" --project "$PROJECT" | wc -c | tr -d ' ')
  echo "  $name saved ($len chars)"
}

add_secret cdbin-ebay-client-id     "eBay production Client ID (App ID)"
add_secret cdbin-ebay-client-secret "eBay production Client Secret (Cert ID)"
add_secret cdbin-anthropic-key      "Anthropic API key"
add_secret cdbin-app-passcode       "App passcode to share with your team"

#!/usr/bin/env bash
# Checks your eBay keys: CDs category ID, a sample search, and whether
# sold prices (Marketplace Insights) are approved. Keys are typed at hidden
# prompts and never saved.
set -euo pipefail
cd "$(dirname "$0")/../server"
[[ -d node_modules ]] || npm ci --silent
read -rsp "eBay Client ID (App ID): " EBAY_CLIENT_ID; echo
read -rsp "eBay Client Secret (Cert ID): " EBAY_CLIENT_SECRET; echo
# Strip stray spaces/newlines from copy-paste.
EBAY_CLIENT_ID="$(printf '%s' "$EBAY_CLIENT_ID" | tr -d '[:space:]')"
EBAY_CLIENT_SECRET="$(printf '%s' "$EBAY_CLIENT_SECRET" | tr -d '[:space:]')"
# The App ID is not secret; show its shape so mix-ups are obvious.
echo "App ID entered: ${EBAY_CLIENT_ID:0:12}... (${#EBAY_CLIENT_ID} chars); Cert ID: ${#EBAY_CLIENT_SECRET} chars"
if [[ "$EBAY_CLIENT_ID" == *-SBX-* || "$EBAY_CLIENT_SECRET" == SBX-* ]]; then
  echo "❌ These are SANDBOX keys (contain SBX). Use the Production keyset (contains PRD)."; exit 1
fi
if [[ "$EBAY_CLIENT_ID" != *-PRD-* ]]; then
  echo "⚠️  App ID has no '-PRD-' in it. Production App IDs look like Name-App-PRD-xxxx."
fi
if (( ${#EBAY_CLIENT_SECRET} < 30 || ${#EBAY_CLIENT_SECRET} > 45 )); then
  echo "❌ Cert ID should be about 36 characters (PRD- plus 32). Got ${#EBAY_CLIENT_SECRET}. Copy it once with the copy icon and paste once."; exit 1
fi
if [[ "$EBAY_CLIENT_SECRET" != PRD-* ]]; then
  echo "⚠️  Cert ID doesn't start with 'PRD-'. Make sure it's the Production Cert ID."
fi
if [[ "$EBAY_CLIENT_SECRET" == "$EBAY_CLIENT_ID" ]]; then
  echo "❌ Cert ID is the same as the App ID. Paste the Cert ID (Client Secret) at the second prompt."; exit 1
fi
EBAY_CLIENT_ID="$EBAY_CLIENT_ID" EBAY_CLIENT_SECRET="$EBAY_CLIENT_SECRET" node scripts/verify-ebay.ts

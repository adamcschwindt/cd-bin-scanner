#!/usr/bin/env bash
# Checks your eBay keys: CDs category ID, a sample search, and whether
# sold prices (Marketplace Insights) are approved. Keys are typed at hidden
# prompts and never saved.
set -euo pipefail
cd "$(dirname "$0")/../server"
[[ -d node_modules ]] || npm ci --silent
read -rsp "eBay Client ID (App ID): " EBAY_CLIENT_ID; echo
read -rsp "eBay Client Secret (Cert ID): " EBAY_CLIENT_SECRET; echo
EBAY_CLIENT_ID="$EBAY_CLIENT_ID" EBAY_CLIENT_SECRET="$EBAY_CLIENT_SECRET" node scripts/verify-ebay.ts

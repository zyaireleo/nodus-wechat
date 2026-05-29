#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

TOKEN=""
if [ -f .env ]; then
  TOKEN="$(awk -F= '$1=="POC_WEBHOOK_TOKEN"{print $2}' .env | tail -1)"
fi

AUTH_ARGS=()
if [ -n "$TOKEN" ]; then
  AUTH_ARGS=(-H "Authorization: Bearer $TOKEN")
fi

curl -fsS \
  -H "Content-Type: application/json" \
  "${AUTH_ARGS[@]}" \
  -d '{"type":"message","content":"/ping","sender":{"user_id":"local_probe","user_name":"local probe"},"sessionID":"probe_session","channel_id":"probe_channel"}' \
  "http://127.0.0.1:${POC_WEBHOOK_PORT:-9811}/webhook"
printf "\n"

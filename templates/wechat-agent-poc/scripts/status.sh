#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

for name in openilink webhook; do
  pid_file=".nodus-${name}.pid"
  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" >/dev/null 2>&1; then
    echo "$name: running (pid $(cat "$pid_file"))"
  else
    echo "$name: stopped"
  fi
done

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
printf "\nWebhook health:\n"
curl -fsS "http://127.0.0.1:${POC_WEBHOOK_PORT:-9811}/health" || true
printf "\n\nRecent webhook logs:\n"
tail -n 80 webhook.log 2>/dev/null || true

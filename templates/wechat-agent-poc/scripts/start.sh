#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
fi

set -a
. ./.env
set +a

if ! command -v oih >/dev/null 2>&1; then
  echo "OpeniLink Hub CLI 'oih' is not installed. Run: npx nodus-wechat install-openilink" >&2
  exit 1
fi

PYTHON_BIN="${PYTHON_BIN:-}"
if [ -z "$PYTHON_BIN" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN=python3
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN=python
  else
    echo "Python is required for the local webhook runtime." >&2
    exit 1
  fi
fi

OPENILINK_PID=".nodus-openilink.pid"
WEBHOOK_PID=".nodus-webhook.pid"

if [ -f "$WEBHOOK_PID" ] && kill -0 "$(cat "$WEBHOOK_PID")" >/dev/null 2>&1; then
  echo "webhook: already running (pid $(cat "$WEBHOOK_PID"))"
else
  POC_WEBHOOK_BIND="${POC_WEBHOOK_BIND:-127.0.0.1}" \
  POC_WEBHOOK_PORT="${POC_WEBHOOK_PORT:-9811}" \
  POC_WEBHOOK_TOKEN="${POC_WEBHOOK_TOKEN:-}" \
    "$PYTHON_BIN" poc-webhook/server.py >>webhook.log 2>&1 &
  echo $! >"$WEBHOOK_PID"
  echo "webhook: started (pid $(cat "$WEBHOOK_PID"))"
fi

if [ -f "$OPENILINK_PID" ] && kill -0 "$(cat "$OPENILINK_PID")" >/dev/null 2>&1; then
  echo "openilink: already running (pid $(cat "$OPENILINK_PID"))"
else
  LISTEN=":${OPENILINK_PORT:-9800}" \
  RP_ORIGIN="${OPENILINK_PUBLIC_ORIGIN:-http://localhost:9800}" \
  RP_ID="${OPENILINK_RP_ID:-localhost}" \
    oih >>openilink.log 2>&1 &
  echo $! >"$OPENILINK_PID"
  echo "openilink: started (pid $(cat "$OPENILINK_PID"))"
fi

echo "OpeniLink Hub: ${OPENILINK_PUBLIC_ORIGIN:-http://localhost:9800}"
echo "Webhook health: http://127.0.0.1:${POC_WEBHOOK_PORT:-9811}/health"

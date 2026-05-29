#!/usr/bin/env bash
set -euo pipefail

LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${WECHAT_POC_REMOTE:-root@192.220.25.138}"
REMOTE_DIR="${WECHAT_POC_REMOTE_DIR:-/opt/sub2api/wechat-agent-poc}"

ssh "$REMOTE" "mkdir -p '$REMOTE_DIR'"
rsync -az --delete \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  "$LOCAL_DIR/" "$REMOTE:$REMOTE_DIR/"

ssh "$REMOTE" "cd '$REMOTE_DIR' && chmod +x scripts/*.sh && ./scripts/start.sh"

printf "OpeniLink Hub: http://192.220.25.138:9800\n"
printf "Remote logs: ssh %s 'cd %s && ./scripts/logs.sh'\n" "$REMOTE" "$REMOTE_DIR"

#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
for name in webhook openilink; do
  pid_file=".nodus-${name}.pid"
  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" >/dev/null 2>&1; then
    kill "$(cat "$pid_file")" || true
    echo "$name: stopped (pid $(cat "$pid_file"))"
  else
    echo "$name: stopped"
  fi
  rm -f "$pid_file"
done

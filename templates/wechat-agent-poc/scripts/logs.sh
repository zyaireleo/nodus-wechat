#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
tail -f openilink.log webhook.log

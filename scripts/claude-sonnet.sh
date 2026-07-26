#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.claude.local"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${ANTHROPIC_BASE_URL:-}" || -z "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
  echo "Thieu ANTHROPIC_BASE_URL hoac ANTHROPIC_AUTH_TOKEN."
  echo "Tao file .env.claude.local tu .env.claude.local.example roi chay lai."
  exit 1
fi

exec claude --model sonnet "$@"

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$repo_root/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$repo_root/.env"
  set +a
fi

if [[ -f "$repo_root/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$repo_root/.env.local"
  set +a
fi

cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  wait || true
}

start_service() {
  local name="$1"
  shift
  echo "[dev-all] starting $name"
  "$@" &
  pids+=("$!")
}

pids=()
trap cleanup INT TERM EXIT

start_service site env SITE_PORT="${SITE_PORT:-3100}" PORT="${SITE_PORT:-3100}" npm run dev --workspace @prism-railway/site
start_service codex-runtime env PORT="${CODEX_RUNTIME_PORT:-3030}" npm run dev --workspace @prism-railway/codex-runtime

if [[ -x "$repo_root/services/prism-memory/.venv/bin/python" ]]; then
  start_service prism-memory \
    "$repo_root/services/prism-memory/.venv/bin/python" \
    -m uvicorn app.main:app \
    --app-dir "$repo_root/services/prism-memory" \
    --host 0.0.0.0 \
    --port "${PRISM_API_PORT:-8788}"
else
  echo "[dev-all] prism-memory virtualenv missing, run: npm run bootstrap"
fi

start_service source-adapter \
  env \
  PORT="${SOURCE_ADAPTER_PORT:-8789}" \
  APP_API_BASE_URL="${APP_API_BASE_URL:-http://127.0.0.1:${SITE_PORT:-3100}}" \
  CODEX_RUNTIME_BASE_URL="${CODEX_RUNTIME_BASE_URL:-http://127.0.0.1:${CODEX_RUNTIME_PORT:-3030}}" \
  PRISM_API_BASE="${PRISM_API_BASE:-http://127.0.0.1:${PRISM_API_PORT:-8788}}" \
  npm run dev --workspace @prism-railway/source-adapter

wait

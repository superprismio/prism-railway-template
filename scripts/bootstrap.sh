#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root"

if [[ ! -f ".env" && -f ".env.example" ]]; then
  cp ".env.example" ".env"
  echo "[bootstrap] created .env from .env.example"
fi

echo "[bootstrap] installing npm workspaces"
npm install

echo "[bootstrap] preparing prism-memory virtualenv"
python3 -m venv "$repo_root/services/prism-memory/.venv"
"$repo_root/services/prism-memory/.venv/bin/pip" install -r "$repo_root/services/prism-memory/requirements.txt"

echo "[bootstrap] complete"

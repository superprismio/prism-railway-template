#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

project_arg=""
environment_arg="production"
site_service="site"
prism_memory_service="prism-memory"
prism_base=""
prism_key=""
bootstrap_api=true
deploy_site=true
run_memory=false
run_knowledge=false
target_manifest=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/railway-deploy-prism-stack.sh \
    --prism-api-base https://prism-memory-production.up.railway.app \
    --prism-api-key <key> \
    [--environment production] \
    [--site-service site] \
    [--prism-memory-service prism-memory] \
    [--target-manifest /app/config/target-apps.default.json] \
    [--skip-site] \
    [--skip-api-bootstrap] \
    [--run-memory] \
    [--run-knowledge]

What it does:
  1. Deploys site from services/site
  2. Optionally bootstraps the app with migrate/admin/targets
  3. Deploys prism-memory from services/prism-memory
  4. Optionally triggers memory and knowledge ops runs

Required:
  --prism-api-base   Prism Memory base URL
  --prism-api-key    Prism API key used for bootstrap and ops calls

Before running:
  Link this checkout to the intended Railway project:
    railway link --project <railway-project-id> --environment production

Manual steps still required:
  - Codex auth/bootstrap
  - Discord bridge onboarding
  - Railway secret entry and cron schedule setup
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      project_arg="$2"
      shift 2
      ;;
    --environment)
      environment_arg="$2"
      shift 2
      ;;
    --site-service)
      site_service="$2"
      shift 2
      ;;
    --prism-memory-service)
      prism_memory_service="$2"
      shift 2
      ;;
    --prism-api-base)
      prism_base="$2"
      shift 2
      ;;
    --prism-api-key)
      prism_key="$2"
      shift 2
      ;;
    --target-manifest)
      target_manifest="$2"
      shift 2
      ;;
    --skip-site)
      deploy_site=false
      shift 1
      ;;
    --skip-api-bootstrap)
      bootstrap_api=false
      shift 1
      ;;
    --run-memory)
      run_memory=true
      shift 1
      ;;
    --run-knowledge)
      run_knowledge=true
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$prism_base" || -z "$prism_key" ]]; then
  echo "Missing required Prism deploy args." >&2
  usage >&2
  exit 1
fi

if [[ -n "$project_arg" ]]; then
  cat >&2 <<'EOF'
--project is not supported by this deploy wrapper with Railway CLI 4.x because
`railway up` does not accept a project flag. Link your shell to the intended
project first with `railway link --project <id> --environment <env>`, then rerun
this script without --project.
EOF
  exit 1
fi

echo "[railway-deploy-prism-stack] Railway target:"
railway status

common_railway_args=(-e "$environment_arg")

if [[ "$bootstrap_api" == true ]]; then
  echo "[railway-deploy-prism-stack] bootstrapping app"
  api_bootstrap_args=(
    --environment "$environment_arg"
    --service "$site_service"
  )
  if [[ -n "$project_arg" ]]; then
    api_bootstrap_args=(--project "$project_arg" "${api_bootstrap_args[@]}")
  fi
  if [[ -n "$target_manifest" ]]; then
    api_bootstrap_args+=(--manifest "$target_manifest")
  fi
  bash scripts/railway-bootstrap-api.sh "${api_bootstrap_args[@]}"
fi

if [[ "$deploy_site" == true ]]; then
  echo "[railway-deploy-prism-stack] deploying $site_service"
  railway up "${common_railway_args[@]}" --service "$site_service" --path-as-root services/site --ci
fi

echo "[railway-deploy-prism-stack] deploying $prism_memory_service"
railway up "${common_railway_args[@]}" --service "$prism_memory_service" --path-as-root services/prism-memory --ci

python3 - <<PY
import json
import urllib.request

base = "${prism_base}".rstrip("/")
key = "${prism_key}"

def post(path: str) -> None:
    req = urllib.request.Request(
        f"{base}{path}",
        headers={"X-Prism-Api-Key": key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as response:
        body = response.read().decode()
    print(f"[railway-deploy-prism-stack] {path} -> {body}")

if ${run_memory}:
    post("/ops/memory/run?force=true")

if ${run_knowledge}:
    post("/ops/knowledge/run")
PY

echo "[railway-deploy-prism-stack] complete"

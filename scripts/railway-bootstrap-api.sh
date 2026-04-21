#!/usr/bin/env bash
set -euo pipefail

project_arg=""
environment_arg=""
service_name="api"
manifest_path=""
skip_admin=false
skip_targets=false

usage() {
  cat <<'EOF'
Usage:
  bash scripts/railway-bootstrap-api.sh \
    [--project <railway-project-id>] \
    [--environment <railway-environment>] \
    [--service api] \
    [--manifest /app/config/target-apps.default.json] \
    [--skip-admin] \
    [--skip-targets]

What it does:
  1. Runs `npm run migrate`
  2. Runs `npm run bootstrap:admin`
  3. Runs `npm run bootstrap:targets`

Optional:
  --project       Railway project id/name if not using linked project
  --environment   Railway environment id/name if not using linked env
  --service       Railway service name for the API (default: api)
  --manifest      Override target manifest path for bootstrap:targets
  --skip-admin    Skip `bootstrap:admin`
  --skip-targets  Skip `bootstrap:targets`

Example:
  npm run railway:bootstrap-api -- \
    --environment production \
    --service api
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
    --service)
      service_name="$2"
      shift 2
      ;;
    --manifest)
      manifest_path="$2"
      shift 2
      ;;
    --skip-admin)
      skip_admin=true
      shift 1
      ;;
    --skip-targets)
      skip_targets=true
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

ssh_args=()
if [[ -n "$project_arg" ]]; then
  ssh_args+=(--project "$project_arg")
fi
if [[ -n "$environment_arg" ]]; then
  ssh_args+=(--environment "$environment_arg")
fi
ssh_args+=(--service "$service_name")

remote_cmd=$(
  cat <<EOF
set -euo pipefail
cd /app
npm run migrate
EOF
)

if [[ "$skip_admin" != true ]]; then
  remote_cmd+=$'\n''npm run bootstrap:admin'
fi

if [[ "$skip_targets" != true ]]; then
  if [[ -n "$manifest_path" ]]; then
    remote_cmd+=$'\n'"TARGET_APPS_MANIFEST=$(printf '%q' "$manifest_path") npm run bootstrap:targets"
  else
    remote_cmd+=$'\n''npm run bootstrap:targets'
  fi
fi

echo "[railway-bootstrap-api] bootstrapping API on service '$service_name'"
echo "[railway-bootstrap-api] Railway target:"
railway status
railway ssh "${ssh_args[@]}" sh -lc "$remote_cmd"

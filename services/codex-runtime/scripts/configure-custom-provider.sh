#!/usr/bin/env bash
set -euo pipefail

prompt() {
  local label="$1"
  local default_value="${2:-}"
  local value
  if [ -n "$default_value" ]; then
    read -r -p "$label [$default_value]: " value
    printf '%s' "${value:-$default_value}"
  else
    read -r -p "$label: " value
    printf '%s' "$value"
  fi
}

prompt_secret() {
  local label="$1"
  local value
  read -r -s -p "$label: " value
  printf '\n' >&2
  printf '%s' "$value"
}

toml_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

yes_no() {
  local label="$1"
  local default_value="${2:-n}"
  local value
  read -r -p "$label [$default_value]: " value
  value="${value:-$default_value}"
  case "$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" in
    y|yes|true|1) return 0 ;;
    *) return 1 ;;
  esac
}

codex_home="${CODEX_HOME:-/data/codex}"
config_path="$codex_home/config.toml"

printf 'Codex custom provider setup\n'
printf 'CODEX_HOME: %s\n\n' "$codex_home"

provider_id="$(prompt "Provider id" "venice")"
provider_name="$(prompt "Provider display name" "Venice")"
base_url="$(prompt "Provider base URL" "https://api.venice.ai/api/v1/")"
wire_api="$(prompt "Wire API" "responses")"
model="$(prompt "Model" "openai-gpt-54")"
reasoning_effort="$(prompt "Model reasoning effort (blank to omit)" "high")"

printf '\nSecret handling\n'
printf '1. Reference a Railway env var, for example VENICE_API_KEY.\n'
printf '2. Write experimental_bearer_token into config.toml, optionally reading it from an env var.\n'
secret_mode="$(prompt "Choose 1 or 2" "1")"

env_key=""
bearer_token=""
if [ "$secret_mode" = "2" ]; then
  token_env_key="$(prompt "Env key to read token from (blank to paste)" "VENICE_API_KEY")"
  if [ -n "$token_env_key" ] && [ -n "${!token_env_key:-}" ]; then
    bearer_token="${!token_env_key}"
    printf 'Using %s from the current shell environment.\n' "$token_env_key"
  else
    if [ -n "$token_env_key" ]; then
      printf '%s is not present in this shell. Paste the provider API key instead.\n' "$token_env_key"
    fi
    bearer_token="$(prompt_secret "Provider API key")"
  fi
  if [ -z "$bearer_token" ]; then
    printf 'Provider API key is required for direct-token mode.\n' >&2
    exit 1
  fi
else
  env_key="$(prompt "Provider env key" "VENICE_API_KEY")"
  if [ -z "$env_key" ]; then
    printf 'Provider env key is required for env-key mode.\n' >&2
    exit 1
  fi
fi

mkdir -p "$codex_home"
if [ -f "$config_path" ]; then
  backup_path="$config_path.$(date -u +%Y%m%d%H%M%S).bak"
  cp "$config_path" "$backup_path"
  printf '\nBacked up existing config to %s\n' "$backup_path"
fi

{
  printf '#:schema https://developers.openai.com/codex/config-schema.json\n\n'
  printf 'model = "%s"\n' "$(toml_escape "$model")"
  printf 'model_provider = "%s"\n' "$(toml_escape "$provider_id")"
  if [ -n "$reasoning_effort" ]; then
    printf 'model_reasoning_effort = "%s"\n' "$(toml_escape "$reasoning_effort")"
  fi
  printf '\n[model_providers.%s]\n' "$provider_id"
  printf 'name = "%s"\n' "$(toml_escape "$provider_name")"
  printf 'base_url = "%s"\n' "$(toml_escape "$base_url")"
  if [ -n "$env_key" ]; then
    printf 'env_key = "%s"\n' "$(toml_escape "$env_key")"
  else
    printf 'experimental_bearer_token = "%s"\n' "$(toml_escape "$bearer_token")"
  fi
  printf 'wire_api = "%s"\n' "$(toml_escape "$wire_api")"
} > "$config_path"

chmod 600 "$config_path"

printf '\nWrote %s\n' "$config_path"
if [ -n "$env_key" ]; then
  if [ -n "${!env_key:-}" ]; then
    printf '%s is present in the current shell environment.\n' "$env_key"
  else
    printf '%s is not present in this shell. Set it on the codex-runtime service and redeploy.\n' "$env_key"
  fi
fi

if yes_no "Print config without secrets?" "y"; then
  printf '\n'
  if [ -n "$bearer_token" ]; then
    sed 's/experimental_bearer_token = ".*/experimental_bearer_token = "[redacted]"/' "$config_path"
  else
    cat "$config_path"
  fi
fi

printf '\nNext steps:\n'
printf '1. Unset CODEX_MODEL unless it matches this provider model.\n'
printf '2. Redeploy or restart codex-runtime after changing Railway env.\n'
printf '3. Check /health for codexAuthMode=custom-provider and codexAuthConfigured=true.\n'

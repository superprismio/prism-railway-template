# Codex Custom Provider Setup

Status: exploratory spec

## Purpose

Some Prism operators want to run an instance without an OpenAI or ChatGPT
account, while still using the Codex CLI as the local agent shell. The immediate
example is using Venice AI and open-source models through an API key.

The current template supports Codex Runtime through the official Codex CLI
device-auth path:

```text
codex-runtime -> codex exec -> OpenAI/ChatGPT Codex auth in CODEX_HOME
```

This is the supported default, but it assumes an OpenAI account. Codex CLI can
also be configured with a custom model provider. In that mode, the CLI remains
the execution shell, but model calls go to another provider.

```text
codex-runtime -> codex exec -> custom provider in CODEX_HOME/config.toml
```

This spec defines the first supported path for that custom-provider setup.

## Goals

- Support Codex Runtime setup without `codex login --device-auth` when a custom
  provider config and API key are present.
- Make Venice/open-model setup explicit in docs and Settings.
- Keep OpenAI device auth as the default supported path.
- Avoid adding broad template env requirements for all operators.
- Preserve Prism Console, Discord bot replies, change-request workflows, and
  Codex prompt tasks as callers of `codex-runtime`.

## Non-Goals

- Replace Codex CLI with a generic LLM runtime in this slice.
- Guarantee every OpenAI-compatible model works for agentic coding.
- Build a provider picker with live model discovery.
- Store provider API keys in the site database.
- Expose provider secrets to the browser.

## Current Behavior

`services/codex-runtime` shells out to `codex exec` and sets `CODEX_HOME` in the
child process. Runtime health reports `codexAuthConfigured` by checking for:

```text
CODEX_HOME/auth.json
```

The Settings page therefore treats a runtime without `auth.json` as needing
Codex auth, even if `CODEX_HOME/config.toml` defines a working custom provider.

The runtime already supports selecting a model through:

```text
CODEX_MODEL
```

When set, this is passed as `codex exec -m <model>`, which can override the
model configured in `config.toml`.

## Proposed Behavior

Codex Runtime should recognize two setup modes:

```text
device-auth
custom-provider
```

### Device Auth Mode

Default path. This remains unchanged:

```bash
railway ssh -s codex-runtime
mkdir -p /data/codex
export CODEX_HOME=/data/codex
export PATH="/app/node_modules/.bin:$PATH"
codex login --device-auth
```

Health is configured when:

```text
/data/codex/auth.json exists
```

### Custom Provider Mode

Experimental first-class path. Operators configure:

```text
/data/codex/config.toml
```

Interactive setup:

```bash
railway ssh -s codex-runtime
export CODEX_HOME=/data/codex
npm run configure:provider --workspace @prism-railway/codex-runtime
```

Example Venice config:

```toml
#:schema https://developers.openai.com/codex/config-schema.json

model = "openai-gpt-54"
model_provider = "venice"
model_reasoning_effort = "high"

[model_providers.venice]
name = "Venice"
base_url = "https://api.venice.ai/api/v1/"
experimental_bearer_token = "YOUR VENICE API KEY"
wire_api = "responses"
```

Venice's Codex CLI integration guide uses `experimental_bearer_token` directly
in `config.toml` and requires `wire_api = "responses"`. If Codex CLI supports
`env_key` for the selected provider path, operators may instead keep the secret
in Railway env:

```toml
model = "deepseek-v4-pro"
model_provider = "venice"

[model_providers.venice]
name = "Venice"
base_url = "https://api.venice.ai/api/v1/"
env_key = "VENICE_API_KEY"
wire_api = "responses"
```

Then set the API key on `codex-runtime`:

```text
VENICE_API_KEY="<venice-api-key>"
```

No `codex login --device-auth` is required for this mode.

Health should treat custom-provider mode as configured when:

- `CODEX_HOME/config.toml` exists;
- it contains a top-level `model_provider`;
- it contains a matching `[model_providers.<id>]` table;
- the provider table has `base_url`;
- either the referenced `env_key` is present in `process.env`, or
  `experimental_bearer_token` is present.

Health should report enough non-secret detail for Settings:

```json
{
  "codexAuthMode": "custom-provider",
  "codexAuthConfigured": true,
  "codexHome": "/data/codex",
  "codexModel": "openai-gpt-54",
  "codexModelProvider": "venice",
  "codexProviderBaseUrl": "https://api.venice.ai/api/v1",
  "codexProviderEnvKey": null,
  "codexProviderEnvConfigured": null,
  "codexProviderTokenConfigured": true,
  "codexProviderWireApi": "responses"
}
```

Do not return provider API key values.

## Settings UI

The Settings page should stop presenting all missing `auth.json` cases as
"Auth needed".

Recommended display:

```text
Codex Runtime
Reachable
Setup mode: Device auth | Custom provider | Not configured
Home: /data/codex
Model: openai-gpt-54
Provider: venice
Provider token configured in Codex config
```

When neither mode is configured, show two setup paths:

```text
Option A: OpenAI/ChatGPT device auth
...

Option B: Custom provider
1. Run the interactive provider helper or create /data/codex/config.toml
2. Set the provider API key env var on codex-runtime
3. Redeploy codex-runtime
```

## Runbook Changes

Add a "Codex Runtime Custom Provider" subsection to:

- `docs/operations/template-deploy-runbook.md`
- `docs/operations/railway-env-checklist.md`
- `docs/operations/codex-runtime-auth.md`

The runbook should make these distinctions clear:

- Venice voice transcription is configured on `discord-adapter`.
- Venice Prism Memory enrichment is configured on `prism-memory`.
- Venice as the Codex CLI provider is configured on `codex-runtime`.
- `CODEX_MODEL` should be unset unless it names a model valid for the configured
  provider.
- Venice's documented Codex CLI path uses `wire_api = "responses"`.
- `services/codex-runtime/scripts/configure-custom-provider.sh` provides the
  supported interactive setup helper.

## Template Env

Do not require new env for the default template.

Optional envs that may be documented:

```text
VENICE_API_KEY
CODEX_MODEL
```

Avoid adding a provider-specific env block to every generated template unless
the Railway template supports optional advanced sections cleanly.

## Validation

For a custom-provider instance:

1. Set `CODEX_HOME=/data/codex`.
2. Write `/data/codex/config.toml` with a custom provider.
3. Set the provider API key env var on `codex-runtime` if using `env_key`, or
   store the token in `experimental_bearer_token` if following the Venice guide.
4. Redeploy `codex-runtime`.
5. Confirm `/health` reports `codexAuthMode: "custom-provider"` and
   `codexAuthConfigured: true`.
6. Run a direct runtime smoke test:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  "$CODEX_RUNTIME_BASE_URL/v1/responses/jobs" \
  -d '{"prompt":"Reply with one sentence confirming the configured model provider works.","sessionId":"custom-provider-smoke","recentHistory":[],"metadata":{"source":"smoke"}}'
```

7. Poll the returned job id.
8. Send one Prism Console prompt and verify it completes.
9. Mention the Discord bot and verify the reply path completes.

## Risks

- Some open-source models may not handle Codex CLI's tool-use expectations well.
- Some OpenAI-compatible providers may support chat completions but not the wire
  behavior Codex CLI expects.
- `CODEX_MODEL` can accidentally override `config.toml` and select an invalid
  model for the provider.
- Custom-provider health can become misleading if it only validates file/env
  presence. A future deeper check could run a tiny `codex exec` smoke test, but
  that should not happen on every health request.

## Future Work

- Add a generic `llm-runtime` for OpenAI-compatible chat completions, separate
  from Codex CLI.
- Add Settings UI to write `config.toml` through a secure runtime endpoint.
- Add provider presets for Venice, OpenRouter, Ollama, and LM Studio.
- Add one-click custom-provider smoke test from Settings.

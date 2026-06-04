# Codex Runtime Model Access

`codex-runtime` uses the Codex CLI and stores its auth/session state on the
persistent Railway volume. The default setup uses OpenAI/ChatGPT device auth.
Custom-provider setup can use `CODEX_HOME/config.toml` instead.

## Required prerequisites

- `codex-runtime` is deployed and healthy
- a persistent Railway volume is attached at `/data`
- `CODEX_HOME=/data/codex`
- the service has the `codex` CLI installed

## Default: Device Auth

This stack does not use `OPENAI_API_KEY` for the default Codex chat path.
Instead, `codex-runtime` runs the Codex CLI directly and persists device auth
under `CODEX_HOME`. If that path is on a Railway volume, auth survives restarts
and redeploys.

SSH into the running `codex-runtime` service, then run:

```bash
mkdir -p /data/codex
chmod 777 /data/codex
export CODEX_HOME=/data/codex
codex login --device-auth
```

Then:

1. open the device auth URL shown by the CLI
2. enter the one-time code
3. finish the browser login

When the CLI prints `Successfully logged in`, the runtime is ready.

## Alternative: Custom Provider

Operators can use the Codex CLI with a custom provider instead of OpenAI device
auth. This is useful for experiments with Venice AI or other model providers.
In this mode, do not run `codex login --device-auth`; configure
`/data/codex/config.toml`.

Interactive setup:

```bash
railway ssh -s codex-runtime
export CODEX_HOME=/data/codex
npm run configure:provider --workspace @prism-railway/codex-runtime
```

The helper backs up any existing `config.toml`, writes the provider config, and
can either reference a Railway env var such as `VENICE_API_KEY` or write the
provider token directly using Codex's `experimental_bearer_token` setting.

Venice example:

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

If supported by the Codex CLI provider path, prefer storing secrets in Railway
env and referencing the env key from config:

```toml
model = "deepseek-v4-pro"
model_provider = "venice"

[model_providers.venice]
name = "Venice"
base_url = "https://api.venice.ai/api/v1/"
env_key = "VENICE_API_KEY"
wire_api = "responses"
```

Then set `VENICE_API_KEY` on the `codex-runtime` service and redeploy.

## Verification

Confirm the runtime is healthy:

```bash
curl https://codex-runtime-production.up.railway.app/health
```

You should see `codexRuntimeEnabled: true`.
For device auth, `codexAuthMode` should be `device-auth`. For custom-provider
setup, `codexAuthMode` should be `custom-provider`.

Optionally confirm skill discovery too:

```bash
curl https://codex-runtime-production.up.railway.app/skills
```

## Failure modes

If `codex login` says `CODEX_HOME points to "/data/codex", but that path does not exist`:

```bash
mkdir -p /data/codex
export CODEX_HOME=/data/codex
```

If `/data` does not exist:

- the Railway volume is not mounted in that service instance
- check the service volume attachment first

If auth disappears after restart:

- verify `CODEX_HOME` still points at the mounted volume
- verify the service still has `/data` attached
- check whether the volume was replaced or detached

## Notes

- no `OPENAI_API_KEY` is required for the default device-auth path
- this is separate from app/API auth
- this login step only needs to be repeated if the `codex-runtime` volume is replaced or wiped
- custom-provider setup does not require `auth.json`, but it does require a
  valid `config.toml` and provider credentials

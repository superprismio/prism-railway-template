# Codex Runtime Service

Minimal HTTP wrapper around the Codex CLI.

Behavior:

- exposes `GET /health`
- exposes `GET /codex/health`
- exposes `POST /v1/responses`
- starts or resumes Codex CLI sessions using `codex exec` and `codex exec resume`
- persists Codex auth and session state through `CODEX_HOME`

Required env:

- `PORT=3030`
- `CODEX_HOME=/data/codex`

Recommended env:

- `CODEX_BIN=codex`
- `CODEX_RUNTIME_TIMEOUT_MS=600000`
- `CODEX_IMAGE_GENERATION_ENABLED=true`
- `CODEX_WORKSPACE_ROOT=/app`
- `CODEX_TARGET_WORKSPACE_ROOT=/data/workspaces`
- `CODEX_MODEL=<optional>`
- `PRISM_API_BASE=<optional>`
- `PRISM_API_READ_KEY=<optional>`
- `APP_API_BASE_URL=<your api base url>`
- `APP_API_SERVICE_TOKEN=<same internal service token as api>`
- `TARGET_REPO_GITHUB_TOKEN=<github token for private target repos>`
- `PRISM_GATEWAY_ENABLED=false`
- `PRISM_GATEWAY_BASE_URL=<private Prism Gateway URL>`
- `PRISM_GATEWAY_TOKEN=<runtime-specific Gateway caller token>`
- `PRISM_GATEWAY_TIMEOUT_MS=20000`

Gateway calls are made by the runtime parent process. Do not pass the long-lived
Gateway service token into prompts, tool arguments, traces, or agent-visible
configuration. Agent access should use a short-lived job-scoped token that is
restricted to the capabilities listed on that runtime job.

Site-owned workflows assign capabilities through step or workflow agent config:

```json
{
  "gatewayCapabilities": ["plausible.stats.query"]
}
```

The runtime gives the Codex child a short-lived local invocation token for only
those keys. Gateway grants remain authoritative.

Railway notes:

- attach a persistent volume at `/data`
- set `CODEX_HOME=/data/codex`
- keep external target repos under `/data/workspaces`
- run a one-time `codex login` inside the running service environment
- adapters like Discord or Slack should call this service instead of embedding Codex directly

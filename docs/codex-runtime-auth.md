# Codex Runtime Device Auth

`codex-runtime` uses Codex CLI auth stored on its persistent Railway volume. This is a one-time bootstrap step per service volume.

## Required prerequisites

- `codex-runtime` is deployed and healthy
- a persistent Railway volume is attached at `/data`
- `CODEX_HOME=/data/codex`
- the service has the `codex` CLI installed

## Why this is needed

This stack does not use `OPENAI_API_KEY` for Codex chat.

Instead, `codex-runtime` runs the Codex CLI directly and persists its auth/session state under `CODEX_HOME`. If that path is on a Railway volume, auth survives restarts and redeploys.

## One-time login flow

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

## Verification

Confirm the runtime is healthy:

```bash
curl https://codex-runtime-production.up.railway.app/health
```

You should see `codexRuntimeEnabled: true`.

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

- no `OPENAI_API_KEY` is required for this path
- this is separate from app/API auth
- this login step only needs to be repeated if the `codex-runtime` volume is replaced or wiped

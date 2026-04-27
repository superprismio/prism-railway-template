# Template Site/API Consolidation Delta

This is the short checklist for the Railway template once the live cutover has been proven.

## New `site` env vars

Add to `site`:

```env
SITE_USE_LOCAL_APP_API=true
PRISM_AGENT_DATA_ROOT=/data
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
SESSION_SECRET=...
COMMUNITY_PROVIDER=...
INTERNAL_SERVICE_TOKEN=...
```

## Existing `site` env vars to keep during transition

```env
NEXT_PUBLIC_API_BASE_URL=...
API_INTERNAL_BASE_URL=...
PRISM_MEMORY_BASE_URL=...
PRISM_API_READ_KEY=...
CODEX_RUNTIME_BASE_URL=...
```

## Volume change

Mount the app SQLite/data volume on `site` at:

```text
/data
```

## Service topology

Transitional version:

- keep `site`
- keep `api`
- keep `prism-memory`
- keep `codex-runtime`
- keep `discord-adapter`
- keep cron services

Final version later:

- remove `api`

## Do not do yet

Do not remove from the template yet:

- `api` service
- `NEXT_PUBLIC_API_BASE_URL`
- `API_INTERNAL_BASE_URL`

Those should stay until write-path parity and caller repoints are complete.

# Prism Gateway

`prism-gateway` is the optional capability, connection, policy, and audit
boundary for Prism runtimes and services.

This first implementation slice includes:

- Express health and authenticated catalog APIs
- caller-specific service tokens
- mounted-volume SQLite migrations
- AES-256-GCM connection credential storage
- write-only connection create, replace, and revoke APIs
- seeded `http-json.read` and constrained `mcp-tool.call` connector drivers
- declarative instance capability creation with public-HTTPS constraints
- default-deny runtime and service grants
- hardened read invocation with DNS pinning, redirect rejection, timeouts, and
  bounded JSON responses
- redacted audit events and warning-only usage ledger rows

It does not yet expose Gateway settings in Site or change any existing runtime
path.

## Local Setup

Generate a 32-byte base64 key and caller tokens:

```bash
export GATEWAY_MASTER_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export GATEWAY_SITE_TOKEN="$(openssl rand -hex 32)"
export GATEWAY_CODEX_RUNTIME_TOKEN="$(openssl rand -hex 32)"
npm run dev
```

The local database defaults to:

```text
.prism-gateway/prism-gateway.sqlite
```

Set `GATEWAY_DATA_ROOT` or `GATEWAY_DB_PATH` to override it.

## Authentication

All routes except `GET /health` require:

```text
x-gateway-token: <caller-specific-token>
```

Connection and capability mutations additionally require the Site caller token.
Codex Runtime and Task Runner tokens cannot use admin routes.

## Current Routes

```text
GET    /health
GET    /connector-drivers
GET    /capabilities
POST   /capabilities
PATCH  /capabilities/:key
POST   /capabilities/:key/test
GET    /connections
POST   /connections
PUT    /connections/:id/credentials
DELETE /connections/:id
GET    /grants
PUT    /grants/:id
POST   /invoke
GET    /audit-events
GET    /audit-events/:traceId
```

Connections may be created without credentials for the chat-to-Settings handoff.
Credential values are accepted only on create and replacement through the Site
admin caller. Responses list credential names but never return plaintext values.

`http-json.read` capabilities define a fixed public HTTPS origin and path,
allowed query keys, auth secret mapping, timeout, and response limit. Runtime
input can supply only allowlisted query values. Gateway resolves and pins a
public address for the request, rejects redirects, and accepts JSON responses
only.

`mcp-tool.call` capabilities also use a fixed public HTTPS origin and path, but
map caller-visible operation aliases to an admin-owned allowlist of MCP tool
names and argument keys. Runtime input cannot choose an arbitrary MCP tool,
endpoint, header, or credential. Streamable HTTP JSON and SSE-wrapped JSON-RPC
responses are normalized to the tool result.

Example driver configuration:

```json
{
  "baseUrl": "https://analytics.example.org",
  "pathTemplate": "/api/stats",
  "allowedQueryParams": ["period", "metric"],
  "auth": {
    "type": "bearer",
    "secretName": "apiKey"
  },
  "timeoutMs": 10000,
  "maxResponseBytes": 1000000
}
```

## Railway

Configure the service root as:

```text
/services/prism-gateway
```

Attach one volume at `/data`. The service uses
`/data/prism-gateway.sqlite` when Railway sets `RAILWAY_VOLUME_MOUNT_PATH`.

Required bootstrap variables:

```text
PORT=8794
GATEWAY_MASTER_ENCRYPTION_KEY=<generated 32-byte key>
GATEWAY_SITE_TOKEN=<generated caller token>
GATEWAY_CODEX_RUNTIME_TOKEN=<generated caller token>
```

Changing the encryption key makes existing credentials unreadable until key
rotation support is implemented.

# Prism Gateway

`prism-gateway` owns organization integration credentials and makes connected
services available to Prism runtimes without keeping provider secrets in each
runtime environment.

The normal model has two resources:

- **Connections** store encrypted provider credentials.
- **Connected services** bind a connection to an OpenAPI, MCP, HTTP, or
  compatibility-adapter interface that a runtime can discover and use.

One connection can back multiple connected services. Gateway owns credential
custody, fixed destination and authentication configuration, caller identity,
and redacted audit history. The downstream service continues to own its API
semantics and authorization rules.

Site exposes the admin interface under **Settings > Gateway**. Provider secrets
are entered there, never in Prism Console or chat. Use the instance-owned
`prism-gateway-author` skill in Prism Console to create or update connected
service configuration after the credential exists.

## Local Setup

Generate a 32-byte base64 key and caller tokens:

```bash
export GATEWAY_MASTER_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export GATEWAY_MASTER_KEY_VERSION="v1"
export GATEWAY_SITE_TOKEN="$(openssl rand -hex 32)"
export GATEWAY_CODEX_RUNTIME_TOKEN="$(openssl rand -hex 32)"
npm run dev
```

The local database defaults to `.prism-gateway/prism-gateway.sqlite`. Set
`GATEWAY_DATA_ROOT` or `GATEWAY_DB_PATH` to override it.

From the repository root, `npm run local:site` rebuilds only Site while keeping
the rest of a running local stack intact.

## Authentication

All routes except `GET /health` require a caller-specific token:

```text
x-gateway-token: <caller-specific-token>
```

Connection, connected-service, and operations mutations require the Site caller
token. Runtime and Task Runner tokens cannot use admin routes. Provider secret
values are accepted on connection create or credential replacement and are
never returned by connection, catalog, audit, or health responses.

## Current Routes

Normal connection and connected-service routes:

```text
GET    /health
GET    /connector-drivers
GET    /connections
POST   /connections
PUT    /connections/:id/credentials
DELETE /connections/:id
GET    /toolsets
POST   /toolsets
PATCH  /toolsets/:key
POST   /toolsets/:key/describe
POST   /toolsets/:key/request
POST   /toolsets/lease
GET    /audit-events
GET    /audit-events/:traceId
POST   /ops/backup
POST   /ops/rotate-master-key
```

The `/capabilities`, `/grants`, and `/invoke` routes remain for migrated narrow
wrappers. They are compatibility APIs, not the recommended authoring model for
new integrations.

An `adapter` connected service leases selected environment variables only to an
assigned trusted runtime child job. This preserves existing CLI and SDK use
while removing persistent provider credentials from the runtime service. Use a
proxied OpenAPI, MCP, or HTTP connected service when the runtime must never
receive the downstream credential.

## Operations

Gateway uses versioned AES-256-GCM encryption. `GET /health` reports the current
key version, versions present in the database, whether rotation is required,
unreadable secret count, and any unavailable versions. Health returns `503`
when encrypted rows require a missing or cryptographically mismatched key.

`POST /ops/backup` creates a consistent SQLite snapshot plus a JSON manifest in
`backups/` beside the configured database. The manifest includes the checksum
and required encryption-key versions but never key values. Backups on the same
volume do not protect against volume loss and must be exported or covered by a
separate volume-backup policy.

See [Prism Gateway Backup, Restore, and Key Rotation](../../docs/operations/prism-gateway-backup-restore.md)
for the tested runbook. Never replace `GATEWAY_MASTER_ENCRYPTION_KEY` directly;
use the documented two-key rotation procedure.

## Railway

Configure the service root as `/services/prism-gateway` and attach one volume at
`/data`. The service uses `/data/prism-gateway.sqlite` when Railway sets
`RAILWAY_VOLUME_MOUNT_PATH`.

Required bootstrap variables:

```text
PORT=8794
GATEWAY_MASTER_ENCRYPTION_KEY=<generated 32-byte key>
GATEWAY_MASTER_KEY_VERSION=v1
GATEWAY_SITE_TOKEN=<generated caller token>
GATEWAY_CODEX_RUNTIME_TOKEN=<generated caller token>
```

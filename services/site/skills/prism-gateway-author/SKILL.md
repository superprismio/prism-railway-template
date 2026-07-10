---
name: prism-gateway-author
description: Use this skill when an admin asks to connect, configure, test, enable, disable, inspect, or troubleshoot an organization integration or Prism Gateway capability. It covers chat-driven non-secret configuration and secure credential handoff through Settings.
---

Use the Site agent API for Gateway authoring. Never ask the user to paste API
keys, tokens, passwords, private keys, or other credentials into chat. Do not
place credentials in capability configuration, artifacts, logs, or output.

Authenticate with `x-service-token: $PRISM_AGENT_SERVICE_TOKEN`.

## Inspect

Use `GET /agent/gateway` to read the redacted catalog, connections,
capabilities, grants, and recent audit. Stored credential values are never
returned.

## Configure An Integration

1. Inspect the catalog and reuse an active connection when appropriate.
2. Create a pending connection with `POST /agent/gateway/connections`:

```json
{
  "provider": "plausible",
  "label": "Plausible Analytics",
  "authType": "bearer",
  "secretName": "apiKey"
}
```

The response includes `credentialUrl` and `credentialPath`. Give the admin that
link and say the credential must be entered in Settings. Never offer to accept
the credential in chat.

For an existing connection, construct the same stable Settings path from its
redacted catalog record:

```text
/admin?tab=settings&settings=gateway&connection=<connection-id>&action=credential&secretName=<secret-name>
```

Use the connection's existing `secretNames[0]` when present; otherwise use the
secret name required by the capability authentication mapping.

3. Create non-secret capability configuration with
`POST /agent/gateway/capabilities`. Chat-created capabilities are disabled by
default. Include `enabled: true` only when binding to a connection that already
has a tested credential. Site creates the default runtime grant automatically.
4. Stop and ask the admin to use the credential link. Do not repeatedly test a
pending connection with no credential.
5. After the admin confirms, test representative non-destructive input with
`POST /agent/gateway/capabilities/<key>/test` and body `{"input": {...}}`.
6. On success, enable it with
`PATCH /agent/gateway/capabilities/<key>` and body `{"enabled": true}`.

Report the capability key, connection label, test result, and follow-up needed.
Do not claim setup succeeded before the test passes.

## Plausible Preset

For Plausible v2 analytics, use fixed-target `http-json.read` with:

```json
{
  "key": "plausible.stats.query",
  "driverKey": "http-json.read",
  "provider": "plausible",
  "description": "Query Plausible analytics. Always provide the exact registered site_id, metrics, and date_range.",
  "inputSchema": {
    "type": "object",
    "required": ["site_id", "metrics", "date_range"],
    "additionalProperties": false,
    "properties": {
      "site_id": { "type": "string", "minLength": 1 },
      "metrics": { "type": "array", "minItems": 1, "items": { "type": "string" } },
      "date_range": {
        "oneOf": [
          { "type": "string", "minLength": 1 },
          { "type": "array", "minItems": 2, "maxItems": 2, "items": { "type": "string" } }
        ]
      },
      "dimensions": { "type": "array", "items": { "type": "string" } },
      "filters": { "type": "array" },
      "include": { "type": "object" },
      "pagination": { "type": "object" }
    }
  },
  "driverConfig": {
    "baseUrl": "https://plausible.example.org",
    "pathTemplate": "/api/v2/query",
    "method": "POST",
    "allowedQueryParams": [],
    "allowedJsonBodyParams": ["site_id", "metrics", "date_range", "dimensions", "filters", "include", "pagination"],
    "staticJsonBody": {},
    "auth": { "type": "bearer", "secretName": "apiKey" },
    "timeoutMs": 10000,
    "maxResponseBytes": 1000000
  }
}
```

Add the pending connection ID and replace only the instance origin. Runtime
invocations cannot override origin, path, method, authentication, or allowlists.

## Safety

- Credential create, replace, and revoke remain admin-session operations in
  Settings.
- Never send credentials through `/agent/*`.
- Use only approved constrained drivers; never proxy arbitrary URLs or headers.
- Keep capabilities disabled until their connection test succeeds.
- Treat downstream `4xx` as input, authentication, or configuration evidence.
- Keep working direct integrations until Gateway migration is explicitly tested.

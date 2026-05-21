---
name: prism-instance-settings
description: Use this skill when Codex is asked to view or update Prism instance settings such as platform branding, logo, title, workspace label, site content, source adapter access policy, or Prism Memory source/bucket configuration.
---

Use this skill for instance-level Prism settings owned by the site service.
These settings are persisted by the site service under the mounted data root.
Do not write `site-content.json` directly from Codex Runtime.

Required environment:

- `PRISM_AGENT_API_BASE_URL`
- `PRISM_AGENT_SERVICE_TOKEN`

If those names are not present, use:

- `APP_API_BASE_URL`
- `APP_API_SERVICE_TOKEN`

## Branding

For logo, title, brand name, or workspace label changes, use the agent API:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: ${PRISM_AGENT_SERVICE_TOKEN:-$APP_API_SERVICE_TOKEN}" \
  "${PRISM_AGENT_API_BASE_URL:-$APP_API_BASE_URL}/agent/site-content/branding" \
  -d "$BRANDING_JSON"
```

Supported payload fields:

```json
{
  "brandName": "Example Community",
  "workspaceLabel": "Example Community",
  "logoUrl": "https://example.com/logo.svg",
  "logoAlt": "Example Community logo"
}
```

Verify with:

```bash
curl -fsSL \
  -H "x-service-token: ${PRISM_AGENT_SERVICE_TOKEN:-$APP_API_SERVICE_TOKEN}" \
  "${PRISM_AGENT_API_BASE_URL:-$APP_API_BASE_URL}/agent/site-content/branding"
```

Do not use `/admin/branding` from Codex Runtime. That route is for the browser admin UI and requires an authenticated admin session.

Return the saved branding values and any fields that were not changed.

## Source Adapter Access Policy

For source adapter access rules, use the agent API:

```bash
curl -fsSL \
  -H "x-service-token: ${PRISM_AGENT_SERVICE_TOKEN:-$APP_API_SERVICE_TOKEN}" \
  "${PRISM_AGENT_API_BASE_URL:-$APP_API_BASE_URL}/agent/source-adapter-policy"
```

To update the policy:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "x-service-token: ${PRISM_AGENT_SERVICE_TOKEN:-$APP_API_SERVICE_TOKEN}" \
  "${PRISM_AGENT_API_BASE_URL:-$APP_API_BASE_URL}/agent/source-adapter-policy" \
  -d "$SOURCE_ADAPTER_POLICY_JSON"
```

Use platform-scoped policy. For Discord, `targets` are channel or thread IDs,
`groups` are role IDs, and `users` are Discord user IDs.

```json
{
  "platforms": {
    "discord": {
      "defaultMode": "readonly",
      "defaultRateLimit": {
        "windowSeconds": 60,
        "maxRequests": 6
      },
      "targets": {
        "123456789012345678": { "mode": "run-approved" }
      },
      "groups": {
        "345678901234567890": { "mode": "full" }
      },
      "users": {}
    }
  }
}
```

Supported modes:

- `off`: do not answer in that source surface
- `readonly`: answer questions and read context only
- `run-approved`: run existing approved tasks and workflows
- `full`: allow trusted authoring/write behavior, subject to runtime safeguards

Do not use `/admin/source-adapter-policy` from Codex Runtime. That route is for
the browser admin UI and requires an authenticated admin session.

## Prism Memory Discord Buckets

Use this flow when asked to configure Discord memory collection, fix wrong
Discord bucket mappings, repair existing Prism Memory files after a mapping
change, or inspect the connected Discord server structure.

Required environment:

- `COMMUNICATION_ADAPTER_BASE_URL`
- `COMMUNICATION_ADAPTER_TOKEN`
- `PRISM_MEMORY_BASE_URL`
- `PRISM_API_OPS_KEY`

If `PRISM_MEMORY_BASE_URL` is not present, use the instance's Prism Memory base
URL. If `PRISM_API_OPS_KEY` is not present, use the Prism Memory write/ops key
available in the environment. Do not use the site service token against Prism
Memory ops endpoints.

First inspect the live Discord guild through the communication adapter:

```bash
curl -fsSL \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/guild/channels"
```

Use the returned category IDs and channel structure to decide the
`discord.category_to_bucket` mapping. Do not copy category IDs from another
community; Discord IDs are instance-specific.

Read current Prism Memory config:

```bash
curl -fsSL \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/config/space"
```

Patch only the Discord mapping when possible:

```bash
curl -fsSL \
  -X PATCH \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/config/space" \
  -d '{"patch":{"discord":{"category_to_bucket":{"<category-id>":"<bucket-name>"}}}}'
```

After changing `discord.category_to_bucket` on an instance that has already
collected Discord messages, run a repair dry-run before trusting latest memory:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/memory/repair-discord-buckets" \
  -d '{"from_date":"YYYY-MM-DD","to_date":"YYYY-MM-DD","dry_run":true}'
```

If the dry-run looks correct, execute the repair and rebuild derived outputs:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Prism-Api-Key: $PRISM_API_OPS_KEY" \
  "$PRISM_MEMORY_BASE_URL/ops/memory/repair-discord-buckets" \
  -d '{"from_date":"YYYY-MM-DD","to_date":"YYYY-MM-DD","dry_run":false,"rebuild":true}'
```

The repair reclassifies raw Discord memory windows using saved channel metadata
and force-rebuilds affected digests, rolling memory, and seeds. It keeps
append-only ingest and activity history intact. Files reported as
`split_required` need manual follow-up because one raw window maps to more than
one target bucket.

When reporting back, include:

- the categories inspected
- the final bucket mapping
- dry-run counts for reclassified, unmapped, and split-required files
- whether rebuild ran and whether any stage failed

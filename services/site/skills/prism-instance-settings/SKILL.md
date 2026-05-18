---
name: prism-instance-settings
description: Use this skill when Codex is asked to view or update Prism instance settings such as platform branding, logo, title, workspace label, site content, or source adapter access policy.
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

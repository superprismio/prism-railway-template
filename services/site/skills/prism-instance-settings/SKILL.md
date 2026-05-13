---
name: prism-instance-settings
description: Use this skill when Codex is asked to view or update Prism instance settings such as platform branding, logo, title, workspace label, or site content.
---

Use this skill for instance-level Prism settings owned by the site service.

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

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
2. For a supported provider, use the deterministic preset endpoint instead of
reconstructing driver configuration:

```http
POST /agent/gateway/integrations
```

```json
{
  "preset": "plausible",
  "label": "Plausible Analytics",
  "origin": "https://plausible.example.org"
}
```

This idempotent call returns existing configuration when the standard
capability already exists. Otherwise it creates a pending connection, disabled
capability, input schema, and default runtime grant.

3. For providers without a preset, create a pending connection with
`POST /agent/gateway/connections`:

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

4. Create non-secret capability configuration with
`POST /agent/gateway/capabilities`. Chat-created capabilities are disabled by
default. Include `enabled: true` only when binding to a connection that already
has a tested credential. Site creates the default runtime grant automatically.
5. Stop and ask the admin to use the credential link. Do not repeatedly test a
pending connection with no credential.
6. After the admin confirms, test representative non-destructive input with
`POST /agent/gateway/capabilities/<key>/test` and body `{"input": {...}}`.
7. On success, enable it with
`PATCH /agent/gateway/capabilities/<key>` and body `{"enabled": true}`.

Report the capability key, connection label, test result, and follow-up needed.
Do not claim setup succeeded before the test passes.

## Bind Skills And Workflows

After enabling a capability, identify the skill that owns the provider
operation and use `prism-skill-author` or `prism-skill-source-author` to declare
the key in its `SKILL.md` frontmatter:

```yaml
gateway-capabilities:
  - plausible.stats.query
```

Workflows inherit these requirements through `agentConfig.skills`, and tasks
inherit them through `instructionConfig.requestedSkills`. Do not duplicate the
capability list in each caller. Keep a direct
`agentConfig.gatewayCapabilities` entry only when the workflow step invokes the
capability without an owning skill.

Run Prism Doctor after binding the skill and before removing any legacy runtime
credential. Exercise every enabled workflow, task, hook, and interactive path
that uses the integration; Gateway configuration alone is not proof that the
migration is complete.

## Plausible Preset

Always use the `plausible` integration preset. It owns the v2 endpoint,
allowlists, input schema, bearer mapping, timeout, and response limit. Supply
only the instance HTTPS origin and optional label. Do not recreate the preset
through the generic capability route.

## Safety

- Credential create, replace, and revoke remain admin-session operations in
  Settings.
- Never send credentials through `/agent/*`.
- Use only approved constrained drivers; never proxy arbitrary URLs or headers.
- Keep capabilities disabled until their connection test succeeds.
- Treat downstream `4xx` as input, authentication, or configuration evidence.
- Keep working direct integrations until Gateway migration is explicitly tested.

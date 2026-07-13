---
name: prism-gateway-author
description: Use this skill when an admin asks to connect, configure, test, enable, disable, inspect, or troubleshoot an organization integration, Gateway toolset profile, or narrow compatibility capability. It covers chat-driven non-secret configuration and secure credential handoff through Settings.
---

Use the Site agent API for Gateway authoring. Never ask the user to paste API
keys, tokens, passwords, private keys, or other credentials into chat. Do not
place credentials in capability configuration, artifacts, logs, or output.

Authenticate with `x-service-token: $PRISM_AGENT_SERVICE_TOKEN`.

## Architecture Rule

For broad integrations, create one credential-backed toolset profile such as
`portal.admin` or `crm.admin` and preserve the provider's OpenAPI or MCP tool
surface. Do not create one Gateway capability per collection, route, or tool.

Create broad profiles with `POST /agent/gateway/toolsets`. Agent-created
profiles remain disabled until an admin supplies the credential and validates
the binding. The profile accepts a canonical HTTPS description URL and a
non-secret authentication mapping, for example:

```json
{
  "key": "portal.admin",
  "connectionId": "<connection-id>",
  "protocol": "openapi",
  "discoveryUrl": "https://portal.example.org/openapi.json",
  "auth": { "type": "bearer", "secretName": "token" },
  "description": "Portal administrator identity"
}
```

For Payload identities that use email/password login, bind both encrypted
connection fields without exposing the resulting JWT:

```json
"auth": {
  "type": "payload-login",
  "emailSecretName": "email",
  "passwordSecretName": "password",
  "loginPath": "/api/users/login"
}
```

Do not compensate for missing provider documentation by rebuilding the API as
dozens of compatibility capabilities. The assigned agent can inspect the
canonical document and use flexible same-origin requests.

Use fixed-origin HTTP toolsets when a provider has no useful OpenAPI or MCP
document. Plausible and Arcade are normal examples: create one profile per
credential and destination origin, then let the assigned agent select paths and
request bodies. Do not model their routes as separate capabilities.

## Inspect

Use `GET /agent/gateway` to read the redacted catalog, connections,
toolsets, legacy capabilities, grants, and recent audit. Stored credential values are never
returned.

Imported credentials are independent from connections. Use
`GET /agent/gateway/credentials` to list their names and metadata. To attach
stored credentials to a connection without handling plaintext, call:

```http
PUT /agent/gateway/connections/<connection-id>/credentials/from-store
```

```json
{
  "bindings": {
    "apiToken": "INSTANCE_API_TOKEN"
  }
}
```

The keys are connection-local secret names used by the toolset authentication
recipe; the values are stored credential names. Never ask the admin to re-enter
an already stored credential.

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

This idempotent call returns existing configuration when the standard toolset
already exists. Otherwise it creates or reuses a pending connection and creates
a disabled fixed-origin HTTP toolset.

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

If a suitable credential already exists in `GET /agent/gateway/credentials`,
bind it through the value-free route above. Otherwise, the response includes
`credentialUrl` and `credentialPath`; give the admin that link and say the
credential must be entered in Settings. Never offer to accept it in chat.

For an existing connection, construct the same stable Settings path from its
redacted catalog record:

```text
/admin?tab=settings&settings=gateway&connection=<connection-id>&action=credential&secretName=<secret-name>
```

Use the connection's existing `secretNames[0]` when present; otherwise use the
secret name required by the toolset authentication mapping.

4. Create non-secret profile configuration with
`POST /agent/gateway/toolsets`. Chat-created toolsets are disabled by default.
5. Stop and ask the admin to use the credential link. Do not repeatedly test a
pending connection with no credential.
6. After the admin confirms, enable the toolset in Settings and exercise a
representative non-destructive request through an assigned runtime job.

Report the toolset key, connection label, test result, and follow-up needed.
Do not claim setup succeeded before the test passes.

## Bind Skills And Workflows

For an instance-owned deterministic job, identify the skill that owns the
provider operation and use `prism-skill-author` to declare the profile in its
`SKILL.md` frontmatter:

```yaml
metadata:
  gateway-toolsets:
    - plausible.analytics
```

Workflows inherit these requirements through `agentConfig.skills`, and tasks
inherit them through `instructionConfig.requestedSkills`. Do not duplicate the
toolset list in each caller. A direct `agentConfig.gatewayToolsets` entry is
acceptable when a deterministic task or workflow has no owning skill.

Run Prism Doctor after binding the skill and before removing any legacy runtime
credential. Exercise every enabled workflow, task, hook, and interactive path
that uses the integration; Gateway configuration alone is not proof that the
migration is complete.

Do not add Gateway metadata to generic or source-managed skills just
to make interactive access work. Site policy assigns enabled profiles to Admin
Console and full-access source contexts. Use metadata only for instance-owned
deterministic jobs that must declare a hard dependency.

## Plausible Preset

Always use the `plausible` integration preset. It creates the
`plausible.analytics` fixed-origin HTTP toolset and bearer mapping. Supply only
the instance HTTPS origin and optional label.

## Legacy Compatibility

`POST /agent/gateway/capabilities` and `metadata.gateway-capabilities` remain
available only for existing narrow wrappers during migration. Do not create a
new capability when an HTTP, OpenAPI, MCP, or adapter toolset can preserve the
provider surface. These controls are under Advanced in Settings.

## Safety

- Credential create, replace, and revoke remain admin-session operations in
  Settings.
- Never send credentials through `/agent/*`.
- Keep each connection credential bound to its destination origin; runtime
  input must never override either.
- Keep capabilities disabled until their connection test succeeds.
- Treat downstream `4xx` as input, authentication, or configuration evidence.
- Keep working direct integrations until Gateway migration is explicitly tested.

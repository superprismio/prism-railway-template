---
name: prism-interaction-author
description: Create, update, inspect, or disable Prism external HTTP interaction interfaces and their persona/access profiles. Use when an operator asks for an API chat path, docs or Portal assistant, interface persona, Runtime routing, rate limit, allowed workflow list, or inbound interface credential setup.
---

# Prism Interaction Author

Configure non-secret interaction profiles and external interfaces through the
Site agent API. Keep new interfaces disabled until an operator generates the
inbound credential in Settings and explicitly enables the path.

## Rules

1. Create the interaction profile before the interface that references it.
2. Default to `readonly` for contextual assistance. Use `run-approved` only
   when the operator supplies an explicit workflow allowlist, and report that
   deterministic allowlist enforcement is not wired yet.
3. Use `full` only when the operator explicitly asks for a trusted interface.
   Explain that it receives the same normal trusted-run credential access as a
   full-access Discord or Telegram source context.
4. Keep persona instructions concise and treat them as behavior, not authority.
5. Use a restricted Runtime profile when one exists. Do not claim the current
   Runtime is a hard public sandbox merely because the profile says readonly.
6. Do not promise knowledge-source or bucket enforcement until a context broker
   or scoped Memory authorization is configured.
7. Never ask for, accept, print, or send the inbound interface credential
   through chat or `/agent/*`.
8. Direct the operator to **Settings > Interfaces** to generate, rotate, revoke,
   or copy the credential. The plaintext value is shown once.
9. API-key interfaces are server-to-server and should be called from the
   application's backend. Do not propose browser-direct or CORS authentication
   as part of this feature.
10. Do not change Discord or Telegram policy when creating an external HTTP
    interface.

## Create A Profile

```http
POST /agent/interaction-profiles
```

Example:

```json
{
  "key": "public-docs",
  "name": "Public Documentation Guide",
  "mode": "readonly",
  "runtimeProfileKey": "public-context-chat",
  "persona": {
    "name": "Prism Docs Guide",
    "instructions": "Answer from approved documentation context. Be concise and do not speculate about private workspace state."
  },
  "allowedWorkflows": [],
  "rateLimit": {
    "windowSeconds": 60,
    "maxRequests": 10
  }
}
```

Omit `runtimeProfileKey` to use the Site default. Verify a named Runtime profile
exists with `GET /agent/runtime-profiles` before referencing it.

## Create An Interface

```http
POST /agent/external-interfaces
```

Example:

```json
{
  "key": "docs-assistant",
  "name": "Documentation Assistant",
  "enabled": false,
  "interactionProfileKey": "public-docs",
  "allowedOrigins": ["https://docs.example.org"]
}
```

`allowedOrigins` optionally checks an Origin header supplied by an application
backend. It is not browser authentication and most server-to-server clients do
not need to send an Origin header.
The public adapter paths are:

```text
POST /interactions/docs-assistant/sessions
POST /interactions/docs-assistant/sessions/:sessionId/messages
```

## Manage Configuration

```http
GET    /agent/interaction-profiles
GET    /agent/interaction-profiles/:key
PATCH  /agent/interaction-profiles/:key
DELETE /agent/interaction-profiles/:key

GET    /agent/external-interfaces
GET    /agent/external-interfaces/:key
PATCH  /agent/external-interfaces/:key
DELETE /agent/external-interfaces/:key
GET    /agent/external-interfaces/events
```

Profile updates increment a version. Existing external sessions reset their
Runtime continuation on the next message when the resolved profile version
changes.

Use `x-service-token` with `PRISM_AGENT_SERVICE_TOKEN`; fall back to
`APP_API_SERVICE_TOKEN` only when the Prism name is unavailable. Never call the
browser `/admin/*` routes with a service token.

## Handoff

After saving a disabled interface, report:

- profile key, mode, persona, Runtime profile, and workflow allowlist;
- interface key and public path;
- allowed origins;
- disabled state;
- the Settings URL `/admin?tab=settings&settings=interfaces`;
- that the operator must generate the credential there and then enable the
  interface;
- any missing Runtime or unenforced Memory-scope requirement.

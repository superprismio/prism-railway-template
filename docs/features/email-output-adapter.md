# Email Adapter

Status: future feature spec

## Purpose

Prism should be able to send and receive email through a controlled adapter
surface. The first provider target is SendGrid because adjacent RaidGuild
systems already use it for Portal and CRM email.

Email should follow the existing communication adapter boundary: transport
services own delivery and provider credentials, while the site service owns
Prism content, requests, workflows, artifacts, and audit records.

## Design Principles

- Keep SendGrid credentials out of Codex Runtime.
- Require explicit operator intent before sending external email.
- Make sent and received email auditable.
- Prefer plain text in the first slice.
- Treat email addresses as external destinations, not Prism user identities by
  default.
- Preserve provenance for inbound messages and attachments.
- Avoid using email as an unrestricted agent control surface.

## Outbound Email

The first outbound implementation should extend the communication adapter with
an `email` adapter type.

### Capabilities

`GET /capabilities` should include email when configured:

```json
{
  "adapters": ["discord", "telegram", "email"],
  "capabilities": ["list-destinations", "send-message", "fetch-attachment"],
  "destinationTypes": [
    "discord-channel",
    "discord-forum",
    "telegram-chat",
    "telegram-channel",
    "email-address"
  ]
}
```

### Message Send Contract

Use the existing adapter delivery route:

```http
POST /messages
```

Request:

```json
{
  "adapter": "email",
  "destinationId": "person@example.com",
  "subject": "Follow up from Prism",
  "content": "Plain text email body."
}
```

Response:

```json
{
  "ok": true,
  "result": {
    "adapter": "email",
    "destinationId": "person@example.com",
    "provider": "sendgrid",
    "providerMessageId": "..."
  }
}
```

### Environment

Set these on `communication-adapter`:

```text
SENDGRID_API_KEY=...
EMAIL_FROM_ADDRESS=agent@example.org
EMAIL_FROM_NAME=Prism
EMAIL_REPLY_TO=support@example.org
EMAIL_ALLOWED_DOMAINS=example.org,raidguild.org
```

`EMAIL_ALLOWED_DOMAINS` should be optional. When set, the adapter should reject
recipients outside the configured domains unless a later policy explicitly
allows external recipients.

### Safety

Outbound email should require clear operator intent and enough fields to avoid
guessing:

- recipient
- subject
- body
- sender identity, when multiple senders are configured

Discord-origin requests should respect source adapter policy. High-risk sends,
bulk sends, external recipients, or messages that look like announcements should
route through a Prism request or workflow gate instead of sending immediately.

## Inbound Email

SendGrid also supports inbound email through its Inbound Parse Webhook. This can
let Prism receive email without polling an inbox.

### Flow

```text
email to: prism+request@example.org
        -> SendGrid Inbound Parse
        -> POST /webhooks/sendgrid/inbound
        -> Prism routes the message to memory, a request, or an agent session
```

### DNS And Provider Setup

Inbound parse requires a receiving hostname such as:

```text
agent.example.org
```

The domain owner configures MX records for that hostname to point at SendGrid.
SendGrid then posts parsed email payloads to Prism's public webhook endpoint.

### Webhook Endpoint

Add a public site route:

```http
POST /webhooks/sendgrid/inbound
```

The route should:

1. Authenticate or validate the webhook request.
2. Parse sender, recipient, subject, text body, HTML body, headers, and
   attachment metadata.
3. Apply routing rules based on recipient address.
4. Store the normalized inbound email as a durable artifact or inbox item.
5. Trigger an optional workflow only when configured.

The route should not directly execute arbitrary agent instructions from email.
Inbound email is an intake source first.

### Address Routing

Initial routing can be deterministic:

- `memory@agent.example.org`: write a Memory inbox item.
- `request@agent.example.org`: create a Prism request.
- `request+52@agent.example.org`: attach an email artifact to request `52`.
- `session+<id>@agent.example.org`: append an agent session message when that
  session exists and policy allows it.

Unknown recipients should be stored in a quarantine or rejected with a clear
provider response.

### Attachments

Inbound email can include attachments. First slice behavior should match the
source attachment handoff model:

- Store attachment metadata by default.
- Store small text-like attachments as request artifacts or Memory inbox
  source material when routing requires it.
- Store binary attachments as private request artifacts.
- Enforce size and count limits.
- Preserve filename, content type, size, sender, recipient, message id, and
  received timestamp.

SendGrid inbound parse has provider-side message size limits, so Prism should
still enforce its own stricter limits before writing artifacts.

### Security And Abuse Controls

Inbound email must assume untrusted senders:

- Validate webhook authenticity where possible.
- Restrict accepted recipient addresses.
- Rate limit by sender, domain, and route.
- Quarantine suspicious or oversized messages.
- Sanitize HTML before display.
- Avoid auto-running workflows from public sender input unless the route is
  explicitly trusted.
- Redact secrets before posting email-derived content back to public channels.

### Audit Trail

Every outbound send and inbound receive should record:

- provider
- provider message id when available
- normalized destination or recipient
- sender
- subject
- Prism actor or triggering source
- associated request, workflow, task run, or agent session
- delivery or ingestion status
- error message, if failed

## Task Runner Delivery

Scheduled tasks should be able to use email destinations through the existing
`outputConfig.outputDestinations` model:

```json
{
  "outputDestinations": [
    {
      "adapter": "email",
      "type": "email-address",
      "id": "email:person@example.com",
      "label": "person@example.com",
      "subject": "Weekly Prism brief"
    }
  ]
}
```

Task-runner should deliver only the selected human-readable output text, not raw
debug JSON, unless explicitly configured.

## Non-Goals For First Slice

- Bulk marketing email.
- Newsletter subscription management.
- HTML template authoring UI.
- Attachments on outbound email.
- CRM or Portal contact search.
- Automatic response loops.
- Letting public inbound email directly control tools or workflows.

## Later Work

- Contact lookup from CRM or Portal.
- Named email destinations in `/destinations`.
- HTML rendering with reviewed templates.
- Workflow gates for approval, edit, and send.
- Inbound email threading and reply tracking.
- Per-domain and per-recipient policy.
- Bounce, spam report, and unsubscribe event ingestion.
- Request external refs for provider message ids and thread ids.

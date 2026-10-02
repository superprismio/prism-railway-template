---
name: prism-discord-events
description: List, inspect, create, update, or cancel native Discord scheduled events through Prism's communication adapter. Use when an authorized full-access operator asks to manage Discord events.
---

# Discord scheduled events

Use the communication adapter. Its bot credential stays inside the adapter; never request or reveal the Discord bot token. This skill requires a full-access context with `adapter.manage_discord_events` and these environment variables:

- `COMMUNICATION_ADAPTER_BASE_URL`
- `COMMUNICATION_ADAPTER_TOKEN`

If the variables or capability are absent, report the missing configuration. All calls use `X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN`.

First list current events to identify an existing event and avoid duplicates:

```bash
curl -fsSL -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/discord/events"
```

Inspect one event with `GET /discord/events/:eventId`. The adapter is scoped to its configured Discord guild and returns each event's direct Discord URL.

For an external event, provide `name`, `startTime`, `endTime`, and `location`; `description` is optional. Both timestamps must be ISO 8601 with a timezone. Put a relevant Portal or meeting URL in the description or location when requested. For a voice or stage event, provide `entityType` (`voice` or `stage`) and a matching `channelId`; `endTime` is optional. External events use `entityType: "external"` (default) and cannot include a channel ID.

```bash
curl -fsSL -X POST -H "content-type: application/json" \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/discord/events" \
  -d '{"name":"Guild session","startTime":"2026-11-05T16:30:00Z","endTime":"2026-11-05T17:15:00Z","location":"https://example.org/meeting","description":"Session details: https://example.org/session"}'
```

The create response has `created: false` and the existing event if an event with the same name, time, type, and location or channel already exists. Report the returned event URL. Do not create another event merely because the first call timed out; list and compare first.

To change fields, `PATCH /discord/events/:eventId` with the same field names. To cancel, `POST /discord/events/:eventId/cancel` with no body. Inspect the existing event and confirm its identity before update or cancellation. Do not cancel unrelated events.

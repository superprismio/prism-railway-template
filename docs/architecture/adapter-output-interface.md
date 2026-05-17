# Adapter Output Interface

Prism adapters can expose a small internal delivery interface so agent-authored tasks can resolve output destinations without task-runner knowing source-specific details.

## Auth

Adapter delivery routes require the adapter token:

```bash
X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN
```

If Codex Runtime agents should call the adapter directly, wire these env vars into `codex-runtime`:

```text
COMMUNICATION_ADAPTER_BASE_URL=http://${{discord-adapter.RAILWAY_PRIVATE_DOMAIN}}:${{discord-adapter.PORT}}
COMMUNICATION_ADAPTER_TOKEN=${{discord-adapter.SOURCE_ADAPTER_TOKEN}}
```

Scheduled tasks should usually store resolved destinations in `outputConfig.outputDestinations` and let `task-runner` deliver the returned content. Direct adapter calls are for explicit one-off sends or agent workflows that need to post immediately.

## Routes

### `GET /capabilities`

Returns adapter capabilities and supported destination types.

```json
{
  "ok": true,
  "adapter": "discord",
  "capabilities": ["list-destinations", "send-message"],
  "destinationTypes": ["discord-channel"],
  "routes": {
    "destinations": "/destinations",
    "messages": "/messages"
  }
}
```

### `GET /destinations`

Returns known destinations the adapter can address.

Example:

```bash
curl -fsSL \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/destinations"
```

```json
{
  "ok": true,
  "adapter": "discord",
  "destinations": [
    {
      "adapter": "discord",
      "id": "1234567890",
      "type": "discord-channel",
      "name": "updates",
      "label": "#updates"
    }
  ]
}
```

### `POST /messages`

Sends a text message to a resolved destination.

Example:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "X-Adapter-Token: $COMMUNICATION_ADAPTER_TOKEN" \
  "$COMMUNICATION_ADAPTER_BASE_URL/messages" \
  -d '{"destinationId":"1234567890","content":"Test message"}'
```

```json
{
  "destinationId": "1234567890",
  "content": "Daily brief..."
}
```

Response:

```json
{
  "ok": true,
  "result": {
    "adapter": "discord",
    "destinationId": "1234567890",
    "messageCount": 1,
    "messages": [{ "id": "9876543210", "channelId": "1234567890" }]
  }
}
```

## Task Output Config

Chat-assisted task creation should resolve human labels like `#updates` once, then store the resolved destination on the task.

```json
{
  "summary": true,
  "outputDestinations": [
    {
      "adapter": "discord",
      "type": "discord-channel",
      "id": "1234567890",
      "label": "#updates"
    }
  ]
}
```

At scheduled run time, Codex returns the content. The task-runner delivers that content to each configured destination and records delivery results in the task run output snapshot.

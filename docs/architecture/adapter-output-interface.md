# Adapter Output Interface

Prism adapters can expose a small internal delivery interface so agent-authored tasks can resolve output destinations without task-runner knowing source-specific details.

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

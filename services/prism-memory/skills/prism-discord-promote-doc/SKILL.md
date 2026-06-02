---
name: prism-discord-promote-doc
description: Promote a Discord channel or thread discussion into a Prism Memory knowledge inbox document with a shareable artifact link.
---

# Prism Discord Promote Doc

Use this skill when an operator wants to turn the current Discord discussion into
a reusable Prism Memory document.

## Preferred Path

Use the Discord slash command when available:

```text
/prism-promote-doc title:"Document Title"
```

The source adapter will:

1. read recent messages from the current Discord channel or thread
2. ask Codex Runtime to draft clean Markdown when available
3. fall back to a transcript-style Markdown document if needed
4. write the result to `POST /knowledge/inbox`
5. reply with the Prism artifact link and future knowledge-view slug

## Manual API Fallback

If the slash command is unavailable but the agent has Prism Memory write access,
use `prism-api-writer` and write to `POST /knowledge/inbox`.

Use metadata like:

```json
{
  "title": "Fireside Host Script",
  "slug": "fireside-host-script",
  "kind": "guide",
  "summary": "Discord-promoted draft from a follow-up discussion.",
  "tags": ["memory", "workflow"],
  "owners": ["operator-name"],
  "status": "draft",
  "audience": "internal",
  "stability": "evolving",
  "updated": "2026-06-02T00:00:00Z",
  "entities": [],
  "related_docs": [],
  "triaged_at": "2026-06-02T00:00:00Z",
  "source_system": "discord",
  "source_type": "promoted_doc",
  "source_id": "discord-channel-or-thread-id",
  "external_refs": [
    {
      "system": "discord",
      "type": "thread",
      "id": "discord-thread-id",
      "url": "https://discord.com/channels/...",
      "relationship": "source"
    }
  ]
}
```

## Rules

- Do not attach the document to Portal as part of this workflow; Portal
  attachment is a separate operation.
- Do not write directly to canonical knowledge docs from Discord.
- Keep promoted docs in `status: "draft"` unless the operator explicitly asks
  for a stricter reviewed/published flow.
- Preserve Discord source references so later reviewers can inspect provenance.

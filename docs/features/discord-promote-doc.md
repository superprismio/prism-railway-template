# Discord Promote Doc

Status: first slice in progress

## Purpose

Operators need a low-friction way to turn a useful Discord discussion into a
shareable Prism Memory document. A common case is a meeting that identifies a
follow-up artifact, such as a fireside chat host script, followed by a Discord
thread where the agent and humans work out the actual draft. When the draft is
good enough, the operator should be able to promote the current Discord context
into Prism Memory and copy a stable link into another system such as Portal.

Portal attachment is a separate operation. This feature creates the Prism
artifact and returns the link; Portal can attach that link later.

## Command Shape

Use a dedicated Discord slash command:

```text
/prism-promote-doc title:"Fireside Host Script"
```

The command should run in the current Discord channel or thread. The title is
optional in later slices, but the first slice can require it to avoid accidental
generic document names.

Avoid nested slash command shapes such as `/prism promote-doc ...`; previous
parameter parsing was less reliable, and the source adapter already uses
top-level commands such as `/prism-chat`, `/prism-record`, and
`/prism-continue-cr`.

## First Slice

- Register `/prism-promote-doc`.
- Gather recent messages from the current Discord channel or thread.
- Ask Codex Runtime to turn that context into clean Markdown when available.
- Fall back to a deterministic transcript-style Markdown document if Codex
  Runtime is unavailable.
- Write the result to Prism Memory `POST /knowledge/inbox`.
- Include metadata with Discord source refs, source channel/thread ids, source
  message ids, author, owners, tags, and triage fields.
- Reply in Discord with the generated knowledge slug and human-readable Prism
  Memory link.

The first slice writes to the knowledge inbox rather than directly to canonical
knowledge docs. This keeps review/promotion policy in Prism Memory and avoids a
Discord command silently publishing canonical content.

## Metadata

The generated knowledge inbox entry should include:

- `title`
- `slug`
- `kind`: usually `guide`
- `summary`
- `tags`: use allowed Prism Knowledge tags such as `memory` and `workflow`
- `owners`: include the Discord user display name when available
- `status`: `draft`
- `audience`: `internal`
- `stability`: `evolving`
- `updated`
- `entities`
- `related_docs`
- `triaged_at`
- `source_system`: `discord`
- `source_type`: `promoted_doc`
- `source_id`: channel or thread id
- `external_refs`: Discord channel/thread/message URLs

## Deferred

- Portal session attachment.
- Message range selection.
- Reply-to-message promotion.
- Operator review UI for pending promoted docs.
- Automatic knowledge promotion/index run after inbox write.
- Cross-linking promoted docs to generated objectives and throughlines.

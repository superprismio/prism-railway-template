# Custom Source Strategy

This note captures the current direction for community-specific external sources such as DAO proposals.

## Boundaries

Adapters are for chat and transport surfaces:

- Discord
- Slack
- Telegram
- WhatsApp

Adapters own bot identity, channel traversal, message posting, voice/session behavior, and destination discovery. Discord message collection belongs in the Discord/source adapter because it uses Discord-specific permissions and channel APIs.

Materializers are for canonical non-chat data sources that should become durable knowledge:

- DAOhaus proposals
- Snapshot proposals
- forums
- Notion exports
- custom community APIs

Materializers turn source-specific API data into markdown files. They should live close to Prism Memory and Prism Knowledge, not in chat adapters.

## Direction 1: Skill-Based Watcher

This is the first experiment because it is the smallest useful slice.

Flow:

```text
scheduled codex-prompt task
  -> use an instance-authored source skill/script
  -> call the remote API
  -> compare against local state
  -> write latest checkpoint/markdown
  -> return a run summary or announcement text
```

Example instance files may live in the Codex runtime volume during experimentation:

```text
/data/workspaces/proposal-watch/
  daohaus-proposals.skill.md
  daohaus_latest.py
  state.json
  latest.md
```

Use this when:

- the community wants a quick proof of concept
- the source is still being explored
- only latest/new item detection is needed
- the output can be verified from task run history before enabling announcements

Tradeoffs:

- simple to author through Codex chat
- can keep a small local checkpoint
- not yet a durable Prism Knowledge archive
- not ideal for long-term retrieval unless later promoted

## Direction 2: Materialized Knowledge Source

This is the platform direction when the source should become durable, searchable knowledge.

Flow:

```text
external API
  -> materializer sync
  -> local markdown source in Prism Memory volume
  -> knowledge source sync
  -> Prism Knowledge docs/search
  -> announcement task
  -> chat adapter output
  -> normal chat collection brings the announcement into Memory
```

Prism Memory volume layout:

```text
/data/prism_seed/community/
  materializers/
    daohaus-proposals/
      collect.py
      config.json
      README.md
  materialized/
    daohaus-proposals/
      proposals/
        2026/
          proposal-x.md
  state/
    materializers/
      daohaus-proposals.json
```

Materializer sync responsibilities:

- fetch the external API
- normalize records
- de-dupe by external id, updated timestamp, or content hash
- render markdown/frontmatter
- maintain source-specific state/checkpoints
- report created, updated, unchanged, and failed counts

Knowledge sync responsibilities:

- read markdown from the registered source
- validate metadata
- project docs into Prism Knowledge
- rebuild indexes
- emit knowledge source history/events
- make docs searchable

For GitHub sources, knowledge sync checks remote commit heads and pulls markdown. For local materialized sources, knowledge sync should check local file hashes or a source manifest.

## Knowledge Events

Knowledge events are still useful regardless of which source strategy is used.

Any knowledge-lane ingestion that changes the KB should emit compact events:

- GitHub source sync
- local/materialized source sync
- knowledge inbox promotion
- future import/API sources

Example event:

```json
{
  "type": "knowledge_doc_added",
  "source_id": "daohaus-proposals",
  "doc_slug": "sources/daohaus-proposals/proposals/2026/proposal-x",
  "title": "Proposal X",
  "kind": "proposal",
  "url": "/knowledge/view/sources/daohaus-proposals/proposals/2026/proposal-x",
  "summary": "New DAOhaus proposal submitted.",
  "changed_at": "2026-05-01T18:30:00Z"
}
```

Memory latest can then include a small `knowledge_events` section so reports mention newly indexed durable knowledge without copying full document bodies into memory.

## Current Preference

Start with the skill-based watcher for DAO proposal notification experiments.

Keep the materialized knowledge source path as the longer-term design for durable proposal archives, retrieval, and cross-community reusable source patterns.

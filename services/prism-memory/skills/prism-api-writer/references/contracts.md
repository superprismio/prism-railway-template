# Ingest Contracts

Memory inbox example:

```json
{
  "source": "codex-agent",
  "ts": "2026-04-15T18:00:00Z",
  "type": "summary",
  "content": "Key decisions from the guild ops sync...",
  "bucket_hint": "guildhq",
  "author": "codex",
  "participants": ["alice", "bob"],
  "participant_count": 2
}
```

Knowledge inbox example:

```json
{
  "filename": "ops-playbook.md",
  "content": "# Ops Playbook\n\nBody...",
  "metadata": {
    "title": "Ops Playbook",
    "slug": "ops-playbook",
    "kind": "guide",
    "summary": "How to run core guild ops.",
    "tags": ["operations", "workflow"],
    "owners": ["ops-team"],
    "status": "active",
    "audience": "internal",
    "stability": "evolving",
    "updated": "2026-04-15T18:00:00Z",
    "entities": [],
    "related_docs": [],
    "triaged_at": "2026-04-15T18:00:00Z"
  }
}
```

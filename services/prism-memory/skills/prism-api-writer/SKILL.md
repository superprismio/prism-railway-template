---
name: prism-api-writer
description: Write to the Prism Memory API using a write-scoped API key. Use when an agent is allowed to submit memory inbox items or knowledge inbox documents, but should not directly run pipeline ops unless separately authorized.
---

# Prism API Writer

Use this skill only with a write-capable Prism Memory API key.

This skill is for structured writes into Prism Memory. It does not own indexing, digesting, or promotion logic.

## Required auth

Send:

```text
X-Prism-Api-Key: <write-key>
```

Do not assume the key can run ops endpoints.

## Write endpoints

- Memory inbox:
  `POST /memory/inbox`
- Knowledge inbox:
  `POST /knowledge/inbox`

## Memory inbox contract

Required:

- `source`
- `ts`
- `type`
- `content`

Optional:

- `bucket`
- `bucket_hint`
- `author`
- `url`
- `participants`
- `participant_count`

Use memory inbox for:

- conversation summaries
- notable decisions or action items extracted by an agent
- meeting summaries that should remain memory artifacts rather than canonical docs

## Knowledge inbox contract

Send:

- `filename`
- `content`
- `metadata`

Metadata minimum:

- `title`
- `slug`
- `kind`
- `summary`
- `tags`
- `owners`
- `status`
- `audience`
- `stability`
- `updated`
- `entities`
- `related_docs`
- `triaged_at`

## Artifact mappings

Use these defaults unless the deployed corpus has a stronger convention:

- reusable workflow or playbook: `kind: "guide"`
- mandatory or governance workflow: `kind: "policy"`
- reusable template: `kind: "reference"`

## Safety

- Do not call `/ops/*` from this skill.
- Do not overwrite canonical docs directly.
- If `/knowledge/inbox` rejects metadata, fix the metadata rather than weakening validation.

## References

- Load [references/contracts.md](references/contracts.md) for payload examples.
- Load [references/metadata.md](references/metadata.md) for metadata shaping rules.

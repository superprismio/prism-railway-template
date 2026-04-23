---
name: prism-knowledge-sources
description: Register and sync repo-backed knowledge sources in Prism Memory. Use when a user wants a public or private Git repo such as a handbook, docs site, or policy repo added to Prism Knowledge for retrieval, or when an existing source should be updated or re-synced.
---

# Prism Knowledge Sources

Use this skill when the task is about repo-backed knowledge, not manual docs.

## Required auth

Send:

```text
X-Prism-Api-Key: <write-key>
```

Use a write-capable Prism Memory key. Do not assume it can run `/ops/*`.

## Source model

- Repo-backed docs must use `knowledge/sources`
- Manual or agent-authored standalone docs use `knowledge/inbox`
- Do not ingest Git repo files directly into `knowledge/inbox`

## Default workflow

1. Inspect the repo before writing anything.
2. Detect likely docs roots.
3. Check existing sources first with `GET /knowledge/sources`.
4. If the same repo and branch already exist, reuse that source.
5. Only create a new source when no matching source exists.
6. After create or update, trigger `POST /knowledge/sources/{source-id}/sync`.
7. Report the chosen docs roots, branch, and source id back to the user.

## Current source rules

- only `github` sources are supported
- only `markdown-only` content policy is supported
- sync indexes only `.md` and `.mdx`
- prefer docs roots such as `docs`, `content`, `pages`, or docs-style `app` trees
- do not include app code, components, tests, or build output

## Duplicate avoidance

Before creating a source:

- list sources
- match on normalized `repo_url + branch`
- if a source exists, use `PATCH` only when config must change
- then sync the existing source

The API also rejects duplicate `repo_url + branch`. Treat that as a signal to fetch and reuse the existing source rather than trying a fallback path.

## Public vs private repos

- Public repos do not need a GitHub token for Prism sync
- Private repos need repo access configured for Prism before sync can succeed
- Missing repo auth is not a reason to fall back to `knowledge/inbox`

## Good defaults

When creating a source, prefer:

- `content_policy: "markdown-only"`
- `default_kind: "reference"` for handbook/docs repos
- `default_tags: ["knowledge", "general"]` if allowed by the deployed config
- `sync_mode: "manual"` unless the deployed system says otherwise

## Endpoints

- `GET /knowledge/sources`
- `POST /knowledge/sources`
- `GET /knowledge/sources/{source-id}`
- `PATCH /knowledge/sources/{source-id}`
- `POST /knowledge/sources/{source-id}/sync`

## References

- Load [references/workflow.md](references/workflow.md) for the decision tree and examples.

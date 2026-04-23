# Workflow

Use this decision tree:

1. Is the content coming from a Git repo that should be re-synced later?
   - yes: use `knowledge/sources`
   - no: consider `knowledge/inbox`

2. Before creating a source:
   - inspect the repo
   - detect likely docs roots
   - call `GET /knowledge/sources`
   - look for the same normalized `repo_url + branch`

3. If a matching source exists:
   - reuse it
   - `PATCH` only if docs roots or defaults need adjustment
   - `POST /knowledge/sources/{source-id}/sync`

4. If no matching source exists:
   - create it with `POST /knowledge/sources`
   - then sync it

## Example create

```json
{
  "repo_url": "https://github.com/org/handbook",
  "branch": "main",
  "label": "Community Handbook",
  "content_policy": "markdown-only",
  "docs_roots": ["docs"],
  "default_kind": "reference",
  "default_tags": ["knowledge", "general"],
  "sync_mode": "manual",
  "managed_by": "agent"
}
```

## Example user-facing response

```text
Registered handbook source `community-handbook` for `https://github.com/org/handbook` on `main`.
Indexed markdown docs under `docs`.
Prism Knowledge search remains unchanged; the new content is now available through the existing knowledge query endpoints.
```

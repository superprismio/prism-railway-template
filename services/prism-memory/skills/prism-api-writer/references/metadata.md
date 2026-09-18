# Metadata Rules

- `slug` should be stable and filesystem-safe.
- `kind` should match the document type, not the source channel.
- reusable workflows should usually be `guide`; normative workflow rules may be `policy`.
- reusable templates should usually be `reference`.
- `summary` should be concise and factual.
- `tags` must come from the deployed config.
- `triaged_at` should be ISO-8601 UTC.
- keep `related_docs` empty rather than inventing weak links.
- avoid ingesting reusable workflows or templates as `note`.
- Preserve source-supplied `objective_keys` and `throughline_keys` as legacy
  metadata when present; do not infer new registry keys.
- Preserve structured meeting `action_items`, participants, topics, and dates
  supplied by upstream synthesis. These are source assertions, not automatically
  verified assignments or generated objectives. Normal memory processing does
  not build the retired registry.

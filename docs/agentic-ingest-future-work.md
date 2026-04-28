# Agentic Ingest Future Work

This is the follow-up list after the first optional Prism Memory agentic ingest slice.

## Done in current slice

- optional OpenAI-compatible enrichment hook in Prism Memory
- default mode `off`
- `bot_only`, `scoped`, and `all` config plumbing
- derived `agentic_ingest` metadata on inbox-derived records
- default digest exclusion when `memory_include_default=false`
- optional env and template variable docs

## Next work

1. Add a review surface for classified records
- inspect derived `interaction_kind`
- inspect `memory_include_default`
- inspect `adoption_signal`

2. Add explicit promotion workflow
- manual promotion of assistant interactions into memory
- manual promotion into knowledge candidates

3. Add structured community policy config
- priority channels
- deprioritized channels
- priority topics
- deprioritized topics
- short custom guidance field

4. Improve classifier schema
- decision extraction
- action item extraction
- stronger adoption detection
- confidence score

5. Add selective memory-state handling
- exclude from digest but keep in searchable archive
- separate assistant-interaction reporting lane

6. Add tests
- config loading
- scope matching
- provider response parsing
- digest exclusion behavior

7. Add ops visibility
- activity log summaries for classifier usage
- recent classification counts by kind
- provider failure counts

8. Validate provider interoperability
- codex-runtime default
- direct OpenAI-compatible provider swap

9. Decide long-term routing
- keep enrichment in inbox collector
- or move it to a dedicated post-collector memory step

10. Revisit broader scopes
- keep `bot_only` as the practical first rollout
- treat `scoped` and `all` as experimental until live quality is proven

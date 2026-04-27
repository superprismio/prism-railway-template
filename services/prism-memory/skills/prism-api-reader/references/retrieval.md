# Retrieval Rules

For knowledge answers:

1. Search first.
2. Read the top matching docs.
3. Answer from returned document content and metadata.
4. Include supporting document references as Prism human-readable `doc_url` links whenever available.
5. Do not present raw slugs, storage paths, or `/knowledge/docs/{slug}` API paths as the primary citation format in chat replies.
6. If a `source_url` exists and helps the user, include it as a secondary link after the Prism doc link.

For workflow retrieval:

1. Search for the request domain plus workflow-like terms.
2. Prefer canonical `guide` or `policy` docs when they match.
3. Compare multiple candidates when scope is ambiguous.
4. Choose the best fit based on scope, freshness, and ownership clarity.
5. If no exact workflow exists, say that directly and synthesize from the nearest docs.

For template retrieval:

1. Search for the content type plus template-like terms.
2. Prefer canonical `reference` docs when they match.
3. Compare candidates by audience, channel, tone, and structure.
4. If no exact template exists, adapt the closest one and note the adaptation.

For memory answers:

1. Prefer digests for day-scoped activity.
2. Use rolling memory for compact narrative state.
3. Use participant queries for who-was-active questions.

For artifact answers:

1. Use the human-readable Prism route `/artifacts/{artifact-id}` for shareable links.
2. Use `/api/artifacts/{artifact-id}` only to inspect the structured payload.
3. Use `/api/artifacts/{artifact-id}/raw` only when the user asks for the raw payload specifically.
4. Prefer full absolute URLs when the Prism base URL is known.

When confidence is limited:

- name the empty or missing endpoint result
- state the exact date window or filters used
- avoid implying data exists when the API returned none
- do not improvise endpoint shapes

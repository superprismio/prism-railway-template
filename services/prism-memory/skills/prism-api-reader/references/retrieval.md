# Retrieval Rules

For knowledge answers:

1. Search first.
2. Read the top matching docs.
3. Answer from returned document content and metadata.
4. Include the exact document slug or path used.

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

When confidence is limited:

- name the empty or missing endpoint result
- state the exact date window or filters used
- avoid implying data exists when the API returned none

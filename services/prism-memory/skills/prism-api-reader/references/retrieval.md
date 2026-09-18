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

## Opt-in scoped meeting retrieval

Use this path only when the caller has a configured scoped retrieval tool. Do not
fall back to broad Memory credentials after a scoped denial. Knowledge-only questions
continue through the existing knowledge reader; the meeting catalog has no knowledge
repository coverage.

Plan the request before searching:

1. For “last meeting”, list meetings within the authorized scope, then fetch the
   selected meeting. Use occurrence time, not import time. Ask which meeting series
   only if the scope and conversation do not disambiguate it.
2. For a question about meeting content, extract 2–6 distinctive topic/entity terms
   (for example “Livepeer funding execution”), set `kind=meeting_summary`, and use
   explicit participant/date selectors only when supported by the question. Resolve
   relative dates using the user's timezone and the reference date; do not invent dates.
3. Send focused terms with `query_mode=literal`. If passing a whole question, use
   `query_mode=question`; its transparent lexical plan is a fallback, not semantic
   interpretation. It cannot infer commitments, resolve aliases, or translate dates.
4. For a change across meetings, search each requested period separately. Retrieve
   bounded revision context for each selected passage and compare dated evidence.
   Do not assume one top-ten list covers both periods.
5. If results miss the topic, try one alternate focused query before expanding the
   source kind to retained transcripts. Preserve caller scope throughout. Describe
   coverage gaps rather than treating an empty result as proof nothing happened.
6. Check the entire cited context before asserting ownership or a decision. A proposal
   is not an accepted decision; a person mentioned nearby is not necessarily the owner.
   Keep record ID, revision, passage ID and generation together for context requests.
7. For scoped results, do not construct links to broad `/artifacts/*` endpoints. Return
   the scoped evidence references supported by the caller. On a generation conflict,
   repeat retrieval rather than silently swapping the cited revision.

# Synthesize

Read the request context and the `hook-payload.json` artifact. The payload should
contain a completed recording transcript from browser capture, Discord-native
recording, uploaded media, or another source adapter.

Use the transcript and metadata to create durable request artifacts. Prefer
source facts from the payload over assumptions.

## Required Outputs

Create `meeting-summary.md` with kind `meeting-summary`.

Use this structure:

- title
- source/session metadata
- TL;DR
- summary
- decisions
- action items
- open questions
- notable quotes
- source artifacts and links

Create `meeting-summary.json` with kind `meeting-summary-json`.

Use this schema:

```json
{
  "title": "descriptive title",
  "tldr": "short summary",
  "summary": "detailed summary",
  "decisions": ["decision"],
  "actionItems": [
    {
      "name": "string",
      "description": "string",
      "assignedTo": "string or null",
      "dueDate": "YYYY-MM-DD or null",
      "params": {}
    }
  ],
  "openQuestions": ["question"],
  "notableQuotes": [
    {
      "author": "string",
      "quote": "string",
      "paraphrase": "string"
    }
  ],
  "tags": ["tag-1", "tag-2", "tag-3"],
  "source": {
    "kind": "browser-capture or discord-native or other",
    "sessionId": "string or null",
    "startedAt": "ISO timestamp or null",
    "endedAt": "ISO timestamp or null"
  }
}
```

Create `memory-ingest-plan.json` with kind `memory-ingest-plan`.

Default to review-gated memory ingest:

```json
{
  "mode": "review",
  "recommendedArtifacts": ["meeting-summary.md"],
  "avoidIngesting": ["raw private transcript unless explicitly approved"],
  "rationale": "short rationale"
}
```

Create `portal-publish-plan.json` with kind `portal-publish-plan` when the
payload includes Portal/session intent or links. Otherwise create
`downstream-plan.json` with kind `downstream-plan` and include:

- whether Portal publishing is recommended
- whether external notification is recommended
- which transcript or summary artifacts should be shared
- what should remain private

## Rules

- Do not invent attendees, owners, decisions, links, or quotes.
- Browser capture usually has weak speaker identity. Use `Speaker 1`, `Speaker 2`,
  or `Unknown` unless the payload gives confirmed names.
- If a summary is already present in the payload, treat it as a draft. Correct it
  only with transcript evidence.
- Do not publish to Prism Memory, Portal, Discord, Telegram, or email directly in
  this default workflow.
- If the transcript is missing, empty, or unsafe to summarize, create
  `recording-synthesis-blocked.md` explaining the blocker and finish with a clear
  blocked summary.
- Otherwise finish with a concise summary of the artifacts created and the
  recommended next action.

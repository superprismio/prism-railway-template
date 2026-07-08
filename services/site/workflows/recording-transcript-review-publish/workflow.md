# Recording Transcript Review Publish

This workflow handles completed recording transcripts from browser capture,
Discord-native recording, uploaded media, or future source adapters.

The default flow is automated:

- read the hook payload artifact
- synthesize the transcript into durable meeting artifacts
- promote the meeting summary to Prism Memory when the Memory write path is configured
- resolve or prepare Portal session publishing from the recording context
- prepare delivery artifacts or plans
- close without an operator gate

The recorder service owns capture and transcription. This workflow owns meeting
meaning, summary shape, and downstream publishing. Do not publish raw private
transcripts directly unless the payload or workspace policy explicitly says that
automatic publication is allowed.

## Portal Session Contract

When the payload includes Discord scheduled event metadata, Portal session links,
or workspace-specific Portal instructions, use that context to resolve the target
Portal session. Prefer attaching to an existing matching session. If the payload
or workspace policy allows automatic creation and no match exists, create the
Portal session and attach the durable summary artifacts. If Portal credentials,
tools, or target context are missing, create a `portal-publish-plan.json`
artifact that explains the intended match/create action.

This workflow should support instance-specific Portal behavior through payload
metadata and operator-editable workflow instructions. Do not hard-code a single
community's Portal session rules into the adapter.

## Memory Contract

Promote `meeting-summary.md` to Prism Memory by default with source provenance,
participants, timestamps, tags, action items, and links back to request artifacts.
Do not promote the raw transcript by default. If Memory credentials are missing
or the write fails, save `memory-ingest-plan.json` or `memory-ingest-error.json`
so the request still contains the proposed Memory record.

## Default Summary Contract

Use the Prism recording summary schema:

- `title`
- `tldr`
- `summary`
- `actionItems`
- `notableQuotes`
- `tags`

If the hook payload already includes a summary object, use it as the starting
point and improve only when the transcript clearly supports the change.

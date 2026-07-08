# Recording Transcript Review Publish

This workflow handles completed recording transcripts from browser capture,
Discord-native recording, uploaded media, or future source adapters.

The default flow is automated:

- read the hook payload artifact
- synthesize the transcript into durable meeting artifacts
- prepare memory, Portal, and delivery plans
- close without an operator gate

The recorder service owns capture and transcription. This workflow owns meeting
meaning, summary shape, and downstream publishing plans. Do not publish private
meeting content directly unless the payload or workspace policy explicitly says
that automatic publication is allowed.

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

# Browser Media Capture And Ingest

Status: future feature spec

## Purpose

Prism currently has platform-specific recording and transcription paths, most
notably Discord voice recording and adapter-owned transcription/summary logic.
That works when the source platform is Discord and the adapter can preserve
speaker/channel metadata, but it does not generalize cleanly to Zoom, Google
Meet, Microsoft Teams, browser tabs, livestreams, uploaded media, or future
Portal session recordings.

Add a Prism-owned browser capture and media-ingest flow that can record
operator-selected browser media, store the recording as durable artifacts, and
run a shared transcription, diarization, summary, review, and memory-ingest
workflow.

## Core Idea

Create an operator-facing Capture surface in Prism Site:

```text
Admin opens Prism Site /capture
        |
        v
browser records tab/screen audio, mic, optional video
        |
        v
site stores recording + metadata as request artifacts
        |
        v
media-ingest workflow transcribes, summarizes, reviews, and routes output
        |
        +-- Prism Memory
        +-- request artifacts
        +-- Portal session/resource publishing
        +-- Discord/Telegram delivery when approved
```

The browser recorder should be one capture source. The same media-ingest
workflow should also handle Discord recorder output, uploaded audio/video files,
Telegram voice notes, or future meeting bot recordings.

## Non-Goals

- Do not replace the Discord recorder immediately. It still has better native
  Discord metadata when recording Discord voice.
- Do not make Portal own raw private meeting recordings in the first slice.
- Do not build a headless Zoom/Meet/Teams bot for the first slice.
- Do not move platform credentials or recording policy into the communication
  adapter.
- Do not auto-ingest raw transcripts into long-term memory without review unless
  the workspace policy explicitly allows it.

## UI Placement

Add a top-level Prism Site nav item:

```text
Requests | Prism Console | Capture | Tasks | Skills | Workflows | Hooks | Settings
```

Capture is an operator action surface, not a settings page. It should be
available when a meeting or browser session is happening, even before there is a
request to attach to.

The page should support two entry modes:

- standalone capture: record first, then create a media-ingest request
- attach to request: select an existing request and attach the recording

Initial page shape:

```text
Capture

Source
- tab/screen audio
- microphone
- optional screen video

Attach
- no request yet
- existing request selector

Metadata
- title
- source platform
- session date
- operator notes

[Start Capture]
```

After stopping:

```text
Recording saved
- recording.webm
- capture-metadata.json
- operator-notes.md

[Create media-ingest request]
[Attach to existing request]
[Start transcription]
```

## Browser Capture Model

The first browser implementation should use native browser APIs:

- `navigator.mediaDevices.getDisplayMedia()` for operator-selected tab, window,
  or screen capture, including tab/system audio where the browser/OS allows it.
- `navigator.mediaDevices.getUserMedia()` for microphone capture.
- Web Audio API to mix tab/system audio and microphone audio when both are
  enabled.
- `MediaRecorder` to write chunks or a final `.webm` recording.

Browser capture requires an interactive user gesture and browser permission
picker. A Discord slash command cannot start it directly.

The browser flow should prefer chunked upload if recordings may exceed normal
request body limits.

## Slash Commands And Remote Triggers

Slash commands can orchestrate capture, but they cannot perform browser capture.

Example:

```text
/capture start title:"Weekly sync"
```

The command can:

- create a Prism request
- create a pending capture record
- reply with a private/admin link to `/capture?request=<id>`
- remind the admin that browser permission is required

The admin still opens Prism Site and starts recording manually.

## Headless Browser And Meeting Bots

A hosted headless browser is not the first-choice solution for Zoom, Meet, or
Teams recording. It usually requires platform login, meeting access, audio device
plumbing, waiting-room handling, browser permission workarounds, and
platform-specific reliability work.

If hands-off meeting capture becomes important, treat it as a separate meeting
bot integration:

```text
Prism meeting bot joins meeting
records media
uploads artifact
triggers media-ingest workflow
```

That should be evaluated per platform after browser capture and the shared
media-ingest contract are stable.

## Responsibility Split

### Prism Site

Owns:

- `/capture` UI
- capture session records
- upload endpoints
- request artifact creation
- hook/workflow kickoff
- review and operator controls
- settings for enablement, limits, and workflow keys

### Communication Adapter / Source Adapter

Owns:

- platform-specific event and message transport
- fetching attachments or voice output when explicitly requested
- sending approved messages back to Discord, Telegram, or email
- backward-compatible legacy recorder integration during migration

Adapters should not own transcript meaning, summary prompts, memory routing, or
public/private publication policy.

### Prism Workflows

Own:

- transcription
- optional diarization
- speaker-label reconciliation
- summary generation
- public/private safety review
- memory ingest decisions
- Portal publish handoff
- output delivery requests

### Prism Memory

Owns durable memory and knowledge outputs after review:

- transcript artifacts when approved
- summaries
- session notes
- extracted topics, decisions, follow-ups, and links

### Portal

Portal should consume approved outputs, not own raw capture in the first slice:

- public session pages
- event resources
- edited recap pages
- transcript excerpts
- approved audio/video embeds

Portal can later include a "Record session" button that deep-links into Prism
Capture or calls Prism capture APIs behind the scenes.

## Media-Ingest Workflow

Create a reusable workflow, tentatively `media-ingest`, that accepts an audio or
video artifact and produces durable downstream artifacts.

Inputs:

- recording artifact id
- capture metadata
- source platform and source ids when available
- optional request id
- operator notes
- memory/Portal/publishing intent

Artifacts:

- `recording.webm` or source media file
- `capture-metadata.json`
- `operator-notes.md`
- `transcript.json`
- `transcript.md`
- `diarization.json` when available
- `speaker-map.json` when operator reconciles labels
- `summary.md`
- `summary.json`
- `memory-ingest-plan.json`
- optional `portal-publish-plan.json`

Flow:

```text
capture-upload
  -> transcribe
  -> diarize optional
  -> summarize
  -> review
  -> memory-ingest / portal-publish / delivery
```

The review gate should decide whether raw transcript, cleaned transcript,
summary, or none of the output goes to Prism Memory or Portal.

## Speaker Metadata

Browser capture will usually not preserve reliable speaker identity. The first
slice should handle this explicitly:

- store source metadata when available
- run diarization when configured
- label speakers as `Speaker 1`, `Speaker 2`, etc. by default
- allow operator reconciliation after transcription
- do not claim named speakers unless the source provided identity or an operator
  confirmed the mapping

Discord-native recording can continue to preserve richer Discord session
metadata when available.

## Settings

Start with env-backed settings:

```text
PRISM_CAPTURE_ENABLED=true
PRISM_CAPTURE_MAX_BYTES=...
PRISM_CAPTURE_MAX_DURATION_SECONDS=...
PRISM_CAPTURE_WORKFLOW_KEY=media-ingest
PRISM_CAPTURE_ALLOWED_MODES=tab-audio,mic,screen-video
PRISM_CAPTURE_DEFAULT_MEMORY_MODE=review
```

Later add a Settings UI panel for:

- enable/disable browser capture
- max upload size and max duration
- default media-ingest workflow key
- default artifact retention policy
- allowed capture modes
- transcription provider defaults
- diarization enabled/disabled
- memory ingest behavior: never, review first, auto-ingest summaries
- consent/disclaimer text shown before recording
- optional Portal publish defaults

## Consent And Safety

The Capture UI should make recording state obvious:

- visible recording timer
- clear source labels
- explicit stop button
- pre-recording consent/disclaimer text
- artifact visibility and retention note

For public or community-facing outputs, route through the existing public-output
safety and publishing workflows before sending or publishing.

## First Slice

1. Add `/capture` page behind admin session.
2. Record tab/screen audio plus microphone with native browser APIs.
3. Upload final `.webm` to Site as a request artifact.
4. Save `capture-metadata.json` and `operator-notes.md`.
5. Create or attach to a request.
6. Trigger `media-ingest` workflow manually.
7. Produce transcript and summary artifacts.
8. Review before Prism Memory or Portal publication.

## Migration From Adapter-Owned Transcription

Keep existing adapter-owned transcription/summary behavior during migration.
Mark it as legacy once `media-ingest` can process the same audio artifacts.

Target migration:

1. Adapter captures or fetches audio bytes.
2. Adapter hands bytes or source URL to Site.
3. Site stores request artifact and kicks off `media-ingest`.
4. Workflow produces transcript/summary/review artifacts.
5. Adapter only delivers approved outputs back to source platforms.

This creates one shared pattern for Discord recorder output, browser captures,
uploaded files, Telegram voice notes, and future Portal session recordings.

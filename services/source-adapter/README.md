# Source Adapter Service

Generic source-ingestion adapter for Prism memory.

Runtime note:

- voice capture is currently validated on `@discordjs/voice` `0.19.x`, which requires a Node 22 runtime for deployment parity
- Discord voice recording is validated locally and on Railway using volume-backed Ogg capture, `ffmpeg` FLAC conversion, Whisper-compatible voice transcription, Codex runtime summaries, and Prism Memory inbox writes

Deploy this directory separately for each upstream source you want to ingest:

- `discord-adapter`
- `slack-adapter`
- `telegram-adapter`

This service should own source-specific collection and normalization, then post normalized batches into `prism-memory`.

Current behavior:

- `GET /health` for service health and config visibility
- `POST /sync` runs a Discord REST sync and posts a normalized batch to `prism-memory`
- `GET /capabilities`, `GET /destinations`, and `POST /messages` expose the adapter output interface for agent-authored task delivery
- optional live Discord mention/thread chat forwarding to `codex-runtime`
- slash commands can now route into the same Discord session/Codex path as mentions
- Discord sync keeps message text, Discord embed summary text, and text-like attachment body text for small `.md`/`.txt`/similar files
- sync checkpoints are persisted under `SOURCE_ADAPTER_DATA_ROOT`
- `POST /sync?dry_run=true` collects and summarizes without posting or advancing checkpoints
- `POST /sync?reset_checkpoint=true` ignores the saved cursor and re-runs the full configured window
- `GET /destinations` lists Discord text channels as output destinations
- `POST /messages` sends text to a resolved Discord channel id; requires `X-Adapter-Token` when `SOURCE_ADAPTER_TOKEN` is configured
- `POST /recordings/:sessionId/recover` finalizes a known unfinished recording session from the volume; requires `X-Adapter-Token`
- this service is now being consolidated onto a TypeScript/`discord.js` runtime so Discord-facing code can absorb voice and meeting commands later without a Python split

Recommended envs:

- `SOURCE_KIND=discord`
- `SOURCE_SPACE=community`
- `SOURCE_SYNC_MODE=manual`
- `PRISM_API_BASE=https://your-prism-memory.up.railway.app`
- `PRISM_ARTIFACT_PUBLIC_BASE_URL=https://your-prism-memory.up.railway.app`
- `PRISM_API_KEY=...`
- `PRISM_INGEST_PATH=/ingest/messages`
- `SOURCE_ADAPTER_DATA_ROOT=./services/source-adapter/data`
- `SOURCE_CHECKPOINT_OVERLAP_MINUTES=5`

Discord-specific envs you can add later:

- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID`
- `DISCORD_CHAT_ENABLED=true`
- `DISCORD_REGISTER_COMMANDS=true`
- `DISCORD_COMMAND_GUILD_ID=<optional guild for fast command registration during dev>`
- `DISCORD_APPLICATION_ID=<optional explicit app id>`
- `DISCORD_SYNC_WINDOW_HOURS=24`
- `DISCORD_MAX_MESSAGES_PER_CHANNEL=200`
- `DISCORD_INCLUDE_ARCHIVED_THREADS=false`
- `DISCORD_IGNORE_BOT_MESSAGES=false`
- `DISCORD_ATTACHMENT_TEXT_ENABLED=true`
- `DISCORD_EMBED_TEXT_ENABLED=true`
- `DISCORD_ATTACHMENT_TEXT_MAX_BYTES=200000`
- `DISCORD_ATTACHMENT_TEXT_MAX_CHARS=12000`
- `DISCORD_ATTACHMENT_TEXT_MAX_FILES_PER_MESSAGE=3`
- `SOURCE_ADAPTER_PUBLIC_BASE_URL=https://your-discord-adapter.up.railway.app`
- `VOICE_FFMPEG_SEGMENT_SECONDS=180`
- `VOICE_CHAT_MAX_MESSAGES=200`
- `VOICE_CHAT_IGNORE_BOT_MESSAGES=true`
- `VOICE_DAVE_ENCRYPTION=true`
- `VOICE_RECORDING_WARNING_MINUTES=50`
- `VOICE_RECORDING_MAX_MINUTES=60`
- `VOICE_TRANSCRIPTION_BASE_URL=https://api.venice.ai/api/v1/audio/transcriptions`
- `VOICE_TRANSCRIPTION_API_KEY=...`
- `VOICE_TRANSCRIPTION_MODEL=nvidia/parakeet-tdt-0.6b-v3`
- `VOICE_TRANSCRIPTION_LANGUAGE=en`
- `VOICE_TRANSCRIPTION_RESPONSE_FORMAT=json`
- `VOICE_TRANSCRIPTION_TIMESTAMPS=true`
- `N8N_WEBHOOK_URL=https://your-n8n.example/webhook/transcribe` only if the legacy webhook handoff is still needed

Chat bridge envs:

- `APP_API_BASE_URL=https://your-api.up.railway.app`
- `APP_API_SERVICE_TOKEN=...`
- `CODEX_RUNTIME_BASE_URL=https://your-codex-runtime.up.railway.app`

Notes:

- keep source-specific auth and traversal logic here, not inside `prism-memory`
- keep shared model/runtime behavior in `codex-runtime`, not in this adapter
- deploy multiple copies of this same directory if you want one adapter service per source
- the current implementation is Discord-only and uses `discord.js` plus the Discord HTTP API; Slack and Telegram can follow the same normalized ingest contract later
- the stored checkpoint is a sync cursor, not a per-channel high-water mark; the overlap window reduces the chance of missing late-arriving reads across runs
- the adapter does not crawl pasted links; it only preserves the embed text Discord already provides (`title`, `description`, `url`)

Current slash commands:

- `/prism-ping`
- `/prism-health`
- `/prism-chat prompt:<text>`
- `/prism-start-cr`
- `/prism-continue-cr id:<number>`
- `/prism-join`
- `/prism-record`
- `/prism-stoprecord`
- `/prism-rollcall`

Current voice command status:

- `/prism-join` joins the caller's current voice channel
- `/prism-record` starts a volume-backed recording session under `/data/recordings/<session-id>/raw`
- `/prism-record` eagerly subscribes to current non-bot channel participants, then uses Discord speaking events as a backup for continued capture
- `/prism-stoprecord` stops the session, runs `ffmpeg`, and writes FLAC chunks under `/data/recordings/<session-id>/flac`
- `/prism-rollcall` inspects the active/current voice channel and lists non-bot participants
- if `VOICE_TRANSCRIPTION_API_KEY` is set, `/prism-stoprecord` sends FLAC chunks to the configured Whisper-compatible transcription endpoint and writes transcript artifacts under `/data/recordings/<session-id>/transcript`
- recordings warn at `VOICE_RECORDING_WARNING_MINUTES` and stop automatically at `VOICE_RECORDING_MAX_MINUTES`; set `VOICE_RECORDING_MAX_MINUTES=0` to disable the automatic stop
- `/prism-stoprecord` also fetches messages posted in the Discord voice channel during the recording window and stitches them into the merged transcript timeline as `chat` segments
- if the adapter restarts during recording, `/prism-stoprecord` can recover the newest unfinished session for the guild from `/data/recordings/<session-id>/session.json` and `/raw/*.ogg`
- if `CODEX_RUNTIME_BASE_URL` is set, the adapter asks codex-runtime to synthesize a meeting summary from the merged transcript
- local summary generation also requires `CODEX_RUNTIME_BASE_URL` in the sourced local env, otherwise transcription can succeed while summary generation is skipped
- if `PRISM_API_BASE` and `PRISM_API_KEY` are set, transcript and summary artifacts are written into Prism memory inbox as `meeting_transcript` and `meeting_summary`
- Discord should only receive a short completion notice; the durable transcript/summary artifacts live in Prism memory or the local volume
- if `N8N_WEBHOOK_URL` is set, the adapter POSTs meeting metadata to `n8n` after stop
- FLAC chunks can be fetched from `GET /recordings/:sessionId/:fileName` with `X-Adapter-Token`

## Local voice development

Use the full local stack when testing voice summaries:

```bash
npm run dev:all
```

`scripts/dev-all.sh` starts `codex-runtime` on `3030` and passes `CODEX_RUNTIME_BASE_URL=http://127.0.0.1:3030` to `source-adapter`. Local Codex auth should use your normal `~/.codex` home unless you intentionally override `CODEX_HOME`.

For a smaller manual test, start `codex-runtime` first:

```bash
CODEX_HOME="$HOME/.codex" PORT=3030 npm run dev --workspace @prism-railway/codex-runtime
```

Then start `source-adapter` with:

```bash
CODEX_RUNTIME_BASE_URL=http://127.0.0.1:3030 npm run dev --workspace @prism-railway/source-adapter
```

Expected success signal after `/prism-record` and `/prism-stoprecord`:

- `Speakers with audio: 1` or higher
- transcript markdown under `data/recordings/<session-id>/transcript/transcript.md`
- summary markdown under `data/recordings/<session-id>/transcript/summary.md`
- Prism Memory inbox paths in the Discord completion message when local `prism-memory` is running

## Railway voice deployment notes

The verified Railway path uses:

- `SOURCE_ADAPTER_DATA_ROOT=/data` with a mounted volume
- `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID`
- `VOICE_TRANSCRIPTION_BASE_URL=https://api.venice.ai/api/v1/audio/transcriptions`
- `VOICE_TRANSCRIPTION_API_KEY`
- `VOICE_TRANSCRIPTION_LANGUAGE=en`
- `VOICE_CHAT_MAX_MESSAGES=200`
- `VOICE_CHAT_IGNORE_BOT_MESSAGES=true`
- `VOICE_DAVE_ENCRYPTION=true`
- `VOICE_RECORDING_WARNING_MINUTES=50`
- `VOICE_RECORDING_MAX_MINUTES=60`
- `CODEX_RUNTIME_BASE_URL=https://codex-runtime-production.up.railway.app` or a verified reachable private URL
- `PRISM_API_BASE=https://prism-memory-production.up.railway.app` or a verified reachable private URL
- `PRISM_ARTIFACT_PUBLIC_BASE_URL=https://prism-memory-production.up.railway.app`
- `PRISM_API_KEY`

If `/prism-stoprecord` reports `Speakers with audio: 0`, check Railway logs for `eager receiver subscribe` and `received first opus chunk`. If voice-channel chat stitching is missing, check for `voice chat transcript messages` or `voice chat transcript skipped` in logs and confirm the bot can read message history in that voice channel. If summary or Prism ingest is skipped, check logs for the detailed fetch cause and verify the runtime/memory service health URLs from outside Railway first.

After changing `DISCORD_BOT_TOKEN` or accidentally exposing it in logs/tool output, rotate the Discord bot token in the Discord developer portal and update Railway before the next deploy.

# Template Variable Reference

Use this while filling out the Railway template composer.

## API

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `4010` | Port the API service listens on. | No |
| `NODE_ENV` | `production` | Runtime environment for the API service. | No |
| `APP_BASE_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` | Public URL for the API service. | No |
| `PRISM_AGENT_DATA_ROOT` | `/data` | Mounted data directory for API runtime state. | No |
| `ADMIN_EMAIL` | `admin@local.agent` | Initial admin account email. | No |
| `ADMIN_PASSWORD` | `${{ secret(32) }}` | Generated initial admin password. | No |
| `SESSION_SECRET` | `${{ secret(64) }}` | Secret used to sign API sessions. | No |
| `INTERNAL_SERVICE_TOKEN` | `${{ secret(64) }}` | Shared token for internal service-to-service API calls. | No |
| `PRISM_MEMORY_BASE_URL` | `http://${{prism-memory.RAILWAY_PRIVATE_DOMAIN}}` | Private URL for Prism Memory. | No |
| `CODEX_RUNTIME_BASE_URL` | `http://${{codex-runtime.RAILWAY_PRIVATE_DOMAIN}}` | Private URL for Codex Runtime. | No |
| `COMMUNITY_PROVIDER` | `discord` | Community adapter provider enabled for this stack. | No |

## Site

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `3100` | Port the site service listens on. | No |
| `NODE_ENV` | `production` | Runtime environment for the site service. | No |
| `NEXT_PUBLIC_API_BASE_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` | Browser-facing API URL used by the site. | No |
| `API_INTERNAL_BASE_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` | Server-side API URL used by the site. | No |

## Prism Memory

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `8788` | Port the Prism Memory service listens on. | No |
| `PRISM_API_KEY` | `${{ secret(64) }}` | API key used to authorize Prism Memory API calls. | No |
| `PRISM_API_DATA_ROOT` | `/data` | Mounted data directory for Prism Memory runtime state. | No |
| `PRISM_API_SPACE` | `raidguild` | Default Prism Memory space slug. | No |

## Discord Adapter

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `8789` | Port the Discord adapter listens on. | No |
| `NODE_ENV` | `production` | Runtime environment for the Discord adapter. | No |
| `SOURCE_KIND` | `discord` | Source provider handled by this adapter. | No |
| `SOURCE_SPACE` | `raidguild` | Prism space this adapter writes into. | No |
| `SOURCE_SYNC_MODE` | `manual` | Sync mode for Discord ingestion. | No |
| `SOURCE_ADAPTER_TOKEN` | `${{ secret(64) }}` | Token used to authorize calls to the adapter. | No |
| `SOURCE_ADAPTER_DATA_ROOT` | `/data` | Mounted data directory for checkpoints and recordings. | No |
| `SOURCE_CHECKPOINT_OVERLAP_MINUTES` | `5` | Minutes of overlap when resuming Discord sync checkpoints. | No |
| `PRISM_API_BASE` | `https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}` | Public URL for Prism Memory ingest calls. | No |
| `PRISM_API_KEY` | `${{prism-memory.PRISM_API_KEY}}` | Prism Memory API key reference. | No |
| `PRISM_INGEST_PATH` | `/ingest/messages` | Prism Memory ingest endpoint path. | No |
| `APP_API_BASE_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}` | Private URL for the API service. | No |
| `INTERNAL_SERVICE_TOKEN` | `${{api.INTERNAL_SERVICE_TOKEN}}` | Internal API service token reference. | No |
| `CODEX_RUNTIME_BASE_URL` | `https://${{codex-runtime.RAILWAY_PUBLIC_DOMAIN}}` | Public URL for Codex Runtime. | No |
| `DISCORD_BOT_TOKEN` | empty | Discord bot token. Required to enable Discord sync/chat. | No |
| `DISCORD_GUILD_ID` | empty | Discord guild ID to sync and serve. Required to enable Discord. | No |
| `DISCORD_APPLICATION_ID` | empty | Discord application ID. Recommended for slash command registration. | Yes |
| `DISCORD_CHAT_ENABLED` | `true` | Enables Discord mention/thread chat bridge. | No |
| `DISCORD_REGISTER_COMMANDS` | `true` | Automatically registers Discord slash commands on startup. | No |
| `DISCORD_SYNC_WINDOW_HOURS` | `24` | Lookback window for Discord sync. | No |
| `DISCORD_MAX_MESSAGES_PER_CHANNEL` | `200` | Maximum messages fetched per channel per sync. | No |
| `DISCORD_INCLUDE_ARCHIVED_THREADS` | `false` | Whether archived threads are included during sync. | No |
| `DISCORD_IGNORE_BOT_MESSAGES` | `false` | Whether bot messages are skipped during sync. | No |
| `DISCORD_ATTACHMENT_TEXT_ENABLED` | `true` | Enables extraction of text-like Discord attachments. | No |
| `DISCORD_EMBED_TEXT_ENABLED` | `true` | Enables preservation of Discord embed text. | No |
| `VOICE_DAVE_ENCRYPTION` | `false` | Enables Discord DAVE voice encryption support when available. | No |
| `VOICE_CHAT_IGNORE_BOT_MESSAGES` | `true` | Skips bot messages when stitching voice channel chat into transcripts. | No |
| `VENICE_API_KEY` | empty | Venice API key for voice transcription. | Yes |
| `CODEX_RUNTIME_REQUEST_TIMEOUT_SECONDS` | `660` | Timeout for adapter calls to Codex Runtime. | No |

## Codex Runtime

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PORT` | `3030` | Port the Codex Runtime service listens on. | No |
| `NODE_ENV` | `production` | Runtime environment for Codex Runtime. | No |
| `CODEX_HOME` | `/data/codex` | Mounted Codex home directory for auth and thread state. | No |
| `CODEX_RUNTIME_TIMEOUT_MS` | `600000` | Maximum Codex execution timeout in milliseconds. | No |
| `CODEX_WORKSPACE_ROOT` | `/app` | Default workspace root for Codex execution. | No |
| `CODEX_TARGET_WORKSPACE_ROOT` | `/data/workspaces` | Mounted directory for cloned target repositories. | No |
| `PRISM_API_BASE` | `http://${{prism-memory.RAILWAY_PRIVATE_DOMAIN}}` | Private URL for Prism Memory. | No |
| `PRISM_API_KEY` | `${{prism-memory.PRISM_API_KEY}}` | Prism Memory API key reference. | No |
| `APP_API_BASE_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}` | Private URL for the API service. | No |
| `APP_API_SERVICE_TOKEN` | `${{api.INTERNAL_SERVICE_TOKEN}}` | Internal API service token reference. | No |
| `TARGET_REPO_GITHUB_TOKEN` | empty | GitHub token for cloning or pushing private target repositories. | Yes |
| `GIT_AUTHOR_NAME` | `Prism Codex` | Git author name used for Codex-created commits. | No |
| `GIT_AUTHOR_EMAIL` | `prism-codex@users.noreply.github.com` | Git author email used for Codex-created commits. | No |

## Discord Sync Cron

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PRISM_API_BASE` | `https://${{discord-adapter.RAILWAY_PUBLIC_DOMAIN}}` | Public URL for the Discord adapter service. | No |
| `PRISM_TRIGGER_BODY` | `{}` | JSON body sent to the Discord sync endpoint. | No |
| `PRISM_TRIGGER_PATH` | `/sync` | Path on the Discord adapter that triggers Discord message sync. | No |
| `PRISM_TRIGGER_DISABLED` | `true` | Keeps Discord sync disabled until Discord credentials are configured. | No |
| `PRISM_TRIGGER_AUTH_TOKEN` | `${{discord-adapter.SOURCE_ADAPTER_TOKEN}}` | Shared token used to authorize cron calls to the Discord adapter. | No |
| `PRISM_TRIGGER_AUTH_HEADER` | `X-Adapter-Token` | Header name used to send the Discord adapter auth token. | No |

## Memory Cron

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PRISM_API_BASE` | `https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}` | Public URL for the Prism Memory service. | No |
| `PRISM_TRIGGER_PATH` | `/ops/memory/run` | Prism Memory endpoint that runs collection, digest, memory, and seeds. | No |
| `PRISM_TRIGGER_AUTH_HEADER` | `X-Prism-Api-Key` | Header name used to send the Prism API key. | No |
| `PRISM_TRIGGER_AUTH_TOKEN` | `${{prism-memory.PRISM_API_KEY}}` | Prism Memory API key reference. | No |
| `PRISM_TRIGGER_BODY` | `{}` | JSON body sent to the memory run endpoint. | No |

## Knowledge Cron

| Variable | Value | Description | Optional? |
| --- | --- | --- | --- |
| `PRISM_API_BASE` | `https://${{prism-memory.RAILWAY_PUBLIC_DOMAIN}}` | Public URL for the Prism Memory service. | No |
| `PRISM_TRIGGER_PATH` | `/ops/knowledge/run` | Prism Memory endpoint that promotes, validates, and indexes knowledge docs. | No |
| `PRISM_TRIGGER_AUTH_HEADER` | `X-Prism-Api-Key` | Header name used to send the Prism API key. | No |
| `PRISM_TRIGGER_AUTH_TOKEN` | `${{prism-memory.PRISM_API_KEY}}` | Prism Memory API key reference. | No |
| `PRISM_TRIGGER_BODY` | `{}` | JSON body sent to the knowledge run endpoint. | No |

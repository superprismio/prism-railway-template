# Prism Memory (Raid Guild)

This repo is the canonical home for two things:

1. **Community-memory pipeline code** (under `superprism_poc/raidguild/code`) that collects Discord activity, produces daily digests, updates rolling memory, and syncs results.
2. **The generated knowledge base** (everything under `superprism_poc/raidguild/{activity,buckets,memory,state}`) so every transcript, digest, memory snapshot, and activity log travels with the code.

## Repository layout

```
superprism_poc/
  raidguild/
    code/                # Python package + README describing the pipeline
    config/              # space + schedule config (`space.json`)
    activity/            # append-only log of collector/digest/memory runs
    state/               # collector watermark (`collector_state.json`)
    buckets/
      <bucket>/
        raw/<date>/      # 20-minute transcript windows (.md + .json)
        digests/         # daily markdown + JSON digests per bucket
    memory/
      rolling/           # rolling memory snapshots + latest pointers
    inbox/
      memory|knowledge/
        incoming/        # shared drop zones per lane
        processed/       # consumed artifacts
        rejected/        # invalid/unusable artifacts

## Agent Ownership Boundaries

- Memory agent scope:
  `superprism_poc/raidguild/{activity,buckets,memory,products,state}` plus
  runbook/config updates needed to keep that pipeline healthy.
- Knowledge agent scope (planned):
  `superprism_poc/raidguild/knowledge/kb/{docs,metadata,indexes,triage,activity,state}`.
- Handoff contract:
  memory agent may emit promotion candidates into
  `superprism_poc/raidguild/knowledge/kb/triage/inbox/` only. Classification,
  canonical placement, and metadata/index generation are out of scope for the
  memory agent.
```

## Running the pipeline

All commands run from the workspace root (`/home/node/clawd/workspace` here):

```bash
# Full run that respects schedule windows
python3 -m community_memory.pipeline run --base superprism_poc --space raidguild

# Targeted steps
python3 -m community_memory.pipeline collect --base superprism_poc --space raidguild
python3 -m community_memory.pipeline digest --base superprism_poc --space raidguild --date YYYY-MM-DD --force
python3 -m community_memory.pipeline memory --base superprism_poc --space raidguild --date YYYY-MM-DD --force
python3 -m community_memory.pipeline seeds --base superprism_poc --space raidguild --date YYYY-MM-DD --force

# Single-call backfill (e.g., grab the last 72 hours in one shot)
python3 -m community_memory.pipeline collect \
  --base superprism_poc --space raidguild \
  --backfill-hours 72

# Knowledge validation/indexing (separate from memory heartbeat)
python3 -m community_knowledge validate --base superprism_poc --space raidguild
python3 -m community_knowledge index --base superprism_poc --space raidguild

# Agent coordination helpers
python3 -m tools.agent_coord status
python3 -m tools.agent_coord acquire --resource repo_write --holder memory-agent --ttl-minutes 120
python3 -m tools.agent_coord release --resource repo_write --holder memory-agent

# Shared control scripts
bash scripts/agent_pause.sh all
bash scripts/agent_unpause_sync.sh memory
bash scripts/memory_start.sh
bash scripts/knowledge_start.sh
```

## Collector Model

`superprism_poc/raidguild/config/space.json` controls which collectors are enabled and their scheduling windows.

The current pipeline only knows how to instantiate these collector keys:

- `discord_latest`
- `latest_meetings`
- `inbox_memory`

It also supports fork-defined collectors through:

- `type: "python"` using `module` + `class_name`
- `type: "command"` using `command`

You can safely customize:

- `enabled`
- `window_minutes`
- `initial_backfill_hours`
- bucket mappings under `discord.category_to_bucket`
- endpoint env vars like `DISCORD_LATEST_URL` and `MEETINGS_LATEST_URL`

If you add another builtin collector key in config without adding code in `community_memory.pipeline`, it will be skipped with:

```text
[warn] unknown collector key '...' in config; skipping
```

Custom collector authoring is documented in `docs/collectors.md` at repo root.

Required environment variables (Discord latest messages collector `discord_latest`):

- `DISCORD_LATEST_URL`
- `DISCORD_LATEST_KEY`
- `SPACE_HEAP_ID`
- `DISCORD_GUILD_ID`

Optional environment variables (latest meetings collector `latest_meetings`):
- `MEETINGS_LATEST_URL`; may point at any HTTP wrapper that returns the payload shape expected by the built-in meetings collector
- `SPACE_HEAP_ID`

GitHub backup/push uses `GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_TOKEN` (already configured in this environment).
The CLI autoloads repo-root `.env` values if present.
Use `.env.example` as a template.

## Canonical Discord Bucket Mapping

`superprism_poc/raidguild/config/space.json` is the source of truth:

- `684227450955235329` → `townsquare`
- `685273857338376246` → `guildhq`
- `1470894727342723082` → `governance`
- `1009434800676946022` → `cohort`
- `1470888731241087128` → `agency`
- `724249951005179915` → `knowledge`

Additional collector bucket:
- `latest_meetings` → `meetings` (configured in `config.space.json.meetings.bucket`)
- `inbox_memory` → bucket from inbox payload `bucket_hint` (default from `config.space.json.inbox.memory.default_bucket`)

## Knowledge Constraints

`superprism_poc/raidguild/config/space.json` now includes a `knowledge` block with
metadata constraints to limit drift:
- `allowed_kinds`
- `allowed_tags`
- `allowed_status`
- `allowed_audiences`
- `allowed_stability`
- per-doc caps (`max_tags_per_doc`, `max_entities_per_doc`, `max_related_docs_per_doc`)
- `require_owner`
- `strict_tag_enforcement`

These are enforced by `community_knowledge validate/index` against sidecar metadata.

Source-of-truth policy:
- `docs/knowledge-source-of-truth.md`

## Knowledge Retrieval Process

When turning a prompt into an answer, follow this retrieval flow:
1. **Parse the intent** into filters: identify the relevant kind(s), tags, entities, timeframe, and audience needed to satisfy the request.
2. **Query the indexes first** – use `knowledge/kb/indexes/manifest.json` plus `tags.json` and `entities.json` to narrow candidates without scanning full docs.
3. **Search the source content** – run `rg`/ripgrep across `knowledge/kb/docs` for exact terms or phrases that surfaced from step 2.
4. **Inspect the best matches** – open the top 3-10 docs, capture verbatim quotes and their file paths/sections.
5. **Synthesize the response** – answer the prompt directly, cite the specific files/sections used, and note confidence.
6. **Surface gaps when needed** – if confidence is low or coverage is incomplete, state what’s missing and propose the exact follow-up query or data needed.

## Multi-Agent Coordination

- Shared lock file: `superprism_poc/raidguild/state/agent_locks.json`
- Shared lock resource: `repo_write`
- Memory heartbeat acquires/releases `repo_write` automatically.
- Knowledge agent should also acquire/release `repo_write` around any write run.
- Shared pause/unpause state: `superprism_poc/raidguild/state/agent_control_state.json`
- Shared intake contract: `superprism_poc/raidguild/inbox/README.md`
- Memory inbox collector reads `inbox/memory/incoming/` and moves handled files to
  `inbox/memory/processed/` or `inbox/memory/rejected/`.
- Canonical role identities: `docs/assistants/README.md`
- Optional ownership guard:
  - `python3 -m tools.agent_coord check-paths --agent memory --files <paths...>`
  - `python3 -m tools.agent_coord check-paths --agent knowledge --files <paths...>`

## Operational notes

- **Cadence:** Check `superprism_poc/raidguild/state/collector_state.json` daily. If `last_until` is >6 hours behind UTC, run the `collect → digest → memory → seeds` chain for the most recent full day, then copy `activity/`, `buckets/`, `memory/`, `products/`, and `state/` into this repo and push to `main`.
- **Backfill:** The collector now supports a forced lookback via `--backfill-hours` and performs a single Discord API call for that span, slicing locally (threads included, archived threads excluded).
- **Digests:** Daily digests now include structured extraction (`*_structured` keys in JSON) for highlights/decisions/actions, with bounded quote evidence and source links.
- **Memory:** Rolling memory consumes structured digests for compact context and digest references that can be expanded on demand.
- **Seeds:** `seeds` now writes both a daily file (`products/suggestions/YYYY-MM-DD.md`) and a weekly file (`products/suggestions/weekly-YYYY-WW.md`).
- **Logging:** Collector, digest, and memory steps emit detailed log lines (window ranges, chunk sizes, file outputs) so it’s easy to spot stalls in the console.
- **Git workflow:** Runtime data lives in `superprism_poc/raidguild/…`. After each run, copy those folders into `prism-memory/superprism_poc/raidguild/`, `git add`, commit with the date range, and `git push origin main` (see commits `ad1e4f9` and `e23c027` for examples).

## Recent changes

- Single-call 72 h backfill option (`--backfill-hours`) with enhanced logging.
- Richer digest output (channel-level quotes + overview) feeding improved rolling memory narratives.
- Daily ops checklist captured in `docs/assistants/*/HEARTBEAT.md` so we remember to collect/push regularly.
- `.env` autoload support for local runs.
- Compact rolling memory with digest references and bounded quote evidence.
- Structured digest extraction for more reliable decision/action detection.
- Daily + weekly product seed files under `products/suggestions/` for newsletter/X/blog drafting.

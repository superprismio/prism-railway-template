#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

project_arg=""
environment_arg="production"
prism_service="prism-memory"
adapter_service="discord-adapter"
space_slug="raidguild"
days=30

usage() {
  cat <<'EOF'
Usage:
  bash scripts/railway-prism-backfill-spotcheck.sh \
    [--project <railway-project-id>] \
    [--environment production] \
    [--prism-service prism-memory] \
    [--adapter-service discord-adapter] \
    [--space raidguild] \
    [--days 30]

What it checks:
  1. Discord adapter checkpoint timestamp
  2. Prism inbox backlog counts
  3. Earliest/latest dates for rolling memory, knowledge digests, and seeds
  4. Missing dates across the last N days for those artifacts
  5. Separates quiet days with no raw inputs from suspicious days with raw inputs but missing derived files

Notes:
  - Uses Railway SSH against the live service volumes
  - Prints JSON so the result is easy to diff or save
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      project_arg="$2"
      shift 2
      ;;
    --environment)
      environment_arg="$2"
      shift 2
      ;;
    --prism-service)
      prism_service="$2"
      shift 2
      ;;
    --adapter-service)
      adapter_service="$2"
      shift 2
      ;;
    --space)
      space_slug="$2"
      shift 2
      ;;
    --days)
      days="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

common_railway_args=(-e "$environment_arg")
if [[ -n "$project_arg" ]]; then
  common_railway_args=(--project "$project_arg" "${common_railway_args[@]}")
fi

adapter_json="$(
  railway ssh "${common_railway_args[@]}" --service "$adapter_service" "python - <<'PY'
import json
from datetime import datetime, timezone
from pathlib import Path

path = Path('/data/checkpoints.json')
payload = {'checkpointFile': str(path), 'exists': path.exists()}
if path.exists():
    data = json.loads(path.read_text())
    first_key = next(iter(data.keys()), None)
    payload['keys'] = list(data.keys())
    payload['checkpoint'] = data.get(first_key) if first_key else None
    cursor = payload['checkpoint'].get('cursorTimestamp') if isinstance(payload.get('checkpoint'), dict) else None
    if cursor:
        candidate = cursor[:-1] + '+00:00' if cursor.endswith('Z') else cursor
        parsed = datetime.fromisoformat(candidate)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        payload['cursorAgeHours'] = round((datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds() / 3600, 2)
print(json.dumps(payload))
PY"
)"

prism_json="$(
  railway ssh "${common_railway_args[@]}" --service "$prism_service" "python - <<'PY'
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

space = Path('/data/superprism_poc') / '${space_slug}'
days = int('${days}')

def collect_dates(directory: Path):
    values = set()
    if not directory.exists():
        return values
    for path in directory.iterdir():
        if not path.is_file():
            continue
        stem = path.stem
        try:
            date.fromisoformat(stem)
        except ValueError:
            continue
        values.add(stem)
    return values

def summarize_dates(values: set[str]):
    ordered = sorted(values)
    return {
        'count': len(ordered),
        'earliest': ordered[0] if ordered else None,
        'latest': ordered[-1] if ordered else None,
        'sampleStart': ordered[:10],
        'sampleEnd': ordered[-10:],
    }

def expected_dates(window_days: int):
    today = datetime.now(UTC).date()
    start = today - timedelta(days=window_days - 1)
    return [(start + timedelta(days=index)).isoformat() for index in range(window_days)]

def collect_raw_dates(buckets_root: Path):
    values = set()
    if not buckets_root.exists():
        return values
    for bucket_dir in buckets_root.iterdir():
        raw_root = bucket_dir / 'raw'
        if not raw_root.exists() or not raw_root.is_dir():
            continue
        for date_dir in raw_root.iterdir():
            if not date_dir.is_dir():
                continue
            try:
                date.fromisoformat(date_dir.name)
            except ValueError:
                continue
            if any(child.is_file() for child in date_dir.iterdir()):
                values.add(date_dir.name)
    return values

def classify_missing(expected_values: list[str], derived_values: set[str], raw_values: set[str]):
    missing = [value for value in expected_values if value not in derived_values]
    return {
        'all': missing,
        'withRawInputs': [value for value in missing if value in raw_values],
        'noRawInputs': [value for value in missing if value not in raw_values],
    }

expected = expected_dates(days)

rolling = collect_dates(space / 'memory' / 'rolling')
knowledge = collect_dates(space / 'buckets' / 'knowledge' / 'digests')
seeds = collect_dates(space / 'products' / 'suggestions')
raw_dates = collect_raw_dates(space / 'buckets')

incoming = space / 'inbox' / 'memory' / 'incoming'
processed = space / 'inbox' / 'memory' / 'processed'
rejected = space / 'inbox' / 'memory' / 'rejected'

collector_state = space / 'state' / 'collector_state.json'
collector_payload = json.loads(collector_state.read_text()) if collector_state.exists() else {}

result = {
    'spaceRoot': str(space),
    'expectedWindowDays': days,
    'expectedStart': expected[0] if expected else None,
    'expectedEnd': expected[-1] if expected else None,
    'inbox': {
        'incoming': sum(1 for path in incoming.iterdir() if path.is_file()) if incoming.exists() else 0,
        'processed': sum(1 for path in processed.iterdir() if path.is_file()) if processed.exists() else 0,
        'rejected': sum(1 for path in rejected.iterdir() if path.is_file()) if rejected.exists() else 0,
    },
    'collectorState': collector_payload,
    'rolling': summarize_dates(rolling),
    'knowledgeDigests': summarize_dates(knowledge),
    'dailySeeds': summarize_dates(seeds),
    'rawInputs': summarize_dates(raw_dates),
    'missing': {
        'rolling': classify_missing(expected, rolling, raw_dates),
        'knowledgeDigests': classify_missing(expected, knowledge, raw_dates),
        'dailySeeds': classify_missing(expected, seeds, raw_dates),
    },
}
print(json.dumps(result))
PY"
)"

python3 - <<PY
import json

def last_json_line(raw: str) -> str:
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if not lines:
        raise SystemExit("Missing JSON output from Railway SSH command")
    return lines[-1]

adapter = json.loads(last_json_line("""${adapter_json}"""))
prism = json.loads(last_json_line("""${prism_json}"""))
print(json.dumps({"adapter": adapter, "prism": prism}, indent=2))
PY

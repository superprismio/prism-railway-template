from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .activity import ActivityLogger
from .config_loader import SpaceConfig
from .utils import ensure_dir, read_json, write_json


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


# Default limits for how much content we keep in the "latest" rolling
# memory state. These can be overridden via space.json (preferred) or
# environment variables (legacy / fallback).
MAX_COUNTS = {
    "open_threads": _env_int("PRISM_MEMORY_MAX_OPEN_THREADS", 10),
    "key_decisions": _env_int("PRISM_MEMORY_MAX_KEY_DECISIONS", 10),
    "action_items": _env_int("PRISM_MEMORY_MAX_ACTION_ITEMS", 10),
    "facts": _env_int("PRISM_MEMORY_MAX_FACTS", 10),
    "upcoming": _env_int("PRISM_MEMORY_MAX_UPCOMING", 5),
}
STALE_MARK_DAYS = _env_int("PRISM_MEMORY_STALE_MARK_DAYS", 2)
STALE_DROP_DAYS = _env_int("PRISM_MEMORY_STALE_DROP_DAYS", 4)

DEFAULT_MAX_COUNTS = dict(MAX_COUNTS)
DEFAULT_STALE_MARK_DAYS = STALE_MARK_DAYS
DEFAULT_STALE_DROP_DAYS = STALE_DROP_DAYS
NARRATIVE_MAX_CHARS = 1200
QUOTE_MAX_CHARS = 240
QUOTE_MAX_PER_ITEM = 2

QUOTE_RE = re.compile(
    r"^\-\s*\[(?P<ts>[^\]]+)\]\s*(?P<author>[^:]+):\s*(?P<body>.*?)(?:\s+\((?P<jump>https?://[^\s)]+)\))?$"
)


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _shorten(text: str, limit: int) -> str:
    text = _clean(text)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _load_digest_bundle(paths: List[Path]) -> Dict[str, Dict[str, List[str]]]:
    bundle: Dict[str, Dict[str, List[str]]] = {}
    for path in paths:
        data = read_json(path, default=None)
        if not data:
            continue
        bucket = path.parent.parent.name  # buckets/<bucket>/digests
        bundle[bucket] = data
    return bundle


def _digest_paths_are_fresh(digest_paths: List[Path], output_paths: List[Path]) -> bool:
    if not output_paths or any(not path.exists() for path in output_paths):
        return False
    if not digest_paths:
        return False
    oldest_output_mtime = min(path.stat().st_mtime for path in output_paths)
    return all(path.stat().st_mtime <= oldest_output_mtime for path in digest_paths)


def _default_sections(max_counts: Dict[str, int]) -> Dict[str, List[Dict[str, Any]]]:
    return {section: [] for section in max_counts}


def _coerce_entry(raw: Any) -> Dict[str, Any] | None:
    if isinstance(raw, dict):
        text = _shorten(str(raw.get("text", "")), 220)
        if not text:
            return None
        entry = dict(raw)
        entry["text"] = text
        entry["bucket"] = str(raw.get("bucket", "unknown"))
        entry["source_digest_path"] = str(raw.get("source_digest_path", ""))
        entry["stale"] = bool(raw.get("stale", False))
        entry["evidence_quotes"] = list(raw.get("evidence_quotes") or [])
        return entry
    if isinstance(raw, str):
        text = _clean(raw)
        if not text:
            return None
        return {
            "text": text,
            "bucket": "unknown",
            "last_seen": None,
            "source_digest_path": "",
            "stale": False,
            "evidence_quotes": [],
        }
    return None


def _load_previous(path: Path, max_counts: Dict[str, int]) -> Dict[str, List[Dict[str, Any]]]:
    if not path.exists():
        return _default_sections(max_counts)
    data = read_json(path, default={})
    raw_sections = data.get("sections", {})
    sections = _default_sections(max_counts)
    for section in max_counts:
        values = raw_sections.get(section, [])
        coerced: List[Dict[str, Any]] = []
        if isinstance(values, list):
            for raw in values:
                item = _coerce_entry(raw)
                if item:
                    coerced.append(item)
        sections[section] = coerced
    return sections


def _carry_forward(
    items: List[Dict[str, Any]],
    today: date,
    *,
    stale_mark_days: int,
    stale_drop_days: int,
) -> List[Dict[str, Any]]:
    kept: List[Dict[str, Any]] = []
    for item in items:
        if not item.get("source_digest_path"):
            continue
        last_seen = item.get("last_seen")
        if not last_seen:
            continue
        days_old = (today - date.fromisoformat(last_seen)).days
        if days_old > stale_drop_days:
            continue
        copied = dict(item)
        copied["stale"] = days_old > stale_mark_days
        kept.append(copied)
    return kept


def _pick_best(first: Dict[str, Any], second: Dict[str, Any]) -> Dict[str, Any]:
    first_date = first.get("last_seen") or ""
    second_date = second.get("last_seen") or ""
    winner = second if second_date >= first_date else first
    loser = first if winner is second else second
    combined = dict(winner)
    combined_quotes = list(combined.get("evidence_quotes") or [])
    for quote in loser.get("evidence_quotes") or []:
        if quote not in combined_quotes:
            combined_quotes.append(quote)
    if combined_quotes:
        combined["evidence_quotes"] = combined_quotes[:QUOTE_MAX_PER_ITEM]
    return combined


def _dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: Dict[str, Dict[str, Any]] = {}
    for item in items:
        key = _clean(item.get("text", ""))
        if not key:
            continue
        if key in seen:
            seen[key] = _pick_best(seen[key], item)
        else:
            seen[key] = item
    return list(seen.values())


def _truncate(items: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    return items[:limit]


def _extract_quote_evidence(entry: str) -> List[Dict[str, str]]:
    quotes: List[Dict[str, str]] = []
    for line in entry.splitlines():
        match = QUOTE_RE.match(line.strip())
        if not match:
            continue
        quotes.append(
            {
                "author": _clean(match.group("author")),
                "timestamp": _clean(match.group("ts")),
                "text": _shorten(match.group("body") or "", QUOTE_MAX_CHARS),
                "jump_url": _clean(match.group("jump") or ""),
            }
        )
        if len(quotes) >= QUOTE_MAX_PER_ITEM:
            break
    return quotes


def _headline(entry: str) -> str:
    for line in entry.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.lower().startswith("topic:"):
            continue
        if line.lower().startswith("time span:"):
            continue
        if line.lower().startswith("key quotes:"):
            continue
        if line.startswith("- ["):
            match = QUOTE_RE.match(line)
            if match:
                body = _clean(match.group("body") or "")
                if body:
                    return _shorten(body, 180)
            continue
        return _shorten(line, 180)
    return _shorten(entry, 180)


def _make_entry(
    raw_entry: str,
    bucket: str,
    today: date,
    source_digest_path: str,
    evidence_quotes: List[Dict[str, str]] | None = None,
) -> Dict[str, Any]:
    return {
        "text": _headline(raw_entry),
        "bucket": bucket,
        "last_seen": today.isoformat(),
        "stale": False,
        "source_digest_path": source_digest_path,
        "evidence_quotes": (evidence_quotes or _extract_quote_evidence(raw_entry))[:2],
    }


def _classify_highlight(entry: str) -> Tuple[bool, bool, bool]:
    lower = entry.lower()
    open_thread = any(
        keyword in lower
        for keyword in ["pending", "awaiting", "need", "blocked", "review", "next step", "help"]
    )
    fact = any(
        keyword in lower
        for keyword in ["launched", "stable", "standing", "live", "baseline", "policy"]
    )
    upcoming = any(
        keyword in lower
        for keyword in [
            "tomorrow",
            "next",
            "due",
            "deadline",
            "upcoming",
            "soon",
            "friday",
            "monday",
        ]
    )
    return open_thread, fact, upcoming


def _build_narrative(sections: Dict[str, List[Dict[str, Any]]]) -> str:
    parts: List[str] = []
    if sections["open_threads"]:
        parts.append(f"Open threads: {len(sections['open_threads'])} active.")
    if sections["key_decisions"]:
        parts.append(f"Decisions tracked: {len(sections['key_decisions'])}.")
    if sections["action_items"]:
        parts.append(f"Action items tracked: {len(sections['action_items'])}.")
    if sections["upcoming"]:
        parts.append(f"Upcoming items: {len(sections['upcoming'])}.")
    if not parts:
        return "Quiet day across tracked buckets."
    return _shorten(" ".join(parts), NARRATIVE_MAX_CHARS)


def _coerce_positive_int(value: Any, *, minimum: int = 1) -> int | None:
    try:
        num = int(value)
    except (TypeError, ValueError):
        return None
    if num < minimum:
        return None
    return num


def _resolve_memory_limits(
    config: SpaceConfig | None,
) -> tuple[Dict[str, int], int, int]:
    """Resolve rolling-memory limits from config with env fallbacks.

    Priority:
    - space.json memory.rolling / memory
    - environment variables (DEFAULT_* constants)
    - hard-coded defaults inside this module
    """

    max_counts = dict(DEFAULT_MAX_COUNTS)
    stale_mark_days = DEFAULT_STALE_MARK_DAYS
    stale_drop_days = DEFAULT_STALE_DROP_DAYS

    if config is not None:
        memory_conf = config.memory or {}
        # Allow either memory["rolling"] nested config or top-level memory keys.
        rolling_conf = memory_conf.get("rolling") or memory_conf

        raw_max_counts = rolling_conf.get("max_counts") or {}
        if isinstance(raw_max_counts, dict):
            for key, default_limit in DEFAULT_MAX_COUNTS.items():
                override = _coerce_positive_int(raw_max_counts.get(key))
                if override is not None:
                    max_counts[key] = override

        mark_override = _coerce_positive_int(rolling_conf.get("stale_mark_days"))
        if mark_override is not None:
            stale_mark_days = mark_override

        drop_override = _coerce_positive_int(rolling_conf.get("stale_drop_days"))
        if drop_override is not None:
            stale_drop_days = drop_override

    # Ensure drop window is not shorter than mark window.
    if stale_drop_days < stale_mark_days:
        stale_drop_days = stale_mark_days

    return max_counts, stale_mark_days, stale_drop_days


@dataclass
class RollingMemoryBuilder:
    base_path: Path
    activity: ActivityLogger
    config: SpaceConfig | None = None

    def run(self, target_date: date, force: bool = False) -> str | None:
        max_counts, stale_mark_days, stale_drop_days = _resolve_memory_limits(self.config)

        memory_dir = ensure_dir(self.base_path / "memory" / "rolling")
        memory_path = memory_dir / f"{target_date.isoformat()}.json"
        md_path = memory_dir / f"{target_date.isoformat()}.md"
        latest_json = memory_dir / "latest.json"
        latest_md = memory_dir / "latest.md"

        digest_paths = sorted(
            self.base_path.glob(f"buckets/*/digests/{target_date.isoformat()}.json")
        )
        if self.config is not None:
            memory_conf = self.config.memory or {}
            excluded = {
                str(name).strip()
                for name in memory_conf.get("exclude_buckets", [])
                if str(name).strip()
            }
            if excluded:
                digest_paths = [
                    path
                    for path in digest_paths
                    if path.parent.parent.name not in excluded
                ]
        print(
            f"[memory] starting rolling memory build for {target_date.isoformat()} (force={force})"
        )
        if not force and _digest_paths_are_fresh(digest_paths, [md_path, memory_path]):
            print("[memory] existing memory files are newer than source digests; skipping")
            return None
        if not digest_paths:
            print("[memory] no digests available; skipping memory build")
            return None

        bundle = _load_digest_bundle(digest_paths)
        prev_path = memory_dir / f"{(target_date - timedelta(days=1)).isoformat()}.json"
        previous_sections = _load_previous(prev_path, max_counts)

        today_sections: Dict[str, List[Dict[str, Any]]] = _default_sections(max_counts)
        for section, items in previous_sections.items():
            today_sections[section] = _carry_forward(
                items,
                target_date,
                stale_mark_days=stale_mark_days,
                stale_drop_days=stale_drop_days,
            )

        source_digest_paths: List[str] = []
        for digest_path in digest_paths:
            source_digest_paths.append(str(digest_path.relative_to(self.base_path)))

        for bucket, data in bundle.items():
            digest_path = f"buckets/{bucket}/digests/{target_date.isoformat()}.md"
            highlights_structured = data.get("highlights_structured", [])
            actions_structured = data.get("action_items_structured", [])
            decisions_structured = data.get("decisions_structured", [])

            if highlights_structured:
                highlight_entries = [
                    _make_entry(
                        item.get("summary", ""),
                        bucket,
                        target_date,
                        digest_path,
                        evidence_quotes=item.get("evidence_quotes", []),
                    )
                    for item in highlights_structured
                    if item.get("summary")
                ]
            else:
                highlight_entries = [
                    _make_entry(item, bucket, target_date, digest_path)
                    for item in data.get("highlights", [])
                    if item and not str(item).startswith("(")
                ]

            if actions_structured:
                action_entries = [
                    _make_entry(
                        item.get("summary", ""),
                        bucket,
                        target_date,
                        digest_path,
                        evidence_quotes=item.get("evidence_quotes", []),
                    )
                    for item in actions_structured
                    if item.get("summary")
                ]
            else:
                action_entries = [
                    _make_entry(item, bucket, target_date, digest_path)
                    for item in data.get("action_items", [])
                    if item and not str(item).startswith("(")
                ]

            if decisions_structured:
                decision_entries = [
                    _make_entry(
                        item.get("summary", ""),
                        bucket,
                        target_date,
                        digest_path,
                        evidence_quotes=item.get("evidence_quotes", []),
                    )
                    for item in decisions_structured
                    if item.get("summary")
                ]
            else:
                decision_entries = [
                    _make_entry(item, bucket, target_date, digest_path)
                    for item in data.get("decisions", [])
                    if item and not str(item).startswith("(")
                ]

            for entry in highlight_entries:
                open_thread, fact, upcoming = _classify_highlight(entry["text"])
                if open_thread:
                    today_sections["open_threads"].append(entry)
                if fact:
                    today_sections["facts"].append(entry)
                if upcoming:
                    today_sections["upcoming"].append(entry)

            today_sections["action_items"].extend(action_entries)
            today_sections["key_decisions"].extend(decision_entries)

        for key, limit in max_counts.items():
            deduped = _dedupe(today_sections.get(key, []))
            deduped.sort(
                key=lambda item: (item.get("last_seen", ""), item.get("text", "")),
                reverse=True,
            )
            today_sections[key] = _truncate(deduped, limit)

        narrative = _build_narrative(today_sections)
        payload = {
            "date": target_date.isoformat(),
            "source_digest_paths": source_digest_paths,
            "sections": today_sections,
            "narrative": narrative,
        }
        write_json(memory_path, payload)
        latest_json.write_text(memory_path.read_text(encoding="utf-8"), encoding="utf-8")

        md_lines = [f"# Rolling Memory — {target_date.isoformat()}", ""]
        md_lines.append("## Source Digests")
        for path in source_digest_paths:
            md_lines.append(f"- {path}")
        md_lines.append("")

        for section in max_counts:
            title = section.replace("_", " ").title()
            md_lines.append(f"## {title}")
            items = today_sections.get(section, [])
            if not items:
                md_lines.append("- (none)")
            else:
                for item in items:
                    stale_note = "stale, " if item.get("stale") else ""
                    md_lines.append(
                        f"- {item['text']} _(source: {item['bucket']}, last_seen: {item['last_seen']}, {stale_note}digest: {item.get('source_digest_path', '')})_"
                    )
                    for quote in item.get("evidence_quotes", [])[:1]:
                        line = (
                            f"  - quote: \"{quote.get('text')}\""
                            f" — {quote.get('author')} ({quote.get('timestamp')})"
                        )
                        if quote.get("jump_url"):
                            line += f" {quote['jump_url']}"
                        md_lines.append(line)
            md_lines.append("")

        md_lines.append("## Narrative Summary")
        md_lines.append(narrative)
        md_lines.append("")
        md_path.write_text("\n".join(md_lines), encoding="utf-8")
        latest_md.write_text(md_path.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"[memory] rolling memory updated → {md_path.relative_to(self.base_path)}")

        self.activity.log(
            "memory.updated",
            run_key=target_date.isoformat(),
            inputs=source_digest_paths,
            outputs=[
                str(md_path.relative_to(self.base_path)),
                str(memory_path.relative_to(self.base_path)),
            ],
        )
        return str(md_path)

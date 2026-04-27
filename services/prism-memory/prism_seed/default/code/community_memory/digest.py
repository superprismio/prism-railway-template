from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .activity import ActivityLogger
from .config_loader import SpaceConfig
from .utils import ensure_dir, read_json, write_json

URL_RE = re.compile(r"https?://\S+")
KEYWORDS_DECISION = {
    "decide",
    "decided",
    "agreement",
    "approved",
    "decision",
    "consensus",
    "passed",
}
KEYWORDS_ACTION = {
    "todo",
    "action",
    "follow up",
    "follow-up",
    "next step",
    "assign",
    "task",
    "please",
    "needs",
    "should",
}
KEYWORDS_HIGHLIGHT = {
    "proposal",
    "deadline",
    "ship",
    "sponsor",
    "release",
    "demo",
    "launch",
    "vote",
}


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _shorten(text: str, limit: int = 220) -> str:
    text = _clean(text)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _contains_keyword(text: str, keywords: set[str]) -> bool:
    lower = (text or "").lower()
    return any(keyword in lower for keyword in keywords)


def _extract_links(text: str) -> List[str]:
    return URL_RE.findall(text or "")


def _load_raw_records(raw_dir: Path) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    if not raw_dir.exists():
        return records
    for path in sorted(raw_dir.glob("*.json")):
        data = read_json(path, default={})
        bucket = data.get("bucket")
        for channel in data.get("channels", []):
            channel_name = channel.get("channel_name")
            channel_topic = channel.get("channel_topic")
            channel_id = channel.get("channel_id")
            for message in channel.get("messages", []):
                author = message.get("author", {})
                content = _clean(message.get("content", ""))
                if not content:
                    continue
                thread = message.get("thread") or {}
                thread_id = (
                    message.get("thread_id")
                    or thread.get("id")
                    or channel.get("thread_id")
                )
                thread_name = (
                    message.get("thread_name")
                    or thread.get("name")
                    or channel.get("thread_name")
                )
                parent_channel_id = (
                    message.get("parent_channel_id")
                    or thread.get("parent_channel_id")
                    or channel.get("parent_channel_id")
                )
                parent_channel_name = (
                    message.get("parent_channel_name")
                    or thread.get("parent_channel_name")
                    or channel.get("parent_channel_name")
                )
                is_thread = bool(
                    message.get("is_thread")
                    or channel.get("is_thread")
                    or thread_id
                )
                records.append(
                    {
                        "bucket": bucket,
                        "channel": channel_name,
                        "channel_id": channel_id,
                        "channel_topic": channel_topic,
                        "thread_id": str(thread_id) if thread_id not in (None, "") else None,
                        "thread_name": str(thread_name) if thread_name not in (None, "") else None,
                        "parent_channel_id": str(parent_channel_id)
                        if parent_channel_id not in (None, "")
                        else None,
                        "parent_channel_name": str(parent_channel_name)
                        if parent_channel_name not in (None, "")
                        else None,
                        "is_thread": is_thread,
                        "author": author.get("display_name")
                        or author.get("username", "unknown"),
                        "content": content,
                        "created_at": message.get("created_at"),
                        "jump_url": message.get("jump_url"),
                        "attachments": message.get("attachments", []),
                    }
                )
    return records


def _message_tags(record: Dict[str, Any]) -> List[str]:
    tags: List[str] = []
    text = record.get("content", "")
    if _contains_keyword(text, KEYWORDS_HIGHLIGHT):
        tags.append("highlight")
    if _contains_keyword(text, KEYWORDS_DECISION):
        tags.append("decision")
    if _contains_keyword(text, KEYWORDS_ACTION):
        tags.append("action")
    if URL_RE.search(text):
        tags.append("link")
    if "@" in text:
        tags.append("mention")
    if "?" in text:
        tags.append("question")
    if record.get("attachments"):
        tags.append("attachment")
    if record.get("thread_id"):
        tags.append("thread")
    return sorted(set(tags))


def _message_score(record: Dict[str, Any]) -> int:
    tags = _message_tags(record)
    score = 0
    score += 3 if "decision" in tags else 0
    score += 3 if "action" in tags else 0
    score += 2 if "highlight" in tags else 0
    score += 1 if "link" in tags else 0
    score += 1 if "mention" in tags else 0
    score += 1 if "question" in tags else 0
    score += 1 if "attachment" in tags else 0
    return score


def _overview_summary(records: List[Dict[str, Any]]) -> List[str]:
    if not records:
        return ["No activity captured for this bucket."]
    channels: Dict[str, int] = {}
    participants = set()
    for record in records:
        channel = record.get("channel") or "unknown"
        channels[channel] = channels.get(channel, 0) + 1
        participants.add(record.get("author"))
    top_channels = sorted(channels.items(), key=lambda item: item[1], reverse=True)[:5]
    lines = [
        f"{len(records)} messages across {len(channels)} channel(s) with {len(participants)} participant(s)."
    ]
    if top_channels:
        lines.append(
            "Top channels: "
            + ", ".join(f"{name} ({count})" for name, count in top_channels)
            + "."
        )
    return lines


def _to_structured_entry(
    record: Dict[str, Any], *, reason: str, include_quote: bool = True
) -> Dict[str, Any]:
    location = record.get("channel") or "unknown"
    if record.get("thread_name"):
        location = f"{location} / {record['thread_name']}"
    summary = (
        f"{location}: {record.get('author')} — "
        f"{_shorten(record.get('content', ''), 180)}"
    )
    quote = {
        "author": record.get("author", ""),
        "timestamp": record.get("created_at", ""),
        "text": _shorten(record.get("content", ""), 240),
        "jump_url": record.get("jump_url", ""),
    }
    out = {
        "summary": summary,
        "bucket": record.get("bucket"),
        "channel": record.get("channel"),
        "channel_id": record.get("channel_id"),
        "thread_id": record.get("thread_id"),
        "thread_name": record.get("thread_name"),
        "parent_channel_id": record.get("parent_channel_id"),
        "parent_channel_name": record.get("parent_channel_name"),
        "is_thread": bool(record.get("is_thread")),
        "author": record.get("author"),
        "created_at": record.get("created_at"),
        "jump_url": record.get("jump_url"),
        "score": _message_score(record),
        "tags": _message_tags(record),
        "reason": reason,
        "evidence_quotes": [quote] if include_quote else [],
    }
    return out


def _render_legacy_line(entry: Dict[str, Any]) -> str:
    base = f"[{entry.get('created_at')}] {entry.get('summary')}"
    jump = (entry.get("jump_url") or "").strip()
    if jump:
        return f"{base} ({jump})"
    return base


def _dedupe_structured(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: Dict[str, Dict[str, Any]] = {}
    for item in items:
        key = (
            f"{item.get('channel')}|{item.get('thread_id') or ''}|"
            f"{item.get('author')}|{item.get('summary')}"
        )
        if key in seen:
            if item.get("score", 0) > seen[key].get("score", 0):
                seen[key] = item
        else:
            seen[key] = item
    return list(seen.values())


def _thread_summary_entry(
    thread_id: str,
    records: List[Dict[str, Any]],
    *,
    promoted: bool,
) -> Dict[str, Any]:
    ordered = sorted(records, key=lambda item: item.get("created_at", ""))
    first = ordered[0]
    participants = sorted(
        {str(record.get("author", "")).strip() for record in ordered if str(record.get("author", "")).strip()}
    )
    summary = (
        f"{first.get('channel')} / {first.get('thread_name') or thread_id}: "
        f"{len(ordered)} messages from {len(participants)} participant(s)"
    )
    if participants:
        summary += f" ({', '.join(participants[:4])}"
        if len(participants) > 4:
            summary += ", ..."
        summary += ")"
    return {
        "summary": summary,
        "bucket": first.get("bucket"),
        "channel": first.get("channel"),
        "channel_id": first.get("channel_id"),
        "thread_id": thread_id,
        "thread_name": first.get("thread_name"),
        "parent_channel_id": first.get("parent_channel_id"),
        "parent_channel_name": first.get("parent_channel_name"),
        "author": first.get("author"),
        "created_at": first.get("created_at"),
        "jump_url": first.get("jump_url"),
        "score": max(3, len(ordered)),
        "tags": ["thread", "promoted" if promoted else "active_thread"],
        "reason": "thread_promotion" if promoted else "thread_activity",
        "evidence_quotes": [
            {
                "author": record.get("author", ""),
                "timestamp": record.get("created_at", ""),
                "text": _shorten(record.get("content", ""), 240),
                "jump_url": record.get("jump_url", ""),
            }
            for record in ordered[:2]
        ],
    }


@dataclass
class DigestGenerator:
    base_path: Path
    config: SpaceConfig
    activity: ActivityLogger

    def run_for_date(self, target_date: date, force: bool = False) -> Dict[str, str]:
        outputs: Dict[str, str] = {}
        configured = set(self.config.discord.category_to_bucket.values())
        buckets_dir = self.base_path / "buckets"
        existing = (
            {path.name for path in buckets_dir.iterdir() if path.is_dir()}
            if buckets_dir.exists()
            else set()
        )
        buckets = sorted(configured | existing)
        for bucket in buckets:
            raw_dir = (
                self.base_path / "buckets" / bucket / "raw" / target_date.strftime("%Y-%m-%d")
            )
            digest_dir = self.base_path / "buckets" / bucket / "digests"
            ensure_dir(digest_dir)
            digest_path = digest_dir / f"{target_date.strftime('%Y-%m-%d')}.md"
            digest_json = digest_dir / f"{target_date.strftime('%Y-%m-%d')}.json"

            if digest_path.exists() and not force:
                print(f"[digest] {bucket} already has digest for {target_date.isoformat()} (skip)")
                continue

            print(f"[digest] loading raw records for {bucket} on {target_date.isoformat()}")
            records = _load_raw_records(raw_dir)
            if not records:
                print(f"[digest] no records found for bucket {bucket}; skipping")
                continue

            mode_conf = self._bucket_mode(bucket)
            digest_data = self._build_digest(records, mode_conf)
            digest_lines = self._render_digest(bucket, target_date, digest_data)
            digest_path.write_text("\n".join(digest_lines), encoding="utf-8")
            write_json(digest_json, digest_data)
            print(f"[digest] wrote digest {digest_path.relative_to(self.base_path)}")

            self.activity.log(
                "digest.completed",
                bucket=bucket,
                run_key=target_date.strftime("%Y-%m-%d"),
                inputs=[str(raw_dir.relative_to(self.base_path))],
                outputs=[str(digest_path.relative_to(self.base_path))],
            )
            outputs[bucket] = str(digest_path)
        return outputs

    def _bucket_mode(self, bucket: str) -> Dict[str, Any]:
        defaults = self.config.discord.bucket_defaults or {}
        overrides = self.config.discord.bucket_overrides or {}
        mode = defaults.get("mode", "high_signal")
        bucket_override = overrides.get(bucket, {})
        mode = bucket_override.get("mode", mode)
        max_highlights = int(bucket_override.get("max_highlights", 20))
        return {"mode": mode, "max_highlights": max_highlights}

    def _build_digest(
        self, records: List[Dict[str, Any]], mode_conf: Dict[str, Any]
    ) -> Dict[str, Any]:
        links: List[str] = []
        decisions_structured: List[Dict[str, Any]] = []
        action_structured: List[Dict[str, Any]] = []
        highlights_structured: List[Dict[str, Any]] = []

        scored_records = sorted(
            records,
            key=lambda record: (_message_score(record), record.get("created_at", "")),
            reverse=True,
        )

        mode = mode_conf.get("mode")
        max_highlights = mode_conf.get("max_highlights", 20)
        high_signal_cap = min(max(12, max_highlights), 40)
        highlight_cap = max_highlights if mode == "noisy_highlights" else high_signal_cap

        for record in records:
            text = record.get("content", "")
            if _contains_keyword(text, KEYWORDS_DECISION):
                decisions_structured.append(_to_structured_entry(record, reason="decision"))
            if _contains_keyword(text, KEYWORDS_ACTION):
                action_structured.append(_to_structured_entry(record, reason="action"))
            for link in _extract_links(text):
                links.append(
                    f"{record.get('channel')} — {record.get('author')} ({record.get('created_at')}): {link}"
                )

        for record in scored_records[:highlight_cap]:
            score = _message_score(record)
            if mode == "noisy_highlights" and score <= 0:
                continue
            if mode != "noisy_highlights" and score <= 1:
                continue
            highlights_structured.append(_to_structured_entry(record, reason="highlight"))

        promotion_conf = self.config.discord.thread_promotion
        if promotion_conf.enabled:
            explicit_thread_ids = set(promotion_conf.thread_ids)
            thread_groups: Dict[str, List[Dict[str, Any]]] = {}
            for record in records:
                thread_id = record.get("thread_id")
                if thread_id:
                    thread_groups.setdefault(thread_id, []).append(record)

            for thread_id, thread_records in thread_groups.items():
                participants = {
                    str(item.get("author", "")).strip()
                    for item in thread_records
                    if str(item.get("author", "")).strip()
                }
                promoted = thread_id in explicit_thread_ids
                active_enough = (
                    len(thread_records) >= promotion_conf.min_messages
                    and len(participants) >= promotion_conf.min_participants
                )
                if not promoted and not active_enough:
                    continue
                highlights_structured.append(
                    _thread_summary_entry(
                        thread_id,
                        thread_records,
                        promoted=promoted,
                    )
                )

        highlights_structured = _dedupe_structured(highlights_structured)
        decisions_structured = _dedupe_structured(decisions_structured)
        action_structured = _dedupe_structured(action_structured)

        if not highlights_structured and scored_records:
            fallback = scored_records[: min(6, len(scored_records))]
            highlights_structured = [
                _to_structured_entry(record, reason="fallback") for record in fallback
            ]

        digest = {
            "overview": _overview_summary(records),
            "highlights_structured": highlights_structured,
            "decisions_structured": decisions_structured,
            "action_items_structured": action_structured,
            # legacy keys kept for compatibility with existing consumers
            "highlights": [_render_legacy_line(item) for item in highlights_structured]
            or ["(no notable highlights)"],
            "decisions": [_render_legacy_line(item) for item in decisions_structured]
            or ["(none recorded)"],
            "action_items": [_render_legacy_line(item) for item in action_structured]
            or ["(none recorded)"],
            "links": list(dict.fromkeys([item for item in links if item])) or ["(no new links)"],
        }
        return digest

    def _render_digest(self, bucket: str, target_date: date, digest: Dict[str, Any]) -> List[str]:
        lines = [f"# Daily Digest — {bucket} — {target_date.isoformat()}", ""]
        overview = digest.get("overview", [])
        if overview:
            lines.append("## Overview")
            for entry in overview:
                lines.append(f"- {entry}")
            lines.append("")

        sections: List[Tuple[str, List[Dict[str, Any]]]] = [
            ("Highlights", digest.get("highlights_structured", [])),
            ("Decisions", digest.get("decisions_structured", [])),
            ("Action Items", digest.get("action_items_structured", [])),
        ]
        for title, entries in sections:
            lines.append(f"## {title}")
            if not entries:
                lines.append("- (none)")
            else:
                for entry in entries:
                    lines.append(f"- {_shorten(entry.get('summary', ''), 220)}")
                    for quote in entry.get("evidence_quotes", [])[:1]:
                        qline = (
                            f"  - quote: \"{_shorten(quote.get('text', ''), 240)}\""
                            f" — {quote.get('author')} ({quote.get('timestamp')})"
                        )
                        if quote.get("jump_url"):
                            qline += f" {quote['jump_url']}"
                        lines.append(qline)
            lines.append("")

        lines.append("## Links / Resources")
        for entry in digest.get("links", []):
            lines.append(f"- {entry}")
        lines.append("")
        return lines

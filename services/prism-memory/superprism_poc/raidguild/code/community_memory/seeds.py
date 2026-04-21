from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .activity import ActivityLogger
from .utils import ensure_dir, read_json, write_json

QUOTE_RE = re.compile(
    r"^\-\s*\[(?P<ts>[^\]]+)\]\s*(?P<author>[^:]+):\s*(?P<body>.*?)(?:\s+\((?P<jump>https?://[^\s)]+)\))?$"
)


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _shorten(text: str, limit: int = 220) -> str:
    text = _clean(text)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _headline(entry: str) -> str:
    for line in (entry or "").splitlines():
        line = line.strip()
        if not line or line.lower().startswith(("topic:", "time span:", "key quotes:")):
            continue
        if line.startswith("- ["):
            match = QUOTE_RE.match(line)
            if match:
                return _shorten(match.group("body") or "", 180)
            continue
        return _shorten(line, 180)
    return _shorten(entry or "", 180)


def _extract_quote(entry: str) -> Dict[str, str] | None:
    for line in (entry or "").splitlines():
        match = QUOTE_RE.match(line.strip())
        if not match:
            continue
        return {
            "author": _clean(match.group("author")),
            "timestamp": _clean(match.group("ts")),
            "text": _shorten(match.group("body") or "", 220),
            "jump_url": _clean(match.group("jump") or ""),
        }
    return None


def _load_digest_json(base_path: Path, target_date: date) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for path in sorted(base_path.glob(f"buckets/*/digests/{target_date.isoformat()}.json")):
        bucket = path.parent.parent.name
        data = read_json(path, default={})
        if data:
            out[bucket] = data
    return out


def _collect_week_dates(target_date: date) -> List[date]:
    start = target_date - timedelta(days=6)
    return [start + timedelta(days=i) for i in range(7)]


def _iso_week_key(target_date: date) -> str:
    iso_year, iso_week, _ = target_date.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _render_daily_markdown(data: Dict[str, Any]) -> str:
    lines: List[str] = [f"# {data['title']}", ""]

    lines.append("## Newsletter (Today)")
    newsletter = data["sections"]["newsletter"]
    if newsletter:
        for item in newsletter:
            lines.append(f"- [{item['bucket']}] {item['summary']}")
            quote = item.get("quote")
            if quote:
                line = (
                    f"  - quote: \"{quote['text']}\" — {quote['author']} ({quote['timestamp']})"
                )
                if quote.get("jump_url"):
                    line += f" {quote['jump_url']}"
                lines.append(line)
            lines.append(f"  - source: {item['source_path']}")
    else:
        lines.append("- (no notable highlights today)")
    lines.append("")

    lines.append("## X Post Candidates")
    candidates = data["sections"]["x_post_candidates"]
    if candidates:
        for item in candidates:
            lines.append(f"- {item['summary']}")
            lines.append(f"  - angle: {item['angle']}")
            lines.append(f"  - source: {item['source_path']}")
    else:
        lines.append("- (no decision/action-based candidates today)")
    lines.append("")

    lines.append("## Blog Post Ideas")
    ideas = data["sections"]["blog_post_ideas"]
    if ideas:
        for item in ideas:
            lines.append(f"- {item['text']}")
            lines.append(f"  - why_now: {item['why_now']}")
            if item.get("source_path"):
                lines.append(f"  - source: {item['source_path']}")
    else:
        lines.append("- (insufficient rolling memory context)")
    lines.append("")

    ref = data["sections"]["weekly_reference_window"]
    lines.append(f"## Weekly Reference Window\n- {ref['start_date']} to {ref['end_date']}")
    lines.append("")
    return "\n".join(lines)


def _render_weekly_markdown(data: Dict[str, Any]) -> str:
    lines: List[str] = [f"# {data['title']}", ""]
    lines.append(f"- Window: {data['window']['start_date']} to {data['window']['end_date']}")
    lines.append("")

    lines.append("## Weekly Newsletter Bullets")
    bullets = data["sections"]["newsletter_bullets"]
    if bullets:
        for item in bullets:
            lines.append(f"- [{item['date']}] [{item['bucket']}] {item['summary']}")
            lines.append(f"  - source: {item['source_path']}")
    else:
        lines.append("- (no highlights in this window)")
    lines.append("")

    lines.append("## X Thread Ideas (Weekly)")
    ideas = data["sections"]["x_thread_ideas"]
    if ideas:
        for item in ideas:
            lines.append(f"- {item['summary']}")
            lines.append(f"  - framing: {item['framing']}")
            lines.append(f"  - source: {item['source_path']}")
    else:
        lines.append("- (no decision/action signals in this window)")
    lines.append("")

    lines.append("## Blog Concepts (Weekly)")
    concepts = data["sections"]["blog_concepts"]
    if concepts:
        for item in concepts:
            lines.append(f"- {item['summary']}")
            lines.append(f"  - angle: {item['angle']}")
            lines.append(f"  - audience: {item['audience']}")
            lines.append(f"  - source: {item['source_path']}")
    else:
        lines.append("- (insufficient material for weekly concepts)")
    lines.append("")
    return "\n".join(lines)


@dataclass
class SeedBuilder:
    base_path: Path
    activity: ActivityLogger

    def run_daily(self, target_date: date, force: bool = False) -> str | None:
        suggestions_dir = ensure_dir(self.base_path / "products" / "suggestions")
        output_path = suggestions_dir / f"{target_date.isoformat()}.md"
        output_json_path = suggestions_dir / f"{target_date.isoformat()}.json"
        if output_path.exists() and output_json_path.exists() and not force:
            return None

        memory = read_json(
            self.base_path / "memory" / "rolling" / f"{target_date.isoformat()}.json",
            default={},
        )
        digests = _load_digest_json(self.base_path, target_date)
        if not digests:
            return None

        newsletter_items: List[Dict[str, Any]] = []
        count = 0
        for bucket, digest in digests.items():
            structured = digest.get("highlights_structured", [])
            if structured:
                items = structured
            else:
                items = [{"summary": item} for item in digest.get("highlights", [])]
            for highlight in items:
                if count >= 8:
                    break
                summary = highlight.get("summary", "")
                if str(summary).startswith("("):
                    continue
                item: Dict[str, Any] = {
                    "bucket": bucket,
                    "summary": _headline(summary),
                    "source_path": f"buckets/{bucket}/digests/{target_date.isoformat()}.md",
                }
                quote = None
                evidence_quotes = highlight.get("evidence_quotes", [])
                if evidence_quotes:
                    quote = evidence_quotes[0]
                elif isinstance(summary, str):
                    quote = _extract_quote(summary)
                if quote:
                    item["quote"] = quote
                newsletter_items.append(item)
                count += 1
            if count >= 8:
                break

        x_post_candidates: List[Dict[str, Any]] = []
        candidates = 0
        for bucket, digest in digests.items():
            decisions = digest.get("decisions_structured", [])
            actions = digest.get("action_items_structured", [])
            if not decisions and not actions:
                decisions = [{"summary": item} for item in digest.get("decisions", [])]
                actions = [{"summary": item} for item in digest.get("action_items", [])]
            for item in decisions + actions:
                if candidates >= 12:
                    break
                summary = item.get("summary", "")
                if str(summary).startswith("("):
                    continue
                x_post_candidates.append(
                    {
                        "summary": _headline(summary),
                        "angle": f"{bucket} update",
                        "bucket": bucket,
                        "source_path": f"buckets/{bucket}/digests/{target_date.isoformat()}.md",
                    }
                )
                candidates += 1
            if candidates >= 12:
                break

        blog_post_ideas: List[Dict[str, Any]] = []
        ideas = 0
        sections = memory.get("sections", {}) if isinstance(memory, dict) else {}
        for section_name in ["open_threads", "key_decisions", "upcoming"]:
            for item in sections.get(section_name, []):
                if ideas >= 5:
                    break
                text = _shorten(item.get("text", ""), 180)
                if not text:
                    continue
                digest_ref = item.get("source_digest_path", "")
                blog_post_ideas.append(
                    {
                        "text": text,
                        "why_now": f"Derived from rolling memory `{section_name}`",
                        "source_section": section_name,
                        "source_path": digest_ref,
                    }
                )
                ideas += 1
            if ideas >= 5:
                break

        week_dates = _collect_week_dates(target_date)
        data = {
            "type": "daily_product_seed",
            "date": target_date.isoformat(),
            "title": f"Product Seed — {target_date.isoformat()}",
            "sections": {
                "newsletter": newsletter_items,
                "x_post_candidates": x_post_candidates,
                "blog_post_ideas": blog_post_ideas,
                "weekly_reference_window": {
                    "start_date": week_dates[0].isoformat(),
                    "end_date": week_dates[-1].isoformat(),
                },
            },
        }

        output_path.write_text(_render_daily_markdown(data), encoding="utf-8")
        write_json(output_json_path, data)
        self.activity.log(
            "products.suggestions.updated",
            run_key=target_date.isoformat(),
            outputs=[
                str(output_path.relative_to(self.base_path)),
                str(output_json_path.relative_to(self.base_path)),
            ],
        )
        return str(output_path)

    def run_weekly(self, target_date: date, force: bool = False) -> str | None:
        suggestions_dir = ensure_dir(self.base_path / "products" / "suggestions")
        week_key = _iso_week_key(target_date)
        output_path = suggestions_dir / f"weekly-{week_key}.md"
        output_json_path = suggestions_dir / f"weekly-{week_key}.json"
        if output_path.exists() and output_json_path.exists() and not force:
            return None

        week_dates = _collect_week_dates(target_date)
        digest_bundle: List[Tuple[date, str, Dict[str, Any]]] = []
        for day in week_dates:
            digests = _load_digest_json(self.base_path, day)
            for bucket, digest in digests.items():
                digest_bundle.append((day, bucket, digest))
        if not digest_bundle:
            return None

        newsletter_bullets: List[Dict[str, Any]] = []
        bullets = 0
        newsletter_seen = set()
        for day, bucket, digest in sorted(digest_bundle, key=lambda x: x[0], reverse=True):
            highlights = digest.get("highlights_structured", [])
            if not highlights:
                highlights = [{"summary": item} for item in digest.get("highlights", [])]
            for item in highlights:
                if bullets >= 15:
                    break
                summary = _headline(item.get("summary", ""))
                if not summary or summary.startswith("("):
                    continue
                dedupe_key = f"{bucket}|{summary}"
                if dedupe_key in newsletter_seen:
                    continue
                newsletter_seen.add(dedupe_key)
                newsletter_bullets.append(
                    {
                        "date": day.isoformat(),
                        "bucket": bucket,
                        "summary": summary,
                        "source_path": f"buckets/{bucket}/digests/{day.isoformat()}.md",
                    }
                )
                bullets += 1
            if bullets >= 15:
                break

        x_thread_ideas: List[Dict[str, Any]] = []
        x_ideas = 0
        x_seen = set()
        for day, bucket, digest in sorted(digest_bundle, key=lambda x: x[0], reverse=True):
            entries = digest.get("decisions_structured", []) + digest.get(
                "action_items_structured", []
            )
            if not entries:
                entries = [{"summary": item} for item in digest.get("decisions", []) + digest.get("action_items", [])]
            for item in entries:
                if x_ideas >= 20:
                    break
                summary = _headline(item.get("summary", ""))
                if not summary or summary.startswith("("):
                    continue
                dedupe_key = f"{bucket}|{summary}"
                if dedupe_key in x_seen:
                    continue
                x_seen.add(dedupe_key)
                x_thread_ideas.append(
                    {
                        "date": day.isoformat(),
                        "bucket": bucket,
                        "summary": summary,
                        "framing": f"weekly {bucket} progress / ask",
                        "source_path": f"buckets/{bucket}/digests/{day.isoformat()}.md",
                    }
                )
                x_ideas += 1
            if x_ideas >= 20:
                break

        blog_concepts: List[Dict[str, Any]] = []
        concepts = 0
        concept_seen = set()
        for day, bucket, digest in sorted(digest_bundle, key=lambda x: x[0], reverse=True):
            highlights = digest.get("highlights_structured", [])
            if not highlights:
                highlights = [{"summary": item} for item in digest.get("highlights", [])]
            for item in highlights:
                if concepts >= 8:
                    break
                summary = _headline(item.get("summary", ""))
                if not summary or summary.startswith("("):
                    continue
                dedupe_key = f"{bucket}|{summary}"
                if dedupe_key in concept_seen:
                    continue
                concept_seen.add(dedupe_key)
                blog_concepts.append(
                    {
                        "date": day.isoformat(),
                        "bucket": bucket,
                        "summary": summary,
                        "angle": "explain why this matters to the community",
                        "audience": "contributors, partners, prospective clients",
                        "source_path": f"buckets/{bucket}/digests/{day.isoformat()}.md",
                    }
                )
                concepts += 1
            if concepts >= 8:
                break

        data = {
            "type": "weekly_product_seed",
            "week": week_key,
            "title": f"Weekly Product Seed — {week_key}",
            "window": {
                "start_date": week_dates[0].isoformat(),
                "end_date": week_dates[-1].isoformat(),
            },
            "sections": {
                "newsletter_bullets": newsletter_bullets,
                "x_thread_ideas": x_thread_ideas,
                "blog_concepts": blog_concepts,
            },
        }

        output_path.write_text(_render_weekly_markdown(data), encoding="utf-8")
        write_json(output_json_path, data)
        self.activity.log(
            "products.suggestions.weekly.updated",
            run_key=week_key,
            outputs=[
                str(output_path.relative_to(self.base_path)),
                str(output_json_path.relative_to(self.base_path)),
            ],
        )
        return str(output_path)

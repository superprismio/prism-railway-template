from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

from .activity import ActivityLogger
from .config_loader import SpaceConfig
from .utils import ensure_dir, read_json, to_iso, write_json


REQUEST_RE = re.compile(r"\b(?:request|change request|cr)\s*#?\s*(\d+)\b", re.IGNORECASE)
PR_RE = re.compile(r"\b(?:pr|pull request)\s*#?\s*(\d+)\b", re.IGNORECASE)
GITHUB_PR_URL_RE = re.compile(r"https?://github\.com/[^/\s]+/[^/\s]+/pull/(\d+)", re.IGNORECASE)
URL_RE = re.compile(r"https?://[^\s<>)\"']+")


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _slugify(text: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9._-]+", "-", _clean(text).lower()).strip("-")
    return value[:96]


def _from_iso_optional(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        return datetime.fromisoformat(value).astimezone(timezone.utc)
    except ValueError:
        return None


def _date_floor(target_date: date) -> datetime:
    return datetime(target_date.year, target_date.month, target_date.day, tzinfo=timezone.utc)


def _max_iso(first: str | None, second: str | None) -> str | None:
    first_dt = _from_iso_optional(first)
    second_dt = _from_iso_optional(second)
    if first_dt is None:
        return second
    if second_dt is None:
        return first
    return first if first_dt >= second_dt else second


def _as_list(value: Any) -> List[str]:
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    out: List[str] = []
    for item in items:
        text = str(item).strip()
        if text:
            out.append(text)
    return out


def _stable_hash(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]


def _normalize_url(value: str) -> str:
    return value.strip().rstrip(".,;")


def _title_from_key(key: str) -> str:
    return " ".join(part.capitalize() for part in key.replace("_", "-").split("-") if part) or key


def _resolve_workspace_root(base_path: Path) -> Path:
    return base_path.parent.parent


def _resolve_knowledge_activity_path(base_path: Path, config: SpaceConfig | None) -> Path:
    if config is not None and getattr(config, "knowledge", None) is not None:
        raw_path = str(config.knowledge.activity_path or "").strip()
        if raw_path:
            candidate = Path(raw_path)
            if candidate.is_absolute():
                return candidate
            return _resolve_workspace_root(base_path) / candidate
    return base_path / "knowledge" / "kb" / "activity" / "kb_activity.jsonl"


def _event_date(value: str) -> date | None:
    parsed = _from_iso_optional(value)
    return parsed.date() if parsed else None


def _normalize_knowledge_event(raw: Dict[str, Any], fallback_ts: str) -> Dict[str, Any] | None:
    event_type = str(raw.get("type") or "").strip()
    source_id = str(raw.get("source_id") or "").strip()
    doc_slug = str(raw.get("doc_slug") or "").strip()
    title = _clean(str(raw.get("title") or doc_slug or "Knowledge update"))
    changed_at = str(raw.get("changed_at") or fallback_ts).strip()
    if not event_type or not title:
        return None
    return {
        "type": event_type,
        "source_id": source_id,
        "doc_slug": doc_slug,
        "doc_path": str(raw.get("doc_path") or "").strip(),
        "title": title[:160],
        "kind": str(raw.get("kind") or "reference").strip() or "reference",
        "summary": _clean(str(raw.get("summary") or ""))[:260],
        "url": str(raw.get("url") or (f"/knowledge/view/{doc_slug}" if doc_slug else "")).strip(),
        "changed_at": changed_at,
    }


@dataclass
class ObjectiveStateBuilder:
    base_path: Path
    activity: ActivityLogger
    config: SpaceConfig

    def run(self, target_date: date, force: bool = False) -> str | None:
        return self.run_range(target_date, target_date, force=force, mode="forward")

    def run_range(
        self,
        start_date: date,
        end_date: date,
        force: bool = False,
        mode: str = "bounded_backfill",
    ) -> str | None:
        if end_date < start_date:
            raise ValueError("end_date must be on or after start_date")

        state_conf = self.config.state or {}
        objectives_conf = state_conf.get("objectives") or state_conf.get("workstreams") or {}
        if objectives_conf and not bool(objectives_conf.get("enabled", True)):
            return None

        activity_windows = objectives_conf.get("activity_windows") or {}
        active_days = self._coerce_positive_int(activity_windows.get("active_days"), default=7)
        watching_days = self._coerce_positive_int(
            activity_windows.get("watching_days"), default=max(active_days, 30)
        )
        if watching_days < active_days:
            watching_days = active_days

        current_dir = ensure_dir(self.base_path / "state" / "current")
        latest_path = self.base_path / "state" / "latest.json"
        signals_path = current_dir / "signals.json"
        objectives_path = current_dir / "objectives.json"
        throughlines_path = current_dir / "throughlines.json"

        existing_signals_payload = read_json(signals_path, default={})
        existing_signals = [
            item
            for item in existing_signals_payload.get("signals", [])
            if isinstance(item, dict) and item.get("signal_id")
        ] if isinstance(existing_signals_payload, dict) else []
        signals_by_id = {
            str(item["signal_id"]): item
            for item in existing_signals
            if not self._signal_in_window(item, start_date, end_date)
        }

        records = self._load_raw_records_for_range(start_date, end_date)
        knowledge_events = self._load_knowledge_events_for_range(start_date, end_date)
        new_signals: List[Dict[str, Any]] = []
        for record in records:
            for signal in self._extract_signals(record):
                signal_id = str(signal.get("signal_id") or "")
                if not signal_id:
                    continue
                if signal_id not in signals_by_id:
                    new_signals.append(signal)
                signals_by_id[signal_id] = signal
        for event in knowledge_events:
            for signal in self._extract_knowledge_event_signals(event):
                signal_id = str(signal.get("signal_id") or "")
                if not signal_id:
                    continue
                if signal_id not in signals_by_id:
                    new_signals.append(signal)
                signals_by_id[signal_id] = signal

        signals = sorted(signals_by_id.values(), key=lambda item: (str(item.get("occurred_at") or ""), str(item.get("signal_id") or "")))
        write_json(
            signals_path,
            {
                "generated_at": to_iso(datetime.now(timezone.utc)),
                "as_of_date": end_date.isoformat(),
                "signals": signals,
                "state_index": {
                    "version": 1,
                    "last_reindexed_at": to_iso(datetime.now(timezone.utc)) if mode != "forward" else None,
                    "window_start": start_date.isoformat(),
                    "window_end": end_date.isoformat(),
                    "mode": mode,
                    "source_counts": self._source_counts(signals),
                    "output_counts": {"signals": len(signals)},
                },
            },
        )

        objectives_payload = read_json(objectives_path, default={})
        previous_objectives = objectives_payload.get("objectives", []) if isinstance(objectives_payload, dict) else []
        objectives = self._build_objectives(
            previous_objectives=previous_objectives,
            signals=signals,
            target_date=end_date,
            active_days=active_days,
            watching_days=watching_days,
        )
        write_json(
            objectives_path,
            {
                "generated_at": to_iso(datetime.now(timezone.utc)),
                "as_of_date": end_date.isoformat(),
                "objectives": objectives,
            },
        )

        throughlines = self._build_throughlines(signals=signals, objectives=objectives)
        write_json(
            throughlines_path,
            {
                "generated_at": to_iso(datetime.now(timezone.utc)),
                "as_of_date": end_date.isoformat(),
                "throughlines": throughlines,
            },
        )

        generated_at = to_iso(datetime.now(timezone.utc))
        latest_payload = read_json(latest_path, default={})
        if not isinstance(latest_payload, dict):
            latest_payload = {}
        domains = latest_payload.get("domains") if isinstance(latest_payload.get("domains"), dict) else {}
        objective_counts = self._status_counts(objectives)
        domains.update(
            {
                "signals": {
                    "source_path": "state/current/signals.json",
                    "updated_at": generated_at,
                    "summary": f"{len(signals)} signal(s) extracted from {len(self._source_counts(signals))} source(s).",
                },
                "objectives": {
                    "source_path": "state/current/objectives.json",
                    "updated_at": generated_at,
                    "summary": (
                        f"{objective_counts['active']} active, {objective_counts['watching']} watching, "
                        f"{objective_counts['inactive']} inactive, {objective_counts['archived']} archived."
                    ),
                },
                "throughlines": {
                    "source_path": "state/current/throughlines.json",
                    "updated_at": generated_at,
                    "summary": f"{len(throughlines)} throughline(s).",
                },
            }
        )
        recent_changes = [
            item for item in latest_payload.get("recent_changes", []) if isinstance(item, dict)
        ] if isinstance(latest_payload.get("recent_changes"), list) else []
        recent_changes.insert(
            0,
            {
                "domain": "objectives",
                "change_type": "updated",
                "summary": (
                    f"Objective state refreshed for {start_date.isoformat()}..{end_date.isoformat()} with "
                    f"{len(new_signals)} new signal(s)."
                ),
                "updated_at": generated_at,
                "source_path": "state/current/objectives.json",
            },
        )
        latest_payload.update(
            {
                "generated_at": generated_at,
                "domains": domains,
                "recent_changes": recent_changes[:20],
                "state_index": {
                    "version": 1,
                    "last_reindexed_at": to_iso(datetime.now(timezone.utc)) if mode != "forward" else None,
                    "window_start": start_date.isoformat(),
                    "window_end": end_date.isoformat(),
                    "mode": mode,
                    "source_counts": self._source_counts(signals),
                    "output_counts": {
                        "signals": len(signals),
                        "objectives": len(objectives),
                        "throughlines": len(throughlines),
                    },
                },
            }
        )
        write_json(latest_path, latest_payload)

        self.activity.log(
            "state.objectives.updated",
            run_key=f"{start_date.isoformat()}..{end_date.isoformat()}",
            outputs=[
                str(signals_path.relative_to(self.base_path)),
                str(objectives_path.relative_to(self.base_path)),
                str(throughlines_path.relative_to(self.base_path)),
                str(latest_path.relative_to(self.base_path)),
            ],
            meta={
                "signals": len(signals),
                "new_signals": len(new_signals),
                "knowledge_events": len(knowledge_events),
                "objectives": len(objectives),
                "throughlines": len(throughlines),
                "force": force,
                "mode": mode,
                "window_start": start_date.isoformat(),
                "window_end": end_date.isoformat(),
            },
        )
        print(
            "[state] objectives updated "
            f"signals={len(signals)} new_signals={len(new_signals)} "
            f"knowledge_events={len(knowledge_events)} objectives={len(objectives)} throughlines={len(throughlines)}"
        )
        return str(objectives_path)

    def _load_raw_records_for_range(self, start_date: date, end_date: date) -> List[Dict[str, Any]]:
        records: List[Dict[str, Any]] = []
        current = start_date
        while current <= end_date:
            records.extend(self._load_raw_records_for_date(current))
            current += timedelta(days=1)
        return records

    def _load_knowledge_events_for_range(self, start_date: date, end_date: date) -> List[Dict[str, Any]]:
        activity_path = _resolve_knowledge_activity_path(self.base_path, self.config)
        if not activity_path.exists():
            return []
        events: List[Dict[str, Any]] = []
        with activity_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict):
                    continue
                ts = str(payload.get("ts") or "")
                raw_events: List[Dict[str, Any]] = []
                meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
                if isinstance(meta.get("knowledge_events"), list):
                    raw_events.extend(item for item in meta["knowledge_events"] if isinstance(item, dict))
                event_type = str(payload.get("type") or "")
                if event_type.startswith("knowledge_doc_") and meta:
                    raw_events.append({**meta, "type": str(meta.get("type") or event_type)})

                for raw in raw_events:
                    event = _normalize_knowledge_event(raw, fallback_ts=ts)
                    if not event:
                        continue
                    changed_date = _event_date(str(event.get("changed_at") or ts))
                    if changed_date is None or not (start_date <= changed_date <= end_date):
                        continue
                    events.append(event)

        deduped: Dict[str, Dict[str, Any]] = {}
        for event in events:
            key = "|".join(
                [
                    str(event.get("type") or ""),
                    str(event.get("source_id") or ""),
                    str(event.get("doc_slug") or ""),
                ]
            )
            existing = deduped.get(key)
            if not existing or str(event.get("changed_at") or "") >= str(existing.get("changed_at") or ""):
                deduped[key] = event
        return sorted(deduped.values(), key=lambda item: str(item.get("changed_at") or ""))

    def _signal_in_window(self, signal: Dict[str, Any], start_date: date, end_date: date) -> bool:
        occurred_at = _from_iso_optional(str(signal.get("occurred_at") or ""))
        if occurred_at is None:
            return False
        signal_date = occurred_at.date()
        return start_date <= signal_date <= end_date

    def _load_raw_records_for_date(self, target_date: date) -> List[Dict[str, Any]]:
        records: List[Dict[str, Any]] = []
        date_str = target_date.isoformat()
        for path in sorted(self.base_path.glob(f"buckets/*/raw/{date_str}/*.json")):
            data = read_json(path, default={})
            if not isinstance(data, dict):
                continue
            bucket = str(data.get("bucket") or path.parent.parent.parent.name)
            for channel in data.get("channels", []):
                if not isinstance(channel, dict):
                    continue
                channel_name = str(channel.get("channel_name") or "").strip()
                channel_id = str(channel.get("channel_id") or "").strip()
                channel_topic = str(channel.get("channel_topic") or "").strip()
                for message in channel.get("messages", []):
                    if not isinstance(message, dict):
                        continue
                    content = _clean(str(message.get("content", "")))
                    created_at = str(message.get("created_at") or "").strip()
                    if not content or not created_at:
                        continue
                    metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
                    records.append(
                        {
                            "bucket": bucket,
                            "channel_name": channel_name,
                            "channel_id": channel_id,
                            "channel_topic": channel_topic,
                            "content": content,
                            "created_at": created_at,
                            "jump_url": str(message.get("jump_url") or "").strip(),
                            "message_id": str(message.get("id") or "").strip(),
                            "metadata": metadata,
                            "source_path": str(path.relative_to(self.base_path)),
                        }
                    )
        return records

    def _extract_signals(self, record: Dict[str, Any]) -> List[Dict[str, Any]]:
        metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
        content = str(record.get("content") or "")
        source_system = str(metadata.get("source_system") or metadata.get("source") or "memory").strip() or "memory"
        source_type = str(metadata.get("source_type") or metadata.get("type") or "message").strip() or "message"
        source_id = str(metadata.get("source_id") or record.get("message_id") or "").strip()
        if not source_id:
            source_id = _stable_hash(str(record.get("source_path") or ""), str(record.get("created_at") or ""), content)
        source_record_id = f"{source_system}:{source_type}:{source_id}"
        occurred_at = str(record.get("created_at") or "")
        default_objective_keys = [
            _slugify(item)
            for item in _as_list(metadata.get("objective_keys") or metadata.get("objective_key"))
            if _slugify(item)
        ]
        default_throughline_keys = [
            _slugify(item)
            for item in _as_list(metadata.get("throughline_keys") or metadata.get("throughline_key"))
            if _slugify(item)
        ]
        primary_objective_key = default_objective_keys[0] if default_objective_keys else None
        primary_throughline_key = default_throughline_keys[0] if default_throughline_keys else None

        signals: List[Dict[str, Any]] = []

        def add_signal(
            *,
            kind: str,
            anchor: str,
            confidence_score: float,
            reasons: List[str],
            objective_key: str | None = None,
            throughline_key: str | None = None,
            extra: Dict[str, Any] | None = None,
        ) -> None:
            normalized_anchor = anchor.strip()
            if not normalized_anchor:
                return
            signal_id = "sig_" + _stable_hash(source_record_id, kind, normalized_anchor, occurred_at)
            resolved_objective_key = objective_key if objective_key is not None else primary_objective_key
            resolved_throughline_key = throughline_key if throughline_key is not None else primary_throughline_key
            signal = {
                "signal_id": signal_id,
                "kind": kind,
                "anchor": normalized_anchor,
                "source": source_system,
                "source_type": source_type,
                "source_record_id": source_record_id,
                "occurred_at": occurred_at,
                "confidence_score": confidence_score,
                "confidence_reasons": reasons,
                "objective_key": resolved_objective_key,
                "throughline_key": resolved_throughline_key,
                "evidence": {
                    "url": record.get("jump_url") or metadata.get("url") or "",
                    "text": content[:500],
                    "source_path": record.get("source_path"),
                    "bucket": record.get("bucket"),
                    "channel": record.get("channel_name"),
                },
            }
            if extra:
                signal.update(extra)
            signals.append(signal)

        for normalized in default_objective_keys:
            if normalized:
                add_signal(
                    kind="explicit_objective_key",
                    anchor=f"objective:{normalized}",
                    objective_key=normalized,
                    confidence_score=1.0,
                    reasons=["explicit objective key metadata"],
                )

        for normalized in default_throughline_keys:
            if normalized:
                add_signal(
                    kind="explicit_throughline_key",
                    anchor=f"throughline:{normalized}",
                    throughline_key=normalized,
                    confidence_score=1.0,
                    reasons=["explicit throughline key metadata"],
                )

        for key in ("related_request_number", "request_number", "change_request_number"):
            value = metadata.get(key)
            if value not in (None, ""):
                add_signal(
                    kind="change_request_ref",
                    anchor=f"request:{value}",
                    confidence_score=1.0,
                    reasons=[f"explicit {key} metadata"],
                )

        for key, kind, prefix in (
            ("task_key", "task_ref", "task"),
            ("workflow_key", "workflow_ref", "workflow"),
            ("hook_key", "hook_ref", "hook"),
            ("artifact_id", "artifact_ref", "artifact"),
            ("knowledge_slug", "knowledge_doc_ref", "knowledge"),
            ("doc_slug", "knowledge_doc_ref", "knowledge"),
        ):
            for value in _as_list(metadata.get(key)):
                normalized = _slugify(value)
                if normalized:
                    add_signal(
                        kind=kind,
                        anchor=f"{prefix}:{normalized}",
                        confidence_score=1.0,
                        reasons=[f"explicit {key} metadata"],
                    )

        external_refs = metadata.get("external_refs")
        if isinstance(external_refs, list):
            for ref in external_refs:
                if not isinstance(ref, dict):
                    continue
                system = _slugify(str(ref.get("system") or "external"))
                ref_type = _slugify(str(ref.get("type") or "record"))
                ref_id = _slugify(str(ref.get("id") or ""))
                if system and ref_type and ref_id:
                    add_signal(
                        kind="external_ref",
                        anchor=f"external:{system}:{ref_type}:{ref_id}",
                        confidence_score=1.0,
                        reasons=["explicit external ref metadata"],
                        extra={"external_ref": ref},
                    )

        for match in REQUEST_RE.finditer(content):
            add_signal(
                kind="change_request_ref",
                anchor=f"request:{match.group(1)}",
                confidence_score=0.95,
                reasons=["text request reference"],
            )

        for match in PR_RE.finditer(content):
            add_signal(
                kind="pull_request_ref",
                anchor=f"pr:{match.group(1)}",
                confidence_score=0.9,
                reasons=["text pull request reference"],
            )

        for match in GITHUB_PR_URL_RE.finditer(content):
            add_signal(
                kind="pull_request_ref",
                anchor=f"pr:{match.group(1)}",
                confidence_score=0.95,
                reasons=["github pull request url"],
                extra={"url": _normalize_url(match.group(0))},
            )

        for match in URL_RE.finditer(content):
            url = _normalize_url(match.group(0))
            add_signal(
                kind="url_ref",
                anchor=f"url:{_stable_hash(url)}",
                confidence_score=0.65,
                reasons=["url in content"],
                extra={"url": url},
            )

        return signals

    def _extract_knowledge_event_signals(self, event: Dict[str, Any]) -> List[Dict[str, Any]]:
        event_type = str(event.get("type") or "").strip()
        source_id = _slugify(str(event.get("source_id") or "knowledge"))
        doc_slug = str(event.get("doc_slug") or "").strip()
        changed_at = str(event.get("changed_at") or to_iso(datetime.now(timezone.utc)))
        if not event_type or not doc_slug:
            return []

        doc_anchor = f"knowledge:{doc_slug}"
        source_anchor = f"knowledge-source:{source_id}"
        source_record_id = f"knowledge:{source_id}:{doc_slug}"

        def make_signal(kind: str, anchor: str, confidence_score: float, reasons: List[str]) -> Dict[str, Any]:
            return {
                "signal_id": "sig_" + _stable_hash(source_record_id, kind, anchor, changed_at),
                "kind": kind,
                "anchor": anchor,
                "source": "knowledge",
                "source_type": "github_source",
                "source_record_id": source_record_id,
                "occurred_at": changed_at,
                "confidence_score": confidence_score,
                "confidence_reasons": reasons,
                "objective_key": None,
                "throughline_key": None,
                "evidence": {
                    "url": event.get("url") or "",
                    "text": _clean(" ".join([str(event.get("title") or ""), str(event.get("summary") or "")]))[:500],
                    "source_path": event.get("doc_path") or "",
                    "bucket": "knowledge",
                    "channel": source_id,
                    "source_id": source_id,
                    "doc_slug": doc_slug,
                    "kind": event.get("kind") or "reference",
                },
            }

        return [
            make_signal(
                event_type,
                doc_anchor,
                1.0,
                ["knowledge source activity event"],
            ),
            make_signal(
                "knowledge_source_ref",
                source_anchor,
                0.9,
                ["knowledge source id"],
            ),
        ]

    def _build_objectives(
        self,
        *,
        previous_objectives: List[Any],
        signals: List[Dict[str, Any]],
        target_date: date,
        active_days: int,
        watching_days: int,
    ) -> List[Dict[str, Any]]:
        objectives_by_key: Dict[str, Dict[str, Any]] = {}
        for raw in previous_objectives:
            if not isinstance(raw, dict):
                continue
            key = _slugify(str(raw.get("objective_key") or ""))
            if not key:
                continue
            item = dict(raw)
            item["objective_key"] = key
            item.setdefault("title", _title_from_key(key))
            item.setdefault("aliases", [])
            item.setdefault("owners", [])
            item["anchors"] = []
            item["signal_ids"] = []
            item["sources"] = []
            item["external_refs"] = []
            item["last_signal_at"] = None
            objectives_by_key[key] = item

        for signal in signals:
            objective_key = self._objective_key_for_signal(signal)
            if not objective_key:
                continue
            objective = objectives_by_key.get(objective_key)
            if objective is None:
                objective = {
                    "objective_key": objective_key,
                    "title": _title_from_key(objective_key),
                    "status": "inactive",
                    "anchors": [],
                    "signal_ids": [],
                    "sources": [],
                    "aliases": [],
                    "owners": [],
                    "external_refs": [],
                    "archived": False,
                    "summary": "",
                    "last_signal_at": None,
                    "last_enriched_at": None,
                    "enrichment_status": "disabled",
                    "activity_score": 0.0,
                    "attention_score": 0.0,
                    "confidence_score": 0.0,
                    "score_reasons": [],
                }
                objectives_by_key[objective_key] = objective
            self._append_unique(objective.setdefault("anchors", []), str(signal.get("anchor") or ""))
            self._append_unique(objective.setdefault("signal_ids", []), str(signal.get("signal_id") or ""))
            self._append_unique(objective.setdefault("sources", []), str(signal.get("source") or "memory"))
            objective["last_signal_at"] = _max_iso(objective.get("last_signal_at"), signal.get("occurred_at"))
            if isinstance(signal.get("external_ref"), dict):
                if signal["external_ref"] not in objective.setdefault("external_refs", []):
                    objective["external_refs"].append(signal["external_ref"])

        objectives: List[Dict[str, Any]] = []
        for objective in objectives_by_key.values():
            status, activity_score, attention_score, reasons = self._scores_for_objective(
                objective=objective,
                signals=signals,
                target_date=target_date,
                active_days=active_days,
                watching_days=watching_days,
            )
            if bool(objective.get("archived", False)):
                status = "archived"
                activity_score = 0.0
            objective["status"] = status
            objective["activity_score"] = activity_score
            objective["attention_score"] = attention_score
            objective["confidence_score"] = self._confidence_for_objective(objective, signals)
            objective["score_reasons"] = reasons
            objectives.append(objective)

        return sorted(objectives, key=lambda item: str(item.get("objective_key") or ""))

    def _objective_key_for_signal(self, signal: Dict[str, Any]) -> str | None:
        explicit = _slugify(str(signal.get("objective_key") or ""))
        if explicit:
            return explicit
        anchor = str(signal.get("anchor") or "")
        kind = str(signal.get("kind") or "")
        if kind == "explicit_throughline_key":
            return None
        if anchor.startswith("url:"):
            return None
        if anchor.startswith("knowledge:"):
            return None
        return _slugify(anchor.replace(":", "-"))

    def _build_throughlines(self, *, signals: List[Dict[str, Any]], objectives: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        objectives_by_anchor = {
            anchor: objective
            for objective in objectives
            for anchor in objective.get("anchors", [])
            if isinstance(anchor, str)
        }
        throughlines_by_key: Dict[str, Dict[str, Any]] = {}
        for signal in signals:
            key = _slugify(str(signal.get("throughline_key") or ""))
            if not key:
                continue
            throughline = throughlines_by_key.get(key)
            if throughline is None:
                throughline = {
                    "throughline_key": key,
                    "title": _title_from_key(key),
                    "summary": "",
                    "status": "active",
                    "objective_keys": [],
                    "signal_ids": [],
                    "last_signal_at": None,
                    "enrichment_status": "disabled",
                }
                throughlines_by_key[key] = throughline
            self._append_unique(throughline["signal_ids"], str(signal.get("signal_id") or ""))
            objective = objectives_by_anchor.get(str(signal.get("anchor") or ""))
            if objective:
                self._append_unique(throughline["objective_keys"], str(objective.get("objective_key") or ""))
            throughline["last_signal_at"] = _max_iso(throughline.get("last_signal_at"), signal.get("occurred_at"))

        return sorted(throughlines_by_key.values(), key=lambda item: str(item.get("throughline_key") or ""))

    def _scores_for_objective(
        self,
        *,
        objective: Dict[str, Any],
        signals: List[Dict[str, Any]],
        target_date: date,
        active_days: int,
        watching_days: int,
    ) -> tuple[str, float, float, List[str]]:
        last_signal = _from_iso_optional(objective.get("last_signal_at"))
        if last_signal is None:
            return "inactive", 0.0, 0.0, ["no signals"]

        age_days = (_date_floor(target_date) - last_signal.replace(hour=0, minute=0, second=0, microsecond=0)).days
        signal_ids = set(objective.get("signal_ids", []))
        objective_signals = [signal for signal in signals if signal.get("signal_id") in signal_ids]
        recent_signals = [
            signal for signal in objective_signals
            if (_date_floor(target_date) - (_from_iso_optional(signal.get("occurred_at")) or _date_floor(target_date)).replace(hour=0, minute=0, second=0, microsecond=0)).days <= active_days
        ]

        if age_days <= active_days:
            status = "active"
            activity_score = min(1.0, 0.55 + (0.08 * len(recent_signals)))
        elif age_days <= watching_days:
            status = "watching"
            activity_score = 0.45
        else:
            status = "inactive"
            activity_score = 0.15

        attention_score = 0.0
        reasons: List[str] = []
        if recent_signals:
            reasons.append(f"{len(recent_signals)} signal(s) in the last {active_days} day(s)")
        else:
            reasons.append(f"last signal {age_days} day(s) ago")
        kinds = {str(signal.get("kind") or "") for signal in objective_signals}
        if "change_request_ref" in kinds:
            attention_score += 0.2
            reasons.append("has change request reference")
        if "task_ref" in kinds or "workflow_ref" in kinds or "hook_ref" in kinds:
            attention_score += 0.15
            reasons.append("has automation reference")
        if "explicit_objective_key" in kinds:
            attention_score += 0.1
            reasons.append("has explicit objective key")
        attention_score = min(1.0, attention_score + (0.1 * len(recent_signals)))
        return status, round(activity_score, 2), round(attention_score, 2), reasons

    def _confidence_for_objective(self, objective: Dict[str, Any], signals: List[Dict[str, Any]]) -> float:
        signal_ids = set(objective.get("signal_ids", []))
        scores = [
            float(signal.get("confidence_score") or 0.0)
            for signal in signals
            if signal.get("signal_id") in signal_ids
        ]
        if not scores:
            return 0.0
        return round(sum(scores) / len(scores), 2)

    @staticmethod
    def _source_counts(signals: List[Dict[str, Any]]) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for signal in signals:
            source = str(signal.get("source") or "memory")
            counts[source] = counts.get(source, 0) + 1
        return counts

    @staticmethod
    def _status_counts(objectives: List[Dict[str, Any]]) -> Dict[str, int]:
        counts = {"active": 0, "watching": 0, "inactive": 0, "archived": 0}
        for objective in objectives:
            status = str(objective.get("status") or "inactive")
            if status not in counts:
                status = "inactive"
            counts[status] += 1
        return counts

    @staticmethod
    def _append_unique(items: List[str], value: str) -> None:
        if value and value not in items:
            items.append(value)

    @staticmethod
    def _coerce_positive_int(value: Any, *, default: int) -> int:
        try:
            num = int(value)
        except (TypeError, ValueError):
            return default
        return num if num > 0 else default

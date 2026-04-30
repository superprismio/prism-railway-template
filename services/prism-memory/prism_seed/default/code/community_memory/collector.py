from __future__ import annotations

import re
import shutil
from datetime import datetime, timedelta, timezone
from hashlib import sha1
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .agentic_ingest import AgenticIngestEnricher
from .activity import ActivityLogger
from .config_loader import CollectorConfig, SpaceConfig
from .state_manager import StateManager
from .utils import ensure_dir, from_iso, read_json, to_iso, utc_now, write_json


class InboxMemoryCollector:
    def __init__(
        self,
        base_path: Path,
        config: SpaceConfig,
        collector_conf: CollectorConfig,
        state: StateManager,
        activity: ActivityLogger,
    ) -> None:
        self.base_path = base_path
        self.config = config
        self.collector_conf = collector_conf
        self.state = state
        self.activity = activity
        self.collector_key = collector_conf.key

        inbox_conf = config.inbox or {}
        memory_conf = inbox_conf.get("memory", {}) if isinstance(inbox_conf, dict) else {}
        self.incoming_dir = self.base_path / "inbox" / "memory" / "incoming"
        self.processed_dir = self.base_path / "inbox" / "memory" / "processed"
        self.rejected_dir = self.base_path / "inbox" / "memory" / "rejected"
        self.default_bucket = str(memory_conf.get("default_bucket", "knowledge"))
        self.channel_name = str(memory_conf.get("channel_name", "memory-inbox"))
        self.max_files_per_run = int(memory_conf.get("max_files_per_run", 100))
        self.allowed_extensions = {
            ext if ext.startswith(".") else f".{ext}"
            for ext in memory_conf.get("allowed_extensions", [".md", ".json"])
        }
        self.agentic_ingest = AgenticIngestEnricher(config=config, activity=activity)

    def run(
        self,
        now: Optional[datetime] = None,
        force: bool = False,
        backfill_hours: Optional[int] = None,
    ) -> Dict[str, Any]:
        del now, force, backfill_hours
        if not self.collector_conf.enabled:
            return {"status": "disabled"}

        ensure_dir(self.incoming_dir)
        ensure_dir(self.processed_dir)
        ensure_dir(self.rejected_dir)

        candidates = sorted(
            [
                path
                for path in self.incoming_dir.iterdir()
                if path.is_file() and path.suffix.lower() in self.allowed_extensions
            ]
        )[: self.max_files_per_run]
        if not candidates:
            return {"status": "noop", "reason": "no_inbox_files"}

        outputs: List[str] = []
        processed = 0
        rejected = 0
        for path in candidates:
            try:
                payload = self._read_payload(path)
                record = self._validate_payload(payload, path)
                record = self.agentic_ingest.enrich(record)
                output = self._write_transcript(record, path)
                outputs.append(output)
                self._move_with_suffix(path, self.processed_dir)
                processed += 1
            except Exception as exc:
                rejected += 1
                rejected_path = self._move_with_suffix(path, self.rejected_dir)
                self.activity.log(
                    "error",
                    collector_key=self.collector_key,
                    run_key=datetime.now(timezone.utc).date().isoformat(),
                    inputs=[str(path.relative_to(self.base_path))],
                    outputs=[str(rejected_path.relative_to(self.base_path))],
                    meta={"error": str(exc), "source": "inbox_memory"},
                )

        collector_state = self.state.get_collector_state(self.collector_key)
        collector_state.update(
            {
                "last_until": to_iso(utc_now()),
                "processed_last_run": processed,
                "rejected_last_run": rejected,
            }
        )
        self.state.update_collector_state(self.collector_key, collector_state)

        return {
            "status": "ok",
            "outputs": outputs,
            "windows_processed": processed,
            "rejected": rejected,
        }

    def _read_payload(self, path: Path) -> Dict[str, Any]:
        if path.suffix.lower() == ".json":
            data = read_json(path, default={})
            if not isinstance(data, dict):
                raise ValueError("JSON inbox payload must be an object")
            return data

        text = path.read_text(encoding="utf-8")
        frontmatter, body = self._parse_frontmatter(text)
        payload = dict(frontmatter)
        payload["content"] = body.strip()
        return payload

    def _parse_frontmatter(self, text: str) -> Tuple[Dict[str, str], str]:
        if not text.startswith("---\n"):
            return {}, text
        lines = text.splitlines()
        meta: Dict[str, str] = {}
        end_idx = None
        for idx in range(1, len(lines)):
            line = lines[idx]
            if line.strip() == "---":
                end_idx = idx
                break
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip()
        if end_idx is None:
            return {}, text
        body = "\n".join(lines[end_idx + 1 :])
        return meta, body

    @staticmethod
    def _coerce_participants(value: Any) -> List[str]:
        if value is None:
            return []
        items = value if isinstance(value, list) else [value]
        participants: List[str] = []
        for item in items:
            name = str(item).strip()
            if not name:
                continue
            participants.append(name)
        return participants

    def _validate_payload(self, payload: Dict[str, Any], source_path: Path) -> Dict[str, Any]:
        missing = [key for key in ("source", "ts", "type") if not str(payload.get(key, "")).strip()]
        if missing:
            raise ValueError(f"missing required inbox fields: {', '.join(missing)}")

        content = str(payload.get("content", "")).strip()
        if not content:
            raise ValueError("missing content body")

        created_at = from_iso(str(payload.get("ts")))
        bucket = str(payload.get("bucket_hint") or payload.get("bucket") or self.default_bucket)
        author = str(payload.get("author") or "inbox-user")
        source = str(payload.get("source"))
        msg_type = str(payload.get("type"))
        jump_url = str(payload.get("url") or "")
        participants = self._coerce_participants(payload.get("participants"))
        participant_count = payload.get("participant_count")
        if participant_count is None and participants:
            participant_count = len(participants)
        normalized_count = None
        if participant_count is not None:
            try:
                normalized_count = int(participant_count)
            except (TypeError, ValueError):
                raise ValueError("participant_count must be an integer")
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        return {
            "bucket": bucket,
            "author": author,
            "content": content,
            "created_at": created_at,
            "source": source,
            "type": msg_type,
            "jump_url": jump_url,
            "source_file": source_path.name,
            "participants": participants,
            "participant_count": normalized_count,
            "metadata": metadata,
        }

    def _safe_slug(self, value: str) -> str:
        slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-").lower()
        return slug[:48] or "inbox"

    def _unique_path(self, directory: Path, filename: str) -> Path:
        target = directory / filename
        if not target.exists():
            return target
        stem = target.stem
        suffix = target.suffix
        idx = 1
        while True:
            candidate = directory / f"{stem}-{idx}{suffix}"
            if not candidate.exists():
                return candidate
            idx += 1

    def _move_with_suffix(self, source: Path, dest_dir: Path) -> Path:
        ensure_dir(dest_dir)
        target = self._unique_path(dest_dir, source.name)
        shutil.move(str(source), str(target))
        return target

    def _write_transcript(self, record: Dict[str, Any], source_path: Path) -> str:
        since = record["created_at"].replace(second=0, microsecond=0)
        until = since + timedelta(minutes=1)
        date_str = since.strftime("%Y-%m-%d")
        slug = self._safe_slug(source_path.stem)
        file_stem = f"{since.strftime('%H%M')}-{until.strftime('%H%M')}-inbox-{slug}"
        raw_dir = self.base_path / "buckets" / record["bucket"] / "raw" / date_str
        ensure_dir(raw_dir)
        md_path = raw_dir / f"{file_stem}.md"
        json_path = raw_dir / f"{file_stem}.json"

        message_id = sha1(
            f"{record['source']}|{record['type']}|{record['source_file']}|{record['content']}".encode(
                "utf-8"
            )
        ).hexdigest()[:16]
        message_metadata = {
            **dict(record.get("metadata") or {}),
            **{
                key: value
                for key, value in {
                    "participants": record.get("participants", []),
                    "participant_count": record.get("participant_count"),
                }.items()
                if value not in (None, [])
            },
        }
        message = {
            "id": message_id,
            "author": {
                "id": "inbox-memory",
                "username": "inbox-memory",
                "display_name": record["author"],
            },
            "content": record["content"],
            "created_at": to_iso(record["created_at"]),
            "jump_url": record["jump_url"],
            "attachments": [],
            "embeds": [],
            "metadata": message_metadata,
        }
        window_key = f"{to_iso(since).replace(':', '')}_{to_iso(until).replace(':', '')}"

        lines = [
            "# Memory Inbox Transcript Window",
            f"bucket: {record['bucket']}",
            f"since: {to_iso(since)}",
            f"until: {to_iso(until)}",
            "totals: messages=1 channels=1",
            "skipped_count: 0",
            "",
            f"## Channel: {self.channel_name} (inbox-memory)",
            f"topic: inbox source={record['source']} type={record['type']} file={record['source_file']}",
            f"- [{to_iso(record['created_at'])}] **{record['author']}**: {record['content']} ({record['jump_url']})",
            "",
            "## Skipped",
            "- none",
        ]
        md_path.write_text("\n".join(lines), encoding="utf-8")
        write_json(
            json_path,
            {
                "bucket": record["bucket"],
                "since": to_iso(since),
                "until": to_iso(until),
                "window_key": window_key,
                "channels": [
                    {
                        "channel_id": "inbox-memory",
                        "category_id": "inbox-memory",
                        "channel_name": self.channel_name,
                        "channel_topic": f"inbox source={record['source']} type={record['type']}",
                        "messages": [message],
                    }
                ],
                "skipped": [],
                "totals": {"channels": 1, "messages": 1},
            },
        )
        self.activity.log(
            "collector.completed",
            collector_key=self.collector_key,
            bucket=record["bucket"],
            run_key=window_key,
            inputs=[str(source_path.relative_to(self.base_path))],
            outputs=[str(md_path.relative_to(self.base_path))],
            meta={
                "source": record["source"],
                "type": record["type"],
                "source_file": record["source_file"],
                "since": to_iso(since),
                "until": to_iso(until),
                "agentic_ingest": (record.get("metadata") or {}).get("agentic_ingest"),
            },
        )
        print(
            f"[collector] inbox_memory wrote {record['bucket']} raw/{date_str}/{file_stem}.md "
            f"(source={record['source']} type={record['type']})"
        )
        return str(md_path)

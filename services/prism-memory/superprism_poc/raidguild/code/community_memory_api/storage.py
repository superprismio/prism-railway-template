from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


_BUCKET_RE = re.compile(r"^[a-z0-9_-]+$")
_SAFE_DOC_RE = re.compile(r"^[a-zA-Z0-9._-]+$")


class StorageError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class FilesystemStorageBackend:
    """Filesystem-backed storage backend for Prism Memory artifacts."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.knowledge_root = (self.root / "knowledge" / "kb").resolve()
        self.knowledge_docs = (self.knowledge_root / "docs").resolve()
        self.knowledge_metadata = (self.knowledge_root / "metadata").resolve()
        self.knowledge_indexes = (self.knowledge_root / "indexes").resolve()
        self.knowledge_inbox = (self.knowledge_root / "triage" / "inbox").resolve()
        self.memory_inbox = (self.root / "inbox" / "memory" / "incoming").resolve()
        self._root_prefix = tuple(self.root.parts[-2:])

    def _load_json(self, path: Path) -> Any:
        if not path.is_file():
            raise StorageError("not_found", f"File not found: {path}")
        try:
            with path.open("r", encoding="utf-8") as fh:
                return json.load(fh)
        except json.JSONDecodeError as exc:
            raise StorageError("malformed_json", f"Malformed JSON: {path.name}") from exc

    def memory_latest(self) -> Any:
        return self._load_json(self.root / "memory" / "rolling" / "latest.json")

    def memory_by_date(self, date_str: str) -> Any:
        self._validate_date(date_str)
        return self._load_json(self.root / "memory" / "rolling" / f"{date_str}.json")

    def state_latest(self) -> Any:
        return self._load_json(self.root / "state" / "latest.json")

    def state_projects(self) -> Any:
        return self._load_json(self.root / "state" / "current" / "projects.json")

    def upsert_state_project(self, project_key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        normalized_key = self._safe_slug(project_key)
        if not normalized_key:
            raise StorageError("invalid_project_key", "project_key is required")

        current_path = self.root / "state" / "current" / "projects.json"
        latest_path = self.root / "state" / "latest.json"
        existing = {"generated_at": None, "as_of_date": None, "projects": []}
        if current_path.is_file():
            loaded = self._load_json(current_path)
            if isinstance(loaded, dict):
                existing.update(loaded)

        projects = [item for item in existing.get("projects", []) if isinstance(item, dict)]
        project = None
        for item in projects:
            if self._safe_slug(str(item.get("project_key", ""))) == normalized_key:
                project = item
                break
        if project is None:
            project = {
                "project_key": normalized_key,
                "display_name": normalized_key.replace("-", " ").title(),
                "description": "",
                "status": "inactive",
                "archived": False,
                "source_channels": [],
                "aliases": [],
                "tags": [],
                "owners": [],
                "last_direct_activity_at": None,
                "last_indirect_activity_at": None,
                "derived_from": ["manual"],
                "activity_score": 0.0,
                "review_by": None,
                "source": {"mode": "manual"},
            }
            projects.append(project)
        else:
            project.setdefault("display_name", normalized_key.replace("-", " ").title())
            project.setdefault("description", "")
            project.setdefault("aliases", [])
            project.setdefault("tags", [])
            project.setdefault("owners", [])
            project.setdefault("source_channels", [])
            project.setdefault("derived_from", [])
            project.setdefault("source", {"mode": "manual"})

        if "display_name" in payload and payload["display_name"] is not None:
            project["display_name"] = str(payload["display_name"]).strip() or project["display_name"]
        if "description" in payload and payload["description"] is not None:
            project["description"] = str(payload["description"]).strip()
        if "aliases" in payload and payload["aliases"] is not None:
            project["aliases"] = self._coerce_str_list(payload["aliases"])
        if "tags" in payload and payload["tags"] is not None:
            project["tags"] = self._coerce_str_list(payload["tags"])
        if "owners" in payload and payload["owners"] is not None:
            project["owners"] = self._coerce_str_list(payload["owners"])
        if "archived" in payload and payload["archived"] is not None:
            project["archived"] = bool(payload["archived"])

        generated_at = self._to_iso(datetime.now(timezone.utc))
        as_of_date = datetime.now(timezone.utc).date().isoformat()
        projects.sort(key=lambda item: str(item.get("project_key", "")))
        current_payload = {
            "generated_at": generated_at,
            "as_of_date": as_of_date,
            "projects": projects,
        }
        current_path.parent.mkdir(parents=True, exist_ok=True)
        with current_path.open("w", encoding="utf-8") as handle:
            json.dump(current_payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")

        counts = {"active": 0, "watching": 0, "inactive": 0, "archived": 0}
        for item in projects:
            status = str(item.get("status") or "inactive")
            if bool(item.get("archived", False)):
                status = "archived"
            if status not in counts:
                status = "inactive"
            counts[status] += 1
        latest_payload = {
            "generated_at": generated_at,
            "domains": {
                "projects": {
                    "source_path": "state/current/projects.json",
                    "updated_at": generated_at,
                    "summary": (
                        f"{counts['active']} active, {counts['watching']} watching, "
                        f"{counts['inactive']} inactive, {counts['archived']} archived."
                    ),
                }
            },
            "recent_changes": [
                {
                    "domain": "projects",
                    "change_type": "updated",
                    "summary": f"Project '{normalized_key}' metadata updated.",
                    "updated_at": generated_at,
                    "source_path": "state/current/projects.json",
                }
            ],
        }
        latest_path.parent.mkdir(parents=True, exist_ok=True)
        with latest_path.open("w", encoding="utf-8") as handle:
            json.dump(latest_payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")

        return {
            "path": str(current_path.relative_to(self.root)),
            "latest_path": str(latest_path.relative_to(self.root)),
            "project_key": normalized_key,
            "updated_at": generated_at,
            "project": project,
        }

    def digests_by_date(self, date_str: str) -> Dict[str, Any]:
        self._validate_date(date_str)
        buckets_dir = self.root / "buckets"
        result: Dict[str, Any] = {}
        if not buckets_dir.is_dir():
            raise StorageError("not_found", "No buckets directory present")
        for bucket_path in buckets_dir.iterdir():
            if not bucket_path.is_dir():
                continue
            digest_path = bucket_path / "digests" / f"{date_str}.json"
            if digest_path.is_file():
                result[bucket_path.name] = self._load_json(digest_path)
        if not result:
            raise StorageError("not_found", f"No digests found for {date_str}")
        return {"date": date_str, "buckets": result}

    def digest_for_bucket(self, bucket: str, date_str: str) -> Any:
        self._validate_date(date_str)
        self._validate_bucket(bucket)
        digest_path = self.root / "buckets" / bucket / "digests" / f"{date_str}.json"
        return self._load_json(digest_path)

    def bucket_digest_asset(self, bucket: str, date_str: str, extension: str) -> tuple[str, Any]:
        self._validate_date(date_str)
        self._validate_bucket(bucket)
        ext = extension.lower().lstrip(".")
        if ext not in {"json", "md"}:
            raise StorageError("invalid_format", "Digest format must be 'json' or 'md'")
        digest_path = self.root / "buckets" / bucket / "digests" / f"{date_str}.{ext}"
        if ext == "json":
            return ("application/json", self._load_json(digest_path))
        if not digest_path.is_file():
            raise StorageError("not_found", f"File not found: {digest_path}")
        try:
            content = digest_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise StorageError("not_found", f"Unable to read digest: {digest_path}") from exc
        return ("text/markdown", content)

    def activity_recent(
        self,
        limit: int = 100,
        event_type: Optional[str] = None,
        bucket: Optional[str] = None,
        collector_key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        log_path = self.root / "activity" / "activity.jsonl"
        if not log_path.is_file():
            raise StorageError("not_found", "activity log missing")
        try:
            lines = log_path.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            raise StorageError("not_found", "Unable to read activity log") from exc
        entries: List[Dict[str, Any]] = []
        for raw in reversed(lines):
            raw = raw.strip()
            if not raw:
                continue
            try:
                record = json.loads(raw)
            except json.JSONDecodeError:
                # skip malformed lines but keep processing
                continue
            if event_type and record.get("type") != event_type:
                continue
            if bucket and record.get("meta", {}).get("bucket") != bucket:
                continue
            if collector_key and record.get("meta", {}).get("collector_key") != collector_key:
                continue
            entries.append(record)
            if len(entries) >= limit:
                break
        return entries

    def participant_activity(
        self,
        *,
        start: str,
        end: str,
        bucket: Optional[str] = None,
        limit: int = 25,
    ) -> Dict[str, Any]:
        start_dt = self._parse_iso_datetime(start, field="start")
        end_dt = self._parse_iso_datetime(end, field="end")
        if end_dt <= start_dt:
            raise StorageError("invalid_query", "end must be later than start")
        if bucket:
            self._validate_bucket(bucket)

        buckets_dir = self.root / "buckets"
        if not buckets_dir.is_dir():
            raise StorageError("not_found", "No buckets directory present")

        participant_map: Dict[str, Dict[str, Any]] = {}
        for raw_path in self._iter_raw_window_paths(start_dt, end_dt, bucket=bucket):
            payload = self._load_json(raw_path)
            bucket_name = str(payload.get("bucket") or raw_path.parts[-4])
            for channel in payload.get("channels", []):
                channel_name = str(channel.get("channel_name") or channel.get("channel_id") or "unknown")
                channel_topic = str(channel.get("channel_topic") or "")
                source_names = self._channel_sources(channel_name, channel_topic)
                for message in channel.get("messages", []):
                    created_raw = message.get("created_at")
                    if not created_raw:
                        continue
                    try:
                        created_dt = self._parse_iso_datetime(str(created_raw), field="created_at")
                    except StorageError:
                        continue
                    if created_dt < start_dt or created_dt >= end_dt:
                        continue
                    author_name = self._message_author(message)
                    if not author_name:
                        continue
                    entry = participant_map.setdefault(
                        author_name,
                        {
                            "participant": author_name,
                            "message_count": 0,
                            "first_seen": created_dt,
                            "last_seen": created_dt,
                            "buckets": set(),
                            "channels": set(),
                            "sources": set(),
                            "participant_mentions": 0,
                        },
                    )
                    entry["message_count"] += 1
                    if created_dt < entry["first_seen"]:
                        entry["first_seen"] = created_dt
                    if created_dt > entry["last_seen"]:
                        entry["last_seen"] = created_dt
                    entry["buckets"].add(bucket_name)
                    entry["channels"].add(channel_name)
                    entry["sources"].update(source_names)

                    metadata = message.get("metadata") or {}
                    for participant in self._coerce_str_list(metadata.get("participants")):
                        if participant == author_name:
                            continue
                        mention_entry = participant_map.setdefault(
                            participant,
                            {
                                "participant": participant,
                                "message_count": 0,
                                "first_seen": created_dt,
                                "last_seen": created_dt,
                                "buckets": set(),
                                "channels": set(),
                                "sources": set(),
                                "participant_mentions": 0,
                            },
                        )
                        if created_dt < mention_entry["first_seen"]:
                            mention_entry["first_seen"] = created_dt
                        if created_dt > mention_entry["last_seen"]:
                            mention_entry["last_seen"] = created_dt
                        mention_entry["buckets"].add(bucket_name)
                        mention_entry["channels"].add(channel_name)
                        mention_entry["sources"].update(source_names)
                        mention_entry["participant_mentions"] += 1

        results = [
            {
                "participant": item["participant"],
                "message_count": item["message_count"],
                "bucket_count": len(item["buckets"]),
                "channel_count": len(item["channels"]),
                "first_seen": self._to_iso(item["first_seen"]),
                "last_seen": self._to_iso(item["last_seen"]),
                "buckets": sorted(item["buckets"]),
                "channels": sorted(item["channels"]),
                "sources": sorted(item["sources"]),
                "participant_mentions": item["participant_mentions"],
            }
            for item in participant_map.values()
        ]
        results.sort(
            key=lambda item: (
                -item["message_count"],
                -item["participant_mentions"],
                item["participant"].lower(),
            )
        )
        return {
            "start": self._to_iso(start_dt),
            "end": self._to_iso(end_dt),
            "bucket": bucket,
            "limit": limit,
            "total_participants": len(results),
            "results": results[:limit],
        }

    def knowledge_doc(self, slug: str) -> Dict[str, Any]:
        normalized, entry = self._resolve_manifest_entry(slug)
        doc_path = self._rooted_path(entry["path"])
        meta_path = self._rooted_path(entry["meta_path"])
        if not doc_path.is_file():
            raise StorageError("not_found", f"Knowledge doc missing at {doc_path}")
        metadata = self._load_json(meta_path)
        try:
            content = doc_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise StorageError("not_found", f"Unable to read document body: {doc_path}") from exc
        return {
            "slug": metadata.get("slug") or normalized,
            "path": str(doc_path.relative_to(self.root)),
            "meta_path": str(meta_path.relative_to(self.root)),
            "kind": metadata.get("kind"),
            "title": metadata.get("title"),
            "summary": metadata.get("summary"),
            "updated": metadata.get("updated"),
            "tags": metadata.get("tags"),
            "entities": metadata.get("entities"),
            "metadata": metadata,
            "content": content,
        }

    def knowledge_search(
        self,
        query: Optional[str] = None,
        kind: Optional[str] = None,
        tag: Optional[str] = None,
        entity: Optional[str] = None,
        limit: int = 25,
    ) -> Dict[str, Any]:
        if not any([query, kind, tag, entity]):
            raise StorageError("invalid_query", "Provide at least one of q, kind, tag, or entity")
        normalized_query = (query or "").strip().lower()
        tokens = tuple(dict.fromkeys(token for token in normalized_query.split() if token))
        manifest = self._load_manifest()
        results: List[Dict[str, Any]] = []
        for entry in manifest:
            if kind and entry.get("kind") != kind:
                continue
            tags_list = entry.get("tags") or []
            entities_list = entry.get("entities") or []
            if tag and tag not in tags_list:
                continue
            if entity and entity not in entities_list:
                continue
            matched_tokens: Set[str] = set()
            match_sources: List[str] = []
            metadata_hits: Set[str] = set()
            body_hits: Set[str] = set()
            if tokens:
                haystack = " ".join(
                    [
                        entry.get("title", ""),
                        entry.get("summary", ""),
                        " ".join(tags_list),
                        " ".join(entities_list),
                    ]
                ).lower()
                metadata_hits = self._tokens_in_text(haystack, tokens)
                if metadata_hits:
                    matched_tokens.update(metadata_hits)
                    match_sources.append("metadata")
                if len(matched_tokens) < len(tokens):
                    body_hits = self._tokens_in_doc(entry, tokens)
                    if body_hits:
                        matched_tokens.update(body_hits)
                        match_sources.append("body")
                if not matched_tokens:
                    continue
                score = len(matched_tokens)
            else:
                score = 1
            slug_value = self._slug_from_entry(entry)
            results.append(
                {
                    "slug": slug_value,
                    "title": entry.get("title"),
                    "summary": entry.get("summary"),
                    "kind": entry.get("kind"),
                    "updated": entry.get("updated"),
                    "tags": tags_list,
                    "entities": entities_list,
                    "path": entry.get("path"),
                    "meta_path": entry.get("meta_path"),
                    "score": score,
                    "match_tokens": sorted(matched_tokens) if matched_tokens else [],
                    "match_sources": match_sources,
                }
            )
        results.sort(key=lambda item: (-item["score"], item.get("title") or ""))
        return {
            "query": query,
            "filters": {
                "kind": kind,
                "tag": tag,
                "entity": entity,
            },
            "total": len(results),
            "results": results[:limit],
        }

    def knowledge_index(self, name: str) -> Any:
        allowed = {"manifest", "tags", "entities"}
        if name not in allowed:
            raise StorageError("invalid_query", f"Unsupported knowledge index '{name}'")
        path = self.knowledge_indexes / f"{name}.json"
        return self._load_json(path)

    def product_suggestion_latest(self) -> Any:
        suggestions_dir = self.root / "products" / "suggestions"
        candidates = sorted(
            path
            for path in suggestions_dir.glob("????-??-??.json")
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.json", path.name)
        )
        if not candidates:
            raise StorageError("not_found", "No daily product suggestions found")
        return self._load_json(candidates[-1])

    def product_suggestion_by_date(self, date_str: str) -> Any:
        self._validate_date(date_str)
        path = self.root / "products" / "suggestions" / f"{date_str}.json"
        return self._load_json(path)

    def product_suggestion_weekly(self, week_key: str) -> Any:
        self._validate_week(week_key)
        path = self.root / "products" / "suggestions" / f"weekly-{week_key}.json"
        return self._load_json(path)

    def _iter_raw_window_paths(
        self, start_dt: datetime, end_dt: datetime, *, bucket: Optional[str] = None
    ) -> List[Path]:
        days: List[str] = []
        cursor = start_dt.date()
        end_date = (end_dt - timedelta(seconds=1)).date()
        while cursor <= end_date:
            days.append(cursor.isoformat())
            cursor += timedelta(days=1)

        raw_paths: List[Path] = []
        bucket_names = [bucket] if bucket else sorted(
            path.name for path in (self.root / "buckets").iterdir() if path.is_dir()
        )
        for bucket_name in bucket_names:
            for day in days:
                day_dir = self.root / "buckets" / bucket_name / "raw" / day
                if not day_dir.is_dir():
                    continue
                raw_paths.extend(sorted(day_dir.glob("*.json")))
        return raw_paths

    @staticmethod
    def _message_author(message: Dict[str, Any]) -> str:
        author = message.get("author")
        if isinstance(author, dict):
            return str(author.get("display_name") or author.get("username") or "").strip()
        return str(author or "").strip()

    @staticmethod
    def _coerce_str_list(value: Any) -> List[str]:
        if not isinstance(value, list):
            return []
        items: List[str] = []
        seen: Set[str] = set()
        for raw in value:
            item = str(raw).strip()
            if not item or item in seen:
                continue
            seen.add(item)
            items.append(item)
        return items

    @staticmethod
    def _channel_sources(channel_name: str, channel_topic: str) -> Set[str]:
        sources: Set[str] = set()
        lowered_name = channel_name.lower()
        lowered_topic = channel_topic.lower()
        if lowered_name == "latest-meetings" or "latest-meetings" in lowered_topic:
            sources.add("meetings")
        elif lowered_name == "memory-inbox" or lowered_name.endswith("-inbox") or "inbox source=" in lowered_topic:
            sources.add("inbox")
        else:
            sources.add("discord")
        return sources

    @staticmethod
    def _parse_iso_datetime(value: str, *, field: str) -> datetime:
        raw = (value or "").strip()
        if not raw:
            raise StorageError("invalid_query", f"{field} is required")
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError as exc:
            raise StorageError(
                "invalid_query",
                f"{field} must be an ISO-8601 datetime",
            ) from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    @staticmethod
    def _to_iso(value: datetime) -> str:
        return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace(
            "+00:00", "Z"
        )

    @staticmethod
    def _validate_date(date_str: str) -> None:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_str):
            raise StorageError("invalid_date", "Date must be YYYY-MM-DD")

    @staticmethod
    def _validate_bucket(bucket: str) -> None:
        if not _BUCKET_RE.fullmatch(bucket):
            raise StorageError("invalid_bucket", "Bucket may contain a-z, 0-9, '_' or '-' only")

    @staticmethod
    def _validate_week(week_key: str) -> None:
        if not re.fullmatch(r"\d{4}-W\d{2}", week_key):
            raise StorageError("invalid_date", "Week must be YYYY-WW")

    def write_knowledge_inbox_entry(
        self,
        filename: str,
        content: str,
        metadata: Dict[str, Any],
    ) -> Dict[str, str]:
        normalized = Path(filename).name.strip()
        if not normalized:
            raise StorageError("invalid_filename", "Filename is required")
        stem, suffix = os.path.splitext(normalized)
        if not suffix:
            normalized = f"{normalized}.md"
        elif suffix.lower() != ".md":
            raise StorageError("invalid_filename", "Knowledge docs must use a .md extension")
        if not _SAFE_DOC_RE.fullmatch(normalized):
            raise StorageError("invalid_filename", "Filename may contain letters, numbers, '.', '_' or '-' only")

        inbox = self.knowledge_inbox
        inbox.mkdir(parents=True, exist_ok=True)
        doc_path = inbox / normalized
        if doc_path.exists():
            raise StorageError("file_exists", f"{doc_path.name} already exists")

        meta_path = doc_path.with_suffix(".meta.json")
        doc_path.write_text(content, encoding="utf-8")
        with meta_path.open("w", encoding="utf-8") as handle:
            json.dump(metadata, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")

        return {
            "doc_path": str(doc_path.relative_to(self.root)),
            "meta_path": str(meta_path.relative_to(self.root)),
        }

    def write_memory_inbox_entry(self, payload: Dict[str, Any]) -> str:
        required = ["source", "ts", "type", "content"]
        missing = [field for field in required if not str(payload.get(field, "")).strip()]
        if missing:
            raise StorageError("invalid_payload", f"Missing required inbox fields: {', '.join(missing)}")

        participants = payload.get("participants")
        if participants is not None:
            payload["participants"] = self._coerce_str_list(participants)
        participant_count = payload.get("participant_count")
        if participant_count is not None:
            try:
                payload["participant_count"] = int(participant_count)
            except (TypeError, ValueError) as exc:
                raise StorageError("invalid_payload", "participant_count must be an integer") from exc

        self.memory_inbox.mkdir(parents=True, exist_ok=True)
        source = str(payload["source"]).strip()
        slug = self._safe_slug(source)
        ts_value = str(payload["ts"]).strip()
        filename = f"{ts_value.replace(':', '').replace('-', '').replace('T', '_')}-{slug}-{uuid.uuid4().hex[:8]}.json"
        path = self.memory_inbox / filename
        with path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        return str(path.relative_to(self.root))

    @staticmethod
    def _safe_slug(value: str) -> str:
        slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-").lower()
        return slug or "inbox"

    def _resolve_manifest_entry(self, slug: str) -> Tuple[str, Dict[str, Any]]:
        normalized = self._normalize_slug(slug)
        manifest = self._load_manifest()
        matches: List[Tuple[Dict[str, Any], str]] = []
        for entry in manifest:
            rel_slug = self._relative_slug(entry)
            filename_slug = Path(rel_slug).name
            if normalized == rel_slug or normalized == filename_slug:
                matches.append((entry, rel_slug))
        if not matches:
            raise StorageError("not_found", f"No knowledge doc matched slug '{normalized}'")
        if len(matches) > 1:
            sample = matches[0][1]
            raise StorageError(
                "ambiguous_slug",
                f"Slug '{normalized}' matches multiple docs; try the full path like '{sample}'",
            )
        entry, rel_slug = matches[0]
        return rel_slug, entry

    def _normalize_slug(self, slug: str) -> str:
        cleaned = (slug or "").strip().strip("/")
        prefixes = [
            "knowledge/kb/docs/",
            "kb/docs/",
            "docs/",
        ]
        for prefix in prefixes:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix) :]
                break
        if cleaned.endswith(".md"):
            cleaned = cleaned[: -len(".md")]
        if not cleaned:
            raise StorageError("invalid_slug", "Slug is required")
        parts = [part for part in cleaned.split("/") if part]
        for part in parts:
            if not _SAFE_DOC_RE.fullmatch(part):
                raise StorageError(
                    "invalid_slug",
                    "Slug components may contain letters, numbers, '.', '_' or '-' only",
                )
        return "/".join(parts)

    def _relative_slug(self, entry: Dict[str, Any]) -> str:
        path = self._rooted_path(entry["path"])
        try:
            relative = path.relative_to(self.knowledge_docs)
        except ValueError:
            relative = path
        return relative.with_suffix("").as_posix()

    def _slug_from_entry(self, entry: Dict[str, Any]) -> str:
        path = self._rooted_path(entry["path"])
        try:
            relative = path.relative_to(self.knowledge_docs)
            return relative.with_suffix("").as_posix()
        except ValueError:
            return path.stem

    def _tokens_in_text(self, text: str, tokens: Tuple[str, ...]) -> Set[str]:
        if not text:
            return set()
        haystack = text.lower()
        return {token for token in tokens if token and token in haystack}

    def _tokens_in_doc(self, entry: Dict[str, Any], tokens: Tuple[str, ...]) -> Set[str]:
        if not tokens:
            return set()
        doc_path = self._rooted_path(entry["path"])
        if not doc_path.is_file():
            return set()
        try:
            content = doc_path.read_text(encoding="utf-8").lower()
        except OSError:
            return set()
        return {token for token in tokens if token and token in content}

    def _rooted_path(self, raw_path: Any) -> Path:
        path = Path(raw_path)
        if path.is_absolute():
            return path
        if self._root_prefix:
            prefix_len = len(self._root_prefix)
            if len(path.parts) >= prefix_len and tuple(path.parts[:prefix_len]) == self._root_prefix:
                path = Path(*path.parts[prefix_len:])
        return (self.root / path).resolve()

    def _load_manifest(self) -> List[Dict[str, Any]]:
        manifest_path = self.knowledge_indexes / "manifest.json"
        return self._load_json(manifest_path)


# Backward-compatible alias for older imports.
Storage = FilesystemStorageBackend

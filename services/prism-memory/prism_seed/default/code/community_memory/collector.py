from __future__ import annotations

import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha1
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import json
import time
from urllib.error import HTTPError
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .activity import ActivityLogger
from .config_loader import CollectorConfig, SpaceConfig
from .state_manager import StateManager
from .utils import ensure_dir, from_iso, read_json, to_iso, utc_now, write_json


@dataclass
class DiscordEnv:
    url: str
    api_key: str
    heap_id: str
    guild_id: str

    @classmethod
    def from_env(cls) -> "DiscordEnv":
        missing = [
            key
            for key in [
                "DISCORD_LATEST_URL",
                "DISCORD_LATEST_KEY",
                "SPACE_HEAP_ID",
                "DISCORD_GUILD_ID",
            ]
            if key not in os.environ
        ]
        if missing:
            raise RuntimeError(f"Missing required Discord env vars: {', '.join(missing)}")

        return cls(
            url=os.environ["DISCORD_LATEST_URL"],
            api_key=os.environ["DISCORD_LATEST_KEY"],
            heap_id=os.environ["SPACE_HEAP_ID"],
            guild_id=os.environ["DISCORD_GUILD_ID"],
        )


@dataclass
class LatestMeetingsEnv:
    url: str
    heap_id: str

    @classmethod
    def from_env(cls) -> "LatestMeetingsEnv":
        missing = [key for key in ["SPACE_HEAP_ID"] if key not in os.environ]
        if missing:
            raise RuntimeError(
                f"Missing required latest meetings env vars: {', '.join(missing)}"
            )

        return cls(
            url=os.environ.get(
                "MEETINGS_LATEST_URL",
                os.environ.get(
                    "LATEST_MEETINGS_URL",
                    "https://example.com/api/latest-meetings",
                ),
            ),
            heap_id=os.environ["SPACE_HEAP_ID"],
        )


class CollectorFetchError(RuntimeError):
    def __init__(self, inner: Exception) -> None:
        super().__init__(f"Discord Latest API request failed after retries: {inner}")
        self.inner = inner


class DiscordLatestCollector:
    BACKFILL_CHUNK_HOURS = 1
    USE_CHUNKED_BACKFILL = False
    AUTO_BULK_FETCH_WINDOW_THRESHOLD = 1

    def __init__(
        self,
        base_path: Path,
        config: SpaceConfig,
        collector_conf: CollectorConfig,
        env: DiscordEnv,
        state: StateManager,
        activity: ActivityLogger,
    ) -> None:
        self.base_path = base_path
        self.config = config
        self.collector_conf = collector_conf
        self.env = env
        self.state = state
        self.activity = activity
        self.collector_key = collector_conf.key

    def run(
        self,
        now: Optional[datetime] = None,
        force: bool = False,
        backfill_hours: Optional[int] = None,
    ) -> Dict[str, Any]:
        if not self.collector_conf.enabled:
            return {"status": "disabled"}

        collector_state = self.state.get_collector_state(self.collector_key)
        window_minutes = collector_state.get(
            "window_minutes", self.collector_conf.window_minutes
        )
        last_until_str = collector_state.get("last_until")

        now = now or utc_now()
        until = now.astimezone(timezone.utc)

        effective_backfill: Optional[int] = None
        if backfill_hours is not None:
            effective_backfill = max(1, int(backfill_hours))
            cursor = until - timedelta(hours=effective_backfill)
            last_until_str = None
            print(
                f"[collector] forced backfill window detected ({effective_backfill}h) ending {to_iso(until)}"
            )
        elif last_until_str:
            cursor = from_iso(last_until_str)
        else:
            effective_backfill = (
                collector_state.get("initial_backfill_hours")
                or self.collector_conf.initial_backfill_hours
                or max(window_minutes // 60, 1)
            )
            cursor = until - timedelta(hours=effective_backfill)
            print(
                f"[collector] initial backfill configured ({effective_backfill}h) ending {to_iso(until)}"
            )

        start_window = cursor
        if until <= cursor:
            return {"status": "noop", "reason": "window_not_due"}

        windows: List[tuple[datetime, datetime]] = []
        temp_cursor = cursor
        while temp_cursor < until:
            temp_end = min(temp_cursor + timedelta(minutes=window_minutes), until)
            windows.append((temp_cursor, temp_end))
            temp_cursor = temp_end

        sliced_payloads = None
        use_bulk_fetch = backfill_hours is not None or len(windows) >= self.AUTO_BULK_FETCH_WINDOW_THRESHOLD
        if use_bulk_fetch:
            print(
                f"[collector] performing single bulk fetch for {len(windows)} windows"
            )
            payload = self._fetch_messages(start_window, until)
            sliced_payloads = self._slice_payload(
                payload, windows, start_window, until, window_minutes
            )
        elif not last_until_str and effective_backfill and self.USE_CHUNKED_BACKFILL:
            sliced_payloads = {}
            base_chunk_hours = min(self.BACKFILL_CHUNK_HOURS, effective_backfill)
            min_chunk_hours = max(window_minutes / 60, 0.25)
            chunk_cursor = start_window
            while chunk_cursor < until:
                current_chunk_hours = base_chunk_hours
                while True:
                    chunk_end = min(chunk_cursor + timedelta(hours=current_chunk_hours), until)
                    try:
                        payload = self._fetch_messages(chunk_cursor, chunk_end)
                        break
                    except CollectorFetchError as exc:
                        if current_chunk_hours <= min_chunk_hours:
                            raise
                        current_chunk_hours = max(current_chunk_hours / 2, min_chunk_hours)
                        print(
                            f"[collector] fetch timeout, retrying chunk {to_iso(chunk_cursor)} → {to_iso(chunk_end)} "
                            f"with {current_chunk_hours:.2f}h span"
                        )
                        continue

                print(
                    f"[collector] chunk loaded {to_iso(chunk_cursor)} → {to_iso(chunk_end)} "
                    f"({current_chunk_hours:.2f}h span)"
                )
                chunk_windows = [
                    window for window in windows if window[0] >= chunk_cursor and window[0] < chunk_end
                ]
                slice_map = self._slice_payload(
                    payload, chunk_windows, chunk_cursor, chunk_end, window_minutes
                )
                sliced_payloads.update(slice_map)
                chunk_cursor = chunk_end

        outputs: List[str] = []
        window_count = 0
        empty_windows = 0
        for window_start, window_end in windows:
            if window_count == 0 or (window_count + 1) % 10 == 0:
                print(
                    f"[collector] window {window_count + 1}/{len(windows)}: {to_iso(window_start)} → {to_iso(window_end)}"
                )
            if sliced_payloads is not None:
                payload = sliced_payloads.get((window_start, window_end))
            else:
                payload = self._fetch_messages(window_start, window_end)
            if payload:
                bucketed = self._bucket_by_category(payload)
                if bucketed:
                    outputs.extend(
                        self._write_bucket_transcripts(
                            bucketed, window_start, window_end, force=force
                        )
                    )
                else:
                    empty_windows += 1
            else:
                empty_windows += 1
            window_count += 1
        if empty_windows:
            print(f"[collector] empty windows: {empty_windows}/{window_count}")

        collector_state.update(
            {
                "last_until": to_iso(until),
                "window_minutes": window_minutes,
            }
        )
        self.state.update_collector_state(self.collector_key, collector_state)

        return {
            "status": "ok",
            "outputs": outputs,
            "window": (to_iso(start_window), to_iso(until)),
            "windows_processed": window_count,
        }

    def _fetch_messages(self, since: datetime, until: datetime) -> Dict[str, Any]:
        params = {
            "heap_id": self.env.heap_id,
            "guild_id": self.env.guild_id,
            "since": to_iso(since),
            "until": to_iso(until),
            "filters.ignore_bot_messages": "true",
            "include_archived_threads": "false",
            "max_messages_per_channel": 200,
        }
        url = f"{self.env.url}?{urlencode(params)}"
        headers = {
            "X-API-Key": self.env.api_key,
            "Accept": "application/json",
        }
        span_hours = (until - since).total_seconds() / 3600
        print(
            f"[collector] requesting Discord payload {to_iso(since)} → {to_iso(until)} ({span_hours:.2f}h span)"
        )
        request = Request(url, headers=headers, method="GET")
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                with urlopen(request, timeout=60) as response:
                    data = json.loads(response.read().decode("utf-8"))
                if isinstance(data, list) and data:
                    data = data[0]
                print(
                    f"[collector] payload received ({len(data.get('channels', []))} channels)"
                )
                return data
            except (TimeoutError, URLError) as exc:
                last_error = exc
                print(
                    f"[collector] fetch attempt {attempt + 1} failed: {exc}; retrying"
                )
                time.sleep(2 ** attempt)
        raise CollectorFetchError(last_error)

    def _slice_payload(
        self,
        payload: Dict[str, Any],
        windows: List[Tuple[datetime, datetime]],
        since: datetime,
        until: datetime,
        window_minutes: int,
    ) -> Dict[Tuple[datetime, datetime], Dict[str, Any] | None]:
        window_map: Dict[Tuple[datetime, datetime], Dict[str, Dict[str, Any]]] = {
            window: {} for window in windows
        }
        window_delta = timedelta(minutes=window_minutes)
        for channel in payload.get("channels", []):
            channel_stub = {
                "channel_id": channel.get("channel_id"),
                "category_id": channel.get("category_id"),
                "channel_name": channel.get("channel_name"),
                "channel_topic": channel.get("channel_topic"),
            }
            channel_stub.update(self._thread_context(channel))
            for message in channel.get("messages", []):
                created_at = message.get("created_at")
                if not created_at:
                    continue
                msg_time = from_iso(created_at)
                if msg_time < since or msg_time >= until:
                    continue
                slot = int((msg_time - since) // window_delta)
                window_start = since + slot * window_delta
                window_end = min(window_start + window_delta, until)
                key = (window_start, window_end)
                channel_entry = window_map[key].setdefault(
                    channel_stub["channel_id"],
                    {"channel": channel_stub, "messages": []},
                )
                channel_entry["messages"].append(message)

        sliced: Dict[tuple[datetime, datetime], Dict[str, Any] | None] = {}
        for window in windows:
            channel_entries = window_map[window]
            if not channel_entries:
                sliced[window] = None
                continue
            sliced[window] = {
                "channels": [
                    {
                        "channel_id": data["channel"]["channel_id"],
                        "category_id": data["channel"].get("category_id"),
                        "channel_name": data["channel"].get("channel_name"),
                        "channel_topic": data["channel"].get("channel_topic"),
                        **self._thread_context(data["channel"]),
                        "messages": data["messages"],
                    }
                    for data in channel_entries.values()
                ],
                "skipped": payload.get("skipped", []),
                "totals": payload.get("totals", {}),
            }
        return sliced

    def _bucket_by_category(self, payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        buckets: Dict[str, Dict[str, Any]] = {}
        category_map = self.config.discord.category_to_bucket
        category_by_channel_id: Dict[str, str] = {}
        for channel in payload.get("channels", []):
            channel_id = str(channel.get("channel_id") or "").strip()
            category_id = str(channel.get("category_id") or "").strip()
            if channel_id and category_id:
                category_by_channel_id[channel_id] = category_id

        for channel in payload.get("channels", []):
            resolved_category_id = self._resolve_category_id(
                channel,
                category_by_channel_id=category_by_channel_id,
            )
            bucket_key = category_map.get(resolved_category_id or "")
            if not bucket_key:
                self.activity.log(
                    "collector.channel_skipped",
                    collector_key=self.collector_key,
                    run_key=payload.get("window_key"),
                    meta={
                        "reason": "unmapped_category",
                        "channel_id": channel.get("channel_id"),
                        "channel_name": channel.get("channel_name"),
                        "category_id": channel.get("category_id"),
                        "resolved_category_id": resolved_category_id,
                        "thread_id": channel.get("thread_id"),
                        "thread_name": channel.get("thread_name"),
                        "parent_channel_id": channel.get("parent_channel_id"),
                        "parent_channel_name": channel.get("parent_channel_name"),
                    },
                )
                continue
            bucket = buckets.setdefault(
                bucket_key,
                {
                    "channels": [],
                    "messages": 0,
                    "skipped": payload.get("skipped", []),
                    "totals": payload.get("totals", {}),
                },
            )
            messages = [m for m in channel.get("messages", []) if m.get("content")]
            if not messages:
                continue
            bucket["messages"] += len(messages)
            bucket["channels"].append({"channel": channel, "messages": messages})
        return buckets

    def _resolve_category_id(
        self,
        channel: Dict[str, Any],
        *,
        category_by_channel_id: Dict[str, str],
    ) -> str | None:
        def _clean(value: Any) -> str | None:
            text = str(value or "").strip()
            return text or None

        def _candidate_parent_ids() -> List[str]:
            parent_ids: List[str] = []
            for key in ("parent_channel_id", "parent_id", "parentId"):
                value = _clean(channel.get(key))
                if value and value not in parent_ids:
                    parent_ids.append(value)
            thread = channel.get("thread")
            if isinstance(thread, dict):
                for key in ("parent_channel_id", "parent_id", "parentId"):
                    value = _clean(thread.get(key))
                    if value and value not in parent_ids:
                        parent_ids.append(value)
            for message in channel.get("messages", [])[:5]:
                for key in ("parent_channel_id", "parent_id", "parentId"):
                    value = _clean(message.get(key))
                    if value and value not in parent_ids:
                        parent_ids.append(value)
                thread = message.get("thread")
                if isinstance(thread, dict):
                    for key in ("parent_channel_id", "parent_id", "parentId"):
                        value = _clean(thread.get(key))
                        if value and value not in parent_ids:
                            parent_ids.append(value)
            return parent_ids

        for source in [channel, channel.get("thread") if isinstance(channel.get("thread"), dict) else None]:
            if not isinstance(source, dict):
                continue
            for key in ("category_id", "parent_category_id", "categoryId", "parentCategoryId"):
                value = _clean(source.get(key))
                if value:
                    return value

        for message in channel.get("messages", [])[:5]:
            for key in ("category_id", "parent_category_id", "categoryId", "parentCategoryId"):
                value = _clean(message.get(key))
                if value:
                    return value
            thread = message.get("thread")
            if isinstance(thread, dict):
                for key in ("category_id", "parent_category_id", "categoryId", "parentCategoryId"):
                    value = _clean(thread.get(key))
                    if value:
                        return value

        for parent_id in _candidate_parent_ids():
            parent_category = category_by_channel_id.get(parent_id)
            if parent_category:
                return parent_category

        return None

    @staticmethod
    def _thread_context(raw: Dict[str, Any]) -> Dict[str, Any]:
        context: Dict[str, Any] = {}
        for key in (
            "thread_id",
            "thread_name",
            "parent_channel_id",
            "parent_channel_name",
            "is_thread",
        ):
            if key in raw and raw.get(key) not in (None, ""):
                context[key] = raw.get(key)

        thread = raw.get("thread")
        if isinstance(thread, dict):
            for source_key, target_key in (
                ("id", "thread_id"),
                ("name", "thread_name"),
                ("parent_channel_id", "parent_channel_id"),
                ("parent_channel_name", "parent_channel_name"),
            ):
                if target_key not in context and thread.get(source_key) not in (None, ""):
                    context[target_key] = thread.get(source_key)
            context["is_thread"] = True
        return context

    def _write_bucket_transcripts(
        self,
        buckets: Dict[str, Dict[str, Any]],
        since: datetime,
        until: datetime,
        force: bool = False,
    ) -> List[str]:
        outputs: List[str] = []
        date_str = since.strftime("%Y-%m-%d")
        window_key = f"{to_iso(since).replace(':', '')}_{to_iso(until).replace(':', '')}"
        for bucket_key, bucket in buckets.items():
            raw_dir = self.base_path / "buckets" / bucket_key / "raw" / date_str
            ensure_dir(raw_dir)
            file_stem = f"{since.strftime('%H%M')}-{until.strftime('%H%M')}"
            md_path = raw_dir / f"{file_stem}.md"
            json_path = raw_dir / f"{file_stem}.json"
            if md_path.exists() and not force:
                print(
                    f"[collector] existing transcript {md_path.relative_to(self.base_path)} (skip)"
                )
                continue

            lines = [
                "# Discord Transcript Window",
                f"bucket: {bucket_key}",
                f"since: {to_iso(since)}",
                f"until: {to_iso(until)}",
                f"totals: messages={bucket.get('messages', 0)} channels={len(bucket.get('channels', []))}",
                f"skipped_count: {len(bucket.get('skipped', []))}",
                "",
            ]
            serialized_channels = []
            for channel_entry in bucket.get("channels", []):
                channel = channel_entry["channel"]
                messages = channel_entry["messages"]
                serialized_channels.append(
                    {
                        "channel_id": channel.get("channel_id"),
                        "category_id": channel.get("category_id"),
                        "channel_name": channel.get("channel_name"),
                        "channel_topic": channel.get("channel_topic"),
                        **self._thread_context(channel),
                        "messages": messages,
                    }
                )
                lines.append(
                    f"## Channel: {channel.get('channel_name')} ({channel.get('channel_id')})"
                )
                topic = channel.get("channel_topic") or ""
                lines.append(f"topic: {topic}")
                if channel.get("thread_id"):
                    lines.append(f"thread_id: {channel.get('thread_id')}")
                if channel.get("thread_name"):
                    lines.append(f"thread_name: {channel.get('thread_name')}")
                if channel.get("parent_channel_id"):
                    lines.append(f"parent_channel_id: {channel.get('parent_channel_id')}")
                if channel.get("parent_channel_name"):
                    lines.append(f"parent_channel_name: {channel.get('parent_channel_name')}")
                for message in messages:
                    author = message.get("author", {}).get("display_name") or message.get(
                        "author", {}
                    ).get("username", "unknown")
                    created = message.get("created_at")
                    jump_url = message.get("jump_url", "")
                    content = message.get("content", "").replace("\n", " ")
                    attachment_note = ""
                    if message.get("attachments"):
                        attachment_note = " [attachments]"
                    lines.append(
                        f"- [{created}] **{author}**: {content} ({jump_url}){attachment_note}"
                    )
                lines.append("")

            lines.append("## Skipped")
            skipped = bucket.get("skipped", [])
            if skipped:
                for item in skipped:
                    lines.append(f"- {item.get('channel_id')}: {item.get('reason')}")
            else:
                lines.append("- none")

            md_path.write_text("\n".join(lines), encoding="utf-8")
            write_json(
                json_path,
                {
                    "bucket": bucket_key,
                    "since": to_iso(since),
                    "until": to_iso(until),
                    "window_key": window_key,
                    "channels": serialized_channels,
                    "skipped": skipped,
                    "totals": bucket.get("totals", {}),
                },
            )

            print(
                f"[collector] wrote {bucket_key} raw/{date_str}/{file_stem}.md "
                f"(messages={bucket.get('messages', 0)} channels={len(bucket.get('channels', []))})"
            )

            self.activity.log(
                "collector.completed",
                collector_key=self.collector_key,
                bucket=bucket_key,
                run_key=window_key,
                outputs=[str(md_path.relative_to(self.base_path))],
                meta={
                    "since": to_iso(since),
                    "until": to_iso(until),
                    "totals": bucket.get("totals", {}),
                    "skipped": skipped,
                },
            )
            outputs.append(str(md_path))
        return outputs


class LatestMeetingsCollector:
    def __init__(
        self,
        base_path: Path,
        config: SpaceConfig,
        collector_conf: CollectorConfig,
        env: LatestMeetingsEnv,
        state: StateManager,
        activity: ActivityLogger,
    ) -> None:
        self.base_path = base_path
        self.config = config
        self.collector_conf = collector_conf
        self.env = env
        self.state = state
        self.activity = activity
        self.collector_key = collector_conf.key

    def run(
        self,
        now: Optional[datetime] = None,
        force: bool = False,
        backfill_hours: Optional[int] = None,
    ) -> Dict[str, Any]:
        if not self.collector_conf.enabled:
            return {"status": "disabled"}

        collector_state = self.state.get_collector_state(self.collector_key)
        window_minutes = collector_state.get(
            "window_minutes", self.collector_conf.window_minutes
        )
        last_until_str = collector_state.get("last_until")

        now = now or utc_now()
        until = now.astimezone(timezone.utc)

        if backfill_hours is not None:
            effective_backfill = max(1, int(backfill_hours))
            cursor = until - timedelta(hours=effective_backfill)
            print(
                f"[collector] forced meetings backfill ({effective_backfill}h) ending {to_iso(until)}"
            )
        elif last_until_str:
            cursor = from_iso(last_until_str)
        else:
            initial_backfill = (
                collector_state.get("initial_backfill_hours")
                or self.collector_conf.initial_backfill_hours
                or max(window_minutes // 60, 1)
            )
            cursor = until - timedelta(hours=initial_backfill)
            print(
                f"[collector] initial meetings backfill ({initial_backfill}h) ending {to_iso(until)}"
            )

        if until <= cursor:
            return {"status": "noop", "reason": "window_not_due"}

        outputs: List[str] = []
        window_count = 0
        empty_windows = 0
        while cursor < until:
            window_end = min(cursor + timedelta(minutes=window_minutes), until)
            if window_count == 0 or (window_count + 1) % 10 == 0:
                print(
                    f"[collector] meetings window {window_count + 1}: {to_iso(cursor)} → {to_iso(window_end)}"
                )
            payload = self._fetch_window(cursor, window_end)
            messages = self._normalize_messages(payload, window_end)
            if not messages:
                empty_windows += 1
            else:
                output = self._write_transcript(
                    since=cursor,
                    until=window_end,
                    messages=messages,
                    force=force,
                )
                if output:
                    outputs.append(output)
            cursor = window_end
            window_count += 1

        if empty_windows:
            print(f"[collector] meetings empty windows: {empty_windows}/{window_count}")

        collector_state.update({"last_until": to_iso(until), "window_minutes": window_minutes})
        self.state.update_collector_state(self.collector_key, collector_state)

        return {
            "status": "ok",
            "outputs": outputs,
            "windows_processed": window_count,
        }

    def _fetch_window(self, since: datetime, until: datetime) -> Any:
        body = {
            "heap_id": self.env.heap_id,
            "since": to_iso(since),
            "until": to_iso(until),
        }
        req = Request(
            self.env.url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                with urlopen(req, timeout=60) as response:
                    return json.loads(response.read().decode("utf-8"))
            except HTTPError as exc:
                details = ""
                try:
                    details = exc.read().decode("utf-8")
                except Exception:
                    details = str(exc)
                if exc.code == 500 and "No item to return was found" in details:
                    return {}
                last_error = RuntimeError(
                    f"latest meetings HTTP {exc.code} for {to_iso(since)} → {to_iso(until)}: {details}"
                )
                print(f"[collector] meetings fetch attempt {attempt + 1} failed: {last_error}")
            except (TimeoutError, URLError) as exc:
                last_error = exc
                print(
                    f"[collector] meetings fetch attempt {attempt + 1} failed: {exc}; retrying"
                )
            time.sleep(2 ** attempt)
        raise CollectorFetchError(last_error or RuntimeError("latest meetings failed"))

    def _normalize_messages(self, payload: Any, fallback_time: datetime) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        if isinstance(payload, dict):
            if isinstance(payload.get("content"), str):
                items = [payload]
            elif isinstance(payload.get("meetings"), list):
                items = [x for x in payload.get("meetings", []) if isinstance(x, dict)]
        elif isinstance(payload, list):
            items = [x for x in payload if isinstance(x, dict)]

        messages: List[Dict[str, Any]] = []
        for idx, item in enumerate(items):
            content = (item.get("content") or "").strip()
            if not content:
                continue
            author_name = item.get("author") or "latest-meetings"
            file_id = item.get("file_id") or item.get("id") or f"meeting-{idx + 1}"
            created_at = (
                item.get("created_at")
                or item.get("timestamp")
                or to_iso(fallback_time)
            )
            jump_url = item.get("jump_url") or item.get("url") or ""
            participants = self._coerce_participants(item.get("participants"))
            metadata: Dict[str, Any] = {}
            if participants:
                metadata["participants"] = participants
            participant_count = item.get("participant_count")
            if participant_count is None:
                participant_count = item.get("attendee_count")
            if participant_count is None and participants:
                participant_count = len(participants)
            if participant_count is not None:
                try:
                    metadata["participant_count"] = int(participant_count)
                except (TypeError, ValueError):
                    pass
            messages.append(
                {
                    "id": str(file_id),
                    "author": {
                        "id": "latest-meetings",
                        "username": "latest-meetings",
                        "display_name": str(author_name),
                    },
                    "content": content,
                    "created_at": created_at,
                    "jump_url": jump_url,
                    "attachments": [],
                    "embeds": [],
                    "metadata": metadata,
                }
            )
        return messages

    @staticmethod
    def _coerce_participants(value: Any) -> List[str]:
        if not isinstance(value, list):
            return []
        participants: List[str] = []
        seen: set[str] = set()
        for raw in value:
            name = str(raw).strip()
            if not name or name in seen:
                continue
            seen.add(name)
            participants.append(name)
        return participants

    def _write_transcript(
        self,
        *,
        since: datetime,
        until: datetime,
        messages: List[Dict[str, Any]],
        force: bool = False,
    ) -> str | None:
        bucket_key = (self.config.meetings or {}).get("bucket", "meetings")
        date_str = since.strftime("%Y-%m-%d")
        file_stem = f"{since.strftime('%H%M')}-{until.strftime('%H%M')}"
        raw_dir = self.base_path / "buckets" / bucket_key / "raw" / date_str
        ensure_dir(raw_dir)
        md_path = raw_dir / f"{file_stem}.md"
        json_path = raw_dir / f"{file_stem}.json"
        if md_path.exists() and not force:
            print(
                f"[collector] existing meetings transcript {md_path.relative_to(self.base_path)} (skip)"
            )
            return None

        window_key = f"{to_iso(since).replace(':', '')}_{to_iso(until).replace(':', '')}"
        lines = [
            "# Latest Meetings Transcript Window",
            f"bucket: {bucket_key}",
            f"since: {to_iso(since)}",
            f"until: {to_iso(until)}",
            f"totals: messages={len(messages)} channels=1",
            "skipped_count: 0",
            "",
            "## Channel: latest-meetings (latest-meetings)",
            "topic: Meeting summaries/events from latest-meetings webhook",
        ]
        for message in messages:
            author = message.get("author", {}).get("display_name", "latest-meetings")
            created = message.get("created_at", "")
            content = message.get("content", "").replace("\n", " ")
            jump_url = message.get("jump_url", "")
            lines.append(f"- [{created}] **{author}**: {content} ({jump_url})")
        lines.extend(["", "## Skipped", "- none"])
        md_path.write_text("\n".join(lines), encoding="utf-8")

        write_json(
            json_path,
            {
                "bucket": bucket_key,
                "since": to_iso(since),
                "until": to_iso(until),
                "window_key": window_key,
                "channels": [
                    {
                        "channel_id": "latest-meetings",
                        "category_id": "latest-meetings",
                        "channel_name": "latest-meetings",
                        "channel_topic": "Meeting summaries/events from latest-meetings webhook",
                        "messages": messages,
                    }
                ],
                "skipped": [],
                "totals": {"channels": 1, "messages": len(messages)},
            },
        )
        print(
            f"[collector] wrote {bucket_key} raw/{date_str}/{file_stem}.md "
            f"(messages={len(messages)} channels=1)"
        )
        self.activity.log(
            "collector.completed",
            collector_key=self.collector_key,
            bucket=bucket_key,
            run_key=window_key,
            outputs=[str(md_path.relative_to(self.base_path))],
            meta={
                "since": to_iso(since),
                "until": to_iso(until),
                "totals": {"channels": 1, "messages": len(messages)},
                "source": "latest-meetings",
            },
        )
        return str(md_path)


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
            "metadata": {
                key: value
                for key, value in {
                    "participants": record.get("participants", []),
                    "participant_count": record.get("participant_count"),
                }.items()
                if value not in (None, [])
            },
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
            },
        )
        print(
            f"[collector] inbox_memory wrote {record['bucket']} raw/{date_str}/{file_stem}.md "
            f"(source={record['source']} type={record['type']})"
        )
        return str(md_path)

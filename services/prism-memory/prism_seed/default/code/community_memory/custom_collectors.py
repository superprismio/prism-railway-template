from __future__ import annotations

import importlib
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from .activity import ActivityLogger
from .config_loader import CollectorConfig, SpaceConfig
from .state_manager import StateManager
from .utils import ensure_dir, to_iso, utc_now


class CollectorLoadError(RuntimeError):
    pass


class CommandCollector:
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
        self.repo_root = self.base_path.parent.parent

    def run(
        self,
        now: datetime | None = None,
        force: bool = False,
        backfill_hours: int | None = None,
    ) -> Dict[str, Any]:
        if not self.collector_conf.enabled:
            return {"status": "disabled"}
        if not self.collector_conf.command:
            raise CollectorLoadError(
                f"collector '{self.collector_key}' is type=command but has no command"
            )

        current_time = now or utc_now()
        env = os.environ.copy()
        env.update(self.collector_conf.env or {})
        env.update(
            {
                "PRISM_REPO_ROOT": str(self.repo_root),
                "PRISM_BASE_PATH": str(self.base_path),
                "PRISM_CONFIG_PATH": str(self.base_path / "config" / "space.json"),
                "PRISM_STATE_PATH": str(self.base_path / "state" / "collector_state.json"),
                "PRISM_ACTIVITY_PATH": str(self.base_path / "activity" / "activity.jsonl"),
                "PRISM_SPACE_SLUG": self.config.space_slug,
                "PRISM_COLLECTOR_KEY": self.collector_key,
                "PRISM_COLLECTOR_OPTIONS": json.dumps(
                    self.collector_conf.options or {}, sort_keys=True
                ),
                "PRISM_NOW": to_iso(current_time),
                "PRISM_FORCE": "1" if force else "0",
                "PRISM_BACKFILL_HOURS": (
                    str(backfill_hours) if backfill_hours is not None else ""
                ),
            }
        )

        command = [
            self._resolve_command_part(part, index=index)
            for index, part in enumerate(self.collector_conf.command)
        ]
        result = subprocess.run(
            command,
            cwd=self.repo_root,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            stdout = (result.stdout or "").strip()
            raise RuntimeError(
                f"custom collector '{self.collector_key}' failed with exit code {result.returncode}: "
                f"{stderr or stdout or 'no output'}"
            )

        payload = self._parse_result_payload(result.stdout)
        self._apply_state_update(payload)
        self._log_activity(payload)
        return payload

    def _resolve_command_part(self, part: str, *, index: int) -> str:
        if index != 0 and part.startswith("-"):
            return part
        candidate = Path(part)
        if candidate.is_absolute():
            return str(candidate)
        resolved = self.repo_root / candidate
        if resolved.exists():
            return str(resolved)
        return part

    def _parse_result_payload(self, stdout: str) -> Dict[str, Any]:
        lines = [line.strip() for line in stdout.splitlines() if line.strip()]
        if not lines:
            return {"status": "ok", "outputs": [], "windows_processed": 0}
        last_line = lines[-1]
        try:
            payload = json.loads(last_line)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"custom collector '{self.collector_key}' did not emit JSON on its last stdout line"
            ) from exc
        if not isinstance(payload, dict):
            raise RuntimeError(
                f"custom collector '{self.collector_key}' returned non-object JSON"
            )
        payload.setdefault("status", "ok")
        payload.setdefault("outputs", [])
        payload.setdefault("windows_processed", 0)
        return payload

    def _apply_state_update(self, payload: Dict[str, Any]) -> None:
        state_update = payload.get("collector_state")
        if isinstance(state_update, dict):
            current = self.state.get_collector_state(self.collector_key)
            current.update(state_update)
            self.state.update_collector_state(self.collector_key, current)
            return

        current = self.state.get_collector_state(self.collector_key)
        touched = False
        for key in ("last_until", "window_minutes", "processed_last_run", "rejected_last_run"):
            if key in payload:
                current[key] = payload[key]
                touched = True
        if touched:
            self.state.update_collector_state(self.collector_key, current)

    def _log_activity(self, payload: Dict[str, Any]) -> None:
        events = payload.get("activity_events")
        if isinstance(events, list) and events:
            for item in events:
                if not isinstance(item, dict):
                    continue
                self.activity.log(
                    str(item.get("type", "collector.completed")),
                    collector_key=self.collector_key,
                    bucket=item.get("bucket"),
                    run_key=item.get("run_key"),
                    inputs=list(item.get("inputs") or []),
                    outputs=list(item.get("outputs") or []),
                    meta=dict(item.get("meta") or {}),
                )
            return

        self.activity.log(
            "collector.completed",
            collector_key=self.collector_key,
            run_key=payload.get("run_key") or utc_now().date().isoformat(),
            outputs=[str(item) for item in payload.get("outputs", [])],
            meta={
                "status": payload.get("status"),
                "windows_processed": payload.get("windows_processed"),
                "source": "command_collector",
            },
        )


def load_python_collector(
    *,
    base_path: Path,
    config: SpaceConfig,
    collector_conf: CollectorConfig,
    state: StateManager,
    activity: ActivityLogger,
) -> object:
    if not collector_conf.module or not collector_conf.class_name:
        raise CollectorLoadError(
            f"collector '{collector_conf.key}' is type=python but is missing module/class_name"
        )
    module = importlib.import_module(collector_conf.module)
    target = getattr(module, collector_conf.class_name, None)
    if target is None:
        raise CollectorLoadError(
            f"collector '{collector_conf.key}' could not load "
            f"{collector_conf.module}:{collector_conf.class_name}"
        )
    return target(
        base_path=base_path,
        config=config,
        collector_conf=collector_conf,
        state=state,
        activity=activity,
    )


def write_collector_window(
    *,
    base_path: Path,
    collector_key: str,
    bucket: str,
    since_iso: str,
    until_iso: str,
    messages: List[Dict[str, Any]],
    channel_name: str,
    channel_id: str | None = None,
    channel_topic: str = "",
    force: bool = False,
) -> Dict[str, str] | None:
    since = datetime.fromisoformat(since_iso.replace("Z", "+00:00"))
    until = datetime.fromisoformat(until_iso.replace("Z", "+00:00"))
    repo_root = base_path.parent.parent
    date_str = since.strftime("%Y-%m-%d")
    file_stem = f"{since.strftime('%H%M')}-{until.strftime('%H%M')}"
    raw_dir = base_path / "buckets" / bucket / "raw" / date_str
    ensure_dir(raw_dir)
    md_path = raw_dir / f"{file_stem}.md"
    json_path = raw_dir / f"{file_stem}.json"
    if md_path.exists() and not force:
        return None

    window_key = f"{since_iso.replace(':', '')}_{until_iso.replace(':', '')}"
    lines = [
        f"# {collector_key} Transcript Window",
        f"bucket: {bucket}",
        f"since: {since_iso}",
        f"until: {until_iso}",
        f"totals: messages={len(messages)} channels=1",
        "skipped_count: 0",
        "",
        f"## Channel: {channel_name} ({channel_id or channel_name})",
    ]
    if channel_topic:
        lines.append(f"topic: {channel_topic}")
    for message in messages:
        author = (
            message.get("author", {}).get("display_name")
            or message.get("author", {}).get("username")
            or "unknown"
        )
        created = message.get("created_at", "")
        content = str(message.get("content", "")).replace("\n", " ")
        jump_url = message.get("jump_url", "")
        suffix = f" ({jump_url})" if jump_url else ""
        lines.append(f"- [{created}] **{author}**: {content}{suffix}")
    lines.extend(["", "## Skipped", "- none"])
    md_path.write_text("\n".join(lines), encoding="utf-8")

    payload = {
        "bucket": bucket,
        "since": since_iso,
        "until": until_iso,
        "window_key": window_key,
        "channels": [
            {
                "channel_id": channel_id or channel_name,
                "category_id": collector_key,
                "channel_name": channel_name,
                "channel_topic": channel_topic,
                "messages": messages,
            }
        ],
        "skipped": [],
        "totals": {"channels": 1, "messages": len(messages)},
    }
    json_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return {
        "md": str(md_path.relative_to(repo_root)),
        "json": str(json_path.relative_to(repo_root)),
    }

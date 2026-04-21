from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Set

from .activity import ActivityLogger
from .config_loader import SpaceConfig
from .utils import ensure_dir, read_json, to_iso, write_json


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _slugify(text: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "-", _clean(text).lower()).strip("-")
    return value


def _display_name(project_key: str) -> str:
    parts = [part for part in project_key.replace("_", "-").split("-") if part]
    return " ".join(part.capitalize() for part in parts) or project_key


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


def _project_aliases(project: Dict[str, Any]) -> Set[str]:
    aliases = {
        _clean(str(item)).lower()
        for item in project.get("aliases", [])
        if _clean(str(item))
    }
    aliases.update(
        {
            _clean(str(item)).lower()
            for item in project.get("tags", [])
            if _clean(str(item))
        }
    )
    project_key = _clean(str(project.get("project_key", "")))
    display_name = _clean(str(project.get("display_name", "")))
    description = _clean(str(project.get("description", "")))
    if project_key:
        aliases.add(project_key.lower())
        aliases.add(project_key.replace("-", " ").lower())
    if display_name:
        aliases.add(display_name.lower())
    if description:
        aliases.add(description.lower())
    return {alias for alias in aliases if alias}


def _contains_alias(text: str, aliases: Set[str]) -> bool:
    lowered = _clean(text).lower()
    for alias in aliases:
        if not alias:
            continue
        pattern = rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])"
        if re.search(pattern, lowered):
            return True
    return False


@dataclass
class ProjectStateBuilder:
    base_path: Path
    activity: ActivityLogger
    config: SpaceConfig

    def run(self, target_date: date, force: bool = False) -> str | None:
        projects_conf = ((self.config.state or {}).get("projects") or {}) if self.config else {}
        if not bool(projects_conf.get("enabled", False)):
            return None

        detection_conf = projects_conf.get("detection") or {}
        category_rules = [
            rule for rule in detection_conf.get("category_rules", []) if isinstance(rule, dict)
        ]
        fallback_prefixes = [
            str(item).strip()
            for item in detection_conf.get("fallback_channel_name_prefixes", [])
            if str(item).strip()
        ]
        if not category_rules and not fallback_prefixes:
            return None

        activity_windows = projects_conf.get("activity_windows") or {}
        active_days = self._coerce_positive_int(activity_windows.get("active_days"), default=7)
        watching_days = self._coerce_positive_int(
            activity_windows.get("watching_days"), default=max(active_days, 30)
        )
        if watching_days < active_days:
            watching_days = active_days

        current_dir = ensure_dir(self.base_path / "state" / "current")
        latest_path = self.base_path / "state" / "latest.json"
        current_path = current_dir / "projects.json"

        existing = read_json(current_path, default={})
        previous_projects = existing.get("projects", []) if isinstance(existing, dict) else []
        projects_by_key: Dict[str, Dict[str, Any]] = {}
        for raw in previous_projects:
            if not isinstance(raw, dict):
                continue
            project_key = _slugify(str(raw.get("project_key", "")))
            if not project_key:
                continue
            project = dict(raw)
            project["project_key"] = project_key
            project.setdefault("display_name", _display_name(project_key))
            project.setdefault("description", "")
            project.setdefault("aliases", [])
            project.setdefault("tags", [])
            project.setdefault("owners", [])
            project.setdefault("source_channels", [])
            project.setdefault("derived_from", [])
            project.setdefault("source", {"mode": "manual"})
            projects_by_key[project_key] = project

        records = self._load_raw_records_for_date(target_date)
        auto_promoted = 0
        seen_today: Set[str] = set()

        for record in records:
            channel_name = str(record.get("channel") or "").strip()
            bucket = str(record.get("bucket") or "").strip()
            created_at = str(record.get("created_at") or "").strip()
            if not channel_name or not bucket or not created_at:
                continue

            project_key, rule_id = self._detect_project_key(
                bucket=bucket,
                channel_name=channel_name,
                category_rules=category_rules,
                fallback_prefixes=fallback_prefixes,
            )
            if not project_key:
                continue

            project = projects_by_key.get(project_key)
            if project is None:
                auto_promoted += 1
                project = {
                    "project_key": project_key,
                    "display_name": _display_name(project_key),
                    "description": "",
                    "status": "active",
                    "archived": False,
                    "source_channels": [],
                    "aliases": [],
                    "tags": [],
                    "owners": [],
                    "last_direct_activity_at": created_at,
                    "last_indirect_activity_at": None,
                    "derived_from": ["channel_prefix"],
                    "activity_score": 0.0,
                    "review_by": None,
                    "source": {
                        "mode": "auto_rule",
                        "rule_id": rule_id,
                    },
                }
                projects_by_key[project_key] = project
            else:
                project["last_direct_activity_at"] = _max_iso(
                    project.get("last_direct_activity_at"), created_at
                )
                self._append_unique(project.setdefault("derived_from", []), "channel_prefix")
                source = project.setdefault("source", {})
                if rule_id and not source.get("rule_id"):
                    source["rule_id"] = rule_id

            source_channel = {"bucket": bucket, "channel_name": channel_name}
            if source_channel not in project.setdefault("source_channels", []):
                project["source_channels"].append(source_channel)
            seen_today.add(project_key)

        project_aliases = {
            project_key: _project_aliases(project)
            for project_key, project in projects_by_key.items()
        }
        direct_channels = {
            (source.get("bucket"), source.get("channel_name"))
            for project in projects_by_key.values()
            for source in project.get("source_channels", [])
            if isinstance(source, dict)
        }

        for record in records:
            bucket = str(record.get("bucket") or "").strip()
            channel_name = str(record.get("channel") or "").strip()
            content = str(record.get("content") or "").strip()
            created_at = str(record.get("created_at") or "").strip()
            if not content or not created_at:
                continue
            if (bucket, channel_name) in direct_channels:
                continue
            for project_key, aliases in project_aliases.items():
                if not aliases or not _contains_alias(content, aliases):
                    continue
                project = projects_by_key[project_key]
                project["last_indirect_activity_at"] = _max_iso(
                    project.get("last_indirect_activity_at"), created_at
                )
                self._append_unique(project.setdefault("derived_from", []), "cross_channel_mentions")

        generated_at = to_iso(datetime.now(timezone.utc))
        status_counts = {"active": 0, "watching": 0, "inactive": 0, "archived": 0}
        projects: List[Dict[str, Any]] = []
        for project_key in sorted(projects_by_key):
            project = projects_by_key[project_key]
            status, score = self._status_for_project(
                project,
                target_date=target_date,
                active_days=active_days,
                watching_days=watching_days,
            )
            project["status"] = status
            project["activity_score"] = score
            if status != "archived":
                project["review_by"] = to_iso(
                    _date_floor(target_date) + timedelta(days=watching_days)
                )
            status_counts[status] += 1
            projects.append(project)

        payload = {
            "generated_at": generated_at,
            "as_of_date": target_date.isoformat(),
            "projects": projects,
        }
        write_json(current_path, payload)

        active_projects = [project for project in projects if project.get("status") == "active"]
        watching_projects = [project for project in projects if project.get("status") == "watching"]
        latest_payload = {
            "generated_at": generated_at,
            "domains": {
                "projects": {
                    "source_path": "state/current/projects.json",
                    "updated_at": generated_at,
                    "summary": (
                        f"{len(active_projects)} active, {len(watching_projects)} watching, "
                        f"{status_counts['inactive']} inactive, {status_counts['archived']} archived."
                    ),
                }
            },
            "recent_changes": [
                {
                    "domain": "projects",
                    "change_type": "updated",
                    "summary": (
                        f"Project state refreshed for {target_date.isoformat()} with "
                        f"{len(active_projects)} active project(s)."
                    ),
                    "updated_at": generated_at,
                    "source_path": "state/current/projects.json",
                }
            ],
        }
        write_json(latest_path, latest_payload)

        self.activity.log(
            "state.projects.updated",
            run_key=target_date.isoformat(),
            outputs=[
                str(current_path.relative_to(self.base_path)),
                str(latest_path.relative_to(self.base_path)),
            ],
            meta={
                "auto_promoted": auto_promoted,
                "active": status_counts["active"],
                "watching": status_counts["watching"],
                "inactive": status_counts["inactive"],
                "archived": status_counts["archived"],
                "force": force,
            },
        )
        print(
            "[state] projects updated "
            f"active={status_counts['active']} watching={status_counts['watching']} "
            f"inactive={status_counts['inactive']} archived={status_counts['archived']}"
        )
        return str(current_path)

    def _load_raw_records_for_date(self, target_date: date) -> List[Dict[str, Any]]:
        records: List[Dict[str, Any]] = []
        date_str = target_date.isoformat()
        for path in sorted(self.base_path.glob(f"buckets/*/raw/{date_str}/*.json")):
            data = read_json(path, default={})
            bucket = str(data.get("bucket") or path.parent.parent.parent.name)
            for channel in data.get("channels", []):
                channel_name = channel.get("channel_name")
                for message in channel.get("messages", []):
                    content = _clean(str(message.get("content", "")))
                    if not content:
                        continue
                    records.append(
                        {
                            "bucket": bucket,
                            "channel": channel_name,
                            "content": content,
                            "created_at": str(message.get("created_at") or ""),
                        }
                    )
        return records

    def _detect_project_key(
        self,
        *,
        bucket: str,
        channel_name: str,
        category_rules: List[Dict[str, Any]],
        fallback_prefixes: List[str],
    ) -> tuple[str | None, str | None]:
        for idx, rule in enumerate(category_rules):
            rule_bucket = str(rule.get("bucket") or "").strip()
            if rule_bucket and rule_bucket != bucket:
                continue
            prefixes = [
                str(item).strip()
                for item in rule.get("channel_name_prefixes", [])
                if str(item).strip()
            ]
            for prefix in prefixes:
                if not channel_name.startswith(prefix):
                    continue
                project_key = _slugify(channel_name[len(prefix) :])
                if project_key:
                    return project_key, str(rule.get("rule_id") or f"category-rule-{idx}")
        for prefix in fallback_prefixes:
            if channel_name.startswith(prefix):
                project_key = _slugify(channel_name[len(prefix) :])
                if project_key:
                    return project_key, f"fallback-prefix-{prefix}"
        return None, None

    def _status_for_project(
        self,
        project: Dict[str, Any],
        *,
        target_date: date,
        active_days: int,
        watching_days: int,
    ) -> tuple[str, float]:
        if bool(project.get("archived", False)):
            return "archived", 0.0

        direct_dt = _from_iso_optional(project.get("last_direct_activity_at"))
        indirect_dt = _from_iso_optional(project.get("last_indirect_activity_at"))
        most_recent = direct_dt or indirect_dt
        if direct_dt and indirect_dt and indirect_dt > direct_dt:
            most_recent = indirect_dt

        if most_recent is None:
            return "inactive", 0.0

        age_days = (_date_floor(target_date) - most_recent.replace(hour=0, minute=0, second=0, microsecond=0)).days
        if age_days <= active_days:
            return "active", 1.0 if direct_dt and age_days <= active_days else 0.8
        if age_days <= watching_days:
            return "watching", 0.45
        return "inactive", 0.15

    @staticmethod
    def _append_unique(items: List[str], value: str) -> None:
        if value not in items:
            items.append(value)

    @staticmethod
    def _coerce_positive_int(value: Any, *, default: int) -> int:
        try:
            num = int(value)
        except (TypeError, ValueError):
            return default
        return num if num > 0 else default

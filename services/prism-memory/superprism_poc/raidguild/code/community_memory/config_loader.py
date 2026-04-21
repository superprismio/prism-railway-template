from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class CollectorConfig:
    key: str
    enabled: bool
    window_minutes: int
    initial_backfill_hours: int | None = None
    type: str = "builtin"
    module: str | None = None
    class_name: str | None = None
    command: List[str] | None = None
    env: Dict[str, str] | None = None
    options: Dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "CollectorConfig":
        return cls(
            key=str(raw["key"]),
            enabled=bool(raw.get("enabled", True)),
            window_minutes=int(raw.get("window_minutes", 60)),
            initial_backfill_hours=(
                int(raw["initial_backfill_hours"])
                if raw.get("initial_backfill_hours") is not None
                else None
            ),
            type=str(raw.get("type", "builtin")),
            module=(
                str(raw["module"])
                if raw.get("module") not in (None, "")
                else None
            ),
            class_name=(
                str(raw["class_name"])
                if raw.get("class_name") not in (None, "")
                else None
            ),
            command=[
                str(item) for item in raw.get("command", []) if str(item).strip()
            ]
            or None,
            env={
                str(key): str(value)
                for key, value in (raw.get("env", {}) or {}).items()
            }
            or None,
            options=dict(raw.get("options", {}) or {}) or None,
        )


@dataclass
class ThreadPromotionConfig:
    enabled: bool
    thread_ids: List[str]
    min_messages: int
    min_participants: int


@dataclass
class DiscordConfig:
    category_to_bucket: Dict[str, str]
    bucket_defaults: Dict[str, str]
    bucket_overrides: Dict[str, Dict[str, str]]
    thread_promotion: ThreadPromotionConfig


@dataclass
class RunSchedule:
    digest_run_time_local: str
    memory_run_time_local: str
    github_backup_run_time_local: str


@dataclass
class KnowledgeConstraints:
    allowed_kinds: List[str]
    allowed_tags: List[str]
    allowed_status: List[str]
    allowed_audiences: List[str]
    allowed_stability: List[str]
    max_tags_per_doc: int
    max_entities_per_doc: int
    max_related_docs_per_doc: int
    require_owner: bool
    strict_tag_enforcement: bool


@dataclass
class KnowledgeConfig:
    enabled: bool
    docs_root: str
    metadata_root: str
    index_root: str
    triage_root: str
    activity_path: str
    state_path: str
    triage_run_time_local: str
    index_run_time_local: str
    max_docs_per_triage_run: int
    kinds: List[str]
    constraints: KnowledgeConstraints


@dataclass
class SpaceConfig:
    space_slug: str
    timezone: str
    collectors: List[CollectorConfig]
    discord: DiscordConfig
    meetings: Dict[str, Any]
    inbox: Dict[str, Any]
    memory: Dict[str, Any]
    state: Dict[str, Any]
    knowledge: KnowledgeConfig
    run: RunSchedule


def load_config(path: Path) -> SpaceConfig:
    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    collectors = [CollectorConfig.from_dict(c) for c in raw.get("collectors", [])]
    discord_conf = raw.get("discord", {})
    thread_promotion_conf = discord_conf.get("thread_promotion", {})
    discord = DiscordConfig(
        category_to_bucket=discord_conf.get("category_to_bucket", {}),
        bucket_defaults=discord_conf.get("bucket_defaults", {}),
        bucket_overrides=discord_conf.get("bucket_overrides", {}),
        thread_promotion=ThreadPromotionConfig(
            enabled=bool(thread_promotion_conf.get("enabled", True)),
            thread_ids=[
                str(item).strip()
                for item in thread_promotion_conf.get("thread_ids", [])
                if str(item).strip()
            ],
            min_messages=int(thread_promotion_conf.get("min_messages", 6)),
            min_participants=int(thread_promotion_conf.get("min_participants", 2)),
        ),
    )
    meetings = raw.get("meetings", {})
    inbox = raw.get("inbox", {})
    memory = raw.get("memory", {})
    state = raw.get("state", {})
    knowledge_conf = raw.get("knowledge", {})
    constraints_conf = knowledge_conf.get("constraints", {})
    constraints = KnowledgeConstraints(
        allowed_kinds=constraints_conf.get(
            "allowed_kinds",
            ["architecture", "guide", "policy", "proposal", "reference", "note"],
        ),
        allowed_tags=constraints_conf.get("allowed_tags", []),
        allowed_status=constraints_conf.get(
            "allowed_status", ["draft", "active", "archived", "deprecated"]
        ),
        allowed_audiences=constraints_conf.get(
            "allowed_audiences", ["internal", "public"]
        ),
        allowed_stability=constraints_conf.get(
            "allowed_stability", ["evergreen", "evolving"]
        ),
        max_tags_per_doc=int(constraints_conf.get("max_tags_per_doc", 12)),
        max_entities_per_doc=int(constraints_conf.get("max_entities_per_doc", 20)),
        max_related_docs_per_doc=int(
            constraints_conf.get("max_related_docs_per_doc", 20)
        ),
        require_owner=bool(constraints_conf.get("require_owner", True)),
        strict_tag_enforcement=bool(
            constraints_conf.get("strict_tag_enforcement", True)
        ),
    )
    knowledge = KnowledgeConfig(
        enabled=bool(knowledge_conf.get("enabled", False)),
        docs_root=knowledge_conf.get(
            "docs_root", "superprism_poc/raidguild/knowledge/kb/docs"
        ),
        metadata_root=knowledge_conf.get(
            "metadata_root", "superprism_poc/raidguild/knowledge/kb/metadata"
        ),
        index_root=knowledge_conf.get(
            "index_root", "superprism_poc/raidguild/knowledge/kb/indexes"
        ),
        triage_root=knowledge_conf.get(
            "triage_root", "superprism_poc/raidguild/knowledge/kb/triage"
        ),
        activity_path=knowledge_conf.get(
            "activity_path",
            "superprism_poc/raidguild/knowledge/kb/activity/kb_activity.jsonl",
        ),
        state_path=knowledge_conf.get(
            "state_path", "superprism_poc/raidguild/knowledge/kb/state/kb_index_state.json"
        ),
        triage_run_time_local=knowledge_conf.get("triage_run_time_local", "18:15"),
        index_run_time_local=knowledge_conf.get("index_run_time_local", "18:25"),
        max_docs_per_triage_run=int(knowledge_conf.get("max_docs_per_triage_run", 20)),
        kinds=knowledge_conf.get(
            "kinds", ["architecture", "guide", "policy", "proposal", "reference", "note"]
        ),
        constraints=constraints,
    )
    run_conf = raw.get("run", {})
    run = RunSchedule(
        digest_run_time_local=run_conf.get("digest_run_time_local", "17:30"),
        memory_run_time_local=run_conf.get("memory_run_time_local", "17:45"),
        github_backup_run_time_local=run_conf.get("github_backup_run_time_local", "18:05"),
    )

    return SpaceConfig(
        space_slug=raw.get("space_slug", "space"),
        timezone=raw.get("timezone", "UTC"),
        collectors=collectors,
        discord=discord,
        meetings=meetings,
        inbox=inbox,
        memory=memory,
        state=state,
        knowledge=knowledge,
        run=run,
    )

from __future__ import annotations

import json
import os
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
class AgenticIngestProviderConfig:
    base_url: str
    api_key: Optional[str]
    model: Optional[str]
    timeout_seconds: int


@dataclass
class AgenticIngestPolicyConfig:
    priority_channels: List[str]
    deprioritized_channels: List[str]
    priority_topics: List[str]
    deprioritized_topics: List[str]
    channel_labels: Dict[str, str]
    custom_guidance: str


@dataclass
class AgenticIngestConfig:
    enabled: bool
    scope: str
    scoped_sources: List[str]
    scoped_buckets: List[str]
    provider: AgenticIngestProviderConfig
    policy: AgenticIngestPolicyConfig


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
    agentic_ingest: AgenticIngestConfig
    run: RunSchedule


def load_config(path: Path) -> SpaceConfig:
    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    base_slug = os.environ.get("PRISM_API_BUNDLED_BASE", "prism_seed").strip() or "prism_seed"
    space_slug = str(raw.get("space_slug", "default")).strip() or "default"
    knowledge_root = f"{base_slug}/{space_slug}/knowledge/kb"

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
        docs_root=knowledge_conf.get("docs_root", f"{knowledge_root}/docs"),
        metadata_root=knowledge_conf.get("metadata_root", f"{knowledge_root}/metadata"),
        index_root=knowledge_conf.get("index_root", f"{knowledge_root}/indexes"),
        triage_root=knowledge_conf.get("triage_root", f"{knowledge_root}/triage"),
        activity_path=knowledge_conf.get("activity_path", f"{knowledge_root}/activity/kb_activity.jsonl"),
        state_path=knowledge_conf.get("state_path", f"{knowledge_root}/state/kb_index_state.json"),
        triage_run_time_local=knowledge_conf.get("triage_run_time_local", "18:15"),
        index_run_time_local=knowledge_conf.get("index_run_time_local", "18:25"),
        max_docs_per_triage_run=int(knowledge_conf.get("max_docs_per_triage_run", 20)),
        kinds=knowledge_conf.get(
            "kinds", ["architecture", "guide", "policy", "proposal", "reference", "note"]
        ),
        constraints=constraints,
    )
    agentic_conf = raw.get("agentic_ingest", {})
    raw_mode = str(agentic_conf.get("mode", "off")).strip() if isinstance(agentic_conf, dict) else "off"
    raw_scope = str(agentic_conf.get("scope", "")).strip() if isinstance(agentic_conf, dict) else ""
    env_enabled = os.environ.get("AGENTIC_INGEST_ENABLED")
    env_scope = os.environ.get("AGENTIC_INGEST_SCOPE")
    env_mode = os.environ.get("AGENTIC_INGEST_MODE")
    enabled_default = raw_mode != "off"
    if isinstance(agentic_conf, dict) and "enabled" in agentic_conf:
        enabled_default = bool(agentic_conf.get("enabled"))
    if env_enabled is not None:
        enabled_value = env_enabled.strip().lower() in ("1", "true", "yes", "on")
    elif env_mode is not None:
        enabled_value = env_mode.strip() != "off"
    else:
        enabled_value = enabled_default
    scope_default = raw_scope or (raw_mode if raw_mode in ("bot_only", "scoped", "all") else "bot_only")
    provider_conf = agentic_conf.get("provider", {}) if isinstance(agentic_conf, dict) else {}
    policy_conf = agentic_conf.get("policy", {}) if isinstance(agentic_conf, dict) else {}
    agentic_ingest = AgenticIngestConfig(
        enabled=enabled_value,
        scope=str(env_scope if env_scope is not None else scope_default).strip() or "bot_only",
        scoped_sources=[
            item.strip()
            for item in str(
                os.environ.get(
                    "AGENTIC_INGEST_SCOPED_SOURCES",
                    ",".join(agentic_conf.get("scoped_sources", [])),
                )
            ).split(",")
            if item.strip()
        ],
        scoped_buckets=[
            item.strip()
            for item in str(
                os.environ.get(
                    "AGENTIC_INGEST_SCOPED_BUCKETS",
                    ",".join(agentic_conf.get("scoped_buckets", [])),
                )
            ).split(",")
            if item.strip()
        ],
        provider=AgenticIngestProviderConfig(
            base_url=str(
                os.environ.get(
                    "AGENTIC_INGEST_PROVIDER_BASE_URL",
                    provider_conf.get("base_url", ""),
                )
            ).strip(),
            api_key=(
                str(
                    os.environ.get(
                        "AGENTIC_INGEST_PROVIDER_API_KEY",
                        provider_conf.get("api_key", ""),
                    )
                ).strip()
                or None
            ),
            model=(
                str(
                    os.environ.get(
                        "AGENTIC_INGEST_MODEL",
                        provider_conf.get("model", ""),
                    )
                ).strip()
                or None
            ),
            timeout_seconds=int(
                os.environ.get(
                    "AGENTIC_INGEST_TIMEOUT_SECONDS",
                    provider_conf.get("timeout_seconds", 30),
                )
            ),
        ),
        policy=AgenticIngestPolicyConfig(
            priority_channels=[
                str(item).strip()
                for item in policy_conf.get("priority_channels", [])
                if str(item).strip()
            ],
            deprioritized_channels=[
                str(item).strip()
                for item in policy_conf.get("deprioritized_channels", [])
                if str(item).strip()
            ],
            priority_topics=[
                str(item).strip()
                for item in policy_conf.get("priority_topics", [])
                if str(item).strip()
            ],
            deprioritized_topics=[
                str(item).strip()
                for item in policy_conf.get("deprioritized_topics", [])
                if str(item).strip()
            ],
            channel_labels={
                str(key).strip(): str(value).strip()
                for key, value in (policy_conf.get("channel_labels", {}) or {}).items()
                if str(key).strip() and str(value).strip()
            },
            custom_guidance=str(policy_conf.get("custom_guidance", "")).strip(),
        ),
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
        agentic_ingest=agentic_ingest,
        run=run,
    )

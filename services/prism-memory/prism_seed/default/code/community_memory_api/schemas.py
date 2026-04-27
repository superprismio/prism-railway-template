from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    code: str = Field(..., description="Machine-readable error code")
    message: str = Field(..., description="Human-readable error message")


class ErrorResponse(BaseModel):
    error: ErrorDetail


class HealthResponse(BaseModel):
    ok: bool = True
    service: str
    space: str


class KnowledgeInboxRequest(BaseModel):
    filename: str = Field(..., description="Target filename (will be created inside knowledge/kb/triage/inbox)")
    content: str = Field(..., description="Markdown body to drop into the inbox")
    metadata: Dict[str, Any] = Field(..., description="Metadata JSON sidecar")


class KnowledgeInboxResponse(BaseModel):
    path: str
    metadata_path: str
    warnings: Optional[list[str]] = None


class KnowledgeSourceState(BaseModel):
    source_id: str
    status: str
    last_requested_at: Optional[str] = None
    last_started_at: Optional[str] = None
    last_completed_at: Optional[str] = None
    last_synced_at: Optional[str] = None
    last_synced_commit: Optional[str] = None
    file_count: int = 0
    doc_count: int = 0
    docs_roots: list[str] = Field(default_factory=list)
    change_summary: Dict[str, int] = Field(default_factory=dict)
    error: Optional[Dict[str, str]] = None


class KnowledgeSourceCreateRequest(BaseModel):
    id: Optional[str] = None
    kind: str = "github"
    repo_url: str
    branch: str = "main"
    label: Optional[str] = None
    content_policy: str = "markdown-only"
    docs_roots: list[str] = Field(default_factory=list)
    include: list[str] = Field(default_factory=list)
    exclude: list[str] = Field(default_factory=list)
    sync_mode: str = "manual"
    managed_by: str = "api"
    default_kind: str = "reference"
    default_tags: list[str] = Field(default_factory=list)
    owner: Optional[str] = None
    audience: str = "public"
    stability: str = "evolving"


class KnowledgeSourceUpdateRequest(BaseModel):
    branch: Optional[str] = None
    label: Optional[str] = None
    docs_roots: Optional[list[str]] = None
    include: Optional[list[str]] = None
    exclude: Optional[list[str]] = None
    sync_mode: Optional[str] = None
    managed_by: Optional[str] = None
    default_kind: Optional[str] = None
    default_tags: Optional[list[str]] = None
    owner: Optional[str] = None
    audience: Optional[str] = None
    stability: Optional[str] = None


class KnowledgeSourceResponse(BaseModel):
    id: str
    kind: str
    repo_url: str
    branch: str
    label: str
    content_policy: str
    docs_roots: list[str]
    include: list[str]
    exclude: list[str]
    sync_mode: str
    managed_by: str
    default_kind: str
    default_tags: list[str]
    owner: str
    audience: str
    stability: str
    status: str
    last_synced_commit: Optional[str] = None
    last_synced_at: Optional[str] = None
    created_at: str
    updated_at: str
    state: KnowledgeSourceState


class KnowledgeSourceListResponse(BaseModel):
    sources: list[KnowledgeSourceResponse]
    total: int


class MemoryInboxRequest(BaseModel):
    source: str
    ts: datetime
    type: str
    content: str
    bucket: Optional[str] = None
    bucket_hint: Optional[str] = None
    author: Optional[str] = None
    url: Optional[str] = None
    participants: Optional[list[str]] = None
    participant_count: Optional[int] = None


class MemoryInboxResponse(BaseModel):
    path: str


class ArtifactSummary(BaseModel):
    id: str
    category: str
    status: str
    path: str
    filename: str
    source: Optional[str] = None
    type: Optional[str] = None
    created_at: str
    bucket: Optional[str] = None
    author: Optional[str] = None
    url: Optional[str] = None
    participants: Optional[list[str]] = None
    participant_count: Optional[int] = None
    content_length: int
    preview: str


class ArtifactDetail(ArtifactSummary):
    content: str
    payload: Dict[str, Any]


class ArtifactListResponse(BaseModel):
    artifacts: list[ArtifactSummary]
    total: int
    limit: int
    filters: Dict[str, Optional[str]]


class StateProjectUpsertRequest(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    aliases: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    owners: Optional[list[str]] = None
    archived: Optional[bool] = None


class StateProjectUpsertResponse(BaseModel):
    path: str
    latest_path: str
    project_key: str
    updated_at: str
    project: Dict[str, Any]


class ParticipantActivityEntry(BaseModel):
    participant: str
    message_count: int
    bucket_count: int
    channel_count: int
    first_seen: str
    last_seen: str
    buckets: list[str]
    channels: list[str]
    sources: list[str]
    participant_mentions: int = 0


class ParticipantActivityResponse(BaseModel):
    start: str
    end: str
    bucket: Optional[str] = None
    limit: int
    total_participants: int
    results: list[ParticipantActivityEntry]


class OpsResponse(BaseModel):
    ok: bool
    operation: str
    command: list[str]
    cwd: str
    exit_code: int
    stdout: str
    stderr: str


class OpsBackfillResponse(BaseModel):
    ok: bool
    operation: str
    start_date: str
    end_date: str
    days: int
    collect: OpsResponse
    results: list[OpsResponse]


class SpaceConfigUpdateRequest(BaseModel):
    config: Dict[str, Any] = Field(..., description="Full replacement for config/space.json")


class SpaceConfigUpdateResponse(BaseModel):
    path: str
    updated_at: str
    sha256: str
    knowledge_allowed_kinds: list[str]
    knowledge_allowed_tags: list[str]


JSONMapping = Dict[str, Any]

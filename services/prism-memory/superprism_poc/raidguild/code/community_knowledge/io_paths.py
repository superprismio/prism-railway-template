from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from community_memory.config_loader import SpaceConfig


@dataclass
class KnowledgePaths:
    docs_root: Path
    metadata_root: Path
    index_root: Path
    triage_root: Path
    activity_path: Path
    state_path: Path

    @property
    def triage_inbox(self) -> Path:
        return self.triage_root / "inbox"

    @property
    def triage_reviewed(self) -> Path:
        return self.triage_root / "reviewed"


def _resolve(root: Path, value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (root / path).resolve()


def from_config(workspace_root: Path, config: SpaceConfig) -> KnowledgePaths:
    knowledge = config.knowledge
    return KnowledgePaths(
        docs_root=_resolve(workspace_root, knowledge.docs_root),
        metadata_root=_resolve(workspace_root, knowledge.metadata_root),
        index_root=_resolve(workspace_root, knowledge.index_root),
        triage_root=_resolve(workspace_root, knowledge.triage_root),
        activity_path=_resolve(workspace_root, knowledge.activity_path),
        state_path=_resolve(workspace_root, knowledge.state_path),
    )


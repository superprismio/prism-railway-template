from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from community_memory.config_loader import SpaceConfig

from .activity import KnowledgeActivityLogger
from .io_paths import KnowledgePaths
from .schemas import validate_metadata


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def _extract_headings(path: Path) -> list[str]:
    headings: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            headings.append(stripped.lstrip("#").strip())
    return headings


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


@dataclass
class IndexBuildResult:
    docs_seen: int
    docs_indexed: int
    warnings: list[str]
    errors: list[str]
    outputs: list[Path]

    @property
    def ok(self) -> bool:
        return not self.errors


class KnowledgeIndexBuilder:
    def __init__(
        self,
        *,
        workspace_root: Path,
        config: SpaceConfig,
        paths: KnowledgePaths,
        activity: KnowledgeActivityLogger,
    ) -> None:
        self.workspace_root = workspace_root
        self.config = config
        self.paths = paths
        self.activity = activity

    def _meta_path_for(self, doc_path: Path) -> Path:
        rel = doc_path.relative_to(self.paths.docs_root)
        rel_meta = rel.with_suffix(".meta.json")
        return self.paths.metadata_root / rel_meta

    def _rel(self, path: Path) -> str:
        try:
            return str(path.relative_to(self.workspace_root))
        except ValueError:
            return str(path)

    def rebuild(self) -> IndexBuildResult:
        self.paths.index_root.mkdir(parents=True, exist_ok=True)
        docs = sorted(self.paths.docs_root.rglob("*.md"))

        manifest: list[dict[str, Any]] = []
        tags: dict[str, set[str]] = {}
        entities: dict[str, set[str]] = {}
        related: dict[str, list[str]] = {}
        headings: dict[str, list[str]] = {}

        warnings: list[str] = []
        errors: list[str] = []

        allowed_kinds = self.config.knowledge.constraints.allowed_kinds
        if self.config.knowledge.kinds:
            allowed_kinds = sorted(set(allowed_kinds + self.config.knowledge.kinds))

        for doc_path in docs:
            doc_rel = self._rel(doc_path)
            meta_path = self._meta_path_for(doc_path)
            if not meta_path.exists():
                errors.append(f"{doc_rel}: missing metadata file {self._rel(meta_path)}")
                continue

            metadata = _read_json(meta_path)
            validation = validate_metadata(
                metadata,
                constraints=self.config.knowledge.constraints,
                allowed_kinds=allowed_kinds,
            )
            warnings.extend([f"{doc_rel}: {w}" for w in validation.warnings])
            if not validation.ok:
                errors.extend([f"{doc_rel}: {e}" for e in validation.errors])
                continue

            entry = {
                "path": doc_rel,
                "meta_path": self._rel(meta_path),
                "title": metadata.get("title", ""),
                "kind": metadata.get("kind", ""),
                "tags": metadata.get("tags", []),
                "summary": metadata.get("summary", ""),
                "status": metadata.get("status", ""),
                "audience": metadata.get("audience", ""),
                "stability": metadata.get("stability", ""),
                "updated": metadata.get("updated", ""),
                "entities": metadata.get("entities", []),
            }
            manifest.append(entry)

            for tag in metadata.get("tags", []):
                tags.setdefault(str(tag), set()).add(doc_rel)
            for entity in metadata.get("entities", []):
                entities.setdefault(str(entity), set()).add(doc_rel)

            related_docs = [str(item) for item in metadata.get("related_docs", [])]
            related[doc_rel] = sorted(set(related_docs))
            headings[doc_rel] = _extract_headings(doc_path)

        manifest.sort(key=lambda item: item["path"])
        tags_out = {key: sorted(values) for key, values in sorted(tags.items())}
        entities_out = {key: sorted(values) for key, values in sorted(entities.items())}
        related_out = {key: value for key, value in sorted(related.items())}
        headings_out = {key: value for key, value in sorted(headings.items())}

        outputs = [
            self.paths.index_root / "manifest.json",
            self.paths.index_root / "tags.json",
            self.paths.index_root / "entities.json",
            self.paths.index_root / "related.json",
            self.paths.index_root / "headings.json",
        ]
        _write_json(outputs[0], manifest)
        _write_json(outputs[1], tags_out)
        _write_json(outputs[2], entities_out)
        _write_json(outputs[3], related_out)
        _write_json(outputs[4], headings_out)

        state_payload = {
            "last_indexed_at": _now_iso(),
            "docs_seen": len(docs),
            "docs_indexed": len(manifest),
            "errors": len(errors),
            "warnings": len(warnings),
        }
        _write_json(self.paths.state_path, state_payload)

        self.activity.log(
            "index.rebuilt",
            outputs=[self._rel(path) for path in outputs],
            meta=state_payload,
        )

        return IndexBuildResult(
            docs_seen=len(docs),
            docs_indexed=len(manifest),
            warnings=warnings,
            errors=errors,
            outputs=outputs,
        )


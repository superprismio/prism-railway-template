from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from community_memory.config_loader import SpaceConfig

from .activity import KnowledgeActivityLogger
from .index_builder import KnowledgeIndexBuilder
from .io_paths import from_config
from .schemas import validate_metadata


_SOURCE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
_DEFAULT_INCLUDE = ("**/*.md", "**/*.mdx")
_DEFAULT_EXCLUDE = (
    "**/.git/**",
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/.vercel/**",
)
_IGNORED_SEGMENTS = {".git", "node_modules", ".next", "dist", "build", "coverage", ".turbo", ".vercel"}
_DOC_ROOT_MARKERS = ("docs", "content", "pages", "app")
_GIT_COMMAND_TIMEOUT_SECONDS = 120
_ALLOWED_SOURCE_PROFILES = {"canonical", "archive"}


logger = logging.getLogger(__name__)


class KnowledgeSourceError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class KnowledgeSourceManager:
    data_root: Path
    workspace_root: Path
    load_config: Callable[[], SpaceConfig]

    @property
    def registry_root(self) -> Path:
        return self.data_root / "knowledge" / "sources"

    def list_sources(self) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for path in sorted(self.registry_root.glob("*.json")) if self.registry_root.is_dir() else []:
            results.append(self.get_source(path.stem))
        return results

    def get_source(self, source_id: str) -> dict[str, Any]:
        normalized = self._normalize_source_id(source_id)
        source = self._hydrate_source_record(self._read_json(self._source_record_path(normalized)))
        state = self._load_state(normalized)
        source["state"] = state
        return source

    def create_source(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = self._now_iso()
        record = self._build_record(payload, existing=None, now=now)
        path = self._source_record_path(record["id"])
        if path.exists():
            raise KnowledgeSourceError("file_exists", f"Knowledge source already exists: {record['id']}")
        self._ensure_unique_repo_binding(record["repo_url"], record["branch"], exclude_source_id=None)
        self.registry_root.mkdir(parents=True, exist_ok=True)
        self._write_json(path, record)
        self._write_json(
            self._state_path(record["id"]),
            {
                "source_id": record["id"],
                "status": "pending",
                "last_requested_at": None,
                "last_started_at": None,
                "last_completed_at": None,
                "last_synced_at": None,
                "last_synced_commit": None,
                "file_count": 0,
                "doc_count": 0,
                "docs_roots": record["docs_roots"],
                "change_summary": {"added": 0, "changed": 0, "removed": 0},
                "error": None,
            },
        )
        return self.get_source(record["id"])

    def update_source(self, source_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.get_source(source_id)
        now = self._now_iso()
        merged = dict(existing)
        merged.update(payload)
        merged.pop("state", None)
        record = self._build_record(merged, existing=existing, now=now)
        self._ensure_unique_repo_binding(record["repo_url"], record["branch"], exclude_source_id=record["id"])
        self._write_json(self._source_record_path(record["id"]), record)
        state = self._load_state(record["id"])
        state["docs_roots"] = record["docs_roots"]
        self._write_json(self._state_path(record["id"]), state)
        return self.get_source(record["id"])

    def sync_source(self, source_id: str) -> dict[str, Any]:
        record = self.get_source(source_id)
        record.pop("state", None)
        state = self._load_state(source_id)
        requested_at = self._now_iso()
        state = self._update_state(
            source_id,
            {
                **state,
                "status": "syncing",
                "last_requested_at": requested_at,
                "last_started_at": requested_at,
                "current_step": "starting",
                "error": None,
            },
        )

        config = self.load_config()
        paths = from_config(self.workspace_root, config)
        paths.docs_root.mkdir(parents=True, exist_ok=True)
        paths.metadata_root.mkdir(parents=True, exist_ok=True)
        activity = KnowledgeActivityLogger(paths.activity_path)

        history_payload: dict[str, Any] | None = None
        try:
            with tempfile.TemporaryDirectory(prefix=f"knowledge-source-{source_id}-") as tmp_root_str:
                tmp_root = Path(tmp_root_str)
                checkout_dir = tmp_root / "repo"
                self._update_state(source_id, {**state, "current_step": "cloning"})
                self._checkout_repo(record, checkout_dir)
                self._update_state(source_id, {**self._load_state(source_id), "current_step": "resolving_commit"})
                commit = self._git_output(["rev-parse", "HEAD"], checkout_dir)
                self._update_state(source_id, {**self._load_state(source_id), "current_step": "discovering_docs_roots"})
                inferred_docs_roots = record["docs_roots"] or self._infer_docs_roots(checkout_dir)
                if not inferred_docs_roots:
                    raise KnowledgeSourceError(
                        "docs_roots_not_found",
                        "No docs roots were provided and no obvious markdown docs roots were found",
                    )
                derived_docs_dir = tmp_root / "derived" / "docs"
                derived_meta_dir = tmp_root / "derived" / "metadata"
                self._update_state(
                    source_id,
                    {
                        **self._load_state(source_id),
                        "current_step": "building_projection",
                        "docs_roots": inferred_docs_roots,
                    },
                )
                build = self._build_source_projection(
                    source=record,
                    config=config,
                    checkout_dir=checkout_dir,
                    docs_roots=inferred_docs_roots,
                    derived_docs_dir=derived_docs_dir,
                    derived_meta_dir=derived_meta_dir,
                )

                source_docs_dir = paths.docs_root / "sources" / source_id
                source_meta_dir = paths.metadata_root / "sources" / source_id
                previous_hashes = self._collect_hashes(source_docs_dir, suffix=".md")
                new_hashes = self._collect_hashes(derived_docs_dir, suffix=".md")
                change_summary = self._diff_hashes(previous_hashes, new_hashes)

                self._update_state(source_id, {**self._load_state(source_id), "current_step": "writing_outputs"})
                self._replace_tree(source_docs_dir, derived_docs_dir)
                self._replace_tree(source_meta_dir, derived_meta_dir)
                self._replace_tree(self._mirror_dir(source_id), checkout_dir)

                self._update_state(source_id, {**self._load_state(source_id), "current_step": "rebuilding_index"})
                index_builder = KnowledgeIndexBuilder(
                    workspace_root=self.workspace_root,
                    config=config,
                    paths=paths,
                    activity=activity,
                )
                index_result = index_builder.rebuild()
                if not index_result.ok:
                    raise KnowledgeSourceError(
                        "index_failed",
                        "; ".join(index_result.errors[:10]) or "Knowledge index rebuild failed",
                    )

                completed_at = self._now_iso()
                record["docs_roots"] = inferred_docs_roots
                record["last_synced_commit"] = commit
                record["last_synced_at"] = completed_at
                record["status"] = "synced"
                record["updated_at"] = completed_at
                self._write_json(self._source_record_path(source_id), record)

                state = {
                    "source_id": source_id,
                    "status": "synced",
                    "last_requested_at": requested_at,
                    "last_started_at": requested_at,
                    "last_completed_at": completed_at,
                    "last_synced_at": completed_at,
                    "last_synced_commit": commit,
                    "file_count": build["file_count"],
                    "doc_count": build["doc_count"],
                    "docs_roots": inferred_docs_roots,
                    "change_summary": change_summary,
                    "current_step": "completed",
                    "error": None,
                }
                self._write_json(self._state_path(source_id), state)
                history_payload = {
                    "source_id": source_id,
                    "status": "synced",
                    "requested_at": requested_at,
                    "started_at": requested_at,
                    "completed_at": completed_at,
                    "repo_url": record["repo_url"],
                    "branch": record["branch"],
                    "content_policy": record["content_policy"],
                    "docs_roots": inferred_docs_roots,
                    "commit": commit,
                    "file_count": build["file_count"],
                    "doc_count": build["doc_count"],
                    "change_summary": change_summary,
                    "steps": [
                        "cloning",
                        "resolving_commit",
                        "discovering_docs_roots",
                        "building_projection",
                        "writing_outputs",
                        "rebuilding_index",
                        "completed",
                    ],
                }
                self._write_history(source_id, history_payload)
                activity.log(
                    "source.synced",
                    outputs=[
                        self._rel_to_workspace(source_docs_dir),
                        self._rel_to_workspace(source_meta_dir),
                    ],
                    meta=history_payload,
                )
        except KnowledgeSourceError as exc:
            completed_at = self._now_iso()
            error_state = {
                **self._load_state(source_id),
                "status": "error",
                "last_requested_at": requested_at,
                "last_started_at": requested_at,
                "last_completed_at": completed_at,
                "current_step": "error",
                "error": {"code": exc.code, "message": exc.message},
            }
            self._write_json(self._state_path(source_id), error_state)
            record["status"] = "error"
            record["updated_at"] = completed_at
            self._write_json(self._source_record_path(source_id), record)
            self._write_history(
                source_id,
                {
                    "source_id": source_id,
                    "status": "error",
                    "requested_at": requested_at,
                    "started_at": requested_at,
                    "completed_at": completed_at,
                    "repo_url": record["repo_url"],
                    "branch": record["branch"],
                    "current_step": error_state.get("current_step"),
                    "error": {"code": exc.code, "message": exc.message},
                },
            )
            raise
        except Exception as exc:
            completed_at = self._now_iso()
            error_state = {
                **self._load_state(source_id),
                "status": "error",
                "last_requested_at": requested_at,
                "last_started_at": requested_at,
                "last_completed_at": completed_at,
                "current_step": "error",
                "error": {"code": "unexpected_error", "message": str(exc)},
            }
            self._write_json(self._state_path(source_id), error_state)
            record["status"] = "error"
            record["updated_at"] = completed_at
            self._write_json(self._source_record_path(source_id), record)
            self._write_history(
                source_id,
                {
                    "source_id": source_id,
                    "status": "error",
                    "requested_at": requested_at,
                    "started_at": requested_at,
                    "completed_at": completed_at,
                    "repo_url": record["repo_url"],
                    "branch": record["branch"],
                    "current_step": error_state.get("current_step"),
                    "error": {"code": "unexpected_error", "message": str(exc)},
                },
            )
            logger.exception("knowledge source sync failed unexpectedly source_id=%s", source_id)
            raise

        return self.get_source(source_id)

    def _build_record(
        self,
        payload: dict[str, Any],
        *,
        existing: dict[str, Any] | None,
        now: str,
    ) -> dict[str, Any]:
        source_id = payload.get("id") or self._infer_source_id(payload.get("label"), payload.get("repo_url"))
        normalized_id = self._normalize_source_id(str(source_id))
        kind = str(payload.get("kind") or "github").strip().lower()
        if kind != "github":
            raise KnowledgeSourceError("invalid_source_kind", "Only github knowledge sources are supported")
        repo_url = str(payload.get("repo_url") or "").strip()
        if not repo_url:
            raise KnowledgeSourceError("invalid_repo_url", "repo_url is required")
        branch = str(payload.get("branch") or "main").strip()
        if not branch:
            raise KnowledgeSourceError("invalid_branch", "branch is required")
        content_policy = str(payload.get("content_policy") or "markdown-only").strip().lower()
        if content_policy != "markdown-only":
            raise KnowledgeSourceError("invalid_content_policy", "Only markdown-only content_policy is supported")
        source_profile = str(payload.get("source_profile") or "canonical").strip().lower()
        if source_profile not in _ALLOWED_SOURCE_PROFILES:
            raise KnowledgeSourceError(
                "invalid_source_profile",
                f"source_profile must be one of: {', '.join(sorted(_ALLOWED_SOURCE_PROFILES))}",
            )
        docs_roots = self._normalize_docs_roots(payload.get("docs_roots"))
        include = self._normalize_patterns(payload.get("include"), default=_DEFAULT_INCLUDE)
        exclude = self._normalize_patterns(payload.get("exclude"), default=_DEFAULT_EXCLUDE)
        config = self.load_config()
        allowed_tags = list(config.knowledge.constraints.allowed_tags)
        default_tags = self._normalize_default_tags(payload.get("default_tags"), allowed_tags)
        record = {
            "id": normalized_id,
            "kind": kind,
            "repo_url": repo_url,
            "branch": branch,
            "label": str(payload.get("label") or normalized_id.replace("-", " ").title()).strip(),
            "source_profile": source_profile,
            "content_policy": content_policy,
            "docs_roots": docs_roots,
            "include": include,
            "exclude": exclude,
            "sync_mode": str(payload.get("sync_mode") or "manual").strip() or "manual",
            "managed_by": str(payload.get("managed_by") or "api").strip() or "api",
            "default_kind": str(payload.get("default_kind") or "reference").strip() or "reference",
            "default_tags": default_tags,
            "owner": str(payload.get("owner") or f"source:{normalized_id}").strip() or f"source:{normalized_id}",
            "audience": str(payload.get("audience") or "public").strip() or "public",
            "stability": str(payload.get("stability") or "evolving").strip() or "evolving",
            "status": str(payload.get("status") or (existing or {}).get("status") or "pending").strip() or "pending",
            "last_synced_commit": (existing or {}).get("last_synced_commit"),
            "last_synced_at": (existing or {}).get("last_synced_at"),
            "created_at": (existing or {}).get("created_at") or now,
            "updated_at": now,
        }
        return record

    def _hydrate_source_record(self, record: dict[str, Any]) -> dict[str, Any]:
        hydrated = dict(record)
        hydrated["source_profile"] = str(hydrated.get("source_profile") or "canonical").strip().lower() or "canonical"
        return hydrated

    def _build_source_projection(
        self,
        *,
        source: dict[str, Any],
        config: SpaceConfig,
        checkout_dir: Path,
        docs_roots: list[str],
        derived_docs_dir: Path,
        derived_meta_dir: Path,
    ) -> dict[str, int]:
        file_count = 0
        doc_count = 0
        derived_docs_dir.mkdir(parents=True, exist_ok=True)
        derived_meta_dir.mkdir(parents=True, exist_ok=True)
        allowed_kinds = config.knowledge.constraints.allowed_kinds
        if config.knowledge.kinds:
            allowed_kinds = sorted(set(allowed_kinds + config.knowledge.kinds))
        for source_file in self._iter_source_files(checkout_dir, docs_roots, source["include"], source["exclude"]):
            relative_repo_path = source_file.relative_to(checkout_dir)
            normalized_relative = relative_repo_path.with_suffix(".md")
            target_doc = derived_docs_dir / normalized_relative
            target_meta = (derived_meta_dir / normalized_relative).with_suffix(".meta.json")
            title, summary, content = self._normalize_doc(source_file)
            metadata = self._build_metadata(
                source=source,
                relative_repo_path=relative_repo_path,
                title=title,
                summary=summary,
            )
            validation = validate_metadata(
                metadata,
                constraints=config.knowledge.constraints,
                allowed_kinds=allowed_kinds,
            )
            if not validation.ok:
                raise KnowledgeSourceError(
                    "invalid_metadata",
                    f"{relative_repo_path.as_posix()}: {'; '.join(validation.errors[:10])}",
                )
            target_doc.parent.mkdir(parents=True, exist_ok=True)
            target_meta.parent.mkdir(parents=True, exist_ok=True)
            target_doc.write_text(content, encoding="utf-8")
            target_meta.write_text(
                json.dumps(metadata, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            file_count += 1
            doc_count += 1
        return {"file_count": file_count, "doc_count": doc_count}

    def _build_metadata(
        self,
        *,
        source: dict[str, Any],
        relative_repo_path: Path,
        title: str,
        summary: str,
    ) -> dict[str, Any]:
        now = self._now_iso()
        slug = f"sources/{source['id']}/{relative_repo_path.with_suffix('').as_posix()}"
        source_path = relative_repo_path.as_posix()
        document_class = self._infer_document_class(source, relative_repo_path)
        source_profile = str(source.get("source_profile") or "canonical").strip().lower() or "canonical"
        return {
            "title": title,
            "slug": slug,
            "kind": source["default_kind"],
            "summary": summary,
            "tags": source["default_tags"],
            "owners": [source["owner"]],
            "status": "active",
            "audience": source["audience"],
            "stability": source["stability"],
            "updated": now,
            "entities": [],
            "related_docs": [],
            "triaged_at": now,
            "source_id": source["id"],
            "source_kind": source["kind"],
            "source_repo": source["repo_url"],
            "source_branch": source["branch"],
            "source_path": source_path,
            "source_profile": source_profile,
            "document_class": document_class,
            "historical": source_profile == "archive",
            "managed_by_repo": True,
        }

    def _checkout_repo(self, source: dict[str, Any], checkout_dir: Path) -> None:
        parent = checkout_dir.parent
        parent.mkdir(parents=True, exist_ok=True)
        command = [
            "git",
            "clone",
            "--depth",
            "1",
            "--branch",
            source["branch"],
            source["repo_url"],
            str(checkout_dir),
        ]
        try:
            logger.info("knowledge source clone start source_id=%s repo=%s branch=%s", source.get("id"), source["repo_url"], source["branch"])
            subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=True,
                timeout=_GIT_COMMAND_TIMEOUT_SECONDS,
            )
            logger.info("knowledge source clone complete source_id=%s", source.get("id"))
        except FileNotFoundError as exc:
            raise KnowledgeSourceError("git_missing", "git is required for knowledge source sync") from exc
        except subprocess.TimeoutExpired as exc:
            raise KnowledgeSourceError(
                "git_clone_timeout",
                f"git clone timed out after {_GIT_COMMAND_TIMEOUT_SECONDS}s",
            ) from exc
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").strip()
            raise KnowledgeSourceError("git_clone_failed", stderr or "git clone failed") from exc

    def _infer_docs_roots(self, checkout_dir: Path) -> list[str]:
        candidates: set[str] = set()
        for path in checkout_dir.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".md", ".mdx"}:
                continue
            rel = path.relative_to(checkout_dir)
            if any(part in _IGNORED_SEGMENTS for part in rel.parts):
                continue
            for index, part in enumerate(rel.parts[:-1]):
                if part.lower() in _DOC_ROOT_MARKERS:
                    candidates.add(Path(*rel.parts[: index + 1]).as_posix())
                    break
        if not candidates:
            return []
        sorted_candidates = sorted(candidates, key=lambda item: (item.count("/"), item))
        compacted: list[str] = []
        for candidate in sorted_candidates:
            if any(candidate == root or candidate.startswith(f"{root}/") for root in compacted):
                continue
            compacted.append(candidate)
        return compacted

    def _iter_source_files(
        self,
        checkout_dir: Path,
        docs_roots: list[str],
        include: list[str],
        exclude: list[str],
    ) -> list[Path]:
        results: list[Path] = []
        for docs_root in docs_roots:
            root = (checkout_dir / docs_root).resolve()
            if not root.exists() or not root.is_dir():
                continue
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix.lower() not in {".md", ".mdx"}:
                    continue
                rel = path.relative_to(checkout_dir).as_posix()
                if any(part in _IGNORED_SEGMENTS for part in Path(rel).parts):
                    continue
                if not any(Path(rel).match(pattern) for pattern in include):
                    continue
                if any(Path(rel).match(pattern) for pattern in exclude):
                    continue
                results.append(path)
        return sorted(set(results))

    def _normalize_doc(self, path: Path) -> tuple[str, str, str]:
        raw = path.read_text(encoding="utf-8")
        lines = raw.splitlines()
        filtered: list[str] = []
        heading = ""
        line_iter = iter(enumerate(lines))
        if lines and lines[0].strip() == "---":
            next(line_iter, None)
            for _index, line in line_iter:
                if line.strip() == "---":
                    break
        else:
            line_iter = iter(enumerate(lines))
        for _index, line in line_iter:
            stripped = line.strip()
            if stripped.startswith("import ") or stripped.startswith("export "):
                continue
            if not heading and stripped.startswith("#"):
                heading = stripped.lstrip("#").strip()
            filtered.append(line)
        content = "\n".join(filtered).strip()
        if content:
            content += "\n"
        title = heading or self._prettify_name(path.stem)
        summary = self._extract_summary(content, fallback=title)
        return title, summary, content

    def _extract_summary(self, content: str, *, fallback: str) -> str:
        for line in content.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            return stripped[:240]
        return fallback[:240]

    def _normalize_default_tags(self, value: Any, allowed_tags: list[str]) -> list[str]:
        tags = [str(item).strip() for item in (value or []) if str(item).strip()]
        if not tags:
            tags = [tag for tag in ("knowledge", "general") if tag in allowed_tags]
        if not tags and allowed_tags:
            tags = [allowed_tags[0]]
        if not tags:
            raise KnowledgeSourceError("invalid_tags", "No allowed tags are configured for knowledge sources")
        invalid = sorted(tag for tag in tags if tag not in allowed_tags)
        if invalid:
            raise KnowledgeSourceError("invalid_tags", f"Unknown tags: {', '.join(invalid)}")
        return list(dict.fromkeys(tags))

    def _normalize_docs_roots(self, value: Any) -> list[str]:
        roots = [str(item).strip().strip("/") for item in (value or []) if str(item).strip()]
        normalized: list[str] = []
        for item in roots:
            if item == "." or item.startswith("../"):
                raise KnowledgeSourceError("invalid_docs_roots", "docs_roots must stay within the repository")
            normalized.append(item)
        return list(dict.fromkeys(normalized))

    def _normalize_patterns(self, value: Any, *, default: tuple[str, ...]) -> list[str]:
        patterns = [str(item).strip() for item in (value or []) if str(item).strip()]
        return patterns or list(default)

    def _infer_document_class(self, source: dict[str, Any], relative_repo_path: Path) -> str:
        normalized_parts = [part.strip().lower() for part in relative_repo_path.parts]
        joined = "/".join(normalized_parts)
        if "meeting notes archive" in joined or "meeting-notes" in joined or "round table" in joined or "round-up" in joined:
            return "meeting_notes"
        if any(part in {"rips", "proposals", "proposal"} for part in normalized_parts):
            return "proposal"
        if any(part in {"templates", "template"} for part in normalized_parts):
            return "template"
        if "cohorts" in normalized_parts:
            return "cohort_doc"
        if "projects" in normalized_parts or "raids" in normalized_parts:
            return "project_doc"
        if "operations" in joined or "healers (operations)" in joined or "homebase" in joined or "hunters" in joined:
            return "ops_doc"
        source_profile = str(source.get("source_profile") or "canonical").strip().lower()
        if source_profile == "archive":
            return "archive_doc"
        return "reference"

    def _normalize_source_id(self, value: str) -> str:
        normalized = self._slugify(value)
        if not _SOURCE_ID_RE.fullmatch(normalized):
            raise KnowledgeSourceError(
                "invalid_source_id",
                "source id must use lowercase letters, numbers, and dashes",
            )
        return normalized

    def _infer_source_id(self, label: Any, repo_url: Any) -> str:
        for candidate in (label, self._repo_name(repo_url), repo_url):
            slug = self._slugify(str(candidate or ""))
            if slug:
                return slug
        raise KnowledgeSourceError("invalid_source_id", "Unable to infer a source id")

    def _repo_name(self, repo_url: Any) -> str:
        text = str(repo_url or "").rstrip("/")
        name = text.rsplit("/", 1)[-1]
        if name.endswith(".git"):
            name = name[:-4]
        return name

    def _ensure_unique_repo_binding(
        self,
        repo_url: str,
        branch: str,
        *,
        exclude_source_id: str | None,
    ) -> None:
        target_repo = self._canonical_repo_ref(repo_url)
        target_branch = branch.strip()
        for path in sorted(self.registry_root.glob("*.json")) if self.registry_root.is_dir() else []:
            record = self._read_json(path)
            source_id = str(record.get("id") or path.stem)
            if exclude_source_id and source_id == exclude_source_id:
                continue
            existing_repo = self._canonical_repo_ref(str(record.get("repo_url") or ""))
            existing_branch = str(record.get("branch") or "").strip()
            if existing_repo == target_repo and existing_branch == target_branch:
                raise KnowledgeSourceError(
                    "duplicate_source",
                    f"Knowledge source already exists for repo '{repo_url}' on branch '{branch}' as '{source_id}'",
                )

    def _source_record_path(self, source_id: str) -> Path:
        return self.registry_root / f"{source_id}.json"

    def _source_dir(self, source_id: str) -> Path:
        return self.registry_root / source_id

    def _state_path(self, source_id: str) -> Path:
        return self._source_dir(source_id) / "state.json"

    def _history_dir(self, source_id: str) -> Path:
        return self._source_dir(source_id) / "sync-history"

    def _mirror_dir(self, source_id: str) -> Path:
        return self._source_dir(source_id) / "mirror"

    def _load_state(self, source_id: str) -> dict[str, Any]:
        path = self._state_path(source_id)
        if not path.is_file():
            return {
                "source_id": source_id,
                "status": "pending",
                "last_requested_at": None,
                "last_started_at": None,
                "last_completed_at": None,
                "last_synced_at": None,
                "last_synced_commit": None,
                "file_count": 0,
                "doc_count": 0,
                "docs_roots": [],
                "change_summary": {"added": 0, "changed": 0, "removed": 0},
                "error": None,
            }
        return self._read_json(path)

    def _write_history(self, source_id: str, payload: dict[str, Any]) -> None:
        history_dir = self._history_dir(source_id)
        history_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        suffix = payload.get("status") or "run"
        self._write_json(history_dir / f"{stamp}-{suffix}.json", payload)

    def _collect_hashes(self, root: Path, *, suffix: str) -> dict[str, str]:
        if not root.is_dir():
            return {}
        hashes: dict[str, str] = {}
        for path in sorted(root.rglob(f"*{suffix}")):
            rel = path.relative_to(root).as_posix()
            hashes[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
        return hashes

    def _diff_hashes(self, previous: dict[str, str], current: dict[str, str]) -> dict[str, int]:
        previous_keys = set(previous)
        current_keys = set(current)
        added = current_keys - previous_keys
        removed = previous_keys - current_keys
        changed = {key for key in previous_keys & current_keys if previous[key] != current[key]}
        return {"added": len(added), "changed": len(changed), "removed": len(removed)}

    def _replace_tree(self, target: Path, source: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        backup: Path | None = None
        if target.exists():
            backup = target.parent / f".{target.name}.old"
            if backup.exists():
                shutil.rmtree(backup)
            target.replace(backup)
        try:
            source.replace(target)
        except OSError as exc:
            if exc.errno != 18:  # EXDEV
                raise
            if source.is_dir():
                shutil.copytree(source, target)
                shutil.rmtree(source)
            else:
                shutil.copy2(source, target)
                source.unlink()
        if backup is not None and backup.exists():
            shutil.rmtree(backup)

    def _git_output(self, args: list[str], cwd: Path) -> str:
        try:
            completed = subprocess.run(
                ["git", *args],
                cwd=cwd,
                capture_output=True,
                text=True,
                check=True,
                timeout=_GIT_COMMAND_TIMEOUT_SECONDS,
            )
        except FileNotFoundError as exc:
            raise KnowledgeSourceError("git_missing", "git is required for knowledge source sync") from exc
        except subprocess.TimeoutExpired as exc:
            raise KnowledgeSourceError(
                "git_timeout",
                f"git command timed out after {_GIT_COMMAND_TIMEOUT_SECONDS}s",
            ) from exc
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").strip()
            raise KnowledgeSourceError("git_failed", stderr or "git command failed") from exc
        return (completed.stdout or "").strip()

    def _update_state(self, source_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._write_json(self._state_path(source_id), payload)
        logger.info(
            "knowledge source state source_id=%s status=%s step=%s",
            source_id,
            payload.get("status"),
            payload.get("current_step"),
        )
        return payload

    def _read_json(self, path: Path) -> dict[str, Any]:
        if not path.is_file():
            raise KnowledgeSourceError("not_found", f"Knowledge source not found: {path.stem}")
        with path.open("r", encoding="utf-8") as handle:
            loaded = json.load(handle)
        if not isinstance(loaded, dict):
            raise KnowledgeSourceError("malformed_json", f"Malformed JSON: {path}")
        return loaded

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(f"{path.suffix}.tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temp_path.replace(path)

    def _rel_to_workspace(self, path: Path) -> str:
        try:
            return str(path.relative_to(self.workspace_root))
        except ValueError:
            return str(path)

    @staticmethod
    def _slugify(value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")

    @staticmethod
    def _canonical_repo_ref(value: str) -> str:
        normalized = value.strip()
        if normalized.endswith(".git"):
            normalized = normalized[:-4]
        normalized = normalized.rstrip("/")
        return normalized.lower()

    @staticmethod
    def _prettify_name(value: str) -> str:
        return re.sub(r"[-_]+", " ", value).strip().title() or "Untitled"

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

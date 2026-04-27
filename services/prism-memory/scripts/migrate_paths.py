from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OLD_BASE = os.environ.get("PRISM_API_LEGACY_BASE", "superprism_poc").strip() or "superprism_poc"
DEFAULT_NEW_BASE = os.environ.get("PRISM_API_BUNDLED_BASE", "prism_seed").strip() or "prism_seed"
DEFAULT_OLD_BUNDLED_SPACE = (
    os.environ.get("PRISM_API_LEGACY_BUNDLED_SPACE", "raidguild").strip() or "raidguild"
)
DEFAULT_NEW_BUNDLED_SPACE = (
    os.environ.get("PRISM_API_BUNDLED_SPACE", "default").strip() or "default"
)
DEFAULT_SPACE = os.environ.get("PRISM_API_SPACE", "community").strip() or "community"

CODE_ROOT = SCRIPT_ROOT / DEFAULT_NEW_BASE / DEFAULT_NEW_BUNDLED_SPACE / "code"
if str(CODE_ROOT) not in sys.path:
    sys.path.insert(0, str(CODE_ROOT))

from community_memory.config_loader import load_config  # noqa: E402
from community_knowledge.activity import KnowledgeActivityLogger  # noqa: E402
from community_knowledge.index_builder import KnowledgeIndexBuilder  # noqa: E402
from community_knowledge.io_paths import from_config  # noqa: E402


TEXT_SUFFIXES = {
    ".json",
    ".jsonl",
    ".md",
    ".txt",
    ".yaml",
    ".yml",
    ".py",
}


@dataclass
class MigrationPlan:
    data_root: Path
    old_base: str
    new_base: str
    old_bundled_space: str
    new_bundled_space: str
    space: str

    @property
    def old_root(self) -> Path:
        return self.data_root / self.old_base / self.space

    @property
    def new_root(self) -> Path:
        return self.data_root / self.new_base / self.space

    @property
    def replacements(self) -> list[tuple[str, str]]:
        return [
            (f"{self.old_base}/{self.space}/", f"{self.new_base}/{self.space}/"),
            (
                f"{self.old_base}/{self.old_bundled_space}/",
                f"{self.new_base}/{self.new_bundled_space}/",
            ),
        ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate Prism Memory paths to canonical names")
    parser.add_argument("--data-root", default=os.environ.get("PRISM_API_DATA_ROOT", "data"))
    parser.add_argument("--old-base", default=DEFAULT_OLD_BASE)
    parser.add_argument("--new-base", default=DEFAULT_NEW_BASE)
    parser.add_argument("--old-bundled-space", default=DEFAULT_OLD_BUNDLED_SPACE)
    parser.add_argument("--new-bundled-space", default=DEFAULT_NEW_BUNDLED_SPACE)
    parser.add_argument("--space", default=DEFAULT_SPACE)
    parser.add_argument("--apply", action="store_true", help="Apply migration in place")
    return parser.parse_args()


def _iter_text_files(root: Path):
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix in TEXT_SUFFIXES:
            yield path


def _rewrite_text(value: str, replacements: list[tuple[str, str]]) -> str:
    rewritten = value
    for old, new in replacements:
        rewritten = rewritten.replace(old, new)
    return rewritten


def copy_tree(source: Path, destination: Path) -> None:
    if not source.exists():
        raise FileNotFoundError(f"Missing legacy Prism data root: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination, dirs_exist_ok=True)


def rewrite_tree(root: Path, replacements: list[tuple[str, str]], apply: bool) -> dict[str, int]:
    changed_files = 0
    changed_bytes = 0
    for path in _iter_text_files(root):
        original = path.read_text(encoding="utf-8")
        rewritten = _rewrite_text(original, replacements)
        if rewritten == original:
            continue
        changed_files += 1
        changed_bytes += len(rewritten) - len(original)
        if apply:
            path.write_text(rewritten, encoding="utf-8")
    return {"changed_files": changed_files, "changed_bytes_delta": changed_bytes}


def rebuild_indexes(plan: MigrationPlan) -> dict[str, int]:
    config_path = plan.new_root / "config" / "space.json"
    if not config_path.exists():
        raise FileNotFoundError(f"Missing migrated config: {config_path}")
    config = load_config(config_path)
    workspace_root = plan.new_root.parent.parent.resolve()
    paths = from_config(workspace_root, config)
    activity = KnowledgeActivityLogger(paths.activity_path)
    builder = KnowledgeIndexBuilder(
        workspace_root=workspace_root,
        config=config,
        paths=paths,
        activity=activity,
    )
    result = builder.rebuild()
    return {
        "docs_seen": result.docs_seen,
        "docs_indexed": result.docs_indexed,
        "errors": len(result.errors),
        "warnings": len(result.warnings),
    }


def verify(plan: MigrationPlan) -> dict[str, object]:
    config_path = plan.new_root / "config" / "space.json"
    if not config_path.exists():
        raise FileNotFoundError(f"Missing config after migration: {config_path}")

    config = json.loads(config_path.read_text(encoding="utf-8"))
    expected_prefix = f"{plan.new_base}/{plan.space}/"
    knowledge = config.get("knowledge", {})
    knowledge_paths = [
        knowledge.get("docs_root", ""),
        knowledge.get("metadata_root", ""),
        knowledge.get("index_root", ""),
        knowledge.get("triage_root", ""),
        knowledge.get("activity_path", ""),
        knowledge.get("state_path", ""),
    ]
    invalid_paths = [value for value in knowledge_paths if value and not value.startswith(expected_prefix)]

    manifest_path = plan.new_root / "knowledge" / "kb" / "indexes" / "manifest.json"
    manifest_exists = manifest_path.exists()

    return {
        "config_path": str(config_path),
        "new_root": str(plan.new_root),
        "old_root": str(plan.old_root),
        "manifest_exists": manifest_exists,
        "invalid_knowledge_paths": invalid_paths,
    }


def main() -> None:
    args = parse_args()
    plan = MigrationPlan(
        data_root=Path(args.data_root).resolve(),
        old_base=args.old_base,
        new_base=args.new_base,
        old_bundled_space=args.old_bundled_space,
        new_bundled_space=args.new_bundled_space,
        space=args.space,
    )

    summary: dict[str, object] = {
        "mode": "apply" if args.apply else "check",
        "data_root": str(plan.data_root),
        "old_root": str(plan.old_root),
        "new_root": str(plan.new_root),
        "old_root_exists": plan.old_root.exists(),
        "new_root_exists": plan.new_root.exists(),
        "replacements": [{"old": old, "new": new} for old, new in plan.replacements],
    }

    if not plan.old_root.exists():
        print(json.dumps({"ok": False, "error": "legacy_root_missing", "summary": summary}, indent=2))
        raise SystemExit(1)

    if args.apply:
        copy_tree(plan.old_root, plan.new_root)
        summary["rewrite"] = rewrite_tree(plan.new_root, plan.replacements, apply=True)
        summary["index"] = rebuild_indexes(plan)
    else:
        summary["rewrite"] = rewrite_tree(plan.old_root, plan.replacements, apply=False)

    summary["verify"] = verify(plan if args.apply else MigrationPlan(
        data_root=plan.data_root,
        old_base=plan.old_base,
        new_base=plan.old_base,
        old_bundled_space=plan.old_bundled_space,
        new_bundled_space=plan.old_bundled_space,
        space=plan.space,
    )) if not args.apply else verify(plan)

    print(json.dumps({"ok": True, "summary": summary}, indent=2))


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from community_memory.config_loader import load_config
from community_memory.utils import load_env_file

from .activity import KnowledgeActivityLogger
from .index_builder import KnowledgeIndexBuilder
from .io_paths import from_config
from .schemas import validate_metadata


def _load_space_config(base_path: Path):
    config_path = base_path / "config" / "space.json"
    if not config_path.exists():
        raise FileNotFoundError(f"Missing config file: {config_path}")
    return load_config(config_path)


def _arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Community knowledge tools")
    parser.add_argument("command", choices=["validate", "index", "promote", "promote-stub"])
    parser.add_argument("--base", default="superprism_poc")
    parser.add_argument("--space", default="raidguild")
    return parser


def _validate_only(builder: KnowledgeIndexBuilder) -> int:
    docs = sorted(builder.paths.docs_root.rglob("*.md"))
    errors: list[str] = []
    warnings: list[str] = []

    allowed_kinds = builder.config.knowledge.constraints.allowed_kinds
    if builder.config.knowledge.kinds:
        allowed_kinds = sorted(set(allowed_kinds + builder.config.knowledge.kinds))

    for doc_path in docs:
        doc_rel = builder._rel(doc_path)  # internal helper is fine for this CLI
        meta_path = builder._meta_path_for(doc_path)
        if not meta_path.exists():
            errors.append(f"{doc_rel}: missing metadata file {builder._rel(meta_path)}")
            continue

        metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        result = validate_metadata(
            metadata,
            constraints=builder.config.knowledge.constraints,
            allowed_kinds=allowed_kinds,
        )
        warnings.extend([f"{doc_rel}: {w}" for w in result.warnings])
        errors.extend([f"{doc_rel}: {e}" for e in result.errors])

    print(f"[knowledge] validate docs_seen={len(docs)} errors={len(errors)} warnings={len(warnings)}")
    for warning in warnings[:25]:
        print(f"[knowledge][warn] {warning}")
    for error in errors[:25]:
        print(f"[knowledge][error] {error}")
    if len(warnings) > 25:
        print(f"[knowledge] ... {len(warnings) - 25} additional warnings")
    if len(errors) > 25:
        print(f"[knowledge] ... {len(errors) - 25} additional errors")
    return 1 if errors else 0


def _reviewed_name(path: Path) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{path.stem}-{ts}{path.suffix}"


def _promote_inbox(builder: KnowledgeIndexBuilder) -> int:
    inbox = builder.paths.triage_inbox
    reviewed = builder.paths.triage_reviewed
    inbox.mkdir(parents=True, exist_ok=True)
    reviewed.mkdir(parents=True, exist_ok=True)

    allowed_kinds = builder.config.knowledge.constraints.allowed_kinds
    if builder.config.knowledge.kinds:
        allowed_kinds = sorted(set(allowed_kinds + builder.config.knowledge.kinds))

    docs = sorted(path for path in inbox.glob("*.md") if path.is_file())
    promoted = 0
    errors: list[str] = []
    warnings: list[str] = []

    for doc_path in docs:
        meta_path = doc_path.with_suffix(".meta.json")
        if not meta_path.exists():
            errors.append(f"{doc_path.name}: missing metadata sidecar {meta_path.name}")
            continue

        try:
            metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"{doc_path.name}: invalid metadata JSON ({exc})")
            continue

        result = validate_metadata(
            metadata,
            constraints=builder.config.knowledge.constraints,
            allowed_kinds=allowed_kinds,
        )
        warnings.extend([f"{doc_path.name}: {warning}" for warning in result.warnings])
        if not result.ok:
            errors.extend([f"{doc_path.name}: {error}" for error in result.errors])
            continue

        kind = str(metadata.get("kind", "")).strip()
        slug = str(metadata.get("slug", "")).strip()
        if not kind or not slug:
            errors.append(f"{doc_path.name}: metadata must include non-empty kind and slug")
            continue

        canonical_doc = builder.paths.docs_root / kind / f"{slug}.md"
        canonical_meta = builder.paths.metadata_root / kind / f"{slug}.meta.json"
        canonical_doc.parent.mkdir(parents=True, exist_ok=True)
        canonical_meta.parent.mkdir(parents=True, exist_ok=True)

        shutil.copy2(doc_path, canonical_doc)
        canonical_meta.write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        reviewed_doc = reviewed / _reviewed_name(doc_path)
        reviewed_meta = reviewed / _reviewed_name(meta_path)
        shutil.move(str(doc_path), reviewed_doc)
        shutil.move(str(meta_path), reviewed_meta)

        promoted += 1

    builder.activity.log(
        "triage.promoted",
        outputs=[builder._rel(builder.paths.docs_root), builder._rel(builder.paths.metadata_root)],
        meta={
            "docs_seen": len(docs),
            "promoted": promoted,
            "errors": len(errors),
            "warnings": len(warnings),
        },
    )

    print(
        "[knowledge] promote "
        f"docs_seen={len(docs)} promoted={promoted} "
        f"errors={len(errors)} warnings={len(warnings)}"
    )
    for warning in warnings[:25]:
        print(f"[knowledge][warn] {warning}")
    for error in errors[:25]:
        print(f"[knowledge][error] {error}")
    if len(warnings) > 25:
        print(f"[knowledge] ... {len(warnings) - 25} additional warnings")
    if len(errors) > 25:
        print(f"[knowledge] ... {len(errors) - 25} additional errors")
    return 1 if errors else 0


def main() -> None:
    load_env_file(Path(".env"))

    args = _arg_parser().parse_args()
    base_path = Path(args.base) / args.space
    workspace_root = base_path.parent.parent.resolve()
    config = _load_space_config(base_path)
    paths = from_config(workspace_root, config)
    activity = KnowledgeActivityLogger(paths.activity_path)
    builder = KnowledgeIndexBuilder(
        workspace_root=workspace_root,
        config=config,
        paths=paths,
        activity=activity,
    )

    if args.command == "validate":
        raise SystemExit(_validate_only(builder))

    if args.command == "index":
        result = builder.rebuild()
        print(
            "[knowledge] index "
            f"docs_seen={result.docs_seen} docs_indexed={result.docs_indexed} "
            f"errors={len(result.errors)} warnings={len(result.warnings)}"
        )
        for warning in result.warnings[:25]:
            print(f"[knowledge][warn] {warning}")
        for error in result.errors[:25]:
            print(f"[knowledge][error] {error}")
        if result.errors:
            raise SystemExit(1)
        return

    if args.command == "promote":
        raise SystemExit(_promote_inbox(builder))

    if args.command == "promote-stub":
        paths.triage_inbox.mkdir(parents=True, exist_ok=True)
        print(
            "[knowledge] promote-stub ready: write markdown candidates to "
            f"{paths.triage_inbox}"
        )
        return


if __name__ == "__main__":
    main()

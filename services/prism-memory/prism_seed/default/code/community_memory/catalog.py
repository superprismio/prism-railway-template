"""Opt-in, file-backed shadow catalog. Never invokes collectors or model providers."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID


VERSION = 2
MEETING_KINDS = {"meeting_summary", "meeting_transcript"}
DISCORD_URL = re.compile(r"https://(?:www\.)?discord(?:app)?\.com/channels/(\d+)/(\d+)/(\d+)")


def encoded(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def identity(*parts: Any) -> str:
    return hashlib.sha256(encoded(parts)).hexdigest()


def timestamp(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("timestamp must be a string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include timezone")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize(payload: Any, relative_path: str) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("inbox payload must be an object")
    for key in ("source", "type", "content"):
        if not isinstance(payload.get(key), str) or not payload[key].strip():
            raise ValueError(f"missing or invalid {key}")
    metadata = payload.get("metadata") or {}
    if not isinstance(metadata, dict):
        raise ValueError("metadata must be an object")
    source, kind = payload["source"], payload["type"]
    namespace = str(metadata.get("source_system") or source)
    session = metadata.get("session_id") or metadata.get("sessionId")
    method = "explicit_session_id" if session else None
    if not session and kind in MEETING_KINDS and namespace in {"discord-voice", "browser-capture"}:
        session = metadata.get("source_id")
        method = "producer_session_id" if session else None
    if not session and kind in MEETING_KINDS and source == "recording-transcript-workflow" and namespace == "discord-native":
        session = metadata.get("source_id")
        method = "workflow_recording_id" if session else None
    if source == "discord-voice" and kind in MEETING_KINDS:
        url = urlsplit(str(payload.get("url") or ""))
        match = re.fullmatch(r"/recordings/([0-9a-fA-F-]{36})", url.path)
        if match and url.scheme == "https" and url.hostname and not url.query and not url.fragment:
            recording_id = str(UUID(match[1]))
            if session and str(session).lower() != recording_id:
                raise ValueError("session metadata conflicts with recording URL")
            if not session:
                session, method = recording_id, "recording_url"
    source_id = payload.get("source_record_id") or metadata.get("source_id")
    meeting_id = None
    if session and kind in MEETING_KINDS:
        meeting_namespace = "discord-voice" if namespace == "discord-native" and source == "recording-transcript-workflow" else namespace
        meeting_id = identity("meeting", meeting_namespace, str(session))
        source_id = str(session)
    elif source in {"discord", "discord-native"}:
        match = DISCORD_URL.fullmatch(str(payload.get("url") or ""))
        if match:
            source_id = ":".join(match.groups())
    quality = "source" if source_id else "legacy_path"
    # Unknown identities are intentionally not merged by content similarity.
    record_id = identity("record", source, namespace, kind, str(source_id)) if source_id else identity("legacy", relative_path)
    participants = payload.get("participants", metadata.get("participants", []))
    if not isinstance(participants, list):
        participants = [participants] if participants else []
    record = {
        "schema_version": VERSION, "record_id": record_id,
        "source": source, "source_namespace": namespace,
        "source_record_id": str(source_id) if source_id else None,
        "identity_quality": quality, "kind": kind, "meeting_id": meeting_id,
        "meeting_identity_method": method,
        "occurred_at": timestamp(payload.get("ts")),
        "content_hash": hashlib.sha256(payload["content"].encode()).hexdigest(),
        "content": payload["content"],
        "title": payload.get("title"), "summary": payload.get("summary"),
        "participants": participants, "metadata": metadata,
        "source_url": payload.get("url"), "author": payload.get("author"),
        "bucket": payload.get("bucket_hint") or payload.get("bucket"),
    }
    # Locally generated artifact URLs differ across retries, unlike source URLs.
    if str(record["source_url"] or "").startswith("/artifacts/"):
        record["source_url"] = None
    record["revision"] = identity("revision", record)
    record["source_refs"] = [relative_path]
    return record


def input_hashes(inbox: Path) -> dict[str, str]:
    if not inbox.is_dir():
        raise ValueError("processed inbox unavailable")
    hashes = {}
    for path in sorted(inbox.glob("*.json")):
        if path.is_symlink():
            raise ValueError("symlink inputs are not supported")
        hashes[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes


def build_catalog(root: Path, output: Path) -> dict:
    """Serialize local rebuilds; readers continue using the published generation."""
    root, output = root.resolve(), output.resolve()
    if output == root or root.is_relative_to(output) or output.is_relative_to(root / "inbox"):
        raise ValueError("output must be a separate derived directory")
    if not (root / "inbox/memory/processed").is_dir():
        raise ValueError("processed inbox directory does not exist")
    output.mkdir(parents=True, exist_ok=True)
    with (output / ".build.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _build_catalog(root, output)


def _build_catalog(root: Path, output: Path) -> dict:
    root, output = root.resolve(), output.resolve()
    inbox = root / "inbox/memory/processed"
    if not inbox.is_dir():
        raise ValueError("processed inbox directory does not exist")
    if output == root or root.is_relative_to(output) or output.is_relative_to(inbox):
        raise ValueError("output must be a separate derived directory")
    records: dict[tuple[str, str], dict] = {}
    errors = []
    files = sorted(inbox.glob("*.json"))
    captured_hashes = {}
    skipped = sorted(str(p.relative_to(root)) for p in inbox.iterdir() if p.suffix != ".json")
    for path in files:
        ref = str(path.relative_to(root))
        try:
            if path.is_symlink():
                raise ValueError("symlink inputs are not supported")
            content = path.read_bytes()
            captured_hashes[path.name] = hashlib.sha256(content).hexdigest()
            record = normalize(json.loads(content), ref)
            key = record["record_id"], record["revision"]
            if key in records:
                records[key]["source_refs"].append(ref)
            else:
                records[key] = record
        except (ValueError, OSError) as exc:
            errors.append({"path": ref, "error": str(exc)})
    report = {"schema_version": VERSION, "scanned": len(files), "errors": errors,
              "unsupported_files": skipped, "published": False}
    # No partial publication: preserve the previous good generation on errors.
    if errors:
        return report
    meetings: dict[str, dict] = {}
    revisions: dict[str, list[str]] = {}
    edges = []
    for (record_id, revision), record in sorted(records.items()):
        revisions.setdefault(record_id, []).append(revision)
        meeting_id = record["meeting_id"]
        if not meeting_id:
            continue
        meeting = meetings.setdefault(meeting_id, {
            "schema_version": VERSION, "meeting_id": meeting_id, "artifacts": [],
            "participants": [], "kinds": [],
        })
        meeting["artifacts"].append({"record_id": record_id, "revision": revision, "kind": record["kind"]})
        for person in record["participants"]:
            if person not in meeting["participants"]:
                meeting["participants"].append(person)
        if record["kind"] not in meeting["kinds"]:
            meeting["kinds"].append(record["kind"])
        edges.append({"edge_id": identity(record_id, revision, "artifact_of", meeting_id),
                      "subject": record_id, "predicate": "artifact_of", "object": meeting_id,
                      "evidence_revision": revision, "method": record["meeting_identity_method"]})
    for meeting in meetings.values():
        meeting["completeness"] = "complete" if set(meeting["kinds"]) == MEETING_KINDS else "partial"
        # Preserve all revisions; choosing the authoritative summary is deferred.
        meeting["revision_conflicts"] = [a["record_id"] for a in meeting["artifacts"]
                                         if len(revisions[a["record_id"]]) > 1]
        meeting["revision_conflicts"] = sorted(set(meeting["revision_conflicts"]))
        meeting["alternative_artifact_kinds"] = sorted(
            kind for kind in meeting["kinds"]
            if sum(a["kind"] == kind for a in meeting["artifacts"]) > 1
        )
    report.update({"records": len(revisions), "revisions": len(records), "meetings": len(meetings),
                   "duplicate_files": len(files) - len(records),
                   "legacy_records": sum(r["identity_quality"] == "legacy_path" for r in records.values()),
                   "conflicting_records": sum(len(v) > 1 for v in revisions.values())})
    report["unlinked_meeting_records"] = [
        {"record_id": r["record_id"], "source_refs": r["source_refs"],
         "reason": "no_verified_session_identity"}
        for r in records.values() if r["kind"] in MEETING_KINDS and not r["meeting_id"]
    ]
    report["recovered_from_recording_url"] = sum(r["meeting_identity_method"] == "recording_url" for r in records.values())
    report["meetings_with_alternatives"] = sum(bool(m["alternative_artifact_kinds"]) for m in meetings.values())
    manifest = {"report": report, "records": list(records.values()), "meetings": list(meetings.values()), "edges": edges}
    generation = identity(VERSION, manifest)
    output.mkdir(parents=True, exist_ok=True)
    generations = output / "generations"
    generations.mkdir(exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".build-", dir=generations))
    try:
        for name, items in (("records", records.values()), ("meetings", meetings.values()), ("relationships", edges)):
            folder = staging / name
            folder.mkdir()
            for item in items:
                key = (item["record_id"] + "-" + item["revision"]) if name == "records" else item.get("meeting_id", item.get("edge_id"))
                (folder / f"{key}.json").write_bytes(encoded(item))
        (staging / "manifest.json").write_bytes(encoded({"generation": generation, **report}))
        destination = generations / generation
        if destination.is_symlink() or (destination.exists() and not destination.is_dir()):
            raise ValueError("catalog_generation_collision: destination must be a real directory")
        if not destination.exists():
            try:
                staging.rename(destination)
            except OSError:
                if destination.is_symlink() or not destination.is_dir():
                    raise
        # A live collector may move/write files while we scan. Never publish a
        # generation known to have mixed inputs; the refresh worker retries.
        try:
            current_hashes = input_hashes(inbox)
        except (OSError, ValueError):
            current_hashes = None
        if current_hashes != captured_hashes:
            return {**report, "errors": [{"path": "inbox/memory/processed", "error": "source_changed_during_build"}]}
        fd, pointer = tempfile.mkstemp(prefix=".current-", dir=output)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(encoded({"schema_version": VERSION, "generation": generation}))
            os.replace(pointer, output / "current.json")
        finally:
            Path(pointer).unlink(missing_ok=True)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    retention_errors = []
    try:
        prune_generations(output, generation)
    except OSError as exc:
        # The pointer is already published. Cleanup failure must not misreport
        # that successful publication or invalidate its refresh fingerprint.
        retention_errors.append({"error": str(exc)})
    return {**report, "published": True, "generation": generation,
            "retention_errors": retention_errors}


def prune_generations(output: Path, current: str) -> None:
    """Caller holds the build lock; readers hold a shared retention lock while loading.

    Only derived generation directories and abandoned builder staging directories
    are eligible. Never follow symlinks or touch unknown files.
    """
    with (output / '.retention.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        folders = [p for p in (output / 'generations').iterdir()
                   if not p.is_symlink() and p.is_dir()]
        generations = sorted((p for p in folders if re.fullmatch(r'[0-9a-f]{64}', p.name)),
                             key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)
        keep = {current}
        keep.update(p.name for p in [p for p in generations if p.name != current][:2])
        for folder in folders:
            if (folder in generations and folder.name not in keep) or folder.name.startswith('.build-'):
                shutil.rmtree(folder)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="Space data root (read only)")
    parser.add_argument("--output", type=Path, required=True, help="Dedicated shadow catalog directory")
    args = parser.parse_args()
    report = build_catalog(args.root, args.output)
    print(json.dumps(report, indent=2))
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

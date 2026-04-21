from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DEFAULT_LOCK_FILE = Path("superprism_poc/raidguild/state/agent_locks.json")

MEMORY_ALLOWED_PREFIXES = [
    "superprism_poc/raidguild/activity/",
    "superprism_poc/raidguild/buckets/",
    "superprism_poc/raidguild/memory/",
    "superprism_poc/raidguild/products/",
    "superprism_poc/raidguild/state/",
    "superprism_poc/raidguild/code/community_memory/",
    "superprism_poc/raidguild/config/",
    "README.md",
    "docs/assistants/memory-manager/",
]

KNOWLEDGE_ALLOWED_PREFIXES = [
    "superprism_poc/raidguild/knowledge/",
    "superprism_poc/raidguild/code/community_knowledge/",
    "superprism_poc/raidguild/config/",
    "README.md",
    "docs/knowledge-source-of-truth.md",
    "docs/assistants/knowledge-manager/",
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def _from_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"locks": {}}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def _agent_prefixes(agent: str) -> list[str]:
    if agent == "memory":
        return MEMORY_ALLOWED_PREFIXES
    if agent == "knowledge":
        return KNOWLEDGE_ALLOWED_PREFIXES
    raise ValueError(f"Unknown agent '{agent}'")


def _is_allowed(path: str, prefixes: list[str]) -> bool:
    normalized = path.strip()
    return any(
        normalized == prefix.rstrip("/") or normalized.startswith(prefix)
        for prefix in prefixes
    )


def cmd_acquire(args: argparse.Namespace) -> int:
    state = _load_state(args.file)
    locks = state.setdefault("locks", {})
    lock = locks.get(args.resource)
    now = _now()

    if lock:
        expires_at = _from_iso(lock.get("expires_at"))
        if expires_at > now and lock.get("holder") != args.holder:
            print(
                "[coord] lock busy "
                f"resource={args.resource} holder={lock.get('holder')} expires_at={lock.get('expires_at')}"
            )
            return 2

    expires_at = now + timedelta(minutes=args.ttl_minutes)
    locks[args.resource] = {
        "holder": args.holder,
        "acquired_at": _to_iso(now),
        "expires_at": _to_iso(expires_at),
        "note": args.note or "",
    }
    _write_state(args.file, state)
    print(
        "[coord] lock acquired "
        f"resource={args.resource} holder={args.holder} expires_at={_to_iso(expires_at)}"
    )
    return 0


def cmd_release(args: argparse.Namespace) -> int:
    state = _load_state(args.file)
    locks = state.setdefault("locks", {})
    lock = locks.get(args.resource)
    if not lock:
        print(f"[coord] lock already clear resource={args.resource}")
        return 0
    if lock.get("holder") != args.holder and not args.force:
        print(
            "[coord] cannot release lock held by another holder "
            f"resource={args.resource} holder={lock.get('holder')}"
        )
        return 2
    del locks[args.resource]
    _write_state(args.file, state)
    print(f"[coord] lock released resource={args.resource} holder={args.holder}")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    state = _load_state(args.file)
    locks = state.get("locks", {})
    print(json.dumps({"locks": locks}, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


def cmd_check_paths(args: argparse.Namespace) -> int:
    prefixes = _agent_prefixes(args.agent)
    violations = [path for path in args.files if not _is_allowed(path, prefixes)]
    if violations:
        print(f"[coord] path ownership violations for agent={args.agent}:")
        for path in violations:
            print(f"- {path}")
        return 3
    print(
        f"[coord] path ownership check passed for agent={args.agent} "
        f"files={len(args.files)}"
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent coordination helpers")
    parser.add_argument(
        "--file",
        type=Path,
        default=DEFAULT_LOCK_FILE,
        help="Path to shared lock state file",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    acquire = sub.add_parser("acquire", help="Acquire a named lock")
    acquire.add_argument("--resource", required=True)
    acquire.add_argument("--holder", required=True)
    acquire.add_argument("--ttl-minutes", type=int, default=90)
    acquire.add_argument("--note", default="")
    acquire.set_defaults(func=cmd_acquire)

    release = sub.add_parser("release", help="Release a named lock")
    release.add_argument("--resource", required=True)
    release.add_argument("--holder", required=True)
    release.add_argument("--force", action="store_true")
    release.set_defaults(func=cmd_release)

    status = sub.add_parser("status", help="Show lock state")
    status.set_defaults(func=cmd_status)

    check = sub.add_parser("check-paths", help="Validate path ownership")
    check.add_argument("--agent", choices=["memory", "knowledge"], required=True)
    check.add_argument("--files", nargs="+", required=True)
    check.set_defaults(func=cmd_check_paths)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()

---
name: dao-proposal-watcher
description: Use this skill when Codex is asked to create, run, or maintain an instance-local watcher for DAOhaus or Moloch v3 proposals, especially scheduled tasks that detect new proposals and return a notification brief for Prism task delivery.
---

Use this skill to build a durable proposal watcher in the instance workspace. The watcher should poll a DAOhaus/Moloch v3 proposal subgraph, compare results against a local checkpoint, write proposal reports to local markdown, and return a concise notification for any new proposals.

Do not store executable code in a Prism task row. Create or update a script in the workspace, then create a scheduled Prism task whose prompt runs that script.

## Default Shape

Create these files in the persistent Codex workspace unless the user asks for another path:

- `scripts/dao_proposal_watcher.py`
- `.prism/dao-proposals/checkpoint.json`
- `.prism/dao-proposals/proposals/*.md`

Use these environment variables:

- `DAOHAUS_GRAPHQL_ENDPOINT`: required GraphQL endpoint for the DAOhaus/Moloch v3 subgraph.
- `DAOHAUS_DAO_ID`: required DAO address/id, lowercased before querying.
- `DAOHAUS_CHAIN_ID`: optional, default `100`.
- `DAOHAUS_PROPOSAL_LIMIT`: optional, default `15`.
- `DAOHAUS_PUBLIC_BASE_URL`: optional, default `https://admin.daohaus.club`.

If the user supplies a DAOhaus decode endpoint or API key, keep it optional. The first watcher can work from subgraph data only.

## Watcher Behavior

1. Query latest proposals ordered by `createdAt desc`.
2. Compute a status for each proposal using the Moloch v3 fields.
3. Load `checkpoint.json`.
4. Treat a proposal as new if its proposal id was not previously seen.
5. Write one markdown file per new proposal.
6. Update the checkpoint with seen proposal ids and the latest run time.
7. Print a human-readable brief. Scheduled task delivery should send that returned brief to Discord or another adapter.

If no new proposals are found, print `No new DAO proposals found.` and include the checked DAO id.

## Script Template

When creating `scripts/dao_proposal_watcher.py`, adapt this template rather than rewriting the whole watcher from scratch:

```python
#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import request


PROPOSAL_QUERY = """
query listProposals($daoid: String!, $first: Int!, $skip: Int!) {
  proposals(first: $first, skip: $skip, orderBy: createdAt, orderDirection: desc, where: { dao: $daoid }) {
    id
    createdAt
    createdBy
    proposedBy
    txHash
    proposalId
    title
    description
    proposalType
    sponsored
    cancelled
    actionFailed
    passed
    processed
    votingStarts
    votingEnds
    graceEnds
    expiration
    votingPeriod
    gracePeriod
    yesBalance
    noBalance
    yesVotes
    noVotes
    maxTotalSharesAndLootAtYesVote
    dao { id totalShares quorumPercent minRetentionPercent }
  }
}
"""


STATUS = {
    "unsponsored": "Unsponsored",
    "voting": "Voting",
    "grace": "Grace",
    "expired": "Expired",
    "cancelled": "Cancelled",
    "needs_processing": "Ready for Execution",
    "failed": "Failed",
    "passed": "Passed",
    "action_failed": "Execution Failed",
    "unknown": "Unknown",
}


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or not str(value).strip():
        raise SystemExit(f"Missing required env var: {name}")
    return str(value).strip()


def post_graphql(endpoint: str, query: str, variables: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps({"query": query, "variables": variables, "operationName": "listProposals"}).encode("utf-8")
    req = request.Request(endpoint, data=body, headers={"content-type": "application/json"}, method="POST")
    with request.urlopen(req, timeout=45) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("errors"):
        raise RuntimeError(json.dumps(payload["errors"], indent=2))
    return payload


def num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def now_seconds() -> float:
    return time.time()


def percentage(value: float, total: float) -> float:
    return 0.0 if total <= 0 else (value / total) * 100


def passed_quorum(proposal: dict[str, Any]) -> bool:
    dao = proposal.get("dao") or {}
    return percentage(num(proposal.get("yesBalance")), num(dao.get("totalShares"))) >= num(dao.get("quorumPercent"))


def proposal_status(proposal: dict[str, Any]) -> str:
    now = now_seconds()
    sponsored = bool(proposal.get("sponsored"))
    cancelled = bool(proposal.get("cancelled"))
    processed = bool(proposal.get("processed"))

    if not sponsored and not cancelled and not is_expired(proposal, now):
        return STATUS["unsponsored"]
    if cancelled:
        return STATUS["cancelled"]
    if bool(proposal.get("actionFailed")):
        return STATUS["action_failed"]
    if bool(proposal.get("passed")):
        return STATUS["passed"]
    if num(proposal.get("votingStarts")) < now < num(proposal.get("votingEnds")):
        return STATUS["voting"]
    if num(proposal.get("votingEnds")) < now < num(proposal.get("graceEnds")):
        return STATUS["grace"]
    if (
        not processed
        and sponsored
        and not cancelled
        and now > num(proposal.get("graceEnds"))
        and num(proposal.get("yesBalance")) > num(proposal.get("noBalance"))
    ):
        return STATUS["needs_processing"]
    if sponsored and not cancelled and now > num(proposal.get("graceEnds")):
        if not passed_quorum(proposal) or num(proposal.get("yesBalance")) <= num(proposal.get("noBalance")):
            return STATUS["failed"]
    if is_expired(proposal, now):
        return STATUS["expired"]
    return STATUS["unknown"]


def is_expired(proposal: dict[str, Any], now: float) -> bool:
    expiration = num(proposal.get("expiration"))
    return (
        expiration > 0
        and not bool(proposal.get("cancelled"))
        and expiration < num(proposal.get("votingPeriod")) + num(proposal.get("gracePeriod")) + now
    )


def safe_slug(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-").lower() or "proposal"


def daohaus_link(base_url: str, chain_id: str, dao_id: str, proposal_id: str) -> str:
    return f"{base_url.rstrip('/')}/#/molochV3/0x{int(chain_id):x}/{dao_id}/proposal/{proposal_id}"


def load_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_proposal_markdown(path: Path, proposal: dict[str, Any], status: str, link: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    created = datetime.fromtimestamp(num(proposal.get("createdAt")), tz=timezone.utc).isoformat()
    title = str(proposal.get("title") or f"Proposal {proposal.get('proposalId')}")
    description = str(proposal.get("description") or "").strip()
    content = [
        f"# {title}",
        "",
        f"- Proposal ID: `{proposal.get('proposalId')}`",
        f"- Status: {status}",
        f"- Created: {created}",
        f"- Proposed by: `{proposal.get('proposedBy') or proposal.get('createdBy') or 'unknown'}`",
        f"- Link: {link}",
        "",
        "## Description",
        "",
        description or "(none)",
        "",
    ]
    path.write_text("\n".join(content), encoding="utf-8")


def main() -> int:
    endpoint = env("DAOHAUS_GRAPHQL_ENDPOINT")
    dao_id = env("DAOHAUS_DAO_ID").lower()
    chain_id = os.environ.get("DAOHAUS_CHAIN_ID", "100").strip() or "100"
    limit = int(os.environ.get("DAOHAUS_PROPOSAL_LIMIT", "15"))
    public_base = os.environ.get("DAOHAUS_PUBLIC_BASE_URL", "https://admin.daohaus.club")
    state_root = Path(os.environ.get("DAO_PROPOSAL_STATE_DIR", ".prism/dao-proposals"))
    checkpoint_path = state_root / "checkpoint.json"
    proposals_dir = state_root / "proposals"

    payload = post_graphql(endpoint, PROPOSAL_QUERY, {"daoid": dao_id, "first": limit, "skip": 0})
    proposals = list(((payload.get("data") or {}).get("proposals")) or [])
    checkpoint = load_json(checkpoint_path, {"seen_ids": []})
    seen = {str(item) for item in checkpoint.get("seen_ids", [])}

    new_items: list[dict[str, Any]] = []
    for proposal in proposals:
        key = str(proposal.get("id") or proposal.get("proposalId"))
        if key and key not in seen:
            new_items.append(proposal)

    for proposal in new_items:
        proposal_id = str(proposal.get("proposalId") or proposal.get("id"))
        status = proposal_status(proposal)
        link = daohaus_link(public_base, chain_id, dao_id, proposal_id)
        title = str(proposal.get("title") or f"Proposal {proposal_id}")
        filename = f"{proposal_id}-{safe_slug(title)[:80]}.md"
        write_proposal_markdown(proposals_dir / filename, proposal, status, link)

    write_json(
        checkpoint_path,
        {
            "dao_id": dao_id,
            "chain_id": chain_id,
            "checked_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "seen_ids": sorted({*(str(item) for item in checkpoint.get("seen_ids", [])), *(str(p.get("id") or p.get("proposalId")) for p in proposals)}),
        },
    )

    if not new_items:
        print(f"No new DAO proposals found for {dao_id}. Checked {len(proposals)} latest proposals.")
        return 0

    print(f"New DAO proposals for {dao_id}: {len(new_items)}")
    for proposal in new_items:
        proposal_id = str(proposal.get("proposalId") or proposal.get("id"))
        status = proposal_status(proposal)
        link = daohaus_link(public_base, chain_id, dao_id, proposal_id)
        title = str(proposal.get("title") or f"Proposal {proposal_id}")
        description = str(proposal.get("description") or "").strip().replace("\n", " ")
        if len(description) > 240:
            description = description[:237] + "..."
        print(f"- {title} ({status})")
        print(f"  {link}")
        if description:
            print(f"  {description}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

## Scheduled Task Prompt

After the script exists and has been run once manually, create a disabled `codex-prompt` task with a prompt like:

```text
Run `python3 scripts/dao_proposal_watcher.py` from the persistent Codex workspace. Return the script output exactly enough for notification delivery. Do not ask follow-up questions. If the script reports new DAO proposals, include the proposal titles, statuses, links, and short descriptions.
```

If the user wants Discord delivery, resolve the channel at task creation time and store it in `outputConfig.outputDestinations`. Do not hard-code Discord posting inside the script unless the user explicitly asks to bypass Prism task output delivery.


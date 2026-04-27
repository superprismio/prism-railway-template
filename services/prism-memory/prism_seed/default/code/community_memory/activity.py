from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .utils import append_jsonl, to_iso


class ActivityLogger:
    def __init__(self, path: Path) -> None:
        self.path = path

    def log(
        self,
        event_type: str,
        *,
        collector_key: Optional[str] = None,
        bucket: Optional[str] = None,
        run_key: Optional[str] = None,
        inputs: Optional[List[str]] = None,
        outputs: Optional[List[str]] = None,
        meta: Optional[Dict[str, Any]] = None,
        timestamp: Optional[datetime] = None,
    ) -> None:
        ts = timestamp or datetime.now(timezone.utc)
        record = {
            "ts": to_iso(ts),
            "type": event_type,
            "collector_key": collector_key,
            "bucket": bucket,
            "run_key": run_key,
            "inputs": inputs or [],
            "outputs": outputs or [],
            "meta": meta or {},
        }
        append_jsonl(self.path, record)

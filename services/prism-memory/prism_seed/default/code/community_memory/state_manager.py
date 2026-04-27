from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from .utils import read_json, write_json


class StateManager:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._state: Dict[str, Any] = read_json(path, default={})

    def get_collector_state(self, collector_key: str) -> Dict[str, Any]:
        return self._state.setdefault(collector_key, {})

    def update_collector_state(self, collector_key: str, data: Dict[str, Any]) -> None:
        self._state[collector_key] = data
        self._persist()

    def set_value(self, key: str, value: Any) -> None:
        self._state[key] = value
        self._persist()

    def get_value(self, key: str, default: Any = None) -> Any:
        return self._state.get(key, default)

    def _persist(self) -> None:
        write_json(self.path, self._state)

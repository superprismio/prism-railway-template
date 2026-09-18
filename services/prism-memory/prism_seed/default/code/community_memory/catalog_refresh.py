"""Incremental change detection and full shadow generation rebuilds; no collector writes."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .catalog import VERSION, build_catalog, encoded, identity, input_hashes


def _read(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(path: Path, value: dict):
    fd, temp = tempfile.mkstemp(prefix='.refresh-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(encoded(value))
        os.replace(temp, path)
    finally:
        Path(temp).unlink(missing_ok=True)


def refresh(root: Path, output: Path) -> dict:
    root, output = root.resolve(), output.resolve()
    if output == root or root.is_relative_to(output) or output.is_relative_to(root / 'inbox'):
        raise ValueError('output must be a separate derived directory')
    output.mkdir(parents=True, exist_ok=True)
    with (output / '.refresh.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'status': 'busy'}
        previous = _read(output / 'refresh-status.json')
        now = datetime.now(timezone.utc).isoformat()
        state = {**previous, 'checked_at': now, 'status': 'error'}
        try:
            hashes = input_hashes(root / 'inbox/memory/processed')
            fingerprint = identity(VERSION, str(root), hashes)
            current = _read(output / 'current.json').get('generation')
            if (fingerprint == previous.get('fingerprint') and current == previous.get('generation')
                    and isinstance(current, str) and (output / 'generations' / current / 'manifest.json').is_file()):
                state.update(status='unchanged', errors=[])
            else:
                report = build_catalog(root, output)
                if not report['published']:
                    state.update(errors=report['errors'], scanned=report['scanned'])
                else:
                    state.update(status='updated', fingerprint=fingerprint, generation=report['generation'],
                                 published_at=now, scanned=report['scanned'], records=report['records'],
                                 meetings=report['meetings'], errors=[])
        except (OSError, ValueError) as exc:
            state['errors'] = [{'error': str(exc)}]
        _write(output / 'refresh-status.json', state)
        return state


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    state = refresh(args.root, args.output)
    print(json.dumps(state, indent=2))
    return 1 if state['status'] == 'error' else 0


if __name__ == '__main__':
    raise SystemExit(main())

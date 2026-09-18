"""Optional revision-bound classifications; never part of retrieval authority."""
import fcntl
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .catalog import identity, normalize
from .catalog_refresh import _write
from .relationship_pilot import candidates, request_for, materialize
from .retrieval import CatalogReader, RetrievalError

VERSION = 'jev-classification-v1'
MODEL = 'jev-latest'
MAX_CHARS = 16000


class JevAnnotations:
    def __init__(self, catalog: Path, source: Path):
        self.reader = CatalogReader(catalog)
        self.source = source.resolve()
        self.root = source / 'annotations' / 'jev'

    def snapshot(self):
        generation, records = self.reader.snapshot()
        # Ops callers already have broad access. Honor a configured deny policy,
        # but do not require the optional scoped-reader deployment for this worker.
        if (self.source / 'retrieval/visibility.json').exists():
            guarded = CatalogReader(self.reader.root, source_root=self.source)
            return generation, guarded.current_records(records)
        current = []
        for record in records:
            for ref in record.get('source_refs', []):
                path = self.source / ref
                if path.is_symlink() or not path.resolve().is_relative_to(self.source):
                    continue
                try:
                    live = normalize(json.loads(path.read_text()), ref)
                except (OSError, ValueError, TypeError):
                    continue
                if (live['record_id'], live['revision']) == (record['record_id'], record['revision']):
                    current.append(record)
                    break
        return generation, current

    def batch(self, generation, record):
        if record['kind'] != 'meeting_summary' or not record.get('meeting_id') or len(record['content']) > MAX_CHARS:
            return None
        selected = candidates(record, limit=6)
        if not selected:
            return None
        # Classification only: the pilot's ownership and graph outputs are excluded.
        for c in selected:
            c['owner_candidate'] = None
        batch = {'generation': generation, 'record_id': record['record_id'],
                 'revision': record['revision'], 'summary': record['content'], 'candidates': selected}
        request = {**request_for(batch), 'model': MODEL}
        batch['annotation_id'] = identity(VERSION, record['record_id'], record['revision'], request)
        batch['request'] = request
        return batch

    def pending(self, limit=2):
        if not 1 <= limit <= 2:
            raise ValueError('limit must be 1 or 2')
        generation, records = self.snapshot()
        counts = Counter(r['record_id'] for r in records)
        batches = []
        skipped = Counter()
        for record in sorted(records, key=lambda r: (r['occurred_at'], r['record_id']), reverse=True):
            if record['kind'] != 'meeting_summary':
                continue
            if counts[record['record_id']] != 1:
                skipped['conflicting_revisions'] += 1
                continue
            batch = self.batch(generation, record)
            if batch is None:
                skipped['ineligible_or_no_candidates'] += 1
            elif (self.root / (batch['annotation_id'] + '.json')).is_file():
                skipped['cached'] += 1
            else:
                batches.append({k: batch[k] for k in ('generation', 'record_id', 'revision', 'annotation_id', 'request')})
        return {'version': VERSION, 'pending': len(batches), 'batches': batches[:limit], 'skipped': dict(skipped)}

    def commit(self, record_id, revision, annotation_id, response):
        self.root.mkdir(parents=True, exist_ok=True)
        with (self.root / '.write.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            generation, records = self.snapshot()
            matches = [r for r in records if r['record_id'] == record_id]
            if len(matches) != 1 or matches[0]['revision'] != revision:
                raise RetrievalError('Source revision changed or is ambiguous; discard result', 409)
            batch = self.batch(generation, matches[0])
            if batch is None or batch['annotation_id'] != annotation_id:
                raise RetrievalError('Annotation policy or evidence changed; discard result', 409)
            path = self.root / (annotation_id + '.json')
            if path.exists():
                return {'status': 'cached', 'annotation_id': annotation_id}
            try:
                if not isinstance(response.get('model'), str) or not response['model'].strip():
                    raise ValueError('Missing provider model')
                result = materialize(batch, response, threshold=.90)
            except (KeyError, TypeError, AttributeError, ValueError) as exc:
                raise ValueError('Invalid JEV classification response') from exc
            # Originals remain the authority; annotations are never ingested as source text.
            _write(path, {'version': VERSION, 'annotation_id': annotation_id,
                          'record_id': record_id, 'revision': revision,
                          'generation': generation, 'requested_model': MODEL,
                          'provider_model': response['model'], 'threshold': .90,
                          'created_at': datetime.now(timezone.utc).isoformat(),
                          'authority': 'retained-summary-only', 'experimental': True,
                          'judgments': result['judgments']})
            return {'status': 'written', 'annotation_id': annotation_id,
                    'judgments': len(result['judgments'])}

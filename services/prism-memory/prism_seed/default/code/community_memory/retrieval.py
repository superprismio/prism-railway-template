"""Read-only, bounded lexical retrieval over immutable shadow catalog generations."""
from __future__ import annotations

import json
import math
import re
import threading
from collections import Counter, OrderedDict
from datetime import datetime
from pathlib import Path

from .catalog import normalize, timestamp

TOKEN = re.compile(r"\w+", re.UNICODE)
HEX = re.compile(r"[0-9a-f]{64}")


# Cache derived immutable files only. Authority files and deny policy are always
# read afresh below. One process-wide LRU is shared by scoped reader instances.
_CACHE_LOCK = threading.Lock()
_CATALOG_CACHE = OrderedDict()
_CACHE_BYTES = 32 * 1024 * 1024  # serialized size budget; Python objects cost more


def cached_records(folder):
    stat = folder.stat()
    key = (str(folder.resolve()), stat.st_ino, stat.st_mtime_ns)
    with _CACHE_LOCK:
        if key in _CATALOG_CACHE:
            _CATALOG_CACHE.move_to_end(key)
            return _CATALOG_CACHE[key][1]
        paths = sorted(folder.glob('*.json'))
        size = sum(p.stat().st_size for p in paths)
        records = [json.loads(p.read_text()) for p in paths]
        if size <= _CACHE_BYTES:
            while _CATALOG_CACHE and (len(_CATALOG_CACHE) >= 2 or
                    sum(v[0] for v in _CATALOG_CACHE.values()) + size > _CACHE_BYTES):
                _CATALOG_CACHE.popitem(last=False)
            _CATALOG_CACHE[key] = (size, records)
        return records


QUESTION_WORDS = frozenset("""what which who whom whose when where why how is are was were
be been being do does did has have had a an the and or of for to in on at by with
from about as it its this that these those we our us they their there any would
could should can will came come up discussed discuss discussion tell me please
""".split())


def query_terms(query, mode):
    if mode not in {'auto', 'literal', 'question'}:
        raise RetrievalError('query_mode must be auto, literal, or question')
    tokens = TOKEN.findall(query.casefold())
    question = mode == 'question' or (mode == 'auto' and
        (query.rstrip().endswith('?') or bool(tokens and tokens[0] in
         {'what', 'which', 'who', 'when', 'where', 'why', 'how', 'was', 'were', 'did', 'does'})))
    terms = set(tokens)
    if question:
        terms -= QUESTION_WORDS
    return terms, 'question' if question else 'literal'


class RetrievalError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def passages(record: dict):
    """Nonoverlapping bounded passages with exact Unicode character offsets."""
    content = record['content']
    start = 0
    while start < len(content):
        end = min(start + 1600, len(content))
        if end < len(content):
            boundary = content.rfind('\n', start + 800, end)
            if boundary >= 0:
                end = boundary + 1
        yield {'passage_id': str(start), 'start': start, 'end': end, 'text': content[start:end]}
        start = end


def normalized_time(value: str) -> str:
    # Fixed precision keeps lexicographic ordering correct within the same second.
    return datetime.fromisoformat(timestamp(value).replace('Z', '+00:00')).isoformat(timespec='microseconds')


def event_time(record: dict) -> str:
    metadata = record.get('metadata', {})
    discord = metadata.get('discord') or {}
    for value in (metadata.get('started_at'), discord.get('recordingStartedAt'), record['occurred_at']):
        if value:
            try:
                return normalized_time(value)
            except ValueError:
                continue
    return normalized_time(record['occurred_at'])


class CatalogReader:
    def __init__(self, root: Path, allowed_sources: frozenset[str] | None = None, *,
                 allowed_buckets: frozenset[str] | None = None, source_root: Path | None = None):
        self.root = root
        self.allowed_sources = allowed_sources
        self.allowed_buckets = allowed_buckets
        self.source_root = source_root.resolve() if source_root else None

    def snapshot(self, expected: str | None = None) -> tuple[str, list[dict]]:
        try:
            generation = json.loads((self.root / 'current.json').read_text())['generation']
            if not isinstance(generation, str) or not HEX.fullmatch(generation):
                raise ValueError('invalid generation')
            if expected is not None and generation != expected:
                raise RetrievalError('Catalog changed; repeat search against the current generation', 409)
            folder = self.root / 'generations' / generation / 'records'
            if not folder.is_dir():
                raise ValueError('missing generation')
            records = cached_records(folder)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            if isinstance(exc, RetrievalError):
                raise
            raise RetrievalError('Catalog unavailable; build a shadow generation first', 503) from exc
        if self.allowed_sources is not None:
            records = [r for r in records if r['source'] in self.allowed_sources]
        if self.allowed_buckets is not None:
            records = [r for r in records if r.get('bucket') in self.allowed_buckets]
        if self.source_root is not None:
            records = self.current_records(records)
        return generation, records

    def current_records(self, records: list[dict]) -> list[dict]:
        """Recheck the authority files each request; cached generations confer no access."""
        try:
            policy = json.loads((self.source_root / 'retrieval/visibility.json').read_text())
            for key in ('denied_record_ids', 'denied_sources'):
                if not isinstance(policy.get(key), list) or any(not isinstance(v, str) for v in policy[key]):
                    raise ValueError('invalid visibility policy')
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            raise RetrievalError('Current visibility policy unavailable', 503) from exc
        visible = []
        for record in records:
            if record['record_id'] in policy['denied_record_ids'] or record['source'] in policy['denied_sources']:
                continue
            for ref in record.get('source_refs', []):
                path = self.source_root / ref
                if path.is_symlink() or not path.resolve().is_relative_to(self.source_root):
                    continue
                try:
                    current = normalize(json.loads(path.read_text()), ref)
                except (OSError, ValueError, TypeError):
                    continue
                if current['record_id'] == record['record_id'] and current['revision'] == record['revision']:
                    visible.append(record)
                    break
        return visible

    def select(self, records: list[dict], *, source=None, kind=None, participant=None,
               start=None, end=None, meeting_id=None) -> list[dict]:
        try:
            lower, upper = normalized_time(start) if start else None, normalized_time(end) if end else None
        except ValueError as exc:
            raise RetrievalError(str(exc)) from exc
        if lower and upper and lower >= upper:
            raise RetrievalError('start must precede end')
        result = []
        for r in records:
            if source is not None and r['source'] != source:
                continue
            if kind is not None and r['kind'] != kind:
                continue
            if meeting_id is not None and r.get('meeting_id') != meeting_id:
                continue
            names = [p.casefold() for p in r.get('participants', []) if isinstance(p, str)]
            presence = r.get('metadata', {}).get('participant_presence') or []
            names += [p[key].casefold() for p in presence if isinstance(p, dict)
                      for key in ('id', 'display_name') if isinstance(p.get(key), str)]
            if participant is not None and participant.casefold() not in names:
                continue
            when = event_time(r)
            if lower and when < lower or upper and when >= upper:
                continue
            result.append(r)
        return result

    @staticmethod
    def coverage(records):
        times = [event_time(r) for r in records]
        return {'mode': 'processed-inbox-snapshot', 'complete_history': False,
                'observed_start': min(times) if times else None,
                'observed_end': max(times) if times else None,
                'record_revisions': len(records), 'sources': sorted({r['source'] for r in records}),
                'limitations': ['Retained snapshot only; missing artifacts and sources are not searched.',
                                'Source permissions and deletions require a catalog rebuild; trusted internal reader scope.']}

    @staticmethod
    def reference(record):
        return {k: record.get(k) for k in ('record_id', 'revision', 'meeting_id', 'source', 'kind',
                                         'title', 'source_url', 'source_refs', 'occurred_at')}

    def meetings(self, *, limit=20, **filters):
        if not 1 <= limit <= 100:
            raise RetrievalError('limit must be between 1 and 100')
        generation, records = self.snapshot()
        selected = self.select(records, **filters)
        grouped = {}
        for r in selected:
            if not r.get('meeting_id'):
                continue
            group = grouped.setdefault(r['meeting_id'], {'meeting_id': r['meeting_id'], 'artifacts': [],
                                                         'participants': [], 'started_at': event_time(r)})
            group['started_at'] = min(group['started_at'], event_time(r))
            group['artifacts'].append(self.reference(r))
            for p in r.get('participants', []):
                if p not in group['participants']:
                    group['participants'].append(p)
        items = sorted(grouped.values(), key=lambda m: (m['started_at'], m['meeting_id']), reverse=True)
        return {'generation': generation, 'meetings': items[:limit], 'total': len(items),
                'truncated': len(items) > limit, 'coverage': self.coverage(records)}

    def meeting(self, meeting_id):
        if not HEX.fullmatch(meeting_id):
            raise RetrievalError('Invalid meeting ID')
        generation, records = self.snapshot()
        selected = self.select(records, meeting_id=meeting_id)
        if not selected:
            raise RetrievalError('Meeting not found', 404)
        artifacts = [{**self.reference(r), 'participants': r.get('participants', []),
                      'metadata': r.get('metadata', {}), 'summary': r.get('summary'),
                      'character_count': len(r['content'])} for r in selected]
        return {'generation': generation, 'meeting_id': meeting_id, 'artifacts': artifacts,
                'alternative_artifact_kinds': sorted(k for k, n in Counter(r['kind'] for r in selected).items() if n > 1),
                'coverage': self.coverage(selected)}

    def search(self, query: str, *, limit=20, query_mode="auto", **filters):
        if not 1 <= limit <= 100 or len(query) > 500:
            raise RetrievalError('limit must be 1–100 and query at most 500 characters')
        planned_terms, planned_mode = query_terms(query, query_mode)
        terms = set(TOKEN.findall(query.casefold())) if planned_mode == 'question' else planned_terms
        if not planned_terms:
            raise RetrievalError('Provide a query containing words or identifiers')
        generation, records = self.snapshot()
        selected = self.select(records, **filters)
        entries = []
        frequency = Counter()
        total_length = 0
        for r in selected:
            for p in passages(r):
                counts = Counter(TOKEN.findall(p['text'].casefold()))
                length = sum(counts.values())
                total_length += length
                frequency.update(terms.intersection(counts))
                entries.append((r, p, counts, length))
        n = len(entries)
        average = total_length / max(n, 1) or 1
        hits = []
        for r, p, counts, length in entries:
            matches = terms.intersection(counts)
            if not matches.intersection(planned_terms):
                continue
            score = sum(math.log(1 + (n - frequency[t] + .5) / (frequency[t] + .5)) *
                        counts[t] * 2.2 / (counts[t] + 1.2 * (.25 + .75 * length / average)) for t in matches)
            focused_score = sum(math.log(1 + (n - frequency[t] + .5) / (frequency[t] + .5)) *
                        counts[t] * 2.2 / (counts[t] + 1.2 * (.25 + .75 * length / average))
                        for t in matches.intersection(planned_terms)) if planned_mode == 'question' else score
            hits.append({**self.reference(r), **p, 'score': round(score, 6),
                         '_focused_score': focused_score, 'matched_terms': sorted(matches)})
        hits.sort(key=lambda h: (-h['score'], h['record_id'], h['revision'], h['start']))
        if planned_mode == 'question':
            # Preserve raw-query recall while gently promoting salient-term matches.
            # Fixed weighted reciprocal-rank fusion; no provider call or inferred scope.
            focused = sorted(hits, key=lambda h: (-h['_focused_score'], h['record_id'], h['revision'], h['start']))
            ranks = {(h['record_id'], h['revision'], h['start']): i for i, h in enumerate(focused)}
            for i, h in enumerate(hits):
                h['score'] = .8 / (60 + i + 1) + .2 / (60 + ranks[(h['record_id'], h['revision'], h['start'])] + 1)
            hits.sort(key=lambda h: (-h['score'], h['record_id'], h['revision'], h['start']))
        for h in hits:
            del h['_focused_score']
        return {'generation': generation, 'query': query, 'hits': hits[:limit], 'total': len(hits),
                'truncated': len(hits) > limit, 'coverage': self.coverage(records),
                'ranking': 'lexical-question-fusion-v1' if planned_mode == 'question' else 'lexical-bm25-passage-v1',
                'query_plan': {'mode': planned_mode, 'terms': sorted(planned_terms),
                               'original_terms_retained': planned_mode == 'question'}}

    def context(self, *, generation, record_id, revision, passage_id, max_chars=8000):
        if not 1 <= max_chars <= 32000:
            raise RetrievalError('max_chars must be between 1 and 32000')
        current, records = self.snapshot(generation)
        r = next((r for r in records if r['record_id'] == record_id and r['revision'] == revision), None)
        if r is None:
            raise RetrievalError('Record revision not found', 404)
        p = next((p for p in passages(r) if p['passage_id'] == passage_id), None)
        if p is None:
            raise RetrievalError('Passage not found', 404)
        if max_chars < p['end'] - p['start']:
            raise RetrievalError('max_chars must accommodate the entire cited passage')
        start = max(0, p['start'] - max(0, (max_chars - (p['end'] - p['start'])) // 2))
        end = min(len(r['content']), start + max_chars)
        return {'generation': current, **self.reference(r), 'passage_id': passage_id,
                'start': start, 'end': end, 'text': r['content'][start:end],
                'truncated': start > 0 or end < len(r['content'])}

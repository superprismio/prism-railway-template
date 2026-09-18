"""Read-only, explicitly labeled retrieval evaluation; no model or network calls.

Labels are positive evidence judgments, not exhaustive relevance judgments.
Therefore report known-positive recall/MRR, never precision or answer accuracy.
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

from .retrieval import CatalogReader, TOKEN


def evaluate(reader: CatalogReader, suite: dict, k: int = 5) -> dict:
    if not 1 <= k <= 100:
        raise ValueError('k must be between 1 and 100')
    generation, records = reader.snapshot()
    expected_generation = suite.get('generation')
    if expected_generation and expected_generation != generation:
        raise ValueError('Benchmark generation differs; rebuild/review labels before comparing')
    by_id = {}
    for record in records:
        by_id.setdefault(record['record_id'], []).append(record)
    results = []
    seen = set()
    for case in suite['cases']:
        if case['id'] in seen:
            raise ValueError('Duplicate case ID: ' + case['id'])
        seen.add(case['id'])
        positives = case['relevant']
        if not positives and not case.get('expect_empty'):
            raise ValueError('A case requires positive labels or expect_empty')
        for label in positives:
            candidates = by_id.get(label['record_id'], [])
            if not label.get('evidence') or not any(label['evidence'] in r['content'] for r in candidates):
                raise ValueError('Missing labeled source/evidence: ' + case['id'])
        start = time.perf_counter()
        result = reader.search(case['query'], limit=k, **case.get('filters', {}))
        elapsed = (time.perf_counter() - start) * 1000
        if result['generation'] != generation:
            raise ValueError('Catalog changed during evaluation')
        hits = result['hits']
        relevant = {label['record_id'] for label in positives}
        retrieved = {h['record_id'] for h in hits}
        ranks = [i + 1 for i, h in enumerate(hits) if h['record_id'] in relevant]
        evidence_found = sum(any(h['record_id'] == label['record_id'] and label['evidence'] in h['text']
                                 for h in hits) for label in positives)
        citation_errors = 0
        for hit in hits:
            context = reader.context(generation=generation, record_id=hit['record_id'],
                                     revision=hit['revision'], passage_id=hit['passage_id'], max_chars=1600)
            record = next(r for r in by_id[hit['record_id']] if r['revision'] == hit['revision'])
            if (hit['text'] != record['content'][hit['start']:hit['end']]
                    or context['text'] != record['content'][context['start']:context['end']]
                    or not context['start'] <= hit['start'] < context['end']):
                citation_errors += 1
        # An unordered whole-record lexical scan, not the legacy production API.
        terms = set(TOKEN.findall(case['query'].casefold()))
        selected = reader.select(records, **case.get('filters', {}))
        scan_ids = {r['record_id'] for r in selected if terms.intersection(TOKEN.findall(r['content'].casefold()))}
        results.append({'id': case['id'], 'question': case['question'], 'query': case['query'],
                        'filters': case.get('filters', {}), 'category': case.get('category', 'general'),
                        'known_positive_recall_at_k': len(relevant & retrieved) / len(relevant) if relevant else None,
                        'evidence_recall_at_k': evidence_found / len(positives) if positives else None,
                        'reciprocal_rank': 1 / ranks[0] if ranks else 0,
                        'lexical_scan_known_positive_recall': len(relevant & scan_ids) / len(relevant) if relevant else None,
                        'empty_check_passed': result['total'] == 0 if case.get('expect_empty') else None,
                        'citation_errors': citation_errors, 'hits_checked': len(hits),
                        'unique_records_at_k': len(retrieved), 'total_matching_passages': result['total'],
                        'latency_ms': round(elapsed, 2),
                        'retrieved_record_ids': [h['record_id'] for h in hits]})
    positive = [r for r in results if r['known_positive_recall_at_k'] is not None]
    mean = lambda field: round(statistics.mean(r[field] for r in positive), 4) if positive else None
    return {'suite': suite['name'], 'generation': generation, 'k': k, 'cases': results,
            'summary': {'case_count': len(results), 'positive_cases': len(positive),
                        'mean_known_positive_recall_at_k': mean('known_positive_recall_at_k'),
                        'mean_evidence_recall_at_k': mean('evidence_recall_at_k'),
                        'mrr_at_k': mean('reciprocal_rank'),
                        'lexical_scan_known_positive_recall': mean('lexical_scan_known_positive_recall'),
                        'citation_errors': sum(r['citation_errors'] for r in results),
                        'empty_check_failures': sum(r['empty_check_passed'] is False for r in results),
                        'median_latency_ms': statistics.median(r['latency_ms'] for r in results) if results else None},
            'limitations': ['Positive labels are not exhaustive; this is not precision or answer accuracy.',
                            'Questions and tool queries are separate; no automatic query planner is evaluated.',
                            'Lexical scan is an unordered whole-record baseline, not the existing production search.',
                            'Passage slots can be occupied by repeated records; no deduplication is applied in evaluation.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--suite', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--k', type=int, default=5)
    args = parser.parse_args()
    report = evaluate(CatalogReader(args.catalog), json.loads(args.suite.read_text()), args.k)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary'], indent=2))
    # Ranking misses are measurements. Broken citation/absence contracts fail the run.
    raise SystemExit(1 if report['summary']['citation_errors'] or report['summary']['empty_check_failures'] else 0)


if __name__ == '__main__':
    main()

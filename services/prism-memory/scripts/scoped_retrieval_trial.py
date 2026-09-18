"""Run an isolated, headless scoped-API trial on retained data.

Copies meeting authority files to a temporary directory, uses a temporary server
key and a loopback-only listener, and removes both after verification. Never
changes production credentials, original records, or the current catalog pointer.
Run with the code directory on PYTHONPATH; requires the service dependencies.
"""
import argparse
import os
import json
import time
import secrets
import threading
import shutil
import statistics
import concurrent.futures
import urllib.request
import urllib.error
import tempfile
import socket
from pathlib import Path
from fastapi import FastAPI
import uvicorn
from community_memory_api.scoped_retrieval import scoped_retrieval_router
from community_memory.retrieval import CatalogReader

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True, help='Retained source authority root')
    parser.add_argument('--catalog', type=Path, required=True, help='Existing immutable shadow catalog')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='memory-api-trial-') as temp:
        temp = Path(temp)
        live = args.root.resolve()
        catalog = args.catalog.resolve()
        g, records = CatalogReader(catalog).snapshot()
        chosen = [r for r in records if r.get('bucket') == 'meetings']
        source = temp / 'source'
        source.mkdir()
        for r in chosen:
            for ref in r['source_refs']:
                p = live / ref
                if p.is_file() and p.resolve().is_relative_to(live):
                    target = source / ref
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(p, target)
        policy = source / 'retrieval/visibility.json'
        policy.parent.mkdir()

        def write_policy(ids):
            stage = policy.with_suffix('.tmp')
            stage.write_text(json.dumps({'denied_record_ids': ids, 'denied_sources': []}))
            stage.replace(policy)
        write_policy([])
        key = secrets.token_urlsafe(32)
        os.environ['PRISM_RETRIEVAL_SERVICE_KEY'] = key
        os.environ['PRISM_SHADOW_SOURCE_ROOT'] = str(source)
        app = FastAPI()
        app.include_router(scoped_retrieval_router(catalog))
        listener = socket.create_server(('127.0.0.1', 0))
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, log_level='error'))
        thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
        thread.start()
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.05)
        assert server.started

        def call(op, args=None, buckets=None, credential=key, extra=None):
            payload = {'operation': op, 'arguments': args or {}, 'scope': {'buckets': ['meetings'] if buckets is None else buckets, 'knowledge_source_ids': []}}
            if extra:
                payload.update(extra)
            req = urllib.request.Request(f'http://127.0.0.1:{port}/retrieval/scoped', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'X-Prism-Retrieval-Key': credential})
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return (resp.status, json.load(resp))
            except urllib.error.HTTPError as e:
                return (e.code, json.load(e))
        checks = {}
        try:
            assert call('coverage', credential='wrong')[0] == 401
            checks['bad_credential_denied'] = True
            code, result = call('search', {'query': 'What was discussed about Livepeer?', 'limit': 10})
            assert code == 200 and result['hits']
            h = result['hits'][0]
            context = {'generation': result['generation'], 'record_id': h['record_id'], 'revision': h['revision'], 'passage_id': h['passage_id']}
            for op, args in [('coverage', {}), ('meetings', {}), ('meeting', {'meeting_id': h['meeting_id']}), ('context', context)]:
                assert call(op, args)[0] == 200
            checks['five_operations_pass'] = True
            assert 'source_refs' not in json.dumps(result) and 'source_url' not in json.dumps(result)
            checks['legacy_links_stripped'] = True
            assert call('search', {'query': 'Livepeer'}, buckets=[])[1]['total'] == 0
            assert call('coverage', buckets=[])[1]['record_revisions'] == 0
            assert call('meetings', buckets=[])[1]['total'] == 0
            assert call('meeting', {'meeting_id': h['meeting_id']}, buckets=[])[0] == 404
            assert call('context', context, buckets=[])[0] == 404
            checks['empty_scope_denies_all'] = True
            assert call('search', {'query': 'Livepeer', 'scope': {'buckets': ['guildhq']}})[0] == 422
            checks['argument_scope_injection_denied'] = True
            write_policy([h['record_id']])
            assert call('context', context)[0] == 404
            assert all((x['record_id'] != h['record_id'] for x in call('search', {'query': 'Livepeer'})[1]['hits']))
            checks['warm_cache_revocation_applies'] = True
            write_policy([])
            policy.unlink()
            assert call('coverage')[0] == 503
            write_policy([])
            checks['missing_visibility_fails_closed'] = True

            def run(q):
                start = time.perf_counter()
                status, _ = call('search', {'query': q, 'kind': 'meeting_summary', 'limit': 10})
                assert status == 200
                return (time.perf_counter() - start) * 1000
            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
                timings = list(pool.map(run, ['cohort', 'Livepeer', 'Hats', 'Storybook', 'matchmaking'] * 4))
            print(json.dumps({'generation': g, 'copied_record_revisions': len(chosen), 'checks': checks, 'latency': {'requests': 20, 'concurrency': 5, 'median_ms': statistics.median(timings), 'p95_ms': sorted(timings)[18]}, 'trial': 'localhost HTTP; retained source copy; scoped auth and fresh visibility; temporary key; no permanent service configuration'}, indent=2))
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            listener.close()
if __name__ == '__main__':
    main()

import json
import tempfile
import unittest
from pathlib import Path

from community_memory.catalog import build_catalog
from community_memory.retrieval import CatalogReader, RetrievalError


class RetrievalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.inbox = self.root / 'inbox/memory/processed'
        self.inbox.mkdir(parents=True)
        self.output = self.root / 'catalog'
        self.put('a', 'discord-voice', 'meeting_summary', 'Alpha launch agreed.\nAlex will ship.', '2026-09-17T10:00:00Z')
        self.put('b', 'discord-voice', 'meeting_transcript', 'Alex: Alpha launch agreed.\n' * 150, '2026-09-17T10:00:00Z', session='a')
        self.put('c', 'private', 'meeting_summary', 'Secret launch details.', '2026-09-18T10:00:00Z')
        build_catalog(self.root, self.output)
        self.reader = CatalogReader(self.output)

    def put(self, name, source, kind, content, ts, session=None):
        (self.inbox / (name+'.json')).write_text(json.dumps({'source': source, 'type': kind,
            'content': content, 'ts': ts, 'participants': ['Alex'],
            'bucket_hint': 'private' if source == 'private' else 'meetings',
            'metadata': {'session_id': session or name}}))

    def test_meetings_group_filter_and_sort(self):
        result = self.reader.meetings()
        self.assertEqual(result['total'], 2)
        filtered = self.reader.meetings(participant='alex', end='2026-09-18T00:00:00Z')
        self.assertEqual(filtered['total'], 1)
        self.assertEqual(len(filtered['meetings'][0]['artifacts']), 2)
        detail = self.reader.meeting(filtered['meetings'][0]['meeting_id'])
        self.assertEqual(len(detail['artifacts']), 2)
        self.assertFalse(detail['coverage']['complete_history'])

    def test_search_context_matches_exact_revision_offsets(self):
        result = self.reader.search('ALPHA', source='discord-voice')
        hit = result['hits'][0]
        context = self.reader.context(generation=result['generation'], record_id=hit['record_id'],
            revision=hit['revision'], passage_id=hit['passage_id'], max_chars=2000)
        records = self.reader.snapshot()[1]
        record = next(r for r in records if r['record_id']==hit['record_id'] and r['revision']==hit['revision'])
        self.assertEqual(context['text'], record['content'][context['start']:context['end']])
        self.assertLessEqual(len(context['text']), 2000)
        self.assertTrue(all(h['source']=='discord-voice' for h in result['hits']))

    def test_allowed_sources_apply_to_counts_detail_and_context(self):
        scoped = CatalogReader(self.output, frozenset({'discord-voice'}))
        self.assertEqual(scoped.meetings()['total'], 1)
        self.assertEqual(scoped.search('Secret')['total'], 0)
        private = self.reader.search('Secret')['hits'][0]
        with self.assertRaises(RetrievalError):
            scoped.meeting(private['meeting_id'])
        with self.assertRaises(RetrievalError):
            scoped.context(generation=self.reader.snapshot()[0], record_id=private['record_id'],
                revision=private['revision'], passage_id=private['passage_id'])
        self.assertEqual(CatalogReader(self.output, frozenset()).meetings()['total'], 0)

    def test_stale_generation_requires_new_search(self):
        old = self.reader.search('Alpha')
        self.put('d', 'discord-voice', 'meeting_summary', 'New', '2026-09-19T00:00:00Z')
        build_catalog(self.root, self.output)
        hit=old['hits'][0]
        with self.assertRaises(RetrievalError) as ctx:
            self.reader.context(generation=old['generation'], record_id=hit['record_id'],
                revision=hit['revision'], passage_id=hit['passage_id'])
        self.assertEqual(ctx.exception.status,409)

    def test_invalid_queries_and_bounds(self):
        for query in ['', '!!!', 'a'*501]:
            with self.assertRaises(RetrievalError): self.reader.search(query)
        with self.assertRaises(RetrievalError): self.reader.search('Alpha',limit=101)
        with self.assertRaises(RetrievalError): self.reader.meetings(start='not-a-date')
        with self.assertRaises(RetrievalError): self.reader.meeting('../../etc/passwd')
        self.assertTrue(self.reader.search('launch',limit=1)['truncated'])

    def test_subsecond_boundaries_and_missing_catalog(self):
        self.put('d', 'discord-voice', 'meeting_summary', 'Precise', '2026-09-18T10:00:00.500Z')
        build_catalog(self.root, self.output)
        result = self.reader.meetings(start='2026-09-18T10:00:00Z', end='2026-09-18T10:00:00.500Z')
        self.assertEqual(result['total'], 1)
        with self.assertRaises(RetrievalError) as ctx:
            CatalogReader(self.root / 'missing').meetings()
        self.assertEqual(ctx.exception.status,503)

    def test_application_routes_are_opt_in_and_use_read_auth(self):
        import os
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        from community_memory_api.app import Settings, create_app
        settings = Settings(base_dir=self.root, data_root_override=self.root,
                            read_api_key='read-test', ops_api_key='ops-test')
        with patch.dict(os.environ, {'PRISM_SHADOW_CATALOG_ROOT': ''}):
            self.assertEqual(TestClient(create_app(settings)).get('/meetings').status_code,404)
        with patch.dict(os.environ, {'PRISM_SHADOW_CATALOG_ROOT': str(self.output)}):
            client=TestClient(create_app(settings))
            self.assertEqual(client.get('/meetings').status_code,401)
            self.assertEqual(client.get('/meetings',headers={'X-Prism-Api-Key':'read-test'}).status_code,200)

    def test_http_auth_and_validation(self):
        from fastapi import FastAPI, Header, HTTPException
        from fastapi.testclient import TestClient
        from community_memory_api.retrieval_routes import retrieval_router
        def auth(x_prism_api_key: str | None = Header(None)):
            if x_prism_api_key != 'test-key': raise HTTPException(401)
        app=FastAPI();app.include_router(retrieval_router(self.output,auth))
        client=TestClient(app)
        self.assertEqual(client.get('/meetings').status_code,401)
        headers={'X-Prism-Api-Key':'test-key'}
        result=client.post('/retrieval/search',headers=headers,json={'query':'Alpha'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(client.post('/retrieval/search',headers=headers,json={'query':'Alpha','limit':101}).status_code,422)
        self.assertEqual(client.get('/meetings/not-an-id',headers=headers).status_code,400)
        self.assertEqual(client.get('/retrieval/coverage',headers=headers).status_code,200)

    def test_scoped_http_rechecks_scope_visibility_and_source_revision(self):
        import os
        from unittest.mock import patch
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from community_memory_api.scoped_retrieval import scoped_retrieval_router
        policy = self.root / 'retrieval/visibility.json'
        policy.parent.mkdir()
        policy.write_text(json.dumps({'denied_record_ids': [], 'denied_sources': []}))
        app=FastAPI(); app.include_router(scoped_retrieval_router(self.output))
        client=TestClient(app)
        headers={'X-Prism-Retrieval-Key':'scoped-secret'}
        def call(operation, arguments=None, buckets=None):
            return client.post('/retrieval/scoped', headers=headers, json={
                'operation':operation,'arguments':arguments or {},
                'scope':{'buckets':['meetings'] if buckets is None else buckets}})
        with patch.dict(os.environ, {'PRISM_RETRIEVAL_SERVICE_KEY':'scoped-secret',
                                     'PRISM_SHADOW_SOURCE_ROOT':str(self.root)}):
            self.assertEqual(client.post('/retrieval/scoped',json={}).status_code,401)
            self.assertEqual(call('search',{'query':'Secret'}).json()['total'],0)
            self.assertEqual(call('meetings',buckets=[]).json()['total'],0)
            result=call('search',{'query':'Alpha'}).json()
            hit=result['hits'][0]
            self.assertNotIn('source_refs',hit)
            args={k:hit[k] for k in ('record_id','revision','passage_id')}
            args['generation']=result['generation']
            self.assertEqual(call('context',args).status_code,200)
            self.assertEqual(call('context',args,buckets=[]).status_code,404)
            policy.write_text(json.dumps({'denied_record_ids':[hit['record_id']], 'denied_sources':[]}))
            self.assertEqual(call('context',args).status_code,404)
            policy.write_text(json.dumps({'denied_record_ids':[], 'denied_sources':[]}))
            # Removing all original artifacts hides a stale meeting without reindexing.
            for name in ['a.json','b.json']: (self.inbox/name).unlink()
            self.assertEqual(call('meeting',{'meeting_id':hit['meeting_id']}).status_code,404)
            self.assertEqual(call('search',{'query':'Alpha'}).json()['total'],0)
            policy.unlink()
            self.assertEqual(call('coverage').status_code,503)

    def test_changed_original_revision_is_not_returned_from_stale_catalog(self):
        policy=self.root/'retrieval/visibility.json';policy.parent.mkdir()
        policy.write_text(json.dumps({'denied_record_ids':[], 'denied_sources':[]}))
        reader=CatalogReader(self.output, allowed_buckets=frozenset({'meetings'}),source_root=self.root)
        self.assertGreater(reader.search('ship')['total'],0)
        self.put('a','discord-voice','meeting_summary','Content was corrected','2026-09-17T10:00:00Z')
        self.assertEqual(reader.search('ship')['total'],0)

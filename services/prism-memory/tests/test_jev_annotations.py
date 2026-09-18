import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from community_memory.catalog import build_catalog
from community_memory.jev_annotations import JevAnnotations
from community_memory.relationship_pilot import CRITERIA
from community_memory.retrieval import RetrievalError


class JevAnnotationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'source'
        self.inbox = self.root / 'inbox/memory/processed'; self.inbox.mkdir(parents=True)
        self.catalog = Path(self.tmp.name) / 'catalog'
        self.put('a')
        self.store = JevAnnotations(self.catalog, self.root)

    def put(self, name, content='The team agreed to release the update.'):
        (self.inbox / (name + '.json')).write_text(json.dumps({
            'source': 'discord-voice', 'type': 'meeting_summary', 'ts': '2026-09-18T10:00:00Z',
            'content': content, 'metadata': {'session_id': name}}))
        build_catalog(self.root, self.catalog)

    def response(self, batch, probability=1):
        return {'model': 'test-model', 'answers': {k: {'type': 'choice', 'choice': 'decision',
            'probabilities': {c: probability if c == 'decision' else (1-probability)/4 for c in CRITERIA}}
            for k in batch['request']['questions']}}

    def commit(self, batch, response=None):
        return self.store.commit(**{k: batch[k] for k in ('record_id', 'revision', 'annotation_id')},
                                 response=response or self.response(batch))

    def test_bounded_cached_and_source_unchanged(self):
        self.put('b'); self.put('c')
        before = {p.name: p.read_bytes() for p in self.inbox.iterdir()}
        pending = self.store.pending(); self.assertEqual(pending['pending'], 3)
        self.assertEqual(len(pending['batches']), 2)
        batch = pending['batches'][0]
        self.assertEqual(self.commit(batch)['status'], 'written')
        self.assertEqual(self.commit(batch)['status'], 'cached')
        self.assertEqual(self.store.pending()['pending'], 2)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.inbox.iterdir()})
        result = json.loads((self.store.root / (batch['annotation_id'] + '.json')).read_text())
        self.assertNotIn('edges', result)
        self.assertEqual(result['revision'], batch['revision'])

    def test_changed_or_deleted_source_rejects_results_before_catalog_refresh(self):
        batch = self.store.pending()['batches'][0]
        p = self.inbox / 'a.json'; original = p.read_text()
        changed = json.loads(original); changed['content'] = 'The team approved a different release.'
        p.write_text(json.dumps(changed))
        with self.assertRaises(RetrievalError): self.commit(batch)
        p.unlink()
        with self.assertRaises(RetrievalError): self.commit(batch)

    def test_edit_requeues_new_revision_and_keeps_old_annotation_separate(self):
        batch = self.store.pending()['batches'][0]; self.commit(batch)
        self.put('a', 'The team agreed to delay the update.')
        new = self.store.pending()['batches'][0]
        self.assertNotEqual(batch['annotation_id'], new['annotation_id'])
        with self.assertRaises(RetrievalError): self.commit(batch)
        self.assertEqual(self.commit(new)['status'], 'written')

    def test_invalid_provider_response_stays_pending_and_low_confidence_abstains(self):
        batch = self.store.pending()['batches'][0]
        with self.assertRaises(ValueError): self.commit(batch, {'model': 'test', 'answers': {}})
        self.assertEqual(self.store.pending()['pending'], 1)
        self.commit(batch, self.response(batch, .8))
        result = json.loads((self.store.root / (batch['annotation_id'] + '.json')).read_text())
        self.assertTrue(all(j['abstained'] for j in result['judgments']))

    def test_no_candidates_and_conflicting_revisions_are_skipped(self):
        self.put('a', 'Ordinary background information.')
        self.assertEqual(self.store.pending()['pending'], 0)
        self.put('a')
        other = json.loads((self.inbox / 'a.json').read_text()); other['content'] = 'The team agreed to cancel.'
        (self.inbox / 'duplicate.json').write_text(json.dumps(other)); build_catalog(self.root, self.catalog)
        self.assertEqual(self.store.pending()['pending'], 0)
        self.assertEqual(self.store.pending()['skipped']['conflicting_revisions'], 2)

    def test_configured_denials_and_oversized_summaries_are_not_sent(self):
        batch = self.store.pending()['batches'][0]
        policy = self.root / 'retrieval/visibility.json'; policy.parent.mkdir()
        policy.write_text(json.dumps({'denied_record_ids': [batch['record_id']], 'denied_sources': []}))
        self.assertEqual(self.store.pending()['pending'], 0)
        with self.assertRaises(RetrievalError): self.commit(batch)
        policy.write_text('invalid policy')
        with self.assertRaises(RetrievalError): self.store.pending()
        policy.unlink()
        self.put('a', 'The team agreed to release. ' * 1000)
        self.assertEqual(self.store.pending()['pending'], 0)

    def test_api_is_ops_only_and_enforces_batch_cap(self):
        from fastapi.testclient import TestClient
        from community_memory_api.app import Settings, create_app
        settings = Settings(base_dir=self.root, data_root_override=self.root,
                            ops_api_key='ops', read_api_key='reader')
        with patch.dict(os.environ, {'PRISM_SHADOW_CATALOG_ROOT': str(self.catalog)}):
            client = TestClient(create_app(settings))
            route = '/ops/annotations/jev/pending'
            for headers in [{}, {'X-Prism-Api-Key': 'reader'}]:
                self.assertEqual(client.post(route, json={}, headers=headers).status_code, 401)
            headers = {'X-Prism-Api-Key': 'ops'}
            self.assertEqual(client.post(route, json={'limit': 3}, headers=headers).status_code, 422)
            self.assertEqual(client.post(route, json={}, headers=headers).status_code, 200)

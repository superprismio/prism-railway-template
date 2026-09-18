"""User-facing retrieval contracts over a small, deliberately ambiguous community."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from community_memory.catalog import build_catalog
from community_memory.retrieval import CatalogReader, RetrievalError
from community_memory.retrieval_eval import evaluate


class RetrievalQualityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.inbox = self.root / 'inbox/memory/processed'
        self.inbox.mkdir(parents=True)
        self.catalog = self.root / 'catalog'
        self.policy = self.root / 'retrieval/visibility.json'
        self.policy.parent.mkdir()
        self.policy.write_text(json.dumps({'denied_record_ids': [], 'denied_sources': []}))
        self.payloads = {}
        self.put('launch', 'We decided to postpone Atlas launch until October. Maya owns accessibility fixes. No budget was approved.',
                 participants=['Maya', 'Alex'], started='2026-09-10T16:00:00Z')
        self.put('transcript', 'Maya: I will handle accessibility. Alex: Postpone Atlas until October.',
                 session='launch', kind='meeting_transcript', participants=['Maya', 'Alex'], started='2026-09-10T16:00:00Z')
        self.put('latest', 'Atlas accessibility fixes are complete. Launch is October 3. Alex owns release notes.',
                 participants=['Alex'], started='2026-09-17T16:00:00Z')
        self.put('finance', 'Treasury reimbursement approved for 300 DAI. Priya owns the invoice.',
                 participants=['Priya'], started='2026-09-12T16:00:00Z')
        self.put('private', 'Confidential merger budget. Secret codename obsidian.', bucket='private', source='private',
                 participants=['Secret Person'], started='2026-09-18T16:00:00Z')
        self.put('chat', 'Atlas is a fun board game. October weather looks nice.', kind='message', session=None)
        self.put('unicode', 'Zoë: café relaunch approved — 東京 collaboration.', participants=['Zoë'])
        self.put('long', ('Routine check-in with no decisions.\n' * 130) + '\nCritical finding: xenolith migration blocked by DNS.\n')
        self.put('legacy', 'Handbook discussion without a trustworthy session identity.', session=None)
        self.put('other-producer', 'Independent browser conversation.', source='browser-capture', session='launch')
        # A retry must not create an extra search result; a contradictory revision must remain visible.
        (self.inbox / 'launch-copy.json').write_text(json.dumps(self.payloads['launch']))
        revised = copy.deepcopy(self.payloads['launch'])
        revised['content'] = 'Correction: Atlas launch date is undecided; October was only proposed.'
        (self.inbox / 'launch-correction.json').write_text(json.dumps(revised))
        build_catalog(self.root, self.catalog)
        self.reader = CatalogReader(self.catalog, allowed_buckets=frozenset({'meetings'}), source_root=self.root)
        self.all = CatalogReader(self.catalog)
        self.records = self.all.snapshot()[1]

    def put(self, name, content, *, source='discord-voice', kind='meeting_summary', session='auto',
            bucket='meetings', participants=None, started='2026-09-01T16:00:00Z'):
        metadata = {'started_at': started}
        if session is not None:
            metadata['session_id'] = name if session == 'auto' else session
        payload = {'source': source, 'type': kind, 'ts': '2026-09-19T18:00:00Z',
                   'content': content, 'participants': participants or [], 'bucket_hint': bucket,
                   'metadata': metadata, 'url': 'https://example.test/' + name}
        self.payloads[name] = payload
        (self.inbox / (name + '.json')).write_text(json.dumps(payload))

    def record(self, name):
        ref = 'inbox/memory/processed/' + name + '.json'
        return next(r for r in self.records if ref in r['source_refs'])

    def test_latest_meeting_uses_event_date_not_ingestion_date(self):
        self.assertEqual(self.reader.meetings(limit=1)['meetings'][0]['meeting_id'], self.record('latest')['meeting_id'])

    def test_last_week_uses_half_open_event_window(self):
        result = self.reader.meetings(start='2026-09-10T16:00:00Z', end='2026-09-17T16:00:00Z')
        self.assertEqual({m['meeting_id'] for m in result['meetings']},
                         {self.record('launch')['meeting_id'], self.record('finance')['meeting_id']})

    def test_timezone_equivalent_bounds(self):
        a = self.reader.meetings(start='2026-09-10T10:00:00-06:00', end='2026-09-11T00:00:00Z')
        b = self.reader.meetings(start='2026-09-10T16:00:00Z', end='2026-09-11T00:00:00Z')
        self.assertEqual(a, b)

    def test_participant_exact_name_not_substring(self):
        self.assertEqual(self.reader.meetings(participant='May')['total'], 0)
        self.assertEqual(self.reader.meetings(participant='MAYA')['total'], 1)

    def test_summary_transcript_and_correction_share_meeting(self):
        result = self.reader.meeting(self.record('launch')['meeting_id'])
        self.assertEqual(len(result['artifacts']), 3)
        self.assertEqual(result['alternative_artifact_kinds'], ['meeting_summary'])

    def test_identical_session_from_different_producer_is_separate(self):
        self.assertNotEqual(self.record('launch')['meeting_id'], self.record('other-producer')['meeting_id'])

    def test_unknown_session_searchable_but_not_invented_meeting(self):
        self.assertIsNone(self.reader.search('trustworthy')['hits'][0]['meeting_id'])
        self.assertTrue(all(m['meeting_id'] for m in self.reader.meetings()['meetings']))

    def test_summary_filter_excludes_chitchat_and_transcripts(self):
        hits = self.reader.search('Atlas', kind='meeting_summary')['hits']
        self.assertTrue(hits)
        self.assertTrue(all(h['kind'] == 'meeting_summary' for h in hits))

    def test_meeting_filter_excludes_other_conversations(self):
        mid = self.record('launch')['meeting_id']
        hits = self.reader.search('Atlas', meeting_id=mid)['hits']
        self.assertTrue(hits)
        self.assertEqual({h['meeting_id'] for h in hits}, {mid})

    def test_cross_meeting_evidence_keeps_both_dates(self):
        ids = {h['meeting_id'] for h in self.reader.search('accessibility')['hits']}
        self.assertEqual(ids, {self.record('launch')['meeting_id'], self.record('latest')['meeting_id']})

    def test_retry_does_not_duplicate_passage(self):
        self.assertEqual(self.reader.search('budget approved', meeting_id=self.record('launch')['meeting_id'])['total'], 1)

    def test_conflicting_revision_is_not_silently_overwritten(self):
        hits = self.reader.search('Atlas', meeting_id=self.record('launch')['meeting_id'], kind='meeting_summary')['hits']
        self.assertEqual(len({h['revision'] for h in hits}), 2)
        self.assertEqual(len({h['record_id'] for h in hits}), 1)

    def test_late_transcript_passage_retrieves_evidence(self):
        hit = self.reader.search('xenolith')['hits'][0]
        self.assertGreater(hit['start'], 3000)
        result = self.reader.context(generation=self.reader.snapshot()[0], record_id=hit['record_id'],
                                     revision=hit['revision'], passage_id=hit['passage_id'])
        self.assertIn('xenolith migration blocked by DNS', result['text'])

    def test_unicode_citation_offsets_are_characters(self):
        hit = self.reader.search('東京')['hits'][0]
        self.assertEqual(hit['text'], self.record('unicode')['content'][hit['start']:hit['end']])

    def test_punctuation_and_case_do_not_change_rank(self):
        self.assertEqual([h['record_id'] for h in self.reader.search('TREASURY!!!')['hits']],
                         [h['record_id'] for h in self.reader.search('treasury')['hits']])

    def test_absent_topic_does_not_fabricate_evidence(self):
        self.assertEqual(self.reader.search('unicornzeppelin')['total'], 0)

    def test_outside_retained_dates_does_not_claim_history(self):
        result = self.reader.meetings(end='2020-01-01T00:00:00Z')
        self.assertEqual(result['total'], 0)
        self.assertFalse(result['coverage']['complete_history'])

    def test_allowed_source_and_bucket_intersect(self):
        reader = CatalogReader(self.catalog, frozenset({'private'}), allowed_buckets=frozenset({'meetings'}))
        self.assertEqual(reader.meetings()['total'], 0)

    def test_coverage_hides_private_sources_and_dates(self):
        c = self.reader.meetings()['coverage']
        self.assertNotIn('private', c['sources'])
        self.assertTrue(c['observed_end'].startswith('2026-09-17'))

    def test_empty_scope_denies_every_record(self):
        reader = CatalogReader(self.catalog, allowed_buckets=frozenset(), source_root=self.root)
        self.assertEqual(reader.search('Atlas')['total'], 0)
        self.assertEqual(reader.meetings()['coverage']['record_revisions'], 0)

    def test_cross_scope_meeting_is_not_found(self):
        with self.assertRaises(RetrievalError) as error:
            self.reader.meeting(self.record('private')['meeting_id'])
        self.assertEqual(error.exception.status, 404)

    def test_cross_scope_citation_is_not_found(self):
        result = self.all.search('obsidian'); hit = result['hits'][0]
        with self.assertRaises(RetrievalError) as error:
            self.reader.context(generation=result['generation'], **{k:hit[k] for k in ('record_id','revision','passage_id')})
        self.assertEqual(error.exception.status, 404)

    def test_source_deny_takes_effect_without_rebuild(self):
        self.policy.write_text(json.dumps({'denied_record_ids': [], 'denied_sources': ['discord-voice']}))
        self.assertEqual(self.reader.search('Atlas')['total'], 0)

    def test_record_deny_removes_all_conflicting_revisions(self):
        self.policy.write_text(json.dumps({'denied_record_ids': [self.record('launch')['record_id']], 'denied_sources': []}))
        self.assertEqual(self.reader.search('Atlas', kind='meeting_summary', meeting_id=self.record('launch')['meeting_id'])['total'], 0)

    def test_removed_original_disappears_before_refresh(self):
        (self.inbox / 'latest.json').unlink()
        self.assertEqual(self.reader.search('release notes')['total'], 0)

    def test_changed_original_disappears_before_refresh(self):
        p = self.payloads['latest']; p['content'] = 'Retracted'
        (self.inbox / 'latest.json').write_text(json.dumps(p))
        self.assertEqual(self.reader.search('release notes')['total'], 0)

    def test_duplicate_retained_copy_keeps_evidence_available(self):
        (self.inbox / 'launch.json').unlink()
        self.assertEqual(self.reader.search('budget')['total'], 1)

    def test_malformed_visibility_fails_closed(self):
        self.policy.write_text('{broken')
        with self.assertRaises(RetrievalError) as error:
            self.reader.search('Atlas')
        self.assertEqual(error.exception.status, 503)

    def test_wrong_visibility_types_fail_closed(self):
        self.policy.write_text(json.dumps({'denied_record_ids': 'all', 'denied_sources': []}))
        with self.assertRaises(RetrievalError): self.reader.meetings()

    def test_symlink_original_cannot_restore_visibility(self):
        p = self.inbox / 'latest.json'; saved = self.root / 'elsewhere.json'
        p.rename(saved); p.symlink_to(saved)
        self.assertEqual(self.reader.search('release notes')['total'], 0)

    def test_missing_revision_fails_instead_of_using_newest(self):
        hit = self.reader.search('Treasury')['hits'][0]
        with self.assertRaises(RetrievalError) as error:
            self.reader.context(generation=self.reader.snapshot()[0], record_id=hit['record_id'], revision='0'*64, passage_id='0')
        self.assertEqual(error.exception.status, 404)

    def test_nonexistent_passage_rejected(self):
        hit = self.reader.search('Treasury')['hits'][0]
        with self.assertRaises(RetrievalError):
            self.reader.context(generation=self.reader.snapshot()[0], record_id=hit['record_id'], revision=hit['revision'], passage_id='999999')

    def scoped_client(self):
        import os
        from unittest.mock import patch
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from community_memory_api.scoped_retrieval import scoped_retrieval_router
        patcher = patch.dict(os.environ, {'PRISM_RETRIEVAL_SERVICE_KEY':'eval-secret',
                                         'PRISM_SHADOW_SOURCE_ROOT':str(self.root)})
        patcher.start(); self.addCleanup(patcher.stop)
        app = FastAPI(); app.include_router(scoped_retrieval_router(self.catalog))
        return TestClient(app)

    def call(self, client, operation='search', arguments=None, scope=None, headers=None):
        return client.post('/retrieval/scoped',
            headers={'X-Prism-Retrieval-Key':'eval-secret'} if headers is None else headers,
            json={'operation':operation, 'arguments':arguments or {},
                  'scope':{'buckets':['meetings']} if scope is None else scope})

    def test_http_all_operations_require_dedicated_key(self):
        client = self.scoped_client()
        for operation in ('search','context','meeting','meetings','coverage'):
            with self.subTest(operation=operation):
                self.assertEqual(self.call(client,operation,headers={}).status_code,401)
                self.assertEqual(self.call(client,operation,headers={'X-Prism-Api-Key':'eval-secret'}).status_code,401)

    def test_http_missing_service_key_fails_closed(self):
        import os
        client = self.scoped_client(); os.environ['PRISM_RETRIEVAL_SERVICE_KEY']=''
        self.assertEqual(self.call(client,'coverage').status_code,503)

    def test_http_missing_authority_root_fails_closed(self):
        import os
        client = self.scoped_client(); os.environ['PRISM_SHADOW_SOURCE_ROOT']=''
        self.assertEqual(self.call(client,'coverage').status_code,503)

    def test_http_scope_cannot_be_overridden_in_arguments(self):
        client = self.scoped_client()
        for extra in ({'buckets':['private']},{'allowed_sources':['private']},{'source_root':'/tmp'}, {'limit':101}):
            with self.subTest(extra=extra):
                self.assertEqual(self.call(client,arguments={'query':'obsidian',**extra}).status_code,422)

    def test_http_unknown_scope_fields_rejected(self):
        client = self.scoped_client()
        self.assertEqual(self.call(client,'coverage',scope={'buckets':[], 'allow_all':True}).status_code,422)

    def test_http_empty_scope_does_not_default_to_all(self):
        client = self.scoped_client()
        self.assertEqual(self.call(client,arguments={'query':'Atlas'},scope={'buckets':[]}).json()['total'],0)

    def test_http_knowledge_selector_does_not_grant_memory(self):
        client = self.scoped_client()
        result = self.call(client,arguments={'query':'Atlas'},scope={'buckets':[], 'knowledge_source_ids':['handbook']}).json()
        self.assertEqual(result['total'],0)
        self.assertFalse(result['knowledge_supported'])

    def test_http_results_remove_unscoped_links_paths_metadata(self):
        client = self.scoped_client()
        search = self.call(client,arguments={'query':'Treasury'}).json()
        hit = search['hits'][0]
        requests = [('search',{'query':'Treasury'}), ('meetings',{}), ('meeting',{'meeting_id':hit['meeting_id']}),
                    ('context',{'generation':search['generation'],**{k:hit[k] for k in ('record_id','revision','passage_id')}})]
        def inspect(value):
            if isinstance(value,dict):
                self.assertFalse({'source_refs','source_url','metadata'} & value.keys())
                for child in value.values(): inspect(child)
            if isinstance(value,list):
                for child in value: inspect(child)
        for operation, arguments in requests:
            with self.subTest(operation=operation):
                response=self.call(client,operation,arguments)
                self.assertEqual(response.status_code,200); inspect(response.json())

    def test_http_visibility_revocation_invalidates_existing_citation(self):
        client=self.scoped_client(); result=self.call(client,arguments={'query':'Treasury'}).json(); hit=result['hits'][0]
        self.policy.write_text(json.dumps({'denied_record_ids':[hit['record_id']], 'denied_sources':[]}))
        args={'generation':result['generation'],**{k:hit[k] for k in ('record_id','revision','passage_id')}}
        self.assertEqual(self.call(client,'context',args).status_code,404)
        self.assertEqual(self.call(client,'meeting',{'meeting_id':hit['meeting_id']}).status_code,404)
        self.assertEqual(self.call(client,arguments={'query':'Treasury'}).json()['total'],0)

    def test_http_invalid_dates_and_reversed_ranges(self):
        client=self.scoped_client()
        for filters in ({'start':'yesterday'}, {'start':'2026-09-18T00:00:00Z','end':'2026-09-01T00:00:00Z'}):
            with self.subTest(filters=filters):
                self.assertEqual(self.call(client,'meetings',filters).status_code,400)

    def test_http_stale_generation_returns_conflict(self):
        client=self.scoped_client(); result=self.call(client,arguments={'query':'Treasury'}).json(); hit=result['hits'][0]
        self.put('new','New material'); build_catalog(self.root,self.catalog)
        args={'generation':result['generation'],**{k:hit[k] for k in ('record_id','revision','passage_id')}}
        self.assertEqual(self.call(client,'context',args).status_code,409)

    def suite(self):
        return {'name':'fixture', 'cases':[{'id':'invoice-owner', 'question':'Who owns the treasury invoice?',
            'query':'Treasury invoice', 'relevant':[{'record_id':self.record('finance')['record_id'], 'evidence':'Priya owns the invoice.'}]}]}

    def test_evaluator_known_positive_and_citation_metrics(self):
        report = evaluate(self.reader, self.suite())
        self.assertEqual(report['summary']['mean_known_positive_recall_at_k'], 1)
        self.assertEqual(report['summary']['mean_evidence_recall_at_k'], 1)
        self.assertEqual(report['summary']['mrr_at_k'], 1)
        self.assertEqual(report['summary']['citation_errors'], 0)

    def test_evaluator_miss_is_recorded_not_hidden(self):
        suite = self.suite(); suite['cases'][0]['query'] = 'unicornzeppelin'
        self.assertEqual(evaluate(self.reader, suite)['summary']['mean_known_positive_recall_at_k'], 0)

    def test_evaluator_refuses_missing_evidence(self):
        suite = self.suite(); suite['cases'][0]['relevant'][0]['evidence'] = 'Invented decision'
        with self.assertRaises(ValueError): evaluate(self.reader, suite)

    def test_evaluator_refuses_different_generation(self):
        suite = self.suite(); suite['generation'] = '0'*64
        with self.assertRaises(ValueError): evaluate(self.reader, suite)

    def test_evaluator_refuses_duplicate_case_ids(self):
        suite = self.suite(); suite['cases'] *= 2
        with self.assertRaises(ValueError): evaluate(self.reader, suite)

    def test_evaluator_measures_empty_result_contract(self):
        suite = {'name':'negative', 'cases':[{'id':'absent','question':'Any unicornzeppelin?',
                 'query':'unicornzeppelin','relevant':[], 'expect_empty':True}]}
        self.assertEqual(evaluate(self.reader,suite)['summary']['empty_check_failures'],0)
        suite['cases'][0]['query']='Atlas'
        self.assertEqual(evaluate(self.reader,suite)['summary']['empty_check_failures'],1)

    def test_evaluator_rejects_unlabeled_cases(self):
        suite = self.suite(); suite['cases'][0]['relevant'] = []
        with self.assertRaises(ValueError): evaluate(self.reader,suite)


if __name__ == '__main__':
    unittest.main()

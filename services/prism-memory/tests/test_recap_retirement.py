import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch, Mock

from community_memory.activity import ActivityLogger
from community_memory.memory import RollingMemoryBuilder
from community_memory.pipeline import run_memory


class RecapRetirementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.day = date(2026, 9, 18)
        self.state = self.root / 'state/current/throughlines.json'
        self.state.parent.mkdir(parents=True)
        self.state.write_text(json.dumps({'throughlines': [{'throughline_key': 'obsolete',
            'title': 'Obsolete generated registry', 'status': 'active'}]}))
        self.digest = self.root / 'buckets/meetings/digests/2026-09-18.json'
        self.digest.parent.mkdir(parents=True)
        self.digest.write_text(json.dumps({'highlights': ['Release approved'],
            'action_items': ['Alex will ship'], 'decisions': ['Keep the handbook']}))
        self.builder = RollingMemoryBuilder(self.root, ActivityLogger(self.root / 'activity/activity.jsonl'))

    def test_normal_memory_phase_never_calls_legacy_builders(self):
        with patch('community_memory.pipeline.run_state', side_effect=AssertionError('legacy state called')):
            run_memory({'memory': self.builder}, self.day)
        payload = json.loads((self.root / 'memory/rolling/latest.json').read_text())
        self.assertEqual(payload['current_throughlines'], [])
        self.assertEqual(payload['recap_schema_version'], 2)
        self.assertIn('Alex will ship', str(payload['sections']))
        self.assertNotIn('Obsolete generated registry', str(payload))
        self.assertNotIn('Throughlines', (self.root / 'memory/rolling/latest.md').read_text())
        self.assertIn('Obsolete generated registry', self.state.read_text())

    def test_state_only_cannot_create_recap(self):
        self.digest.unlink()
        self.assertIsNone(self.builder.run(self.day))
        self.assertFalse((self.root / 'memory/rolling/latest.json').exists())

    def test_old_recap_is_rebuilt_once_without_force(self):
        self.builder.run(self.day)
        output = self.root / 'memory/rolling/2026-09-18.json'
        old = json.loads(output.read_text()); old.pop('recap_schema_version')
        old['current_throughlines'] = [{'title': 'Obsolete generated registry'}]
        output.write_text(json.dumps(old))
        self.assertIsNotNone(self.builder.run(self.day))
        self.assertEqual(json.loads(output.read_text())['current_throughlines'], [])
        # A legacy state edit must not invalidate a current recap.
        os.utime(self.state, (2000000000, 2000000000))
        self.assertIsNone(self.builder.run(self.day))

    def test_missing_objective_config_is_disabled(self):
        from community_memory.objective_state import ObjectiveStateBuilder
        builder = ObjectiveStateBuilder(base_path=self.root, activity=Mock(), config=Mock(state={}))
        self.assertIsNone(builder.run(self.day))

    def test_compatibility_reads_preserve_historical_date_and_data(self):
        from community_memory_api.storage import FilesystemStorageBackend
        payload = {'as_of_date': '2026-09-01', 'generated_at': '2026-09-02T00:00:00Z',
                   'objectives': [{'objective_key': 'old', 'status': 'active'}]}
        (self.state.parent / 'objectives.json').write_text(json.dumps(payload))
        result = FilesystemStorageBackend(self.root).state_objectives()
        self.assertEqual(result['registry_mode'], 'legacy-compatibility')
        self.assertEqual(result['registry_as_of'], '2026-09-01')
        self.assertEqual(result['objectives'], payload['objectives'])

    def test_enrichment_requires_its_own_explicit_opt_in(self):
        from community_memory.objective_state import ObjectiveStateBuilder
        builder = ObjectiveStateBuilder(base_path=self.root, activity=Mock(),
            config=Mock(agentic_ingest=Mock(enabled=True)))
        for enrichment, expected_calls in [(None, 0), ({}, 0), ({'enabled': False}, 0),
                                           ({'enabled': True}, 1)]:
            with self.subTest(enrichment=enrichment):
                conf = {'enabled': True}
                if enrichment is not None:
                    conf['enrichment'] = enrichment
                objectives = [{'objective_key': 'explicit-work'}]
                with patch.object(builder, '_objective_needs_enrichment', return_value=True), \
                     patch.object(builder, '_signals_for_objective', return_value=[{'kind': 'decision'}]), \
                     patch.object(builder, '_call_objective_enricher', return_value={}) as provider:
                    count = builder._enrich_objectives(objectives=objectives, signals=[], objectives_conf=conf)
                self.assertEqual(provider.call_count, expected_calls)
                self.assertEqual(count, expected_calls)
                self.assertEqual(objectives[0]['enrichment_status'], 'fresh' if expected_calls else 'disabled')

    def test_aggregate_registry_date_is_evidence_window_not_write_time(self):
        from community_memory_api.storage import FilesystemStorageBackend
        for extra, expected in [
            ({'state_index': {'window_end': '2026-09-01'}}, '2026-09-01'),
            ({'as_of_date': '2026-08-31', 'state_index': {'window_end': '2026-09-01'}}, '2026-08-31'),
            ({}, None), ({'state_index': None}, None), ({'state_index': {}}, None),
        ]:
            with self.subTest(extra=extra):
                payload = {'generated_at': '2026-09-18T00:00:00Z', **extra}
                (self.root / 'state/latest.json').write_text(json.dumps(payload))
                result = FilesystemStorageBackend(self.root).state_latest()
                self.assertEqual(result['registry_as_of'], expected)
                self.assertEqual(result['generated_at'], payload['generated_at'])

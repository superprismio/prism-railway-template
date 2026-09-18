import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from community_memory.catalog import build_catalog
from community_memory.catalog_refresh import refresh


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)/'source';self.inbox=self.root/'inbox/memory/processed'
        self.inbox.mkdir(parents=True);self.output=Path(self.tmp.name)/'catalog'
        self.put('a','Original')

    def put(self,name,content):
        (self.inbox/(name+'.json')).write_text(json.dumps({'source':'discord-voice','type':'meeting_summary',
            'ts':'2026-09-18T10:00:00Z','content':content,'metadata':{'session_id':name}}))

    def test_add_edit_delete_and_unchanged(self):
        first=refresh(self.root,self.output)
        self.assertEqual(first['status'],'updated')
        self.assertEqual(refresh(self.root,self.output)['status'],'unchanged')
        self.put('b','New meeting')
        added=refresh(self.root,self.output);self.assertEqual(added['records'],2)
        self.put('a','Corrected')
        edited=refresh(self.root,self.output);self.assertNotEqual(edited['generation'],added['generation'])
        (self.inbox/'b.json').unlink()
        deleted=refresh(self.root,self.output);self.assertEqual(deleted['records'],1)
        self.assertEqual(refresh(self.root,self.output)['status'],'unchanged')

    def test_bad_file_preserves_good_pointer_and_retries_after_repair(self):
        first=refresh(self.root,self.output)
        (self.inbox/'b.json').write_text('partial write')
        failed=refresh(self.root,self.output)
        self.assertEqual(failed['status'],'error')
        self.assertEqual(json.loads((self.output/'current.json').read_text())['generation'],first['generation'])
        self.put('b','Recovered')
        self.assertEqual(refresh(self.root,self.output)['records'],2)

    def test_missing_source_does_not_publish_empty_catalog(self):
        first=refresh(self.root,self.output)
        self.inbox.rename(self.root/'temporarily-unavailable')
        self.assertEqual(refresh(self.root,self.output)['status'],'error')
        self.assertEqual(json.loads((self.output/'current.json').read_text())['generation'],first['generation'])

    def test_source_mutation_before_publication_is_rejected(self):
        first=refresh(self.root,self.output)
        self.put('b','Second')
        with patch('community_memory.catalog.input_hashes',return_value={'changed':'concurrently'}):
            result=build_catalog(self.root,self.output)
        self.assertFalse(result['published'])
        self.assertEqual(json.loads((self.output/'current.json').read_text())['generation'],first['generation'])

    def test_missing_pointer_recovers_after_restart(self):
        first=refresh(self.root,self.output)
        (self.output/'current.json').unlink()
        recovered=refresh(self.root,self.output)
        self.assertEqual(recovered['generation'],first['generation'])
        self.assertEqual(recovered['status'],'updated')

    def test_api_lifecycle_refreshes_without_changing_sources(self):
        import os
        import time
        from fastapi.testclient import TestClient
        from community_memory_api.app import Settings, create_app
        source_before=(self.inbox/'a.json').read_bytes()
        settings=Settings(base_dir=self.root,data_root_override=self.root,ops_api_key='ops-only',read_api_key='read-only')
        with patch.dict(os.environ,{'PRISM_SHADOW_CATALOG_ROOT':str(self.output),'PRISM_SHADOW_REFRESH_SECONDS':'30'}):
            with TestClient(create_app(settings)) as client:
                deadline=time.monotonic()+5
                while time.monotonic()<deadline and not (self.output/'refresh-status.json').exists():
                    time.sleep(.02)
                response=client.get('/ops/retrieval/status',headers={'X-Prism-Api-Key':'ops-only'})
                self.assertEqual(response.status_code,200)
                self.assertEqual(response.json()['status'],'updated')
                self.assertTrue(response.json()['automatic_refresh_enabled'])
                self.assertEqual(client.get('/ops/retrieval/status',headers={'X-Prism-Api-Key':'read-only'}).status_code,401)
        self.assertEqual((self.inbox/'a.json').read_bytes(),source_before)

    def test_task_refresh_endpoint_is_ops_only_and_idempotent(self):
        import os
        from fastapi.testclient import TestClient
        from community_memory_api.app import Settings, create_app
        settings=Settings(base_dir=self.root,data_root_override=self.root,ops_api_key='ops-only',read_api_key='read-only')
        with patch.dict(os.environ,{'PRISM_SHADOW_CATALOG_ROOT':'','PRISM_SHADOW_REFRESH_SECONDS':'0'}):
            client=TestClient(create_app(settings))
            self.assertEqual(client.post('/ops/retrieval/refresh').status_code,401)
            self.assertEqual(client.post('/ops/retrieval/refresh',headers={'X-Prism-Api-Key':'read-only'}).status_code,401)
            headers={'X-Prism-Api-Key':'ops-only'}
            first=client.post('/ops/retrieval/refresh',headers=headers)
            self.assertEqual(first.status_code,200)
            self.assertEqual(first.json()['status'],'updated')
            self.assertEqual(client.post('/ops/retrieval/refresh',headers=headers).json()['status'],'unchanged')
            self.assertEqual(client.get('/ops/retrieval/status',headers=headers).json()['status'],'unchanged')
            (self.inbox/'bad.json').write_text('incomplete')
            self.assertEqual(client.post('/ops/retrieval/refresh',headers=headers).status_code,503)
        with patch.dict(os.environ,{'PRISM_SHADOW_REFRESH_SECONDS':'30'}):
            client=TestClient(create_app(settings))
            self.assertEqual(client.post('/ops/retrieval/refresh',headers={'X-Prism-Api-Key':'ops-only'}).status_code,409)

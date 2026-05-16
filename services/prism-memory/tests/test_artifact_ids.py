from __future__ import annotations

import json
import importlib.util
import tempfile
import unittest
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
STORAGE_MODULE_PATH = SERVICE_ROOT / "prism_seed" / "default" / "code" / "community_memory_api" / "storage.py"
STORAGE_SPEC = importlib.util.spec_from_file_location("community_memory_api_storage", STORAGE_MODULE_PATH)
if STORAGE_SPEC is None or STORAGE_SPEC.loader is None:
    raise RuntimeError("Unable to load Prism Memory storage module")
storage_module = importlib.util.module_from_spec(STORAGE_SPEC)
STORAGE_SPEC.loader.exec_module(storage_module)

FilesystemStorageBackend = storage_module.FilesystemStorageBackend


class ArtifactIdTests(unittest.TestCase):
    def test_discord_message_with_unsafe_filename_can_be_reopened(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            inbox = root / "inbox" / "memory" / "processed"
            inbox.mkdir(parents=True)
            artifact_path = inbox / "discord:message#123.json"
            artifact_path.write_text(
                json.dumps(
                    {
                        "source": "discord",
                        "type": "discord_message",
                        "ts": "2026-05-16T12:00:00Z",
                        "content": "A Discord message worth reading.",
                    }
                ),
                encoding="utf-8",
            )

            storage = FilesystemStorageBackend(root)
            listed = storage.list_artifacts(artifact_type="discord_message")["artifacts"]

            self.assertEqual(len(listed), 1)
            self.assertNotEqual(listed[0]["id"], artifact_path.stem)
            self.assertTrue(listed[0]["id"].startswith("memory--b64--"))
            self.assertEqual(storage.artifact_detail(listed[0]["id"])["content"], "A Discord message worth reading.")
            self.assertEqual(storage.artifact_detail(artifact_path.stem)["content"], "A Discord message worth reading.")


if __name__ == "__main__":
    unittest.main()

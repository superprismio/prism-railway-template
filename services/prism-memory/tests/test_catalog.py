import json
import tempfile
import unittest
from pathlib import Path

from community_memory.catalog import build_catalog, normalize


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "source"
        self.inbox = self.root / "inbox/memory/processed"
        self.inbox.mkdir(parents=True)
        self.output = Path(self.temp.name) / "shadow"

    def payload(self, **changes):
        return {"source": "discord-voice", "type": "meeting_summary",
                "content": "# Summary\nWe agreed to ship.",
                "ts": "2026-09-18T10:00:00-06:00", "participants": ["Alex"],
                "metadata": {"session_id": "session-a", "tags": ["release"],
                             "action_items": [{"assignedTo": "Alex", "description": "Ship"}]}, **changes}

    def write(self, name, payload):
        (self.inbox / name).write_text(json.dumps(payload))

    def files(self, report, folder):
        return [json.loads(p.read_text()) for p in (self.output / "generations" / report["generation"] / folder).glob("*.json")]

    def test_retry_dedup_and_repeat_rebuild_preserve_sources(self):
        self.write("a.json", self.payload(url="/artifacts/a"))
        self.write("b.json", self.payload(url="/artifacts/b"))
        before = {p.name: p.read_bytes() for p in self.inbox.iterdir()}
        first = build_catalog(self.root, self.output)
        self.assertEqual(first["records"], 1)
        self.assertEqual(first["duplicate_files"], 1)
        self.assertEqual(first, build_catalog(self.root, self.output))
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.inbox.iterdir()})
        record = self.files(first, "records")[0]
        self.assertEqual(record["occurred_at"], "2026-09-18T16:00:00Z")
        self.assertEqual(record["metadata"]["action_items"][0]["assignedTo"], "Alex")
        self.assertEqual(len(record["source_refs"]), 2)

    def test_transcript_summary_group_and_revision_conflict(self):
        self.write("summary.json", self.payload())
        self.write("transcript.json", self.payload(type="meeting_transcript", content="Alex: I'll ship."))
        self.write("revised.json", self.payload(content="Correction: shipment postponed."))
        report = build_catalog(self.root, self.output)
        self.assertEqual((report["meetings"], report["records"], report["revisions"]), (1, 2, 3))
        meeting = self.files(report, "meetings")[0]
        self.assertEqual(meeting["completeness"], "complete")
        self.assertEqual(len(meeting["revision_conflicts"]), 1)
        self.assertEqual(len(self.files(report, "relationships")), 3)

    def test_same_text_different_message_ids_never_merge(self):
        for n in (1, 2):
            self.write(f"{n}.json", self.payload(source="discord", type="message", metadata={},
                                               url=f"https://discord.com/channels/10/20/{n}"))
        report = build_catalog(self.root, self.output)
        self.assertEqual(report["records"], 2)
        self.assertEqual(report["legacy_records"], 0)

    def test_unknown_legacy_identity_not_guessed(self):
        for n in (1, 2):
            self.write(f"{n}.json", self.payload(metadata={}))
        report = build_catalog(self.root, self.output)
        self.assertEqual(report["legacy_records"], 2)
        self.assertEqual(report["meetings"], 0)

    def test_bad_record_does_not_replace_good_generation(self):
        self.write("a.json", self.payload())
        build_catalog(self.root, self.output)
        before = (self.output / "current.json").read_bytes()
        self.write("bad.json", self.payload(ts="2026-09-18T10:00:00"))
        report = build_catalog(self.root, self.output)
        self.assertFalse(report["published"])
        self.assertEqual(len(report["errors"]), 1)
        self.assertEqual(before, (self.output / "current.json").read_bytes())

    def test_namespace_isolation(self):
        a = normalize(self.payload(), "a.json")
        b = normalize(self.payload(source="portal"), "b.json")
        self.assertNotEqual(a["meeting_id"], b["meeting_id"])

    def test_legacy_recording_url_joins_structured_summary(self):
        session = "11111111-1111-4111-8111-111111111111"
        transcript = normalize(self.payload(type="meeting_transcript", metadata={},
            url=f"https://adapter.example/recordings/{session}"), "t.json")
        summary = normalize(self.payload(metadata={"session_id": session}), "s.json")
        self.assertEqual(transcript["meeting_id"], summary["meeting_id"])
        self.assertEqual(transcript["meeting_identity_method"], "recording_url")

    def test_workflow_summary_links_without_collapsing_producers(self):
        self.write("direct.json", self.payload(metadata={"session_id": "session-a"}))
        self.write("workflow.json", self.payload(source="recording-transcript-workflow",
            metadata={"source_system": "discord-native", "source_id": "session-a"}))
        report = build_catalog(self.root, self.output)
        self.assertEqual(report["records"], 2)
        self.assertEqual(report["meetings"], 1)
        self.assertEqual(report["meetings_with_alternatives"], 1)

    def test_upload_artifact_id_is_not_a_session_id(self):
        record = normalize(self.payload(source="manual-meeting-transcript-upload",
            metadata={"source_system": "manual-upload", "source_id": "artifact-a"}), "a.json")
        self.assertIsNone(record["meeting_id"])
        self.assertEqual(record["identity_quality"], "source")

    def test_conflicting_session_url_is_rejected(self):
        with self.assertRaises(ValueError):
            normalize(self.payload(url="https://adapter.example/recordings/11111111-1111-4111-8111-111111111111"), "a.json")

    def test_unsupported_and_symlink_inputs_are_visible(self):
        (self.inbox / "old.md").write_text("legacy")
        self.assertEqual(len(build_catalog(self.root, self.output)["unsupported_files"]), 1)
        target = self.root / "outside.json"
        target.write_text(json.dumps(self.payload()))
        (self.inbox / "link.json").symlink_to(target)
        self.assertFalse(build_catalog(self.root, self.output)["published"])

    def test_output_cannot_replace_source_root(self):
        with self.assertRaises(ValueError):
            build_catalog(self.root, self.root)


if __name__ == "__main__":
    unittest.main()

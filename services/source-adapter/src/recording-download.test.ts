import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DiscordVoiceManager } from "./voice.js";

test("recording downloads allow only a session transcript and FLAC chunks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-recording-download-"));
  const sessionId = "64702ca2-a6ba-448d-b9c4-b924cbeae222";
  const transcriptPath = path.join(root, sessionId, "transcript", "transcript.md");
  const flacPath = path.join(root, sessionId, "flac", "123-speaker-chunk_001.flac");
  try {
    await mkdir(path.dirname(transcriptPath), { recursive: true });
    await mkdir(path.dirname(flacPath), { recursive: true });
    await writeFile(transcriptPath, "# Transcript");
    await writeFile(flacPath, "FLAC");
    const manager = Object.create(DiscordVoiceManager.prototype) as DiscordVoiceManager;
    (manager as unknown as { recordingsRoot: string }).recordingsRoot = root;

    assert.deepEqual(await manager.resolveRecordingDownload(sessionId, "transcript.md"), {
      filePath: transcriptPath,
      contentType: "text/markdown; charset=utf-8",
    });
    assert.deepEqual(await manager.resolveRecordingDownload(sessionId, "123-speaker-chunk_001.flac"), {
      filePath: flacPath,
      contentType: "audio/flac",
    });
    assert.equal(await manager.resolveRecordingDownload("../other", "transcript.md"), null);
    assert.equal(await manager.resolveRecordingDownload(sessionId, "../transcript.md"), null);
    assert.equal(await manager.resolveRecordingDownload(sessionId, "transcript.json"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

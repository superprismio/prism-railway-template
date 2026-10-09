import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { journalTelegramUpdate, recoverPendingTelegramUpdates, telegramUpdateRecordPath } from "./telegram-update-journal.js";
import { processTelegramUpdateBatch } from "./telegram-update-processing.js";

test("restart after pending write quarantines without replay and continues to later updates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-journal-"));
  try {
    const processed: number[] = [];
    const journal = (entry: Record<string, unknown>) => journalTelegramUpdate(root, entry as { updateId: number; status: "pending" | "completed" | "failed" });
    await assert.rejects(processTelegramUpdateBatch([{ update_id: 10 }], 10, {
      journal,
      checkpoint: async () => { throw new Error("crash before checkpoint"); },
      process: async (update) => { processed.push(update.update_id); return true; },
      onFailure: () => {},
    }), /crash before checkpoint/);
    const recovered: number[] = [];
    const checkpoints: number[] = [];
    await processTelegramUpdateBatch([{ update_id: 10 }, { update_id: 11 }], 10, {
      journal,
      checkpoint: async (offset) => { checkpoints.push(offset); },
      process: async (update) => { processed.push(update.update_id); return true; },
      onFailure: () => {},
      onRecovered: (id) => recovered.push(id),
    });
    assert.deepEqual(processed, [11]);
    assert.deepEqual(recovered, [10]);
    assert.deepEqual(checkpoints, [11, 12]);
    assert.ok((await fs.readFile(telegramUpdateRecordPath(root, 10, "failed"), "utf8")).includes('"update_id":10'));
    await assert.rejects(fs.access(telegramUpdateRecordPath(root, 11, "pending")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("pre-poll recovery quarantines an orphan pending after a successful checkpoint", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-journal-"));
  try {
    await journalTelegramUpdate(root, { updateId: 30, status: "pending", update: { update_id: 30 } });
    // Simulate a process exit after saving offset 31 but before processing update 30.
    const recovered: number[] = [];
    const checkpoints: number[] = [];
    const offset = await recoverPendingTelegramUpdates(root, 31, async (value) => { checkpoints.push(value); }, (id) => recovered.push(id));
    assert.equal(offset, 31);
    assert.deepEqual(checkpoints, []);
    assert.deepEqual(recovered, [30]);
    await assert.rejects(fs.access(telegramUpdateRecordPath(root, 30, "pending")));
    assert.ok((await fs.readFile(telegramUpdateRecordPath(root, 30, "failed"), "utf8")).includes('"update_id":30'));

    const processed: number[] = [];
    await processTelegramUpdateBatch([{ update_id: 30 }, { update_id: 31 }], offset, {
      journal: (entry) => journalTelegramUpdate(root, entry as { updateId: number; status: "pending" | "completed" | "failed" }),
      checkpoint: async () => {},
      process: async (update) => { processed.push(update.update_id); return true; },
      onFailure: () => {},
    });
    assert.deepEqual(processed, [31]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("pre-poll recovery checkpoints a pending ID before moving it to failed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-journal-"));
  try {
    await journalTelegramUpdate(root, { updateId: 40, status: "pending", update: { update_id: 40 } });
    const events: string[] = [];
    const offset = await recoverPendingTelegramUpdates(root, 40, async (value) => { events.push(`offset:${value}`); }, (id) => events.push(`recovered:${id}`));
    assert.equal(offset, 41);
    assert.deepEqual(events, ["offset:41", "recovered:40"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("existing journal directories are tightened to owner-only", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-journal-"));
  try {
    const journalRoot = path.join(root, "telegram-updates");
    const pendingDir = path.join(journalRoot, "pending");
    const failedDir = path.join(journalRoot, "failed");
    await fs.mkdir(pendingDir, { recursive: true, mode: 0o755 });
    await fs.mkdir(failedDir, { mode: 0o755 });
    await fs.chmod(journalRoot, 0o755);
    await fs.chmod(pendingDir, 0o755);
    await fs.chmod(failedDir, 0o755);
    await journalTelegramUpdate(root, { updateId: 1, status: "pending", update: { update_id: 1 } });
    for (const directory of [journalRoot, pendingDir, failedDir]) {
      assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    }
    await journalTelegramUpdate(root, { updateId: 1, status: "failed" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("journal rejects unsafe update IDs", async () => {
  assert.throws(() => telegramUpdateRecordPath("/tmp", NaN, "pending"), /invalid Telegram update ID/);
  assert.throws(() => telegramUpdateRecordPath("/tmp", -1, "pending"), /invalid Telegram update ID/);
});

test("journal rejects a symlinked journal root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-journal-"));
  const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-journal-target-"));
  try {
    await fs.symlink(elsewhere, path.join(root, "telegram-updates"));
    await assert.rejects(journalTelegramUpdate(root, { updateId: 1, status: "pending", update: { update_id: 1 } }), /unsafe Telegram journal directory/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(elsewhere, { recursive: true, force: true });
  }
});

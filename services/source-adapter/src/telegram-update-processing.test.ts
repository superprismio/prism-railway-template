import assert from "node:assert/strict";
import test from "node:test";
import { processTelegramUpdateBatch } from "./telegram-update-processing.js";

test("each update is journaled and checkpointed before side effects; failed updates do not block later ones", async () => {
  const events: string[] = [];
  const failures: number[] = [];
  const count = await processTelegramUpdateBatch([{ update_id: 10 }, { update_id: 11 }], 10, {
    journal: async (entry) => { events.push(`${entry.status}:${entry.updateId}`); },
    checkpoint: async (offset) => { events.push(`offset:${offset}`); },
    process: async (update) => {
      events.push(`process:${update.update_id}`);
      if (update.update_id === 10) throw new Error("delivery failed");
      return true;
    },
    onFailure: (id) => failures.push(id),
  });
  assert.equal(count, 1);
  assert.deepEqual(failures, [10]);
  assert.deepEqual(events, ["pending:10", "offset:11", "process:10", "failed:10", "pending:11", "offset:12", "process:11", "completed:11"]);
});

test("a failed checkpoint prevents side effects and leaves a pending recovery record", async () => {
  const events: string[] = [];
  await assert.rejects(processTelegramUpdateBatch([{ update_id: 20 }], null, {
    journal: async (entry) => { events.push(String(entry.status)); },
    checkpoint: async () => { throw new Error("disk full"); },
    process: async () => { events.push("processed"); return true; },
    onFailure: () => {},
  }), /disk full/);
  assert.deepEqual(events, ["pending"]);
});

test("a checkpointed update is skipped on the next poll", async () => {
  const processed: number[] = [];
  const count = await processTelegramUpdateBatch([{ update_id: 20 }], 21, {
    journal: async () => { throw new Error("should not journal an old update"); },
    checkpoint: async () => { throw new Error("should not move offset backwards"); },
    process: async (update) => { processed.push(update.update_id); return true; },
    onFailure: () => {},
  });
  assert.equal(count, 0);
  assert.deepEqual(processed, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createPromptQueue } from "./prompt-queue.js";

test("a rejected prompt reaches its caller and does not poison the per-chat queue", async () => {
  const enqueue = createPromptQueue();
  const order: string[] = [];
  const first = enqueue("chat", async () => { order.push("first"); throw new Error("failed"); });
  const second = enqueue("chat", async () => { order.push("second"); });
  await assert.rejects(first, /failed/);
  await second;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first", "second"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { SiteRuntimeRequestError } from "./site-runtime.js";
import { boundedTelegramHistory, invokeTelegramWithContextRecovery } from "./telegram-context-recovery.js";

test("Telegram overflow clears continuation before retrying the same invocation once", async () => {
  const events: string[] = [];
  const result = await invokeTelegramWithContextRecovery({
    continuationId: "old-thread",
    invoke: async (continuationId) => {
      events.push(`invoke:${continuationId}`);
      if (continuationId) throw new SiteRuntimeRequestError(502, "context_length_exceeded", "overflow");
      return "new-thread-answer";
    },
    resetContinuation: async () => { events.push("reset"); },
  });
  assert.deepEqual(events, ["invoke:old-thread", "reset", "invoke:null"]);
  assert.deepEqual(result, { result: "new-thread-answer", reset: true });
});

test("Telegram context recovery does not retry generic errors or a second overflow", async () => {
  for (const first of [new SiteRuntimeRequestError(502, null, "gateway"), new Error("network")]) {
    let calls = 0;
    await assert.rejects(invokeTelegramWithContextRecovery({
      continuationId: "old-thread",
      invoke: async () => { calls++; throw first; },
      resetContinuation: async () => { throw new Error("unexpected reset"); },
    }), first);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(invokeTelegramWithContextRecovery({
    continuationId: "old-thread",
    invoke: async () => { calls++; throw new SiteRuntimeRequestError(502, "context_length_exceeded", "overflow"); },
    resetContinuation: async () => undefined,
  }), SiteRuntimeRequestError);
  assert.equal(calls, 2);
});

test("Telegram context recovery does not invoke a fresh thread when metadata reset fails", async () => {
  const events: string[] = [];
  await assert.rejects(invokeTelegramWithContextRecovery({
    continuationId: "old-thread",
    invoke: async (continuationId) => {
      events.push(`invoke:${continuationId}`);
      throw new SiteRuntimeRequestError(502, "context_length_exceeded", "overflow");
    },
    resetContinuation: async () => {
      events.push("reset");
      throw new Error("metadata unavailable");
    },
  }), /metadata unavailable/);
  assert.deepEqual(events, ["invoke:old-thread", "reset"]);
});

test("Telegram history stays bounded and favors the most recent messages", () => {
  const history = Array.from({ length: 20 }, (_, index) => ({ role: "user", content: `${index}:${"a".repeat(2_000)}` }));
  const bounded = boundedTelegramHistory(history);
  assert.ok(bounded.length <= 12);
  assert.ok(bounded.reduce((sum, entry) => sum + entry.content.length, 0) <= 6_000);
  assert.ok(bounded.at(-1)?.content.startsWith("19:"));
});

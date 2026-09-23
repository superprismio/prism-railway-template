import assert from "node:assert/strict";
import test from "node:test";
import { recoverDiscordRequestHandoff, sendAndRecordDiscordReply } from "./discord-request-handoff.js";

const origin = {
  sourceSessionId: "session-1", sourceMessageId: "message-1", platform: "discord",
  targetId: "channel-1", threadId: "thread-1",
};
const request = {
  id: "request-1", requestNumber: 3092, origin,
  workflowRunStatus: "active", currentWorkflowStepKey: "implement",
  requestUrl: "https://prism.raidguild.org/admin/lab/requests/3092#selected-request-workspace",
};
const common = {
  sourceSessionId: "session-1", sourceMessageId: "message-1",
  channelId: "channel-1", threadId: "thread-1",
};

test("recovers the exact Discord request with bounded query and honest state", async () => {
  let calls = 0;
  const result = await recoverDiscordRequestHandoff({ ...common, lookup: async (query, signal) => {
    calls++;
    assert.equal(signal.aborted, false);
    const url = new URL(query, "https://site.example.org");
    assert.equal(url.searchParams.get("sourceSessionId"), "session-1");
    assert.equal(url.searchParams.get("sourceMessageId"), "message-1");
    assert.equal(url.searchParams.get("limit"), "5");
    assert.equal(url.searchParams.get("openOnly"), null);
    return { changeRequests: [request] };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result?.requestNumbers, [3092]);
  assert.match(result?.text ?? "", /Request #3092: open at implement/);
  assert.doesNotMatch(result?.text ?? "", /running/);
  assert.match(result?.text ?? "", /https:\/\/prism\.raidguild\.org\/admin\/lab\/requests\/3092/);
});

test("does not trust older servers that ignore the filters", async () => {
  for (const incorrectOrigin of [
    { ...origin, sourceSessionId: "other" },
    { ...origin, sourceMessageId: "other" },
    { ...origin, platform: "telegram" },
    { ...origin, targetId: "other" },
    { ...origin, threadId: "other" },
  ]) {
    assert.equal(await recoverDiscordRequestHandoff({
      ...common, lookup: async () => ({ changeRequests: [{ ...request, origin: incorrectOrigin }] }),
    }), null);
  }
});

test("requires both origin identifiers and tolerates lookup failures", async () => {
  let calls = 0;
  assert.equal(await recoverDiscordRequestHandoff({ ...common, sourceMessageId: null, lookup: async () => { calls++; return {}; } }), null);
  assert.equal(calls, 0);
  assert.equal(await recoverDiscordRequestHandoff({ ...common, lookup: async () => { throw new Error("timeout"); } }), null);
  assert.equal(await recoverDiscordRequestHandoff({ ...common, lookup: async () => ({ changeRequests: {} }) }), null);
});

test("reports blocked, attention and completed states without internal links", async () => {
  const list = [
    { ...request, id: "blocked", requestNumber: 1, workflowAttention: { status: "blocked" } },
    { ...request, id: "attention", requestNumber: 2, workflowAttention: { status: "needs_attention" } },
    { ...request, id: "completed", requestNumber: 3, workflowRunStatus: "completed", completedAt: "now" },
    { ...request, id: "canceled", requestNumber: 4, workflowRunStatus: "canceled" },
  ];
  const result = await recoverDiscordRequestHandoff({
    ...common,
    lookup: async () => ({ changeRequests: list.map((item) => ({
      ...item,
      requestUrl: `http://site.railway.internal:3100/admin/lab/requests/${item.requestNumber}#selected-request-workspace`,
    })) }),
  });
  assert.match(result?.text ?? "", /Request #1: blocked and needs attention/);
  assert.match(result?.text ?? "", /Request #2: needs attention/);
  assert.match(result?.text ?? "", /Request #3: completed/);
  assert.match(result?.text ?? "", /Request #4: canceled/);
  assert.doesNotMatch(result?.text ?? "", /site\.internal/);
});

test("limits malformed overlong responses and excludes IP-based URLs", async () => {
  const list = Array.from({ length: 12 }, (_, index) => ({
    ...request, id: `request-${index}`, requestNumber: index + 1,
    requestUrl: `https://172.18.0.2:3100/admin/lab/requests/${index + 1}#selected-request-workspace`,
  }));
  const result = await recoverDiscordRequestHandoff({
    ...common,
    lookup: async () => ({ changeRequests: list }),
  });
  assert.equal(result?.requestNumbers.length, 5);
  assert.doesNotMatch(result?.text ?? "", /172\.18\.0\.2/);
  assert.match(result?.text ?? "", /More requests may share/);
});

test("uses only the public URL supplied for the exact request", async () => {
  const noUrl = await recoverDiscordRequestHandoff({
    ...common, lookup: async () => ({ changeRequests: [{ ...request, requestUrl: null }] }),
  });
  assert.match(noUrl?.text ?? "", /Request #3092: open at implement/);
  assert.doesNotMatch(noUrl?.text ?? "", /https?:\/\//);

  const wrongNumber = await recoverDiscordRequestHandoff({
    ...common, lookup: async () => ({ changeRequests: [{ ...request, requestUrl: "https://prism.raidguild.org/admin/lab/requests/9999#selected-request-workspace" }] }),
  });
  assert.doesNotMatch(wrongNumber?.text ?? "", /https?:\/\//);
});

test("a delivered reply is never replaced by a false failure when history persistence fails", async () => {
  const operations: string[] = [];
  const result = await sendAndRecordDiscordReply({
    send: async () => { operations.push("send"); return { sourceMessageId: "discord-reply-1" }; },
    record: async () => { operations.push("record"); throw new Error("database unavailable"); },
    onRecordError: () => { operations.push("log"); },
  });
  assert.deepEqual(result, { sourceMessageId: "discord-reply-1" });
  assert.deepEqual(operations, ["send", "record", "log"]);
  await assert.rejects(sendAndRecordDiscordReply({
    send: async () => { throw new Error("send failed"); },
    record: async () => { throw new Error("should not run"); },
    onRecordError: () => undefined,
  }), /send failed/);
});

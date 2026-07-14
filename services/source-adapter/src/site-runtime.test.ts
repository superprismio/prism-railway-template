import assert from "node:assert/strict";
import test from "node:test";
import { requestSiteRuntime } from "./site-runtime.js";

test("source adapter delegates runtime selection to Site", async () => {
  const previousBaseUrl = process.env.PRISM_AGENT_API_BASE_URL;
  const previousToken = process.env.PRISM_AGENT_SERVICE_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.PRISM_AGENT_API_BASE_URL = "http://site.internal";
  process.env.PRISM_AGENT_SERVICE_TOKEN = "test-service-token";

  let capturedPrompt = "";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "http://site.internal/agent/runtime/invoke");
    assert.equal(new Headers(init?.headers).get("x-service-token"), "test-service-token");
    const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capturedPrompt = String(requestBody.prompt ?? "");
    return Response.json({
      ok: true,
      response: {
        responseText: "summary",
        thread_id: "grok-session-1",
        provider: "grok-build",
        runtimeKey: "grok-local",
      },
    });
  };

  try {
    const result = await requestSiteRuntime({
      prompt: "Summarize this meeting.",
      sessionId: "recording-1",
      timeoutMs: 5_000,
      metadata: { purpose: "voice_meeting_summary" },
    });
    assert.equal(capturedPrompt, "Summarize this meeting.");
    assert.deepEqual(result, {
      responseText: "summary",
      continuationId: "grok-session-1",
      provider: "grok-build",
      runtimeKey: "grok-local",
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.PRISM_AGENT_API_BASE_URL;
    else process.env.PRISM_AGENT_API_BASE_URL = previousBaseUrl;
    if (previousToken === undefined) delete process.env.PRISM_AGENT_SERVICE_TOKEN;
    else process.env.PRISM_AGENT_SERVICE_TOKEN = previousToken;
  }
});

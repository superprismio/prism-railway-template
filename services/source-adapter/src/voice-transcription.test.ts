import assert from "node:assert/strict";
import test from "node:test";
import { retryAfterDelay, transcribeVoiceChunk } from "./voice-transcription.js";

const options = { url: "https://example.invalid/transcribe", apiKey: "secret", filePath: "/tmp/chunk.flac" };
const body = Buffer.from("audio");
const reply = (status: number, text: string, headers?: HeadersInit) => new Response(text, { status, headers });
const base = { readFile: async () => body, sleep: async (_ms: number) => {}, random: () => 0 };

test("a 502 retries with a fresh multipart body and succeeds", async () => {
  let calls = 0;
  const forms: FormData[] = [];
  const waits: number[] = [];
  const result = await transcribeVoiceChunk(options, {
    ...base,
    sleep: async (ms) => { waits.push(ms); },
    fetch: async (_url, init) => {
      forms.push(init?.body as FormData);
      return ++calls === 1 ? reply(502, "upstream") : reply(200, '{"text":"hello"}');
    },
  });
  assert.equal(result.text, "hello");
  assert.equal(calls, 2);
  assert.notEqual(forms[0], forms[1]);
  assert.deepEqual(waits, [2000]);
});

test("transport errors retry; exhausted 503 remains fatal", async () => {
  let calls = 0;
  const recovered = await transcribeVoiceChunk(options, {
    ...base,
    fetch: async () => { if (++calls === 1) throw new TypeError("socket reset"); return reply(200, "{}"); },
  });
  assert.deepEqual(recovered, {});
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(() => transcribeVoiceChunk(options, {
    ...base,
    fetch: async () => { calls++; return reply(503, "unavailable"); },
  }), /Voice transcription failed: 503 unavailable/);
  assert.equal(calls, 4);
});

test("422 and authentication failures are not retried", async () => {
  for (const status of [401, 422]) {
    let calls = 0;
    await assert.rejects(() => transcribeVoiceChunk(options, {
      ...base,
      fetch: async () => { calls++; return reply(status, "bad request"); },
    }), new RegExp(`Voice transcription failed: ${status}`));
    assert.equal(calls, 1);
  }
});

test("Retry-After accepts bounded seconds and dates", () => {
  assert.equal(retryAfterDelay("3", 0), 3000);
  assert.equal(retryAfterDelay("999", 0), 60000);
  assert.equal(retryAfterDelay(new Date(5000).toUTCString(), 0), 5000);
  assert.equal(retryAfterDelay("bogus", 0), null);
});

test("Retry-After controls delay", async () => {
  const waits: number[] = [];
  let calls = 0;
  await transcribeVoiceChunk(options, {
    ...base,
    sleep: async (ms) => { waits.push(ms); },
    fetch: async () => ++calls === 1 ? reply(429, "slow", { "Retry-After": "99" }) : reply(200, "{}"),
  });
  assert.deepEqual(waits, [60000]);
});

test("a timeout retries, malformed success JSON does not", async () => {
  let calls = 0;
  await transcribeVoiceChunk(options, {
    ...base,
    fetch: async () => {
      if (++calls === 1) throw new DOMException("deadline", "TimeoutError");
      return reply(200, "{}");
    },
  });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(() => transcribeVoiceChunk(options, {
    ...base,
    fetch: async () => { calls++; return reply(200, "not-json"); },
  }), SyntaxError);
  assert.equal(calls, 1);
});

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { registerRecordingDownloadRoute } from "./recording-download-route.js";

test("recording route fails closed without a configured, matching adapter token", async () => {
  const previousToken = process.env.SOURCE_ADAPTER_TOKEN;
  const directory = await mkdtemp(path.join(os.tmpdir(), "prism-recording-route-"));
  const filePath = path.join(directory, "transcript.md");
  await writeFile(filePath, "# Private transcript");
  const app = express();
  let downloadCalls = 0;
  registerRecordingDownloadRoute(app, () => ({
    async resolveRecordingDownload() {
      downloadCalls += 1;
      return { filePath, contentType: "text/markdown; charset=utf-8" };
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/recordings/64702ca2-a6ba-448d-b9c4-b924cbeae222/transcript.md`;
    delete process.env.SOURCE_ADAPTER_TOKEN;
    assert.equal((await fetch(url)).status, 503);
    assert.equal((await fetch(url, { headers: { "X-Adapter-Token": "guessed" } })).status, 503);
    process.env.SOURCE_ADAPTER_TOKEN = "secret-token";
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { "X-Adapter-Token": "wrong" } })).status, 401);
    assert.equal(downloadCalls, 0);
    const valid = await fetch(url, { headers: { "X-Adapter-Token": "secret-token" } });
    assert.equal(valid.status, 200);
    assert.equal(await valid.text(), "# Private transcript");
    assert.match(valid.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(downloadCalls, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
    if (previousToken === undefined) delete process.env.SOURCE_ADAPTER_TOKEN;
    else process.env.SOURCE_ADAPTER_TOKEN = previousToken;
  }
});

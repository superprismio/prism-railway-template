import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeCapabilityError } from "./runtime-capabilities.js";
import { RuntimeToolsetSessions } from "./runtime-toolsets.js";

test("runtime toolset sessions enforce assignment and expiry", async () => {
  let now = 1_000;
  const calls: unknown[] = [];
  const sessions = new RuntimeToolsetSessions({
    toolsetRequest: async (input) => {
      calls.push(input);
      return { ok: true, result: { posts: [] } };
    },
  }, () => now);
  const token = sessions.create(["portal.admin"], { requestId: "349" }, 500);

  await assert.rejects(
    sessions.invoke(token, "crm.admin", "describe"),
    (error: unknown) => error instanceof RuntimeCapabilityError && error.code === "RUNTIME_TOOLSET_NOT_ASSIGNED",
  );
  assert.deepEqual(await sessions.invoke(token, "portal.admin", "request", { method: "GET", path: "/api/posts" }), {
    ok: true,
    result: { posts: [] },
  });
  assert.equal(calls.length, 1);

  now = 1_501;
  await assert.rejects(
    sessions.invoke(token, "portal.admin", "describe"),
    (error: unknown) => error instanceof RuntimeCapabilityError && error.code === "RUNTIME_TOOLSET_SESSION_EXPIRED",
  );
});

test("toolset sessions can be authenticated before parsing a large request", () => {
  const sessions = new RuntimeToolsetSessions({
    toolsetRequest: async () => ({ ok: true }),
  });
  const token = sessions.create(["portal.admin"], {}, 1_000);

  assert.doesNotThrow(() => sessions.assertActive(token));
  assert.throws(
    () => sessions.assertActive("invalid"),
    (error: unknown) => error instanceof RuntimeCapabilityError && error.code === "RUNTIME_TOOLSET_SESSION_INVALID",
  );
});

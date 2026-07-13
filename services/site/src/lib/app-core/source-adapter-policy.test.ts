import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSourceAdapterPolicy,
  isSourceAdapterPlatform,
  normalizeSourceAdapterPolicy,
  resolveSourceAdapterPolicy,
  sourceAdapterCapabilitiesForMode,
} from "./source-adapter-policy";

test("source policy recognizes only adapter platforms implemented by the route", () => {
  assert.equal(isSourceAdapterPlatform("discord"), true);
  assert.equal(isSourceAdapterPlatform("telegram"), true);
  assert.equal(isSourceAdapterPlatform("slack"), false);
  assert.equal(isSourceAdapterPlatform("unknown"), false);
});

test("source policy fails closed for an unknown platform", () => {
  const resolved = resolveSourceAdapterPolicy(defaultSourceAdapterPolicy, {
    platform: "unknown",
    targetId: "channel",
    userId: "user",
  });
  assert.equal(resolved.mode, "off");
  assert.deepEqual(resolved.capabilities, []);
  assert.deepEqual(resolved.matchedRules, ["default"]);
});

test("source policy preserves target, thread, group, and user override order", () => {
  const policy = normalizeSourceAdapterPolicy({
    platforms: {
      discord: {
        defaultMode: "off",
        targets: {
          channel: { mode: "readonly" },
          thread: { mode: "run-approved" },
        },
        groups: {
          operators: { mode: "full" },
        },
        users: {
          limited: { mode: "readonly" },
        },
      },
    },
  });

  const full = resolveSourceAdapterPolicy(policy, {
    platform: "discord",
    targetId: "channel",
    threadId: "thread",
    groupIds: ["operators"],
    userId: "admin",
  });
  assert.equal(full.mode, "full");
  assert.deepEqual(full.capabilities, sourceAdapterCapabilitiesForMode("full"));

  const limited = resolveSourceAdapterPolicy(policy, {
    platform: "discord",
    targetId: "channel",
    threadId: "thread",
    groupIds: ["operators"],
    userId: "limited",
  });
  assert.equal(limited.mode, "readonly");
  assert.deepEqual(limited.capabilities, sourceAdapterCapabilitiesForMode("readonly"));
  assert.deepEqual(limited.matchedRules, [
    "default",
    "target:channel",
    "target:thread",
    "group:operators",
    "user:limited",
  ]);
});

test("Telegram target and user rules resolve through the same policy model", () => {
  const policy = normalizeSourceAdapterPolicy({
    platforms: {
      telegram: {
        defaultMode: "off",
        targets: { meeting: { mode: "full" } },
        users: { guest: { mode: "readonly" } },
      },
    },
  });
  assert.equal(resolveSourceAdapterPolicy(policy, {
    platform: "telegram",
    targetId: "meeting",
    userId: "operator",
  }).mode, "full");
  assert.equal(resolveSourceAdapterPolicy(policy, {
    platform: "telegram",
    targetId: "meeting",
    userId: "guest",
  }).mode, "readonly");
});

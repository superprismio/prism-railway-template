import assert from "node:assert/strict";
import test from "node:test";

import { isPrismLabEnabled } from "./feature-flag";

test("Lab fails closed when the rollout variable is absent or empty", () => {
  assert.equal(isPrismLabEnabled(undefined), false);
  assert.equal(isPrismLabEnabled(null), false);
  assert.equal(isPrismLabEnabled(""), false);
  assert.equal(isPrismLabEnabled("   "), false);
});

test("Lab is enabled only by an explicit true value", () => {
  assert.equal(isPrismLabEnabled("true"), true);
  assert.equal(isPrismLabEnabled(" TRUE "), true);
  assert.equal(isPrismLabEnabled("false"), false);
  assert.equal(isPrismLabEnabled("1"), false);
  assert.equal(isPrismLabEnabled("yes"), false);
  assert.equal(isPrismLabEnabled("enabled"), false);
});

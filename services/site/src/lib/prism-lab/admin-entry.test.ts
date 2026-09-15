import assert from "node:assert/strict"
import test from "node:test"
import { legacyAdminHref, shouldRedirectAdminToLab } from "./admin-entry"

test("bare admin promotion requires both explicit flags", () => {
  assert.equal(shouldRedirectAdminToLab({}, "true", "true"), true)
  for (const disabled of [undefined, "", "false", "1", "yes"]) {
    assert.equal(shouldRedirectAdminToLab({}, disabled, "true"), false)
    assert.equal(shouldRedirectAdminToLab({}, "true", disabled), false)
  }
})

test("legacy settings, credentials, request links and form feedback never redirect", () => {
  for (const query of [
    "tab=settings&settings=gateway&connection=abc&action=credential&secretName=github",
    "tab=settings&settings=interfaces", "tab=settings&settings=runtimes",
    "tab=settings&settings=config", "tab=settings&settings=status",
    "tab=requests&request=2604", "error=request-create", "success=saved",
    "tab=", "unknown=value", legacyAdminHref.split("?")[1],
  ]) {
    assert.equal(shouldRedirectAdminToLab(Object.fromEntries(new URLSearchParams(query)), "true", "true"), false, query)
  }
  assert.equal(shouldRedirectAdminToLab({ tab: ["settings", "requests"] }, "true", "true"), false)
})

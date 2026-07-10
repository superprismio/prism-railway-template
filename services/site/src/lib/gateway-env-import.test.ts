import assert from "node:assert/strict";
import test from "node:test";

import { gatewayEnvImportDefinitions, parseEnvText } from "./gateway-env-import";

test("environment import parses exports, quotes, and values containing equals", () => {
  assert.deepEqual(
    parseEnvText(`
# comment
export TARGET_REPO_GITHUB_TOKEN="github=value"
AWS_ACCESS_KEY_ID='access-key'
EMPTY=
INVALID LINE
`),
    {
      TARGET_REPO_GITHUB_TOKEN: "github=value",
      AWS_ACCESS_KEY_ID: "access-key",
    },
  );
});

test("environment import definitions keep X and S3 credential groups together", () => {
  const x = gatewayEnvImportDefinitions.find((definition) => definition.key === "x.admin");
  const storage = gatewayEnvImportDefinitions.find((definition) => definition.key === "storage.s3");
  assert.deepEqual(Object.keys(x?.credentialVariables ?? {}).sort(), [
    "X_ACCESS_TOKEN",
    "X_ACCESS_TOKEN_SECRET",
    "X_API_KEY",
    "X_API_SECRET",
    "X_BEARER_TOKEN",
    "X_CONSUMER_KEY",
    "X_CONSUMER_SECRET",
  ]);
  assert.deepEqual(Object.keys(storage?.credentialVariables ?? {}).sort(), [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ]);
});

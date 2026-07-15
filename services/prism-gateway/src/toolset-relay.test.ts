import assert from "node:assert/strict";
import test from "node:test";
import { encodeMultipartBody, remainingToolsetTimeoutMs } from "./toolset-relay.js";
import { GatewayDriverError } from "./http-json-read.js";

test("encodes one bounded file and Payload form fields", () => {
  const encoded = encodeMultipartBody({
    fields: { _payload: JSON.stringify({ alt: "Prism image" }) },
    file: {
      fieldName: "file",
      filename: "hero.png",
      contentType: "image/png",
      dataBase64: Buffer.from("png-bytes").toString("base64"),
    },
  });
  const text = encoded.body.toString("utf8");

  assert.match(encoded.contentType, /^multipart\/form-data; boundary=prism-/);
  assert.match(text, /name="_payload"/);
  assert.match(text, /\{"alt":"Prism image"\}/);
  assert.match(text, /name="file"; filename="hero.png"/);
  assert.match(text, /Content-Type: image\/png/);
  assert.match(text, /png-bytes/);
});

test("Payload login and relay share one downstream timeout budget", () => {
  assert.equal(remainingToolsetTimeoutMs(60_000, 0), 60_000);
  assert.equal(remainingToolsetTimeoutMs(60_000, 25_000), 35_000);
  assert.throws(
    () => remainingToolsetTimeoutMs(60_000, 60_000),
    (error: unknown) => error instanceof GatewayDriverError
      && error.code === "TOOLSET_DOWNSTREAM_TIMEOUT"
      && error.retryable,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { encodeMultipartBody } from "./toolset-relay.js";

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

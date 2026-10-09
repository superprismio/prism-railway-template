import assert from "node:assert/strict";
import test from "node:test";
import { sendTelegramWithReplyFallback } from "./telegram-delivery.js";

test("missing reply retries one chunk once without the reply reference", async () => {
  const attempts: Array<number | null> = [];
  const result = await sendTelegramWithReplyFallback(async (replyId) => {
    attempts.push(replyId);
    if (replyId !== null) throw new Error("Telegram API failed: 400 sendMessage Bad Request: replied message not found");
    return "sent";
  }, 42);
  assert.equal(result, "sent");
  assert.deepEqual(attempts, [42, null]);
});

test("other Telegram errors are not retried", async () => {
  let attempts = 0;
  await assert.rejects(sendTelegramWithReplyFallback(async () => {
    attempts += 1;
    throw new Error("Telegram API failed: 400 sendMessage Bad Request: chat not found");
  }, 42), /chat not found/);
  assert.equal(attempts, 1);
});

test("Telegram's alternate missing-reply wording is handled", async () => {
  const attempts: Array<number | null> = [];
  await sendTelegramWithReplyFallback(async (replyId) => {
    attempts.push(replyId);
    if (replyId !== null) throw new Error("Telegram API failed: 400 sendMessage Bad Request: message to be replied not found");
    return true;
  }, 9);
  assert.deepEqual(attempts, [9, null]);
});

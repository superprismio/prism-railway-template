export function isMissingTelegramReply(error: unknown): boolean {
  return error instanceof Error
    && /^Telegram API failed: 400 sendMessage Bad Request: (?:replied message not found|message to be replied not found)(?:\b|$)/i.test(error.message);
}

export async function sendTelegramWithReplyFallback<T>(
  send: (replyToMessageId: number | null) => Promise<T>,
  replyToMessageId: number | null,
): Promise<T> {
  try {
    return await send(replyToMessageId);
  } catch (error) {
    if (replyToMessageId === null || !isMissingTelegramReply(error)) throw error;
    return send(null);
  }
}

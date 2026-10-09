import { isSiteRuntimeContextLengthExceeded } from "./site-runtime.js";

type HistoryMessage = { role: string; content: string };

/** Keep useful recent context without rebuilding another oversized prompt. */
export function boundedTelegramHistory(messages: HistoryMessage[]): HistoryMessage[] {
  const result: HistoryMessage[] = [];
  let remaining = 6_000;
  for (const message of messages.slice(-12).reverse()) {
    if (remaining <= 0) break;
    const content = message.content.slice(0, Math.min(1_000, remaining));
    if (!content) continue;
    result.push({ role: message.role, content });
    remaining -= content.length;
  }
  return result.reverse();
}

/** A failed resume can be retried once, only after the old thread is durably cleared. */
export async function invokeTelegramWithContextRecovery<T>(input: {
  continuationId: string | null;
  invoke: (continuationId: string | null) => Promise<T>;
  resetContinuation: () => Promise<void>;
}): Promise<{ result: T; reset: boolean }> {
  try {
    return { result: await input.invoke(input.continuationId), reset: false };
  } catch (error) {
    if (!input.continuationId || !isSiteRuntimeContextLengthExceeded(error)) throw error;
    await input.resetContinuation();
    return { result: await input.invoke(null), reset: true };
  }
}

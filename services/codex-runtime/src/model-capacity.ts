import type { RunBudget } from './run-budget.js';

/** A capacity failure can be replayed only before the model starts any operation. */
export class CapacityAttempt {
  private operationStarted = false;

  observe(event: { type?: string; item?: { type?: string } }) {
    if (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed') {
      // Reasoning and assistant text have no external effect. Unknown items are unsafe.
      if (event.item?.type !== 'reasoning' && event.item?.type !== 'agent_message') this.operationStarted = true;
    }
  }

  get safeToReplay() { return !this.operationStarted; }
}

export function isExplicitModelCapacity(message: string) {
  return /selected model is at capacity/i.test(message);
}

export function terminalModelCapacity(exitCode: number | null, errorMessage: string) {
  // A partially streamed assistant answer is not a successful turn when the
  // provider subsequently reports a terminal capacity failure.
  return isExplicitModelCapacity(errorMessage) && exitCode !== null;
}

export function setupStopCode(budget: Pick<RunBudget, 'expired'>, now: number, signal?: AbortSignal) {
  if (signal?.aborted) return 'RUNTIME_JOB_CANCELED';
  const reason = budget.expired(now);
  return reason === 'idle' ? 'CODEX_RUNTIME_IDLE_TIMEOUT'
    : reason === 'budget' ? 'CODEX_RUNTIME_BUDGET_EXCEEDED' : null;
}

/** Consume complete JSONL records, including a final record without newline. */
export function consumeJsonLines(buffer: string, chunk: string, onLine: (line: string) => void, flush = false) {
  const lines = (buffer + chunk).split('\n');
  const pending = flush ? '' : lines.pop() ?? '';
  for (const line of lines) if (line.trim()) onLine(line.trim());
  return pending;
}

export async function waitForCapacityRetry(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('RUNTIME_JOB_CANCELED');
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('RUNTIME_JOB_CANCELED'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export type TelegramUpdateRecord = { update_id: number; [key: string]: unknown };

/**
 * Checkpoint before side effects. The pending journal retains the complete update
 * for manual recovery if the process stops or delivery fails. This is at-most-once
 * processing, rather than silently replaying a partly completed model invocation.
 */
export async function processTelegramUpdateBatch(
  updates: unknown[],
  initialOffset: number | null,
  operations: {
    journal: (entry: Record<string, unknown>) => Promise<"new" | "existing" | void>;
    checkpoint: (offset: number) => Promise<void>;
    process: (update: TelegramUpdateRecord) => Promise<boolean>;
    onFailure: (updateId: number, error: unknown) => void;
    onRecovered?: (updateId: number) => void;
  },
): Promise<number> {
  let offset = initialOffset;
  let seen = 0;
  for (const value of updates) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const update = value as TelegramUpdateRecord;
    if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) continue;
    if (offset !== null && update.update_id < offset) continue;

    const journalState = await operations.journal({ updateId: update.update_id, status: "pending", update });
    offset = update.update_id + 1;
    await operations.checkpoint(offset);
    if (journalState === "existing") {
      await operations.journal({ updateId: update.update_id, status: "failed", errorClass: "RecoveredPending" });
      operations.onRecovered?.(update.update_id);
      continue;
    }
    try {
      if (await operations.process(update)) seen += 1;
    } catch (error) {
      operations.onFailure(update.update_id, error);
      await operations.journal({ updateId: update.update_id, status: "failed", errorClass: error instanceof Error ? error.name : typeof error });
      continue;
    }
    await operations.journal({ updateId: update.update_id, status: "completed" });
  }
  return seen;
}

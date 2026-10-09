import fs from "node:fs/promises";
import path from "node:path";

type JournalEntry = { updateId: number; status: "pending" | "completed" | "failed"; update?: unknown; errorClass?: string };

export function telegramUpdateRecordPath(dataRoot: string, updateId: number, state: "pending" | "failed"): string {
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw new Error("invalid Telegram update ID");
  return path.join(dataRoot, "telegram-updates", state, `${updateId}.json`);
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) {
    throw new Error("unsafe Telegram journal directory");
  }
  if ((stat.mode & 0o777) !== 0o700) await fs.chmod(directory, 0o700);
}

async function ensureJournalDirectory(dataRoot: string, state: "pending" | "failed"): Promise<void> {
  const root = path.join(dataRoot, "telegram-updates");
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== process.getuid?.()) {
    throw new Error("unsafe Telegram journal directory");
  }
  if ((rootStat.mode & 0o777) !== 0o700) await fs.chmod(root, 0o700);
  const leaf = path.join(root, state);
  try {
    await ensurePrivateDirectory(leaf);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stat = await fs.lstat(leaf);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) {
      throw new Error("unsafe Telegram journal directory");
    }
    if ((stat.mode & 0o777) !== 0o700) await fs.chmod(leaf, 0o700);
  }
}

export async function journalTelegramUpdate(dataRoot: string, entry: JournalEntry): Promise<"new" | "existing" | void> {
  const pendingPath = telegramUpdateRecordPath(dataRoot, entry.updateId, "pending");
  await ensureJournalDirectory(dataRoot, "pending");
  await ensureJournalDirectory(dataRoot, "failed");
  if (entry.status === "completed") {
    await fs.rm(pendingPath, { force: true });
    return;
  }
  if (entry.status === "failed") {
    await fs.rename(pendingPath, telegramUpdateRecordPath(dataRoot, entry.updateId, "failed"));
    return;
  }
  let file: fs.FileHandle;
  try {
    file = await fs.open(pendingPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stat = await fs.lstat(pendingPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) {
      throw new Error("unsafe Telegram pending update file");
    }
    if ((stat.mode & 0o777) !== 0o600) await fs.chmod(pendingPath, 0o600);
    return "existing";
  }
  try {
    await file.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  return "new";
}

/** Quarantine work interrupted after its offset was checkpointed, without replaying it. */
export async function recoverPendingTelegramUpdates(
  dataRoot: string,
  currentOffset: number | null,
  checkpoint: (offset: number) => Promise<void>,
  onRecovered: (updateId: number) => void,
): Promise<number | null> {
  await ensureJournalDirectory(dataRoot, "pending");
  await ensureJournalDirectory(dataRoot, "failed");
  const pendingDirectory = path.join(dataRoot, "telegram-updates", "pending");
  const names = await fs.readdir(pendingDirectory);
  const ids = names.map((name) => {
    if (!/^(0|[1-9]\d*)\.json$/.test(name)) throw new Error("invalid Telegram pending update filename");
    const id = Number(name.slice(0, -5));
    if (!Number.isSafeInteger(id)) throw new Error("invalid Telegram pending update filename");
    return id;
  }).sort((a, b) => a - b);
  let offset = currentOffset;
  for (const id of ids) {
    const pendingPath = telegramUpdateRecordPath(dataRoot, id, "pending");
    const stat = await fs.lstat(pendingPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) {
      throw new Error("unsafe Telegram pending update file");
    }
    if ((stat.mode & 0o777) !== 0o600) await fs.chmod(pendingPath, 0o600);
    if (offset === null || id >= offset) {
      offset = id + 1;
      await checkpoint(offset);
    }
    await journalTelegramUpdate(dataRoot, { updateId: id, status: "failed", errorClass: "RecoveredPending" });
    onRecovered(id);
  }
  return offset;
}

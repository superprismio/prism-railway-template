import type { ChildProcess } from 'node:child_process';

// Each POSIX job must be spawned detached so its group is isolated from the
// server and other jobs. Do not unref the child: jobs are still supervised.
export const isolateJobProcessGroup = process.platform !== 'win32';

export function createJobCleanup(child: ChildProcess, graceMs = 5_000): () => void {
  let started = false;
  const signal = (value: NodeJS.Signals): boolean => {
    if (!child.pid) return false; // spawn failure
    try {
      if (isolateJobProcessGroup) {
        process.kill(-child.pid, value);
        return true;
      }
      return child.kill(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        console.warn('[codex-runtime] job cleanup failed', (error as NodeJS.ErrnoException).code);
      }
      return false;
    }
  };
  return () => {
    if (started) return;
    started = true;
    if (!signal('SIGTERM')) return;
    // Descendants can survive their leader; do not guard this on exitCode.
    const timer = setTimeout(() => signal('SIGKILL'), graceMs);
    timer.unref();
  };
}

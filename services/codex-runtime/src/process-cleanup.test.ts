import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createJobCleanup } from './process-cleanup.js';

async function alive(pid: number): Promise<boolean> {
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    // A local test runner may not be an init/reaper. Docker's tini reaps these.
    return !/^State:\s+Z/m.test(status);
  } catch { return false; }
}

for (const mode of ['cancel', 'parent-exit'] as const) {
  test(`cleanup kills stubborn descendants after ${mode}, without touching another job`, {
    skip: process.platform !== 'linux', timeout: 10_000,
  }, async () => {
    const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
    const script = `
      const {spawn}=require('node:child_process');
      const c=spawn(process.execPath,['-e', 'process.on("SIGTERM",()=>{}); console.log("ready"); setInterval(()=>{},1000)'], {stdio:['ignore','pipe','inherit']});
      c.stdout.once('data',()=>{ console.log(c.pid); ${mode === 'parent-exit' ? 'process.exit(0)' : ''} });
      setInterval(()=>{},1000);
    `;
    const job = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const cleanup = createJobCleanup(job, 100);
    job.once('exit', cleanup);
    let descendant: number | undefined;
    try {
      const [data] = await once(job.stdout!, 'data');
      descendant = Number(String(data).trim());
      assert.ok(descendant > 0);
      if (mode === 'cancel') { cleanup(); cleanup(); }
      for (let i = 0; i < 100 && await alive(descendant); i++) await delay(20);
      assert.equal(await alive(descendant), false, 'stubborn descendant must be killed even after leader exits');
      assert.equal(await alive(other.pid!), true, 'other job must remain alive');
    } finally {
      for (const pid of [job.pid, other.pid]) {
        if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
      }
    }
  });
}

test('cleanup tolerates a failed spawn without a pid', async () => {
  const child = spawn('/nonexistent-prism-test-executable', [], { detached: true });
  await once(child, 'error');
  assert.doesNotThrow(createJobCleanup(child, 1));
});

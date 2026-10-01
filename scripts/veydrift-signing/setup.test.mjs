import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setupSigningDependency } from './setup.mjs';

async function withCache(run) {
  const cacheRoot = await mkdtemp(path.join(os.tmpdir(), 'veydrift-signing-test-'));
  try { await run(cacheRoot); }
  finally { await rm(cacheRoot, { recursive: true, force: true }); }
}

const verify = async modulePath => {
  assert.equal(await readFile(path.join(modulePath, 'sentinel'), 'utf8'), 'verified');
};

function fakeInstaller(calls, delayMs = 0) {
  return async stageDir => {
    calls.count += 1;
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    const modulePath = path.join(stageDir, 'node_modules', 'ethers');
    await mkdir(modulePath, { recursive: true });
    await writeFile(path.join(modulePath, 'sentinel'), 'verified');
  };
}

test('cold setup publishes a versioned cache; the next run is networkless', async () => {
  await withCache(async cacheRoot => {
    const calls = { count: 0 };
    const first = await setupSigningDependency({ cacheRoot, install: fakeInstaller(calls), verify });
    assert.equal(first.version, '6.17.0');
    assert.equal(first.cacheHit, false);
    assert.match(first.modulePath, /ethers-6\.17\.0-node\d+-/);
    assert.equal(first.lockHash.length, 64);
    const second = await setupSigningDependency({ cacheRoot,
      install: () => { throw new Error('network must not be used'); }, verify });
    assert.equal(second.cacheHit, true);
    assert.equal(second.modulePath, first.modulePath);
    assert.equal(calls.count, 1);
  });
});

test('parallel cold setups publish once and each returns a verified cache', async () => {
  await withCache(async cacheRoot => {
    const calls = { count: 0 };
    const install = fakeInstaller(calls, 30);
    const results = await Promise.all(Array.from({ length: 3 }, () =>
      setupSigningDependency({ cacheRoot, install, verify })));
    assert.equal(results.filter(result => !result.cacheHit).length, 1);
    assert.equal(new Set(results.map(result => result.modulePath)).size, 1);
    assert.equal(calls.count, 3);
    assert.equal((await readdir(cacheRoot)).filter(name => name.startsWith('.staging-')).length, 0);
  });
});

test('failed install leaves no published cache and can be retried', async () => {
  await withCache(async cacheRoot => {
    await assert.rejects(setupSigningDependency({ cacheRoot,
      install: async () => { throw new Error('registry unavailable'); }, verify }),
    error => error.code === 'DEPENDENCY_INSTALL_FAILED');
    assert.deepEqual(await readdir(cacheRoot), []);
    const calls = { count: 0 };
    const result = await setupSigningDependency({ cacheRoot, install: fakeInstaller(calls), verify });
    assert.equal(result.cacheHit, false);
    assert.equal(calls.count, 1);
  });
});

test('corrupt published cache reports an error without deleting or reinstalling it', async () => {
  await withCache(async cacheRoot => {
    const calls = { count: 0 };
    const result = await setupSigningDependency({ cacheRoot, install: fakeInstaller(calls), verify });
    const entryDir = path.dirname(path.dirname(result.modulePath));
    await writeFile(path.join(entryDir, 'package-lock.json'), 'corrupted');
    await assert.rejects(setupSigningDependency({ cacheRoot, install: fakeInstaller(calls), verify }),
      error => error.code === 'DEPENDENCY_CACHE_INVALID');
    assert.equal(calls.count, 1);
    assert.equal(await readFile(path.join(entryDir, 'package-lock.json'), 'utf8'), 'corrupted');
  });
});

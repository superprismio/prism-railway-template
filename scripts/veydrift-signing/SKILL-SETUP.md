## EVM signing dependency setup

Before any Veydrift workflow action that needs local EVM signing, run:

```bash
node /data/custom/veydrift-signing/setup.mjs
```

The command prints one JSON object containing `version`, `modulePath`, `lockHash`, and `cacheHit`. `modulePath` is a package directory: load it with CommonJS `require`, not an ESM directory import. For an ESM job script:

```js
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const setup = JSON.parse(execFileSync(process.execPath,
  ['/data/custom/veydrift-signing/setup.mjs'], { encoding: 'utf8' }));
const ethers = createRequire(import.meta.url)(setup.modulePath);
```

The helper installs pinned `ethers@6.17.0` from its lockfile only when its persistent cache entry is absent. It validates the cached module with an offline dummy-key signature on every use. Record the version, lock hash, and cache-hit status in run evidence. The cache remains on the runtime volume for later runs; do not remove it at the end of a workflow.

If the helper exits nonzero, report its actual `DEPENDENCY_INSTALL_FAILED`, `DEPENDENCY_CACHE_INVALID`, or other setup error. Do not conclude that the signing runtime is unavailable merely because `ethers` or `viem` is absent from the global runtime package list. Continue to obtain wallet credentials through the existing Gateway lease. Re-read live game and chain state and re-simulate immediately before any authorized transaction; this setup check never signs or broadcasts a transaction.

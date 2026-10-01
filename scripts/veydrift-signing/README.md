# Veydrift signing dependency

Concurrent first-time callers may perform duplicate installs; only one complete cache is published. Warm runs do not invoke npm. A hard process kill can leave an unpublished `.staging-*` directory. During maintenance, identify the exact stale directory and confirm no setup process uses it before removing it; never remove the published cache or the whole `/data/custom` tree. Ordinary failed installs clean their own staging automatically.

This helper gives Veydrift jobs a pinned `ethers` module without adding it to the shared Codex Runtime image. The first setup installs into `/data/custom/veydrift-signing`; subsequent jobs use the same volume cache. Cache keys include the lockfile SHA-256, Node major version, operating system, and CPU architecture. A cold install is verified in a staging directory, then published with one atomic rename. Concurrent callers validate the first published result. An invalid published cache is reported and left in place for inspection.

Deploy `setup.mjs`, `package.json`, and `package-lock.json` together to `/data/custom/veydrift-signing` on the Codex Runtime volume. Add the text of [SKILL-SETUP.md](./SKILL-SETUP.md) to the instance-owned Veydrift skill through `POST /agent/skills` using the complete updated `SKILL.md` content. Keep existing Gateway credential metadata and gameplay instructions. Do not edit a local `CODEX_HOME` skill copy. This repository file is a reviewable source for the instance update; publishing it requires the separate runtime and Site steps.

Run `node /data/custom/veydrift-signing/setup.mjs` once on the runtime after deploying. It prints a JSON object with the exact import path; run it a second time and confirm `cacheHit` is `true`. The helper can be tested in a temporary location with `--cache-root /absolute/path`.

To run the networkless cache behavior tests locally:

```bash
node scripts/veydrift-signing/setup.test.mjs
```

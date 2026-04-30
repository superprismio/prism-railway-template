# Template Follow-ups Checklist

This is the running checklist for issues found while bringing up fresh Railway template instances.

Use this after the current instance setup is complete, then fold the fixes back into the published template and docs.

## Fresh deploy blockers

- [ ] Ensure `site` app DB initialization happens on first deploy.
  - Problem seen on `fortunate-forgiveness`: `site` came up with `appliedMigrations: 0`, admin password auth worked, but the board failed to load.
  - Required live recovery was:
    - `npm run migrate`
    - `npm run bootstrap:targets`
  - Fix options:
    - add an explicit post-deploy step to the runbook, or
    - add a safe bootstrap/predeploy path for fresh `site` volumes.

- [ ] Validate that `site` local admin mode works on a truly empty volume.
  - Current topology depends on:
    - `SITE_USE_LOCAL_APP_API=true`
    - `PRISM_AGENT_DATA_ROOT=/data`
  - Fresh template smoke should verify:
    - `/api/health`
    - `/admin`
    - admin login
    - board render after first boot

- [ ] Prevent malformed internal URL env values in template raw variables.
  - Problem seen on `fortunate-forgiveness`:
    - `CODEX_RUNTIME_BASE_URL`
    - `PRISM_MEMORY_BASE_URL`
    were rendered with a newline before the port.
  - Result: broken internal service URLs on `site`.
  - Fix:
    - review the template raw variable formatting
    - keep service URL vars on one line only
    - re-smoke generated envs on a fresh deploy

## Template defaults and seed state

- [ ] Decide whether target app/environment bootstrap should seed anything by default.
  - Current fresh instance behavior after bootstrap:
    - admin board works
    - target apps: `0`
    - target environments: `0`
  - This is technically healthy, but the operator experience may be too empty.
  - Decision needed:
    - leave empty and document it, or
    - seed one starter target app/environment.

- [ ] Confirm `ADMIN_PASSWORD=changeme` is still the intended template default.
  - It worked correctly on the fresh instance.
  - Follow-up is documentation and operator guidance, not runtime behavior.

## Post-deploy verification

- [ ] Add an explicit fresh-instance verification checklist to the runbook:
  - `site /api/health`
  - admin login
  - admin board render
  - Prism Memory reachable from `site`
  - Codex runtime reachable from `site`
  - Discord adapter internal app API wiring

- [ ] Add a template smoke assertion for `site /api/health` showing migrations applied.
  - Expected healthy state on fresh boot:
    - `appliedMigrations: 5`
  - A fresh instance showing `0` should be treated as uninitialized.

## Nice-to-have hardening

- [ ] Add a small first-boot diagnostic to the admin UI or health surface.
  - Goal: distinguish:
    - bad admin password
    - missing env
    - uninitialized DB
  - Current user-facing error is too generic:
    - `The board could not load the admin API.`

- [ ] Consider making fresh `site` initialization idempotent and automatic.
  - If done, it must be safe on:
    - empty volume
    - existing live volume
  - Do not add destructive bootstrap behavior.

- [ ] Improve Discord setup diagnostics on first-run voice and bot setup.
  - Current symptom during early Discord testing:
    - generic aborts from `/prism-join` or `/prism-record`
  - Better behavior:
    - `/prism-health` should report current text and voice permissions in-context
    - `/prism-join` and `/prism-record` should fail explicitly on missing voice permissions
  - Minimum permissions to surface clearly:
    - `View Channel`
    - `Send Messages`
    - `Send Messages in Threads`
    - `Read Message History`
    - `Connect`
    - `Speak`
    - `Use Voice Activity`

- [ ] Improve target repo auth diagnostics in `codex-runtime`.
  - Current symptom during first CR setup:
    - raw git 403 / exit 128 errors
  - Better behavior:
    - distinguish:
      - no repo read access
      - repo read access but no push access
      - bad/expired token
      - wrong repo URL or provider mismatch
  - Ideal operator message should explicitly mention:
    - target repo slug
    - token identity if known
    - whether read works
    - whether push is missing

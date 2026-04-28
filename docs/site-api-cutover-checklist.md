# Site/API Cutover Checklist

This document is the operational checklist for moving one live project from the current split web topology:

- `site`
- `api`

to the transitional consolidated topology where:

- `site` owns the read-heavy backend state through `@prism-railway/app-core`
- `api` still exists for writes and rollback

This is not the final removal of `api`. It is the first live cutover that proves whether `site` can safely take over the app SQLite/data-root ownership.

## Scope

This checklist applies to one existing Railway project at a time.

Do not do both live projects at once.

Recommended order:

1. lower-risk / less-used project
2. verify for a day or two
3. then repeat on the second project

## Preconditions

Before starting:

1. `site-api-consolidation` branch is deployed to the target project
2. `site` includes commit `6183d7c Add site local app-core read path`
3. `api` is still deployed and healthy
4. current app volume is attached to `api`
5. you are prepared for a short write downtime during the volume handoff

## What this cutover actually changes

This cutover makes `site` capable of reading the app SQLite state directly.

It does not yet:

- move write endpoints off `api`
- remove `api`
- move Codex runtime or Discord adapter callers

So the immediate goal is narrower:

- attach the app DB/data root to `site`
- enable `SITE_USE_LOCAL_APP_API=true`
- verify that the admin board and setup state render from `site` directly

## Railway CLI capability

The Railway CLI supports the volume operations needed for this cutover:

- `railway volume list`
- `railway volume detach`
- `railway volume attach`
- `railway volume update`

The volume commands operate in the currently linked project/environment context, and the `volume` command supports service/environment selection.

References:

- https://docs.railway.com/volumes
- https://docs.railway.com/cli

## Live project env changes

Add these env vars to `site` before moving the volume:

```env
SITE_USE_LOCAL_APP_API=true
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
SESSION_SECRET=...
COMMUNITY_PROVIDER=...
PRISM_AGENT_DATA_ROOT=/data
INTERNAL_SERVICE_TOKEN=...
PRISM_MEMORY_BASE_URL=...
PRISM_API_READ_KEY=...     # or PRISM_API_KEY fallback
CODEX_RUNTIME_BASE_URL=...
```

Notes:

- `PRISM_AGENT_DATA_ROOT=/data` assumes the app volume will be mounted at `/data` on `site`
- `ADMIN_PASSWORD` is required because local read mode currently checks the shared admin password directly
- `SESSION_SECRET` is not used by the current local read slice, but if `site` keeps growing toward ownership it belongs there

Leave these in place for now:

```env
NEXT_PUBLIC_API_BASE_URL=...
API_INTERNAL_BASE_URL=...
```

They are still needed because writes continue to flow through `api` during this phase.

## API service state during cutover

Keep `api` deployed.

Do not delete it.

For this phase, `api` remains:

- the write path
- the rollback target

## Project linking

The simplest CLI flow is:

1. work from a dedicated local folder for the target project
2. run `railway link` for that project/environment
3. then run the volume commands in that linked context

If you prefer not to relink your current working directory, use a temporary shell or a disposable directory and link there.

## Step-by-step cutover

### 1. Verify current state

Check service and volume state before touching anything:

```bash
railway status
railway volume list --json
```

Also verify:

- `site` is healthy
- `api` is healthy
- admin page currently works

### 2. Deploy the consolidation branch to `site`

Deploy `site-api-consolidation` to the `site` service.

Do not turn on `SITE_USE_LOCAL_APP_API` yet if `site` cannot see the DB.

### 3. Add the new `site` env vars

Set:

```env
SITE_USE_LOCAL_APP_API=true
PRISM_AGENT_DATA_ROOT=/data
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
SESSION_SECRET=...
COMMUNITY_PROVIDER=...
INTERNAL_SERVICE_TOKEN=...
```

Then redeploy `site`.

At this point, reads will still fail if the DB volume is not mounted on `site`. That is expected.

### 4. Identify the app volume

List volumes and note the one currently attached to `api`:

```bash
railway volume list --json
```

Record:

- volume name or ID
- current mount path

### 5. Pause writes / pick a quiet window

Because SQLite is file-backed, do not let both services act as concurrent writers during the handoff.

Practical rule:

- no active admin changes
- no CR submissions during the switch
- avoid Discord or automation paths that may write app state

### 6. Detach the volume from `api`

```bash
railway volume detach -s <api-service> -e <environment> -v <volume> -y
```

### 7. Attach the same volume to `site`

```bash
railway volume attach -s <site-service> -e <environment> -v <volume> -y
```

### 8. Set the mount path on `site`

If needed, update the mount path to `/data`:

```bash
railway volume update -s <site-service> -e <environment> -v <volume> --mount-path /data
```

### 9. Redeploy or restart `site`

After attach/update, restart `site` so the volume is available in the container:

```bash
railway restart -s <site-service> -e <environment>
```

If Railway requires a redeploy instead:

```bash
railway redeploy -s <site-service> -e <environment>
```

### 10. Verify `site` local-read mode

Check:

1. `/admin`
2. `/admin/memory`
3. board data loads
4. setup status loads

Expected result:

- the admin page loads normally
- `site` can render the change board without calling through `api` for the read slice

### 11. Keep `api` up for writes

Do not delete or disable `api` yet.

At this stage:

- `site` owns the app volume for reads
- `api` still needs to exist until write parity is implemented

If that split proves awkward in practice, that is a signal that the next slice must move writes faster.

## Verification checklist

After the cutover, verify:

1. admin login page works
2. admin board loads
3. target apps list loads
4. target environments list loads
5. setup status loads
6. memory explorer still loads
7. change request create/edit flows still work
8. Codex runtime still reaches its current write endpoints through `api`
9. Discord adapter flows still work

## Rollback

If `site` fails after the volume move:

1. set `SITE_USE_LOCAL_APP_API=false` on `site`
2. detach the app volume from `site`
3. reattach the volume to `api`
4. mount it back at the previous path
5. restart `api`
6. confirm admin pages work through the old split path again

Rollback commands are the inverse:

```bash
railway volume detach -s <site-service> -e <environment> -v <volume> -y
railway volume attach -s <api-service> -e <environment> -v <volume> -y
railway volume update -s <api-service> -e <environment> -v <volume> --mount-path /data
railway restart -s <api-service> -e <environment>
```

Use the original mount path if it was not `/data`.

## Template updates after live projects are proven

Do not update the template first.

First prove the cutover on the two live projects.

After both pass, update the template:

### Services

- keep `site`
- keep `api` during transition template version if you want a rollback path
- or remove `api` only after writer parity exists

### `site` env additions

Add:

```env
SITE_USE_LOCAL_APP_API=true
PRISM_AGENT_DATA_ROOT=/data
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
SESSION_SECRET=...
COMMUNITY_PROVIDER=...
INTERNAL_SERVICE_TOKEN=...
```

Keep:

```env
PRISM_MEMORY_BASE_URL=...
PRISM_API_READ_KEY=...
CODEX_RUNTIME_BASE_URL=...
NEXT_PUBLIC_API_BASE_URL=...
API_INTERNAL_BASE_URL=...
```

until the write-path migration is complete.

### Volume wiring

If `site` is taking over app-core reads, the app SQLite/data volume should be mounted on `site` at:

```text
/data
```

and `PRISM_AGENT_DATA_ROOT=/data`.

### Future template cleanup

Only after writer parity and caller repoints are done:

- remove `api` from the template
- remove `NEXT_PUBLIC_API_BASE_URL` / `API_INTERNAL_BASE_URL` split assumptions
- move remaining internal callers from `api` to `site`

## Current recommendation

For the next step:

1. use this checklist on one live project
2. record actual friction:
   - env churn
   - volume handoff behavior
   - whether keeping `api` alive without the volume is acceptable
3. decide whether the second phase should:
   - move writes quickly, or
   - pause and keep the current split longer

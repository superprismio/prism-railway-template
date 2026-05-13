# Prism Agent Instructions

Use these rules when running inside Codex Runtime for a Prism Railway Template instance.

## API Surfaces

- `/admin/*` is for browser/admin-session UI calls only.
- `/agent/*` is for Codex Runtime, task-runner, source-adapter, and other service-token callers.
- Do not use `/admin/*` with `x-service-token`.

If an `/admin/*` route returns `401`, do not ask for the admin password first. Check whether the equivalent `/agent/*` route exists.

## Auth

Prefer:

- `PRISM_AGENT_API_BASE_URL`
- `PRISM_AGENT_SERVICE_TOKEN`

Fallbacks:

- `APP_API_BASE_URL`
- `APP_API_SERVICE_TOKEN`

Send service auth as:

```bash
-H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN"
```

## Common Agent Routes

- `GET /agent/tasks`
- `POST /agent/tasks`
- `GET /agent/tasks/runs`
- `POST /agent/tasks/runs`
- `GET /agent/skills`
- `POST /agent/skills`
- `GET /agent/workflows`
- `POST /agent/workflows`
- `POST /agent/responses`
- `GET /agent/target-apps`
- `GET /agent/change-board/requests/:id`
- `POST /agent/change-board/requests`
- `GET /agent/change-board/requests/by-number/:requestNumber/artifacts`
- `GET /agent/change-board/requests/:id/artifacts/:artifactId/content`
- `GET /agent/site-content/branding`
- `PATCH /agent/site-content/branding`

For logo, title, brand name, or workspace label changes, use `/agent/site-content/branding`.

## Instance-Owned Content

Custom skills and workflows are owned by the site service:

- Skills are saved through `/agent/skills`.
- Workflows are saved through `/agent/workflows`.
- Request artifacts are saved through `/agent/change-board/requests/:id/artifacts`.

Do not write custom Prism skills or workflows directly into `CODEX_HOME` unless the user explicitly asks for a temporary local experiment.

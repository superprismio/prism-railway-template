# GitHub-Backed Skills And Workflows

## Status

Planned / future.

This captures a follow-up idea after testing the first generation of Prism
instance skills and workflows. The immediate use case is the Raid Guild skill
repository:

```txt
https://github.com/raid-guild/agent-skills
```

with skills under:

```txt
skills/
```

## Problem

Prism currently supports:

- template-shipped skills from the Prism template repo,
- instance-owned custom skills stored by the site service,
- template/system workflows and instance-owned custom workflows.

That is useful for local customization, but it is awkward for communities that
want to maintain a library of reusable skills and workflows in GitHub with
normal review, history, and branch protection.

Copying each `SKILL.md` or workflow into an instance by API works, but it loses
the source-of-truth relationship. Editing GitHub content through the Prism UI
would also create ownership confusion.

## Goals

- Allow Prism instances to reference one or more GitHub repositories as
  read-only sources for skills and workflows.
- Keep GitHub as the source of truth for source-backed skills and workflows.
- Let Prism sync, validate, list, and serve those assets through existing
  `/agent/*` routes.
- Preserve instance-owned custom skills and workflows for local experiments and
  one-off customization.
- Show sync status, source repo, branch, path, commit SHA, and validation errors
  in the admin UI.

## Non-Goals

- Do not make Codex Runtime clone arbitrary skill/workflow repositories directly.
- Do not let the Prism UI edit GitHub-backed skills or workflows in place.
- Do not replace custom instance skills/workflows.
- Do not automatically enable newly synced workflows without validation.
- Do not treat GitHub-backed workflow content as trusted just because it synced.

## Source Model

Use a shared source concept for managed content:

```ts
type ManagedContentSource = {
  key: string
  kind: "skills" | "workflows"
  provider: "github"
  repoUrl: string
  branch: string
  path: string
  enabled: boolean
  syncMode: "mirror"
  lastSyncedAt: string | null
  lastCommitSha: string | null
  lastError: string | null
}
```

Example skill source:

```json
{
  "key": "raid-guild-agent-skills",
  "kind": "skills",
  "provider": "github",
  "repoUrl": "https://github.com/raid-guild/agent-skills.git",
  "branch": "main",
  "path": "skills",
  "enabled": true,
  "syncMode": "mirror"
}
```

Example workflow source:

```json
{
  "key": "raid-guild-agent-workflows",
  "kind": "workflows",
  "provider": "github",
  "repoUrl": "https://github.com/raid-guild/agent-skills.git",
  "branch": "main",
  "path": "workflows",
  "enabled": true,
  "syncMode": "mirror"
}
```

## Repository Shape

### Skills

Use the existing Codex skill shape:

```txt
skills/
  rg-crm-ops/
    SKILL.md
  rg-public-output-safety/
    SKILL.md
```

Each directory name should match the `name` in `SKILL.md` frontmatter.

### Workflows

Use a directory per workflow:

```txt
workflows/
  crm-document-intake/
    manifest.json
    workflow.md
    steps/
      intake.md
      enrich.md
      review.md
```

The manifest should match Prism's custom workflow shape:

```json
{
  "key": "crm-document-intake",
  "name": "CRM Document Intake",
  "entrypoint": "intake",
  "workflowPath": "workflow.md",
  "steps": [
    {
      "key": "intake",
      "label": "Intake",
      "type": "agent",
      "instructionPath": "steps/intake.md",
      "next": "enrich"
    }
  ]
}
```

## Storage And Sync

The site service should own syncing. Codex Runtime should continue to discover
and download skills/workflows through Prism's `/agent/*` routes.

Suggested local cache:

```txt
/data/prism/content-sources/
  raid-guild-agent-skills/
    checkout/
    synced/
```

Sync behavior:

1. Clone or fetch the configured repo and branch.
2. Read only the configured `path`.
3. Validate discovered content.
4. Mirror valid content into a read-only synced cache.
5. Record `lastSyncedAt`, `lastCommitSha`, counts, and validation errors.
6. Leave the last successful synced cache in place if a later sync fails.

## Merge Order

Skills should be listed in this order:

1. template built-ins,
2. GitHub-backed source skills,
3. instance custom skills.

Workflows should use the same conceptual order:

1. template/system workflows,
2. GitHub-backed source workflows,
3. instance custom workflows.

Conflict policy should be explicit. Recommended first behavior:

- Built-ins win over GitHub sources with the same key/name.
- Earlier enabled source wins over later sources with the same key/name.
- Instance custom content cannot silently override a GitHub-backed key unless an
  admin explicitly chooses an override policy later.

## Validation

### Skill Validation

- Directory name is a valid skill name.
- `SKILL.md` exists.
- Frontmatter includes `name`.
- Frontmatter `name` matches the directory name.
- Skill name does not conflict with a higher-priority source.
- Markdown size is bounded.

### Workflow Validation

Workflow validation should be stricter than skill validation:

- `manifest.json` exists and parses.
- `manifest.key` matches the workflow directory name.
- `entrypoint` exists in `steps`.
- Every `instructionPath` and `workflowPath` exists within the workflow
  directory.
- No path escapes the workflow directory.
- Every `next` target exists.
- Every route target exists.
- Step keys are unique.
- Step types are supported.
- New or changed workflows can be synced but should be disabled until reviewed
  if the instance requires human approval.

## API Surface

Prefer `/agent/*` service-token routes and matching `/admin/*` browser routes.

Suggested service routes:

```txt
GET /agent/content-sources
POST /agent/content-sources
GET /agent/content-sources/:key
PATCH /agent/content-sources/:key
DELETE /agent/content-sources/:key
POST /agent/content-sources/:key/sync
```

Optional kind-specific aliases:

```txt
GET /agent/skill-sources
POST /agent/skill-sources
POST /agent/skill-sources/:key/sync

GET /agent/workflow-sources
POST /agent/workflow-sources
POST /agent/workflow-sources/:key/sync
```

Existing routes should include source metadata:

```txt
GET /agent/skills
GET /agent/workflows
```

Example skill list entry:

```json
{
  "name": "rg-crm-ops",
  "kind": "source",
  "source": "github",
  "sourceKey": "raid-guild-agent-skills",
  "repoUrl": "https://github.com/raid-guild/agent-skills.git",
  "branch": "main",
  "commitSha": "abc123",
  "readOnly": true
}
```

## Admin UI

Add a Sources view under Skills and Workflows, or a shared "Content Sources"
settings panel.

Operators should be able to:

- register a GitHub repo, branch, and path,
- trigger sync,
- see last sync time and commit SHA,
- see discovered skill/workflow counts,
- inspect validation errors,
- disable a source without deleting its config,
- download or view source-backed `SKILL.md` and workflow files as read-only.

## Security And Operations

- Only allow HTTPS GitHub URLs.
- Use existing GitHub token configuration for private repositories.
- Never expose tokens in sync errors.
- Bound clone depth and content size.
- Validate paths before reading files from synced checkouts.
- Consider requiring admin confirmation before enabling GitHub-backed workflows.
- Keep sync logs/audit events for source changes.

## Implementation Plan

1. Add persistent content-source configuration and sync status.
2. Implement GitHub sync service for read-only skill sources.
3. Merge synced skill cache into `listHostedSkills`, `readHostedSkillMarkdown`,
   and skill archive downloads.
4. Add admin UI for skill sources and manual sync.
5. Add workflow-source sync with strict manifest/file validation.
6. Merge validated source workflows into workflow listing and lookup.
7. Add admin UI for workflow sources, validation errors, and enablement.
8. Add scheduled sync through the task runner.

## Open Questions

- Should skill and workflow sources share one table or use separate tables?
- Should source-backed workflows be imported into the `workflows` table or read
  from a synced cache at runtime?
- Should instance custom content be allowed to override GitHub-backed content?
- Should sync happen on a schedule, webhook, manual action, or all three?
- Should GitHub-backed workflows require a human gate before first enablement?

---
name: prism-skill-author
description: Use this skill when Codex is asked to create, update, install, or manage custom Prism/Codex skills for an instance.
---

Use this skill to create or update instance custom skills.

Custom skill definitions are owned by the site service and stored under `/data/skills/<skill-name>/SKILL.md`. Do not write custom skill definitions into `CODEX_HOME` unless the user explicitly asks for a temporary local experiment.

## Rules

1. Use lowercase kebab-case names: `example-skill`.
2. Store only skill instructions in `SKILL.md`.
3. Keep executable scripts, checkpoints, and generated outputs outside the skill folder, usually under `/data/custom/<experiment>/...` if they must run from `codex-runtime`.
4. Use the site internal skill endpoint when `PRISM_AGENT_API_BASE_URL` and `PRISM_AGENT_SERVICE_TOKEN` are available.
5. Keep new skills disabled-by-convention until a task or prompt explicitly requests them.
6. For a broad credential-backed integration, declare its profile under
   `metadata.gateway-toolsets` once that profile exists. Use
   `metadata.gateway-capabilities` only for existing narrow compatibility
   wrappers. Do not duplicate either list in every workflow. Custom top-level
   frontmatter keys are not valid Codex skill metadata.

In deployed Prism instances, Codex Runtime usually receives `APP_API_BASE_URL` and `APP_API_SERVICE_TOKEN`, then exposes them to Codex as `PRISM_AGENT_API_BASE_URL` and `PRISM_AGENT_SERVICE_TOKEN`. If the `PRISM_*` names are missing, check the `APP_*` names before concluding the API is unavailable.

Do not use browser admin routes from Codex Runtime. Custom skill writes should go through `/agent/skills` with `x-service-token`.

## Save A Custom Skill

POST the complete `SKILL.md` content:

```bash
curl -fsSL \
  -X POST \
  -H "content-type: application/json" \
  -H "x-service-token: $PRISM_AGENT_SERVICE_TOKEN" \
  "$PRISM_AGENT_API_BASE_URL/agent/skills" \
  -d @skill-payload.json
```

Payload shape:

```json
{
  "name": "example-skill",
  "content": "---\nname: example-skill\ndescription: Use this skill when...\nmetadata:\n  gateway-capabilities:\n    - example.read\n---\n\nSkill instructions go here.\n"
}
```

After saving, the skill appears in the admin Skills tab and can be requested by tasks through `instructionConfig.requestedSkills`.

Gateway requirements are dependencies, not downstream permissions by
themselves. Site/source policy assigns a toolset to the job; the downstream
identity remains authoritative for RBAC. Keep legacy environment-variable
fallback until the profile or compatibility capability has been tested by every
enabled workflow/task/hook and interactive path that uses the skill.

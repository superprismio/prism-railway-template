# Member Roles

Early direction for adding multiple signed-in users to the site admin surface.

## Goal

Support authenticated members with limited read-only workspace access, moderators with day-to-day operational access, and admins with full instance ownership controls.

## Roles

- `admin`: instance owner/operator. Full UI access, including settings, users, roles, tasks, workflows, skills, memory sources, request state, and dangerous actions. Admins may also have Railway access, but the app should not depend on Railway access for authorization.
- `moderator`: day-to-day workspace operator. Can manage requests, workflow runs, content review, memory moderation, and approved operational actions. Moderators should not manage users, roles, auth settings, secrets, or low-level instance settings.
- `member`: authenticated read-mostly user. Can view selected memory, requests, artifacts, and possibly create/comment on requests depending on workspace policy. Members cannot run privileged agents or mutate system config by default.

Avoid treating `moderator` as "full UI access except Railway." The useful distinction is operational access without ownership/security settings.

## Capabilities

Implement route and UI checks around capabilities rather than hardcoding every decision directly to role names.

Initial capabilities:

- `canViewWorkspace`
- `canViewMemory`
- `canViewRequests`
- `canCreateRequest`
- `canComment`
- `canRunAgent`
- `canManageTasks`
- `canManageWorkflows`
- `canManageSkills`
- `canManageMemorySources`
- `canManageSettings`
- `canManageUsers`

The UI should hide or disable controls based on capabilities, but route/API enforcement must be the source of truth.

## Management UI

Add an admin-only `Members & Roles` section under Settings.

Initial controls:

- list users with display name, email, roles, last seen, and status
- create or invite a member by email
- update roles
- disable or enable an account
- reset a temporary password or generate an invite link

## Implementation Notes

Existing tables already include `users`, `roles`, and `user_roles`, and bootstrap seeds `admin`, `moderator`, and `member`. The missing foundation is a user-aware signed session that carries `userId` and `roleSlugs`.

## Implementation Checklist

First slice:

- [x] Document the initial role model and capability vocabulary.
- [x] Add a shared role-to-capabilities helper.
- [x] Store `userId` and `roleSlugs` in the signed admin session payload.
- [x] Keep legacy anonymous admin session cookies valid as transitional admin sessions.
- [x] Add `requireAdminAccess()`, `requireModeratorAccess()`, and `requireMemberAccess()` helpers.
- [x] Keep service-to-service APIs on service-token auth.
- [x] Gate initial request read endpoints behind member access and operational routes behind moderator access.
- [x] Add first read-only member UI state by hiding mutation-heavy tabs and workflow controls.

Follow-up slice:

- [x] Add the Settings `Members & Roles` UI.
- [x] Add manual-copy invite/reset links.
- [ ] Add audit visibility for role changes and privileged actions.
- [ ] Add role-aware Prism Console action checks.
- [ ] Add finer-grained API route coverage for every mutation endpoint.

## Later Adapter Permissions

Discord and other source adapters need a separate permission layer later. People can chat with the Discord bot in a way that resembles the Prism Console, so adapter-triggered actions should eventually understand both channel policy and user role.

Keep these concepts separate:

- User role permissions: what a signed-in person can do in the Prism UI/API.
- Adapter scope permissions: which Discord/Slack/Telegram/etc. channels the bot can read or write.
- Agent action permissions: what Codex is allowed to do when invoked from a channel, console, task, or workflow.

The first role slice should not own Discord channel policy. For now, Discord server admins control where the bot is present and what it can read. A later Prism-side policy could look like:

```json
{
  "adapter": "discord",
  "channelId": "123",
  "readAllowed": true,
  "writeAllowed": true,
  "allowedRoles": ["admin", "moderator"],
  "allowedActions": ["ask", "create-request", "run-task"]
}
```

## Prism Console

Prism Console should become role-aware:

- `admin`: full console, including config/workflow/task changes.
- `moderator`: operational console, including approved workflow/task actions.
- `member`: question-answering and possibly request creation/commenting, but no privileged system actions.

The console and Discord bot should eventually share the same action permission checks.

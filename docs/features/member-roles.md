# Member Roles Notes

Early direction for adding multiple signed-in users to the site admin surface.

## Goal

Support authenticated members with a limited read-only workspace while keeping full write access restricted to admins.

## Roles

- `admin`: full access to current admin workspace actions.
- `member`: authenticated read-only access to selected workspace views.
- `moderator`: seeded role reserved for future review-oriented permissions.

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

Recommended order:

1. Replace the anonymous admin session payload with a user session payload.
2. Add access helpers such as `requireAdminAccess()` and `requireMemberAccess()`.
3. Gate mutating admin routes behind admin access.
4. Keep member access read-only in the UI by hiding or disabling mutation controls.
5. Add the Settings role-management UI after the route-level guards exist.

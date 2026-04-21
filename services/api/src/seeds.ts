import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { getDb, runMigrations } from './db.js';
import { getDefaultHomeModules } from './home-modules.js';
import { bootstrapAdminAccount, bootstrapTargetApps } from './bootstrap.js';

interface SkillSeedRow {
  idx: number;
  skill: string;
  category?: string;
}

interface CommunityRoleSeedRow {
  idx: number;
  role: string;
  type?: string;
  description?: string;
  category?: string;
}

interface ProfileSeedRow {
  idx: number;
  user_id?: string | null;
  handle: string;
  display_name: string;
  bio?: string | null;
  avatar_url?: string | null;
  wallet_address?: string | null;
  email?: string | null;
  links?: unknown[] | null;
  cohorts?: string[] | null;
  skills?: string[] | null;
  roles?: string[] | null;
  location?: string | null;
  contact?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

interface SeedDatabaseOptions {
  profilesPath?: string | null;
  includeCatalog?: boolean;
  includeDemo?: boolean;
  includeProfiles?: boolean;
}

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function preserveImportedHandle(input: string) {
  return input.trim();
}

function readJsonFile<T>(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function resolveOptionalProfilesPath(input: string | null | undefined) {
  if (!input?.trim()) {
    return null;
  }

  return path.resolve(input.trim());
}

function ensureUniqueHandle(
  baseHandle: string,
  reservedUserId?: string,
  normalizer: (input: string) => string = preserveImportedHandle,
) {
  const db = getDb();
  const normalized = normalizer(baseHandle) || 'member';
  let handle = normalized;
  let suffix = 1;

  while (true) {
    const existing = db.prepare('SELECT user_id FROM profiles WHERE handle = ?').get(handle) as
      | { user_id: string | null }
      | undefined;

    if (!existing || (reservedUserId && existing.user_id === reservedUserId)) {
      return handle;
    }

    suffix += 1;
    handle = `${normalized}-${suffix}`;
  }
}

export async function seedDatabase(options: SeedDatabaseOptions = {}) {
  const config = loadConfig();
  const db = getDb();
  runMigrations(db);

  const includeCatalog = options.includeCatalog !== false;
  const includeDemo = options.includeDemo !== false;
  const includeProfiles = options.includeProfiles !== false;
  const skillsPath = path.resolve(config.docsDataDir, 'skills.default.json');
  const communityRolesPath = path.resolve(config.docsDataDir, 'community-roles.default.json');
  const profilesPath = resolveOptionalProfilesPath(options.profilesPath);
  const skills = includeCatalog ? readJsonFile<SkillSeedRow[]>(skillsPath) : [];
  const communityRoles = includeCatalog ? readJsonFile<CommunityRoleSeedRow[]>(communityRolesPath) : [];
  const profiles = includeProfiles && profilesPath ? readJsonFile<ProfileSeedRow[]>(profilesPath) : [];
  const now = new Date().toISOString();
  const adminBootstrap = await bootstrapAdminAccount();
  const targetBootstrap = bootstrapTargetApps();

  const transaction = db.transaction(() => {
    const upsertRole = db.prepare(
      `INSERT INTO roles (slug, label, description, created_at, updated_at)
       VALUES (@slug, @label, @description, @createdAt, @updatedAt)
       ON CONFLICT(slug) DO UPDATE SET
         label = excluded.label,
         description = excluded.description,
         updated_at = excluded.updated_at`,
    );

    const upsertSkill = db.prepare(
      `INSERT INTO skills_catalog (slug, label, category, description, is_default, is_active)
       VALUES (@slug, @label, @category, @description, 1, 1)
       ON CONFLICT(slug) DO UPDATE SET
         label = excluded.label,
         category = excluded.category,
         description = excluded.description,
         is_active = 1`,
    );

    const upsertCommunityRole = db.prepare(
      `INSERT INTO community_roles_catalog (slug, label, category, skill_type, description, is_default, is_active)
       VALUES (@slug, @label, @category, @skillType, @description, 1, 1)
       ON CONFLICT(slug) DO UPDATE SET
         label = excluded.label,
         category = excluded.category,
         skill_type = excluded.skill_type,
         description = excluded.description,
         is_active = 1`,
    );

    if (includeCatalog) {
      for (const skill of skills) {
        upsertSkill.run({
          slug: slugify(skill.skill),
          label: skill.skill.trim(),
          category: skill.category?.trim() || null,
          description: null,
        });
      }

      for (const role of communityRoles) {
        upsertCommunityRole.run({
          slug: slugify(role.role),
          label: role.role.trim(),
          category: role.category?.trim() || null,
          skillType: role.type?.trim() || null,
          description: role.description?.trim() || null,
        });
      }
    }

    const skillIds = new Map(
      (db.prepare('SELECT id, label FROM skills_catalog').all() as Array<{ id: number; label: string }>).map((row) => [
        row.label,
        row.id,
      ]),
    );
    const communityRoleIds = new Map(
      (
        db.prepare('SELECT id, label FROM community_roles_catalog').all() as Array<{
          id: number;
          label: string;
        }>
      ).map((row) => [row.label, row.id]),
    );

    const upsertUser = db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at, updated_at, last_seen_at, is_seeded)
       VALUES (@id, @email, @passwordHash, @createdAt, @updatedAt, @lastSeenAt, @isSeeded)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         updated_at = excluded.updated_at,
         last_seen_at = excluded.last_seen_at,
         is_seeded = excluded.is_seeded`,
    );

    const upsertProfile = db.prepare(
      `INSERT INTO profiles (
         id, user_id, handle, display_name, bio, avatar_url, wallet_address, email,
         links_json, skills_json, cohorts_json, location, contact_json, visibility,
         visibility_json, seed_source, seed_external_id, seeded_at, claimed_at, created_at, updated_at
       ) VALUES (
         @id, @userId, @handle, @displayName, @bio, @avatarUrl, @walletAddress, @email,
         @linksJson, @skillsJson, @cohortsJson, @location, @contactJson, @visibility,
         @visibilityJson, @seedSource, @seedExternalId, @seededAt, @claimedAt, @createdAt, @updatedAt
       )
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         handle = excluded.handle,
         display_name = excluded.display_name,
         bio = excluded.bio,
         avatar_url = excluded.avatar_url,
         wallet_address = excluded.wallet_address,
         email = excluded.email,
         links_json = excluded.links_json,
         skills_json = excluded.skills_json,
         cohorts_json = excluded.cohorts_json,
         location = excluded.location,
         contact_json = excluded.contact_json,
         visibility = excluded.visibility,
         visibility_json = excluded.visibility_json,
         seed_source = excluded.seed_source,
         seed_external_id = excluded.seed_external_id,
         seeded_at = excluded.seeded_at,
         updated_at = excluded.updated_at`,
    );

    const upsertUserSkill = db.prepare(
      `INSERT INTO user_skills (user_id, skill_id, proficiency, created_at)
       VALUES (?, ?, NULL, ?)
       ON CONFLICT(user_id, skill_id) DO NOTHING`,
    );

    const upsertUserCommunityRole = db.prepare(
      `INSERT INTO user_community_roles (user_id, community_role_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, community_role_id) DO NOTHING`,
    );

    if (includeProfiles && profilesPath) {
      for (const profile of profiles) {
        const userId = profile.user_id?.trim() || randomUUID();
        const createdAt = profile.created_at || now;
        const updatedAt = profile.updated_at || createdAt;
        const handle = ensureUniqueHandle(profile.handle, userId, preserveImportedHandle);
        const email = profile.email?.trim().toLowerCase() || null;

        upsertUser.run({
          id: userId,
          email,
          passwordHash: null,
          createdAt,
          updatedAt,
          lastSeenAt: updatedAt,
          isSeeded: 1,
        });

        upsertProfile.run({
          id: userId,
          userId,
          handle,
          displayName: profile.display_name.trim(),
          bio: profile.bio || null,
          avatarUrl: profile.avatar_url || null,
          walletAddress: profile.wallet_address || null,
          email,
          linksJson: JSON.stringify(profile.links ?? []),
          skillsJson: JSON.stringify(profile.skills ?? []),
          cohortsJson: JSON.stringify(profile.cohorts ?? []),
          location: profile.location || null,
          contactJson: JSON.stringify(profile.contact ?? {}),
          visibility: 'public',
          visibilityJson: JSON.stringify({}),
          seedSource: 'manual-profile-import',
          seedExternalId: String(profile.idx ?? userId),
          seededAt: createdAt,
          claimedAt: null,
          createdAt,
          updatedAt,
        });

        for (const skillLabel of profile.skills ?? []) {
          const skillId = skillIds.get(skillLabel);
          if (skillId) {
            upsertUserSkill.run(userId, skillId, createdAt);
          }
        }

        for (const communityRoleLabel of profile.roles ?? []) {
          const communityRoleId = communityRoleIds.get(communityRoleLabel);
          if (communityRoleId) {
            upsertUserCommunityRole.run(userId, communityRoleId, createdAt);
          }
        }
      }
    }

    const upsertHomeModule = db.prepare(
      `INSERT INTO home_modules (id, type, config_json, enabled, display_order, visibility_role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         config_json = excluded.config_json,
         enabled = excluded.enabled,
         display_order = excluded.display_order,
         visibility_role = excluded.visibility_role,
         updated_at = excluded.updated_at`,
    );

    for (const moduleDefinition of getDefaultHomeModules()) {
      upsertHomeModule.run(
        moduleDefinition.id,
        moduleDefinition.type,
        JSON.stringify(moduleDefinition.defaultConfig),
        moduleDefinition.defaultEnabled ? 1 : 0,
        moduleDefinition.defaultDisplayOrder,
        moduleDefinition.defaultVisibilityRole,
        now,
        now,
      );
    }

    if (includeDemo) {
      const upsertChangeRequest = db.prepare(
        `INSERT INTO admin_change_requests (
           id, request_type, title, state, priority, payload_json,
           requested_by_user_id, assigned_to_user_id, resolution_note,
           created_at, updated_at, resolved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           request_type = excluded.request_type,
           title = excluded.title,
           state = excluded.state,
           priority = excluded.priority,
           payload_json = excluded.payload_json,
           requested_by_user_id = excluded.requested_by_user_id,
           assigned_to_user_id = excluded.assigned_to_user_id,
           resolution_note = excluded.resolution_note,
           updated_at = excluded.updated_at,
           resolved_at = excluded.resolved_at`,
      );

      upsertChangeRequest.run(
        'seed-change-request-points',
        'points_adjustment',
        'Award orientation points to first-week members',
        'pending',
        'high',
        JSON.stringify({
          requestedAction: 'grant_points',
          reason: 'Kick off the leaderboard after onboarding week.',
          suggestedDelta: 10,
        }),
        null,
        null,
        null,
        now,
        now,
        null,
      );

      upsertChangeRequest.run(
        'seed-change-request-design',
        'design_update',
        'Refine admin badges and status chips in the moderation table',
        'opened',
        'normal',
        JSON.stringify({
          requestedAction: 'ui_update',
          target: 'admin_board',
          notes: 'Use clearer color and spacing for moderation states.',
        }),
        null,
        null,
        null,
        now,
        now,
        null,
      );
    }
  });

  transaction();

  return {
    skillsSeeded: skills.length,
    communityRolesSeeded: communityRoles.length,
    profilesSeeded: profiles.length,
    profilesSource: profilesPath,
    includeCatalog,
    includeDemo,
    includeProfiles,
    adminEmail: adminBootstrap.adminEmail,
    targetAppsSeeded: targetBootstrap.targetAppsSeeded,
    targetEnvironmentsSeeded: targetBootstrap.targetEnvironmentsSeeded,
  };
}

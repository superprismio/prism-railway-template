import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"

import { loadConfig } from "./config"
import { getDb, runMigrations } from "./db"

const { hash } = bcrypt

export interface TargetAppBootstrapRecord {
  id: string
  slug: string
  name: string
  description?: string | null
  repoUrl?: string | null
  repoProvider?: string | null
  defaultBranch?: string | null
  framework?: string | null
  deployBackend: string
  deployConfig?: Record<string, unknown>
  agentEnabled?: boolean
}

export interface TargetEnvironmentBootstrapRecord {
  id: string
  targetAppId: string
  slug: string
  name: string
  kind: string
  branch?: string | null
  baseUrl?: string | null
  deployBackend: string
  deployConfig?: Record<string, unknown>
  agentWritable?: boolean
  autoDeployEnabled?: boolean
  humanReviewRequired?: boolean
  isDefaultForAgent?: boolean
}

export interface TargetBootstrapManifest {
  targetApps: TargetAppBootstrapRecord[]
  targetEnvironments: TargetEnvironmentBootstrapRecord[]
}

function readJsonFile<T>(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T
}

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function defaultManifestPath() {
  return path.resolve(process.cwd(), "config/target-apps.default.json")
}

export function loadTargetBootstrapManifest(manifestPath?: string | null) {
  return readJsonFile<TargetBootstrapManifest>(
    path.resolve(manifestPath?.trim() || defaultManifestPath()),
  )
}

export async function bootstrapAdminAccount() {
  const config = loadConfig()
  const db = getDb()
  runMigrations(db)

  const now = new Date().toISOString()
  const adminPasswordHash = await hash(config.adminPassword, 10)

  const transaction = db.transaction(() => {
    const upsertRole = db.prepare(
      `INSERT INTO roles (slug, label, description, created_at, updated_at)
       VALUES (@slug, @label, @description, @createdAt, @updatedAt)
       ON CONFLICT(slug) DO UPDATE SET
         label = excluded.label,
         description = excluded.description,
         updated_at = excluded.updated_at`,
    )

    for (const role of [
      { slug: "admin", label: "Admin", description: "Full administrative access." },
      { slug: "moderator", label: "Moderator", description: "Moderation and review access." },
      { slug: "member", label: "Member", description: "Standard authenticated member access." },
    ]) {
      upsertRole.run({ ...role, createdAt: now, updatedAt: now })
    }

    const adminEmail = config.adminEmail
    const existingAdminUser = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail) as
      | { id: string }
      | undefined
    const adminUserId = existingAdminUser?.id || randomUUID()
    const adminHandle = slugify(adminEmail.split("@")[0] || "admin") || "admin"

    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at, updated_at, last_seen_at, is_seeded)
       VALUES (@id, @email, @passwordHash, @createdAt, @updatedAt, @lastSeenAt, 0)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         password_hash = excluded.password_hash,
         updated_at = excluded.updated_at,
         last_seen_at = excluded.last_seen_at`,
    ).run({
      id: adminUserId,
      email: adminEmail,
      passwordHash: adminPasswordHash,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    })

    db.prepare(
      `INSERT INTO profiles (
         id, user_id, handle, display_name, bio, avatar_url, wallet_address, email,
         links_json, skills_json, cohorts_json, location, contact_json, visibility,
         visibility_json, seed_source, seed_external_id, seeded_at, claimed_at, created_at, updated_at
       ) VALUES (
         @id, @userId, @handle, @displayName, @bio, NULL, NULL, @email,
         '[]', '[]', '[]', NULL, '{}', 'private', '{}', NULL, NULL, NULL, @claimedAt, @createdAt, @updatedAt
       )
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         handle = excluded.handle,
         display_name = excluded.display_name,
         bio = excluded.bio,
         email = excluded.email,
         claimed_at = excluded.claimed_at,
         updated_at = excluded.updated_at`,
    ).run({
      id: adminUserId,
      userId: adminUserId,
      handle: adminHandle,
      displayName: "Administrator",
      bio: "Template admin account.",
      email: adminEmail,
      claimedAt: now,
      createdAt: now,
      updatedAt: now,
    })

    const adminRoleId = (db.prepare("SELECT id FROM roles WHERE slug = 'admin'").get() as { id: number }).id
    const memberRoleId = (db.prepare("SELECT id FROM roles WHERE slug = 'member'").get() as { id: number }).id

    const upsertUserRole = db.prepare(
      `INSERT INTO user_roles (user_id, role_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, role_id) DO NOTHING`,
    )

    upsertUserRole.run(adminUserId, adminRoleId, now)
    upsertUserRole.run(adminUserId, memberRoleId, now)
  })

  transaction()

  return {
    adminEmail: config.adminEmail,
    bootstrappedAt: now,
  }
}

export function bootstrapTargetApps(manifestPath?: string | null) {
  const db = getDb()
  runMigrations(db)
  const manifest = loadTargetBootstrapManifest(manifestPath)
  const now = new Date().toISOString()

  const transaction = db.transaction(() => {
    const upsertTargetApp = db.prepare(
      `INSERT INTO target_apps (
         id, slug, name, description, repo_url, repo_provider, default_branch, framework,
         deploy_backend, deploy_config_json, agent_enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         slug = excluded.slug,
         name = excluded.name,
         description = excluded.description,
         repo_url = excluded.repo_url,
         repo_provider = excluded.repo_provider,
         default_branch = excluded.default_branch,
         framework = excluded.framework,
         deploy_backend = excluded.deploy_backend,
         deploy_config_json = excluded.deploy_config_json,
         agent_enabled = excluded.agent_enabled,
         updated_at = excluded.updated_at`,
    )

    for (const targetApp of manifest.targetApps) {
      upsertTargetApp.run(
        targetApp.id,
        targetApp.slug,
        targetApp.name,
        targetApp.description ?? null,
        targetApp.repoUrl ?? null,
        targetApp.repoProvider ?? null,
        targetApp.defaultBranch ?? "main",
        targetApp.framework ?? null,
        targetApp.deployBackend,
        JSON.stringify(targetApp.deployConfig ?? {}),
        targetApp.agentEnabled === false ? 0 : 1,
        now,
        now,
      )
    }

    const upsertTargetEnvironment = db.prepare(
      `INSERT INTO target_environments (
         id, target_app_id, slug, name, kind, branch, base_url, deploy_backend,
         deploy_config_json, agent_writable, auto_deploy_enabled, human_review_required,
         is_default_for_agent, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         target_app_id = excluded.target_app_id,
         slug = excluded.slug,
         name = excluded.name,
         kind = excluded.kind,
         branch = excluded.branch,
         base_url = excluded.base_url,
         deploy_backend = excluded.deploy_backend,
         deploy_config_json = excluded.deploy_config_json,
         agent_writable = excluded.agent_writable,
         auto_deploy_enabled = excluded.auto_deploy_enabled,
         human_review_required = excluded.human_review_required,
         is_default_for_agent = excluded.is_default_for_agent,
         updated_at = excluded.updated_at`,
    )

    for (const targetEnvironment of manifest.targetEnvironments) {
      upsertTargetEnvironment.run(
        targetEnvironment.id,
        targetEnvironment.targetAppId,
        targetEnvironment.slug,
        targetEnvironment.name,
        targetEnvironment.kind,
        targetEnvironment.branch ?? null,
        targetEnvironment.baseUrl ?? null,
        targetEnvironment.deployBackend,
        JSON.stringify(targetEnvironment.deployConfig ?? {}),
        targetEnvironment.agentWritable === false ? 0 : 1,
        targetEnvironment.autoDeployEnabled === true ? 1 : 0,
        targetEnvironment.humanReviewRequired === false ? 0 : 1,
        targetEnvironment.isDefaultForAgent === true ? 1 : 0,
        now,
        now,
      )
    }
  })

  transaction()

  return {
    targetAppCount: manifest.targetApps.length,
    targetEnvironmentCount: manifest.targetEnvironments.length,
    bootstrappedAt: now,
  }
}

import { closeDb } from "../lib/app-core"
import { bootstrapTargetApps } from "../lib/app-core/bootstrap"

const manifestPath = process.argv[2]?.trim() || process.env.TARGET_APPS_MANIFEST?.trim() || null

try {
  const result = bootstrapTargetApps(manifestPath)
  console.log(JSON.stringify({ ok: true, ...result }, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  closeDb()
}

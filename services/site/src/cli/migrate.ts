import { closeDb, runMigrations } from "../lib/app-core"

try {
  const result = runMigrations()
  console.log(JSON.stringify({ ok: true, ...result }, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  closeDb()
}

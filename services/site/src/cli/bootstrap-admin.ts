import { closeDb } from "../lib/app-core"
import { bootstrapAdminAccount } from "../lib/app-core/bootstrap"

async function main() {
  try {
    const result = await bootstrapAdminAccount()
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    closeDb()
  }
}

void main()

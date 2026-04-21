import { closeDb } from '../db.js';
import { bootstrapAdminAccount } from '../bootstrap.js';

try {
  const result = await bootstrapAdminAccount();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  closeDb();
}

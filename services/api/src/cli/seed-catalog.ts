import { closeDb } from '../db.js';
import { seedDatabase } from '../seeds.js';

try {
  const result = await seedDatabase({ includeDemo: false, includeProfiles: false });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  closeDb();
}

import path from 'node:path';
import { closeDb } from '../db.js';
import { seedDatabase } from '../seeds.js';

const inputPath = process.argv[2]?.trim() || process.env.PROFILE_IMPORT_FILE?.trim();

if (!inputPath) {
  console.error('Usage: npm run seed:profiles -- /path/to/profiles.json');
  console.error('Or set PROFILE_IMPORT_FILE to the export you want to import once.');
  process.exit(1);
}

const profilesPath = path.resolve(process.cwd(), inputPath);

try {
  const result = await seedDatabase({ profilesPath });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  closeDb();
}
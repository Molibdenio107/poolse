/**
 * Loads the repo-root .env, and must be the first import in main.ts.
 *
 * Ordering is not cosmetic: `@poolse/db` builds its connection pool from
 * process.env at import time, so an env file read after that import has already
 * missed. Anything importing this file second is a bug that shows up as
 * "DATABASE_APP_URL is not set" on a machine where it plainly is.
 *
 * Node's --env-file flag would be tidier, but `nest start` spawns its own node
 * process and NODE_OPTIONS refuses that flag, so the file is read in code.
 *
 * A missing .env is not an error. Staging and production inject real environment
 * variables and have no file to read; variables already present in the
 * environment win over the file either way.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// dist/main.js → apps/api → apps → repo root.
const rootEnv = join(__dirname, '..', '..', '..', '.env');

if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

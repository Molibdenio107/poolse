/**
 * Minimal SQL migration runner.
 *
 * Deliberately not an ORM migration tool: the schema leans on composite foreign
 * keys, RLS policies, partial unique indexes and (later) GiST exclusion
 * constraints, all of which ORM migration DSLs express badly or not at all.
 * Plain SQL files with no translation layer are easier to review and easier to
 * trust.
 *
 * Files live in ../migrations, named <timestamp>_<name>.sql, and contain:
 *
 *   -- Up Migration
 *   ...
 *   -- Down Migration
 *   ...
 *
 * Runs as the OWNER role (DATABASE_URL), which bypasses RLS — that is what makes
 * DDL and backfills possible. The application uses DATABASE_APP_URL instead.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const UP = '-- Up Migration';
const DOWN = '-- Down Migration';

type Direction = 'up' | 'down';

function split(sql: string): { up: string; down: string } {
  const downAt = sql.indexOf(DOWN);
  if (downAt === -1) {
    throw new Error(`Migration is missing a "${DOWN}" marker`);
  }
  const upAt = sql.indexOf(UP);
  if (upAt === -1) {
    throw new Error(`Migration is missing an "${UP}" marker`);
  }
  return {
    up: sql.slice(upAt + UP.length, downAt).trim(),
    down: sql.slice(downAt + DOWN.length).trim(),
  };
}

async function main(): Promise<void> {
  const direction = (process.argv[2] ?? 'up') as Direction;
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`Unknown direction "${direction}". Use "up" or "down".`);
  }

  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migration');
    const applied = new Set(rows.map((r) => r.name));

    if (direction === 'up') {
      const pending = files.filter((f) => !applied.has(f));
      if (pending.length === 0) {
        console.log('Nothing to apply — schema is up to date.');
        return;
      }
      for (const file of pending) {
        const { up } = split(await readFile(join(MIGRATIONS_DIR, file), 'utf8'));
        process.stdout.write(`  applying ${file} … `);
        // Each migration is one transaction: it applies completely or not at all.
        await client.query('BEGIN');
        try {
          await client.query(up);
          await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log('ok');
        } catch (error) {
          await client.query('ROLLBACK');
          console.log('failed');
          throw error;
        }
      }
      console.log(`Applied ${pending.length} migration(s).`);
    } else {
      const last = files.filter((f) => applied.has(f)).pop();
      if (!last) {
        console.log('Nothing to roll back.');
        return;
      }
      const { down } = split(await readFile(join(MIGRATIONS_DIR, last), 'utf8'));
      process.stdout.write(`  reverting ${last} … `);
      await client.query('BEGIN');
      try {
        await client.query(down);
        await client.query('DELETE FROM schema_migration WHERE name = $1', [last]);
        await client.query('COMMIT');
        console.log('ok');
      } catch (error) {
        await client.query('ROLLBACK');
        console.log('failed');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

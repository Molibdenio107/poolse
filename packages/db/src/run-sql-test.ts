/**
 * Runs a .sql test file and fails the process if any assertion inside it raises.
 *
 * The tenant-isolation suite is written in SQL on purpose: what it proves is a
 * property of the database, and asserting it through an application query layer
 * would only prove the query layer behaves — which is exactly the thing we do
 * not want to depend on.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error('Usage: run-sql-test <file.sql> [more.sql …]');

  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const client = new pg.Client({ connectionString });

  let failed = false;
  client.on('notice', (notice) => {
    const message = notice.message ?? '';
    if (message.startsWith('FAIL')) failed = true;
    console.log(message.startsWith('PASS') ? `  ✓ ${message.slice('PASS '.length)}` : `  ${message}`);
  });

  await client.connect();
  try {
    for (const file of files) {
      console.log(`\n${file}`);
      const sql = await readFile(resolve(file), 'utf8');
      // Each file manages its own BEGIN/ROLLBACK so it leaves no seed data behind.
      await client.query(sql.replace(/^\\.*$/gm, ''));
    }
    console.log(failed ? '\nFAILED' : '\nAll assertions passed.');
    if (failed) process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

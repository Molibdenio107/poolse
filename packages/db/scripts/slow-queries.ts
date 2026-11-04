/**
 * The queries that cost the most — POOLSE-171.
 *
 *   pnpm --filter @poolse/db perf:slow-queries [--org=<slug>] [--reset]
 *
 * Reads `pg_stat_statements` (loaded by the dev Docker image; this script
 * creates the extension if it is missing) as the owner, keeps the statements
 * the app login ran, and prints:
 *
 *   1. the top 20 by total time and the top 20 by mean time;
 *   2. a plan for every statement that reads more than 10 000 buffers a call —
 *      run as `poolse_app` with the club's GUC set, so row-level security is in
 *      the plan, inside a transaction that is rolled back. `ANALYZE, BUFFERS`
 *      where the statement takes no parameters; otherwise `GENERIC_PLAN`,
 *      because the statistics keep `$1` and not the value it had, and a guessed
 *      value would be a plan of a different query. Reads only: a write is
 *      never explained here, analysed or not;
 *   3. the index check: tenant tables (those with `organization_id`) with no
 *      index whose first column is `organization_id`.
 *
 * `--reset` clears the statistics first, for a clean measurement.
 * Local only: never point it at production.
 */
import pg from 'pg';

const BUFFER_LIMIT = 10_000;
const TOP = 20;

function arg(name: string): string | undefined {
  const hit = process.argv.find((one) => one.startsWith(`--${name}`));
  if (hit === undefined) return undefined;
  const [, value] = hit.split('=');
  return value ?? '';
}

interface Statement {
  query: string;
  calls: number;
  total_ms: number;
  mean_ms: number;
  rows: number;
  buffers_per_call: number;
}

function line(one: Statement): string {
  const text = one.query.replace(/\s+/g, ' ').slice(0, 140);
  return `${one.total_ms.toFixed(0).padStart(8)} ms total  ${one.mean_ms.toFixed(2).padStart(8)} ms mean  ${String(
    one.calls,
  ).padStart(6)} calls  ${one.buffers_per_call.toFixed(0).padStart(7)} buf/call  ${text}`;
}

async function main(): Promise<void> {
  const owner = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await owner.connect();
  try {
    await owner.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
    if (arg('reset') !== undefined) {
      await owner.query('SELECT pg_stat_statements_reset()');
      console.log('Statistics reset. Use the app, then run this again without --reset.');
      return;
    }

    const base = `SELECT s.query, s.calls::int AS calls,
                         s.total_exec_time AS total_ms, s.mean_exec_time AS mean_ms,
                         s.rows::int AS rows,
                         (s.shared_blks_hit + s.shared_blks_read)::float / greatest(s.calls, 1) AS buffers_per_call
                    FROM pg_stat_statements s
                    JOIN pg_roles r ON r.oid = s.userid
                   WHERE r.rolname = 'poolse_app'
                     AND s.query NOT IN ('BEGIN', 'COMMIT', 'ROLLBACK')
                     AND s.query NOT ILIKE 'SELECT set_config(%'`;

    const byTotal = (await owner.query<Statement>(`${base} ORDER BY s.total_exec_time DESC LIMIT ${TOP}`)).rows;
    const byMean = (await owner.query<Statement>(`${base} ORDER BY s.mean_exec_time DESC LIMIT ${TOP}`)).rows;
    console.log(`\n== Top ${TOP} by total time (as poolse_app)\n`);
    byTotal.forEach((one) => console.log(line(one)));
    console.log(`\n== Top ${TOP} by mean time\n`);
    byMean.forEach((one) => console.log(line(one)));

    const heavy = (
      await owner.query<Statement>(
        `${base} AND (s.shared_blks_hit + s.shared_blks_read)::float / greatest(s.calls, 1) > ${BUFFER_LIMIT}
          ORDER BY s.total_exec_time DESC`,
      )
    ).rows;

    console.log(`\n== Statements reading more than ${BUFFER_LIMIT} buffers a call: ${heavy.length}\n`);
    if (heavy.length > 0) {
      const slug = arg('org') ?? 'clube-medida';
      const org = (await owner.query<{ id: string }>('SELECT id FROM organization WHERE slug = $1', [slug])).rows[0];
      if (!org) {
        console.log(`(No club with slug "${slug}" — pass --org=<slug> to explain them under its RLS.)`);
      } else {
        const app = new pg.Client({ connectionString: process.env['DATABASE_APP_URL'] });
        await app.connect();
        try {
          for (const one of heavy) {
            const text = one.query.trim();
            console.log(`-- ${line(one)}`);
            if (!/^(select|with)\b/i.test(text) || /\b(insert|update|delete)\b/i.test(text)) {
              console.log('   (a write: not explained here)\n');
              continue;
            }
            const parameters = /\$\d+/.test(text);
            await app.query('BEGIN');
            try {
              await app.query("SELECT set_config('app.organization_id', $1, true)", [org.id]);
              const plan = await app.query<{ 'QUERY PLAN': string }>(
                `EXPLAIN (${parameters ? 'GENERIC_PLAN' : 'ANALYZE, BUFFERS'}) ${text}`,
              );
              console.log(parameters ? '   (generic plan: the statement takes parameters)' : '   (analysed)');
              plan.rows.forEach((row) => console.log(`   ${row['QUERY PLAN']}`));
            } catch (error) {
              console.log(`   (could not explain: ${(error as Error).message})`);
            } finally {
              await app.query('ROLLBACK');
            }
            console.log('');
          }
        } finally {
          await app.end();
        }
      }
    }

    const unindexed = (
      await owner.query<{ table_name: string }>(
        `SELECT c.relname AS table_name
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
          WHERE c.relkind IN ('r', 'p')
            AND NOT EXISTS (
              SELECT 1 FROM pg_index i
               WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum)
          ORDER BY c.relname`,
      )
    ).rows;
    console.log(`\n== Tenant tables with no index leading with organization_id: ${unindexed.length}\n`);
    unindexed.forEach((one) => console.log(`   ${one.table_name}`));
  } finally {
    await owner.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

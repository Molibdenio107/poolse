import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decryptSensitive } from '../../../apps/api/src/sensitive/cipher.js';
import { DEFAULT_MAX_AGE_HOURS, env, quoteIdent, readGrants, type Manifest } from './backup-lib.js';

/**
 * Proving a restore — POOLSE-89. A backup nobody has restored is a file of
 * unknown worth; this is what makes it a backup.
 *
 *   1. Every migration in the repo is recorded as applied, and the restore holds
 *      exactly the migrations the source did.
 *   2. Every table's row count matches the manifest, which was counted from the
 *      dump's own snapshot.
 *   3. RLS is enabled on every table in `TENANT_TABLES` (read from the API's test
 *      harness, the list CLAUDE.md tells every new tenant table to join) and on
 *      every table the source had it on.
 *   4. The `poolse_app` and `poolse_platform` grants are what they were.
 *   5. One encrypted medical note decrypts with `SENSITIVE_DATA_KEY` — the key
 *      held offline. A backup whose medical notes cannot be read is not a backup
 *      of the club.
 *
 * With `--max-age-hours`, the backup itself must also be recent: a job that has
 * silently stopped is a failure, said with the date of the last one.
 *
 * Each failed proof says what it found. The run fails if any proof does — it
 * never reports green on a partial restore.
 *
 *   RESTORE_TARGET_URL   the restored database
 *   SENSITIVE_DATA_KEY   the medical notes' key
 *
 * Run: pnpm --filter @poolse/db verify-restore [manifest.json] [--max-age-hours 36]
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../migrations');
const HARNESS = resolve(here, '../../../apps/api/src/test/harness.ts');

export interface Proof {
  name: string;
  ok: boolean;
  detail: string;
}

/** The quoted names in `const TENANT_TABLES = [ … ] as const`, comments stripped. */
export function tenantTablesFromHarness(source: string = readFileSync(HARNESS, 'utf8')): string[] {
  const start = source.indexOf('const TENANT_TABLES = [');
  if (start === -1) throw new Error('TENANT_TABLES not found in the API test harness');
  const end = source.indexOf('] as const', start);
  const body = source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]!);
}

export function repoMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export async function verifyRestore(options: {
  targetUrl: string;
  manifest: Manifest;
  tenantTables?: string[];
  migrations?: string[];
  maxAgeHours?: number;
  now?: Date;
}): Promise<{ ok: boolean; proofs: Proof[] }> {
  const proofs: Proof[] = [];
  const client = new pg.Client({ connectionString: options.targetUrl });
  await client.connect();
  try {
    // 1. Migrations.
    const { rows: applied } = await client.query<{ name: string }>('SELECT name FROM schema_migration ORDER BY name');
    const restored = new Set(applied.map((row) => row.name));
    const notInRestore = (options.migrations ?? repoMigrations()).filter((name) => !restored.has(name));
    const lostFromSource = options.manifest.migrations.filter((name) => !restored.has(name));
    proofs.push({
      name: 'migrations',
      ok: notInRestore.length === 0 && lostFromSource.length === 0,
      detail:
        notInRestore.length + lostFromSource.length === 0
          ? `all ${restored.size} applied`
          : [
              notInRestore.length > 0 ? `in the repo, not applied: ${notInRestore.join(', ')}` : '',
              lostFromSource.length > 0 ? `applied in the source, missing here: ${lostFromSource.join(', ')}` : '',
            ]
              .filter(Boolean)
              .join('; '),
    });

    // 2. Row counts.
    const { rows: present } = await client.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
    );
    const tables = new Set(present.map((row) => row.name));
    const countProblems: string[] = [];
    for (const [table, expected] of Object.entries(options.manifest.rowCounts)) {
      if (!tables.has(table)) {
        countProblems.push(`${table} missing`);
        continue;
      }
      const { rows } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${quoteIdent(table)}`);
      const actual = Number(rows[0]!.n);
      if (actual !== expected) countProblems.push(`${table} has ${actual}, expected ${expected}`);
    }
    const rows = Object.values(options.manifest.rowCounts).reduce((sum, n) => sum + n, 0);
    proofs.push({
      name: 'row counts',
      ok: countProblems.length === 0,
      detail: countProblems.length === 0 ? `${tables.size} tables, ${rows} rows` : countProblems.join('; '),
    });

    // 3. RLS.
    const { rows: rls } = await client.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relrowsecurity`,
    );
    const secured = new Set(rls.map((row) => row.name));
    const wanted = [...new Set([...(options.tenantTables ?? tenantTablesFromHarness()), ...options.manifest.rlsTables])];
    const unsecured = wanted.filter((table) => !secured.has(table));
    proofs.push({
      name: 'row-level security',
      ok: unsecured.length === 0,
      detail:
        unsecured.length === 0
          ? `enabled on all ${wanted.length} tenant tables`
          : `not enabled (or no such table): ${unsecured.join(', ')}`,
    });

    // 4. Grants.
    const grants = new Set(await readGrants(client));
    const missing = options.manifest.grants.filter((grant) => !grants.has(grant));
    const extra = [...grants].filter((grant) => !options.manifest.grants.includes(grant));
    proofs.push({
      name: 'app grants',
      ok: missing.length === 0 && extra.length === 0,
      detail:
        missing.length + extra.length === 0
          ? `${grants.size} grants to poolse_app and poolse_platform`
          : [
              missing.length > 0 ? `missing: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` (+${missing.length - 10})` : ''}` : '',
              extra.length > 0 ? `not in the source: ${extra.slice(0, 10).join(', ')}` : '',
            ]
              .filter(Boolean)
              .join('; '),
    });

    // 5. One medical note opens. The medical notes first; any other encrypted
    // column of the same cipher if the club has none yet.
    const { rows: columns } = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name LIKE '%\\_encrypted'
        ORDER BY (column_name = 'medical_notes_encrypted') DESC, table_name, column_name`,
    );
    let sample: { where: string; value: string } | null = null;
    for (const column of columns) {
      const { rows: found } = await client.query<{ value: string }>(
        `SELECT ${quoteIdent(column.column_name)} AS value FROM public.${quoteIdent(column.table_name)}
          WHERE ${quoteIdent(column.column_name)} LIKE 'v1.%' LIMIT 1`,
      );
      if (found[0]) {
        sample = { where: `${column.table_name}.${column.column_name}`, value: found[0].value };
        break;
      }
    }
    if (sample === null) {
      proofs.push({ name: 'medical notes decrypt', ok: true, detail: 'nothing encrypted in this backup yet — nothing to prove' });
    } else {
      try {
        decryptSensitive(sample.value);
        proofs.push({ name: 'medical notes decrypt', ok: true, detail: `${sample.where} opens with SENSITIVE_DATA_KEY` });
      } catch (error) {
        proofs.push({
          name: 'medical notes decrypt',
          ok: false,
          detail: `${sample.where} does not open with SENSITIVE_DATA_KEY: ${(error as Error).message}`,
        });
      }
    }
  } finally {
    await client.end();
  }

  // The backup's own age.
  if (options.maxAgeHours !== undefined) {
    const takenAt = new Date(options.manifest.createdAt);
    const ageHours = ((options.now ?? new Date()).getTime() - takenAt.getTime()) / 3_600_000;
    proofs.push({
      name: 'freshness',
      ok: ageHours <= options.maxAgeHours,
      detail:
        ageHours <= options.maxAgeHours
          ? `taken ${ageHours.toFixed(1)} h ago`
          : `no backup since ${takenAt.toISOString()} (${ageHours.toFixed(0)} h; the limit is ${options.maxAgeHours} h)`,
    });
  }

  return { ok: proofs.every((proof) => proof.ok), proofs };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ageFlag = args.indexOf('--max-age-hours');
  const maxAgeHours = ageFlag === -1 ? undefined : Number(args[ageFlag + 1] ?? DEFAULT_MAX_AGE_HOURS);
  const manifestPath = args.find((arg, index) => !arg.startsWith('--') && index !== ageFlag + 1) ?? 'restore-manifest.json';
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;

  const result = await verifyRestore({
    targetUrl: env('RESTORE_TARGET_URL'),
    manifest,
    ...(maxAgeHours === undefined ? {} : { maxAgeHours }),
  });
  for (const proof of result.proofs) console.log(`${proof.ok ? 'PASS' : 'FAIL'}  ${proof.name}: ${proof.detail}`);
  if (!result.ok) {
    console.error(`Restore verification FAILED for ${manifest.dumpKey}.`);
    process.exit(1);
  }
  console.log(`Restore of ${manifest.dumpKey} proved.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(`Restore verification FAILED: ${(error as Error).message}`);
    process.exit(1);
  });
}

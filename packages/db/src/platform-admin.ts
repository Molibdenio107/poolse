/**
 * Grants, revokes and lists platform administrators.
 *
 * A one-off script rather than a migration, and rather than a screen.
 *
 * Not a migration, because a Clerk user id is an environment fact — staging and
 * production have different ones, and a migration carrying a literal id would
 * either be wrong in one of them or would have to read an env var at apply time,
 * which the runner deliberately does not do.
 *
 * Not a screen, because the first rule of the platform area is that platform
 * access is not something the product hands out. There are two or three of these
 * rows for the life of the company. Adding one is a deliberate act at a terminal
 * by somebody holding the owner credentials, which is exactly the bar it should
 * clear.
 *
 * Runs as the OWNER (`DATABASE_URL`). Neither `poolse_app` nor `poolse_platform`
 * may write this table — the platform role can read it, because that is how the
 * guard answers, and nothing more.
 *
 *   pnpm db:platform-admin list
 *   pnpm db:platform-admin grant user_2abc… "Rui"
 *   pnpm db:platform-admin revoke user_2abc…
 *
 * Find the Clerk user id in the Clerk dashboard under Users, or with
 * `clerk users list`.
 */
import pg from 'pg';

type Command = 'list' | 'grant' | 'revoke';

const USAGE = `Usage:
  pnpm db:platform-admin list
  pnpm db:platform-admin grant   <clerk_user_id> [note]
  pnpm db:platform-admin revoke  <clerk_user_id>`;

function readCommand(raw: string | undefined): Command {
  if (raw === 'list' || raw === 'grant' || raw === 'revoke') return raw;
  throw new Error(`${raw === undefined ? 'No command given' : `Unknown command "${raw}"`}.\n\n${USAGE}`);
}

/**
 * A Clerk user id, or a clear refusal.
 *
 * Checked rather than trusted because the failure otherwise is silent and
 * expensive: paste an email address by mistake and the row inserts perfectly,
 * the guard never matches it, and `/admin` 403s at somebody who is certain they
 * granted themselves access.
 */
function readClerkUserId(raw: string | undefined): string {
  const id = (raw ?? '').trim();
  if (!id.startsWith('user_') || id.length < 10) {
    throw new Error(
      `"${id}" does not look like a Clerk user id. They start with "user_" — find ` +
        'yours in the Clerk dashboard under Users.',
    );
  }
  return id;
}

async function main(): Promise<void> {
  const command = readCommand(process.argv[2]);

  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    if (command === 'list') {
      const { rows } = await client.query<{
        clerk_user_id: string;
        note: string | null;
        created_at: Date;
        archived_at: Date | null;
      }>(
        `SELECT clerk_user_id, note, created_at, archived_at
           FROM platform_admin
          ORDER BY archived_at NULLS FIRST, created_at`,
      );

      if (rows.length === 0) {
        console.log('No platform administrators. /admin is closed to everybody.');
        return;
      }

      for (const row of rows) {
        const state = row.archived_at === null ? 'active ' : 'revoked';
        console.log(
          `  ${state}  ${row.clerk_user_id}  ${row.note ?? ''}`.trimEnd() +
            `  (${row.created_at.toISOString().slice(0, 10)})`,
        );
      }
      return;
    }

    const clerkUserId = readClerkUserId(process.argv[3]);

    if (command === 'grant') {
      const note = process.argv[4] ?? null;

      /*
       * Upsert, and un-archive on the way. `clerk_user_id` is unique across live
       * and revoked rows alike, so granting access back to somebody it was taken
       * from is this statement rather than an error the operator has to work out
       * how to get past.
       */
      const { rows } = await client.query<{ archived_at: Date | null }>(
        `INSERT INTO platform_admin (clerk_user_id, note)
              VALUES ($1, $2)
         ON CONFLICT (clerk_user_id) DO UPDATE
            SET archived_at = NULL,
                note = coalesce(excluded.note, platform_admin.note)
       RETURNING archived_at`,
        [clerkUserId, note],
      );

      console.log(`Granted platform access to ${clerkUserId}.`);
      console.log(`  ${rows.length} row(s) — /admin is now open to them.`);
      return;
    }

    // revoke
    const result = await client.query(
      `UPDATE platform_admin SET archived_at = now()
        WHERE clerk_user_id = $1 AND archived_at IS NULL`,
      [clerkUserId],
    );

    if (result.rowCount === 0) {
      console.log(`${clerkUserId} was not an active platform administrator. Nothing changed.`);
      return;
    }

    console.log(`Revoked platform access from ${clerkUserId}.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

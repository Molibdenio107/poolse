import pg from 'pg';

const { Pool } = pg;

/**
 * The application pool. Connects as the unprivileged app role — NOT the table
 * owner — because a table's owner bypasses row-level security. If this ever
 * points at the owner role, every RLS policy in the schema silently stops
 * working and nothing fails loudly. That is the one configuration mistake that
 * quietly undoes tenant isolation, so it is checked at startup below.
 */
export const pool = new Pool({
  connectionString: process.env['DATABASE_APP_URL'],
  max: Number(process.env['DATABASE_POOL_MAX'] ?? 10),
});

export type Tx = pg.PoolClient;

/**
 * Run `fn` inside a transaction scoped to one organization.
 *
 * `set_config(..., true)` makes the setting transaction-local, so it cannot leak
 * to the next request that borrows this pooled connection. Every RLS policy reads
 * it; a query that forgets its WHERE clause returns nothing rather than
 * everything.
 *
 * This is the ONLY sanctioned way to touch tenant data. If you find yourself
 * reaching for `pool.query` directly in a request path, that is the bug.
 */
export async function withOrg<T>(
  organizationId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'app.organization_id',
      organizationId,
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * For the few operations that legitimately span tenants — the Clerk webhook
 * creating an app_user, resolving which organizations a person belongs to,
 * invitation lookup by token before an org is known.
 *
 * Read this carefully, because the name promises more than it delivers: leaving
 * the GUC unset does NOT lift row-level security. The connection is still
 * poolse_app, so every policy sees `current_organization_id() = NULL`, evaluates
 * false, and returns nothing. A plain SELECT in here reads zero rows.
 *
 * What it is actually for is calling the SECURITY DEFINER functions that own the
 * cross-tenant reads (`resolve_memberships`, `find_app_user`, `provision_app_user`,
 * `deactivate_app_user`). Those run as the table owner, so they see everything —
 * inside a fixed, reviewed function body with the Clerk user id as their only
 * input. That is the whole escape hatch; there is no general one.
 *
 * Deliberately named so it stands out in review. Anything using this should be
 * able to explain why in one sentence.
 */
export async function withoutTenantScope<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Fails fast at boot if the app is connected as a role that bypasses RLS.
 * Cheap check, catches a class of misconfiguration that is otherwise invisible
 * until a customer sees another customer's data.
 */
export async function assertRlsApplies(): Promise<void> {
  const { rows } = await pool.query<{
    is_superuser: boolean;
    bypassrls: boolean;
    owns_tables: boolean;
  }>(`
    SELECT r.rolsuper AS is_superuser,
           r.rolbypassrls AS bypassrls,
           EXISTS (
             SELECT 1 FROM pg_tables t
             WHERE t.schemaname = 'public' AND t.tableowner = current_user
           ) AS owns_tables
      FROM pg_roles r
     WHERE r.rolname = current_user
  `);

  const role = rows[0];
  if (!role) throw new Error('Could not resolve the current database role');

  if (role.is_superuser || role.bypassrls || role.owns_tables) {
    throw new Error(
      'DATABASE_APP_URL connects as a role that bypasses row-level security ' +
        '(superuser, BYPASSRLS, or the owner of public tables). Tenant isolation ' +
        'is not in effect. Use the poolse_app role.',
    );
  }
}

/**
 * The platform operator's connection — a second pool, used by `PlatformModule`
 * and by nothing else.
 *
 * `poolse_app` cannot answer "how many tenants are there", and teaching it to
 * would mean weakening the policy that makes an unscoped query return nothing.
 * So the cross-tenant reads get their own login, `poolse_platform`, with a
 * `FOR SELECT TO poolse_platform` policy on each of the seven tables the
 * overview needs and no privilege at all on the rest of the schema.
 *
 * It is **not** a BYPASSRLS role. Row-level security still applies to it; it is
 * simply named in a handful of permissive policies. The practical difference is
 * that a mistake here leaks the seven tables it was granted rather than the
 * whole database, and that adding an eighth is a reviewed line of SQL rather
 * than something that happens by default.
 *
 * Lazy, and absent is not fatal: a developer with no `DATABASE_PLATFORM_URL` in
 * their `.env` should get an API that boots and a `/platform` route that says
 * plainly it is not configured — not a crash at import time on every other
 * screen in the product.
 */
let platform: pg.Pool | undefined;

export function platformConfigured(): boolean {
  return (process.env['DATABASE_PLATFORM_URL'] ?? '') !== '';
}

/**
 * Run `fn` on the platform connection, inside a read-committed transaction.
 *
 * No organization GUC is set and none is wanted — the policies that admit this
 * role do not read one. The transaction is here for the same reason `withOrg`
 * has one: an audit insert and the read it describes commit together or not at
 * all.
 */
export async function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const connectionString = process.env['DATABASE_PLATFORM_URL'];
  if (!connectionString) {
    throw new Error(
      'DATABASE_PLATFORM_URL is not set. The platform admin area needs its own ' +
        'database login (poolse_platform); run `pnpm db:bootstrap` after adding it.',
    );
  }

  platform ??= new pg.Pool({
    connectionString,
    // Deliberately small. One operator, one screen — a pool sized like the
    // application's would hold ten idle connections against the tenant app's
    // budget for a page that is opened twice a week.
    max: Number(process.env['DATABASE_PLATFORM_POOL_MAX'] ?? 3),
  });

  const client = await platform.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Fails fast at boot if the platform login is the owner, a superuser, or the
 * application's own role.
 *
 * The mirror of `assertRlsApplies`, and it exists for the mirror-image mistake:
 * pointing `DATABASE_PLATFORM_URL` at `DATABASE_URL` because both "can see
 * everything" makes the platform area work perfectly while handing an
 * `/admin` request the ability to write to every table in the schema.
 *
 * Silent when the variable is unset — that is a developer without the area
 * configured, not a misconfiguration.
 */
export async function assertPlatformRoleIsNarrow(): Promise<void> {
  if (!platformConfigured()) return;

  await withPlatform(async (tx) => {
    const { rows } = await tx.query<{
      name: string;
      is_superuser: boolean;
      bypassrls: boolean;
      owns_tables: boolean;
    }>(`
      SELECT r.rolname AS name,
             r.rolsuper AS is_superuser,
             r.rolbypassrls AS bypassrls,
             EXISTS (
               SELECT 1 FROM pg_tables t
                WHERE t.schemaname = 'public' AND t.tableowner = current_user
             ) AS owns_tables
        FROM pg_roles r
       WHERE r.rolname = current_user
    `);

    const role = rows[0];
    if (!role) throw new Error('Could not resolve the platform database role');

    if (role.is_superuser || role.bypassrls || role.owns_tables) {
      throw new Error(
        `DATABASE_PLATFORM_URL connects as "${role.name}", which is a superuser, has ` +
          'BYPASSRLS, or owns the public tables. The platform role is meant to be ' +
          'narrow: read-only on seven named tables. Use poolse_platform.',
      );
    }
  });
}

/**
 * Releases the platform pool so a test runner can exit.
 *
 * The application never calls this — the pool lives as long as the process. It
 * exists because `node --test` hangs on an open handle, and the platform pool is
 * lazy, so a run that never touched `/platform` has nothing to close.
 */
export async function closePlatformPool(): Promise<void> {
  await platform?.end();
  platform = undefined;
}

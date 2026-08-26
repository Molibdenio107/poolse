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

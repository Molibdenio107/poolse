/**
 * Creates the unprivileged application role on a fresh database, and proves it
 * is actually unprivileged.
 *
 * This is the step that a managed Postgres makes easy to skip. Railway, Fly, Neon
 * and the rest hand you one connection string belonging to a superuser or the
 * database owner. Point `DATABASE_APP_URL` at that and everything works — the app
 * boots, queries return rows, tests pass — while every row-level security policy
 * in the schema is silently inert, because a table's owner bypasses RLS. There is
 * no error and no symptom until one customer sees another customer's data.
 *
 * So the two roles get created deliberately, by a script that says out loud what
 * it checked. `assertRlsApplies` in the API is the second line of defence and
 * refuses to boot if this was skipped; this is the first.
 *
 * Idempotent: run it on every deploy if you like. It creates the role when
 * missing and resets the password when present, which is also how you rotate it.
 *
 *   DATABASE_URL      the owner connection (migrations use this too)
 *   DATABASE_APP_URL  the application connection; its user and password are what
 *                     get created here, so there is one source of truth
 *
 * Run: pnpm db:bootstrap
 */
import pg from 'pg';

interface AppCredentials {
  user: string;
  password: string;
  database: string;
}

function parseAppUrl(raw: string): AppCredentials {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_APP_URL is not a valid connection string');
  }

  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = url.pathname.replace(/^\//, '');

  if (!user) throw new Error('DATABASE_APP_URL has no username');
  if (!password) {
    throw new Error(
      'DATABASE_APP_URL has no password. The application role must have one — ' +
        'it is a separate login from the owner, not the same credentials reused.',
    );
  }
  if (!database) throw new Error('DATABASE_APP_URL names no database');

  return { user, password, database };
}

async function main(): Promise<void> {
  const ownerUrl = process.env['DATABASE_URL'];
  const appUrl = process.env['DATABASE_APP_URL'];
  if (!ownerUrl) throw new Error('DATABASE_URL is not set');
  if (!appUrl) throw new Error('DATABASE_APP_URL is not set');

  const app = parseAppUrl(appUrl);
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();

  try {
    const ownerName = (await owner.query<{ current_user: string }>('SELECT current_user')).rows[0]
      ?.current_user;

    if (ownerName === app.user) {
      throw new Error(
        `DATABASE_URL and DATABASE_APP_URL both connect as "${app.user}". They must be ` +
          'different roles: the owner bypasses row-level security, so tenant isolation ' +
          'would not be in effect at all.',
      );
    }

    // Identifiers cannot be parameterised, so the role name is validated rather
    // than escaped. Anything outside this shape is a configuration mistake.
    if (!/^[a-z_][a-z0-9_]*$/.test(app.user)) {
      throw new Error(`Unusable role name "${app.user}": use lowercase letters, digits and _`);
    }

    const exists = await owner.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [app.user]);

    // CREATE ROLE and GRANT cannot take query parameters — they are DDL, and a DO
    // block is no help because its body is a string literal the parameters never
    // reach. So the statement text is built by `format()` on the server, where %I
    // and %L do the quoting, and then executed. Hand-rolling the escaping in
    // JavaScript would be the alternative, and getting it subtly wrong is how
    // this kind of script becomes an injection point.
    //
    // One honest caveat: the executed statement contains the password literally,
    // so a server with `log_statement = 'ddl'` or noisier will have it in the log.
    // That is true of any ALTER ROLE ... PASSWORD, and the answer is to rotate
    // through this script rather than to read it out of a log.
    const ddl = async (template: string, args: unknown[]): Promise<void> => {
      const { rows } = await owner.query<{ statement: string }>(
        // Every parameter cast explicitly: format() is variadic "any", so Postgres
        // cannot infer a type for an untyped placeholder and refuses the query.
        `SELECT format($1::text, ${args.map((_, i) => `$${i + 2}::text`).join(', ')}) AS statement`,
        [template, ...args],
      );
      const statement = rows[0]?.statement;
      if (!statement) throw new Error(`Could not build statement: ${template}`);
      await owner.query(statement);
    };

    if (exists.rowCount === 0) {
      await ddl('CREATE ROLE %I LOGIN PASSWORD %L', [app.user, app.password]);
      console.log(`  created role ${app.user}`);
    } else {
      await ddl('ALTER ROLE %I LOGIN PASSWORD %L', [app.user, app.password]);
      console.log(`  role ${app.user} already existed; password set`);
    }

    await ddl('GRANT CONNECT ON DATABASE %I TO %I', [app.database, app.user]);

    // Now prove it. Everything below is a way the role could still bypass RLS.
    const { rows } = await owner.query<{
      can_login: boolean;
      is_superuser: boolean;
      bypassrls: boolean;
      owns_tables: boolean;
    }>(
      `SELECT r.rolcanlogin AS can_login,
              r.rolsuper    AS is_superuser,
              r.rolbypassrls AS bypassrls,
              EXISTS (
                SELECT 1 FROM pg_tables t
                 WHERE t.schemaname = 'public' AND t.tableowner = $1
              ) AS owns_tables
         FROM pg_roles r
        WHERE r.rolname = $1`,
      [app.user],
    );

    const role = rows[0];
    if (!role) throw new Error(`Created ${app.user} but could not read it back`);

    const faults: string[] = [];
    if (!role.can_login) faults.push('cannot log in');
    if (role.is_superuser) faults.push('is a superuser');
    if (role.bypassrls) faults.push('has BYPASSRLS');
    if (role.owns_tables) faults.push('owns tables in public');

    if (faults.length > 0) {
      throw new Error(
        `Role ${app.user} ${faults.join(', ')}. Tenant isolation would not be in effect.`,
      );
    }

    console.log(
      `  verified: ${app.user} can log in, is not a superuser, has no BYPASSRLS, owns no tables`,
    );
    console.log('\nApplication role is ready. Run migrations next: pnpm db:migrate');
  } finally {
    await owner.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

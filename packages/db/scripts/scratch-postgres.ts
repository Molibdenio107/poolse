import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

/**
 * A stock Postgres in a throwaway container — the restore drill's empty target
 * (POOLSE-89). Stock on purpose: a restore that only works on the machine that
 * wrote it, because of a role or an extension that happened to be there, is the
 * failure the drill exists to catch. `PG_TOOLS_IMAGE` pins the major version to
 * production's, as it does for pg_dump.
 */
export interface ScratchPostgres {
  /** A new empty database in the container. */
  database: (name: string) => Promise<string>;
  stop: () => void;
}

export async function startScratchPostgres(): Promise<ScratchPostgres> {
  const name = `poolse-drill-${randomBytes(3).toString('hex')}`;
  const password = randomBytes(12).toString('hex');
  const port = 55_000 + Math.floor(Math.random() * 4000);
  const image = (process.env['PG_TOOLS_IMAGE'] ?? '').trim() || 'postgres:16';
  execFileSync('docker', ['run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, '-p', `${port}:5432`, image], {
    stdio: 'ignore',
  });
  const url = (database: string): string => `postgresql://postgres:${password}@localhost:${port}/${database}`;
  const stop = (): void => {
    try {
      execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    } catch {
      // Already gone.
    }
  };

  for (let attempt = 0; ; attempt += 1) {
    const client = new pg.Client({ connectionString: url('postgres') });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      break;
    } catch (error) {
      await client.end().catch(() => undefined);
      if (attempt >= 60) {
        stop();
        throw new Error(`The scratch Postgres never came up: ${(error as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return {
    database: async (database) => {
      if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error(`Unusable database name ${database}`);
      const client = new pg.Client({ connectionString: url('postgres') });
      await client.connect();
      await client.query(`CREATE DATABASE ${database}`);
      await client.end();
      return url(database);
    },
    stop,
  };
}

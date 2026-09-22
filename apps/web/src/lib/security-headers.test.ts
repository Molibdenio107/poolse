import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import config from '../../next.config.mjs';

/**
 * What the deploy exposes — POOLSE-64, slice E1.
 *
 * Two things the ticket asks to be *asserted* rather than configured, and the
 * reason is the same for both: a header list and an environment variable are
 * read by nobody after the afternoon they are written, and both fail silently.
 * A missing `frame-ancestors` shows up as a working page, and a database URL
 * pasted into a `NEXT_PUBLIC_` variable shows up as a working app whose
 * credentials are in a JavaScript bundle.
 *
 * **The NEXT_PUBLIC check is the one worth having.** `/admin` shares an origin
 * and a cookie with the tenant app today — a known limitation, written into
 * `docs/deploy.md` with its date — and `DATABASE_PLATFORM_URL` reads every
 * tenant in the product. One paste is what it would take.
 *
 * Run: pnpm web:test
 */

const REPO = new URL('../../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** `postgres://…`, `mysql://…`, and the `postgresql` spelling of the first. */
const DATABASE_URL = /\b(postgres|postgresql|mysql|mongodb)(\+\w+)?:\/\//i;

interface Header {
  key: string;
  value: string;
}

async function headers(): Promise<Map<string, string>> {
  // `headers` is optional on Next's own config type, and "the app ships no
  // security headers at all" is exactly the regression this file exists to
  // catch — so its absence is a failure here rather than a skipped test.
  assert.ok(config.headers, 'next.config.mjs defines no headers()');

  const groups = await config.headers();
  const all = new Map<string, string>();
  for (const group of groups as { headers: Header[] }[]) {
    for (const header of group.headers) all.set(header.key.toLowerCase(), header.value);
  }
  return all;
}

test('the enforced policy is the half that cannot break a page', async () => {
  const csp = (await headers()).get('content-security-policy');
  assert.ok(csp, 'every response carries a Content-Security-Policy');

  /*
   * Each of these forbids something the app never does, which is what makes
   * them safe to enforce rather than to watch. `frame-ancestors` is the one that
   * matters most here: an invisible Poolse over somebody else's page turns an
   * operator's clicks into suspend-tenant presses.
   */
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);

  // And the enforced half stays the safe half. `script-src` needs a nonce to be
  // worth enforcing, and a nonce ends prerendering — a decision to take on
  // purpose, which is why it ships as report-only.
  assert.doesNotMatch(csp, /script-src/);
  assert.ok((await headers()).get('content-security-policy-report-only'));
});

test('the other four headers are on every response', async () => {
  const all = await headers();

  assert.equal(all.get('x-frame-options'), 'DENY');
  assert.equal(all.get('x-content-type-options'), 'nosniff');
  assert.equal(all.get('referrer-policy'), 'strict-origin-when-cross-origin');

  // Poolse asks for none of these, so denying them costs nothing and means an
  // injected script cannot ask on our behalf.
  const permissions = all.get('permissions-policy') ?? '';
  for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) {
    assert.match(permissions, new RegExp(`${feature}=\\(\\)`));
  }

  /*
   * HSTS is production-only and must stay that way: it is remembered against the
   * *host*, and `localhost` is a host shared with every other project on this
   * machine. One dev-mode HSTS header makes every plain-http localhost project
   * unreachable, curable only from `chrome://net-internals`.
   */
  assert.equal(
    all.has('strict-transport-security'),
    process.env['NODE_ENV'] === 'production',
  );
});

test('no NEXT_PUBLIC_ variable looks like a database URL', () => {
  /*
   * `next.config.mjs` loads the repo's root `.env` at import time — which is
   * what the web build itself does, and why this test asserts against the real
   * environment rather than a fixture.
   */
  const leaked = Object.entries(process.env).filter(
    ([name, value]) => name.startsWith('NEXT_PUBLIC_') && DATABASE_URL.test(value ?? ''),
  );

  assert.deepEqual(
    leaked.map(([name]) => name),
    [],
    'a NEXT_PUBLIC_ variable is inlined into the browser bundle',
  );

  /*
   * And the files, because a variable that is not set in this process is still
   * set on the machine that builds. Every `.env*` in the repo root and in the
   * web app is read — they are gitignored, so this half is real only on a
   * developer's laptop, which is exactly where the paste happens.
   */
  for (const directory of [REPO, join(REPO, 'apps', 'web')]) {
    for (const name of envFiles(directory)) {
      const path = join(directory, name);
      for (const [index, line] of readFileSync(path, 'utf8').split(/\r?\n/).entries()) {
        const assignment = /^\s*(?:export\s+)?(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
        if (assignment === null) continue;
        assert.ok(
          !DATABASE_URL.test(assignment[2] ?? ''),
          `${name}:${index + 1} puts a database URL in ${assignment[1]}`,
        );
      }
    }
  }
});

test('the web app never reads a database connection string', () => {
  /*
   * `DATABASE_PLATFORM_URL` reads every tenant in the product. It belongs in the
   * API's environment and nowhere else — the web app talks to `/platform` over
   * HTTP and has no business holding a connection string at all, its own tenant
   * one included.
   *
   * Asserted on the *read*, not on the name: `/admin/page.tsx` mentions the
   * variable in a comment explaining a 503 to a developer, which is the sentence
   * somebody needs and not a leak. A server component that actually reached for
   * `process.env['DATABASE_URL']` would work, and would put the whole estate one
   * rendering bug away from a stranger.
   */
  const READS_A_DATABASE = /process\.env\s*(\[\s*['"`]|\.)\s*\w*(DATABASE|POSTGRES)\w*/;
  const offenders: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js)$/.test(entry)) continue;
      // This file writes the pattern down, and says why.
      if (path.endsWith('security-headers.test.ts')) continue;
      if (READS_A_DATABASE.test(readFileSync(path, 'utf8'))) offenders.push(path);
    }
  };

  walk(join(REPO, 'apps', 'web', 'src'));
  assert.deepEqual(offenders, []);
});

function envFiles(directory: string): string[] {
  try {
    return readdirSync(directory).filter(
      (name) => name === '.env' || name.startsWith('.env.'),
    );
  } catch {
    return [];
  }
}

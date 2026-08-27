import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Next only reads .env from its own project directory, and the repo keeps one
 * .env at the root so the API and the database tooling cannot drift out of step
 * with it. Reading it here happens before compilation, which is early enough for
 * NEXT_PUBLIC_* values to be inlined.
 *
 * Missing file is not an error — Vercel injects real environment variables, and
 * variables already set in the environment win over the file.
 */
const rootEnv = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Routes that have moved — POOLSE-34.
   *
   * Férias went from Calendário to Pessoas when Pessoas became the staff section
   * (POOLSE-35). Somebody's bookmark should not become a 404 because we changed
   * our minds about where a page belongs.
   *
   * `permanent: false` on purpose: a 308 is cached by the browser essentially
   * forever, and a wrong permanent redirect is very hard to take back. These can
   * become permanent once the new paths have settled.
   */
  async redirects() {
    return [
      {
        source: '/dashboard/calendar/vacations',
        destination: '/dashboard/people/vacations',
        permanent: false,
      },
      {
        source: '/dashboard/calendar/vacations/:path*',
        destination: '/dashboard/people/vacations/:path*',
        permanent: false,
      },
    ];
  },
};

export default withNextIntl(nextConfig);

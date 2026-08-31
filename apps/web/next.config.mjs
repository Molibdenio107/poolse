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
   * The spreadsheet an operator uploads — slice 1.10.
   *
   * A server action's body is capped at 1 MB by default, and a club's register
   * with a photo of the logo pasted into the header sails past that. The failure
   * is a generic 500 with nothing on screen saying "too big", which is the worst
   * possible first impression on the onboarding path.
   *
   * Sized against measurements rather than a guess: 10 000 students is a 566 KB
   * `.xlsx`, a 2.2 MB `.csv`, and a 2.4 MB payload when the rows are posted for
   * the preview. 20 MB clears all of that with room for a file somebody has
   * pasted a logo into, and still refuses a mis-picked video rather than
   * parsing it. The import itself is bounded by MAX_IMPORT_ROWS on the API.
   */
  experimental: {
    serverActions: { bodySizeLimit: '20mb' },
  },

  /**
   * Routes that have moved — POOLSE-34 and POOLSE-38.
   *
   * Férias went from Calendário to Pessoas, and then the whole section became
   * Staff under Instalações. Somebody's bookmark should not become a 404 because
   * we changed our minds twice about where a page belongs.
   *
   * **Each old path points at the final destination, not at the previous one.**
   * Chaining `/calendar/vacations → /people/vacations → /facilities/staff/vacations`
   * would be two round trips and would break the day the middle hop is removed.
   *
   * `permanent: true` for the Staff move, per POOLSE-38 AC4. The Férias hops stay
   * temporary: that section has now moved twice, and a 308 is cached by the
   * browser essentially forever — worth committing to only once the path has
   * held still for a while.
   */
  async redirects() {
    return [
      {
        source: '/dashboard/people',
        destination: '/dashboard/facilities/staff',
        permanent: true,
      },
      {
        source: '/dashboard/people/:path*',
        destination: '/dashboard/facilities/staff/:path*',
        permanent: true,
      },
      {
        source: '/dashboard/calendar/vacations',
        destination: '/dashboard/facilities/staff/vacations',
        permanent: false,
      },
      {
        source: '/dashboard/calendar/vacations/:path*',
        destination: '/dashboard/facilities/staff/vacations/:path*',
        permanent: false,
      },
    ];
  },
};

export default withNextIntl(nextConfig);

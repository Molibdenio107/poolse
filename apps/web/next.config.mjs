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

/**
 * Clerk's own domain, read out of the publishable key rather than written down.
 *
 * The key is base64 of the frontend API host with a `$` on the end, which is why
 * this is three lines instead of a constant: the dev instance, staging and
 * production each have a different host, and a hardcoded one would lock sign-in
 * out of whichever environment it was not written for. Getting a Content-Security
 * -Policy wrong in that direction is a blank sign-in page in production and a
 * frantic evening.
 */
function clerkHost() {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  const encoded = key.replace(/^pk_(test|live)_/, '');
  if (encoded === '') return null;
  try {
    const host = Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '');
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

const CLERK = clerkHost();
const isProduction = process.env.NODE_ENV === 'production';

/**
 * The directives that cannot break a page, enforced.
 *
 * Every one of these forbids something the app never does, so there is no
 * version of "it worked in dev and broke in production" available to them:
 *
 * - `frame-ancestors 'none'` — nobody may put Poolse in an iframe. This is the
 *   clickjacking one: an invisible Poolse over somebody else's page turns an
 *   operator's clicks into archive-student presses.
 * - `object-src 'none'` — no Flash, no applets, no embedded plugin content.
 * - `base-uri 'self'` — an injected `<base>` tag would silently re-point every
 *   relative script and form in the document at another origin.
 * - `form-action` — where a form may post. Clerk is on the list because sign-in
 *   is its form, not ours.
 */
const SAFE_CSP = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self'${CLERK ? ` ${CLERK}` : ''}`,
];

/**
 * The rest of the policy — the half that governs scripts — as **report-only**.
 *
 * Deliberately not enforced yet, and the reason is worth writing down. Enforcing
 * `script-src` properly means a per-request nonce, and a nonce means the page
 * can no longer be statically prerendered — which would undo the decision
 * `theme-script.tsx` exists to protect, where the landing page is prerendered
 * *and* opens in dark mode with no flash of white. Trading that away is a real
 * cost and should be a decision somebody makes on purpose, not a side effect of
 * adding a header.
 *
 * So this ships watching rather than blocking: violations appear in the browser
 * console, and once a few days of real use have produced none, the same string
 * moves to the enforcing header above. Report-only cannot break anything, which
 * is the whole point of starting here.
 *
 * `'unsafe-inline'` is in `script-src` because Next's hydration payload and the
 * theme script are both inline. It is what the nonce would replace.
 */
const REPORT_ONLY_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${CLERK ? ` ${CLERK}` : ''} https://challenges.cloudflare.com`,
  // Tailwind and Clerk both inject styles at runtime; there is no nonce-free
  // alternative and injected CSS is not a code-execution vector.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.clerk.com",
  "font-src 'self' data:",
  `connect-src 'self'${CLERK ? ` ${CLERK}` : ''}`,
  // Clerk's bot check renders in a frame; nothing else may.
  'frame-src https://challenges.cloudflare.com',
  "worker-src 'self' blob:",
  ...SAFE_CSP,
];

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
  /**
   * Security headers, on every response.
   *
   * These were absent entirely. None of them fixes a defect in the app — they
   * are the layer that decides how much a defect elsewhere is worth, which is
   * why they belong on from the start rather than after something happens.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: SAFE_CSP.join('; ') },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: REPORT_ONLY_CSP.join('; '),
          },

          // Belt and braces with `frame-ancestors` above, for anything that
          // still reads the older header.
          { key: 'X-Frame-Options', value: 'DENY' },

          /*
           * Stops a browser second-guessing a content type. The export routes
           * are why this matters: a `.csv` a club uploaded and downloaded again
           * must never be sniffed as HTML and rendered as a page on our origin.
           */
          { key: 'X-Content-Type-Options', value: 'nosniff' },

          // A student id in a path should not travel to another site in a
          // Referer header. Same-origin keeps the full path, cross-origin sends
          // the origin alone.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

          /*
           * Poolse asks for none of these — there is no `navigator.geolocation`
           * and no `getUserMedia` in the codebase — so denying them costs
           * nothing and means an injected script cannot ask on our behalf.
           * Revisit when the mobile app wants a camera for a student photo.
           */
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },

          /*
           * HSTS, in production only.
           *
           * Never in development: it is remembered by the browser for its full
           * max-age against the *host*, and `localhost` is a host shared with
           * every other project on this machine. One dev-mode HSTS header turns
           * every plain-http localhost project into an unreachable one, and the
           * cure is a trip into chrome://net-internals.
           *
           * No `preload` yet — that is a submission to a browser list and is
           * genuinely hard to undo, so it wants a live domain and a deliberate
           * decision behind it.
           */
          ...(isProduction
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
    ];
  },

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

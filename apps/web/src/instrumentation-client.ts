import * as Sentry from '@sentry/nextjs';

/**
 * Sentry in the browser — platform admin, slice 2.
 *
 * The smaller half by some distance: this app is server components almost
 * everywhere, so what runs here is the calendar's drag, the importers' preview
 * and the handful of controlled form fields. Worth having anyway, because those
 * are exactly the parts a stack trace in the terminal cannot reach.
 *
 * **`NEXT_PUBLIC_SENTRY_DSN`, not `SENTRY_DSN`.** Only the public one is inlined
 * into the bundle; the server-side name would compile to `undefined` here and
 * the SDK would silently never start. Two names for one value is a nuisance and
 * it is Next's, not ours.
 *
 * **The CSP has to know.** `connect-src` is `'self'` plus Clerk, so a browser
 * would block the request to Sentry's ingest host with nothing in the console
 * beyond a CSP violation. `next.config.mjs` reads the same variable and adds the
 * ingest origin — which is why turning this on is one variable rather than two
 * files.
 */
const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'];

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env['NEXT_PUBLIC_SENTRY_ENVIRONMENT'] ??
      process.env['NODE_ENV'] ??
      'development',
    tracesSampleRate: 0,
    /*
     * Off, and it matters more here than on the server. Session Replay and PII
     * would record what an operator typed into a student's medical notes and
     * send it to a third party; `sendDefaultPii: false` and no replay
     * integration is the whole of the protection and both are deliberate.
     */
    sendDefaultPii: false,
  });
}

/**
 * Router transitions, so a client-side navigation is part of the same event.
 *
 * Exported whether or not Sentry started — Next imports this binding by name and
 * a missing export is a build error rather than a quiet skip. With no DSN the
 * hook is a function that does nothing.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

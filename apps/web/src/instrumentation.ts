import * as Sentry from '@sentry/nextjs';

/**
 * Sentry on the Next server — platform admin, slice 2.
 *
 * Next calls `register()` once per runtime before anything else loads, which is
 * where an error tracker has to go. Almost all of this app is server components
 * and server actions, so this half is where almost every exception it can throw
 * actually happens; `instrumentation-client.ts` covers the rest.
 *
 * **Absent DSN is a no-op, not a warning.** `pnpm dev`, `pnpm build` and a fresh
 * clone all run with no Sentry account and must behave identically to one with
 * it. `init` is simply not called and every `Sentry.*` helper elsewhere stays
 * safe to call and does nothing. The Sentry project itself is created by hand;
 * this only wires the SDK.
 *
 * **No source-map upload.** `withSentryConfig` in `next.config.mjs` would give
 * readable stack traces and needs `SENTRY_AUTH_TOKEN` at build time — a secret
 * in CI and a step that fails a deploy when it expires. Worth adding when
 * somebody is actually reading these traces; not worth a build that can break
 * for a reason unrelated to the code.
 */
export function register(): void {
  const dsn = process.env['SENTRY_DSN'] ?? process.env['NEXT_PUBLIC_SENTRY_DSN'];
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment:
      process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'development',
    // Errors only — the same reasoning as the API's instrument.ts. Tracing is
    // the expensive half, per event, and per-tenant running cost is a design
    // constraint rather than a later optimisation.
    tracesSampleRate: 0,
    /*
     * Off. With it on, Sentry attaches request bodies, headers, cookies and IP
     * addresses — which in this product means a student's name, a NIF or a
     * medical note leaving the database for a third party.
     */
    sendDefaultPii: false,
  });
}

/**
 * Errors thrown inside a server component, a server action or a route handler.
 *
 * Next surfaces these through a hook rather than letting them reach `register`'s
 * runtime, so without this export a failing page is a digest in the terminal and
 * nothing in Sentry. Safe with no DSN: `captureRequestError` no-ops.
 */
export const onRequestError = Sentry.captureRequestError;

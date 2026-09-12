/**
 * Sentry, if this installation has a Sentry — platform admin, slice 2.
 *
 * **Imported second in `main.ts`, straight after `load-env`.** Sentry's own
 * guidance is "first import in the file"; here that slot belongs to `load-env`,
 * because the DSN arrives in the repo-root `.env` and an SDK initialised before
 * that file is read would be initialised with nothing. Second is early enough:
 * everything Sentry patches — `http`, `pg`, Express — is imported by `AppModule`
 * below this line, not by `load-env`, which reads a file and sets variables.
 *
 * **Absent DSN is a no-op, not a warning.** `pnpm dev`, `pnpm api:test` and a
 * fresh clone all run with no Sentry account and must behave identically to one
 * with it. `Sentry.init` is simply not called, every `Sentry.*` helper elsewhere
 * in the codebase stays safe to call and does nothing, and nothing in the log
 * suggests something is missing — because nothing is.
 *
 * The Sentry project itself is created by hand. This file only wires the SDK.
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env['SENTRY_DSN'];

if (dsn) {
  Sentry.init({
    dsn,
    /*
     * The deployed environment, so staging noise and production incidents are
     * separable in the same project. Falls back to `development` rather than to
     * nothing: an event with no environment lands in the same bucket as
     * production, which is the one place a developer's stray exception must not
     * appear.
     */
    environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'development',

    /*
     * Errors only. Performance tracing is off because it is the expensive half
     * of Sentry, per-event, and the per-tenant running cost is a design
     * constraint here rather than a later optimisation — `tenant_request_stats`
     * already answers "is this tenant slow" for a hundredth of the price.
     * Turning it on is one line when there is a reason.
     */
    tracesSampleRate: 0,

    /*
     * Off, and this is the important one.
     *
     * `sendDefaultPii` would attach request bodies, headers, cookies and IP
     * addresses to every event — which for this product means a student's name,
     * a NIF or a medical note leaving the database and landing in a third-party
     * service nobody has a data-processing agreement with. The whole point of
     * `last_error_message` being cut to 500 characters would be undone by a
     * default.
     */
    sendDefaultPii: false,
  });
}

/** Whether errors are actually going anywhere. Read by the health strip later. */
export const sentryEnabled = Boolean(dsn);

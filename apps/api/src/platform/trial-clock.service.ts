import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { withPlatform } from '@poolse/db';

/**
 * The clock that moves a tenant down the trial ladder — POOLSE-61, slice B2.
 *
 * B1 built the states and the door; nothing set them but an operator. This runs
 * hourly and does three things, each in its own transaction:
 *
 *   1. a trial that has run out becomes `expired` and read-only, with a deletion
 *      date thirty days out;
 *   2. a read-only tenant past that date has sign-in closed, through the existing
 *      suspension mechanism with a machine-set reason.
 *
 * **And it stops there, which corrects the ticket.** POOLSE-61 listed a third
 * step — "thirty days later, archive the row" — and the platform login cannot do
 * it: `archived_at` is deliberately absent from its column grant because
 * *deleting a tenant is not an operator action*, and a cron has an even weaker
 * claim to it than a person. Widening that grant so an hourly job could remove
 * clubs would trade a standing guarantee for one rung of a ladder. What happens
 * on day 75 belongs to the purge ticket, where "may anything remove a tenant, and
 * under whose hand" is asked deliberately. The clock still *counts* towards it —
 * the last notice it owes is the one warning that deletion is coming.
 *
 * **It never writes `platform_audit_log`.** That table's actor is
 * `clerk_user_id NOT NULL`, a cron has nobody behind it, and writing `'system'`
 * into a column named for a person would be a lie in the one place that exists to
 * be believed. Its transitions go to `trial_event`, in the same transaction as
 * the change — which is also why this does not call `changeTenant`: that helper
 * reads `currentAuth()`, which a scheduled job has none of.
 *
 * **Idempotent by the state it reads, not by a constraint.** A tenant already
 * `expired` does not match the query that expires one, so a second pass in the
 * same hour writes nothing. The advisory lock below is about two *machines*, not
 * two passes.
 *
 * **A `comped` tenant is never moved**, whatever its dates say. The free pilot is
 * live and unbilled and does not run out — that is what the word has meant since
 * the platform slice, and the first filter being `subscription_status =
 * 'trialing'` is what makes it true rather than a comment saying so.
 *
 * **Nothing here touches Clerk.** `TenantMiddleware` already refuses the request,
 * so somebody who cannot get past the door never counts as a monthly active user;
 * deactivating their Clerk account would lock them out of a *second* club they
 * still pay for. One person, several organizations, is a shape this schema has
 * always had. Decided 13 September 2026.
 */
@Injectable()
export class TrialClockService {
  private readonly log = new Logger(TrialClockService.name);

  /**
   * One arbitrary constant, and it has to stay arbitrary and constant.
   *
   * `pg_try_advisory_xact_lock` takes a number, not a name, and two Railway
   * instances waking at the same minute must pick the same one or the lock does
   * nothing. Held for the transaction and released by the commit, so a crashed
   * instance does not leave it taken — which a session-level lock would.
   */
  private static readonly LOCK_KEY = 6_1_2026_09_14;

  /** What a club is told when the clock, rather than a person, closes the door. */
  static readonly CLOSED_REASON =
    'O período de avaliação terminou e a subscrição não foi ativada.';

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      /*
       * Swallowed, deliberately. An unhandled rejection from a cron takes the
       * API process down with it, and a database hiccup at 03:00 must not close
       * the app for every club until somebody notices. The next hour tries
       * again, because every step is driven by state rather than by a cursor.
       */
      this.log.error('The trial clock failed this hour', error as Error);
    }
  }

  /**
   * One pass, over every tenant or over one.
   *
   * `organizationId` narrows it, and the reason it exists is worth stating: the
   * job is **global by design** — it sweeps the whole estate, which is right in
   * production and hostile anywhere a database is shared. An integration suite
   * runs its files concurrently against one database, so an unscoped pass reaches
   * into another test's scratch tenant, expires it, and leaves it a transition
   * that test never asked for. Scoping is what makes the clock's own tests
   * deterministic rather than a race.
   *
   * It is not only a test seam. "Run the clock for this one tenant" is the shape
   * an operator's *check this now* would take, and building the parameter into
   * the query rather than around it means that button, when it arrives, is not a
   * second implementation of the ladder.
   */
  async run(organizationId?: string): Promise<TrialClockResult> {
    const only = organizationId ?? null;
    const empty: TrialClockResult = { locked: false, expired: 0, closed: 0, notices: 0 };

    return withPlatform(async (tx) => {
      /*
       * A second instance is a no-op, not a double transition.
       *
       * `try` rather than a waiting lock: an instance that cannot have the lock
       * has nothing useful to do with it a moment later, because the one holding
       * it is doing exactly the work it would have done.
       */
      const { rows: lock } = await tx.query<{ taken: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1) AS taken',
        [TrialClockService.LOCK_KEY],
      );
      if (lock[0]?.taken !== true) return empty;

      const expired = await this.expireTrials(tx, only);
      const closed = await this.closeAccess(tx, only);
      const notices = await this.recordNotices(tx, only);

      if (expired + closed + notices > 0) {
        this.log.log(
          `Trial clock: ${expired} expired, ${closed} closed, ${notices} notices recorded`,
        );
      }

      return { locked: true, expired, closed, notices };
    });
  }

  /**
   * Step 1 — a trial that has run out.
   *
   * `trialing` and nothing else, which is what keeps `comped` out. The dates come
   * from the database's own clock and from `trial_read_only_period()`, so the
   * ladder's numbers live where `trial_period()` does rather than in this file.
   */
  private async expireTrials(tx: Tx, only: string | null): Promise<number> {
    const { rows } = await tx.query<{ id: string }>(
      `WITH moved AS (
         UPDATE organization
            SET subscription_status = 'expired',
                read_only_at = now(),
                pending_delete_at = now() + trial_read_only_period()
          WHERE subscription_status = 'trialing'
            AND trial_ends_at IS NOT NULL
            AND trial_ends_at < now()
            AND archived_at IS NULL
            AND ($1::uuid IS NULL OR id = $1)
        RETURNING id, read_only_at, pending_delete_at
       )
       INSERT INTO trial_event (organization_id, transition, read_only_at, pending_delete_at)
       SELECT id, 'expired', read_only_at, pending_delete_at FROM moved
       RETURNING organization_id AS id`,
      [only],
    );
    return rows.length;
  }

  /**
   * Step 2 — sign-in closes.
   *
   * Through `suspended_at`, the mechanism that already exists, rather than a
   * fourth access state: the club is closed and the middleware already knows how
   * to say so. The reason is the machine's, and `trial_event` is what makes it
   * distinguishable six weeks later from a sentence an operator typed — on the
   * `organization` row the two are identical.
   *
   * A tenant a person has already suspended is skipped: their reason is the one
   * that should be on screen, and overwriting it would lose why the door was
   * really shut.
   */
  private async closeAccess(tx: Tx, only: string | null): Promise<number> {
    const { rows } = await tx.query<{ id: string }>(
      `WITH moved AS (
         UPDATE organization
            SET suspended_at = now(),
                suspension_reason = $1
          WHERE subscription_status = 'expired'
            AND pending_delete_at IS NOT NULL
            AND pending_delete_at < now()
            AND suspended_at IS NULL
            AND archived_at IS NULL
            AND ($2::uuid IS NULL OR id = $2)
        RETURNING id, read_only_at, pending_delete_at
       )
       INSERT INTO trial_event
         (organization_id, transition, read_only_at, pending_delete_at, reason)
       SELECT id, 'access_closed', read_only_at, pending_delete_at, $1 FROM moved
       RETURNING organization_id AS id`,
      [TrialClockService.CLOSED_REASON, only],
    );
    return rows.length;
  }

  /**
   * What somebody was owed, written down — never sent.
   *
   * There is no email provider wired; choosing one is a later slice that reads
   * this same table and stamps `delivered_at`. Every screen that shows a notice
   * says plainly that nothing has been delivered, which is the honesty the chase
   * list already owes about the same gap.
   *
   * **Recipients are left empty, on purpose.** An owner's address lives in
   * `app_user.cached_email`, not on their membership row, and `poolse_platform`
   * holds no privilege on `app_user` — the platform login is narrow so that a
   * mistake in it leaks seven tables rather than every user's name and e-mail in
   * every club. Granting an eighth table so a job that sends nothing could write
   * an address down would be paying that price for no delivery. The slice that
   * wires a provider resolves them at send time, which is when "who was told"
   * becomes a fact worth freezing.
   *
   * `ON CONFLICT DO NOTHING` against the (tenant, kind, day) key is what makes an
   * hourly job write each notice once, and the day being in the key is what lets a
   * club whose trial was extended be owed the same notice again later.
   */
  private async recordNotices(tx: Tx, only: string | null): Promise<number> {
    const { rowCount } = await tx.query(
      `WITH scope AS (
         SELECT o.* FROM organization o
          WHERE o.archived_at IS NULL AND ($1::uuid IS NULL OR o.id = $1)
       ),
       due AS (
         -- Before the trial ends, counted from its end rather than from signup:
         -- an operator who extends a trial moves both of these with it.
         SELECT o.id, 'trial_ending_soon'::trial_notice_kind AS kind,
                (o.trial_ends_at - interval '5 days')::date AS due_on
           FROM scope o
          WHERE o.subscription_status = 'trialing'
            AND o.trial_ends_at IS NOT NULL
            AND now() >= o.trial_ends_at - interval '5 days'
            AND now() < o.trial_ends_at
          UNION ALL
         SELECT o.id, 'trial_last_day', (o.trial_ends_at - interval '1 day')::date
           FROM scope o
          WHERE o.subscription_status = 'trialing'
            AND o.trial_ends_at IS NOT NULL
            AND now() >= o.trial_ends_at - interval '1 day'
            AND now() < o.trial_ends_at
          UNION ALL
         -- The day it actually ended, and the two that count down to the door.
         SELECT o.id, 'trial_ended', o.read_only_at::date
           FROM scope o
          WHERE o.subscription_status = 'expired'
            AND o.read_only_at IS NOT NULL
          UNION ALL
         SELECT o.id, 'access_closing_soon', (o.pending_delete_at - interval '7 days')::date
           FROM scope o
          WHERE o.subscription_status = 'expired'
            AND o.pending_delete_at IS NOT NULL
            AND now() >= o.pending_delete_at - interval '7 days'
            AND o.suspended_at IS NULL
          UNION ALL
         SELECT o.id, 'access_closed', o.suspended_at::date
           FROM scope o
          WHERE o.subscription_status = 'expired'
            AND o.suspended_at IS NOT NULL
          UNION ALL
         SELECT o.id, 'deletion_soon',
                (o.suspended_at + trial_closed_period() - interval '7 days')::date
           FROM scope o
          WHERE o.subscription_status = 'expired'
            AND o.suspended_at IS NOT NULL
            AND now() >= o.suspended_at + trial_closed_period() - interval '7 days'
       )
       INSERT INTO trial_notice (organization_id, kind, due_on)
       SELECT due.id, due.kind, due.due_on FROM due
       ON CONFLICT (organization_id, kind, due_on) DO NOTHING`,
      [only],
    );
    return rowCount ?? 0;
  }
}

/** What one pass did. `locked: false` means another instance was already on it. */
export interface TrialClockResult {
  locked: boolean;
  expired: number;
  closed: number;
  notices: number;
}

/** The transaction handle `withPlatform` hands out. */
type Tx = Parameters<Parameters<typeof withPlatform>[0]>[0];

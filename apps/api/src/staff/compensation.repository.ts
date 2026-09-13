import { withOrg, type Tx } from '@poolse/db';
import {
  hourlyForRow,
  monthlyForRow,
  rollup,
  type Compensation,
  type CompensationKind,
  type Rollup,
} from '@poolse/rules';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { personName, personOrder, personShortName } from '../people/names.js';
import { windowed, type Paginated, type PageQuery, TOTAL_COUNT } from '../common/pagination.js';

/**
 * Staff salaries — POOLSE-58.
 *
 * **The visibility rule lives here, not in `requireRole` and not in a policy.**
 * Owner and Admin both reach these endpoints; *which rows* each may see is a
 * question about a row — an Admin sees every staff member except the Owner — and
 * the repository is where a question about a row gets answered, as
 * `lesson-plans.repository.ts` established. One predicate, `visibleToViewer`,
 * feeds the list, the history, the roll-up, every write and (POOLSE-59) the
 * export, so those cannot drift apart into five slightly different rules.
 *
 * It is deliberately *not* an RLS policy. RLS answers "which tenant"; making it
 * answer "which role within the tenant" would put an authorisation rule
 * somewhere no test reads and no error message can explain, and would leave the
 * API unable to tell 403 from 404.
 *
 * **Nothing here logs an amount.** The audit entries carry who changed whose
 * rate and when — the table itself is the effective-dated, soft-deleted record
 * of what was paid, so repeating the figure in the trail only adds another place
 * it lives and another place it leaks.
 */

/** A staff member's pay as one row of the salaries list. */
export interface SalaryRow {
  membershipId: string;
  displayName: string | null;
  shortName: string | null;
  roles: string[];
  /** Null when nothing is recorded for them — "sem valor definido". */
  live: LiveRate | null;
}

export interface LiveRate {
  id: string;
  kind: CompensationKind;
  amountCents: number;
  currency: string;
  weeklyHours: number | null;
  payPeriodsPerYear: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  /**
   * Both figures, and which of the two was derived from the other — so the
   * screen mutes and labels the estimate without re-deciding what an estimate
   * is. Null cents means the hours are not recorded: a dash, never a zero.
   */
  monthlyCents: number | null;
  monthlyDerived: boolean;
  hourlyCents: number | null;
  hourlyDerived: boolean;
}

/** One row of somebody's history, live or not. */
export interface RateRecord extends LiveRate {
  createdByName: string | null;
  createdAt: string;
  archivedAt: string | null;
  /** True for the rate covering today. At most one, by exclusion constraint. */
  current: boolean;
}

export interface SalarySummary extends Rollup {
  /**
   * Whether the figures leave somebody out — always true for an Admin.
   *
   * Said on the card in words, because an Admin's total is a different number
   * from the Owner's for the same club, and an absence nobody explains reads as
   * a zero.
   */
  ownerExcluded: boolean;
}

/** What the caller is allowed to be shown. Resolved once, in the controller. */
export interface Viewer {
  /** The Owner sees everybody, including themselves. An Admin does not. */
  isOwner: boolean;
}

/**
 * The club's today, in the club's timezone.
 *
 * A rate starting "on 1 October" starts when it is the 1st of October where the
 * pool is, not where the server is. Same resolution the staff list uses for who
 * is away: the organization's oldest site, because a salary belongs to the
 * organization rather than to any one facility.
 */
const CLUB_TODAY = `(now() AT TIME ZONE coalesce(
  (SELECT f.timezone FROM facility f
    WHERE f.organization_id = m.organization_id AND f.archived_at IS NULL
    ORDER BY f.created_at, f.id LIMIT 1), 'Europe/Lisbon'))::date`;

/**
 * Who appears on a salary list at all.
 *
 * A staff role held now — owner, admin, instructor or maintenance. Unlike the
 * staff list, somebody holding **no** role is not included: that is an
 * unaccepted invitation, and a person with no job yet has no wage, so listing
 * them as "sem valor definido" would put a to-do on the screen that nobody can
 * act on.
 */
const HOLDS_A_STAFF_ROLE = `EXISTS (
  SELECT 1 FROM membership_role r
   WHERE r.membership_id = m.id AND r.organization_id = m.organization_id
     AND r.archived_at IS NULL
     AND r.role IN ('owner', 'admin', 'instructor', 'maintenance')
)`;

const IS_THE_OWNER = `EXISTS (
  SELECT 1 FROM membership_role r
   WHERE r.membership_id = m.id AND r.organization_id = m.organization_id
     AND r.archived_at IS NULL AND r.role = 'owner'
)`;

/**
 * The one place the Owner exception is written.
 *
 * `$n` is the viewer's own `isOwner`. An Admin gets the Owner filtered out of
 * the set entirely rather than blanked: a greyed row saying "hidden" tells them
 * what they were not meant to learn as surely as the figure would.
 */
function visibleToViewer(param: string): string {
  return `(${param}::boolean OR NOT ${IS_THE_OWNER})`;
}

/** The rate covering the club's today, if there is one. */
const LIVE_RATE = `(
  SELECT to_jsonb(sc)
    FROM staff_compensation sc
   WHERE sc.staff_membership_id = m.id
     AND sc.organization_id = m.organization_id
     AND sc.archived_at IS NULL
     AND sc.effective_from <= ${CLUB_TODAY}
     AND (sc.effective_to IS NULL OR sc.effective_to >= ${CLUB_TODAY})
   LIMIT 1
)`;

interface RateRow {
  id: string;
  kind: CompensationKind;
  amount_cents: number;
  currency: string;
  weekly_hours: string | number | null;
  pay_periods_per_year: number;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
}

/**
 * `numeric` arrives as a string from node-postgres — deliberately, so nobody
 * loses a digit to a float — and every figure downstream is arithmetic. Parsed
 * once, here, rather than in each of the four places that read it.
 */
function hours(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function contract(row: RateRow): Compensation {
  return {
    kind: row.kind,
    amountCents: row.amount_cents,
    weeklyHours: hours(row.weekly_hours),
    payPeriodsPerYear: row.pay_periods_per_year,
  };
}

function toRate(row: RateRow): LiveRate {
  const c = contract(row);
  const monthly = monthlyForRow(c);
  const hourly = hourlyForRow(c);

  return {
    id: row.id,
    kind: row.kind,
    amountCents: row.amount_cents,
    currency: row.currency,
    weeklyHours: c.weeklyHours,
    payPeriodsPerYear: row.pay_periods_per_year,
    // `date` comes back as a JS Date on a plain select and as an ISO string
    // through to_jsonb. Both reach the client as YYYY-MM-DD.
    effectiveFrom: day(row.effective_from),
    effectiveTo: row.effective_to === null ? null : day(row.effective_to),
    note: row.note,
    monthlyCents: monthly.cents,
    monthlyDerived: monthly.derived,
    hourlyCents: hourly.cents,
    hourlyDerived: hourly.derived,
  };
}

/**
 * A `date` column as `YYYY-MM-DD`, in the calendar it was written in.
 *
 * **Never `toISOString()`.** node-postgres parses a `date` into a Date at local
 * midnight, and in Lisbon that is 23:00 UTC the day before for half the year —
 * so a rate effective 1 October came back as 30 September, a raise closed itself
 * a day early, and the overlap check compared the wrong two days. A date has no
 * timezone; reading one through an instant gives it somebody else's.
 */
function day(value: string | Date): string {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const date = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${date}`;
}

/**
 * One page of the salaries list.
 *
 * The staff list paginates at `PAGE_SIZE` and so does this one — it is the same
 * list with a column added, and `CONVENTIONS.md` puts anything that grows with
 * the club behind a window. The roll-up is deliberately **not** computed from
 * these rows; see `salarySummary`.
 */
export async function listSalaries(
  organizationId: string,
  viewer: Viewer,
  page: PageQuery,
): Promise<Paginated<SalaryRow>> {
  return withOrg(organizationId, async (tx) => {
    const run = (limit: number, offset: number) =>
      tx.query<{
        total_count: number;
        membership_id: string;
        display_name: string | null;
        short_name: string | null;
        roles: string[];
        live: RateRow | null;
      }>(
        `SELECT ${TOTAL_COUNT},
                m.id AS membership_id,
                ${personName('m.id')} AS display_name,
                ${personShortName('m.id')} AS short_name,
                coalesce((
                  SELECT array_agg(r.role::text ORDER BY r.role::text)
                    FROM membership_role r
                   WHERE r.membership_id = m.id
                     AND r.organization_id = m.organization_id
                     AND r.archived_at IS NULL
                ), '{}'::text[]) AS roles,
                ${LIVE_RATE} AS live
           FROM membership m
          WHERE m.archived_at IS NULL
            AND ${HOLDS_A_STAFF_ROLE}
            AND ${visibleToViewer('$1')}
          ORDER BY ${personOrder('m.id')}, m.created_at
          LIMIT $2 OFFSET $3`,
        [viewer.isOwner, limit, offset],
      );

    return windowed(page, run, (row) => ({
      membershipId: row.membership_id,
      displayName: row.display_name,
      shortName: row.short_name,
      roles: row.roles,
      live: row.live === null ? null : toRate(row.live),
    }));
  });
}

/**
 * The roll-up card — every staff member the viewer may see, not the page.
 *
 * Its own query for exactly that reason: a card summed from the rows on screen
 * is right on page 1 and silently wrong on page 2, which is the worst way for a
 * total to be wrong. Bounded by the club's staff, which `max_management_users`
 * already bounds, so it is an honest unpaginated read.
 */
export async function salarySummary(
  organizationId: string,
  viewer: Viewer,
): Promise<SalarySummary> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ live: RateRow | null }>(
      `SELECT ${LIVE_RATE} AS live
         FROM membership m
        WHERE m.archived_at IS NULL
          AND ${HOLDS_A_STAFF_ROLE}
          AND ${visibleToViewer('$1')}`,
      [viewer.isOwner],
    );

    const live = rows.flatMap((row) => (row.live === null ? [] : [contract(row.live)]));
    const noRate = rows.filter((row) => row.live === null).length;

    return { ...rollup(live, noRate), ownerExcluded: !viewer.isOwner };
  });
}

/**
 * Whether this viewer may see — and therefore write — this person's pay.
 *
 * One question answering both, because reading and writing are one boundary: a
 * POST whose result the caller may not read is a way to overwrite what they are
 * not allowed to see. Null means "no such staff member here", which is also the
 * answer for another tenant's id, RLS having hidden it.
 */
export async function canSeeCompensation(
  organizationId: string,
  viewer: Viewer,
  membershipId: string,
): Promise<'yes' | 'forbidden' | 'missing'> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ is_owner: boolean; staff: boolean }>(
      `SELECT ${IS_THE_OWNER} AS is_owner, ${HOLDS_A_STAFF_ROLE} AS staff
         FROM membership m
        WHERE m.id = $1`,
      [membershipId],
    );

    const row = rows[0];
    if (row === undefined || !row.staff) return 'missing';
    return row.is_owner && !viewer.isOwner ? 'forbidden' : 'yes';
  });
}

/**
 * Somebody's whole history, newest first — including archived rows.
 *
 * An archived rate is still what the club paid at the time, so it stays
 * readable; `archivedAt` is what tells the screen to grey it. The same is true
 * of an archived *person*: they were paid in March and their record says so.
 */
export async function listHistory(
  organizationId: string,
  membershipId: string,
): Promise<RateRecord[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<
      RateRow & {
        created_by_name: string | null;
        created_at: Date;
        archived_at: Date | null;
        current: boolean;
      }
    >(
      `SELECT sc.id, sc.kind, sc.amount_cents, sc.currency, sc.weekly_hours,
              sc.pay_periods_per_year, sc.effective_from, sc.effective_to, sc.note,
              ${personName('sc.created_by_membership_id')} AS created_by_name,
              sc.created_at, sc.archived_at,
              (sc.archived_at IS NULL
                 AND sc.effective_from <= ${CLUB_TODAY}
                 AND (sc.effective_to IS NULL OR sc.effective_to >= ${CLUB_TODAY})) AS current
         FROM staff_compensation sc
         JOIN membership m ON m.id = sc.staff_membership_id
                          AND m.organization_id = sc.organization_id
        WHERE sc.staff_membership_id = $1
        ORDER BY sc.effective_from DESC, sc.created_at DESC`,
      [membershipId],
    );

    return rows.map((row) => ({
      ...toRate(row),
      createdByName: row.created_by_name,
      createdAt: row.created_at.toISOString(),
      archivedAt: row.archived_at === null ? null : row.archived_at.toISOString(),
      current: row.current,
    }));
  });
}

/** What a caller may set. Validated in the controller; assumed sane here. */
export interface RateInput {
  kind: CompensationKind;
  amountCents: number;
  weeklyHours: number | null;
  payPeriodsPerYear: number;
  effectiveFrom: string;
  note: string | null;
}

/**
 * Raised in place of a bare `23P01`, carrying the row that was in the way.
 *
 * The dates travel as fields rather than inside a sentence — the rule this
 * schema applies to every refusal that needs numbers. A controller turns it into
 * a 409 and the screen says "já existe um valor de 1 de setembro a 31 de
 * outubro" in whichever language the reader has.
 */
export class RateOverlapError extends Error {
  constructor(readonly from: string, readonly to: string | null) {
    super('That person already has a rate covering those dates');
    this.name = 'RateOverlapError';
  }
}

/**
 * Add a rate, closing the one it succeeds.
 *
 * **One transaction, and the lock is what makes it safe.** The person's rows are
 * taken `FOR UPDATE` before anything is decided, so two admins saving at the
 * same moment serialise instead of both reading "no overlap" and both
 * inserting — the same reasoning as the row lock invoice numbering takes.
 *
 * A new rate is always open-ended: closing one is `PATCH`, and giving `POST` an
 * end date as well would let a caller create a gap they never see. The rate it
 * supersedes is closed the day before — `effective_to` is the last day at that
 * rate, so 31 October closes it and 1 November opens the new one.
 *
 * A rate starting *before* an existing one is refused rather than silently
 * reordering history: the exclusion constraint would refuse it anyway, and the
 * explicit check is what lets the refusal name the dates.
 */
export async function addRate(
  organizationId: string,
  membershipId: string,
  input: RateInput,
): Promise<{ id: string }> {
  return withOrg(organizationId, async (tx) => {
    const overlaps = await lockAndFindOverlaps(tx, membershipId, input.effectiveFrom, null, null);

    /*
     * **Only an open-ended rate is closed for the operator.**
     *
     * "Until further notice" is what an open end means, so a new rate starting
     * after it is the notice and closing it the day before is exactly what was
     * meant. A rate whose end somebody *typed* is different: a new one starting
     * inside it contradicts a date a person chose, and rewriting that silently
     * would be Poolse deciding when a contract ended. So is a rate starting
     * before an existing one — history is not reordered on somebody's behalf.
     *
     * More than one overlap means a future rate is also in the way; the refusal
     * names the later of them, because that is the one the operator has to move.
     */
    const previous = overlaps[0];
    const closable =
      overlaps.length === 1 &&
      previous !== undefined &&
      previous.effective_to === null &&
      day(previous.effective_from) < input.effectiveFrom;

    if (overlaps.length > 0 && !closable) {
      const blocker = overlaps[overlaps.length - 1]!;
      throw new RateOverlapError(
        day(blocker.effective_from),
        blocker.effective_to === null ? null : day(blocker.effective_to),
      );
    }

    if (closable) {
      await tx.query(
        `UPDATE staff_compensation
            SET effective_to = $2::date - 1
          WHERE id = $1`,
        [previous!.id, input.effectiveFrom],
      );
    }

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO staff_compensation
         (organization_id, staff_membership_id, kind, amount_cents, weekly_hours,
          pay_periods_per_year, effective_from, note, created_by_membership_id)
       VALUES (current_organization_id(), $1, $2::compensation_kind, $3, $4, $5, $6::date, $7,
               $8)
       RETURNING id`,
      [
        membershipId,
        input.kind,
        input.amountCents,
        input.weeklyHours,
        input.payPeriodsPerYear,
        input.effectiveFrom,
        input.note,
        actor(),
      ],
    ).catch(rethrowOverlap);

    const id = rows[0]!.id;

    await recordAudit(tx, {
      action: 'staff.compensation.created',
      entityType: 'staff_compensation',
      entityId: id,
      // No amount. The table is the record of what was paid; the trail is the
      // record of who touched it.
      data: { staffMembershipId: membershipId, kind: input.kind, effectiveFrom: input.effectiveFrom },
    });

    return { id };
  });
}

/** The rate itself, for the two paths that act on one by id. */
export async function findRate(
  organizationId: string,
  id: string,
): Promise<{ id: string; staffMembershipId: string; archivedAt: string | null } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      staff_membership_id: string;
      archived_at: Date | null;
    }>(`SELECT id, staff_membership_id, archived_at FROM staff_compensation WHERE id = $1`, [id]);

    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      staffMembershipId: row.staff_membership_id,
      archivedAt: row.archived_at === null ? null : row.archived_at.toISOString(),
    };
  });
}

/**
 * Correct a rate that was wrong.
 *
 * A correction, not a raise — a raise is a new row. Both dates are settable
 * here, which is how a rate is closed deliberately, and the exclusion constraint
 * is what stops a correction from producing two live rates.
 */
export async function updateRate(
  organizationId: string,
  id: string,
  input: RateInput & { effectiveTo: string | null },
): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ staff_membership_id: string }>(
      `SELECT staff_membership_id FROM staff_compensation WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const subject = rows[0]?.staff_membership_id;
    if (subject === undefined) return;

    const [clash] = await lockAndFindOverlaps(
      tx,
      subject,
      input.effectiveFrom,
      input.effectiveTo,
      id,
    );
    if (clash !== undefined) {
      throw new RateOverlapError(
        day(clash.effective_from),
        clash.effective_to === null ? null : day(clash.effective_to),
      );
    }

    await tx
      .query(
        `UPDATE staff_compensation
            SET kind = $2::compensation_kind,
                amount_cents = $3,
                weekly_hours = $4,
                pay_periods_per_year = $5,
                effective_from = $6::date,
                effective_to = $7::date,
                note = $8
          WHERE id = $1`,
        [
          id,
          input.kind,
          input.amountCents,
          input.weeklyHours,
          input.payPeriodsPerYear,
          input.effectiveFrom,
          input.effectiveTo,
          input.note,
        ],
      )
      .catch(rethrowOverlap);

    await recordAudit(tx, {
      action: 'staff.compensation.updated',
      entityType: 'staff_compensation',
      entityId: id,
      data: {
        staffMembershipId: subject,
        kind: input.kind,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
      },
    });
  });
}

/**
 * Archive a rate. Never a delete.
 *
 * **The rate before it is not reopened.** A closed rate coming back to life is a
 * pay change nobody made; archiving the live one leaves that person with no live
 * rate, which the list says as "sem valor definido" — visibly nothing rather
 * than quietly something.
 */
export async function archiveRate(organizationId: string, id: string): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ staff_membership_id: string }>(
      `UPDATE staff_compensation
          SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
        RETURNING staff_membership_id`,
      [id],
    );

    const subject = rows[0]?.staff_membership_id;
    if (subject === undefined) return;

    await recordAudit(tx, {
      action: 'staff.compensation.archived',
      entityType: 'staff_compensation',
      entityId: id,
      data: { staffMembershipId: subject },
    });
  });
}

/**
 * The live rows for one person, locked, that overlap a proposed range.
 *
 * `FOR UPDATE` on the person's live rows rather than on the table: it serialises
 * two saves for the same person and lets saves for different people run
 * together, which is what a club with twenty staff doing a January review
 * actually does.
 */
async function lockAndFindOverlaps(
  tx: Tx,
  membershipId: string,
  from: string,
  to: string | null,
  excludeId: string | null,
): Promise<RateRow[]> {
  const { rows } = await tx.query<RateRow>(
    `SELECT id, kind, amount_cents, currency, weekly_hours, pay_periods_per_year,
            effective_from, effective_to, note
       FROM staff_compensation
      WHERE staff_membership_id = $1
        AND archived_at IS NULL
        AND ($4::uuid IS NULL OR id <> $4::uuid)
        AND daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)')
            && daterange($2::date, coalesce($3::date + 1, 'infinity'::date), '[)')
      ORDER BY effective_from
        FOR UPDATE`,
    [membershipId, from, to, excludeId],
  );

  return rows;
}

/**
 * The backstop: the constraint is the authority, and a race that beats the check
 * above still has to come back as a sentence rather than as a 500.
 *
 * Without the offending row's dates, because at this point another transaction
 * holds them — the screen says "there is already a rate covering those dates",
 * which is true and is enough to act on.
 */
function rethrowOverlap(error: unknown): never {
  if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23P01') {
    throw new RateOverlapError('', null);
  }
  throw error;
}

/**
 * The acting membership, for `created_by`.
 *
 * Read from the request context rather than taken as an argument, for the reason
 * `recordAudit` states: "who" is never something a caller should get to decide,
 * and there is no parameter here to pass the wrong value to.
 */
function actor(): string {
  return currentTenant().membershipId;
}

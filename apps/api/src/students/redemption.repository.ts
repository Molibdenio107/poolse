import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * Spending a reposição credit — POOLSE-21, slice 2, criteria 3, 4 and 6.
 *
 * Kept apart from `credits.repository.ts`, which reads and expires. The split is
 * the same one the schema makes: a credit is a thing the club owes, and a
 * booking is a thing that happens to an occurrence. They have different
 * permission rules and different failure modes.
 */

/** One occurrence a credit could be spent on. */
export interface RedemptionOption {
  sessionId: string;
  classGroupId: string;
  className: string;
  levelName: string | null;
  poolName: string | null;
  /** The club's local date — never an instant, because that is what a family reads. */
  localDate: string;
  startTime: string;
  /** Places open on that date, by the shared rule. Null when the turma has no limit. */
  freeSeats: number | null;
}

/**
 * The eligibility rule lives in the database — `reposicao_options()`.
 *
 * `bookCredit` calls the same function inside its transaction rather than
 * repeating any clause, so there is one definition of "eligible" instead of a
 * list rule and a booking rule that can drift apart. That drift is how an API
 * ends up accepting a booking its own interface would never have offered.
 */
const OPTIONS_SQL = 'SELECT * FROM reposicao_options($1)';

interface OptionRow {
  session_id: string;
  class_group_id: string;
  class_name: string;
  level_name: string | null;
  pool_name: string | null;
  local_date: string;
  start_time: string;
  free_seats: number | null;
}

const toOption = (row: OptionRow): RedemptionOption => ({
  sessionId: row.session_id,
  classGroupId: row.class_group_id,
  className: row.class_name,
  levelName: row.level_name,
  poolName: row.pool_name,
  localDate: row.local_date,
  startTime: row.start_time,
  freeSeats: row.free_seats,
});

/**
 * Where a credit could be spent — criterion 3, narrowed by criterion 4.
 *
 * The interesting clause is the seat count, which comes from
 * `session_free_seats()`: an absence recorded on a date frees a place *for that
 * date*. That is what lets the open-seat rule and the backfill-only rule both
 * hold at once on a full turma with one absence — the conflict the ticket names.
 *
 * Ordered by date, because a family choosing a make-up wants the soonest one
 * they can make rather than the one an algorithm preferred.
 */
export async function redemptionOptions(
  organizationId: string,
  creditId: string,
): Promise<RedemptionOption[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<OptionRow>(OPTIONS_SQL, [creditId]);
    return rows.map(toOption);
  });
}

export type BookOutcome =
  | { ok: true; bookingId: string; status: 'pending' | 'confirmed' }
  | { ok: false; reason: 'not_found' | 'not_available' | 'not_eligible' };

/**
 * Spends a credit on an occurrence — criteria 3 and 6.
 *
 * **Eligibility is re-checked inside the transaction, after locking the credit.**
 * The list a family is looking at was true when it was drawn, and the last place
 * on Tuesday can go while they decide. Checking only at render time is how two
 * guests land on a turma with one free seat — and `session_free_seats` counts
 * pending bookings, so the second request sees the first one's hold.
 *
 * The club's mode decides the outcome: self-service confirms at once, request
 * leaves it pending with a hold. Both take the seat, because a hold that could be
 * gazumped would not be a hold.
 */
export async function bookCredit(
  organizationId: string,
  creditId: string,
  sessionId: string,
  actorMembershipId: string,
): Promise<BookOutcome> {
  return withOrg(organizationId, async (tx) => {
    const { rows: locked } = await tx.query<{
      status: string;
      mode: string;
      hold_hours: number;
    }>(
      `SELECT c.status::text AS status,
              o.reposicao_mode::text AS mode,
              o.reposicao_hold_hours AS hold_hours
         FROM reposicao_credit c
         JOIN organization o ON o.id = c.organization_id
        WHERE c.id = $1 AND c.archived_at IS NULL
          FOR UPDATE OF c`,
      [creditId],
    );

    const credit = locked[0];
    if (!credit) return { ok: false, reason: 'not_found' };
    if (credit.status !== 'available') return { ok: false, reason: 'not_available' };

    // The same query the list came from, inside the lock. A direct call naming a
    // session past the expiry fails here rather than being accepted — QA 21.7.
    const { rows: eligible } = await tx.query<OptionRow>(OPTIONS_SQL, [creditId]);
    if (!eligible.some((row) => row.session_id === sessionId)) {
      return { ok: false, reason: 'not_eligible' };
    }

    const status = credit.mode === 'self_service' ? 'confirmed' : 'pending';

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO reposicao_booking (
         organization_id, credit_id, class_session_id, status,
         requested_by_membership_id, holds_until,
         decided_by_membership_id, decided_at
       ) VALUES (
         $1, $2, $3, $4::reposicao_booking_status, $5,
         CASE WHEN $4 = 'pending' THEN now() + make_interval(hours => $6::int) END,
         CASE WHEN $4 = 'confirmed' THEN $5 END,
         CASE WHEN $4 = 'confirmed' THEN now() END
       )
       RETURNING id`,
      [organizationId, creditId, sessionId, status, actorMembershipId, credit.hold_hours],
    );

    const bookingId = rows[0]!.id;

    await recordAudit(tx, {
      action: status === 'confirmed' ? 'reposicao.booked' : 'reposicao.requested',
      entityType: 'reposicao_booking',
      entityId: bookingId,
      data: { creditId, classSessionId: sessionId },
    });

    return { ok: true, bookingId, status };
  });
}

export type DecideOutcome = 'decided' | 'not_found' | 'not_pending' | 'already_started';

/**
 * Approves or rejects a pending request — criterion 6, request mode.
 *
 * Rejecting returns the credit to `available`, which the trigger does. The family
 * did nothing wrong: they asked for a date that did not suit, and they keep the
 * class they are owed.
 */
export async function decideBooking(
  organizationId: string,
  bookingId: string,
  decision: 'confirmed' | 'rejected',
  actorMembershipId: string,
): Promise<DecideOutcome> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ status: string }>(
      `SELECT status::text AS status FROM reposicao_booking
        WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
      [bookingId],
    );

    const booking = rows[0];
    if (!booking) return 'not_found';
    if (booking.status !== 'pending') return 'not_pending';

    await tx.query(
      `UPDATE reposicao_booking
          SET status = $2::reposicao_booking_status,
              holds_until = NULL,
              decided_by_membership_id = $3,
              decided_at = now()
        WHERE id = $1`,
      [bookingId, decision, actorMembershipId],
    );

    await recordAudit(tx, {
      action: `reposicao.${decision === 'confirmed' ? 'approved' : 'rejected'}`,
      entityType: 'reposicao_booking',
      entityId: bookingId,
      data: { decision },
    });

    return 'decided';
  });
}

/**
 * Cancels a booking before the class.
 *
 * The credit returns to `available` **with its original expiry untouched**, which
 * the ticket is explicit about: cancelling is not a fresh start, and a family
 * cannot stretch a credit by booking and cancelling it. The trigger frees the
 * credit; nothing here goes near `expires_on`.
 *
 * Refused once the class has started: after the occurrence a credit is *used*
 * whether or not the student turned up, so there is nothing left to cancel.
 */
export async function cancelBooking(
  organizationId: string,
  bookingId: string,
  actorMembershipId: string,
): Promise<DecideOutcome> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ status: string; started: boolean }>(
      `SELECT b.status::text AS status, cs.starts_at <= now() AS started
         FROM reposicao_booking b
         JOIN class_session cs
           ON cs.id = b.class_session_id AND cs.organization_id = b.organization_id
        WHERE b.id = $1 AND b.archived_at IS NULL
          FOR UPDATE OF b`,
      [bookingId],
    );

    const booking = rows[0];
    if (!booking) return 'not_found';
    if (booking.status !== 'pending' && booking.status !== 'confirmed') return 'not_pending';
    if (booking.started) return 'already_started';

    await tx.query(
      `UPDATE reposicao_booking
          SET status = 'cancelled', holds_until = NULL,
              decided_by_membership_id = $2, decided_at = now()
        WHERE id = $1`,
      [bookingId, actorMembershipId],
    );

    await recordAudit(tx, {
      action: 'reposicao.cancelled',
      entityType: 'reposicao_booking',
      entityId: bookingId,
      data: {},
    });

    return 'decided';
  });
}

/**
 * Whether this membership may act for this student — QA 21.8.
 *
 * A Student or an encarregado may act only for themselves or for a child they
 * are linked to. One query rather than a rule spread across three endpoints, and
 * answered in SQL because guardianship is a row rather than a claim on a token.
 *
 * Staff do not go through this — the controller lets owner, admin and instructor
 * past first, which is the ticket's rule and also why this can be strict.
 */
export async function mayActForStudent(
  organizationId: string,
  membershipId: string,
  studentId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ allowed: boolean }>(
      `SELECT EXISTS (
                -- The student is this person.
                SELECT 1 FROM student s
                 WHERE s.id = $2 AND s.membership_id = $1 AND s.archived_at IS NULL
                UNION ALL
                -- Or this person is their encarregado de educação.
                SELECT 1 FROM guardian_link gl
                 WHERE gl.student_id = $2
                   AND gl.guardian_membership_id = $1
                   AND gl.archived_at IS NULL
              ) AS allowed`,
      [membershipId, studentId],
    );
    return rows[0]?.allowed ?? false;
  });
}

/** The student a credit belongs to, for the permission check above. */
export async function studentOfCredit(
  organizationId: string,
  creditId: string,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ student_id: string }>(
      'SELECT student_id FROM reposicao_credit WHERE id = $1 AND archived_at IS NULL',
      [creditId],
    );
    return rows[0]?.student_id ?? null;
  });
}

/**
 * The guests coming to one occurrence — criterion 8.
 *
 * Its own read, deliberately kept out of the enrolled roster. The ticket names
 * the likely mistake precisely: counting a reposição guest as an enrolled
 * student somewhere — the POOLSE-08 list, a seat count, an occupancy figure or a
 * communications audience. Two separate queries make that mistake require
 * effort, where one query with a flag would make it require care.
 */
export interface SessionGuest {
  bookingId: string;
  studentId: string;
  name: string;
  status: 'pending' | 'confirmed';
}

export async function guestsOf(
  organizationId: string,
  sessionId: string,
): Promise<SessionGuest[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      booking_id: string;
      student_id: string;
      name: string;
      status: 'pending' | 'confirmed';
    }>(
      `SELECT b.id AS booking_id,
              s.id AS student_id,
              short_name(s.first_name, s.last_name) AS name,
              b.status::text AS status
         FROM reposicao_booking b
         JOIN reposicao_credit c
           ON c.id = b.credit_id AND c.organization_id = b.organization_id
         JOIN student s
           ON s.id = c.student_id AND s.organization_id = c.organization_id
        WHERE b.class_session_id = $1
          AND b.status IN ('pending', 'confirmed')
          AND b.archived_at IS NULL
          AND s.archived_at IS NULL
        ORDER BY name_sort_key(s.first_name, s.last_name) COLLATE pt_pt`,
      [sessionId],
    );

    return rows.map((row) => ({
      bookingId: row.booking_id,
      studentId: row.student_id,
      name: row.name,
      status: row.status,
    }));
  });
}

/**
 * Releases holds nobody answered — the companion to the expiry job.
 *
 * Takes the instant rather than reading a clock, for the same reason the expiry
 * job takes a date: a scheduled task should be testable and re-runnable at a
 * moment the caller chooses. Idempotent.
 */
export async function releaseExpiredHolds(organizationId: string, now: string): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ released: number }>(
      'SELECT release_expired_reposicao_holds($1, $2::timestamptz) AS released',
      [organizationId, now],
    );
    return rows[0]?.released ?? 0;
  });
}

/** The student a booking is for, so cancelling can be checked the same way. */
export async function studentOfBooking(
  organizationId: string,
  bookingId: string,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ student_id: string }>(
      `SELECT c.student_id
         FROM reposicao_booking b
         JOIN reposicao_credit c
           ON c.id = b.credit_id AND c.organization_id = b.organization_id
        WHERE b.id = $1 AND b.archived_at IS NULL`,
      [bookingId],
    );
    return rows[0]?.student_id ?? null;
  });
}

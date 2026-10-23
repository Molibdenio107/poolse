import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { setStudentLevelIn } from './students.repository.js';
import { nameOrder, shortName } from '../people/names.js';
import { windowed, TOTAL_COUNT, type PageQuery, type Paginated } from '../common/pagination.js';

/**
 * Automatic level advancement — POOLSE-19.
 *
 * The generation half lives in the database: a trigger on `skill_progress`
 * proposes when a level completes and invalidates when a skill is corrected back
 * down. This is the half staff touch — reading the queue, and confirming a
 * proposal into a turma.
 *
 * **Nothing here decides who advances.** Criterion 7 says advancement is never
 * automatic without a human confirmation, and the shape enforces it: the trigger
 * can only ever create a *proposal*, and only `confirmProposal` writes an
 * enrolment.
 */

/** One turma a proposal could move a student into. */
export interface TransferCandidate {
  classGroupId: string;
  className: string;
  levelName: string | null;
  freeSeats: number | null;
  /** Why it ranks where it does — 'same_slot' | 'same_instructor' | 'available'. */
  rankReason: string;
  /**
   * What the turma picker shows on every row (POOLSE-113): its live weekly
   * slots, its instructor's short name, and how full it is. Read beside the
   * ranking rather than inside `transfer_candidates()`, which stays exactly as
   * `advancement.sql` pins it.
   */
  slots: { weekday: number; startTime: string }[];
  instructorName: string | null;
  capacity: number | null;
  active: number;
}

export interface TransferProposal {
  id: string;
  studentId: string;
  studentName: string;
  fromLevelName: string;
  toLevelName: string;
  generatedAt: string;
  /** Why — POOLSE-112. `skills` is POOLSE-19's trigger; `age` the season change. */
  reason: 'skills' | 'age';
  /** The season an age proposal was judged on. Null for a skill proposal. */
  seasonName: string | null;
  /**
   * When the club's automatic mode already moved the level — POOLSE-112 BA 2.
   * The card then asks only for the turma. Null when nothing moved yet.
   */
  appliedAt: string | null;
  /**
   * The ranked turmas, computed now rather than when the proposal was made.
   *
   * A stored ranking is wrong by the time anybody opens the queue, because seats
   * fill. Empty means "ready to advance — no seat" (criterion 6), which is a
   * demand signal rather than a to-do: it clears itself the moment a seat exists.
   */
  candidates: TransferCandidate[];
}

/**
 * The queue — criterion 4, paginated per POOLSE-29.
 *
 * Oldest first: a child who finished their level three weeks ago has been
 * waiting longer than one who finished this morning, and a queue that surfaced
 * the newest first would quietly starve them.
 */
export async function listProposals(
  organizationId: string,
  page: PageQuery,
): Promise<Paginated<TransferProposal>> {
  return withOrg(organizationId, async (tx) => {
    const run = (limit: number, offset: number) =>
      tx.query<{
        total_count: number;
        id: string;
        student_id: string;
        student_name: string;
        from_level_name: string;
        to_level_name: string;
        generated_at: Date;
        reason: 'skills' | 'age';
        season_name: string | null;
        applied_at: Date | null;
        candidates: TransferCandidate[];
      }>(
        `SELECT ${TOTAL_COUNT},
                p.id,
                p.student_id,
                ${shortName('s')} AS student_name,
                fl.name AS from_level_name,
                tl.name AS to_level_name,
                p.generated_at,
                p.reason::text AS reason,
                se.name AS season_name,
                p.applied_at,
                coalesce((
                  SELECT jsonb_agg(
                           jsonb_build_object(
                             'classGroupId', c.class_group_id,
                             'className',    c.class_name,
                             'levelName',    c.level_name,
                             'freeSeats',    c.free_seats,
                             'rankReason',   c.rank_reason,
                             'slots', coalesce((
                               SELECT jsonb_agg(jsonb_build_object('weekday', cs.weekday,
                                                                   'startTime', to_char(cs.start_time, 'HH24:MI'))
                                                ORDER BY cs.weekday, cs.start_time)
                                 FROM class_schedule cs
                                WHERE cs.organization_id = p.organization_id
                                  AND cs.class_group_id = c.class_group_id
                                  AND cs.archived_at IS NULL
                             ), '[]'::jsonb),
                             -- A staff member with no login is still named: their own record's name.
                             'instructorName', coalesce(short_name(iu.cached_first_name, iu.cached_last_name),
                                                        short_name(im.first_name, im.last_name)),
                             'capacity',     cg.capacity,
                             'active', (
                               SELECT count(*)::int FROM enrollment e
                                WHERE e.organization_id = p.organization_id
                                  AND e.class_group_id = c.class_group_id
                                  AND e.status = 'active'
                             )
                           ) ORDER BY c.rank_order
                         )
                    FROM transfer_candidates(p.id) c
                    JOIN class_group cg ON cg.id = c.class_group_id AND cg.organization_id = p.organization_id
                    LEFT JOIN membership im ON im.id = cg.instructor_membership_id AND im.organization_id = cg.organization_id
                    LEFT JOIN app_user iu ON iu.id = im.app_user_id
                ), '[]'::jsonb) AS candidates
           FROM transfer_proposal p
           JOIN student s        ON s.id = p.student_id AND s.organization_id = p.organization_id
           JOIN student_level fl ON fl.id = p.from_level_id AND fl.organization_id = p.organization_id
           JOIN student_level tl ON tl.id = p.to_level_id AND tl.organization_id = p.organization_id
           LEFT JOIN season se   ON se.id = p.season_id AND se.organization_id = p.organization_id
          WHERE p.status = 'pending'
            AND p.archived_at IS NULL
            AND s.archived_at IS NULL
          ORDER BY p.generated_at, ${nameOrder('s')}
          LIMIT $1 OFFSET $2`,
        [limit, offset],
      );

    return windowed(page, run, (row) => ({
      id: row.id,
      studentId: row.student_id,
      studentName: row.student_name,
      fromLevelName: row.from_level_name,
      toLevelName: row.to_level_name,
      generatedAt: row.generated_at.toISOString(),
      reason: row.reason,
      seasonName: row.season_name,
      appliedAt: row.applied_at === null ? null : row.applied_at.toISOString(),
      candidates: row.candidates,
    }));
  });
}

export type ConfirmOutcome =
  | 'confirmed'
  | 'not_found'
  | 'not_pending'
  | 'no_such_turma'
  | 'no_seat'
  /** Already has a live enrolment — including a waiting one — in the target turma. */
  | 'already_in_turma'
  /** Nothing to leave at that level, or a date before the enrolment began. */
  | 'bad_effective_date';

/**
 * Performs the transfer — criterion 5.
 *
 * **The seat is re-checked inside the transaction, after a row lock on the
 * target turma.** The ticket calls two admins confirming into the last seat from
 * two stale queues "the realistic failure, not a theoretical one", and it is
 * right: the queue is exactly the kind of screen two people leave open. Without
 * the lock both would read one free seat and both would write.
 *
 * The old enrolment **ends** rather than being deleted, and attendance already
 * recorded stays where it was. Nothing is re-parented: "was Ana at that class in
 * March" is a question about the turma she was in in March, and moving the rows
 * would make it unanswerable.
 */
export interface Confirmed {
  outcome: ConfirmOutcome;
  /**
   * The family's notice, to email after the commit — POOLSE-112 BA 4. Null
   * when nothing was confirmed, or when the level had already moved under the
   * club's automatic mode and the family was told then.
   */
  noticeId: string | null;
}

export async function confirmProposal(
  organizationId: string,
  proposalId: string,
  classGroupId: string,
  effectiveOn: string,
  actorMembershipId: string,
): Promise<Confirmed> {
  return withOrg(organizationId, async (tx) => {
    const { rows: found } = await tx.query<{
      status: string;
      student_id: string;
      from_level_id: string;
      to_level_id: string;
      reason: 'skills' | 'age';
      applied_at: Date | null;
      student_level_id: string | null;
    }>(
      `SELECT p.status::text AS status, p.student_id, p.from_level_id, p.to_level_id,
              p.reason::text AS reason, p.applied_at,
              (SELECT s.level_id FROM student s
                WHERE s.id = p.student_id AND s.organization_id = p.organization_id) AS student_level_id
         FROM transfer_proposal p
        WHERE p.id = $1 AND p.archived_at IS NULL
          FOR UPDATE OF p`,
      [proposalId],
    );

    const proposal = found[0];
    if (!proposal) return { outcome: 'not_found', noticeId: null };
    if (proposal.status !== 'pending') return { outcome: 'not_pending', noticeId: null };

    /*
     * Lock the turma, then count. The order matters: counting first and locking
     * afterwards is the same race with extra steps.
     */
    const { rows: turmas } = await tx.query<{ id: string; level_id: string | null }>(
      `SELECT id, level_id FROM class_group
        WHERE id = $1 AND archived_at IS NULL
          FOR UPDATE`,
      [classGroupId],
    );

    const turma = turmas[0];
    // Also the answer for a turma at the wrong level: the proposal is to advance,
    // and a confirmation into some other level is not that.
    if (!turma || turma.level_id !== proposal.to_level_id) {
      return { outcome: 'no_such_turma', noticeId: null };
    }

    const { rows: seats } = await tx.query<{ free: number | null }>(
      'SELECT class_group_free_seats($1) AS free',
      [classGroupId],
    );
    // Null capacity is an unlimited turma, which always has room.
    const free = seats[0]?.free;
    if (free !== null && free !== undefined && free <= 0) return { outcome: 'no_seat', noticeId: null };

    /*
     * **Only the enrolments at the level being left.**
     *
     * This ended every active enrolment the student had until a review caught
     * it. A student in two turmas — which the schema allows and `enrollment_live_uq`
     * is written for, being per-turma — would have been quietly removed from
     * both by advancing out of one. Nothing would have looked wrong; they would
     * simply have stopped appearing on a register.
     */
    const ended = await tx.query(
      `UPDATE enrollment e
          SET status = 'ended', ended_on = $3::date
         FROM class_group cg
        WHERE cg.id = e.class_group_id
          AND cg.organization_id = e.organization_id
          AND e.student_id = $1
          AND e.organization_id = $2
          AND e.status = 'active'
          AND cg.level_id = $4
          -- A backdated effective date must not end an enrolment before it
          -- began: the schema refuses it, and a 500 is a worse answer than a
          -- message. Left alone here and reported below.
          AND e.joined_on <= $3::date`,
      [proposal.student_id, organizationId, effectiveOn, proposal.from_level_id],
    );

    if ((ended.rowCount ?? 0) === 0) {
      /*
       * Nothing to end. Either the student is not enrolled at the level they are
       * leaving, or the date predates the enrolment. Both are the caller's
       * mistake rather than a server fault, and both are better said than
       * guessed at.
       */
      return { outcome: 'bad_effective_date', noticeId: null };
    }

    /*
     * `enrollment_live_uq` is partial on `status <> 'ended'`, so a *waiting* row
     * on the target turma survives the update above and collides here. That is a
     * real case — a family already asked for this turma — and a 23505 surfacing
     * as a 500 would be the least helpful possible way to say so.
     */
    try {
      await tx.query(
        `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
         VALUES ($1, $2, $3, 'active', $4::date)`,
        [organizationId, classGroupId, proposal.student_id, effectiveOn],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return { outcome: 'already_in_turma', noticeId: null };
      }
      throw error;
    }

    // The student's own level moves with them, so every screen that filters by
    // level — including POOLSE-21's redemption filter — follows from here.
    // Through the level's own write path, so the student's history records the
    // move with the level it came from — POOLSE-80. Unless the club's automatic
    // mode already moved it on the season's first day (POOLSE-112), in which
    // case this confirmation is the turma alone and the family was told then.
    // Decided by where the student *is*, not by `applied_at` alone (sweep
    // 23-10-2026): an automatic move reverted through Atividade leaves
    // `applied_at` set with the child back at the old level, and confirming must
    // then move them again rather than put them in a turma above their level.
    let noticeId: string | null = null;
    if (proposal.student_level_id !== proposal.to_level_id) {
      const moved = await setStudentLevelIn(tx, proposal.student_id, proposal.to_level_id, {
        reason: proposal.reason,
        proposalId,
      });
      if (moved !== 'updated') throw new Error(`Advancement could not move the student: ${moved}`);
      noticeId = await writeLevelChangeNotice(tx, organizationId, proposalId);
    }

    await tx.query(
      `UPDATE transfer_proposal
          SET status = 'confirmed',
              confirmed_by_membership_id = $2,
              confirmed_at = now(),
              to_class_group_id = $3,
              effective_on = $4::date
        WHERE id = $1`,
      [proposalId, actorMembershipId, classGroupId, effectiveOn],
    );

    await recordAudit(tx, {
      action: 'advancement.confirmed',
      entityType: 'transfer_proposal',
      entityId: proposalId,
      data: { studentId: proposal.student_id, classGroupId, effectiveOn, reason: proposal.reason },
    });

    return { outcome: 'confirmed', noticeId };
  });
}

/**
 * The family's record of a level change — POOLSE-112 BA 4. Written inside the
 * transaction that moved the level, with the addresses and the level names
 * snapshotted; the email leaves after the commit (`deliverLevelChangeNotice`).
 * Null when nobody has an address: a row that can never be delivered would sit
 * in the retry for ever.
 */
async function writeLevelChangeNotice(
  tx: Tx,
  organizationId: string,
  proposalId: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO level_change_notice
       (organization_id, student_id, proposal_id, from_level_name, to_level_name, reason, recipients)
     SELECT p.organization_id, p.student_id, p.id, fl.name, tl.name, p.reason,
            level_change_recipients(p.organization_id, p.student_id)
       FROM transfer_proposal p
       JOIN student_level fl ON fl.id = p.from_level_id AND fl.organization_id = p.organization_id
       JOIN student_level tl ON tl.id = p.to_level_id AND tl.organization_id = p.organization_id
      WHERE p.id = $1 AND p.organization_id = $2
        AND cardinality(level_change_recipients(p.organization_id, p.student_id)) > 0
     RETURNING id`,
    [proposalId, organizationId],
  );
  return rows[0]?.id ?? null;
}

/**
 * Takes a proposal out of the queue without moving anybody.
 *
 * Distinct from `invalidated`, which the database sets when a skill is corrected
 * back down. This one is a human saying "not yet" — and it stays a row, so the
 * next time the same student completes the same level nothing silently
 * re-proposes on top of a decision somebody already made.
 */
export async function dismissProposal(
  organizationId: string,
  proposalId: string,
  actorMembershipId: string,
): Promise<'dismissed' | 'not_found' | 'not_pending'> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ status: string }>(
      `SELECT status::text AS status FROM transfer_proposal
        WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
      [proposalId],
    );

    const proposal = rows[0];
    if (!proposal) return 'not_found';
    if (proposal.status !== 'pending') return 'not_pending';

    await tx.query(
      `UPDATE transfer_proposal SET status = 'dismissed' WHERE id = $1`,
      [proposalId],
    );

    await recordAudit(tx, {
      action: 'advancement.dismissed',
      entityType: 'transfer_proposal',
      entityId: proposalId,
      data: { by: actorMembershipId },
    });

    return 'dismissed';
  });
}

/**
 * Ready to advance, with nowhere to go — criterion 6.
 *
 * The same pending proposals, filtered to those with no candidate turma. **A
 * demand signal rather than a to-do list**: nobody clears these by hand, and the
 * flag disappears the moment a seat exists, because the candidate list is
 * computed on read. What it is *for* is scheduling next season — three children
 * waiting for Iniciação is an argument for another Iniciação turma.
 */
export async function readyNoSeat(
  organizationId: string,
  page: PageQuery,
): Promise<Paginated<TransferProposal>> {
  const all = await listProposals(organizationId, { ...page, limit: 500, offset: 0 });
  const stuck = all.items.filter((proposal) => proposal.candidates.length === 0);

  /*
   * Filtered after the window rather than inside it, which POOLSE-29 forbids for
   * a good reason — and this is the exception that proves it, stated rather than
   * hidden. "Has no candidates" is a property of a function call per row, not a
   * column, so it cannot be a WHERE clause without evaluating the ranking for
   * every proposal in the tenant anyway.
   *
   * Bounded at 500 pending proposals, which is far beyond what a club generates
   * in a season. If one ever exceeds it, this needs a materialised flag rather
   * than a bigger number — noted here so the next reader does not just raise it.
   */
  return {
    items: stuck.slice(page.offset, page.offset + page.limit),
    total: stuck.length,
    page: page.page,
    limit: page.limit,
  };
}

// ---------------------------------------------------------------------------
// Advancement by age — POOLSE-112
//
// The second reason a child advances: the season turns and they have outgrown
// their level's age band. Generation is `propose_age_advancements()` in SQL,
// run when a season is published and from the queue's *Propor* button; what is
// here is the outlook the queue shows, the club's mode, and the nightly pass
// that applies proposals when the club asked for that.
// ---------------------------------------------------------------------------

export type AdvancementMode = 'propose' | 'apply';

export interface LevelStanding {
  levelId: string;
  levelName: string;
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  /** Older than the band today. */
  aboveNow: number;
  /** Of those, how many have a level above that fits — the ones *Propor* queues. */
  movableNow: number;
  /** Younger than the band today — flagged, never proposed down (BA 5). */
  belowNow: number;
  /** Older than the band on the next season's first day, with a level that fits. */
  movableNext: number;
}

export interface AdvancementOutlook {
  mode: AdvancementMode;
  /** The season the club is running, which *Propor* judges against. Null with none. */
  currentSeason: { id: string; name: string; startsOn: string } | null;
  /**
   * The next season change: the earliest season starting after today, draft or
   * published. Null when the club has not planned one yet.
   */
  nextSeason: { id: string; name: string; startsOn: string; status: string } | null;
  /** Students who will move at that change, under the current setting. */
  willMove: number;
  levels: LevelStanding[];
}

/**
 * What the queue shows even when it is empty — BA rule 3. Every count is
 * derived now, in SQL, by `age_band_standing()`; nothing here is stored, so a
 * corrected birth date or a re-banded level is reflected on the next read.
 */
export async function advancementOutlook(organizationId: string): Promise<AdvancementOutlook> {
  return withOrg(organizationId, async (tx) => {
    const { rows: org } = await tx.query<{ mode: AdvancementMode }>(
      `SELECT advancement_mode::text AS mode FROM organization WHERE id = $1`,
      [organizationId],
    );

    const { rows: seasons } = await tx.query<{
      id: string;
      name: string;
      starts_on: string;
      status: string;
      which: 'current' | 'next';
    }>(
      `(SELECT id, name, starts_on::text AS starts_on, status::text AS status, 'current' AS which
          FROM season WHERE status = 'published' AND archived_at IS NULL LIMIT 1)
       UNION ALL
       (SELECT id, name, starts_on::text, status::text, 'next'
          FROM season
         WHERE archived_at IS NULL AND status <> 'archived' AND starts_on > club_today()
         ORDER BY starts_on LIMIT 1)`,
    );
    const current = seasons.find((row) => row.which === 'current') ?? null;
    const next = seasons.find((row) => row.which === 'next') ?? null;

    const { rows: levels } = await tx.query<{
      level_id: string;
      level_name: string;
      min_age_months: number | null;
      max_age_months: number | null;
      above_now: string;
      movable_now: string;
      below_now: string;
      movable_next: string;
    }>(
      `WITH today AS (SELECT * FROM age_band_standing($1, club_today())),
            next_day AS (SELECT * FROM age_band_standing($1, $2::date))
       SELECT l.id AS level_id, l.name AS level_name, l.min_age_months, l.max_age_months,
              (SELECT count(*) FROM today t WHERE t.level_id = l.id AND t.standing = 'above') AS above_now,
              (SELECT count(*) FROM today t WHERE t.level_id = l.id AND t.standing = 'above' AND t.fits IS NOT NULL) AS movable_now,
              (SELECT count(*) FROM today t WHERE t.level_id = l.id AND t.standing = 'below') AS below_now,
              (SELECT count(*) FROM next_day n WHERE n.level_id = l.id AND n.standing = 'above' AND n.fits IS NOT NULL) AS movable_next
         FROM student_level l
        WHERE l.organization_id = $1 AND l.archived_at IS NULL
        ORDER BY l.sort_order, l.name`,
      // With no next season the "next" column is judged on a null date — it
      // counts nobody — and `movableNext` is zeroed below anyway.
      [organizationId, next?.starts_on ?? null],
    );

    const standing: LevelStanding[] = levels.map((row) => ({
      levelId: row.level_id,
      levelName: row.level_name,
      minAgeMonths: row.min_age_months,
      maxAgeMonths: row.max_age_months,
      aboveNow: Number(row.above_now),
      movableNow: Number(row.movable_now),
      belowNow: Number(row.below_now),
      movableNext: next === null ? 0 : Number(row.movable_next),
    }));

    return {
      mode: org[0]?.mode ?? 'propose',
      currentSeason: current === null ? null : { id: current.id, name: current.name, startsOn: current.starts_on },
      nextSeason:
        next === null
          ? null
          : { id: next.id, name: next.name, startsOn: next.starts_on, status: next.status },
      willMove: standing.reduce((sum, level) => sum + level.movableNext, 0),
      levels: standing,
    };
  });
}

/**
 * The queue's *Propor* button — BA rule 3. Judged on the season the club is
 * running, today being inside it; `propose_age_advancements()` is idempotent,
 * so pressing it twice queues nothing new. Null when the club has no published
 * season to judge against.
 */
export async function proposeByAgeNow(
  organizationId: string,
  levelId: string | null,
): Promise<number | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: season } = await tx.query<{ id: string }>(
      `SELECT id FROM season WHERE status = 'published' AND archived_at IS NULL LIMIT 1`,
    );
    const seasonId = season[0]?.id;
    if (seasonId === undefined) return null;

    // Judged on today — the day the outlook counts and offers the button on
    // (sweep 23-10-2026); the publish judges on the season's first day.
    const { rows } = await tx.query<{ queued: number }>(
      'SELECT propose_age_advancements($1, $2, $3, club_today()) AS queued',
      [organizationId, seasonId, levelId],
    );
    const queued = rows[0]?.queued ?? 0;

    if (queued > 0) {
      await recordAudit(tx, {
        action: 'advancement.proposed_by_age',
        entityType: 'season',
        entityId: seasonId,
        data: { queued, levelId },
      });
    }
    return queued;
  });
}

/**
 * Queues this season's age proposals — called by the publish, inside its
 * transaction. Returns how many it queued so the audit entry can say.
 */
export async function proposeForSeasonIn(
  tx: Tx,
  organizationId: string,
  seasonId: string,
): Promise<number> {
  const { rows } = await tx.query<{ queued: number }>(
    'SELECT propose_age_advancements($1, $2) AS queued',
    [organizationId, seasonId],
  );
  return rows[0]?.queued ?? 0;
}

/** The club's choice — BA rule 2. Owner and admin; audited, because it changes what a machine does. */
export async function setAdvancementMode(
  organizationId: string,
  mode: AdvancementMode,
): Promise<AdvancementMode> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ before: AdvancementMode }>(
      `SELECT advancement_mode::text AS before FROM organization WHERE id = $1 FOR UPDATE`,
      [organizationId],
    );
    const before = rows[0]?.before ?? 'propose';
    if (before === mode) return before;

    await tx.query(`UPDATE organization SET advancement_mode = $2 WHERE id = $1`, [
      organizationId,
      mode,
    ]);
    await recordAudit(tx, {
      action: 'advancement.mode_changed',
      entityType: 'organization',
      entityId: organizationId,
      data: { before, after: mode },
    });
    return mode;
  });
}

export interface AppliedProposal {
  proposalId: string;
  noticeId: string | null;
}

/**
 * The automatic half of BA rule 2 — run nightly by `AdvancementApplyService`
 * for a club whose mode is `apply`, inside a system tenant context (no
 * membership, so the audit entry's actor is null: *sistema*).
 *
 * An age proposal whose season has begun has its level moved through
 * `setStudentLevelIn`, the same write path a person's confirmation takes, so
 * the student's history records it and `POST /activity/:id/revert` undoes it.
 * The proposal stays pending with `applied_at` set — the turma is still a
 * person's to pick — and the family is told now rather than at the turma.
 */
export async function applyDueAgeProposals(organizationId: string): Promise<AppliedProposal[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows: lock } = await tx.query<{ got: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtextextended('advancement_apply:' || $1, 0)) AS got`,
      [organizationId],
    );
    if (!lock[0]?.got) return [];

    const { rows: org } = await tx.query<{ mode: AdvancementMode }>(
      `SELECT advancement_mode::text AS mode FROM organization WHERE id = $1`,
      [organizationId],
    );
    if (org[0]?.mode !== 'apply') return [];

    const { rows: due } = await tx.query<{
      id: string;
      student_id: string;
      from_level_id: string;
      to_level_id: string;
      level_id: string | null;
    }>(
      `SELECT p.id, p.student_id, p.from_level_id, p.to_level_id, s.level_id
         FROM transfer_proposal p
         JOIN season se ON se.id = p.season_id AND se.organization_id = p.organization_id
         JOIN student s ON s.id = p.student_id AND s.organization_id = p.organization_id
        WHERE p.reason = 'age'
          AND p.status = 'pending'
          AND p.applied_at IS NULL
          AND p.archived_at IS NULL
          AND s.archived_at IS NULL
          AND se.archived_at IS NULL
          AND se.starts_on <= club_today()
        ORDER BY p.generated_at
        FOR UPDATE OF p`,
    );

    const applied: AppliedProposal[] = [];
    for (const proposal of due) {
      /*
       * Where the child is now decides it (sweep 23-10-2026). Moved by a person
       * since the proposal was made: already at the target, the level is done
       * and only the turma is left, with no second email; anywhere else, the
       * proposal no longer describes the child and leaves the queue, rather
       * than moving them from a level they are not in and telling the family so.
       */
      if (proposal.level_id === proposal.to_level_id) {
        await tx.query(`UPDATE transfer_proposal SET applied_at = now() WHERE id = $1`, [proposal.id]);
        continue;
      }
      if (proposal.level_id !== proposal.from_level_id) {
        await tx.query(`UPDATE transfer_proposal SET status = 'invalidated' WHERE id = $1`, [proposal.id]);
        await recordAudit(tx, {
          action: 'advancement.invalidated',
          entityType: 'transfer_proposal',
          entityId: proposal.id,
          data: { studentId: proposal.student_id, reason: 'level_changed' },
        });
        continue;
      }
      const moved = await setStudentLevelIn(tx, proposal.student_id, proposal.to_level_id, {
        reason: 'age',
        proposalId: proposal.id,
        automatic: true,
      });
      // A level archived since, or a student gone: the proposal is left for a
      // person rather than failing the whole pass over one row.
      if (moved !== 'updated') continue;

      await tx.query(`UPDATE transfer_proposal SET applied_at = now() WHERE id = $1`, [
        proposal.id,
      ]);
      const noticeId = await writeLevelChangeNotice(tx, organizationId, proposal.id);
      await recordAudit(tx, {
        action: 'advancement.applied',
        entityType: 'transfer_proposal',
        entityId: proposal.id,
        data: { studentId: proposal.student_id, toLevelId: proposal.to_level_id },
      });
      applied.push({ proposalId: proposal.id, noticeId });
    }
    return applied;
  });
}

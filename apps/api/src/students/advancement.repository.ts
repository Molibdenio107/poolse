import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
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
}

export interface TransferProposal {
  id: string;
  studentId: string;
  studentName: string;
  fromLevelName: string;
  toLevelName: string;
  generatedAt: string;
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
        candidates: TransferCandidate[];
      }>(
        `SELECT ${TOTAL_COUNT},
                p.id,
                p.student_id,
                ${shortName('s')} AS student_name,
                fl.name AS from_level_name,
                tl.name AS to_level_name,
                p.generated_at,
                coalesce((
                  SELECT jsonb_agg(
                           jsonb_build_object(
                             'classGroupId', c.class_group_id,
                             'className',    c.class_name,
                             'levelName',    c.level_name,
                             'freeSeats',    c.free_seats,
                             'rankReason',   c.rank_reason
                           ) ORDER BY c.rank_order
                         )
                    FROM transfer_candidates(p.id) c
                ), '[]'::jsonb) AS candidates
           FROM transfer_proposal p
           JOIN student s        ON s.id = p.student_id AND s.organization_id = p.organization_id
           JOIN student_level fl ON fl.id = p.from_level_id AND fl.organization_id = p.organization_id
           JOIN student_level tl ON tl.id = p.to_level_id AND tl.organization_id = p.organization_id
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
export async function confirmProposal(
  organizationId: string,
  proposalId: string,
  classGroupId: string,
  effectiveOn: string,
  actorMembershipId: string,
): Promise<ConfirmOutcome> {
  return withOrg(organizationId, async (tx) => {
    const { rows: found } = await tx.query<{
      status: string;
      student_id: string;
      from_level_id: string;
      to_level_id: string;
    }>(
      `SELECT status::text AS status, student_id, from_level_id, to_level_id
         FROM transfer_proposal
        WHERE id = $1 AND archived_at IS NULL
          FOR UPDATE`,
      [proposalId],
    );

    const proposal = found[0];
    if (!proposal) return 'not_found';
    if (proposal.status !== 'pending') return 'not_pending';

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
    if (!turma || turma.level_id !== proposal.to_level_id) return 'no_such_turma';

    const { rows: seats } = await tx.query<{ free: number | null }>(
      'SELECT class_group_free_seats($1) AS free',
      [classGroupId],
    );
    // Null capacity is an unlimited turma, which always has room.
    const free = seats[0]?.free;
    if (free !== null && free !== undefined && free <= 0) return 'no_seat';

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
      return 'bad_effective_date';
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
      if ((error as { code?: string }).code === '23505') return 'already_in_turma';
      throw error;
    }

    // The student's own level moves with them, so every screen that filters by
    // level — including POOLSE-21's redemption filter — follows from here.
    await tx.query('UPDATE student SET level_id = $2 WHERE id = $1', [
      proposal.student_id,
      proposal.to_level_id,
    ]);

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
      data: { studentId: proposal.student_id, classGroupId, effectiveOn },
    });

    return 'confirmed';
  });
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

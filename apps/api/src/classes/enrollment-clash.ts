import { ConflictException } from '@nestjs/common';
import { withOrg, type Tx } from '@poolse/db';

/**
 * A student in two turmas at the same hour — POOLSE-144.
 *
 * The rule is the database's (`enrollment_clashes()`, the `enrollment_time_clash`
 * trigger); this module only reads its refusal. The trigger raises
 * `check_violation` with `enrollment_clash|<other turma>|<weekday>|<HH:MM>` in
 * DETAIL, the `pool_capacity` shape, so the sentence quotes what the trigger
 * found and nothing is re-derived here — except the other turma's *name*, which
 * is looked up by the id the trigger named, because a name in DETAIL would be a
 * second copy of something a club can rename.
 */
export class EnrollmentClashError extends Error {
  constructor(
    readonly otherClassGroupId: string,
    readonly weekday: number,
    readonly startTime: string,
  ) {
    super('enrollment_clash');
  }
}

/** The refusal, if this error is the clash trigger's; null for anything else. */
export function clashFrom(error: unknown): EnrollmentClashError | null {
  if (error instanceof EnrollmentClashError) return error;
  const pg = error as { code?: string; detail?: unknown };
  if (pg.code !== '23514' || typeof pg.detail !== 'string' || !pg.detail.startsWith('enrollment_clash|')) {
    return null;
  }
  const [, groupId, weekday, startTime] = pg.detail.split('|');
  const day = Number(weekday);
  if (groupId === undefined || startTime === undefined || !Number.isInteger(day)) return null;
  return new EnrollmentClashError(groupId, day, startTime);
}

/** What the screen needs to say it: the other turma by name, its day and hour. */
export interface ClashDetail {
  classGroupId: string;
  turma: string;
  weekday: number;
  startTime: string;
}

/** Inside a transaction somebody else holds — the bin's restore, under its savepoint. */
export async function describeClashIn(tx: Tx, clash: EnrollmentClashError): Promise<ClashDetail> {
  const { rows } = await tx.query<{ name: string }>('SELECT name FROM class_group WHERE id = $1', [
    clash.otherClassGroupId,
  ]);
  return {
    classGroupId: clash.otherClassGroupId,
    turma: rows[0]?.name ?? '',
    weekday: clash.weekday,
    startTime: clash.startTime,
  };
}

/** After the refused transaction has rolled back, in a fresh one. */
export async function describeClash(organizationId: string, clash: EnrollmentClashError): Promise<ClashDetail> {
  return withOrg(organizationId, (tx) => describeClashIn(tx, clash));
}

/**
 * The 409 every enrolment path answers with — the same code, the same sentence
 * (`enrollment.clash`), landing under whichever field chose the turma.
 */
export async function clashConflict(
  organizationId: string,
  clash: EnrollmentClashError,
  field: string,
): Promise<ConflictException> {
  const detail = await describeClash(organizationId, clash);
  return new ConflictException({
    code: 'enrollment_clash',
    message: `The student already has a lesson at that time, in ${detail.classGroupId}`,
    fields: { [field]: 'enrollment.clash' },
    enrollmentClash: detail,
  });
}

import type { ActivityValue } from './api';

/**
 * How one value in a record's *Atividade* reads — POOLSE-80.
 *
 * One function for the list and for the conflict dialog, so the three values a
 * conflict shows are worded exactly as the entry above them. Kept free of Next
 * so a test can pass a fake `t`.
 *
 * An id arrives with its name (`label`). A row since deleted has none, and says
 * so rather than showing the id.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

const ID_FIELDS = new Set(['levelId', 'poolId', 'instructorMembershipId', 'feeCategoryId']);

export function formatActivityValue(t: Translate, field: string, value: ActivityValue): string {
  const raw = value.value;
  if (raw === null || raw === undefined || raw === '') {
    return field === 'status' ? t('activity.value.unmarked') : t('activity.value.empty');
  }
  if (ID_FIELDS.has(field)) return value.label ?? t('activity.value.gone');
  if (field === 'status') return t(`attendance.${String(raw)}`);
  if (field === 'colour') return t(`classes.colours.${String(raw)}`);
  if (field === 'lane') return t('activity.value.lane', { lane: Number(raw) });
  return String(raw);
}

/**
 * The actions with a sentence of their own (`activity.action.<action>`); any
 * other reads as "Outra alteração". Every action written against a student or
 * a turma belongs here — `activity.test.ts` checks each has a sentence in both
 * catalogues. Reads (`*.read`) never reach the list.
 */
export const LABELLED_ACTIONS: ReadonlySet<string> = new Set([
  'student.created',
  'student.updated',
  'student.filled',
  'student.archived',
  'student.restored',
  'student.socio_changed',
  'student.emergency_contact_set',
  'student.favourite_stroke_set',
  'class_group.created',
  'class_group.updated',
  'class_group.archived',
  'class_group.restored',
  'student_record.created',
  'student_record.archived',
  'student_sensitive.updated',
  'student_sensitive.cleared',
  'consent.recorded',
  'consent.withdrawn',
  'enrollment.created',
  'enrollment.ended',
  'enrollment.fee_category_set',
  'reposicao.capped',
  'retention.health_erased',
  'retention.anonymised',
  'guardian.migrated',
  'class_schedule.added',
  'class_schedule.moved',
  'class_schedule.removed',
  'class_session.removed_future',
  // POOLSE-112: a level moved by the queue — a person's confirmation, or the
  // season's first day under the club's automatic mode.
  'advancement.confirmed',
  'advancement.applied',
  'advancement.invalidated',
]);

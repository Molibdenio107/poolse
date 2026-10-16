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

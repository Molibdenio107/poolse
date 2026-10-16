'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, apiPost, type ActivityPage, type ActivityValue } from '@/lib/api';
import { formatActivityValue } from '@/lib/activity';
import { describeFailure } from '@/lib/form-failure';
import { outcome, type Outcome } from '@/lib/load-failure';
import type { FormState } from './actions';

/**
 * *Atividade* and *Reverter* — POOLSE-80.
 *
 * One load for both record pages and one revert for every entry. The API
 * decides what a revert writes and refuses; this only turns its answer into a
 * sentence, or into the conflict the dialog asks about.
 */

export async function loadActivity(
  kind: 'student' | 'class_group',
  id: string,
  page: number,
): Promise<Outcome<ActivityPage>> {
  const base = kind === 'student' ? 'students' : 'class-groups';
  const query = page > 1 ? `?page=${page}` : '';
  return outcome(apiFetch<ActivityPage>(`/${base}/${encodeURIComponent(id)}/activity${query}`));
}

/** One field the change and the record now disagree about, already in words. */
export interface ConflictChoice {
  field: string;
  fieldLabel: string;
  before: string;
  after: string;
  current: string;
}

export interface RevertState extends FormState {
  /** Set when the field moved again since: the dialog asks, per field. */
  conflicts?: ConflictChoice[];
}

/**
 * Reverts one entry. The dialog posts its answers as `resolve.<field>` =
 * `before` | `current`; the first press posts none, and a conflict comes back.
 */
export async function revertAction(
  entryId: string,
  _previous: RevertState,
  formData: FormData,
): Promise<RevertState> {
  const t = await getTranslations();
  const resolve: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith('resolve.') && typeof value === 'string') {
      resolve[name.slice('resolve.'.length)] = value;
    }
  }

  try {
    await apiPost(`/activity/${encodeURIComponent(entryId)}/revert`, { resolve });
    revalidatePath('/dashboard', 'layout');
    return { ok: true, toastKey: 'activity.revertedToast' };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const body = (error.details ?? {}) as Record<string, unknown>;
      const say = (key: string, values?: Record<string, string | number>) =>
        t(key as never, values as never);

      switch (error.code) {
        case 'revert_conflict': {
          const conflicts = (body['conflicts'] ?? []) as {
            field: string;
            before: ActivityValue;
            after: ActivityValue;
            current: ActivityValue;
          }[];
          return {
            ok: false,
            conflicts: conflicts.map((conflict) => ({
              field: conflict.field,
              fieldLabel: say(`activity.field.${conflict.field}`),
              before: formatActivityValue(say, conflict.field, conflict.before),
              after: formatActivityValue(say, conflict.field, conflict.after),
              current: formatActivityValue(say, conflict.field, conflict.current),
            })),
          };
        }
        case 'revert_nothing':
          return { ok: false, errorKey: 'activity.refusal.nothing' };
        case 'revert_not_revertible':
          return { ok: false, errorKey: 'activity.refusal.notRevertible' };
        case 'revert_target_gone':
          return {
            ok: false,
            errorKey: 'activity.refusal.targetGone',
            values: {
              field: say(`activity.field.${String(body['field'] ?? '')}`),
              name: typeof body['label'] === 'string' ? body['label'] : say('activity.value.gone'),
            },
          };
        case 'register_credited':
          return { ok: false, errorKey: 'attendance.refused.credited' };
        default:
          break;
      }
    }

    // The entity's own refusals — a full tank, an occupied lane — arrive as the
    // turma form would have them. With no form box to sit beside, the first one
    // is the sentence.
    const failed = describeFailure(error, 'activity.revertFailed');
    const { fields, ...rest } = failed;
    const first = fields === undefined ? undefined : Object.values(fields)[0];
    return first === undefined || failed.errorKey !== undefined
      ? failed
      : { ...rest, errorKey: first };
  }
}

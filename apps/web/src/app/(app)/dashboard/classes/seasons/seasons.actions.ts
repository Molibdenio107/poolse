'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '../../../../../lib/api';
import type { FormState } from '../../actions';

/**
 * Resetting the season — POOLSE-07.
 *
 * The only action on this page, and the one that needs the most care: it is not
 * reversible from the interface. The typed confirmation is checked here and
 * again in the API, because a form is a courtesy and the server is the rule.
 */
export async function resetSeasonAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const text = (field: string): string => String(formData.get(field) ?? '').trim();

  // Checked before the request rather than after, so a mistyped confirmation
  // costs a message instead of a round trip. The API refuses it too.
  if (text('confirm').toUpperCase() !== 'RESET') {
    return { ok: false, fields: { confirm: 'seasons.confirmMismatch' } };
  }

  const name = text('name');
  if (name === '') return { ok: false, fields: { name: 'seasons.nameRequired' } };

  const startsOn = text('startsOn');
  const endsOn = text('endsOn');
  if (startsOn === '' || endsOn === '') {
    return { ok: false, fields: { startsOn: 'seasons.datesRequired' } };
  }
  if (endsOn < startsOn) {
    return { ok: false, fields: { endsOn: 'seasons.endsBeforeStarts' } };
  }

  try {
    await apiPost('/seasons/reset', { confirm: 'RESET', name, startsOn, endsOn }, { organizationId });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      return { ok: false, errorKey: 'seasons.resetFailed' };
    }
    return {
      ok: false,
      errorKey: 'seasons.resetFailed',
      detail: error instanceof ApiError ? `${error.status} ${error.message}`.trim() : String(error),
    };
  }

  // Everything that lists turmas is now looking at a different season.
  revalidatePath('/dashboard/classes');
  revalidatePath('/dashboard/calendar');
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/classes/seasons');

  return { ok: true };
}

'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPatch } from '../../../../../lib/api';
import type { FormState } from '../../actions';

/**
 * The club's reposição rules — POOLSE-21.
 *
 * **Nothing here touches a credit that already exists.** The window and the cap
 * are snapshotted onto each credit when it is minted, so shortening the window
 * in March cannot shorten a credit issued in February. A family told "you have
 * until 11 May" has been told something, and a settings change is not permission
 * to un-tell them. The form says so, because a setting whose blast radius is
 * unclear is a setting nobody dares touch.
 */
export async function saveReposicaoSettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');

  const windowDays = Number(String(formData.get('windowDays') ?? '').trim());
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) {
    return { ok: false, fields: { windowDays: 'reposicao.windowInvalid' } };
  }

  /*
   * An empty cap means "no cap", not zero — the same trap as any optional
   * number in a form. Sending 0 would set a cap nobody could ever satisfy, and
   * it would look like the feature had silently stopped working.
   */
  const rawCap = String(formData.get('capPerSeason') ?? '').trim();
  const capPerSeason = rawCap === '' ? null : Number(rawCap);
  if (capPerSeason !== null && (!Number.isInteger(capPerSeason) || capPerSeason < 1)) {
    return { ok: false, fields: { capPerSeason: 'reposicao.capInvalid' } };
  }

  const mode = String(formData.get('mode') ?? 'request');

  try {
    await apiPatch(
      '/settings/reposicao',
      {
        // An unchecked checkbox sends nothing at all, which is what makes this
        // a presence test rather than a value test.
        enabled: formData.get('enabled') !== null,
        windowDays,
        capPerSeason,
        backfillOnly: formData.get('backfillOnly') !== null,
        mode: mode === 'self_service' ? 'self_service' : 'request',
      },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'reposicao.notPermitted' };
    }
    return { ok: false, errorKey: 'reposicao.saveFailed' };
  }

  revalidatePath('/dashboard/classes/reposicoes');
  return { ok: true };
}

'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '../../../../../lib/api';

/**
 * Confirming and dismissing a level advancement — POOLSE-19.
 *
 * Both are staff actions and the API says so; these only shape the answer. The
 * 409 is the one worth distinguishing: two admins working the same queue is the
 * realistic case, and "that turma is full" is a different sentence from "that
 * did not work".
 */
export async function confirmAdvancementAction(
  organizationId: string,
  proposalId: string,
  classGroupId: string,
  effectiveOn: string,
): Promise<{ ok: boolean; errorKey?: string }> {
  try {
    await apiPost(
      `/transfer-proposals/${proposalId}/confirm`,
      { classGroupId, effectiveOn },
      { organizationId },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, errorKey: 'advancement.seatGone' };
    }
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'advancement.notPermitted' };
    }
    return { ok: false, errorKey: 'advancement.confirmFailed' };
  }

  revalidatePath('/dashboard/students/advancement');
  return { ok: true };
}

export async function dismissAdvancementAction(
  organizationId: string,
  proposalId: string,
): Promise<{ ok: boolean }> {
  try {
    await apiPost(`/transfer-proposals/${proposalId}/dismiss`, {}, { organizationId });
  } catch {
    // A dismissal that failed leaves the row there, which is the truth — and is
    // also a button that did nothing, unless the card says so.
    return { ok: false };
  }
  revalidatePath('/dashboard/students/advancement');
  return { ok: true };
}

/**
 * *Propor* — queue age proposals now, for one level or all — POOLSE-112 BA 3.
 * Owner and admin; the API refuses the rest. Says how many it queued, because
 * "nothing new" and "it did not work" are different sentences.
 */
export async function proposeByAgeAction(
  organizationId: string,
  levelId: string | null,
): Promise<{ ok: boolean; queued?: number; errorKey?: string }> {
  try {
    const { queued } = await apiPost<{ queued: number }>(
      '/transfer-proposals/propose-by-age',
      levelId === null ? {} : { levelId },
      { organizationId },
    );
    revalidatePath('/dashboard/students/advancement');
    return { ok: true, queued };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'advancement.notPermitted' };
    }
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, errorKey: 'advancement.noSeason' };
    }
    return { ok: false, errorKey: 'common.notSaved' };
  }
}

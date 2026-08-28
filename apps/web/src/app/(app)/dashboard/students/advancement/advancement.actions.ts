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
): Promise<void> {
  try {
    await apiPost(`/transfer-proposals/${proposalId}/dismiss`, {}, { organizationId });
  } catch {
    // The queue re-reads either way; a dismissal that failed leaves the row
    // there, which is the truth.
  }
  revalidatePath('/dashboard/students/advancement');
}

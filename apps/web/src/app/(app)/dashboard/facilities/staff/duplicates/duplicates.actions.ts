'use server';

import { revalidatePath } from 'next/cache';
import { apiPost } from '../../../../../../lib/api';
import type { FormState } from '../../../actions';

/**
 * Phase 2 of the merge — POOLSE-17 AC10.
 *
 * One pair at a time, from the report. The ticket asks for the report to be
 * reviewed before anything is merged, and a "merge everything" button would make
 * that review a formality rather than a decision.
 */
export async function mergeAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const keepId = String(formData.get('keepId') ?? '');
  const absorbId = String(formData.get('absorbId') ?? '');

  try {
    await apiPost('/people/merge', { keepId, absorbId }, { organizationId });
  } catch {
    return { ok: false, errorKey: 'people.mergeFailed' };
  }

  // A merge repoints half the graph; anything showing a person is now stale.
  revalidatePath('/dashboard/facilities/staff/duplicates');
  revalidatePath('/dashboard/facilities/staff');
  revalidatePath('/dashboard/students/guardians');
  revalidatePath('/dashboard/classes');

  return { ok: true };
}

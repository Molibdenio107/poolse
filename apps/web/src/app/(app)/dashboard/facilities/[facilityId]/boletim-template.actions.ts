'use server';

import { revalidatePath } from 'next/cache';
import type { BoletimPlacement } from '@poolse/rules';
import { apiDelete, apiFetch, apiPut } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import { outcome, type Outcome } from '@/lib/load-failure';
import type { FormState } from '../../actions';

/** The club's own boletim de sócio — POOLSE-142. */
export interface BoletimTemplate {
  id: string;
  fileId: string;
  fields: BoletimPlacement[];
}

export async function readBoletimTemplate(): Promise<Outcome<{ template: BoletimTemplate | null }>> {
  return outcome(apiFetch<{ template: BoletimTemplate | null }>('/settings/boletim-template'));
}

/**
 * The placements, saved as a set. They travel as one JSON field because the
 * editor holds them as a list, not as form boxes; the API judges every one.
 */
export async function saveBoletimFieldsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  let fields: unknown;
  try {
    fields = JSON.parse(String(formData.get('fields') ?? '[]'));
  } catch {
    return { ok: false, errorKey: 'boletimTemplate.saveFailed' };
  }
  try {
    await apiPut('/settings/boletim-template/fields', { fields });
  } catch (error) {
    return describeFailure(error, 'boletimTemplate.saveFailed');
  }
  // Every site's *Dados do clube* shows the club's one template.
  revalidatePath('/dashboard/facilities', 'layout');
  return { ok: true };
}

/** Takes the template away: the print goes back to Poolse's own boletim. */
export async function removeBoletimTemplateAction(_previous: FormState): Promise<FormState> {
  try {
    await apiDelete('/settings/boletim-template');
  } catch (error) {
    return describeFailure(error, 'boletimTemplate.saveFailed');
  }
  revalidatePath('/dashboard/facilities', 'layout');
  return { ok: true, toastKey: 'boletimTemplate.removed' };
}

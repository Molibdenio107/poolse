'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '@/lib/api';
import type { FormState } from '../../dashboard/actions';

/**
 * The maintenance home's one-tap actions — POOLSE-90 slice 3. Each calls the
 * endpoint the backoffice already uses, so a cleaning logged here is the same
 * row the Espaços screen shows; nothing about the rule lives in app mode.
 */

const HOME = '/app/manutencao';

function failure(error: unknown, fallback: string): FormState {
  if (error instanceof ApiError && error.status === 400 && Object.keys(error.fields).length > 0) {
    return { ok: false, fields: error.fields };
  }
  if (error instanceof ApiError && error.status === 403) return { ok: false, errorKey: 'app.maintenance.notAllowed' };
  return { ok: false, errorKey: fallback };
}

/** *Limpo* — logs a cleaning on the Espaço. */
export async function cleanAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const spaceId = String(formData.get('id') ?? '');
  try {
    await apiPost(`/spaces/${spaceId}/cleanings`, {});
  } catch (error) {
    return failure(error, 'app.maintenance.failed');
  }
  // No revalidatePath: it would re-render the list without this row before the
  // button's state arrived, unmounting the button and its toast with it.
  // useSavedAction refreshes after raising the toast (sweep of slice 3).
  return { ok: true, toastKey: 'app.maintenance.cleaned' };
}

/** *Concluir* — records the task done now. */
export async function completeAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const taskId = String(formData.get('id') ?? '');
  try {
    await apiPost(`/maintenance/tasks/${taskId}/completions`, {});
  } catch (error) {
    return failure(error, 'app.maintenance.failed');
  }
  // As for Limpo: the row leaves on useSavedAction's refresh, after the toast.
  return { ok: true, toastKey: 'app.maintenance.completed' };
}

/** *Reportar* — an avaria or a reposição on an Espaço. */
export async function reportAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const spaceId = String(formData.get('spaceId') ?? '');
  if (spaceId === '') return { ok: false, fields: { spaceId: 'app.maintenance.spaceRequired' } };
  try {
    await apiPost(`/spaces/${spaceId}/issues`, {
      type: String(formData.get('type') ?? ''),
      severity: String(formData.get('severity') ?? 'normal'),
      description: String(formData.get('description') ?? ''),
    });
  } catch (error) {
    return failure(error, 'app.maintenance.failed');
  }
  revalidatePath(HOME);
  return { ok: true, toastKey: 'app.maintenance.reported', redirectTo: HOME };
}

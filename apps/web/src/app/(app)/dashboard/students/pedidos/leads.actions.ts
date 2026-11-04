'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, apiPost, apiPut, type RegistrationSettings, type TrialOption } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../actions';

const PAGE = '/dashboard/students/pedidos';

/**
 * The four answers to a pre-registration — POOLSE-69. Each is one API call;
 * the API writes the student, the guardian and the enrolment together, so a
 * refusal leaves nothing half-done for the next press to duplicate.
 *
 * **None of them revalidates** (POOLSE-165): the pedido leaves the list, and a
 * `revalidatePath` re-renders it in the same response — unmounting the button
 * before its toast is raised, which is why handling one said nothing.
 * `useSavedAction` raises the toast, then refreshes the page.
 */

async function place(kind: 'waitlist' | 'convert', formData: FormData): Promise<FormState> {
  const leadId = String(formData.get('leadId') ?? '');
  const classGroupId = String(formData.get('classGroupId') ?? '');
  if (classGroupId === '') return { ok: false, fields: { classGroupId: 'leads.pickRequired' } };
  let turma = '';
  try {
    const placed = await apiPost<{ classGroupName: string | null }>(`/leads/${leadId}/${kind}`, { classGroupId });
    turma = placed?.classGroupName ?? '';
  } catch (error) {
    return describeFailure(error, kind === 'waitlist' ? 'leads.waitlistFailed' : 'leads.convertFailed');
  }
  return {
    ok: true,
    toastKey: kind === 'waitlist' ? 'leads.waitlistedIn' : 'leads.convertedIn',
    values: { turma },
  };
}

export async function waitlistLeadAction(_p: FormState, formData: FormData): Promise<FormState> {
  return place('waitlist', formData);
}

export async function convertLeadAction(_p: FormState, formData: FormData): Promise<FormState> {
  return place('convert', formData);
}

export async function bookTrialAction(_p: FormState, formData: FormData): Promise<FormState> {
  const leadId = String(formData.get('leadId') ?? '');
  const sessionId = String(formData.get('sessionId') ?? '');
  if (sessionId === '') return { ok: false, fields: { sessionId: 'leads.pickRequired' } };
  try {
    await apiPost(`/leads/${leadId}/trial`, { sessionId });
  } catch (error) {
    return describeFailure(error, 'leads.trialFailed');
  }
  return { ok: true, toastKey: 'leads.trialBooked' };
}

export async function dismissLeadAction(_p: FormState, formData: FormData): Promise<FormState> {
  const leadId = String(formData.get('leadId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') return { ok: false, fields: { reason: 'leads.reasonRequired' } };
  try {
    await apiPost(`/leads/${leadId}/dismiss`, { reason });
  } catch (error) {
    return describeFailure(error, 'leads.dismissFailed');
  }
  return { ok: true, toastKey: 'leads.dismissed' };
}

/**
 * The next four weeks of a turma, for choosing a trial date. Null when it
 * could not be read, which the picker says in words rather than going grey.
 */
export async function trialOptionsAction(classGroupId: string): Promise<TrialOption[] | null> {
  try {
    const { options } = await apiFetch<{ options: TrialOption[] }>(
      `/leads/trial-options?classGroupId=${encodeURIComponent(classGroupId)}`,
    );
    return options;
  } catch {
    return null;
  }
}

export async function saveRegistrationSettingsAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  const slug = String(formData.get('slug') ?? '').trim().toLowerCase();
  try {
    await apiPut<RegistrationSettings>('/settings/registration', {
      slug,
      open: formData.get('open') === 'on',
    });
  } catch (error) {
    return describeFailure(error, 'leads.settings.saveFailed');
  }
  revalidatePath(PAGE);
  return { ok: true };
}

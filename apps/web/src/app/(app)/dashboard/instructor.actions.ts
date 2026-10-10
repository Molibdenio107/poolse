'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, apiPut } from '../../../lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { LessonPlan } from './calendar/lesson-plan.actions';
import type { FormState } from './actions';

/**
 * "Copiar da aula anterior", from the dashboard — POOLSE-66 slice 3.
 *
 * **The body is read here, never sent by the browser.** The card carries only
 * the session id: this re-reads the plan the calendar's sheet would read, and
 * copies the previous lesson's text only if nothing has been written for this
 * one since the page was drawn. A stale tab must not paste last week's drills
 * over a plan a colleague wrote a minute ago — the refusal says so instead.
 *
 * The write is the sheet's own `PUT /sessions/:id/plan`, so the row-level rule
 * (this class's instructor, a stand-in, an owner or an admin) is the API's and
 * a 403 arrives as the same sentence the sheet uses.
 */
export async function copyPreviousPlanAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const sessionId = String(formData.get('sessionId') ?? '');

  let plan: LessonPlan;
  try {
    plan = await apiFetch<LessonPlan>(`/sessions/${sessionId}/plan`);
  } catch (error) {
    return describeFailure(error, 'calendar.plan.loadFailed');
  }

  if (plan.body.trim() !== '') {
    return { ok: false, errorKey: 'dashboard.widget.plan.alreadyWritten' };
  }
  if (plan.previous === null) {
    return { ok: false, errorKey: 'dashboard.widget.plan.noPrevious' };
  }
  if (!plan.canEdit) {
    return { ok: false, errorKey: 'calendar.plan.notYours' };
  }

  try {
    await apiPut(`/sessions/${sessionId}/plan`, { body: plan.previous.body });
  } catch (error) {
    return describeFailure(error, 'calendar.plan.saveFailed');
  }

  revalidatePath('/dashboard');
  return { ok: true };
}

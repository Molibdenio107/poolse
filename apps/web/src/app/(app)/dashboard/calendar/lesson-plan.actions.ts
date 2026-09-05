'use server';

import { apiFetch, apiPut } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../actions';

/**
 * The plan for one lesson, read and written — round 6, ticket 4.3.
 *
 * Two actions rather than a form action pair, because the panel fetches when it
 * opens: a plan is not part of the calendar's own payload and loading eighty-four
 * of them to render a week would be paying for the one somebody clicks.
 */

export interface LessonPlan {
  sessionId: string;
  classGroupId: string;
  onDate: string;
  body: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** The API's own answer, so the screen and the guard cannot disagree. */
  canEdit: boolean;
  cancelled: boolean;
  /** The level's skills, in teaching order, for the suggestions strip. */
  skills: string[];
  previous: { onDate: string; body: string } | null;
}

export interface PlanState extends FormState {
  plan?: LessonPlan;
  /** Increments on every attempt, so a repeated failure re-announces itself. */
  attempt: number;
}

/** Opens the panel: what is written, who wrote it, and what to suggest. */
export async function readLessonPlanAction(previous: PlanState, formData: FormData): Promise<PlanState> {
  const attempt = previous.attempt + 1;
  const sessionId = String(formData.get('sessionId') ?? '');

  try {
    const plan = await apiFetch<LessonPlan>(`/sessions/${sessionId}/plan`);
    return { ok: true, plan, attempt };
  } catch (error) {
    return { ...describeFailure(error, 'calendar.plan.loadFailed'), attempt };
  }
}

/**
 * Saves it, or clears it when the box is empty.
 *
 * The refusal worth naming is the role one. "Only this class's instructor, an
 * owner or an admin" is a fact about a row rather than a role, so it arrives as
 * a 403 and is turned into a sentence here — a generic "could not save" would
 * leave somebody retrying a save that will never work.
 */
export async function saveLessonPlanAction(previous: PlanState, formData: FormData): Promise<PlanState> {
  const attempt = previous.attempt + 1;
  const sessionId = String(formData.get('sessionId') ?? '');
  const body = String(formData.get('body') ?? '');

  try {
    await apiPut(`/sessions/${sessionId}/plan`, { body });
  } catch (error) {
    // A 403 here is the row-level rule, not a role: "only this class's
    // instructor, an owner or an admin". Said in words, and without the API's
    // own message trailing it, because a generic failure leaves somebody
    // retrying a save that will never work.
    if (isForbidden(error)) {
      return { ok: false, errorKey: 'calendar.plan.notYours', attempt };
    }
    return { ...describeFailure(error, 'calendar.plan.saveFailed'), attempt };
  }

  /*
   * Re-read rather than patching the state locally.
   *
   * `updatedAt` and `updatedBy` are the server's, and "saved by Ana, a moment
   * ago" invented in the browser is a line that would be wrong the first time
   * two people had the panel open.
   */
  try {
    const plan = await apiFetch<LessonPlan>(`/sessions/${sessionId}/plan`);
    return { ok: true, plan, attempt };
  } catch {
    // The write landed; only the read back did not. Saying "could not save"
    // here would send somebody to save it again.
    return { ok: true, attempt };
  }
}

function isForbidden(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 403;
}

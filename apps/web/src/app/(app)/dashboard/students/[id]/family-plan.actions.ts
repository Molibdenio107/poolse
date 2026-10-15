'use server';

import { apiFetch } from '@/lib/api';
import type { LessonPlan } from '../../calendar/lesson-plan.actions';

/**
 * One lesson's plan, for the child's own family — 15 October 2026 (Rui).
 *
 * The API decides whether this family may read it (their child's own class, on
 * any day) and answers a 404 otherwise; here a refusal and a failure are both
 * "could not load", because a family has nothing to do differently about
 * either. An empty plan is `''`, said as "nothing written yet" on screen.
 */
export async function familyPlanAction(sessionId: string): Promise<string | null> {
  try {
    const plan = await apiFetch<LessonPlan>(`/sessions/${encodeURIComponent(sessionId)}/plan`);
    return plan.body;
  } catch {
    return null;
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPut } from '@/lib/api';
import type { FormState } from '../actions';
import { SETUP_STEPS, type SetupStep, type WizardState } from './steps';

const OUTCOMES = ['done', 'skipped', 'open'] as const;

/**
 * Moves the Owner's setup pointer — POOLSE-228. The API refuses anybody but the
 * Owner and moves only the session's own row; this only names the step and
 * where to go next. Nothing a step *holds* is saved here: each panel saves
 * through its own screen's action.
 */
export async function moveStepAction(_previous: FormState, form: FormData): Promise<FormState> {
  const step = String(form.get('step') ?? '');
  const outcome = String(form.get('outcome') ?? '');
  if (!(SETUP_STEPS as readonly string[]).includes(step) || !(OUTCOMES as readonly string[]).includes(outcome)) {
    return { ok: false, errorKey: 'setup.failed' };
  }

  let wizard: WizardState;
  try {
    ({ wizard } = await apiPut<{ wizard: WizardState }>('/onboarding/step', { step: step as SetupStep, outcome }));
  } catch (error) {
    // No setup to continue (finished elsewhere, or never started): Início.
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return { ok: true, quiet: true, redirectTo: '/dashboard/welcome' };
    }
    return { ok: false, errorKey: 'setup.failed' };
  }

  // The last step finishes it: *Tudo pronto* once, as creation used to land on.
  if (wizard.finished || wizard.step === null) {
    /*
     * Finishing brings the menus back, and they live in the layout, which a soft
     * navigation does not redraw: without this the sidebar stayed hidden until a
     * reload, and the guided tour found only the search and the bell (Rui,
     * 19-11-2026).
     */
    revalidatePath('/', 'layout');
    return { ok: true, quiet: true, redirectTo: '/dashboard/welcome?new=1' };
  }
  return { ok: true, quiet: true, redirectTo: `/dashboard/setup?step=${wizard.step}` };
}

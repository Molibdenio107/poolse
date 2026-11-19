/**
 * The Owner's setup steps, in order — POOLSE-228 (Rui, 19-11-2026). Spelled as
 * the API's `onboarding_step` enum; the words are `setup.step.<key>.*`.
 */
export const SETUP_STEPS = ['club', 'places', 'team', 'import'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** `GET /onboarding`'s answer; null is "no wizard here". */
export interface WizardState {
  step: SetupStep | null;
  skipped: SetupStep[];
  finished: boolean;
}

export function isSetupStep(value: string | undefined): value is SetupStep {
  return value !== undefined && (SETUP_STEPS as readonly string[]).includes(value);
}

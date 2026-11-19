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

/**
 * The wizard as the Owner sees it (Rui, 19-11-2026): *Os seus dados* first, then
 * the four setup steps — one wizard, where the details used to be a screen of
 * their own before it. `details` is the web's own step: the API's pointer starts
 * at `club`, and the details are saved through the profile, never the pointer.
 */
export const WIZARD_STEPS = ['details', ...SETUP_STEPS] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export function isWizardStep(value: string | undefined): value is WizardStep {
  return value !== undefined && (WIZARD_STEPS as readonly string[]).includes(value);
}

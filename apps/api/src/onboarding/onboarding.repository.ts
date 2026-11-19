import { withOrg } from '@poolse/db';

/**
 * Where one person is in their club's onboarding — POOLSE-228.
 *
 * The Owner's setup steps live here as a pointer and a list of skipped steps.
 * Nothing a step *saves* is kept here: each step writes through the screen's own
 * endpoint (`/organizations/tax`, `/facilities/:id/hours`, `/invitations`…), so
 * the wizard can never hold a second copy of a club's settings.
 */

export const ONBOARDING_STEPS = ['club', 'places', 'team', 'import'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface WizardState {
  /** The step to open; null once finished. */
  step: OnboardingStep | null;
  skipped: OnboardingStep[];
  finished: boolean;
}

interface Row {
  wizard_started_at: Date | null;
  wizard_step: OnboardingStep | null;
  wizard_skipped: OnboardingStep[];
  wizard_finished_at: Date | null;
}

const COLUMNS = 'wizard_started_at, wizard_step, wizard_skipped::text[] AS wizard_skipped, wizard_finished_at';

function toState(row: Row | undefined): WizardState | null {
  // No row, or a row nobody started the wizard on (the pilot): no wizard.
  if (row === undefined || row.wizard_started_at === null) return null;
  return {
    step: row.wizard_finished_at === null ? (row.wizard_step ?? 'club') : null,
    skipped: row.wizard_skipped,
    finished: row.wizard_finished_at !== null,
  };
}

/**
 * Called once, by `POST /organizations`, for the club it has just made. The only
 * writer of `wizard_started_at`: a club created before POOLSE-228 never has it.
 */
export async function startWizard(organizationId: string, membershipId: string): Promise<void> {
  await withOrg(organizationId, (tx) =>
    tx.query(
      `INSERT INTO onboarding_progress (organization_id, membership_id, wizard_started_at, wizard_step)
       VALUES ($1, $2, now(), 'club')
       ON CONFLICT (organization_id, membership_id) DO NOTHING`,
      [organizationId, membershipId],
    ),
  );
}

export async function readWizard(organizationId: string, membershipId: string): Promise<WizardState | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<Row>(
      `SELECT ${COLUMNS} FROM onboarding_progress WHERE organization_id = $1 AND membership_id = $2`,
      [organizationId, membershipId],
    );
    return toState(rows[0]);
  });
}

export type StepOutcome = 'done' | 'skipped' | 'open';

/**
 * Moves the reader's own pointer. `done` and `skipped` move on to the next step
 * (and finish after the last); `open` goes to the step named, for *Voltar* and
 * for *Continuar a configuração*. A step done after being skipped leaves the
 * skipped list. Null when the reader has no wizard (never started, or finished).
 */
export async function moveWizard(
  organizationId: string,
  membershipId: string,
  step: OnboardingStep,
  outcome: StepOutcome,
): Promise<WizardState | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<Row>(
      `SELECT ${COLUMNS} FROM onboarding_progress
        WHERE organization_id = $1 AND membership_id = $2
        FOR UPDATE`,
      [organizationId, membershipId],
    );
    const row = rows[0];
    if (row === undefined || row.wizard_started_at === null || row.wizard_finished_at !== null) return null;

    const index = ONBOARDING_STEPS.indexOf(step);
    const skipped = new Set(row.wizard_skipped);
    if (outcome === 'skipped') skipped.add(step);
    if (outcome === 'done') skipped.delete(step);

    const next = outcome === 'open' ? step : (ONBOARDING_STEPS[index + 1] ?? null);
    const { rows: saved } = await tx.query<Row>(
      `UPDATE onboarding_progress
          SET wizard_step = $3::onboarding_step,
              wizard_skipped = $4::onboarding_step[],
              wizard_finished_at = CASE WHEN $3::onboarding_step IS NULL THEN now() ELSE NULL END
        WHERE organization_id = $1 AND membership_id = $2
        RETURNING ${COLUMNS}`,
      [organizationId, membershipId, next, ONBOARDING_STEPS.filter((one) => skipped.has(one))],
    );
    return toState(saved[0]);
  });
}

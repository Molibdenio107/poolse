import { withOrg } from '@poolse/db';
import type { OnboardingStep } from './onboarding.repository.js';

/**
 * *Vamos começar* on Início — POOLSE-229 (Rui, 19-11-2026).
 *
 * **Every item ticks from the club's real data, never from a stored "done"**:
 * archive the only turma and its item opens again. The one exception is the
 * tour, which leaves nothing behind but the person's own record of having seen
 * it. All of it is one statement, whatever the size of the club.
 */

export const CHECKLIST_ITEMS = [
  'club_details',
  'places',
  'team',
  'students',
  'turmas',
  'prices',
  'public_form',
  'tour',
] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];

/** A skipped setup step brings its item; the rest are always on the list. */
const FROM_STEP: Partial<Record<ChecklistItem, OnboardingStep>> = {
  club_details: 'club',
  places: 'places',
  team: 'team',
  students: 'import',
};

export interface Checklist {
  items: { key: ChecklistItem; done: boolean }[];
  dismissed: boolean;
}

interface Row {
  club_details: boolean;
  places: boolean;
  team: boolean;
  students: boolean;
  turmas: boolean;
  prices: boolean;
  public_form: boolean;
  tour: boolean;
  skipped: OnboardingStep[] | null;
  dismissed: boolean;
}

export async function readChecklist(organizationId: string, membershipId: string): Promise<Checklist | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<Row>(
      `SELECT
         -- The club's NIPC and the morada of a live site (POOLSE-228 step 1).
         (o.vat_number IS NOT NULL AND EXISTS (
            SELECT 1 FROM facility f
             WHERE f.organization_id = o.id AND f.archived_at IS NULL AND f.address IS NOT NULL
         )) AS club_details,
         -- A live pool, and opening hours somebody changed from the seeded "open, all day".
         (EXISTS (SELECT 1 FROM pool p WHERE p.organization_id = o.id AND p.archived_at IS NULL)
          AND EXISTS (
            SELECT 1 FROM facility_hours h
              JOIN facility f ON f.organization_id = h.organization_id AND f.id = h.facility_id
             WHERE h.organization_id = o.id AND f.archived_at IS NULL
               AND NOT (h.available AND h.opens_at = '00:00' AND h.closes_at = '24:00')
         )) AS places,
         -- An invitation sent, whatever became of it, or a second working person.
         (EXISTS (SELECT 1 FROM invitation i WHERE i.organization_id = o.id)
          OR (SELECT count(DISTINCT r.membership_id) FROM membership_role r
                JOIN membership m ON m.organization_id = r.organization_id AND m.id = r.membership_id
               WHERE r.organization_id = o.id AND r.archived_at IS NULL AND m.archived_at IS NULL
                 AND r.role IN ('owner', 'admin', 'instructor', 'maintenance')) >= 2
         ) AS team,
         EXISTS (
           SELECT 1 FROM student s
            WHERE s.organization_id = o.id AND s.archived_at IS NULL AND s.anonymised_at IS NULL
         ) AS students,
         -- A live turma in the published shared season (sport seasons are POOLSE-126's debt).
         EXISTS (
           SELECT 1 FROM class_group g
             JOIN season se ON se.organization_id = g.organization_id AND se.id = g.season_id
            WHERE g.organization_id = o.id AND g.archived_at IS NULL
              AND se.archived_at IS NULL AND se.status = 'published' AND se.sport_id IS NULL
         ) AS turmas,
         EXISTS (SELECT 1 FROM fee_plan fp WHERE fp.organization_id = o.id AND fp.archived_at IS NULL) AS prices,
         o.public_registration_open AS public_form,
         coalesce(op.tour_finished_at IS NOT NULL OR op.tour_dismissed_at IS NOT NULL, false) AS tour,
         -- Only a wizard that was offered has skipped steps; an older club's row has none.
         CASE WHEN op.wizard_started_at IS NULL THEN NULL ELSE op.wizard_skipped::text[] END AS skipped,
         coalesce(op.checklist_dismissed_at IS NOT NULL, false) AS dismissed
       FROM organization o
       LEFT JOIN onboarding_progress op ON op.organization_id = o.id AND op.membership_id = $2
      WHERE o.id = $1 AND o.kind = 'business'`,
      [organizationId, membershipId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    const skipped = new Set(row.skipped ?? []);
    const items = CHECKLIST_ITEMS.filter((key) => {
      const step = FROM_STEP[key];
      return step === undefined || skipped.has(step);
    }).map((key) => ({ key, done: row[key] }));
    return { items, dismissed: row.dismissed };
  });
}

/** The Owner hides or shows the list again; the row is made if it is not there, wizard-less. */
export async function setChecklistDismissed(
  organizationId: string,
  membershipId: string,
  dismissed: boolean,
): Promise<void> {
  await withOrg(organizationId, (tx) =>
    tx.query(
      `INSERT INTO onboarding_progress (organization_id, membership_id, checklist_dismissed_at)
       VALUES ($1, $2, CASE WHEN $3 THEN now() END)
       ON CONFLICT (organization_id, membership_id)
       DO UPDATE SET checklist_dismissed_at = CASE WHEN $3 THEN now() END`,
      [organizationId, membershipId, dismissed],
    ),
  );
}

export type TourOutcome = 'finished' | 'dismissed';

/**
 * The guided tour's outcome for the reader — POOLSE-230. The first of each is
 * kept, so a replay changes nothing; the row is made if it is not there, and
 * never with `wizard_started_at` (that stays the wizard's own switch).
 */
export async function recordTour(organizationId: string, membershipId: string, outcome: TourOutcome): Promise<void> {
  const column = outcome === 'finished' ? 'tour_finished_at' : 'tour_dismissed_at';
  await withOrg(organizationId, (tx) =>
    tx.query(
      `INSERT INTO onboarding_progress (organization_id, membership_id, ${column})
       VALUES ($1, $2, now())
       ON CONFLICT (organization_id, membership_id)
       DO UPDATE SET ${column} = coalesce(onboarding_progress.${column}, now())`,
      [organizationId, membershipId],
    ),
  );
}

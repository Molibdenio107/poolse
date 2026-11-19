-- Up Migration

-- ---------------------------------------------------------------------------
-- POOLSE-229 and POOLSE-230 — the checklist's dismissal and the tour's outcome
-- ---------------------------------------------------------------------------
--
-- Three columns on the person's own `onboarding_progress` row (POOLSE-228). One
-- migration for both tickets, which ship together: the checklist's *Fazer a
-- visita guiada* ticks from the tour's columns, the one stored exception to
-- "ticks from real data" (Rui, 19-11-2026).
--
-- A row made for these (by a dismissal or a tour) never sets
-- `wizard_started_at`, so it never opens the setup wizard: that column stays
-- the wizard's only switch.

ALTER TABLE onboarding_progress
  ADD COLUMN checklist_dismissed_at timestamptz,
  ADD COLUMN tour_finished_at timestamptz,
  ADD COLUMN tour_dismissed_at timestamptz;

COMMENT ON COLUMN onboarding_progress.checklist_dismissed_at IS
  'Vamos começar hidden by its Owner — POOLSE-229. Null shows it again.';
COMMENT ON COLUMN onboarding_progress.tour_finished_at IS
  'The guided tour played to Concluir — POOLSE-230. A replay changes neither tour column.';
COMMENT ON COLUMN onboarding_progress.tour_dismissed_at IS
  'The guided tour closed before its end — POOLSE-230.';

-- Down Migration

ALTER TABLE onboarding_progress
  DROP COLUMN IF EXISTS tour_dismissed_at,
  DROP COLUMN IF EXISTS tour_finished_at,
  DROP COLUMN IF EXISTS checklist_dismissed_at;

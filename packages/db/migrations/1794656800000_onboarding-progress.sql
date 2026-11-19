-- Up Migration

-- ---------------------------------------------------------------------------
-- POOLSE-228 — a new club's Owner is walked through setup, and can come back
-- ---------------------------------------------------------------------------
--
-- One row per person per club. This ticket uses it for the Owner's setup steps;
-- POOLSE-229 (the checklist's dismissal) and POOLSE-230 (the tour) add their own
-- columns to the same row rather than a table each.
--
-- **The wizard's only switch is `wizard_started_at`.** `POST /organizations`
-- writes it when it creates the club, so a club that existed before this
-- migration (the pilot) has no such row and never sees the wizard. A row created
-- later for any other reason leaves it null, and stays wizard-less.
--
-- No `archived_at`: the row is a pointer into a guide, not history anybody reads
-- back, so the unique key is a plain one. Not deleted by the app either.

CREATE TYPE onboarding_step AS ENUM ('club', 'places', 'team', 'import');

CREATE TABLE onboarding_progress (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization (id),
  membership_id       uuid NOT NULL,

  wizard_started_at   timestamptz,
  wizard_step         onboarding_step,
  wizard_skipped      onboarding_step[] NOT NULL DEFAULT '{}',
  wizard_finished_at  timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, membership_id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),

  -- A step to open only while the wizard is under way.
  CONSTRAINT onboarding_progress_step_ck
    CHECK (wizard_step IS NULL OR wizard_started_at IS NOT NULL),
  CONSTRAINT onboarding_progress_finished_ck
    CHECK (wizard_finished_at IS NULL OR wizard_started_at IS NOT NULL)
);

COMMENT ON TABLE onboarding_progress IS
  'Where one person is in their club''s onboarding — POOLSE-228. The Owner''s setup steps '
  '(offered only when wizard_started_at is set, at creation); POOLSE-229/230 add columns.';
COMMENT ON COLUMN onboarding_progress.wizard_skipped IS
  'Steps left with Configurar mais tarde. Read ::text[] (an enum array).';

CREATE TRIGGER onboarding_progress_updated_at BEFORE UPDATE ON onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY onboarding_progress_tenant ON onboarding_progress
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON onboarding_progress FROM poolse_app;
GRANT SELECT, INSERT, UPDATE ON onboarding_progress TO poolse_app;

-- Down Migration

DROP TABLE IF EXISTS onboarding_progress;
DROP TYPE IF EXISTS onboarding_step;

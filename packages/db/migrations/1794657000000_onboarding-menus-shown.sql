-- Up Migration

-- ---------------------------------------------------------------------------
-- POOLSE-228, second pass — the menus wait for the setup (Rui, 19-11-2026)
-- ---------------------------------------------------------------------------
--
-- While a new club's Owner has not finished the setup steps, the backoffice
-- hides its sidebar and section tabs so the setup is the one thing on screen.
-- *Ir para o painel* on Início brings them back, and that choice is the
-- Owner's account's, on every device: this column. Finishing the setup brings
-- them back too, without it.

ALTER TABLE onboarding_progress ADD COLUMN menus_shown_at timestamptz;

COMMENT ON COLUMN onboarding_progress.menus_shown_at IS
  'The Owner chose Ir para o painel before finishing the setup: the menus show again. POOLSE-228.';

-- Down Migration

ALTER TABLE onboarding_progress DROP COLUMN IF EXISTS menus_shown_at;

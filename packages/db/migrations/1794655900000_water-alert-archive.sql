-- Up Migration
--
-- A water alert can be archived, one or all of a tank's (Rui, 12-11-2026).
--
-- An alert is the record that somebody was told. Rui asked that Owner and
-- Admin may clear them from Alertas, so the row gets `archived_at` like every
-- other soft-deleted record: hidden from the tab, never emailed again, and
-- restorable from the Arquivo bin. Archiving an analysis archives its alert in
-- the same statement, so no alert points at a reading that is gone.
--
-- The one-alert-per-analysis index becomes partial (CLAUDE.md: every unique
-- constraint on a soft-deletable table is). The insert's `ON CONFLICT DO
-- NOTHING` names no target, so it keeps working against the partial index.

ALTER TABLE pool_analysis_alert ADD COLUMN archived_at timestamptz;

DROP INDEX pool_analysis_alert_analysis_uq;
CREATE UNIQUE INDEX pool_analysis_alert_analysis_uq
  ON pool_analysis_alert (organization_id, analysis_id)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN pool_analysis_alert.archived_at IS
  'Archived from Alertas, or with its analysis (12-11-2026). Restorable from the bin.';

-- Down Migration

DROP INDEX pool_analysis_alert_analysis_uq;
-- Archived duplicates would block the full index; they are the only rows that can collide.
DELETE FROM pool_analysis_alert a
 WHERE a.archived_at IS NOT NULL
   AND EXISTS (SELECT 1 FROM pool_analysis_alert b
                WHERE b.organization_id = a.organization_id
                  AND b.analysis_id = a.analysis_id
                  AND b.id <> a.id);
CREATE UNIQUE INDEX pool_analysis_alert_analysis_uq
  ON pool_analysis_alert (organization_id, analysis_id);
ALTER TABLE pool_analysis_alert DROP COLUMN archived_at;

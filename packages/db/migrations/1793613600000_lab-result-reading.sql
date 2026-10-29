-- Up Migration
--
-- A laboratory report's chemistry is also a reading (Rui, 29-10-2026). This
-- reverses POOLSE-101's "never filed a second time as a reading": a club whose
-- water was out of range, closed, treated and sent to the lab was left with a
-- warning only a typed reading could clear, because Última análise, Tendências,
-- Histórico and the warning read readings and nothing else.
--
-- So a lab result with chemistry writes a `pool_analysis` beside it, carrying
-- `lab_result_id`. One reading per lab result (partial unique). Where the club
-- already has a reading at that exact moment, that reading stands and none is
-- added — `pool_analysis_moment_uq` is the rule and the write skips, never fails.
--
-- **The two archive together**, by trigger, so the bin, the lab section's
-- archive button and any later path cannot leave a reading behind a report that
-- is gone. A restore brings the reading back unless a live one has since taken
-- its moment.

ALTER TABLE pool_analysis
  ADD COLUMN lab_result_id uuid,
  ADD CONSTRAINT pool_analysis_lab_result_fk FOREIGN KEY (organization_id, lab_result_id)
    REFERENCES lab_result (organization_id, id);

COMMENT ON COLUMN pool_analysis.lab_result_id IS
  'The laboratory report this reading was taken from (29-10-2026). Archived and restored with it, by trigger.';

CREATE UNIQUE INDEX pool_analysis_one_per_lab_result ON pool_analysis (organization_id, lab_result_id)
  WHERE lab_result_id IS NOT NULL AND archived_at IS NULL;

CREATE FUNCTION lab_result_archives_reading() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    UPDATE pool_analysis SET archived_at = NEW.archived_at
     WHERE organization_id = NEW.organization_id AND lab_result_id = NEW.id AND archived_at IS NULL;
  ELSIF NEW.archived_at IS NULL AND OLD.archived_at IS NOT NULL THEN
    UPDATE pool_analysis a SET archived_at = NULL
     WHERE a.organization_id = NEW.organization_id AND a.lab_result_id = NEW.id
       AND a.archived_at = OLD.archived_at
       AND NOT EXISTS (
         SELECT 1 FROM pool_analysis o
          WHERE o.organization_id = a.organization_id AND o.pool_id = a.pool_id
            AND o.taken_at = a.taken_at AND o.archived_at IS NULL
       );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lab_result_archives_reading AFTER UPDATE OF archived_at ON lab_result
  FOR EACH ROW EXECUTE FUNCTION lab_result_archives_reading();

-- Down Migration

DROP TRIGGER lab_result_archives_reading ON lab_result;
DROP FUNCTION lab_result_archives_reading();
DROP INDEX pool_analysis_one_per_lab_result;
ALTER TABLE pool_analysis DROP CONSTRAINT pool_analysis_lab_result_fk, DROP COLUMN lab_result_id;

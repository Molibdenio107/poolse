-- Up Migration
--
-- POOLSE-137 — each AI reader switched on per club, with a log of every call.
--
-- **Five readers, one enum.** `AI_READERS` in `@poolse/rules` spells the same
-- values, compared by test. A developer adds a reader; nobody else does.
--
-- **A club stores what is on** (`organization.ai_readers`), the way
-- `enabled_sports` does and the other way round from `disabled_modules`: a model
-- call is paid by Poolse, and a new club starts with none. Written only by
-- `poolse_platform`, through `changeTenant`; the app holds no UPDATE on either
-- new column (its UPDATE on `organization` is column by column since POOLSE-87).
--
-- **One optional monthly cap per club**, for all five readers together (Rui,
-- 31-10-2026). Null is no limit — a null ceiling enforces nothing — and 0 is
-- refused, because "no reads at all" is the ticks being off.
--
-- **`ai_read` replaces `energy_invoice_read`.** One row per call, claimed before
-- the call and finished after it, so the cap can be checked under a lock before
-- anything is spent and a call that crashed half-way still counts: it was
-- possibly paid for. The old table's rows come across as `energy_invoice` reads
-- with no model and no tokens, and the old table goes.
--
-- The club's login inserts and reads its own rows (the cap needs the count) and
-- may fill a row in exactly once — a trigger refuses touching one already
-- finished, so the record cannot be thinned after the fact. No DELETE. The
-- platform's login reads every club's and writes none.

CREATE TYPE ai_reader AS ENUM ('energy_invoice', 'id_document', 'water_report', 'pdf_table', 'column_match');

ALTER TABLE organization
  ADD COLUMN ai_readers ai_reader[] NOT NULL DEFAULT '{}',
  ADD COLUMN ai_monthly_cap integer,
  ADD CONSTRAINT organization_ai_monthly_cap_positive CHECK (ai_monthly_cap IS NULL OR ai_monthly_cap > 0);

COMMENT ON COLUMN organization.ai_readers IS
  'POOLSE-137: the AI readers switched on for this club. Empty by default. Written by poolse_platform through changeTenant only. A reader also needs its platform_switch on.';
COMMENT ON COLUMN organization.ai_monthly_cap IS
  'POOLSE-137: most AI reads per Lisbon calendar month, all readers together. Null = no limit; never 0.';

GRANT UPDATE (ai_readers, ai_monthly_cap) ON organization TO poolse_platform;

CREATE TABLE ai_read (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  reader          ai_reader NOT NULL,
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  -- Null until the call came back. A row never finished is a call that may
  -- have been paid for and returned nothing: it counts, and reads as failed
  -- once it is an hour old.
  finished_at     timestamptz,
  -- False when the call was made and nothing usable came back.
  succeeded       boolean,
  model           text,
  input_tokens    integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens   integer CHECK (output_tokens IS NULL OR output_tokens >= 0)
);

CREATE INDEX ai_read_org_month_idx ON ai_read (organization_id, claimed_at);
CREATE INDEX ai_read_month_idx ON ai_read (claimed_at);

INSERT INTO ai_read (organization_id, reader, claimed_at, finished_at, succeeded)
SELECT organization_id, 'energy_invoice', read_at, read_at, succeeded
  FROM energy_invoice_read;

DROP TABLE energy_invoice_read;

-- A row is filled in once. Nothing may change one already finished, nor move
-- the columns that say whose call it was and when it was claimed.
CREATE FUNCTION ai_read_finish_once() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'ai_read % is already finished', OLD.id
      USING ERRCODE = 'check_violation', DETAIL = 'ai_read_finished';
  END IF;
  IF NEW.finished_at IS NULL THEN
    RAISE EXCEPTION 'finishing ai_read % needs finished_at', OLD.id
      USING ERRCODE = 'check_violation', DETAIL = 'ai_read_unfinished';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_read_finish_once
  BEFORE UPDATE ON ai_read
  FOR EACH ROW EXECUTE FUNCTION ai_read_finish_once();

REVOKE ALL ON ai_read FROM poolse_app;
GRANT SELECT, INSERT ON ai_read TO poolse_app;
GRANT UPDATE (finished_at, succeeded, model, input_tokens, output_tokens) ON ai_read TO poolse_app;
GRANT SELECT ON ai_read TO poolse_platform;

ALTER TABLE ai_read ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_read_tenant ON ai_read
  FOR ALL TO poolse_app
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY ai_read_platform ON ai_read
  FOR SELECT TO poolse_platform USING (true);

COMMENT ON TABLE ai_read IS
  'POOLSE-137: one row per model call by an AI reader, claimed before and finished after. Counts against organization.ai_monthly_cap; /admin derives an estimated cost from the tokens. Never deleted.';

-- The four new platform switches, beside the ID photo's. Off.
ALTER TABLE platform_switch DROP CONSTRAINT platform_switch_name_check;
ALTER TABLE platform_switch ADD CONSTRAINT platform_switch_name_check
  CHECK (name IN ('id_document_ai', 'energy_invoice_ai', 'water_report_ai', 'pdf_table_ai', 'column_match_ai'));
INSERT INTO platform_switch (name) VALUES
  ('energy_invoice_ai'), ('water_report_ai'), ('pdf_table_ai'), ('column_match_ai');

-- Down Migration

DELETE FROM platform_switch WHERE name IN ('energy_invoice_ai', 'water_report_ai', 'pdf_table_ai', 'column_match_ai');
ALTER TABLE platform_switch DROP CONSTRAINT platform_switch_name_check;
ALTER TABLE platform_switch ADD CONSTRAINT platform_switch_name_check CHECK (name IN ('id_document_ai'));

CREATE TABLE energy_invoice_read (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  read_at         timestamptz NOT NULL DEFAULT now(),
  succeeded       boolean NOT NULL
);
CREATE INDEX energy_invoice_read_month_idx ON energy_invoice_read (read_at);
REVOKE ALL ON energy_invoice_read FROM poolse_app;
GRANT INSERT ON energy_invoice_read TO poolse_app;
ALTER TABLE energy_invoice_read ENABLE ROW LEVEL SECURITY;
CREATE POLICY energy_invoice_read_writer ON energy_invoice_read
  FOR INSERT TO poolse_app
  WITH CHECK (organization_id = current_organization_id());
CREATE POLICY energy_invoice_read_platform ON energy_invoice_read
  FOR SELECT TO poolse_platform USING (true);
GRANT SELECT ON energy_invoice_read TO poolse_platform;

INSERT INTO energy_invoice_read (organization_id, read_at, succeeded)
SELECT organization_id, claimed_at, coalesce(succeeded, false)
  FROM ai_read WHERE reader = 'energy_invoice';

DROP TABLE ai_read;
DROP FUNCTION ai_read_finish_once();

ALTER TABLE organization
  DROP CONSTRAINT organization_ai_monthly_cap_positive,
  DROP COLUMN ai_monthly_cap,
  DROP COLUMN ai_readers;
DROP TYPE ai_reader;

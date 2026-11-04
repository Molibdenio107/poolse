-- Up Migration

-- POOLSE-163 (Rui, 04-11-2026) — an occurrence the club invoiced elsewhere.
--
-- The second shape of POOLSE-162's need: a family pays at the desk, the desk's
-- own program issues the fatura, and Poolse must neither bill the occurrence
-- again nor show it owed. A row here says "this fee line's occurrence on this
-- day was invoiced outside Poolse, as document N".
--
-- **One definition, extended**: `invoice_charged_on()` now answers a live row
-- here as charged (after a live Poolse document, which always wins), so the
-- monthly run's preview leaves it out and the invoice-line trigger refuses to
-- bill it — never a second WHERE clause beside it. It answers the external
-- number prefixed `ext:`, which no document number can be, so the preview can
-- count the two kinds apart.
--
-- Insert-only bar archiving: a mistaken mark is archived (and so stops counting),
-- never edited. `poolse_app` may update `archived_at` alone.

CREATE TABLE student_fee_external_charge (
  id                        uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organization (id),
  student_fee_id            uuid NOT NULL,
  -- The occurrence's first day, as `invoice_line.period_start` and
  -- `student_fee_payment.period_start` name it; `starts_on` for a line charged once.
  occurrence_on             date NOT NULL,
  -- The external document's number.
  reference                 text NOT NULL,
  recorded_by_membership_id uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  archived_at               timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_fee_id) REFERENCES student_fee (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by_membership_id) REFERENCES membership (organization_id, id),

  CONSTRAINT student_fee_external_charge_reference CHECK (
    btrim(reference) <> '' AND length(reference) <= 60
  )
);

COMMENT ON TABLE student_fee_external_charge IS
  'POOLSE-163: an occurrence of a fee line invoiced outside Poolse, with that document''s number. '
  'Counted as charged by invoice_charged_on() and as settled by the fee read; archived to reverse.';

CREATE UNIQUE INDEX student_fee_external_charge_one_live
  ON student_fee_external_charge (organization_id, student_fee_id, occurrence_on)
  WHERE archived_at IS NULL;

CREATE TRIGGER student_fee_external_charge_updated_at BEFORE UPDATE ON student_fee_external_charge
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE student_fee_external_charge ENABLE ROW LEVEL SECURITY;
CREATE POLICY student_fee_external_charge_tenant ON student_fee_external_charge
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- A column grant needs the table-wide privilege revoked first (CLAUDE.md).
REVOKE ALL ON student_fee_external_charge FROM poolse_app;
GRANT SELECT, INSERT ON student_fee_external_charge TO poolse_app;
GRANT UPDATE (archived_at) ON student_fee_external_charge TO poolse_app;

-- Charged already, by a Poolse document or an earlier external mark: refused,
-- with the document in DETAIL as structure (the standing rule for refusals).
CREATE FUNCTION student_fee_external_charge_not_charged() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_charged text;
BEGIN
  v_charged := public.invoice_charged_on(NEW.organization_id, NEW.student_fee_id, NEW.occurrence_on);
  IF v_charged IS NOT NULL THEN
    RAISE EXCEPTION 'This occurrence is already charged on %', v_charged
      USING ERRCODE = 'unique_violation',
            DETAIL = 'external_charge_already_charged|' || v_charged;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER student_fee_external_charge_not_charged
  BEFORE INSERT ON student_fee_external_charge
  FOR EACH ROW EXECUTE FUNCTION student_fee_external_charge_not_charged();

-- The one definition of "already charged", extended (rule 2).
CREATE OR REPLACE FUNCTION invoice_charged_on(
  p_organization_id uuid,
  p_student_fee_id  uuid,
  p_period_start    date,
  p_except_line_id  uuid DEFAULT NULL
) RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    (SELECT i.document_no
       FROM invoice_line l
       JOIN invoice i ON i.id = l.invoice_id AND i.organization_id = l.organization_id
      WHERE l.organization_id = p_organization_id
        AND l.student_fee_id = p_student_fee_id
        AND l.period_start = p_period_start
        AND l.document_kind = 'invoice'
        AND (p_except_line_id IS NULL OR l.id <> p_except_line_id)
        -- Credited, and therefore no longer being asked for.
        AND NOT EXISTS (
          SELECT 1 FROM invoice c
           WHERE c.corrects_invoice_id = i.id
             AND c.organization_id = i.organization_id
             AND c.kind = 'credit_note'
        )
      ORDER BY i.issued_on, i.number
      LIMIT 1),
    -- Invoiced outside Poolse (POOLSE-163): its number, marked so.
    (SELECT 'ext:' || x.reference
       FROM student_fee_external_charge x
      WHERE x.organization_id = p_organization_id
        AND x.student_fee_id = p_student_fee_id
        AND x.occurrence_on = p_period_start
        AND x.archived_at IS NULL
      LIMIT 1)
  )
$$;
COMMENT ON FUNCTION invoice_charged_on(uuid, uuid, date, uuid) IS
  'The document an occurrence is already charged on, or null — a live Poolse document first, else '
  'a live external charge as ext:<number> (POOLSE-163). Read by the invoice-line refusal, the '
  'external-charge refusal and the monthly run alike.';

-- Down Migration

CREATE OR REPLACE FUNCTION invoice_charged_on(
  p_organization_id uuid,
  p_student_fee_id  uuid,
  p_period_start    date,
  p_except_line_id  uuid DEFAULT NULL
) RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT i.document_no
    FROM invoice_line l
    JOIN invoice i ON i.id = l.invoice_id AND i.organization_id = l.organization_id
   WHERE l.organization_id = p_organization_id
     AND l.student_fee_id = p_student_fee_id
     AND l.period_start = p_period_start
     AND l.document_kind = 'invoice'
     AND (p_except_line_id IS NULL OR l.id <> p_except_line_id)
     AND NOT EXISTS (
       SELECT 1 FROM invoice c
        WHERE c.corrects_invoice_id = i.id
          AND c.organization_id = i.organization_id
          AND c.kind = 'credit_note'
     )
   ORDER BY i.issued_on, i.number
   LIMIT 1
$$;

DROP TRIGGER IF EXISTS student_fee_external_charge_not_charged ON student_fee_external_charge;
DROP FUNCTION IF EXISTS student_fee_external_charge_not_charged();
DROP TABLE IF EXISTS student_fee_external_charge;

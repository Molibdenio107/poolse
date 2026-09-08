-- Up Migration
--
-- Settlement and chasing — phase 2.3.
--
-- 2.2 left a document that says what is owed and nothing that says whether it
-- was paid. This is the other half: money arriving against a document, what is
-- still outstanding, and a record of the club having asked for it.
--
-- **A payment is a child row, never a column on the document.** Said in 2.2's
-- migration and honoured here: `poolse_app` holds SELECT and INSERT on
-- `invoice` and nothing else, so a `settled_on` column could not have been
-- written even if somebody wanted one. It is also the honest shape — a family
-- paying half in October and half in November is two facts, and a single date
-- can hold neither of them.
--
-- **There is no status column, and there must not be one.** A document's state
-- is `total − paid`, `due_on` against today, and whether a credit note exists —
-- three facts that are already stored, and a fourth that restated them would
-- need a worker to keep it true. `invoice_status` is that derivation, written
-- once, in SQL. Same reasoning as the overdue-cleaning rule in
-- `spaces.repository.ts` and as the absence of `is_overdue` beside it.
--
-- **Chasing is a record of what a person did, not a message Poolse sent.** The
-- notification subsystem is phase 3.0 and does not exist. Rather than pretend,
-- `invoice_chase` records that somebody rang, wrote or spoke to a family on a
-- day — which is what makes a second chase a different conversation from the
-- first, and what an operator actually needs to know before picking up the
-- telephone.

-- ---------------------------------------------------------------------------
-- A due date may precede the day the document was issued
-- ---------------------------------------------------------------------------
--
-- 2.2 wrote `CHECK (due_on >= issued_on)` on the assumption that a document is
-- issued before it falls due. That is wrong for the ordinary case this slice
-- exists to serve: **a club billing in arrears**.
--
-- Bill October on the 2nd of December and the run dates the document today and
-- takes its due date from the facility's payment day *for the month being
-- billed* — the 8th of October, six weeks behind. The constraint refused it,
-- and refused it as a bare `23514` with no field named, so a club catching up
-- on its invoicing met a page that said nothing.
--
-- Found by the first integration test that tried to produce an overdue
-- document, which is the only way to produce one: an overdue document is a
-- document whose due date has passed.
--
-- Nothing replaces it. There is no ordering rule between these two dates that
-- is true of every real document, and a constraint that is right most of the
-- time is worse than none — it fails on the case somebody is actually in.

ALTER TABLE invoice DROP CONSTRAINT IF EXISTS invoice_dates_ordered;

COMMENT ON COLUMN invoice.due_on IS
  'When payment is due. May precede issued_on: a club billing October in '
  'December issues today a document that was due in October, and that is '
  'ordinary rather than a mistake.';

-- ---------------------------------------------------------------------------
-- invoice_payment — money against a document
-- ---------------------------------------------------------------------------
--
-- Partial payments are ordinary, so this is one row per arrival rather than a
-- flag. `payment_source` is reused rather than reinvented: it already means
-- "how did this money reach us", and a second enum saying the same thing in
-- different words is how two screens end up disagreeing about what `sepa` is.

CREATE TABLE invoice_payment (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  invoice_id      uuid NOT NULL,

  -- Always positive. A refund is not a negative payment — it is a credit note
  -- against the document, which 2.2 already has.
  amount_cents    integer NOT NULL,

  /*
   * The day the money arrived, as the office knows it.
   *
   * Not the moment the box was ticked: Friday's transfers get entered on
   * Monday, and the record should say Friday. The same distinction
   * `student_fee_payment.paid_on` already draws.
   */
  paid_on         date NOT NULL DEFAULT current_date,

  source          payment_source NOT NULL DEFAULT 'manual',

  -- The bank's reference, the MB WAY id, the number on the receipt book. Free
  -- text, because every club's is a different shape.
  reference       text,
  notes           text,

  recorded_by     uuid,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  /*
   * Soft-deleted, like every other piece of history here.
   *
   * A payment entered against the wrong document has to be removable, and a
   * hard DELETE would take the record of the mistake with it. Every sum below
   * filters on this.
   */
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoice (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by) REFERENCES membership (organization_id, id),

  CONSTRAINT invoice_payment_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT invoice_payment_reference_not_blank CHECK (
    reference IS NULL OR btrim(reference) <> ''
  )
);

COMMENT ON TABLE invoice_payment IS
  'Money arriving against a document. One row per arrival, because a family '
  'paying in two instalments is two facts. Never a column on the invoice — that '
  'table holds no UPDATE grant, deliberately.';

CREATE TRIGGER invoice_payment_updated_at BEFORE UPDATE ON invoice_payment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX invoice_payment_invoice_idx
  ON invoice_payment (organization_id, invoice_id, paid_on DESC)
  WHERE archived_at IS NULL;

ALTER TABLE invoice_payment ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_payment_tenant ON invoice_payment
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_payment TO poolse_app;

/*
 * A credit note is never paid.
 *
 * It is a document that *reduces* what a family owes; money arriving against it
 * is money entered against the wrong document, and the whole point of catching
 * it here rather than in a screen is that there are two ways in — the document
 * page and, in 2.4, whatever reconciles a bank feed.
 */
CREATE FUNCTION invoice_payment_not_on_a_credit_note() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_kind invoice_kind;
BEGIN
  SELECT kind INTO v_kind
    FROM invoice
   WHERE id = NEW.invoice_id AND organization_id = NEW.organization_id;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'No such document' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_kind <> 'invoice' THEN
    RAISE EXCEPTION 'A credit note cannot be paid'
      USING ERRCODE = 'check_violation',
            DETAIL = 'invoice_payment_on_credit_note';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_payment_document_kind BEFORE INSERT ON invoice_payment
  FOR EACH ROW EXECUTE FUNCTION invoice_payment_not_on_a_credit_note();

-- ---------------------------------------------------------------------------
-- invoice_chase — the club having asked
-- ---------------------------------------------------------------------------
--
-- **Not a message Poolse sent.** The notification subsystem is phase 3.0. Until
-- it exists, chasing is a person telephoning or writing, and what this records
-- is that they did — so the next person to look knows whether this family has
-- been asked once or three times, which is the difference between a reminder
-- and a conversation.
--
-- When 3.0 lands it writes rows here too, with a channel of its own. That is
-- why the channel is an enum on the row rather than an assumption in the table
-- name.

CREATE TYPE invoice_chase_channel AS ENUM
  ('email', 'phone', 'message', 'in_person', 'letter');

COMMENT ON TYPE invoice_chase_channel IS
  'How a family was asked. An enum because only a developer adds one, and each '
  'new channel arrives with code behind it rather than as a row somebody types.';

CREATE TABLE invoice_chase (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  invoice_id      uuid NOT NULL,

  chased_on       date NOT NULL DEFAULT current_date,
  channel         invoice_chase_channel NOT NULL,

  -- What was said, or what the family answered. The reason a second chase is
  -- worth recording at all.
  note            text,

  recorded_by     uuid,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoice (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by) REFERENCES membership (organization_id, id),

  CONSTRAINT invoice_chase_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);

COMMENT ON TABLE invoice_chase IS
  'One record of a family being asked to pay. A person''s action today; the '
  'notification subsystem writes here too when phase 3.0 lands.';

CREATE TRIGGER invoice_chase_updated_at BEFORE UPDATE ON invoice_chase
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX invoice_chase_invoice_idx
  ON invoice_chase (organization_id, invoice_id, chased_on DESC)
  WHERE archived_at IS NULL;

ALTER TABLE invoice_chase ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_chase_tenant ON invoice_chase
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_chase TO poolse_app;

-- ---------------------------------------------------------------------------
-- What state a document is in
-- ---------------------------------------------------------------------------
--
-- One definition, in SQL, shipped to the client as an answer. There is no
-- status column and there must not be one: every input here is already stored,
-- and a fifth fact restating the other four would need a worker to keep it true
-- — a per-tenant cost, for a number anybody can compute.
--
-- The precedence is the order an operator cares about, and it is the part worth
-- reading twice. A **credited** document is not owed by anybody, whatever was
-- paid against it. A **paid** one needs nothing. An **overdue** one is the
-- work; a partly paid overdue document is still overdue, because half of
-- nothing arriving on time is still late.
--
-- STABLE rather than IMMUTABLE: it reads `current_date`, and a cached answer
-- would still call a document overdue the morning after it was settled.

CREATE FUNCTION invoice_status(
  p_kind      invoice_kind,
  p_credited  boolean,
  p_total_cents integer,
  p_paid_cents  integer,
  p_due_on    date
) RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_kind = 'credit_note'        THEN 'credit_note'
    WHEN p_credited                    THEN 'credited'
    WHEN p_paid_cents >= p_total_cents THEN 'paid'
    WHEN p_due_on < current_date       THEN 'overdue'
    WHEN p_paid_cents > 0              THEN 'partly_paid'
    ELSE 'open'
  END;
$$;

COMMENT ON FUNCTION invoice_status(invoice_kind, boolean, integer, integer, date) IS
  'The one definition of what state a document is in. No status column exists, '
  'deliberately: every input is already stored and a stored answer would need a '
  'worker to keep it true.';

-- Down Migration
--
-- The payments and the chase history go with the tables. Nothing in 2.2 is
-- touched: `payment_source` predates both files and stays where it was.

/*
 * Put the ordering CHECK back, NOT VALID.
 *
 * Validated, it would refuse to be created at all against any club that has
 * billed in arrears since — which is the case this migration exists to allow.
 * NOT VALID restores the rule for new rows and leaves the history that made the
 * rule wrong where it is.
 */
ALTER TABLE invoice
  ADD CONSTRAINT invoice_dates_ordered CHECK (due_on >= issued_on) NOT VALID;

DROP FUNCTION IF EXISTS invoice_status(invoice_kind, boolean, integer, integer, date);

DROP TABLE IF EXISTS invoice_chase;
DROP TYPE IF EXISTS invoice_chase_channel;

DROP TRIGGER IF EXISTS invoice_payment_document_kind ON invoice_payment;
DROP TABLE IF EXISTS invoice_payment;
DROP FUNCTION IF EXISTS invoice_payment_not_on_a_credit_note();

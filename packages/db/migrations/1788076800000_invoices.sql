-- Up Migration
--
-- Invoicing — phase 2.2. The document the fee kinds and the VAT columns were
-- built to carry.
--
-- **These are internal records, shaped so certification is additive.** Poolse
-- does not issue a legal fatura: Decreto-Lei 28/2019 requires certified
-- software, a validation code obtained from the AT per series, an ATCUD and a
-- QR on every document and a SAF-T (PT) export, and that is a programme with an
-- external dependency rather than an evening. What a club gets here is a
-- priced, numbered, immutable record it can hand to whatever issues its
-- faturas. Two columns are reserved for the certification that may follow —
-- `invoice_series.at_validation_code` and `invoice.atcud` — and they are the
-- only speculative thing in this file.
--
-- The part that is not speculative is the shape, because it is the part that
-- cannot be retrofitted onto documents a club has already sent:
--
--   * a number is allocated by the database, inside the transaction that writes
--     the document, and never by application code that could retry;
--   * a document is written once — no UPDATE, no DELETE, and the grant says so
--     rather than a trigger, so there is no code path to forget;
--   * a correction is a credit note against the original, never an edit;
--   * `system_entry_at` records when the document entered the system, which is
--     a SAF-T field and is honest today.
--
-- **A series belongs to a facility.** Asked and answered: a club running two
-- pools numbers each site's documents in its own book. The licence bounds how
-- many sites a subscription has (`organization.max_facilities`, default 1), so
-- for almost every tenant this is one series that happens to hang off the one
-- facility — and the club that grows into two sites does not have to renumber,
-- which is the thing that is not recoverable later.
--
-- **A document is addressed to a payer, and siblings land on one of them.** The
-- payer is the guardian who is responsible for the student, or the student
-- themselves on the adult path. That is what makes a family with two children
-- receive one document rather than two, and it is what 2.3's débito direto will
-- collect against.

-- ---------------------------------------------------------------------------
-- The two document types
-- ---------------------------------------------------------------------------
--
-- An enum rather than a table, by the standing rule: only a developer adds a
-- document type, and each one that arrives (a recibo, a fatura-recibo) brings
-- its own rules with it rather than being a row an operator writes.

CREATE TYPE invoice_kind AS ENUM ('invoice', 'credit_note');

-- ---------------------------------------------------------------------------
-- invoice_series — the book a document is numbered in
-- ---------------------------------------------------------------------------
--
-- One per facility per document type, seeded when the facility is created so
-- that no screen can leave a site unable to issue anything.
--
-- `next_number` is the sequence, and it is deliberately a column rather than a
-- Postgres sequence: a sequence is *not* transactional — a rolled-back insert
-- consumes its number and leaves a gap, which is the one thing a numbering
-- series may not do. The UPDATE that reads and bumps this column takes a row
-- lock, so it rolls back with its transaction and, as a side effect worth
-- knowing about, serialises every insert into one series. That lock is what the
-- double-billing check below rests on.

CREATE TABLE invoice_series (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organization (id),
  facility_id        uuid NOT NULL,

  kind               invoice_kind NOT NULL,
  name               text NOT NULL,

  -- What a document number is built from: `FT A/17`, `NC A/3`. Constrained to
  -- the shape the AT accepts, so a series that is later registered does not
  -- have to be renamed after documents were issued under it.
  prefix             text NOT NULL,

  next_number        integer NOT NULL DEFAULT 1,
  is_default         boolean NOT NULL DEFAULT false,

  /*
   * Reserved for certification, and null until it arrives.
   *
   * The AT issues a validation code per series, and the ATCUD on each document
   * is that code plus the document's own number. Both halves are recorded
   * rather than derived, because a code obtained in 2027 has to sit beside
   * documents numbered in 2026 without either being recomputed.
   */
  at_validation_code text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  -- What `invoice.series_id` points at, together with the kind: a document may
  -- not be numbered in a series meant for the other document type. Said with a
  -- composite key rather than a trigger, because a key cannot be raced.
  UNIQUE (organization_id, id, kind),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),

  CONSTRAINT invoice_series_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT invoice_series_prefix_shape CHECK (prefix ~ '^[A-Z0-9]{1,10}$'),
  CONSTRAINT invoice_series_next_number_sane CHECK (next_number >= 1)
);

COMMENT ON TABLE invoice_series IS
  'A numbering book: one per facility per document type. Sequential and '
  'gap-free within itself, which is why next_number is a column and not a '
  'Postgres sequence.';
COMMENT ON COLUMN invoice_series.prefix IS
  'The series letter a document number is built from — FT A/17. Editable only '
  'while the series has issued nothing, because a rename after that makes two '
  'documents of one book carry two different prefixes.';
COMMENT ON COLUMN invoice_series.at_validation_code IS
  'Reserved: the code the AT issues per series under Decreto-Lei 28/2019. Null '
  'until Poolse is certified, and never invented.';

CREATE TRIGGER invoice_series_updated_at BEFORE UPDATE ON invoice_series
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * A prefix is unique per organization, not per facility.
 *
 * The series hangs off a facility, but the club is one legal entity and a
 * document number identifies a document across all of it. Two sites both
 * numbering their faturas `FT A/1` would issue two different documents under
 * one number, which is the failure the whole file exists to prevent.
 */
CREATE UNIQUE INDEX invoice_series_prefix_uq
  ON invoice_series (organization_id, kind, upper(prefix))
  WHERE archived_at IS NULL;

-- Exactly one default per site per type, so "which book does this go in" never
-- depends on row order.
CREATE UNIQUE INDEX invoice_series_one_default_uq
  ON invoice_series (organization_id, facility_id, kind)
  WHERE archived_at IS NULL AND is_default;

ALTER TABLE invoice_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_series_tenant ON invoice_series
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_series TO poolse_app;

-- ---------------------------------------------------------------------------
-- invoice — the document
-- ---------------------------------------------------------------------------
--
-- **There is no draft.** A row exists only once the document is issued, which
-- is what makes "a number is never allocated and then thrown away" structural
-- rather than a rule somebody remembers. What an operator sees before issuing
-- is a preview computed by the same code path that writes — the importer
-- convention, for the same reason: what was shown and what was written have to
-- come from one place.
--
-- **There is no `archived_at` and no `updated_at`.** Nothing archives a
-- document and nothing updates one: `poolse_app` holds SELECT and INSERT on
-- this table and no more. A document issued in error is corrected by a credit
-- note, which is a second document and says so.

CREATE TABLE invoice (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization (id),
  facility_id         uuid NOT NULL,
  series_id           uuid NOT NULL,

  kind                invoice_kind NOT NULL DEFAULT 'invoice',

  -- Both filled by `allocate_invoice_number` on the way in. An INSERT that
  -- supplies either is refused: the number is the database's to give.
  number              integer NOT NULL,
  document_no         text NOT NULL,

  -- Set on a credit note and only on one. A correction names what it corrects.
  corrects_invoice_id uuid,

  issued_on           date NOT NULL DEFAULT current_date,
  due_on              date NOT NULL,

  /*
   * When the document entered the system, as opposed to the date it carries.
   *
   * A SAF-T field, and meaningful today: a club issuing March's invoices on the
   * 2nd of April dates them March and entered them in April, and the record
   * should be able to say both.
   */
  system_entry_at     timestamptz NOT NULL DEFAULT now(),

  /*
   * Who owes it — a membership or a student, never both and never neither.
   *
   * The guardian responsible for the student, or the student themselves on the
   * adult path. The same either/or shape as the emergency contact beside it,
   * for the same reason: two ways of naming one person makes "which is
   * authoritative" a question every reader answers differently.
   *
   * Which one applies is decided by `invoice_payer_membership_id`, not here: a
   * CHECK cannot call a STABLE function and the adult path is defined by
   * today's date.
   */
  payer_membership_id uuid,
  payer_student_id    uuid,

  /*
   * The payer as the document says it, snapshotted at issue.
   *
   * Not a join. A family that corrects a surname or moves house must not
   * silently rewrite a document they were sent last March — the same rule the
   * fee line's amount already follows, and the one an invoice needs most.
   */
  payer_name          text NOT NULL,
  payer_tax_number    text,
  payer_address       text,
  payer_email         citext,

  -- Reserved beside its series' validation code, and null for the same reason.
  atcud               text,

  notes               text,

  created_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  -- What a credit note's lines reach through, and what `corrects_invoice_id`
  -- points at.
  UNIQUE (organization_id, id, kind),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  -- The kind travels into the key, so a fatura cannot be numbered in the credit
  -- note book.
  FOREIGN KEY (organization_id, series_id, kind)
    REFERENCES invoice_series (organization_id, id, kind),
  FOREIGN KEY (organization_id, payer_membership_id)
    REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, payer_student_id)
    REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, corrects_invoice_id)
    REFERENCES invoice (organization_id, id),

  CONSTRAINT invoice_payer_is_one_person CHECK (
    (payer_membership_id IS NULL) <> (payer_student_id IS NULL)
  ),
  CONSTRAINT invoice_payer_name_not_blank CHECK (btrim(payer_name) <> ''),
  CONSTRAINT invoice_payer_fields_not_blank CHECK (
    (payer_tax_number IS NULL OR btrim(payer_tax_number) <> '')
    AND (payer_address IS NULL OR btrim(payer_address) <> '')
  ),
  -- A credit note corrects exactly one document; an invoice corrects none.
  CONSTRAINT invoice_correction_names_its_original CHECK (
    (kind = 'credit_note') = (corrects_invoice_id IS NOT NULL)
  ),
  CONSTRAINT invoice_dates_ordered CHECK (due_on >= issued_on),
  CONSTRAINT invoice_number_sane CHECK (number >= 1)
);

COMMENT ON TABLE invoice IS
  'An internal invoice record. Written once — poolse_app has SELECT and INSERT '
  'and nothing else — numbered by the database, and corrected only by a credit '
  'note. Not a legal fatura: see the migration header.';
COMMENT ON COLUMN invoice.document_no IS
  'The number as it is printed: FT A/17. Composed once, at issue, from the '
  'series prefix — never rebuilt from a join, because the prefix may be renamed '
  'while this document stays what it was.';
COMMENT ON COLUMN invoice.atcud IS
  'Reserved for certification. Null until Poolse is certified, and never '
  'invented — an ATCUD a club could not defend is worse than none.';

CREATE INDEX invoice_facility_idx
  ON invoice (organization_id, facility_id, issued_on DESC, number DESC);

CREATE INDEX invoice_payer_membership_idx
  ON invoice (organization_id, payer_membership_id)
  WHERE payer_membership_id IS NOT NULL;

CREATE INDEX invoice_payer_student_idx
  ON invoice (organization_id, payer_student_id)
  WHERE payer_student_id IS NOT NULL;

-- The number is unique within its series by construction — the allocation takes
-- a row lock — and the index says so as well, because "by construction" is a
-- claim and this is a proof.
CREATE UNIQUE INDEX invoice_number_uq ON invoice (series_id, number);

/*
 * One credit note per document.
 *
 * A document credited twice makes "has this been corrected" have two answers,
 * and doubles anything summed from the pair. A club that credits the wrong
 * document issues a fresh invoice, which is what the sequence is for.
 */
CREATE UNIQUE INDEX invoice_one_credit_note_uq
  ON invoice (corrects_invoice_id)
  WHERE kind = 'credit_note';

ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_tenant ON invoice
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

/*
 * Written once, and the grant is what says so.
 *
 * The default privileges in `core-tenancy` hand `poolse_app` all four verbs on
 * every new table, so this is a revoke rather than a narrow grant. A trigger
 * would do the same job and could be dropped by a later migration that meant
 * something else; a missing privilege cannot be forgotten by application code
 * at all. When settlement lands in 2.3 it arrives as a child table, exactly as
 * `student_fee_payment` did — not as a column on a document.
 */
REVOKE UPDATE, DELETE ON invoice FROM poolse_app;
GRANT SELECT, INSERT ON invoice TO poolse_app;

-- ---------------------------------------------------------------------------
-- invoice_line — what is being charged
-- ---------------------------------------------------------------------------
--
-- One line per fee occurrence per student. A family with two children paying
-- two mensalidades gets one document with two lines, and every line says whose
-- it is.
--
-- Amounts are **gross** and `vat_rate` says what is already inside them, which
-- is the rule `fee_plan` settled in round 9. `vat_exempt` is its own flag
-- because on a Portuguese document an exemption and a zero rate are two
-- different statements — and this is where the exemption *reason* finally has
-- somewhere to go.

CREATE TABLE invoice_line (
  id                     uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organization (id),
  invoice_id             uuid NOT NULL,

  /*
   * The document's kind, copied onto its lines.
   *
   * A partial unique index cannot join, and the two rules below are both
   * partial: one credit per line, and — through the constraint trigger — one
   * live charge per occurrence. `student_fee.kind` is here for the same reason
   * and the same trigger pair keeps the copy honest.
   */
  document_kind          invoice_kind NOT NULL,

  student_id             uuid NOT NULL,
  student_fee_id         uuid NOT NULL,

  /* What a credit note line reverses. Null on an invoice line, set on every
   * credit note line, so a credit is always traceable to what it undoes. */
  credits_invoice_line_id uuid,

  -- Snapshots, all of them, for the reason the payer's name is one.
  student_name           text NOT NULL,

  /*
   * What the line says, in the only two parts a document can honestly carry.
   *
   * `kind` is an enum and the Portuguese for it is an i18n key — the standing
   * rule — so "Mensalidade" is not stored here and never should be: a club
   * reading its documents in English would otherwise get one word in
   * Portuguese. `description` holds the club's **own** words, which no
   * catalogue can translate: the level's name, or the season's. Null where the
   * club has none, which is an unbanded quota.
   *
   * `lessons_per_week` is the other half of what distinguishes two prices at
   * one level, and it is a number the interface renders as "2×/semana" or
   * "2/week". Snapshotted like everything else here: a price list reorganised
   * next season must not rewrite what a family was charged this one.
   */
  description            text,
  lessons_per_week       smallint,

  /*
   * The swimmer's own NIF, where the club has recorded one.
   *
   * Not a duplicate of the payer's. `student.tax_number` exists precisely
   * because a parent deducting lessons on their IRS does it against the
   * *child's* number, so a document addressed to a guardian routinely carries a
   * different number per line — which one column on the document could not
   * express for a family with two children.
   */
  student_tax_number     text,
  kind                   fee_kind NOT NULL,

  /*
   * The occurrence this line charges: the first day of the period.
   *
   * A monthly line's occurrences are the first of each month; a trimestral
   * line's are every three months from where it started; a line charged once
   * has exactly one, on its `starts_on`. The same value `student_fee_payment`
   * settles against, deliberately — the two have to be talking about the same
   * thing for 2.3 to join them.
   */
  period_start           date NOT NULL,
  months                 smallint NOT NULL DEFAULT 1,

  -- Gross, VAT included, integer cents. Positive on both document types: a
  -- credit note's sign is carried by its kind, not by negative numbers nobody
  -- can total.
  amount_cents           integer NOT NULL,

  vat_rate               numeric(5,2) NOT NULL DEFAULT 0,
  vat_exempt             boolean NOT NULL DEFAULT false,
  vat_exemption_reason   text,

  sort_order             integer NOT NULL DEFAULT 0,

  created_at             timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  -- What a credit note line points back at.
  UNIQUE (organization_id, id, document_kind),

  FOREIGN KEY (organization_id, invoice_id, document_kind)
    REFERENCES invoice (organization_id, id, kind),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, student_fee_id)
    REFERENCES student_fee (organization_id, id),
  FOREIGN KEY (organization_id, credits_invoice_line_id)
    REFERENCES invoice_line (organization_id, id),

  CONSTRAINT invoice_line_amount_sane CHECK (amount_cents >= 0),
  CONSTRAINT invoice_line_months_sane CHECK (months BETWEEN 1 AND 24),
  CONSTRAINT invoice_line_vat_sane CHECK (vat_rate BETWEEN 0 AND 100),
  CONSTRAINT invoice_line_vat_exempt_is_zero CHECK (NOT vat_exempt OR vat_rate = 0),
  -- A reason belongs to an exemption. On a taxed line it would be a sentence
  -- nothing prints and something eventually trusts.
  CONSTRAINT invoice_line_reason_needs_exemption CHECK (
    vat_exemption_reason IS NULL OR (vat_exempt AND btrim(vat_exemption_reason) <> '')
  ),
  CONSTRAINT invoice_line_description_not_blank CHECK (
    description IS NULL OR btrim(description) <> ''
  ),
  CONSTRAINT invoice_line_lessons_sane CHECK (
    lessons_per_week IS NULL OR lessons_per_week BETWEEN 1 AND 14
  ),
  CONSTRAINT invoice_line_student_name_not_blank CHECK (btrim(student_name) <> ''),
  CONSTRAINT invoice_line_student_tax_number_not_blank CHECK (
    student_tax_number IS NULL OR btrim(student_tax_number) <> ''
  ),
  -- A credit note line reverses one invoice line; an invoice line reverses none.
  CONSTRAINT invoice_line_credit_names_its_original CHECK (
    (document_kind = 'credit_note') = (credits_invoice_line_id IS NOT NULL)
  )
);

COMMENT ON TABLE invoice_line IS
  'One fee occurrence charged to one student. Gross amounts with the VAT rate '
  'that is already inside them. Written once, like the document it belongs to.';
COMMENT ON COLUMN invoice_line.document_kind IS
  'A copy of invoice.kind, filled by a trigger when a caller omits it. Present '
  'because the partial rules below cannot join — the same reason student_fee '
  'carries its kind.';

CREATE INDEX invoice_line_invoice_idx
  ON invoice_line (organization_id, invoice_id, sort_order, id);

CREATE INDEX invoice_line_occurrence_idx
  ON invoice_line (organization_id, student_fee_id, period_start);

CREATE INDEX invoice_line_student_idx
  ON invoice_line (organization_id, student_id);

-- One credit per invoice line, for the reason there is one credit note per
-- document. Partial, which is what `document_kind` is on the row for.
CREATE UNIQUE INDEX invoice_line_one_credit_uq
  ON invoice_line (credits_invoice_line_id)
  WHERE document_kind = 'credit_note';

ALTER TABLE invoice_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_line_tenant ON invoice_line
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE UPDATE, DELETE ON invoice_line FROM poolse_app;
GRANT SELECT, INSERT ON invoice_line TO poolse_app;

-- ---------------------------------------------------------------------------
-- The number, allocated where it cannot be lost
-- ---------------------------------------------------------------------------
--
-- In a BEFORE INSERT trigger, so the allocation and the row it numbers are the
-- same statement. Application code cannot hold a number it did not use, cannot
-- retry and skip one, and cannot be written tired in a way that does either.
--
-- The UPDATE takes a row lock on the series, which is what makes the sequence
-- gap-free under two people pressing the button at once — and, as a side
-- effect, serialises every insert into one series. The double-billing check
-- below is sound because of that lock.

CREATE FUNCTION allocate_invoice_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_number integer;
  v_prefix text;
BEGIN
  IF NEW.number IS NOT NULL OR NEW.document_no IS NOT NULL THEN
    RAISE EXCEPTION 'A document number is allocated by the database, never supplied'
      USING ERRCODE = 'check_violation',
            DETAIL = 'invoice_number_not_supplied';
  END IF;

  UPDATE invoice_series
     SET next_number = next_number + 1
   WHERE id = NEW.series_id
     AND organization_id = NEW.organization_id
     AND archived_at IS NULL
  RETURNING next_number - 1, prefix INTO v_number, v_prefix;

  IF v_number IS NULL THEN
    RAISE EXCEPTION 'No such numbering series'
      USING ERRCODE = 'foreign_key_violation',
            DETAIL = 'invoice_series_missing';
  END IF;

  NEW.number := v_number;
  -- `FT` and `NC` are the AT's own document-type codes, so a club reading the
  -- number recognises what it is holding before it reads anything else.
  NEW.document_no := CASE NEW.kind WHEN 'invoice' THEN 'FT' ELSE 'NC' END
                     || ' ' || v_prefix || '/' || v_number;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_allocate_number BEFORE INSERT ON invoice
  FOR EACH ROW EXECUTE FUNCTION allocate_invoice_number();

COMMENT ON FUNCTION allocate_invoice_number() IS
  'Allocates the next number in the document''s series, inside the transaction '
  'that writes it. A rolled-back insert takes its number back with it, which a '
  'Postgres sequence would not.';

-- ---------------------------------------------------------------------------
-- The line's copy of its document's kind
-- ---------------------------------------------------------------------------
--
-- Filled from the document when a caller does not send it, and refused when it
-- disagrees. The pair `student_fee.kind` already uses, and for the reason given
-- there: a copy with neither trigger is a copy that drifts.

CREATE FUNCTION invoice_line_document_kind() RETURNS trigger
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

  IF NEW.document_kind IS NULL THEN
    NEW.document_kind := v_kind;
  ELSIF NEW.document_kind <> v_kind THEN
    RAISE EXCEPTION 'A line may not disagree with its document about what it is'
      USING ERRCODE = 'check_violation',
            DETAIL = 'invoice_line_kind_mismatch';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_line_kind BEFORE INSERT ON invoice_line
  FOR EACH ROW EXECUTE FUNCTION invoice_line_document_kind();

-- ---------------------------------------------------------------------------
-- One live charge per occurrence
-- ---------------------------------------------------------------------------
--
-- The rule this module exists to keep: a family is never charged twice for one
-- month. It is what makes the monthly run safe to press twice, and it has to
-- hold across the per-student action as well, which is a different code path.
--
-- **Not a unique index**, because "live" needs a join: an occurrence on an
-- invoice that has since been credited is chargeable again, and that is the
-- ordinary way a club fixes a document it got wrong. A constraint trigger can
-- ask the question a partial index cannot.
--
-- The race a constraint trigger normally loses is closed by the series row lock
-- above: two transactions inserting invoices into one series cannot both be
-- past the allocation at once, so by the time the second writes a line the
-- first's are committed and visible.
--
-- `INITIALLY IMMEDIATE`, so the refusal arrives at the statement that caused it
-- and the API can answer 409 to the right request. Declared DEFERRABLE all the
-- same, because a future bulk correction may want to reorder its writes — and a
-- constraint that cannot be deferred at all is one somebody eventually drops.

/*
 * Where an occurrence is already charged, or null.
 *
 * One definition, because there are two readers: this trigger, which refuses a
 * second charge, and the monthly run, which must not offer one in the first
 * place. Written twice they would agree until somebody fixed a bug in one of
 * them — and the run offering what the trigger then refuses is a preview that
 * fails on commit for a reason the operator cannot see.
 *
 * `p_except_line_id` is what lets the trigger ask the question about a row that
 * is already inserted. Excluding by *line* rather than by document also catches
 * one occurrence written twice onto the same document.
 */
CREATE FUNCTION invoice_charged_on(
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
     -- Credited, and therefore no longer being asked for.
     AND NOT EXISTS (
       SELECT 1 FROM invoice c
        WHERE c.corrects_invoice_id = i.id
          AND c.organization_id = i.organization_id
          AND c.kind = 'credit_note'
     )
   ORDER BY i.issued_on, i.number
   LIMIT 1
$$;

COMMENT ON FUNCTION invoice_charged_on(uuid, uuid, date, uuid) IS
  'The document an occurrence is already charged on, or null. Read by the '
  'refusal below and by the monthly run alike, so a preview cannot offer what '
  'the commit refuses.';

CREATE FUNCTION invoice_line_not_already_charged() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_document_no text;
BEGIN
  IF NEW.document_kind <> 'invoice' THEN
    RETURN NULL;
  END IF;

  v_document_no := invoice_charged_on(
    NEW.organization_id, NEW.student_fee_id, NEW.period_start, NEW.id);

  IF v_document_no IS NOT NULL THEN
    /*
     * The figures travel as structure, never as prose — the standing rule for
     * every refusal that needs numbers. The API turns this DETAIL into a 409
     * with the document number as a field, and the sentence is composed where
     * the locale is.
     */
    RAISE EXCEPTION 'This period is already charged on %', v_document_no
      USING ERRCODE = 'unique_violation',
            DETAIL = 'invoice_line_already_charged|' || v_document_no;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER invoice_line_one_charge
  AFTER INSERT ON invoice_line
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION invoice_line_not_already_charged();

COMMENT ON FUNCTION invoice_line_not_already_charged() IS
  'One live charge per fee occurrence. A constraint trigger rather than a '
  'partial index because "live" means "not since credited", which needs a join.';

-- ---------------------------------------------------------------------------
-- The VAT already inside a gross amount
-- ---------------------------------------------------------------------------
--
-- One definition, in SQL, for the reason `fee_total_cents` is one. Every total
-- the API ships reaches this rather than a second implementation in TypeScript
-- that agrees with it until the day it does not.

CREATE FUNCTION invoice_vat_cents(p_gross_cents integer, p_vat_rate numeric)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(
    p_gross_cents::numeric * coalesce(p_vat_rate, 0) / (100 + coalesce(p_vat_rate, 0))
  )::integer;
$$;

COMMENT ON FUNCTION invoice_vat_cents(integer, numeric) IS
  'The tax inside a VAT-inclusive amount. Zero at a zero rate, which is also '
  'what an exempt line carries — the two are told apart by vat_exempt, never by '
  'the rate.';

-- ---------------------------------------------------------------------------
-- Who a student's invoice is addressed to
-- ---------------------------------------------------------------------------
--
-- The guardian responsible for them, or nobody — and "nobody" means the student
-- is their own payer, which is what puts an adult on their own document and
-- siblings on one of their parent's.
--
-- One definition, read by the run and by the per-student action alike. STABLE
-- rather than IMMUTABLE: guardians come and go, and a cached answer would
-- address a document to somebody who stopped being responsible last week.
--
-- The primary contact first, then the oldest live link. A student with two
-- guardians and no primary marked is a form half filled in, not an error, and
-- the invoice still has to be addressable.

CREATE FUNCTION invoice_payer_membership_id(
  p_organization_id uuid,
  p_student_id      uuid
) RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT g.guardian_membership_id
    FROM guardian_link g
   WHERE g.student_id = p_student_id
     AND g.organization_id = p_organization_id
     AND g.archived_at IS NULL
   ORDER BY g.is_primary DESC, g.created_at, g.id
   LIMIT 1
$$;

COMMENT ON FUNCTION invoice_payer_membership_id(uuid, uuid) IS
  'The guardian a student''s invoice is addressed to, or null when the student '
  'is their own payer. Null is the adult path and also a student nobody has '
  'given a guardian yet — either way the document is addressed to them.';

-- ---------------------------------------------------------------------------
-- Every facility gets its two books
-- ---------------------------------------------------------------------------
--
-- A trigger rather than a step in the API, for the reason `facility_hours` is
-- seeded by one: a site with no series cannot issue anything, and the failure
-- would arrive months later at the one moment a club is trying to invoice.
--
-- The prefix comes from `organization.invoice_series_prefix`, which has sat in
-- the schema unused since the first migration and now has the job it was named
-- for. A second site in one organization cannot reuse it — the prefix is unique
-- per club — so it takes the first free suffix, and an operator may rename it
-- to something they recognise while the book is still empty.

CREATE FUNCTION seed_invoice_series_for(
  p_organization_id uuid,
  p_facility_id     uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_base   text;
  v_prefix text;
  v_kind   invoice_kind;
  n        integer;
BEGIN
  SELECT upper(coalesce(nullif(btrim(invoice_series_prefix), ''), 'A'))
    INTO v_base
    FROM organization WHERE id = p_organization_id;

  -- A prefix out of shape in the organization row is not a reason to refuse a
  -- facility. Fall back rather than raise.
  IF v_base !~ '^[A-Z0-9]{1,8}$' THEN
    v_base := 'A';
  END IF;

  FOREACH v_kind IN ARRAY ARRAY['invoice', 'credit_note']::invoice_kind[] LOOP
    -- A site restored from a backup, or a re-run of the backfill below, already
    -- has its book. Nothing to do and nothing to complain about.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM invoice_series s
       WHERE s.organization_id = p_organization_id
         AND s.facility_id = p_facility_id
         AND s.kind = v_kind
         AND s.archived_at IS NULL
    );

    n := 1;
    LOOP
      v_prefix := CASE WHEN n = 1 THEN v_base ELSE v_base || n::text END;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM invoice_series s
         WHERE s.organization_id = p_organization_id
           AND s.kind = v_kind
           AND upper(s.prefix) = v_prefix
           AND s.archived_at IS NULL
      );
      n := n + 1;
    END LOOP;

    INSERT INTO invoice_series (organization_id, facility_id, kind, name, prefix, is_default)
    VALUES (
      p_organization_id, p_facility_id, v_kind,
      CASE v_kind WHEN 'invoice' THEN 'Faturas' ELSE 'Notas de crédito' END,
      v_prefix, true
    );
  END LOOP;
END;
$$;

CREATE FUNCTION seed_invoice_series() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_invoice_series_for(NEW.organization_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER facility_seed_invoice_series AFTER INSERT ON facility
  FOR EACH ROW EXECUTE FUNCTION seed_invoice_series();

-- Backfill, archived sites included: archiving a facility is reversible here,
-- and a restored site with no book could not issue anything.
DO $backfill$
DECLARE
  f record;
BEGIN
  FOR f IN SELECT id, organization_id FROM facility ORDER BY organization_id, created_at, id LOOP
    PERFORM seed_invoice_series_for(f.organization_id, f.id);
  END LOOP;
END;
$backfill$;

-- Down Migration
--
-- The documents go with the tables, which is what dropping an invoicing module
-- means. Nothing else in the schema is touched: `organization.invoice_series_prefix`
-- predates this file and stays where it was.

DROP TRIGGER IF EXISTS facility_seed_invoice_series ON facility;
DROP FUNCTION IF EXISTS seed_invoice_series();
DROP FUNCTION IF EXISTS seed_invoice_series_for(uuid, uuid);

DROP FUNCTION IF EXISTS invoice_payer_membership_id(uuid, uuid);
DROP FUNCTION IF EXISTS invoice_vat_cents(integer, numeric);

DROP TABLE IF EXISTS invoice_line;
DROP TABLE IF EXISTS invoice;
DROP TABLE IF EXISTS invoice_series;

DROP FUNCTION IF EXISTS invoice_line_not_already_charged();
DROP FUNCTION IF EXISTS invoice_charged_on(uuid, uuid, date, uuid);
DROP FUNCTION IF EXISTS invoice_line_document_kind();
DROP FUNCTION IF EXISTS allocate_invoice_number();

DROP TYPE IF EXISTS invoice_kind;

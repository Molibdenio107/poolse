-- Up Migration
--
-- Two unrelated things a club asked for on the same evening: a level chooses its
-- own colour, and leave stops meaning only holiday.
--
-- ---------------------------------------------------------------------------
-- 1 — a level's colour, chosen rather than derived
-- ---------------------------------------------------------------------------
--
-- The calendar has been colouring a turma by its level's *position* in the
-- club's ordering: first level gets the first tint, and so on. That worked and
-- was invisible, which is the problem — a club that reordered its levels
-- repainted its whole week and had no way to say "Iniciados is the green one".
--
-- Reusing `class_colour` rather than declaring a parallel enum. They are the
-- same eight tokens and always will be: a level's green and a turma's green have
-- to be the same green, or a turma that inherits its level's colour changes
-- shade for no reason anybody could explain.

ALTER TABLE student_level
  ADD COLUMN colour class_colour;

COMMENT ON COLUMN student_level.colour IS
  'The level''s colour on the grid. Backfilled from the position it used to be derived from, so nothing changed the day it was added.';

/*
 * Backfilled from the position each level already had.
 *
 * So the day this ships, every club's calendar looks exactly as it did the day
 * before, and the derived-from-position rule can be deleted rather than left
 * running underneath as a fallback nobody remembers. Eight tints, wrapping — the
 * same arithmetic the interface was doing.
 *
 * `row_number()` rather than `sort_order` directly: sort orders are not
 * guaranteed contiguous — a club that has reordered its levels a few times has
 * gaps — and the colour a level *had* came from its place in the sorted list,
 * not from the integer itself.
 */
UPDATE student_level AS sl
   SET colour = ranked.tint
  FROM (
    SELECT id,
           (ARRAY[
             'teal','green','lime','amber','orange','rose','magenta','violet'
           ]::class_colour[])[
             ((row_number() OVER (PARTITION BY organization_id
                                      ORDER BY sort_order, name) - 1) % 8) + 1
           ] AS tint
      FROM student_level
     WHERE archived_at IS NULL
  ) AS ranked
 WHERE sl.id = ranked.id;

-- ---------------------------------------------------------------------------
-- 2 — leave is not only holiday
-- ---------------------------------------------------------------------------
--
-- `vacation_request` has always meant a holiday. A club also has to record that
-- somebody is off sick or away for the afternoon, and the calendar needs to know
-- about all three when it offers a stand-in for a lesson.
--
-- **One table, one approval queue.** A second table would mean a manager looking
-- in two places for "who is away in August", and the calendar joining two
-- sources to answer one question. The table keeps its name: renaming it would
-- touch every query in the module for no behavioural gain, and the name is
-- already visible only to us.

CREATE TYPE leave_kind AS ENUM ('vacation', 'medical', 'personal');

/*
 * `vacation` by default, and NOT NULL.
 *
 * Every row that already exists is a holiday, because that is the only thing
 * this table could hold until now. A nullable column would have left the balance
 * query asking what a null means, and the answer would have had to be "holiday"
 * anyway.
 */
ALTER TABLE vacation_request
  ADD COLUMN kind leave_kind NOT NULL DEFAULT 'vacation';

COMMENT ON COLUMN vacation_request.kind IS
  'Holiday, sick leave or personal leave. All three are approved the same way; only vacation counts against the yearly entitlement.';

/*
 * A note, for the two new kinds.
 *
 * Deliberately not a diagnosis and deliberately not a document. Where a club
 * files an atestado is `student_sensitive`'s problem for a student, and for
 * staff it is a filing cabinet; this is the line an operator writes so the
 * approval queue is intelligible — "consulta", "assunto familiar".
 */
ALTER TABLE vacation_request
  ADD COLUMN reason text;

ALTER TABLE vacation_request
  ADD CONSTRAINT vacation_request_reason_said
  CHECK (reason IS NULL OR btrim(reason) <> '');

-- The approval queue and the calendar both read "who is away, of what kind, on
-- what day", and both had to filter by status already.
CREATE INDEX vacation_request_kind_idx
  ON vacation_request (organization_id, kind, status)
  WHERE archived_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS vacation_request_kind_idx;

ALTER TABLE vacation_request
  DROP CONSTRAINT IF EXISTS vacation_request_reason_said,
  DROP COLUMN IF EXISTS reason,
  DROP COLUMN IF EXISTS kind;

DROP TYPE IF EXISTS leave_kind;

ALTER TABLE student_level
  DROP COLUMN IF EXISTS colour;

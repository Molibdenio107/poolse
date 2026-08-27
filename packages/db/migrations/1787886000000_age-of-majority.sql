-- Maioridade as a tenant setting — POOLSE-22.
--
-- Eighteen is Portuguese law, not a fact about swimming. A club running an
-- international programme, or a country that sets it elsewhere, needs the
-- guardian requirement to follow their rule rather than ours.
--
-- Done now rather than later on purpose. Every week that passes writes another
-- hardcoded 18 into a form, a query or a message, and the migration to undo that
-- gets more expensive each time. Today there are two places; the column makes it
-- one.
--
-- It drives two things: whether POOLSE-04's guardian block appears, and which
-- consent form is presented at enrolment — guardian-signed below the line,
-- self-signed at or above it.

-- Up Migration

ALTER TABLE organization
  ADD COLUMN age_of_majority smallint NOT NULL DEFAULT 18;

/*
 * A sane range, not an opinion about where the line belongs.
 *
 * Below 10 every student is an adult and the guardian block never appears; above
 * 30 every adult student is treated as a child. Both are almost certainly a
 * typo — a stray digit in a settings field — and either would quietly change who
 * the club is allowed to contact about a person.
 */
ALTER TABLE organization
  ADD CONSTRAINT organization_age_of_majority_sane
  CHECK (age_of_majority BETWEEN 10 AND 30);

COMMENT ON COLUMN organization.age_of_majority IS
  'Maioridade, in whole years. Drives whether a student needs an encarregado de '
  'educação and which consent form is presented. Defaults to 18 — POOLSE-22.';

-- Down Migration

ALTER TABLE organization
  DROP CONSTRAINT IF EXISTS organization_age_of_majority_sane;

ALTER TABLE organization
  DROP COLUMN IF EXISTS age_of_majority;

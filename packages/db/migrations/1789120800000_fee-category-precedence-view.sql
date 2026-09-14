-- Up Migration
--
-- The precedence, sayable for a whole club at once — round 19, measured.
--
-- `enrolment_fee_category(organization_id, enrollment_id)` is the single
-- definition of "the enrolment's category, else its turma's", and it stays that.
-- What it could not do is answer for *every* enrolment without being called once
-- per row, and round 19's concession roll-up needs exactly that: which category
-- each live enrolment resolves to, on every load of a facility page.
--
-- Measured on this machine, against the categories query that does it:
--
--     63 enrolments      17 ms
--    563 enrolments      62 ms
--  2 063 enrolments     210 ms
--  5 063 enrolments     562 ms
--
-- Linear, about 100 µs an enrolment — the cost of a function call and a join per
-- row rather than one join for the lot. A municipal pool would pay a fifth of a
-- second on a page its office opens all day, which is not a page that can carry
-- it.
--
-- **A view, and the function redefined on top of it.** The obvious fix — copy
-- the `coalesce` into the roll-up's CTE — is the one the original migration
-- explicitly refused, and rightly: two spellings of one rule agree until the day
-- they do not. So the rule moves *into* the view, the scalar function becomes a
-- lookup against it, and there is still exactly one place the precedence is
-- written. Every existing caller keeps working and keeps getting the same answer
-- by construction.

/*
 * `security_invoker` is the whole safety of this.
 *
 * A view without it runs with its **owner's** permissions, which here is the
 * migration role — so `poolse_app` selecting from it would read every tenant's
 * enrolments and RLS would never be consulted. That is precisely the hole this
 * schema's isolation is built to make impossible, arriving through the one
 * construct that can bypass it silently.
 *
 * With it, the policies on `enrollment` and `class_group` apply as the querying
 * role, exactly as they do for a direct select. Postgres 15 or later; this
 * database is 16.
 */
CREATE VIEW enrolment_fee_category_all
  WITH (security_invoker = true) AS
  SELECT e.organization_id,
         e.id     AS enrollment_id,
         e.student_id,
         e.status,
         coalesce(e.fee_category_id, cg.fee_category_id) AS category_id
    FROM enrollment e
    JOIN class_group cg
      ON cg.id = e.class_group_id
     AND cg.organization_id = e.organization_id;

COMMENT ON VIEW enrolment_fee_category_all IS
  'Which fee category each enrolment resolves to — its own, else its turma''s. '
  'The single definition of that precedence, now sayable for a whole club at '
  'once. security_invoker, so RLS applies as the querying role.';

GRANT SELECT ON enrolment_fee_category_all TO poolse_app;
GRANT SELECT ON enrolment_fee_category_all TO poolse_platform;

/*
 * The scalar answer, now a lookup rather than a second spelling.
 *
 * Same signature, same STABLE, same answer — callers do not change and cannot
 * tell. What changed is that the `coalesce` exists once, in the view above, so a
 * correction to the precedence reaches the row-at-a-time callers and the
 * club-at-a-time one together.
 */
CREATE OR REPLACE FUNCTION enrolment_fee_category(
  p_organization_id uuid,
  p_enrollment_id   uuid
) RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT v.category_id
    FROM enrolment_fee_category_all v
   WHERE v.enrollment_id = p_enrollment_id
     AND v.organization_id = p_organization_id
$$;

COMMENT ON FUNCTION enrolment_fee_category(uuid, uuid) IS
  'The category that applies to one enrolment: its own, else its turma''s, else '
  'none. A lookup against enrolment_fee_category_all, which holds the rule — '
  'POOLSE-23 AC4, round 19.';

-- Down Migration
--
-- The function goes back to holding the rule itself, and then the view can go.
-- Restored verbatim from 1788073200000_fee-category.sql: reversing this must
-- leave the precedence spelled exactly as it was, not as somebody remembered it.

CREATE OR REPLACE FUNCTION enrolment_fee_category(
  p_organization_id uuid,
  p_enrollment_id   uuid
) RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(e.fee_category_id, cg.fee_category_id)
    FROM enrollment e
    JOIN class_group cg
      ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
   WHERE e.id = p_enrollment_id AND e.organization_id = p_organization_id
$$;

DROP VIEW IF EXISTS enrolment_fee_category_all;

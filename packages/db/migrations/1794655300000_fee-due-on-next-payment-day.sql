-- Up Migration

/*
 * A fee period is due on the first payment day on or after it begins (Rui,
 * 10-11-2026, go-live review).
 *
 * A line's periods start on its own day — enrolled on the 14th, the periods are
 * the 14th of each month — and `fee_due_on` used to take the payment day of the
 * period's month. With payment day 8 that put the 14 November period due on
 * 8 November: overdue the day it was created, the late penalty applied at once,
 * and every later period due before it began (56 of the 105 periodic lines in
 * the dev seed). Now: 14 November is due 8 December, 14 December is due
 * 8 January.
 *
 * A period that starts on the 1st (every invoice run asks with the month's
 * first day) is due on the same day as before, since the payment day of its own
 * month is never before it. The clamp to a short month's last day is kept.
 * Period keys (`period_start`) do not change, so no payment row moves.
 */

CREATE OR REPLACE FUNCTION fee_due_on(p_period_start date, p_due_day smallint) RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  WITH months AS (
    SELECT date_trunc('month', p_period_start)::date AS this_month,
           (date_trunc('month', p_period_start) + interval '1 month')::date AS next_month
  ), due AS (
    SELECT this_month + (least(p_due_day, extract(day FROM (this_month + interval '1 month - 1 day'))::int) - 1)
             AS in_this_month,
           next_month + (least(p_due_day, extract(day FROM (next_month + interval '1 month - 1 day'))::int) - 1)
             AS in_next_month
      FROM months
  )
  SELECT CASE WHEN in_this_month >= p_period_start THEN in_this_month ELSE in_next_month END
    FROM due;
$$;

COMMENT ON FUNCTION fee_due_on(date, smallint) IS
  'The first payment day on or after the period begins, clamping a due day past '
  'the end of a short month to its last day.';

-- Down Migration

CREATE OR REPLACE FUNCTION fee_due_on(p_period_start date, p_due_day smallint) RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT date_trunc('month', p_period_start)::date
         + (least(p_due_day, extract(day FROM (date_trunc('month', p_period_start)
                                               + interval '1 month - 1 day'))::int) - 1);
$$;

COMMENT ON FUNCTION fee_due_on(date, smallint) IS
  'The date an occurrence beginning in this month is due, clamping a due day past '
  'the end of a short month to its last day.';

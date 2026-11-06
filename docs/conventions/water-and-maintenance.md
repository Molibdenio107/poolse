# Water quality and maintenance

The full text of the conventions for readings, bands, alerts, tasks or spaces. `CLAUDE.md` holds one line each; read this file before changing that area.

**A derived answer is derived once, on the server.** Overdue cleaning is
`now() - last cleaning > interval`, computed in SQL in `spaces.repository.ts` and shipped as a
boolean; the client renders it and never recomputes it. The same reasoning as the trigger
refusals that carry their numbers: two implementations of one rule agree until the day they do
not. It is also why there is no `is_overdue` column — a stored flag needs a worker to keep it
true, and that is a per-tenant cost.

**A breach is derived; being told about it is a record.** `excursions()` and the published
bands live in `@poolse/rules` — with `POOL_METRICS` and `METRIC_UNITS`, which the API and the
web app each used to declare by hand — so the pool's page and the alert email cannot disagree
about whether a reading is bad. What `pool_analysis_alert` stores is the part that cannot be
derived twice: that on this date, these people were told. **An email is not idempotent**, so
the row is written inside the transaction that wrote the reading, one per analysis by unique
index, and the *sending* happens after the commit where it can never roll a reading back.
`metrics` is a snapshot even so, because a measurement is corrected in place and a compliance
record that rewrote itself when somebody fixed a typo would not be one.

**The published band is NP 4542:2017, and a lab result's grade is derived, never stored.** POOLSE-72. `nationalBands({ kind, use })` in `@poolse/rules` holds the bands, each cited to its quadro (`docs/research/water-reference-2026-10.md`). Free chlorine is a `byPh` band, judged by the pH **in the same analysis**, which is why `excursions()` takes one analysis's values. Temperature comes from `pool.use`, and an unset use judges none. `resolveBands(overrides, pool)` needs the tank. `gradeLabResult()` grades a lab report under §4.4 against the national reference, never a club's own bands, and every reader calls it. A não conforme report alerts through `lab_result_alert` on the water alert's terms. `docs/features/water-quality.md`.

**A pool's band is the published one until a club says otherwise, and `resolveBands` is where
the two meet.** `pool_metric_range` holds only exceptions — no row is the answer for almost
every pool, which is what lets a later correction to a published band reach everybody who never
overrode it. Three states and the third is why both bounds are nullable: no row is the
reference, a row is its bounds *on the sides that carry one*, and a row with **neither** bound
means the metric is not judged here at all. Never collapse the first and the third — a hotel
tank kept at 30 °C is outside the published temperature band every day of its life, and that
distinction is the difference between one alert and one a day forever. `Excursion.limit` is the
bound actually crossed, so every sentence about an excursion is sayable without a null check,
and the API ships the *resolved* map: no client merges bands.

**Only a recent sample alerts, and the screen says whether anything was sent.**
`ALERT_WINDOW_HOURS` is 48, compared against `taken_at` in SQL; a club's first act is to
import its history, and forty emails about water dosed last winter teach it to filter the
channel before it ever carries something urgent. The reading is still recorded either way.
Recipients resolve **by role** at send time — owner, admin, maintenance, deduplicated, over
`coalesce(app_user.cached_email, membership.email)` so the staff member with no login is
included — and the addresses are then written onto the row, because "who was told" is not
recoverable from the roles once that person has left. `delivered_at` null means recorded and
not sent, said in words: the same honesty the chase list owes about what Poolse has and has
not delivered.

**A recurring job is a `maintenance_task`; a one-off is a `maintenance_request`, and
`interval_days` is the boundary.** Round 6 built the unplanned half — somebody notices a shower
is broken — and 4.3 built the planned one. The interval is NOT NULL precisely so the two cannot
be confused: a job with no cadence *is* a request, and a nullable interval would give one fact
two homes. Pausing is `active`, as it is on a space. **Due-ness is derived in SQL, in the same
four ordered branches as overdue cleaning** — paused is never due, never-done *is* due, else
time since the last completion — and there is no `next_due_at` column, because a completion
backdated to when the work actually happened has to move the next due date with it. A deleted
completion did not happen, so removing one puts its task straight back to due.

**Assignment is a person here and a role in 4.2's alerts, and the difference is the point.** An
alert has to *reach* somebody who can act, so a role is right and turnover must not orphan it. A
task is a to-do list, and a job assigned to three people is a job none of them does. Unassigned
means everybody sees it, so nothing is invisible; a task whose person has left says so rather
than being reassigned by Poolse.

**A null ceiling, interval or limit means "not measured" and enforces nothing.**
`pool.max_capacity`, `space.expected_cleaning_interval_hours`,
`organization.max_management_users`. Never read one as zero. Its counterpart is that an
*absence of history* is not evidence: a space with a schedule and no cleaning at all is
overdue, not fine.

**Out of service is not deleted.** `space.active = false` means shut for works — still listed,
still openable, and exempt from the overdue rule; `archived_at` is deletion. Where a table
carries both, they must mean different things and the difference belongs in a column comment.

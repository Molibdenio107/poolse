# POOLSE-16 · Raise level maximum age to 100 + senior demo data

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug / Data · **Area:** Levels · **Priority:** High

### PO — why this exists

Poolse runs hidroginástica and adult classes, and the level maximum age is capped at 30 — so every student over 30 is silently ineligible for every level, with no error explaining why. That is a correctness bug wearing the clothes of a settings limit, and it blocks the adult and senior programme entirely. High priority, and cheap: a ceiling change plus seed data that keeps the range exercised.

**Not in scope:** month granularity at the bottom of the range (POOLSE-06), the adult enrolment flow (POOLSE-23), and pricing for concessions.

### BA — rules and data

- The maximum-age ceiling rises from 30 to 100 in the UI picker, the API validation and any database constraint (AC1) — all three, or the bug survives in whichever layer is missed.
- No existing level data is altered by the change (AC2): raising a ceiling must not touch stored values.
- Eligibility checks accept students up to 100 (AC3), so the comparison used when enrolling a student into a level or turma must be re-tested at the new boundary.
- Excel import accepts maximum ages above 30 without a validation error (AC5) — the import has its own validation copy and it is the layer most likely to be forgotten.
- Seed/demo data gains at least one senior level (e.g. *Hidroginástica Sénior*, 60–100) and a handful of students aged 60–85 (AC4), so the range is covered by tests and visible in the demo tenant.
- Existing rule from POOLSE-06 AC7 applies: maximum age must be greater than minimum age, and both accept the full 1 month … 100 years range.
- **Direct conflict with POOLSE-06:** POOLSE-06 AC6 specifies the same 30 → 100 ceiling change *and* changes the field's storage to months. If these ship separately, one migration will contradict the other's assumptions about the stored unit. They must ship together, or POOLSE-16 must ship first with the explicit note that its ceiling is expressed in whatever unit POOLSE-06 later migrates to.
- Edge case: a student aged exactly 100, and a level with max exactly 100 — inclusive or exclusive must be decided and applied identically in the UI, the API, the DB constraint and the import. **Open:** the backlog does not state inclusivity; decide once and document it.
- Age brackets in POOLSE-33 define Sénior as 60+ and must share the boundary definitions with this logic (POOLSE-33 AC7) so they cannot drift.

### Dev — implementation notes

- Migration touches constraints only: widen or drop-and-recreate the check constraint on the level's maximum age. No data rows change (AC2) — assert that with a count before and after.
- Find every copy of the number 30: the picker's option list, the API DTO validation, the DB constraint, the Excel import validator, any seed fixture and any test that asserts the old ceiling. A grep for the literal is the honest first step.
- Put the age bounds in one shared constant module consumed by the picker, the validators and the eligibility helper, so the next ceiling change is one line — the same discipline POOLSE-33 AC7 asks for on bracket boundaries.
- Eligibility is a shared helper, not per-page logic; it is called from enrolment, from the transfer proposals in POOLSE-19 and from import.
- Coordinate with POOLSE-06: if that lands first the comparison unit is months, and 100 years is 1200 months. Writing 100 into a months-typed field is the single most likely defect here.
- Permission: editing a level remains Owner/Admin as today; this ticket does not widen who may set ages, and the endpoint check stays server-side.
- i18n: age labels follow POOLSE-06's singular/plural rules in pt-PT and en; "100 anos" and "100 years" must both render from the same key.
- Seed data is production-shaped, not throwaway: the senior level and the 60–85 students must be realistic enough that the demo tenant shows the feature working.
- Most likely to get wrong: fixing the picker and the API, and leaving the Excel import validator or the DB check constraint at 30 — the failure then only appears on an import or on a write that bypasses the API path.

### QA — test scenarios

16.1 Given an Owner editing a level / When they set the maximum age to 100 / Then it saves and is shown as 100 on reload.
16.2 Given the picker / When it is opened / Then values above 30 up to 100 are offered, with no gap at the old ceiling.
16.3 Given a level with max 100 / When a student aged 85 is enrolled / Then eligibility passes and the enrolment succeeds.
16.4 Given a student aged exactly 100 and a level with maximum 100 / When eligibility is checked / Then the result matches the documented inclusivity decision, identically in the UI, the API and the import.
16.5 Given a maximum age of 101 submitted directly to the API / When validated / Then it is rejected — the ceiling still exists, it has only moved.
16.6 Given a maximum age lower than the level's minimum / When saved / Then it is rejected with a clear message (POOLSE-06 AC7).
16.7 Given an Excel file with a level whose maximum age is 100 / When imported / Then it imports with no validation error.
16.8 Given existing levels before the change / When the migration runs / Then not one stored age value differs afterwards.
16.9 Given an Instructor / When they call the level-update endpoint with a new maximum age / Then 403 — the permission surface is unchanged by this ticket.
16.10 Given the demo tenant after seeding / When levels are listed / Then *Hidroginástica Sénior* (60–100) exists and students aged 60–85 are present and eligible for it.
16.11 Given locale pt-PT then en / When an age of 100 and an age of 1 are displayed / Then singular and plural render correctly in both languages.
16.12 Given light and dark mode / When the age picker is opened at its full range / Then the long option list is legible and scrollable in both.
16.13 Given POOLSE-06 has landed and ages are stored in months / When a level's maximum is set to 100 years / Then it is stored as 1200 months and eligibility for an 85-year-old still passes.

**See also:** POOLSE-06 — same field, month granularity at the bottom of the range.

### Acceptance criteria

1. Maximum age ceiling raised from 30 to **100**, in the UI picker, the API validation and any DB constraint.
2. No existing level data is altered by the change.
3. Eligibility checks accept students up to 100.
4. Seed/demo data gains at least one senior level (e.g. *Hidroginástica Sénior*, 60–100) and a handful of students aged 60–85, so the range is covered by tests and visible in the demo tenant.
5. Excel import accepts maximum ages above 30 without a validation error.

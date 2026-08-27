# POOLSE-06 · Minimum age must support months under 1 year

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Levels / Classes · **Priority:** Medium

### PO — why this exists
Baby classes start at six months, and a field that only accepts whole years cannot express that, so baby levels are either configured wrong or configured as "0 years" and their eligibility check is meaningless. The same field's ceiling of 30 makes every senior student ineligible for every level. Admins configuring levels benefit, and so does anyone whose enrolment is currently blocked or wrongly allowed. Medium because the workaround is to ignore the eligibility check, which is exactly the wrong habit to build.
**Not in scope:** per-turma age overrides, age-based pricing (POOLSE-23 AC4), and the age-bracket badge (POOLSE-33).

### BA — rules and data
- Minimum and maximum age are both stored as integer **months**; existing year values migrate as `years × 12`.
- The picker offers `1 month … 11 months`, then `1 year … 100 years` — months only below 12, whole years above.
- Display follows the same rule in both locales, with singular and plural from i18n: `1 mês`, `6 meses`, `1 ano`, `3 anos`.
- Eligibility ("can this student join this level/class?") compares in months on both ends.
- Validation: maximum must be strictly greater than minimum; both accept 1 month … 100 years, i.e. 1 … 1200 months.
- Import and export columns use the same representation as the UI, in both directions.
- This ticket's AC6 and AC8 restate POOLSE-16's AC1 and AC4 (ceiling of 100, senior seed data). They are one change to the same field — ship them together, and do not write two migrations against the same columns.
- **Open:** at what date is a student's age evaluated for eligibility — today, the enrolment date, or the season start? The three give different answers for a child who turns 4 mid-season.
- **Open:** what does the Excel column literally carry — a locale-dependent label (`6 meses`) or an integer with the unit in the header? AC5 says "the same representation as the UI", which for a spreadsheet is ambiguous.

### Dev — implementation notes
- Migration: convert `min_age_years`/`max_age_years` to `min_age_months`/`max_age_months` with `× 12`, add `CHECK (max_age_months > min_age_months)` and `CHECK (min_age_months BETWEEN 1 AND 1200)`. Data volume is small, so a single migration is fine — but write the down path, because the year columns cannot be recovered from months once dropped without rounding.
- Raise the ceiling in the DB constraint, the API validation schema and the UI picker in the same change; a constraint left at 30 turns POOLSE-16 into a runtime error rather than a validation message.
- The picker is one grouped `Select` (a "Meses" group and an "Anos" group) whose value is always months — no unit dropdown beside a number field, which invites 6-years-meant-as-months.
- Reuse the shared `ageInMonths(dob, at)` helper from POOLSE-04 so eligibility, the guardian boundary and POOLSE-33's brackets cannot drift.
- i18n: use ICU plural forms. Portuguese has an irregular singular here — `1 mês` / `2 meses`, not `1 mes` — so a naive `+ 's'` will read wrong in the UI and in exports.
- The Excel import path validates through the same Zod schema as the API, so a fractional or out-of-range value is rejected identically in both entry points.
- Seed data gains a senior level (*Hidroginástica Sénior*, 60–100) and students aged 60+, so the top of the range is exercised by tests rather than only by production.
- Most likely to be got wrong: a code path still reading years — a report filter, an eligibility branch or an export column — which silently treats 72 months as 72 years.

### QA — test scenarios
06.1 Given an existing level with minimum age 3 years, When the migration runs, Then its stored minimum is 36 months and the UI displays `3 anos` / `3 years`.
06.2 Given the minimum-age picker, When it opens, Then it offers 1–11 months and then whole years from 1 to 100, with no `0 months` and no `12 months` entry.
06.3 Given a level with minimum 6 months, When it renders in pt-PT and en, Then it reads `6 meses` and `6 months`.
06.4 Given a level with minimum 1 month, When it renders in pt-PT, Then it reads `1 mês`, not `1 meses`.
06.5 Given a level 6–11 months and a student aged 5 months, When eligibility is checked, Then the student is ineligible; at 6 months exactly, eligible.
06.6 Given a level with minimum 100 years, When save is attempted with maximum 100 years, Then it is rejected because maximum must be greater than minimum.
06.7 Given a crafted API request with `max_age_months: 1201`, When it is posted, Then it is rejected by validation and by the DB constraint.
06.8 Given a crafted API request with `min_age_months: 0`, When it is posted, Then it is rejected.
06.9 Given a level export followed by re-import of the same file unchanged, When the import completes, Then no level's age range has changed.
06.10 Given an Excel import row with a maximum age of 85, When it is imported, Then it is accepted without a validation error.
06.11 Given the senior seed level (60–100) and a seeded student aged 84, When eligibility is checked, Then the student is eligible and appears in level filters.
06.12 Given a student who turns 4 the day after a season starts and a level with minimum 4 years, When eligibility is evaluated, Then the result is consistent with the decided evaluation date and identical in the UI and the import path.

### Acceptance criteria

1. Minimum age is **stored in months** (integer); existing year values are migrated as `years × 12`.
2. The picker offers `1 month … 11 months`, then `1 year`, `2 years`, … — i.e. months only below 12.
3. Display follows the same rule: `6 meses` / `6 months`, `1 ano` / `1 year`, `3 anos` / `3 years`. Singular/plural handled by i18n.
4. Eligibility checks (can this student join this level/class?) compare in months.
5. Any export/import column for minimum age uses the same representation as the UI.
6. **Maximum age** uses the same field type and picker, and its ceiling is raised from 30 to **100** — Poolse runs classes for older adults, and a level capped at 30 silently makes them ineligible.
7. Validation: maximum age must be greater than minimum age; both accept the full 1 month … 100 years range.
8. Any seeded/demo data includes at least one senior level (e.g. *Hidroginástica Sénior*, 60–100) so the range is exercised, and a few students aged 60+.

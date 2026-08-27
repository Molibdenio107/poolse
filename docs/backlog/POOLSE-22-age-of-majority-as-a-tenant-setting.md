# POOLSE-22 · Age of majority as a tenant setting

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Settings / Students · **Priority:** Medium — cheap now, migration later
**Borrowed from:** Pike13 (age of majority as a business setting that drives which waiver is presented).

### PO — why this exists

Eighteen is hardcoded in the guardian logic and in the copy around it. It is correct for Portugal today and wrong the first time Poolse sells anywhere else, or the first time a school wants guardian consent up to 16 for its own reasons. Owners get a setting; developers get one place to read instead of a scattered constant. Medium priority purely because it is a one-line read now and a data migration later.

**Not in scope:** changing the default from 18; the consent form content itself; the age brackets on the avatar badge (POOLSE-33), which are a display device, not a legal boundary.

### BA — rules and data

- `maioridade` is a per-tenant integer, default 18. Sensible bounds are needed — reject 0 and anything above the maximum age ceiling of 100 (POOLSE-16).
- Every consumer reads the setting: POOLSE-04's guardian block trigger, the consent/terms selection at enrolment, and any copy that currently says "under 18".
- Consent selection: below the threshold the guardian-signed form is presented; at or above it the self-signed form (POOLSE-23 AC 2).
- Age comparison uses the same months-based age computation as POOLSE-06, so a tenant setting of 18 means 216 months and a student one day short is still a minor.
- Changing the setting **re-evaluates** which students currently require a guardian and produces a report of the affected list. It never deletes a guardian link — POOLSE-04 AC 8 already establishes that links are retained when a student ages past the boundary.
- Lowering the threshold makes some minors adults: their guardian block collapses to optional, links are kept, and they appear on the report. Raising it makes some adults minors: they appear on the report as **missing a guardian**, but existing enrolments are not blocked retroactively.
- Consent already signed under the old threshold stays valid. Re-consent is not triggered by a setting change; if a school wants it, that is an explicit action.
- **Conflict to note:** POOLSE-33 fixes the *Jovem* bracket at 12–17 and *Adulto* at 18–59, and POOLSE-33 AC 7 asks for boundaries shared with the age logic. A tenant with maioridade ≠ 18 will have a badge that disagrees with the guardian rule. The badge is cosmetic and the source doc does not resolve this; treat the brackets as display-only and independent of maioridade unless told otherwise.
- Copy rule: no string anywhere contains the literal "18". Strings interpolate the setting via i18n, in both pt-PT and en, with correct pluralisation.

### Dev — implementation notes

- Migration: add `maioridade` (integer, default 18, not null) to the tenant settings table. Backfill 18 for every existing tenant.
- One shared helper — `isMinor(person, tenantSettings)` — replaces every hardcoded comparison. Grep for the literal 18 across the students, enrolment and consent code before closing this ticket; that sweep *is* the ticket.
- API: settings read is available to any authenticated user of the tenant (the guardian block needs it client-side); write is Owner/Admin only, enforced server-side with `403` for everyone else.
- The re-evaluation report is computed on save, in a transaction with the setting change, and returned to the caller — not generated as a background job whose result nobody sees.
- Where the client needs the threshold to render the guardian block live as a date of birth is typed (POOLSE-04 AC 7), it comes from the same settings payload the page already loads, not a separate fetch per keystroke.
- i18n: strings become parameterised — `"Menor de {{age}} anos"` / `"Under {{age}}"` — with pt-PT and en both carrying the parameter. Anything with a baked-in numeral fails review.
- Most likely to be got wrong: leaving the threshold enforced only client-side, so a crafted enrolment request presents the self-signed consent form for a 15-year-old.

### QA — test scenarios

22.1 Given a tenant with maioridade 18 / When a student aged 17 is opened / Then the guardian block appears; and at 18 it collapses to optional.
22.2 Given the tenant sets maioridade to 16 / When the setting is saved / Then a report lists every 16- and 17-year-old whose guardian requirement changed, and no guardian link is deleted.
22.3 Given the tenant raises maioridade to 21 / When the setting is saved / Then 18–20-year-olds appear on the report as missing a guardian, and their existing enrolments remain active.
22.4 Given an Instructor token / When it PATCHes the maioridade setting / Then `403` and the value is unchanged.
22.5 Given a student one day short of the threshold / When they enrol / Then the guardian-signed consent form is presented, not the self-signed one.
22.6 Given a crafted enrolment request for a 15-year-old asserting self-signed consent / When the API receives it / Then it is rejected server-side.
22.7 Given maioridade set to 0 or 101 / When saved / Then validation rejects it with an inline message.
22.8 Given the pt-PT locale and maioridade 16 / When the guardian block heading renders / Then it reads "menor de 16 anos" with correct pluralisation; in en it reads "under 16".
22.9 Given the en locale / When maioridade is 1 / Then the singular form is used, not "1 years".
22.10 Given a student whose consent was signed under a threshold of 18 / When the tenant changes it to 21 / Then the existing consent is not invalidated and no re-consent prompt fires.
22.11 Given the date of birth is edited across the threshold in a form session / When the block shows and hides / Then entered data is not lost, and the threshold used is the tenant's, not 18.
22.12 Given light and dark mode / When the affected-students report renders / Then the changed-requirement indicator is readable by text alone in both.

### Acceptance criteria

1. `maioridade` is a per-tenant integer, defaulting to **18**.
2. POOLSE-04's guardian block triggers off this value rather than a hardcoded 18.
3. The same value selects which consent/terms form is presented at enrolment — guardian-signed below it, self-signed at or above it.
4. Changing the setting re-evaluates which students currently require a guardian and reports the affected list; it never silently deletes guardian links.
5. Anywhere the UI says "under 18", the text is generated from the setting via i18n, not written into the string.

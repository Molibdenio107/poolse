# POOLSE-32 · Names read first name + surname

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Global · **Priority:** Medium
**Depends on:** POOLSE-17 (one Person record holding the name parts), POOLSE-30 (search must match any part of the name)

### PO — why this exists

"Silva, Maria" is filing-cabinet notation; nobody says it out loud, and staff reading a roster have to mentally re-order every row. Portuguese full names also run to five or six parts, so printing the whole thing in a turma card breaks the layout. Everyone reading a list benefits — instructors most, since they read rosters at the poolside on a small screen. Medium: it is a readability fix across the app, not a defect.

**Not in scope:** changing how names are captured or stored (the name-part fields themselves), nicknames or preferred names, and any transliteration or normalisation of stored name parts.

### BA — rules and data

- Three separate concerns, decided independently and never conflated: **display order** (first name before surname, everywhere), **list abbreviation** (first name + last surname only, in dense surfaces), and **sort order** (by surname).
- Display order: "Maria Silva". The "Apelido, Nome" form is removed from every surface, including sorted lists where it was previously used as a sorting cue.
- Abbreviation applies in lists, cards, turma rosters and the calendar: first given name + **last** surname. "Maria Joana Ferreira Silva Santos" renders "Maria Santos".
- Full legal name — every stored part in order — is used on the person's detail page and on every document, export, invoice and official output. No abbreviation ever reaches a document.
- Both forms are derived at render time from stored name parts. The abbreviated form is never persisted as its own editable field.
- Sorting is by surname (the sort key), while display is first-name-first. **Open:** which surname sorts — the last part, or the first surname after the given names? Portuguese convention often files under the paternal (final) surname, but the doc says only "by surname". Needs one decided rule, applied in one place.
- Search matches any part of the name (POOLSE-30), so a surname query finds the person even when the surname is not in the abbreviated display form.
- The rule applies uniformly to students, staff and encarregados de educação — one helper, one behaviour, no per-section variation.
- Boundary cases needing a decided answer: a single-part name ("Madonna") — display and abbreviation both return the one part, and it sorts as its own surname; a two-part name is already the abbreviated form; particles ("de", "da", "dos", "e") that belong to a compound surname must not be returned alone as the "last surname" — "Maria da Silva" must abbreviate to "Maria da Silva" or "Maria Silva", not "Maria da". **Open:** which of those two.
- Conflict to resolve: POOLSE-08 AC 5 says turma student names are "ordered alphabetically" without saying by what; under this ticket that must mean by surname, matching AC 5 here, or two lists of the same people will sort differently.

### Dev — implementation notes

- Schema: requires the Person name to exist as parts (given names, surnames), not a single `name` string. If the current model stores one string, this ticket needs a migration that splits it, with a report of rows it could not split confidently — that is the real cost of this ticket, not the rendering.
- One shared module exports three pure functions — `displayName(person)`, `shortName(person)`, `sortKey(person)` — used by web, API-side exports and any PDF/invoice generation. Per-page string juggling is how "Silva, Maria" survives in one forgotten export.
- Sorting must happen in the database, on a stored or generated sort key column with an index, not in JS — POOLSE-29 paginates server-side, so a client-side sort would only order the visible 15.
- Sorting must be locale-aware and diacritic-correct: use a Portuguese collation (`pt-PT` ICU collation) so "Álvares" files with "Alvares" rather than after "Zé". A `lower()` sort key alone is not enough.
- API surface: list endpoints return the name parts plus the precomputed short and full forms, so the client never re-derives them differently from the server. Exports and invoices call the same helper server-side.
- Permission enforcement is unchanged by this ticket. The one thing to verify is that the full legal name on a detail page is not exposed to a role that can only see the abbreviated list form — check the field set returned by each endpoint, not the rendered page.
- i18n and theming: name rendering must not be templated into a translated string with a fixed order — the helper returns the composed name and the i18n layer interpolates it as one token. Text length changes when abbreviation applies, so re-check truncation and ellipsis in narrow columns in both themes.
- Most likely to be got wrong: assuming the last whitespace-delimited token is the surname. Particles, hyphenated surnames and single-part names all break that assumption, and the failure is silent and embarrassing on a roster.

### QA — test scenarios

- **32.1** Given a student "Maria Joana Ferreira Silva Santos" / When the Alunos list renders / Then the row reads "Maria Santos" and never "Santos, Maria".
- **32.2** Given the same student / When her detail page opens / Then the full legal name "Maria Joana Ferreira Silva Santos" is shown in full.
- **32.3** Given the same student / When an invoice, an export and a PDF document are generated / Then all three carry the full legal name, not the abbreviation.
- **32.4** Given a list of students / When sorted by name / Then the order follows the surname while every row displays first name first — and the order is stable across pages 1 and 2 of POOLSE-29.
- **32.5** Given a person with a single-part name "Madonna" / When lists, cards and the detail page render / Then the one part is shown in all three and sorting places it under M without error.
- **32.6** Given "Maria da Silva" / When the abbreviated form is produced / Then the particle is not orphaned — the result is never "Maria da".
- **32.7** Given "Álvares" and "Alvares" and "Zé" / When the list is sorted / Then Portuguese collation places the accented and unaccented forms together, ahead of Z.
- **32.8** Given a search for "Ferreira", a middle surname absent from the displayed short name / When it is typed / Then "Maria Santos" is returned (POOLSE-30 AC 7 and this ticket's AC 6).
- **32.9** Given a member of staff and an encarregado de educação with long names / When Pessoas and the student's guardian block render / Then both follow the same abbreviation rule as students.
- **32.10** Given a caller requesting a list endpoint directly / When the response is inspected / Then no role receives a full legal name in a list payload it is not entitled to see on the detail page.
- **32.11** Given locale pt-PT and en / When a name renders in a list, a card and a heading / Then the name order is identical in both and no translated string encodes the order.
- **32.12** Given a very long compound name in the narrowest turma roster column, in light and in dark mode / When it renders / Then it truncates with an ellipsis and a title/tooltip rather than wrapping or overflowing, and stays contrast-compliant.
- **32.13** Given a hyphenated surname "Ana Costa-Ribeiro" / When the short name is derived / Then the hyphenated surname is kept whole, not split at the hyphen.

### Acceptance criteria

1. Names render as **first name + surname** — "Maria Silva", never "Silva, Maria".
2. In **lists, cards, turma rosters and the calendar**, the display name is the **first name plus the last surname** — Portuguese full names are long and would break every layout.
3. The **full legal name** is shown on the person's detail page, and used on every document, export, invoice and official output.
4. Both forms are derived from stored name parts; the abbreviated form is never stored as a separate editable field that can drift.
5. Sorting is by **surname** even though display is first-name-first — the order people read and the order they scan a list by are different things.
6. Search matches any part of the name (POOLSE-30), so typing a surname still finds the person.
7. Applies to students, staff and encarregados de educação alike.

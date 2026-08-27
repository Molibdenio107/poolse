# POOLSE-18 · Role colour scheme in the People section

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** People · **Priority:** Low
**Depends on:** POOLSE-17 (a Person can hold several roles), POOLSE-35 (Pessoas is staff-only)

> **Amended 27 Aug** — Pessoas is now staff-only (POOLSE-35). Staff badges appear there; Student and
> Encarregado de Educação badges appear in the Alunos section. Same token set, two places.

### PO — why this exists

Once one Person can hold several roles, a list of names tells you nothing about who is what. A distinct colour per role badge makes Pessoas and Alunos scannable — you find the instructors without reading. Low priority because it is presentation on top of POOLSE-17's real work, but doing it as tokens now stops six components inventing six greens later.

**Not in scope:** which people appear in Pessoas versus Alunos (POOLSE-35), and any change to what the roles mean or who may grant them.

### BA — rules and data

- Six distinct colour tokens, one per role: Owner, Admin, Instructor, Student, Encarregado de Educação, Maintenance (AC1).
- Colour applies to the role badge or chip only. Rows, avatars and text stay neutral (AC2) — a coloured row would collide with selection and hover states.
- A Person holding several roles shows several badges, ordered by seniority: Owner → Admin → Instructor → Maintenance → EE → Student (AC3). This is the same ordering POOLSE-17's "strongest role held" should use.
- Badges always carry the role name as text; colour never carries the meaning alone (AC4).
- Contrast-checked in light and dark mode, and the palette stays clear of the attendance colours in POOLSE-13 so red and orange never read as an attendance state (AC5). It should also stay clear of POOLSE-20's four skill-state colours for the same reason.
- Tokens are reused everywhere a role is displayed — filters, detail header, invite dialog — never redefined per component (AC6).
- Per the amendment: staff badges (Owner, Admin, Instructor, Maintenance) render in Pessoas; Student and Encarregado de Educação badges render in Alunos. One token set, two locations.
- Edge case: a Person holding both a staff role and a student role appears in both sections (POOLSE-35 AC4). **Open:** whether each section shows only the badges relevant to it, or all of the Person's badges. The amendment says where each badge appears, which reads as scoped-to-section, but the detail header is one profile — decide once so the list and the profile do not disagree.
- Edge case: a Person with four or more roles in a narrow list column — the badge row must wrap or overflow predictably rather than pushing the name out of view.

### Dev — implementation notes

- No schema change. Six semantic colour tokens per role, each with surface, foreground and border values defined for light and dark, alongside the attendance tokens from POOLSE-13 so the clash is visible at definition time rather than in review.
- One `RoleBadge` component takes a role and renders token plus translated name together; there is no prop that renders the colour without the label, which is how AC4 is enforced structurally.
- A `RoleBadgeList` handles the seniority ordering in one place, taking the Person's role set and sorting it — no call site sorts its own. The same seniority constant feeds POOLSE-17's `strongestRole()`.
- Consume the badge in the People list, the Alunos list, the profile header, filter chips and the invite dialog; grep for any hand-rolled role pill and delete it (AC6).
- Ordering must be stable and deterministic for a Person whose roles were granted in any order — sort by the seniority constant, never by grant date or by the array's incidental order.
- i18n: role names come from the shared role keys used by POOLSE-01 and POOLSE-17, in pt-PT and en, so a role is never spelled two ways in one app.
- Theming: verify all six tokens against both surfaces with a contrast tool, and confirm all six are distinguishable in a greyscale render — if two are not, the text label is doing all the work and the palette needs adjusting.
- Performance: badges render in paginated lists of 15 rows (POOLSE-29) with up to six badges each — keep the component pure and free of per-render token lookups.
- Most likely to get wrong: picking a red for Owner or an orange for Admin, so a People list reads like an attendance grid. AC5 names this explicitly; choose the role palette against the attendance and skill palettes side by side.

### QA — test scenarios

18.1 Given a Person holding one role / When they appear in a list / Then a single badge renders in that role's colour with the role name as text.
18.2 Given a Person holding Owner, Instructor and Student / When their badges render / Then they appear in the order Owner, Instructor, Student.
18.3 Given a Person whose roles were granted in reverse seniority order / When their badges render / Then the display order is unchanged — sorting is by seniority, not by grant order.
18.4 Given the Pessoas section / When a staff member is listed / Then their staff badges appear; given the Alunos section, Student and EE badges appear per the amendment.
18.5 Given a Person who is both staff and a student / When they appear in both sections / Then the badge display matches the documented decision on the open question, consistently in list and profile.
18.6 Given the People list / When a row is inspected / Then the row background, avatar and name text are neutral — only the badge is coloured (AC2).
18.7 Given light mode then dark mode / When all six role badges are displayed together / Then every one passes contrast and all six are distinguishable from each other.
18.8 Given a greyscale render / When all six badges are shown / Then each is identifiable from its text label alone.
18.9 Given the attendance palette from POOLSE-13 on screen at the same time / When role badges render / Then no role badge reads as an attendance state — no shared red or orange.
18.10 Given locale pt-PT then en / When badges render / Then "Encarregado de Educação" and "Guardian"/"Encarregado de Educação" render from the shared role keys with no untranslated values.
18.11 Given a Person with six roles in a narrow viewport / When the row renders / Then badges wrap or truncate predictably and the person's name stays visible.
18.12 Given the invite dialog, a filter chip and the profile header / When each shows a role / Then all three use the same token — none declares its own colour (AC6).
18.13 Given a Student user / When they attempt to read the People list via the API / Then the permission rules apply as before — this ticket changes presentation only and grants nothing.

### Acceptance criteria

1. Every role has a distinct colour token: Owner, Admin, Instructor, Student, Encarregado de Educação, Maintenance.
2. Colour is applied to the **role badge/chip only** — rows, avatars and text stay neutral.
3. A Person holding several roles shows several badges, ordered by seniority (Owner → Admin → Instructor → Maintenance → EE → Student).
4. Badges always carry the role name as text; colour never carries the meaning alone.
5. Contrast-checked in light and dark mode; the palette stays clear of the attendance colours (POOLSE-13) so red/orange do not read as a state.
6. Colours are design tokens reused anywhere a role is displayed — filters, detail header, invite dialog — not redefined per component.

# POOLSE-13 · Attendance states: colour scheme, drop the static "Atrasado"

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Students / Presenças · **Priority:** Medium

### PO — why this exists

Attendance has three real states and a fourth, "Atrasado", that nobody uses meaningfully — a student who arrives late still swam. Keeping it forces instructors to make a judgement call poolside and pollutes every report with a state that answers no question. This ticket removes late arrival as a concept and gives the three surviving states a colour scheme that is scannable at a glance in a grid. Medium priority: it is a data-model change with a migration, and POOLSE-21's reposição credits are built on *falta justificada*, so the state set needs to be final before that lands.

**Not in scope:** minting credits from a justified absence (POOLSE-21), and any change to how attendance is taken or who may take it.

### BA — rules and data

- Surviving states: **Presente**, **Faltou**, **Falta justificada**. Colours: Presente keeps its current colour, Faltou soft red, Falta justificada soft orange.
- "Atrasado" is removed as a concept, not as a label (AC6). Late arrival is not recorded anywhere after this ships, and a late student is simply *Presente*.
- Migration: every existing record stored as Atrasado becomes *Presente*, and the enum value is dropped so it can never be set again (AC7). Dropping the value is what makes the removal permanent — a retained-but-hidden value drifts back.
- Every filter, report column, chart series and export field referencing the late state is removed (AC8), including saved filters and any dashboard tile.
- Colour is always paired with a text label or icon; the state must be readable without colour (AC3) — this is the same rule as everywhere else in the product.
- A legend appears wherever multiple states are shown together, i.e. list and grid views (AC4); a single-state chip on a detail row does not need one.
- Colours are design tokens, defined once and reused in attendance summaries and reports (AC5) — not re-declared per component.
- Palette conflict to respect: POOLSE-18's role badges must stay clear of these red/orange values, and POOLSE-20's four skill states must be distinct from both. The attendance tokens are the senior claim on red and orange.
- **Open:** whether historic exports and previously generated reports that already contain the string "Atrasado" are reissued or left as they are; the ticket only covers live filters, columns and fields.
- Edge case: a record migrated from Atrasado to Presente is indistinguishable afterwards from one entered as Presente. If audit needs to know it was migrated, that fact must live in the audit/migration report, not in the attendance state.

### Dev — implementation notes

- Migration in two steps in one release: `UPDATE` all Atrasado rows to Presente, then drop the enum value (Postgres requires recreating the type or a check-constraint swap — plan for the table lock and the ordering, and make the update idempotent so a re-run is safe).
- Write the migration report: how many rows changed, per tenant. Multi-tenant means "no Atrasado rows exist" is a per-tenant claim, not a global one — scope the update and the count by tenant key.
- Search the whole codebase for the late state before dropping it: enum references, filter option lists, report column definitions, chart series keys, export column headers, seed data and fixtures. A dropped enum value with a live reference is a runtime error, not a type error, if any of these are string-typed.
- Define three colour tokens (surface, foreground, border per state) in the theme layer with light and dark values, and consume them from a single `AttendanceStateBadge` component. No component may reach for a raw colour.
- The badge renders colour + label (and optionally an icon) as one unit, so there is no way to render the colour without the text — this is how AC3 is enforced structurally.
- i18n: Presente / Faltou / Falta justificada as keys in pt-PT and en, reused by the legend, the filters and the exports.
- Performance: attendance grids render many badges at once — keep the badge cheap and pure, and do not compute token lookups per cell.
- Most likely to get wrong: treating this as a colour change and leaving the enum value in place "just in case". AC7 is explicit — if the value survives, some legacy code path will keep writing it and POOLSE-21's credit rule will inherit an undefined state.

### QA — test scenarios

13.1 Given an attendance grid with all three states present / When it renders / Then each state shows its specified colour together with its text label.
13.2 Given the app after migration / When any attendance UI is opened / Then no "Atrasado"/"Late" label, option or column appears anywhere.
13.3 Given a tenant with pre-existing Atrasado records / When the migration runs / Then every one of them reads *Presente* afterwards and the migration report states the count for that tenant.
13.4 Given the migration has already run / When it is run a second time / Then it completes without error and changes nothing.
13.5 Given a crafted API request setting attendance to the old late value / When it is submitted / Then it is rejected — the value no longer exists in the enum.
13.6 Given a list view with mixed states / When it renders / Then a legend is present; given a detail view with one state, no legend is required.
13.7 Given dark mode / When the three states render / Then soft red and soft orange pass contrast and remain distinguishable from each other; repeat in light mode.
13.8 Given a greyscale or colour-blind simulation / When the grid renders / Then the three states are still tellable apart by label or icon.
13.9 Given locale pt-PT then en / When the legend and filters render / Then "Falta justificada" / "Excused absence" appear correctly with no untranslated keys.
13.10 Given an attendance export / When it is generated / Then no column or value references the late state, and the three states export with their i18n labels.
13.11 Given a saved filter or dashboard tile created before this change that filtered on Atrasado / When it is opened after the migration / Then it degrades to a valid state rather than erroring or returning nothing silently.
13.12 Given an attendance summary or report component / When inspected / Then it consumes the shared state tokens rather than declaring its own colours (AC5).
13.13 Given a student marked *Falta justificada* / When POOLSE-21 is later enabled / Then that state is the one the credit rule reads — no orphaned late state in the path.

### Acceptance criteria

1. The static "Atrasado"/"Late" label is removed from the attendance UI.
2. The three states render with the colours above, in both light and dark mode, contrast-checked.
3. Colour is paired with a text label or icon — the state must be readable without relying on colour (colour-blind users).
4. A legend is shown where multiple states appear together (list/grid view).
5. Colours are defined as design tokens, reused in any attendance summary/report, not re-declared per component.

6. "Atrasado" disappears as a **concept**, not just as a label — late arrival is no longer recorded anywhere. A student who arrives late is simply *Presente*.
7. Any existing records currently stored as "Atrasado" are migrated to *Presente*; the enum value is dropped so it cannot be set again.
8. Remove any filter, report column, chart series or export field that referenced the late state.

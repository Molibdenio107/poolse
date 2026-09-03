# Backlog conventions

Standing rules for every ticket in `docs/backlog/`. They are **not** repeated in each ticket — treat
them as acceptance criteria on all work, and as the first thing to check in a QA pass.

- **Server-side enforcement.** Every permission rule is enforced in the API. Hiding a control is a UX detail, never the control. Every ticket that touches permissions gets at least one denial test issued directly against the endpoint.
- **Tenant scoping.** Every tenant table carries the tenant key and every query is scoped. Any new endpoint gets a cross-tenant access test.
- **i18n.** Every user-facing string goes through the translation layer (pt-PT + en) as it is written. No string is assembled by concatenation; plurals, dates and currency come from the locale.
- **Light and dark.** Every visual change is checked in both themes and contrast-verified. Colour never carries meaning alone — always paired with text, icon or shape.
- **Design tokens.** Four colour systems exist and must stay visually distinct from one another:
  - attendance states — POOLSE-13
  - role badges — POOLSE-18
  - age brackets — POOLSE-33
  - certification status — POOLSE-27
- **Audit.** Anything destructive, permission-sensitive or GDPR-relevant records actor, subject and timestamp.
- **Soft delete.** History is never destroyed. Removals hide; they do not erase.
- **Excel import parity.** Any field added to a form is considered for the import/export mapping in the same ticket, not later.
- **Lists are paginated at 15, and the exemptions are written down** — POOLSE-29. See below.

## Which lists paginate, and which do not

One rule, so a new list answers this without a meeting:

> **A list is exempt only if its length is fixed by the data model or by a fixed window.
> Anything whose length grows as the club takes on more people is paginated.**

Page size is `PAGE_SIZE` — 15 — in `apps/api/src/common/pagination.ts` and
`apps/web/src/lib/pagination.ts`. The control hides itself when everything fits, so an
exempt list and a short list look identical to a reader; the difference is whether the
query carries a window.

**Paginated** — these grow with the club:

| Surface | Endpoint |
|---|---|
| Alunos, the register | `GET /students` |
| Encarregados de educação | `GET /guardians` |
| Staff | `GET /people` |
| Duplicados | `GET /people/merge-report` |
| Férias, the approval queue | `GET /vacations/pending` |

**Exempt, and why.** Each of these has a reason that is about the data, never about the
work being awkward:

| Surface | Bounded by |
|---|---|
| Encerramentos and Férias year grids | Twelve months. A year does not get longer. |
| The turmas week grid (`GET /class-groups`) | A week. Paging it would empty Tuesday, not shorten the page — the reader would see a gap where a turma runs. |
| The lane grid (`GET /facilities/:id/grid`) | One week of one season, at one site — POOLSE-49, criterion 14. A fixed window in both directions: the slots belong to the building and the lanes to the pool, and paging either would hide a lane that is in use. It still *asks* for a fixed window, which is what `seasonId` is for. |
| A turma's roster, a class register | The turma's own capacity, which the club sets. |
| One child's timetable, one person's leave year | One person, one year. |
| Níveis, épocas, instalações, pools | A handful, by nature. Adding the tenth level is a decision, not growth. |
| Roles, consent kinds, timezones, strokes | Enums. They change when a developer changes them. |
| The weather forecast | Seven days, from the provider. |
| Pending invitations | A queue worked down, not a register kept. Paging it would hide the invite somebody came to chase. |
| Ownership-transfer candidates | Every admin — a picker must be complete, or it tells the owner their colleague is not an admin. |
| A form's dropdown options | Everything the form can express. A half-filled `<select>` is a form that silently cannot say what somebody means. |
| One student's record history | One swimmer's career, and the chart above it needs every point. |
| A partner's groups, contacts and its Horário panel | One partnership. A school has as many classes as it has classes, and paging them would hide 6B from somebody looking for it — POOLSE-47, criterion 11. The **partner list itself is paginated**: that one grows as the club sells more water. |

**An exemption is about the control, never about the fetch.** Encerramentos is exempt from
paging and still takes `?year`: the grid shows one year, so the query returns one year. A
surface that renders a fixed window must *ask* for a fixed window.

**Never filter after paging.** Scope, role, search and sort belong in the same statement as
`LIMIT`. Filtering the page instead of the set gives page 2 fewer rows than page 1 and a
total that counts rows the reader cannot see — which reads as records going missing.

## Definition of done

A ticket is done when all of the following are true:

1. Every numbered acceptance criterion in the ticket is met.
2. The QA scenarios in the ticket pass, including the negative and permission ones.
3. The conventions above hold for the code touched.
4. Any `**Open:**` question in the ticket is either answered in the ticket or explicitly deferred with a note saying so.
5. Strings exist in both pt-PT and en.
6. The change was looked at in light and dark mode, if it is visual.

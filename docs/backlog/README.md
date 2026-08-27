# Poolse backlog

36 tickets, one file each. Every ticket carries four views of the same work — **PO** (why it exists,
what is out of scope), **BA** (rules, data, edge cases), **Dev** (schema, API, what gets got wrong)
and **QA** (numbered Given/When/Then scenarios) — followed by the original acceptance criteria,
which are the contract.

Read these first, once:

- **[CONVENTIONS.md](./CONVENTIONS.md)** — standing rules that apply to every ticket, and the definition of done.
- **[CONFLICTS.md](./CONFLICTS.md)** — 8 contradictions between tickets, each with a recommended resolution. Settle these before writing code they touch.
- **[BUILD-ORDER.md](./BUILD-ORDER.md)** — what to build in what order, and how one evening's session runs.

## How to use this in a build session

Load **one ticket file** plus `CONVENTIONS.md`. Never load the whole folder — that is the point of
splitting it. The ticket file is self-contained: the Dev section tells you where the logic goes, and
the QA section is your test list, already written.

## Index

36 tickets · 12 at High priority · 52 open questions still to answer

| Ticket | Title | Area | Priority | Depends on | Open |
|---|---|---|---|---|---|
| [POOLSE-01](./POOLSE-01-invitation-permissions-by-role.md) | Invitation permissions by role | Backoffice / Auth | High | POOLSE-17 (roles are assignments on a Person; the ma… | 3 |
| [POOLSE-02](./POOLSE-02-week-calendar-show-the-full-week-range-centred.md) | Week calendar: show the full week range, centred | Calendar | Medium | — | 1 |
| [POOLSE-03](./POOLSE-03-archive-button-restricted-to-owner-and-admin.md) | Archive button restricted to Owner and Admin | Global | High | — | 2 |
| [POOLSE-04](./POOLSE-04-guardian-block-for-students-under-18.md) | Guardian block for students under 18 | Students | High | POOLSE-17 (one Person, many roles) | 3 |
| [POOLSE-05](./POOLSE-05-levels-ordering-via-drag-and-drop.md) | Levels ordering via drag and drop | Levels / Settings | Medium | — | 3 |
| [POOLSE-06](./POOLSE-06-minimum-age-must-support-months-under-1-year.md) | Minimum age must support months under 1 year | Levels / Classes | Medium | — | 2 |
| [POOLSE-07](./POOLSE-07-reset-season-owner-admin-only.md) | Reset season (Owner/Admin only) | Seasons | Medium | — | 2 |
| [POOLSE-08](./POOLSE-08-turmas-list-student-names.md) | Turmas: list student names | Classes (Turmas) | Low | — | 2 |
| [POOLSE-09](./POOLSE-09-invite-form-must-not-clear-the-email-field-on-validation-err.md) | Invite form must not clear the email field on validation error | Backoffice / Invitations | High | POOLSE-01 (the same dialog gains a role-permission d… | 2 |
| [POOLSE-10](./POOLSE-10-favourite-swimming-style-resets-to-unselected-after-save.md) | Favourite swimming style resets to unselected after save | Students / Widgets | Medium | — | 2 |
| [POOLSE-11](./POOLSE-11-student-photo-cartao-de-cidadao-upload.md) | Student photo + Cartão de Cidadão upload | Students / Mobile app | Medium | POOLSE-17 (the document belongs to the Person, not t… | 1 |
| [POOLSE-12](./POOLSE-12-colourful-weather-icons-in-installation-details.md) | Colourful weather icons in installation details | Installations / Weather | Low | — | — |
| [POOLSE-13](./POOLSE-13-attendance-states-colour-scheme-drop-the-static-atrasado.md) | Attendance states: colour scheme, drop the static "Atrasado" | Students / Presenças | Medium | — | 1 |
| [POOLSE-14](./POOLSE-14-remove-classes-from-the-calendar.md) | Remove classes from the Calendar | Calendar | High | — | — |
| [POOLSE-15](./POOLSE-15-turma-hover-card-with-full-student-list.md) | Turma hover card with full student list | Classes (Turmas) | Medium | POOLSE-08 (names in the card, collapsed after 8) | 1 |
| [POOLSE-16](./POOLSE-16-raise-level-maximum-age-to-100-senior-demo-data.md) | Raise level maximum age to 100 + senior demo data | Levels | High | — | 1 |
| [POOLSE-17](./POOLSE-17-one-person-many-roles.md) | One Person, many roles | People / Data model | High — blocks POOLSE-04 | — | 3 |
| [POOLSE-18](./POOLSE-18-role-colour-scheme-in-the-people-section.md) | Role colour scheme in the People section | People | Low | POOLSE-17 (a Person can hold several roles), POOLSE-… | 1 |
| [POOLSE-19](./POOLSE-19-automatic-level-advancement.md) | Automatic level advancement | Levels / Turmas | High — the differentiator | POOLSE-20 (skill states), POOLSE-05 (level ordering … | 2 |
| [POOLSE-20](./POOLSE-20-four-state-skill-progress.md) | Four-state skill progress | Levels / Skills | High | — | 1 |
| [POOLSE-21](./POOLSE-21-aula-de-reposicao-as-a-credit-object.md) | Aula de reposição as a credit object | Calendar / Attendance | Medium | — | 1 |
| [POOLSE-22](./POOLSE-22-age-of-majority-as-a-tenant-setting.md) | Age of majority as a tenant setting | Settings / Students | Medium — cheap now, migration later | — | — |
| [POOLSE-23](./POOLSE-23-adult-and-senior-enrolment-path.md) | Adult and senior enrolment path | Students / Enrolment | Medium | — | 1 |
| [POOLSE-24](./POOLSE-24-mensalidade-plan-visible-at-the-price.md) | Mensalidade plan visible at the price | Billing / Enrolment | Medium | — | 1 |
| [POOLSE-25](./POOLSE-25-self-cure-for-failed-debito-direto.md) | Self-cure for failed débito direto | Billing | High once collections go live | — | 1 |
| [POOLSE-26](./POOLSE-26-missing-reading-alert.md) | Missing-reading alert | Maintenance | Medium | — | — |
| [POOLSE-27](./POOLSE-27-certification-expiry-with-amber-window.md) | Certification expiry with amber window | People / Staff | Medium | — | — |
| [POOLSE-28](./POOLSE-28-heating-cost-per-lesson-hour.md) | Heating cost per lesson hour | Energy / Dashboards | Medium — the strongest argument for the four-module product | — | 1 |
| [POOLSE-29](./POOLSE-29-paginate-lists-at-15-per-page.md) | Paginate lists at 15 per page | Global | Medium | — | 1 |
| [POOLSE-30](./POOLSE-30-search-filters-as-you-type.md) | Search filters as you type | Global | Medium | POOLSE-29 (search resets pagination to page 1) | 2 |
| [POOLSE-31](./POOLSE-31-encerramentos-page.md) | Encerramentos page | Settings / Calendar | High | POOLSE-13 (attendance states, for what a cancelled o… | 2 |
| [POOLSE-32](./POOLSE-32-names-read-first-name-surname.md) | Names read first name + surname | Global | Medium | POOLSE-17 (one Person record holding the name parts)… | 2 |
| [POOLSE-33](./POOLSE-33-age-bracket-icon-on-the-avatar.md) | Age-bracket icon on the avatar | Students | Low | POOLSE-06 and POOLSE-16 (shared age boundary logic),… | 2 |
| [POOLSE-34](./POOLSE-34-move-ferias-under-the-people-menu.md) | Move Férias under the People menu | Navigation | Low | POOLSE-35 (Pessoas becomes the staff section, which … | 2 |
| [POOLSE-35](./POOLSE-35-pessoas-is-staff-only-alunos-holds-the-rest.md) | Pessoas is staff only; Alunos holds the rest | Navigation / People | High | POOLSE-17 (one Person, many roles), POOLSE-18 (role … | 2 |
| [POOLSE-36](./POOLSE-36-menu-order-pessoas-below-instalacoes.md) | Menu order — Pessoas below Instalações | Navigation | Low | — | 1 |

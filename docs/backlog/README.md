# Poolse backlog

55 tickets, one file each. Every ticket carries four views of the same work — **PO** (why it
exists, what is out of scope), **BA** (rules, data, edge cases), **Dev** (schema, API, what gets got
wrong) and **QA** (numbered Given/When/Then scenarios) — followed by the original acceptance
criteria, which are the contract.

Read these first, once:

- **[CONVENTIONS.md](./CONVENTIONS.md)** — standing rules that apply to every ticket, and the definition of done.
- **[CONFLICTS.md](./CONFLICTS.md)** — contradictions between tickets, each with a recommended resolution. Settle these before writing code they touch.
- **[BUILD-ORDER.md](./BUILD-ORDER.md)** — what to build in what order, and how one evening's session runs.

## How to use this in a build session

Load **one ticket file** plus `CONVENTIONS.md`. Never load the whole folder — that is the point of
splitting it. The ticket file is self-contained: the Dev section says where the logic goes, and the
QA section is your test list, already written.

## Index

55 tickets · 24 at High priority · 51 open questions marked in the ticket files

POOLSE-43 … 55 are one feature — lane-level scheduling and parcerias. Read
[BUILD-ORDER.md](./BUILD-ORDER.md) before starting any of them: four decisions were taken
up front and the wave order inside them is not negotiable.

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
| [POOLSE-36](./POOLSE-36-menu-order-pessoas-below-instalacoes.md) | Menu order — Pessoas below Instalações *(superseded)* | Navigation | Low | — | 1 |
| [POOLSE-37](./POOLSE-37-instalacoes-as-the-landing-page.md) | Instalações as the landing page | Navigation / Auth | Medium | POOLSE-17 (roles are assignments on a Person) | 1 |
| [POOLSE-38](./POOLSE-38-staff-menu-nested-under-instalacoes.md) | Staff menu, nested under Instalações | Navigation | Medium | POOLSE-35 (the staff/students split) | 1 |
| [POOLSE-39](./POOLSE-39-editable-staff-record-immutable-email.md) | Editable staff record, immutable email | Staff | High | POOLSE-17 (one Person, many roles), POOLSE-01 (invit… | 2 |
| [POOLSE-40](./POOLSE-40-levels-and-skills-expanded-view.md) | Levels and skills — the expanded view | Levels / Skills | Medium | POOLSE-05 (drag-and-drop ordering), POOLSE-20 (four-… | 1 |
| [POOLSE-41](./POOLSE-41-shared-page-shell.md) | One page shell for every page | Global / Layout | Medium | — | 1 |
| [POOLSE-42](./POOLSE-42-mensalidade-quota-and-billing-periods.md) | Mensalidade, quota de sócio and billing periods | Billing / Enrolment | High | — | 1 |
| [POOLSE-43](./POOLSE-43-lanes-as-rows-on-a-pool.md) | Lanes as rows on a pool | Installations / Scheduling | High | — | — |
| [POOLSE-44](./POOLSE-44-facility-slot-grid.md) | The facility's slot grid | Installations / Scheduling | High | POOLSE-45 (slots belong to a season) | — |
| [POOLSE-45](./POOLSE-45-draft-seasons-and-duplication.md) | Draft seasons, and duplicar época | Seasons | High | — | 1 |
| [POOLSE-46](./POOLSE-46-bookings-subject-types-and-lanes.md) | Bookings: subject types, lanes and instructor status | Scheduling | High | POOLSE-43, 44, 45; POOLSE-47 (partner_group) | 1 |
| [POOLSE-47](./POOLSE-47-parcerias-partners-agreements-groups.md) | Parcerias: partners, agreements and groups | Installations / Partnerships | High | — | 2 |
| [POOLSE-48](./POOLSE-48-partner-import.md) | Importing partners and their groups | Partnerships / Import | Medium | POOLSE-47 | 1 |
| [POOLSE-49](./POOLSE-49-the-lane-grid.md) | The lane grid | Calendar / Scheduling | High | POOLSE-46 | — |
| [POOLSE-50](./POOLSE-50-dragging-on-the-lane-grid.md) | Dragging on the lane grid | Calendar / Scheduling | High | POOLSE-49 | — |
| [POOLSE-51](./POOLSE-51-conflict-rules.md) | Conflict rules on the lane grid | Scheduling / Data integrity | High | POOLSE-46, 50 | 1 |
| [POOLSE-52](./POOLSE-52-occupancy-and-season-summary.md) | Occupancy and the season summary | Scheduling / Reporting | Medium | POOLSE-46, 47 | — |
| [POOLSE-53](./POOLSE-53-sem-professor-alerts.md) | "Sem professor" alerts | Scheduling / Staff | High | POOLSE-46, 49 | 1 |
| [POOLSE-54](./POOLSE-54-exporting-the-grid.md) | Exporting the grid — PDF and Excel | Scheduling / Export | Medium | POOLSE-49, 52 | — |
| [POOLSE-55](./POOLSE-55-reference-schedule-seed.md) | The reference schedule as seed, and the verification pass | Scheduling / Seed data | High | all of 43–54 | — |

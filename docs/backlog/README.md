# Poolse backlog

71 tickets, one file each. Every ticket carries four views of the same work — **PO** (why it
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

71 tickets · 36 at High priority · 66 open questions marked in the ticket files

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
| [POOLSE-27](./POOLSE-27-certification-expiry-with-amber-window.md) | Certification expiry with amber window — brought forward as 7b.2 | People / Staff | High | — | 1 |
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
| [POOLSE-56](./POOLSE-56-a-full-slot-takes-no-more.md) | A full slot takes no more classes | Scheduling / Data integrity | High | POOLSE-51 | 1 |
| [POOLSE-57](./POOLSE-57-importing-the-wall-timetable.md) | Importing the wall timetable | Scheduling / Import | High | POOLSE-48, 51 | — |
| [POOLSE-58](./POOLSE-58-staff-salaries.md) | Staff salaries | Staff / Payroll | High — the next slice | — | — |
| [POOLSE-59](./POOLSE-59-importing-and-exporting-salaries.md) | Importing and exporting salaries | Staff / Payroll / Import | Medium | POOLSE-58 | — |
| [POOLSE-60](./POOLSE-60-one-plan-two-intervals.md) | One plan, two billing intervals | Billing / Subscription | High | POOLSE-58, 59 built; reverses 2.4's three plans | 1 |
| [POOLSE-61](./POOLSE-61-trial-lifecycle.md) | The trial lifecycle | Billing / Tenancy | High | POOLSE-60 | 1 |
| [POOLSE-62](./POOLSE-62-trial-abuse.md) | Trial abuse | Signup / Platform | Medium | POOLSE-61 | 2 |
| [POOLSE-63](./POOLSE-63-paid-outside-stripe.md) | Subscriptions paid outside Stripe | Platform / Billing | High | POOLSE-61 | 1 |
| [POOLSE-64](./POOLSE-64-hardening-admin.md) | Hardening `/admin` | Platform / Security | Medium | — | 1 |
| [POOLSE-65](./POOLSE-65-resource-kind-path-and-audit.md) | The resource-kind path, and the audit that prices it | Installations / Data model | Low | — | — |
| [POOLSE-66](./POOLSE-66-role-aware-dashboard.md) | Role-aware dashboard — a banded widget registry | Dashboard / Global | High | POOLSE-17 (one Person, many roles), POOLSE-52, 58 | — |
| [POOLSE-67](./POOLSE-67-messages-to-families.md) | Messages to a turma, a level, a site or the whole club | Communication | High | — (reuses notifier.ts, assignment.ts) | — |
| [POOLSE-68](./POOLSE-68-free-swim-passes-and-check-in.md) | Free swim, entry passes and reception check-in | Reception / Billing | High | 2.2 invoicing, POOLSE-46 | 2 |
| [POOLSE-69](./POOLSE-69-online-pre-registration.md) | Online pre-registration and trial lessons | Students / Public | Medium | POOLSE-17 | 2 |
| [POOLSE-70](./POOLSE-70-incident-log-and-duty-roster.md) | Bather incident log and lifeguard on duty | Safety / Compliance | High | POOLSE-27 (7b.2), slice 1.3 | 1 |
| [POOLSE-71](./POOLSE-71-public-water-quality-page.md) | A public water-quality page per tank | Maintenance / Public | High | slice 4.2 | 2 |
| [POOLSE-72](./POOLSE-72-national-water-reference-and-lab-grading.md) | The national water reference, and grading a lab result | Maintenance / Compliance | High | slice 4.2, POOLSE-71 | 0 |
| [POOLSE-73](./POOLSE-73-complaints-book-and-operating-regulation.md) | The complaints book and the operating regulation on every public page | Compliance / Public | Medium | POOLSE-69, POOLSE-71 | 0 |
| [POOLSE-78](./POOLSE-78-undo-and-the-archive-bin.md) | Undo, and a bin the owner can restore from | Global / Data integrity | High | — | 0 |
| [POOLSE-79](./POOLSE-79-support-access.md) | Support access | Platform / Security | High | POOLSE-78, POOLSE-64 | 0 |
| [POOLSE-80](./POOLSE-80-reverting-an-edit.md) | Reverting an edit | Global / Data integrity | Medium | POOLSE-78 | — |
| [POOLSE-81](./POOLSE-81-competition-pathway-and-meet-results.md) | The competition pathway, and meet results from a LENEX file | Students / Competition | High | B6, POOLSE-19, POOLSE-20 | 2 |
| [POOLSE-82](./POOLSE-82-app-enrolment-and-waiting-list-offers.md) | Enrolling from the app, and a waiting list that offers places | Students / Mobile app | High | 1.7, POOLSE-69, 3.0, 3.2 | 1 |
| [POOLSE-83](./POOLSE-83-paying-at-enrolment.md) | Paying at enrolment — checkout with a held place | Billing / Mobile app | High | POOLSE-82, 3.5, POOLSE-76 | 1 |
| [POOLSE-84](./POOLSE-84-closures-by-facility-and-tank.md) | Closures by facility or by tank, half days, and who is warned | Scheduling / Closures | High | POOLSE-31 | — |
| [POOLSE-85](./POOLSE-85-gap-to-qualify.md) | Gap to qualify — FPN age groups and entry times | Students / Competition | High | POOLSE-81 | 1 |
| [POOLSE-86](./POOLSE-86-email-delivery.md) | Email delivery — unsent notices, retries, invoice reminders, opt-outs | Notifications | High | notifier.ts (Resend) | — |
| [POOLSE-87](./POOLSE-87-modules-per-club.md) | Modules — switching parts of Poolse on and off per club, from `/admin` | Platform / Tenancy | High — blocks the pilot preview | POOLSE-63, 64, 66 | 1 |
| [POOLSE-88](./POOLSE-88-staff-on-the-phone.md) | Staff on the phone — installable app, the poolside flows, iPhone and Android | Global / Mobile web | High — blocks the pilot preview | POOLSE-87 | 1 |
| [POOLSE-89](./POOLSE-89-backups-and-a-tested-restore.md) | Backups, and a restore that is proved rather than hoped for — **built 28-10-2026**, switched on with production | Platform / Data | High — blocks the pilot preview | 0.10 to switch on | 0 |
| [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md) | The app — an agenda per role, "Vou / Não vou", and push | Mobile app / Notifications | High — blocks the pilot preview | POOLSE-88, 84, 86, 66 | 2 |
| [POOLSE-91](./POOLSE-91-back-returns-to-where-you-came-from.md) | Voltar always returns to where you came from | Global / Navigation | High | lib/back.ts | 1 |
| [POOLSE-92](./POOLSE-92-facilities-round-of-fixes.md) | Instalações: a round of fixes from the 22-10 test pass | Instalações / Dashboard / Incidentes | Medium | POOLSE-91 | 2 |
| [POOLSE-93](./POOLSE-93-occupancy-tab-restructured.md) | Ocupação: a tab that says what it is telling you | Instalações / Reporting | Medium | POOLSE-52 | 0 |
| [POOLSE-94](./POOLSE-94-club-payment-details-iban-mbway.md) | How families pay the club: IBAN and MB WAY as real fields | Club data / Billing | High | POOLSE-86, 87 | 1 |
| [POOLSE-95](./POOLSE-95-text-cursor-disappears-in-inputs.md) | The text cursor disappears (or turns white) over inputs | Global / Forms | High | — | 0 |
| [POOLSE-96](./POOLSE-96-lifeguard-week-as-a-grid.md) | Nadadores-salvadores: the week as a grid, dates in words | Safety / Lifeguard roster | Medium | POOLSE-70 | 1 |
| [POOLSE-97](./POOLSE-97-staff-files-salaries-and-certificates.md) | Staff files: salaries import/export in sight, certificates on the list | Staff / Payroll / Qualifications | Medium | POOLSE-59, 27 | 0 |
| [POOLSE-98](./POOLSE-98-loading-feedback.md) | Subtle loading feedback, bottom right | Global / Layout | Medium | — | 1 |
| [POOLSE-99](./POOLSE-99-theme-toggle-does-not-apply.md) | The theme toggle doesn't change the theme until something else re-renders | Global / Preferences | High | — | 1 |
| [POOLSE-100](./POOLSE-100-staff-record-birth-date-and-id-number.md) | Staff record: date of birth and Cartão de Cidadão number | Staff / Personal data | Medium | POOLSE-17, 39 | 0 |
| [POOLSE-101](./POOLSE-101-pool-water-tab-record-vs-lab-results.md) | A tank's water: record vs laboratory, and where a report lands | Instalações / Water quality | Medium | POOLSE-72 | 0 |
| [POOLSE-102](./POOLSE-102-cost-per-use-demo-data.md) | Cost per use shows real figures in the demo club | Energy / Demo | Low | POOLSE-28, 55 | 0 |
| [POOLSE-103](./POOLSE-103-small-fixes-sites-dashboard-menu-cursor.md) | Small fixes: site name link, no Energia tab, quiet subscription card, make-up menu, lighter I-beam | Instalações / Dashboard / Navigation | Medium | POOLSE-91, 95 | 0 |
| [POOLSE-104](./POOLSE-104-faturacao-fixes-back-settings-logo-select-all.md) | Faturação: Voltar, settings with the club, logo with photos, select all overdue | Billing / Club data | Medium | POOLSE-91, 94 | 0 |
| [POOLSE-105](./POOLSE-105-partner-signed-contract-upload.md) | The signed contract on a partnership, PDF or Word, from day one | Partnerships / Files | Medium | stored files, POOLSE-47 | 0 |
| [POOLSE-106](./POOLSE-106-energy-page-dashboard-collapsible-import-bill-reading.md) | Energia: running-cost dashboard, collapsible import, bills read automatically | Energy | Medium | 5.1–5.3, POOLSE-102 | 0 |
| [POOLSE-107](./POOLSE-107-calendar-dates-in-words-and-today-in-view.md) | Calendar: the week written out, today's column marked | Calendar | Low | POOLSE-96 | 0 |
| [POOLSE-108](./POOLSE-108-student-week-tab-dates-and-previous-week-bug.md) | A student's week: dates written out, previous week keeps the tab | Students | Medium | POOLSE-96 | 0 |
| [POOLSE-109](./POOLSE-109-emergency-contact-picker-and-atestado-upload.md) | Emergency contact by name search, and the atestado attached | Students / Sensitive data | Medium | stored files, POOLSE-21 | 0 |
| [POOLSE-110](./POOLSE-110-registration-requests-clearer-class-picker.md) | Pedidos de inscrição: a grouped, searchable turma picker | Students / Registration | Medium | POOLSE-69, 82 | 0 |
| [POOLSE-111](./POOLSE-111-competition-times-events-year-picker-import-formats.md) | Competição: the times table you can see, a year wheel, and what import can read | Students / Competition | Low | POOLSE-81, 85 | 0 |
| [POOLSE-112](./POOLSE-112-advancement-by-age-at-season-end.md) | Advancement by age at season end, and a queue worth opening — **built 23-10-2026** | Levels / Turmas | Medium | POOLSE-19, 45 | 0 |
| [POOLSE-113](./POOLSE-113-advancement-queue-turma-picker.md) | The advancement queue picks a turma in `TurmaPicker`, grouped by rank reason | Levels / Turmas | Medium | POOLSE-19, 110, 112 | 0 |
| [POOLSE-114](./POOLSE-114-results-by-email-and-how-to-get-the-file.md) | Competição: results arrive by email, and the page explains how to get the file — **built 28-10-2026** | Students / Competition | Medium | POOLSE-81, 86, 87 | 0 |
| [POOLSE-116](./POOLSE-116-lesson-feedback-from-the-family-app.md) | The app: a student's feedback after a lesson — mood plus a few words, read on the register | Mobile app / Students | Medium | POOLSE-90, 13 | 0 |
| [POOLSE-117](./POOLSE-117-partnership-groups-on-several-days.md) | Parcerias: a group on several days — place them at once, see them as one, import them | Partnerships / Calendar | Medium (pilot) | POOLSE-46, 47, 57 | 0 |
| [POOLSE-118](./POOLSE-118-command-palette.md) | A command palette: Ctrl+K to any page the reader may open, plus a few daily actions | Navigation | Medium | POOLSE-87, 91 | 0 |
| [POOLSE-119](./POOLSE-119-in-app-assistant.md) | An in-app assistant answering from the docs and the club's own data, as the reader — after first go-live | Platform / AI | Low (post go-live) | POOLSE-118, 87 | 0 |
| [POOLSE-120](./POOLSE-120-attention-circles.md) | Circles that say where something needs doing — pool to site to menu, cleared when done, pulsing three times | Navigation / Facilities / Students | Medium (pilot) | POOLSE-66, 69, 72, 90, 116 | 0 |
| [POOLSE-121](./POOLSE-121-free-swim-and-enrolment-from-the-phone.md) | The app: buy a free-swim entry or join a class from the phone — **joining built 29-10-2026 (a pedido)**; free swim still parked on how it is paid | Mobile app / Reception / Billing | Low | POOLSE-68, 90, 94, 120 | 0 |
| [POOLSE-122](./POOLSE-122-recintos-typed-playing-areas.md) | Recintos: a site holds typed playing areas, and a pool is one kind of them — **built 29-10-2026** | Facilities / Schema | High (pre go-live) | — | 0 |
| [POOLSE-123](./POOLSE-123-area-units-generalise-lanes.md) | Units: a lane is one kind of area unit, and a booking sits on units — **deferred 29-10-2026 (option b): the retrofit plan for the first non-pool sport** | Calendar / Schema | Deferred | POOLSE-122 | 1 |
| [POOLSE-124](./POOLSE-124-sport-modules-and-billing.md) | Sports as paid modules: pool on by default, each other sport switched on per club — **built 29-10-2026** | Platform / Billing | High (pre go-live) | POOLSE-122, 87 | 0 |
| [POOLSE-125](./POOLSE-125-navigation-per-sport.md) | Navigation: one main-menu group per enabled sport, the rest stays the site's — *Recintos* tab built 29-10-2026; menu groups and the sport pages' shell built 30-10-2026; API `?sport=` filters wait for the court grid | Navigation / Facilities | Medium | POOLSE-122, 124, 118 | 0 |
| [POOLSE-126](./POOLSE-126-levels-and-seasons-per-sport.md) | Levels belong to a sport; a season is shared unless the site says otherwise — **schema half built 29-10-2026**, screens after go-live | Students / Classes | Medium | POOLSE-122, 124 | 0 |
| [POOLSE-127](./POOLSE-127-student-app-sport-tabs.md) | The app: one person, a tab per sport, child-first for a guardian, one invoice | Mobile app / Billing | Low (post go-live) | POOLSE-122, 124, 90, 126 | 0 |
| [POOLSE-128](./POOLSE-128-energy-roll-up-and-allocation-per-recinto.md) | Energy: the site's costs roll up across every recinto, allocated by a rule the club sets — research first | Energy / Dashboards | Medium (post go-live) | POOLSE-122, 106, 102 | 1 |
| [POOLSE-129](./POOLSE-129-families-invited-from-the-student.md) | Families are invited from the student's record, by email or a link shared from the phone; Pessoas invites staff only — **built 30-10-2026** | Students / Staff | High (pre go-live) | POOLSE-90 | 1 |
| [POOLSE-130](./POOLSE-130-app-access-last-seen.md) | App access shows when each person last used Poolse — **built 30-10-2026** | Students / Invitations | Medium (pilot) | POOLSE-129 | 1 |
| [POOLSE-131](./POOLSE-131-student-identity-and-address.md) | A student's record holds their address and identity: morada, filiação, nacionalidade and the rest — **built 30-10-2026** | Students | High (pre go-live) | — | 1 |
| [POOLSE-132](./POOLSE-132-student-documents-fpn-declarations.md) | Documentos on the record: the ID and the FPN declarations, printed filled-in and filed signed — **built 30-10-2026** | Students / Competition | Medium (pilot) | POOLSE-131 | 2 |
| [POOLSE-133](./POOLSE-133-exame-medico.md) | Exame médico: each student's current exam, filed as a document and imported/exported for the club — **built 30-10-2026** | Students / Health | Medium (pilot) | POOLSE-109 | 1 |
| [POOLSE-134](./POOLSE-134-boletim-de-socio.md) | Boletim de sócio: printed from the record, filed signed, sócios imported/exported — **built 30-10-2026** | Students / Fees | Medium (pilot) | POOLSE-131, 132 | 2 |
| [POOLSE-135](./POOLSE-135-feedback-rating-glyph-per-sport.md) | Lesson feedback rates with the sport's own glyph (balls, swimmer) instead of faces — the 1–5 mood underneath is unchanged | Mobile app / Students / Multi-sport | Low (post go-live) | POOLSE-116, 122 | 1 |
| [POOLSE-136](./POOLSE-136-the-app-phone-shell.md) | The app gets a phone shell of its own: bottom tabs, one task per screen, a phone type scale — families and instructors; maintenance after the pilot | Mobile app | High (pre go-live) | POOLSE-90, 88 | 1 |

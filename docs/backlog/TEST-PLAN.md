# Go-live test plan — by screen, desk and phone (02-11-2026)

One block per screen, in menu order. Each block says what to try on the desk, what the phone promises
(tier from `docs/features/navigation.md`), and which roles to repeat it as. Tick the boxes; anything that
fails goes in the *Findings* format at the bottom and becomes a ticket.

**Standing checks on every screen** (do them once per screen, don't re-list them):
- [ ] Every label, hint, badge, toast, empty state and error is pt-PT (no English, no Brazilian form) — then switch to `en` once and look for Portuguese left behind.
- [ ] Every date reads `dd-MM-yyyy`; every time `HH:mm`; money `1 234,56 €`, never a float.
- [ ] Light **and** dark: nothing unreadable, no colour carrying meaning alone.
- [ ] A refused save leaves what you typed in the fields, with the sentence under the right field and a toast naming it.
- [ ] A success shows one toast ("Guardado" or its own word), once.
- [ ] *Voltar* returns to where you came from (list → record → list keeps the filter and page).
- [ ] Hover a tooltip: nothing it says is said *only* there.
- [ ] Busy indicator bottom-right appears on anything slower than ~half a second.
- [ ] Phone (360–430 px, portrait): no sideways scroll, no field squeezed, bottom bar clears the home indicator, 16 px inputs (no zoom on focus).

**Devices**: desk at 1280 px; iPhone Safari + installed to home screen; Android Chrome + installed. Note the device in each finding.

**Roles to log in as** (demo club): Owner, Admin, Instructor (one sport only if multi-sport is on), Maintenance, Guardian, Student ≥ 12. The role probe is: *what does each one see that it shouldn't, and what is missing that it should have?*

---

## 1. Painel (`/dashboard`) — tier 2
- [ ] Bands present match the role (management / operational / personal); a band you hold no role in is absent, not empty.
- [ ] Each card: a number, an empty sentence, or a muted error — and every card links to its page in all three states.
- [ ] *Hoje, hora a hora*: a bar opens its hour's lessons.
- [ ] Attention circles on the menu clear when the thing is done.
- [ ] Guardian with two children: `?child=` switches the personal band; a stranger's id is a 404.
- [ ] Phone: cards stack, nothing cut.

## 2. Instalações — list (`/dashboard/facilities`) — tier 2
- [ ] Site name opens the site; maintenance can open Espaços/Manutenção/Energia only.
- [ ] Onboarding checklist appears only for a club with no site.

## 3. Site page — tabs *Geral · Recintos · Piscinas · Espaços · Manutenção · Ocupação · Parcerias · Preços · Clube · Documentos · Regulamento · Fotos* — tier 3
- [ ] Geral: address/city picker, timezone, hours panel, weather panel (icons), slots panel (15/30/60).
- [ ] Preços: four `fee_kind`s, periodicities, VAT gross + *isento* as its own flag, fee categories with % **or** € (never both, never 0 for "none"); instructor sees names, not values.
- [ ] Clube: NIPC (checksum; empty clears, nonsense refused), logo upload, **IBAN / titular / MB WAY** (IBAN mod-97; MB WAY must be a 9… mobile) — change the IBAN and confirm every owner gets the email; insurance panel (apólice); passes panel (free-swim products); invoice series panel; tax panel.
- [ ] Documentos (POOLSE-142): upload the club's boletim (PDF and image), place fields, print one student on it; without a form, the print page says where to set it.
- [ ] Regulamento: publish a version, publish again — history dated, never edited; complaints-book link visible on the public pages.
- [ ] Parcerias: create partner → agreement → group; **import wizard** (xlsx and, if AI on, PDF) → preview → commit → **export → re-import = "nothing to do"**; contract upload (PDF and Word) with versions; a group on several days placed at once.
- [ ] Ocupação: the tab says what it measures; season summary export (PDF + Excel of the grid).
- [ ] Recintos: pool-only club sees its pool as one; multi-sport club can add a court only for a sport Rui switched on.
- [ ] Phone: tier 3 — readable, nothing broken; pill row scrolls with ‹ ›.

## 4. Piscina page — tabs *Geral · Água · Público · Custo · Fotos* — tier 1 for the water reading
- [ ] Geral: capacity (null = not measured), use (sets the temperature band), lanes as rows, archive/restore via the bin.
- [ ] Água: record a reading (typed moment is the site's wall clock; a `YYYY-MM-DD` day is never off by one); band verdict against NP 4542 with the **pH-dependent chlorine band**; club override with one bound, both bounds, neither (= not judged); missing-reading alert state; trend chart; printable report; CSV export; **spreadsheet import** and **lab-PDF parser** (if AI on) → preview → commit; a lab result shows its grade *conforme / condicionada / não conforme* and fills a reading too; drop a file on any water section → it lands in Laboratório.
- [ ] Público: token page opens with no login, both languages via `?lang=en`, revoke → immediate 404; QR prints.
- [ ] Custo: cost per lesson hour / bather / m³, twelve months, "com base em N de 12 meses", `unallocated` month shown and not divided.
- [ ] Phone: record a reading one-handed (numeric keypad, 44 px targets).

## 5. Espaços / Manutenção / Inventário / Tarefas — tier 1 (maintenance's daily work)
- [ ] Cleaning log: overdue derived from interval; out-of-service space exempt and still listed.
- [ ] Maintenance request (one-off) vs task (recurring, interval required); paused never due; never-done is due; backdated completion moves the next due; deleting a completion puts it back to due.
- [ ] Assignment to a person; a departed person's task says so.
- [ ] Inventário: import/export round trip; maintenance can edit, cannot archive. Scrolls sideways inside its box on a phone (accepted).
- [ ] Phone `/app/manutencao`: one-tap complete, the row leaves and the toast still shows.

## 6. Ocorrências (`/facilities/incidents`) + Nadadores-salvadores (`/facilities/lifeguards`) — tier 1 (recording), tier 2 (roster)
- [ ] Incident: facts visible to all staff; the words readable only by owner/admin/author, and every read lands in the audit log; correction = addendum; attachment is sealed; picker for people shows names only.
- [ ] Roster: week as a grid with dates in words; an hour with nobody on watch flagged; a person with lapsed ISN/SBV shown amber/red; the ratio is a club setting, nothing hard-coded.
- [ ] Phone: roster is one day at a time with ‹ ›.

## 7. Staff (`/facilities/staff`) — list, record tabs *Geral · Funções · Identificação · Contrato · Qualificações · Acesso* — tier 2
- [ ] Invite: role matrix by inviter's role; an existing email/mobile invites the record the club has, never a second one; email field survives a validation error; link-only invitation; reissue / revoke; seat quota counts pending invitations; exactly one owner, transfer only.
- [ ] Record: name editable only by the person (a login's name is theirs); email immutable; NIF/NISS checksums; date of birth; CC number encrypted and read-audited; ID photo front/back sealed, shown as link not thumbnail; emergency contact; *Contrato* versions, admin can't read the owner's nor write their own.
- [ ] Qualificações: types seeded (TPTD / ISN / SBV) with sport; verde / âmbar / vermelho / em falta; `blocks_assignment` on a type refuses a *new* instructor on a turma only; certificate dropped on the tab opens the form (AI read if on).
- [ ] Salários: owner sees all, admin sees all but the owner **and the total says so**; effective dates, one live rate; monthly↔hourly derived; **import/export round trip**; a file with one person twice is refused whole.
- [ ] Férias: mine vs team map; carry-over not tracked and the summary says so; holidays from closures only.
- [ ] Roles: one person many roles; merge two people (refuses owner, two logins, support).
- [ ] Phone: record tabs scroll; contact buttons ring/email.

## 8. Energia (`/dashboard/energy`) — tier 3
- [ ] Opens on a folded *Importar fatura* + dashboard; meter carrier (electricity/gas/water); `reads` never edited — retire and recreate; a dial going backwards is refused with the neighbour named; sub-meter tariff → **estimate** in its own section, never summed with billed €.
- [ ] Bill: typed by hand and (if AI on) read from PDF into the same form → preview → commit; "15,41 €" becomes cents once.
- [ ] Comparison: only months with both years; rate change named; a month any reading went unpriced is a dash.
- [ ] Maintenance sees the dashboard with every euro withheld.

## 9. Turmas (`/dashboard/classes`) — *Cartões* then week board; record tabs *Geral · Horário · Alunos · Atividade*; Épocas; Reposições — tier 2
- [ ] Cards: Aberta / Completa / Sem professor badge; week board one column on a phone.
- [ ] Create turma with level, capacity, instructor; capacity null enforces nothing; a full slot takes no more (POOLSE-56); tank capacity across turmas sharing a slot.
- [ ] Enrol: time clash in any sport refused (POOLSE-144) with turma/weekday/hour in the sentence; a move that creates one warns; waiting list checkbox (queue is post-pilot); sibling guardian attaches to the existing parent by NIF.
- [ ] Épocas: draft, publish (one published), duplicate, end/reset (owner/admin), the price list hides archived seasons; publishing queues age advancements.
- [ ] Reposições: credit issued on *falta justificada*, used on a make-up.
- [ ] Wall-timetable import (xlsx / PDF) → preview → commit; clash leaves only the clashing turmas out and the calendar names it.
- [ ] Lesson sync: place a turma today → lessons from today to season end, none in the past; remove a slot → future untaught lessons cancelled, one with a register untouched.

## 10. Calendário (`/dashboard/calendar`) + Encerramentos — tier 3 (drag), tier 1 (lesson page)
- [ ] Week heading in words, today's column marked; week stepper keeps `?tab`/`?from`.
- [ ] Drag: time, lane, sideways, resize from four edges; scope popover *só esta semana / todas*; refusal is a toast with the blocker's weekday and hour; a taught class refuses to move; a week with a register is skipped and **counted** (`weeksKept`).
- [ ] *Sem pista* column both ways; *Sem professor* amber; *A definir*; full turma fill line; *Marcar aula* ghost on hover only.
- [ ] Hover card: pin by click, students listed (POOLSE-147), plan sheet, stand-in picker (shows an error with retry, never a greyed select), Cancelar aula → families emailed within a minute + push, *Anular* → "a aula mantém-se".
- [ ] Encerramentos: holiday (all tanks incl. free swim), site, some tanks (batch), half day cut at 13:00; lift restores only live slots' lessons; a one-week move into a closure refused; families warned (push ≤ 7 days ahead).
- [ ] Export grid PDF + Excel; print view black on white, A4.
- [ ] Phone: day agenda (not the grid); lesson page = register + plan + stand-in + cancel, one-handed, Save bar sticky at bottom clearing the home indicator.

## 11. Receção (`/dashboard/rececao`) — owner/admin — tier 1
- [ ] Sell a single entry with no payer (*Consumidor final*), a pack, a time-boxed pass; each is an invoice line, paid at sale; credit the sale → pass void.
- [ ] Check-in decrements/validates; refused when the tank is closed ("Encerrado até") or at capacity; live occupancy = check-ins within stay minutes + classes running by enrolment.
- [ ] Pass revenue shown apart from mensalidades.

## 12. Faturação (`/dashboard/faturacao`) — owner/admin — tier 2 (tables become cards)
- [ ] Monthly run: preview = commit (same lines); per-student run; siblings on one document addressed to the payer; line description in the club's words; `due_on` before `issued_on` allowed.
- [ ] A number is never reused; a correction is a credit note; after a credit note the occurrence is chargeable again; nothing editable on an issued document.
- [ ] Payments: child rows, partial, over-payment floors at zero; status derived (credited > paid > overdue); *Selecionar todos em atraso* ticks only overdue; chase by channel; reminder email from Em dívida records a chase per document.
- [ ] PDF of a document; Voltar returns to the month/view it came from; settings live with the club (POOLSE-104).
- [ ] Screens say *registos internos, não faturas certificadas*.
- [ ] Phone: `.table-stack` cards, select-all header still reachable.

## 13. Alunos (`/dashboard/students`) — list, Encarregados, Pedidos, Mensagens, Competição, Níveis, Avanços; record tabs *Geral · Turmas · Semana · Mensalidades · Créditos · Documentos · Feedback · Acesso à app · Atividade* — tier 2 (record), tier 1 (find + ring)
- [ ] List: search as you type resets to page 1; 15 per page; filters travel to the **export** (Em atraso, sport, multi-modalidade); badges age bracket / adult path / seguro three states; *Convidar membros* preview/commit capped 200/day.
- [ ] Register import (xlsx / PDF) → preview → commit → **export → re-import = nothing to do**.
- [ ] Record Geral: identity (morada, filiação, nacionalidade, SNS owner/admin only), favourite stroke survives a save (POOLSE-10), photo only with consent, consent form chosen by the server (minor with guardian can't self-sign — 422), guardian block under 18, adult path = no guardian edge, emergency contact by name search, atestado upload (sealed), exame médico as a warning never a gate, medical leave.
- [ ] Mensalidades: plan visible at the price, discount by category **or** typed (never both), `balance` matches the fee lines, seguro pro-rata mid-season, inscrição renovação price for a returning student.
- [ ] Documentos: ID document, FPN Anexo 2 printed filled (Portuguese), boletim on the club's template, signed copies filed, one current per kind/season; sócio import/export.
- [ ] Semana: dates in words, previous week keeps the tab (POOLSE-108).
- [ ] Acesso à app: invite guardian / student ≥ 12 by email or shared link; last seen shown.
- [ ] Feedback: moods from the family after a lesson, within 7 days, present only; archive via bin.
- [ ] Níveis: drag order, age bands (months < 1 yr, ceiling 100), four skill states, expanded view, a level per sport if multi-sport.
- [ ] Avanços: skills-based and age-based proposals in one queue; *Propor*; apply mode nightly (actor = Sistema); TurmaPicker grouped by rank reason; family told by email.
- [ ] Pedidos: public form (`/<slug>`, owner switches it on) → request in queue; honeypot/stale stamp answer 202 silently; convert to enrolment in one action; trial lesson counts a seat; TurmaPicker grouped by level, searchable, full turma only where allowed; 12-month archive.
- [ ] Mensagens: audience turma / level / site / club / sport (office only); preview count = sent count; opted-out left out and counted; 20 messages / 2,000 addresses per day refusal; instructor only to own turmas; footer unsubscribe link works with no login; closure/alert mail ignores the opt-out.
- [ ] Competição: course scm/lcm/não indicada; bests per stroke/distance/course; official best beside overall; LENEX import (zip refused if nested; licence match else name+DOB confirmed; never creates a student); results by email → inbox badge → import; mínimos grid (typed times via `parseSwimTime`), FPN age groups created in one click, year wheel; *Gap to qualify*; printable meet results.
- [ ] Encarregados: a co-guardian's contacts withheld from a family read.
- [ ] Phone: find a student and ring home one-handed; record tabs readable.

## 14. Family (`/dashboard/family`, `/app/familia`, `/app/familia/aulas`, `/app/familia/pagamentos`, `/app/perfil`) — tier 1, **test on both phones installed**
- [ ] A family-only login opening `/dashboard` lands in `/app`; a staff member who is also a parent chooses.
- [ ] Agenda: every child's real sessions for two weeks; cancelled / closed / moved said in words; water temperature with its age (none when the module is off).
- [ ] *Vou / Não vou*: allowed for a live guardian, or the student from 12, never a guess with no birth date; refused once the lesson started.
- [ ] Lesson page: plan readable only for a day the child was enrolled; feedback form inside the window.
- [ ] Pagamentos: what is owed = `balance`; *Como pagar* = IBAN + MB WAY with copy buttons + reference (open document numbers, else the child's name); matches the reminder email.
- [ ] Join a class from the phone (POOLSE-121) → appears in Pedidos.
- [ ] Perfil: language/theme, opt-out, club switcher, devices signed in, **push switch prompts only on tap**; tap a notification → opens its lesson.
- [ ] Install: iOS Add to Home Screen (icon, name, no browser chrome, notch cleared); Android install prompt; theme toggle applies at once (POOLSE-99); text cursor visible in inputs (POOLSE-95).
- [ ] A guardian: cannot open another child's id (404), cannot see staff contacts, the price list, or a co-guardian's phone.

## 15. Instructor app (`/app/aulas`, `?semana`) — tier 1, both phones
- [ ] Today's lessons: regular instructor sees own; a stand-in sees the class he covers and the regular one does not; a lesson with the register owed stays as the next.
- [ ] Register: present / falta / justificada, notices shown as chips, pre-marks nothing; plan sheet; Cancelar aula allowed per `canCancel`.
- [ ] Multi-sport: instructor scoped to one sport reads only its students (403, never an empty list elsewhere).

## 16. O meu perfil (backoffice) + Subscrição (owner) — tier 2
- [ ] Photo → Clerk and back; locale/theme persist across devices; sessions list + revoke; opt-out.
- [ ] Subscrição: with no Stripe key says *pagamentos ainda não configurados*; with staging keys: checkout on Stripe's page, portal, interval switch, `past_due` keeps the club open, read-only trial can still pay. **Do this in staging with test keys, never a live account.**

## 17. Public pages (no login): `/<slug>` form, `/public/water/<token>`, `/email/<token>`, `/join/<token>` — desk + phone
- [ ] Each carries the complaints-book link and the regulation in force; `?lang=en`; every miss is the same 404; throttled per token/slug.
- [ ] `/join` signed out: *Criar conta / Entrar* returns to the same link with the address seeded; accepting lands in `/app`.

## 18. `/admin` (Rui only) — tier 3
- [ ] Tenants: trial dates, grant a new trial (frees the address), read-only, suspend (name typed back, reason required), archive, manual payment moves `paid_through` only forward, modules on/off (dependency 409), sports on/off (in-use 409), AI readers tick + cap + usage € , platform switches, support request / force (4 h, alert), health dots, backup check.
- [ ] A non-admin gets 403 and the refusal is logged; `/platform` 60/min ceiling.

---

## Cross-cutting passes (one evening each)

- **Importers/exporters round trip** — alunos, horário, parcerias, salários, inventário, mínimos, água, energia faturas, sócios, exame médico: export → import → preview says nothing to do → commit writes 0 rows. Under `en` and `pt-PT` both.
- **Role probe on screens** — as instructor/maintenance/guardian/student: every menu entry visible should open; every URL from the owner's menu pasted in should 403/404 cleanly (*not allowed*, not a crash).
- **Email + push** — set Resend to a real sandbox, trigger: invitation, water alert, lab não conforme, qualification crossing, message, closure, cancellation, reminder, IBAN change, trial notice, level change. Each arrives once; a failed one retries hourly.
- **Retention** — on a copy: a student left > 1 year → health gone; > 5 → identity anonymised; invoices keep their snapshot.
- **Bin + revert** — archive each of the ten restorable kinds, restore from the bin, *Anular* on the toast; revert a student field edit; a field changed since → 409 with three values.

## Findings — paste back in this shape

```
screen | role | device (desk / iPhone / Android, installed?) | what you did | what you saw | what you expected | severity (blocks go-live / before invite / later)
```

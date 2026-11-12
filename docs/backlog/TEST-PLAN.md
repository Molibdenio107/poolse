# Go-live test plan — by screen, desk and phone (02-11-2026)

One block per screen, in menu order. Each block says what to try on the desk, what the phone promises
(tier from `docs/features/navigation.md`), and which roles to repeat it as. Tick the boxes; anything that
fails goes in the *Findings* format at the bottom and becomes a ticket.

## Where this stands (12-11-2026)

The pilot runs as an **alpha** (Rui, 12-11-2026): the club helps find what to change, so this walk does not
have to be clean before they start — only the boxes marked **Before the pilot** do. Those are money,
permissions, personal data, legal text, losing data, and the pilot's first day (install, timetable,
students, register). Everything marked *Pilot finds it* is look, wording and convenience, and the
pilot's findings go in the *Findings* format at the bottom like yours.

Marks:
- `[x]` … *✔ Claude*: proved by an automated test or a recorded browser walk; nothing left for you.
- an indented line under a box: what is already **proved**, and what is still **yours** to look at.

Proved means the API/DB integration suites (12-11-2026: API 1618/1619, the one miss the known drafts
flake) and the Playwright suite against dev; a phone viewport is not a real phone. The Playwright run of
12-11-2026 could not re-prove most specs: the dev reset of 10-11 stopped before `db:seed`, so the demo
club and its e2e instructor and guardian do not exist. A box that rested on those specs says so and
is not ticked.

---

**Standing checks on every screen** (do them once per screen, don't re-list them):
- [ ] Every label, hint, badge, toast, empty state and error is pt-PT (no English, no Brazilian form) — then switch to `en` once and look for Portuguese left behind.
  - *Pilot finds it* · proved: `i18n:check` (every key in both files) and `pt:check` (Brazilian forms) pass · yours: reading the Portuguese
- [ ] Every date reads `dd-MM-yyyy`; every time `HH:mm`; money `1 234,56 €`, never a float.
  - *Pilot finds it* · proved: e2e: Semana and the calendar write their dates out in both languages · yours: everything else, by eye
- [ ] Light **and** dark: nothing unreadable, no colour carrying meaning alone.
  - *Pilot finds it* · proved: `contrast:check` on the tokens; e2e theme spec in both languages · yours: each screen by eye
- [ ] A refused save leaves what you typed in the fields, with the sentence under the right field and a toast naming it.
  - *Pilot finds it* · proved: `forms:check` (no uncontrolled fields); e2e: the register keeps every mark on a refused save · yours: other forms
- [ ] A success shows one toast ("Guardado" or its own word), once.
  - *Pilot finds it* · yours: all of it
- [ ] *Voltar* returns to where you came from (list → record → list keeps the filter and page).
  - *Pilot finds it* · proved: e2e phone-back (5 routes), Semana, Faturação documents · yours: list filters and pages
- [ ] Hover a tooltip: nothing it says is said *only* there.
  - *Pilot finds it* · yours: all of it
- [ ] Busy indicator bottom-right appears on anything slower than ~half a second.
  - *Pilot finds it* · yours: all of it
- [ ] Phone (360–430 px, portrait): no sideways scroll, no field squeezed, bottom bar clears the home indicator, 16 px inputs (no zoom on focus).
  - *Pilot finds it* · proved: e2e: 44 px / 16 px controls, no zoom on focus, home bar and notch, no sideways scroll on the owner pages · yours: real phones

**Devices**: desk at 1280 px; iPhone Safari + installed to home screen; Android Chrome + installed. Note the device in each finding.

**Roles to log in as** (demo club): Owner, Admin, Instructor (one sport only if multi-sport is on), Maintenance, Guardian, Student ≥ 12. The role probe is: *what does each one see that it shouldn't, and what is missing that it should have?*

---

## 1. Painel (`/dashboard`) — tier 2
- [x] Bands present match the role (management / operational / personal); a band you hold no role in is absent, not empty. — *✔ Claude 12-11-2026: API: band composition and one test per band (management, instructor, maintenance, family)*
- [ ] Each card: a number, an empty sentence, or a muted error — and every card links to its page in all three states.
  - *Pilot finds it* · yours: all three states, by eye
- [ ] *Hoje, hora a hora*: a bar opens its hour's lessons.
  - *Pilot finds it* · yours: all of it
- [ ] Attention circles on the menu clear when the thing is done.
  - *Pilot finds it* · proved: API: the counts clear when the thing is done · yours: watching it clear
- [x] Guardian with two children: `?child=` switches the personal band; a stranger's id is a 404. — *✔ Claude 12-11-2026: API family band: a child who is not the reader's is refused*
- [ ] Phone: cards stack, nothing cut.
  - *Pilot finds it* · yours: a real phone

## 2. Instalações — list (`/dashboard/facilities`) — tier 2
- [ ] Site name opens the site; maintenance can open Espaços/Manutenção/Energia only.
  - **Before the pilot** · proved: API role probe: maintenance is refused the rest · yours: opening it as maintenance
- [ ] Onboarding checklist appears only for a club with no site.
  - *Pilot finds it* · yours: all of it

## 3. Site page — tabs *Geral · Recintos · Piscinas · Espaços · Manutenção · Ocupação · Parcerias · Preços · Clube · Documentos · Regulamento · Fotos* — tier 3
- [ ] Geral: address/city picker, timezone, hours panel, weather panel (icons), slots panel (15/30/60).
  - **Before the pilot** · proved: API: slot grids (15/30/60, overlaps refused) · yours: timezone and hours: they set the club's clock
- [ ] Preços: four `fee_kind`s, periodicities, VAT gross + *isento* as its own flag, fee categories with % **or** € (never both, never 0 for "none"); instructor sees names, not values.
  - **Before the pilot** · proved: API: fee kinds, VAT gross/exempt, category % or € (never both) · yours: the screen, and an instructor seeing names only
- [ ] Clube: NIPC (checksum; empty clears, nonsense refused), logo upload, **IBAN / titular / MB WAY** (IBAN mod-97; MB WAY must be a 9… mobile) — change the IBAN and confirm every owner gets the email; insurance panel (apólice); passes panel (free-swim products); invoice series panel; tax panel.
  - **Before the pilot** · proved: API: IBAN mod-97, MB WAY-only, IBAN change emailed to every owner · yours: NIPC, logo, insurance, passes, invoice series and tax panels
- [ ] Documentos (POOLSE-142): upload the club's boletim (PDF and image), place fields, print one student on it; without a form, the print page says where to set it.
  - *Pilot finds it* · proved: API: boletim template · yours: placing fields and printing
- [ ] Regulamento: publish a version, publish again — history dated, never edited; complaints-book link visible on the public pages.
  - **Before the pilot** · proved: API: versions take effect on their day, the latest in force · yours: the complaints-book link on the public pages (legal)
- [ ] Parcerias: create partner → agreement → group; **import wizard** (xlsx and, if AI on, PDF) → preview → commit → **export → re-import = "nothing to do"**; contract upload (PDF and Word) with versions; a group on several days placed at once.
  - *Pilot finds it* · proved: API: export → re-import changes nothing; days placed all or nothing; e2e: contract versions, .pptx refused, .docx downloads · yours: the wizard by eye; PDF needs AI on
- [ ] Ocupação: the tab says what it measures; season summary export (PDF + Excel of the grid).
  - *Pilot finds it* · yours: all of it
- [ ] Recintos: pool-only club sees its pool as one; multi-sport club can add a court only for a sport Rui switched on.
  - *Pilot finds it* · proved: API sport modules; e2e: a pool-only club has one Natação tab · yours: adding a court in a multi-sport club
- [ ] Phone: tier 3 — readable, nothing broken; pill row scrolls with ‹ ›.
  - *Pilot finds it* · yours: a real phone

## 4. Piscina page — tabs *Geral · Água · Público · Custo · Fotos* — tier 1 for the water reading
- [ ] Geral: capacity (null = not measured), use (sets the temperature band), lanes as rows, archive/restore via the bin.
  - *Pilot finds it* · yours: all of it
- [ ] Água: record a reading (typed moment is the site's wall clock; a `YYYY-MM-DD` day is never off by one); band verdict against NP 4542 with the **pH-dependent chlorine band**; club override with one bound, both bounds, neither (= not judged); missing-reading alert state; trend chart; printable report; CSV export; **spreadsheet import** and **lab-PDF parser** (if AI on) → preview → commit; a lab result shows its grade *conforme / condicionada / não conforme* and fills a reading too; drop a file on any water section → it lands in Laboratório.
  - **Before the pilot** · proved: API: lab grade conforme / condicionada / não conforme, one alert, old reports raise none, imports; e2e: the water tab sections, the club log previews as readings · yours: the pH-dependent band on screen, club overrides, chart, print, CSV; lab PDF needs AI on
- [ ] Público: token page opens with no login, both languages via `?lang=en`, revoke → immediate 404; QR prints.
  - **Before the pilot** · proved: API: the public page carries only the latest grade and its date · yours: no login, `?lang=en`, revoke → 404, QR print
- [ ] Custo: cost per lesson hour / bather / m³, twelve months, "com base em N de 12 meses", `unallocated` month shown and not divided.
  - *Pilot finds it* · proved: API: cost report and demo · yours: the screen
- [ ] Phone: record a reading one-handed (numeric keypad, 44 px targets).
  - **Before the pilot** · proved: e2e on a phone viewport: decimal pad for a reading, 44 px controls (e2e not re-run 12-11: demo club unseeded) · yours: one-handed on a real phone

## 5. Espaços / Manutenção / Inventário / Tarefas — tier 1 (maintenance's daily work)
- [ ] Cleaning log: overdue derived from interval; out-of-service space exempt and still listed.
  - *Pilot finds it* · proved: API spaces tests · yours: the screen
- [ ] Maintenance request (one-off) vs task (recurring, interval required); paused never due; never-done is due; backdated completion moves the next due; deleting a completion puts it back to due.
  - *Pilot finds it* · proved: API: paused never due, backdated completion, deleted completion · yours: the screen
- [ ] Assignment to a person; a departed person's task says so.
  - *Pilot finds it* · yours: all of it
- [ ] Inventário: import/export round trip; maintenance can edit, cannot archive. Scrolls sideways inside its box on a phone (accepted).
  - *Pilot finds it* · proved: API inventory tests · yours: the round trip by hand
- [ ] Phone `/app/manutencao`: one-tap complete, the row leaves and the toast still shows.
  - *Pilot finds it* · proved: e2e phone-maintenance QA 2: done, it leaves Hoje (e2e not re-run 12-11: demo club unseeded) · yours: a real phone

## 6. Ocorrências (`/facilities/incidents`) + Nadadores-salvadores (`/facilities/lifeguards`) — tier 1 (recording), tier 2 (roster)
- [ ] Incident: facts visible to all staff; the words readable only by owner/admin/author, and every read lands in the audit log; correction = addendum; attachment is sealed; picker for people shows names only.
  - **Before the pilot** · proved: API: facts written once, correction is an addendum, an instructor who did not write it is refused the words; sealed files · yours: the audit-log entry for a read, and the people picker
- [ ] Roster: week as a grid with dates in words; an hour with nobody on watch flagged; a person with lapsed ISN/SBV shown amber/red; the ratio is a club setting, nothing hard-coded.
  - *Pilot finds it* · proved: API: a gap said exactly, lapsed licence warned, a closed day has no gap · yours: the grid, colours, ratio setting
- [ ] Phone: roster is one day at a time with ‹ ›.
  - *Pilot finds it* · proved: e2e phone-views (POOLSE-96) (e2e not re-run 12-11: demo club unseeded) · yours: a real phone

## 7. Staff (`/facilities/staff`) — list, record tabs *Geral · Funções · Identificação · Contrato · Qualificações · Acesso* — tier 2
- [ ] Invite: role matrix by inviter's role; an existing email/mobile invites the record the club has, never a second one; email field survives a validation error; link-only invitation; reissue / revoke; seat quota counts pending invitations; exactly one owner, transfer only.
  - **Before the pilot** · proved: API invitations and staff table · yours: the matrix as each role, one owner, seat quota
- [ ] Record: name editable only by the person (a login's name is theirs); email immutable; NIF/NISS checksums; date of birth; CC number encrypted and read-audited; ID photo front/back sealed, shown as link not thumbnail; emergency contact; *Contrato* versions, admin can't read the owner's nor write their own.
  - **Before the pilot** · proved: API: identity, ID photo sealed, contract owner-only · yours: the screen as owner and admin
- [ ] Qualificações: types seeded (TPTD / ISN / SBV) with sport; verde / âmbar / vermelho / em falta; `blocks_assignment` on a type refuses a *new* instructor on a turma only; certificate dropped on the tab opens the form (AI read if on).
  - *Pilot finds it* · proved: API qualifications, per sport · yours: the screen; AI read needs AI on
- [x] Salários: owner sees all, admin sees all but the owner **and the total says so**; effective dates, one live rate; monthly↔hourly derived; **import/export round trip**; a file with one person twice is refused whole. — *✔ Claude 12-11-2026: API: round trip changes nothing, one person twice refuses the file, admin sees all but the owner; e2e salaries (no stranger, no amount in the URL)*
- [ ] Férias: mine vs team map; carry-over not tracked and the summary says so; holidays from closures only.
  - *Pilot finds it* · yours: all of it
- [ ] Roles: one person many roles; merge two people (refuses owner, two logins, support).
  - *Pilot finds it* · proved: API people merge (an admin cannot absorb the Owner) · yours: two logins and support, by eye
- [ ] Phone: record tabs scroll; contact buttons ring/email.
  - *Pilot finds it* · yours: a real phone

## 8. Energia (`/dashboard/energy`) — tier 3
- [ ] Opens on a folded *Importar fatura* + dashboard; meter carrier (electricity/gas/water); `reads` never edited — retire and recreate; a dial going backwards is refused with the neighbour named; sub-meter tariff → **estimate** in its own section, never summed with billed €.
  - *Pilot finds it* · proved: API: a dial going back is refused naming the neighbour, replacement retires; e2e energy QA 1–5 · yours: the sub-meter estimate section
- [ ] Bill: typed by hand and (if AI on) read from PDF into the same form → preview → commit; "15,41 €" becomes cents once.
  - *Pilot finds it* · proved: API energy invoices; e2e: with reading off the form can be typed · yours: PDF read needs AI on
- [ ] Comparison: only months with both years; rate change named; a month any reading went unpriced is a dash.
  - *Pilot finds it* · proved: API: only months billed in both years · yours: rate change named, unpriced month a dash
- [x] Maintenance sees the dashboard with every euro withheld. — *✔ Claude 12-11-2026: API energy summary QA 6*

## 9. Turmas (`/dashboard/classes`) — *Cartões* then week board; record tabs *Geral · Horário · Alunos · Atividade*; Épocas; Reposições — tier 2
- [ ] Cards: Aberta / Completa / Sem professor badge; week board one column on a phone.
  - *Pilot finds it* · proved: e2e: the board reads a day at a time on a phone · yours: the badges
- [ ] Create turma with level, capacity, instructor; capacity null enforces nothing; a full slot takes no more (POOLSE-56); tank capacity across turmas sharing a slot.
  - **Before the pilot** · proved: API: pool capacity, saving a turma · yours: creating one by hand
- [ ] Enrol: time clash in any sport refused (POOLSE-144) with turma/weekday/hour in the sentence; a move that creates one warns; waiting list checkbox (queue is post-pilot); sibling guardian attaches to the existing parent by NIF.
  - **Before the pilot** · proved: API: 409 naming the other turma; the queue refuses a clash · yours: the move warning, waiting list, sibling NIF
- [ ] Épocas: draft, publish (one published), duplicate, end/reset (owner/admin), the price list hides archived seasons; publishing queues age advancements.
  - **Before the pilot** · proved: DB: draft seasons · yours: publish / duplicate / end by hand (once a year, but the pilot starts with it)
- [ ] Reposições: credit issued on *falta justificada*, used on a make-up.
  - *Pilot finds it* · proved: DB: reposição rules · yours: the screen
- [ ] Wall-timetable import (xlsx / PDF) → preview → commit; clash leaves only the clashing turmas out and the calendar names it.
  - **Before the pilot** · proved: POOLSE-223/224 walked 12-11: PDF read, preview on the calendar, refused confirm reopens the conflict, confirm; `timetable:eval` 6/6 · yours: the club's own timetable file; xlsx path
- [ ] Lesson sync: place a turma today → lessons from today to season end, none in the past; remove a slot → future untaught lessons cancelled, one with a register untouched.
  - *Pilot finds it* · proved: API: lessons to the season end, none in the past · yours: removing a slot, by eye

## 10. Calendário (`/dashboard/calendar`) + Encerramentos — tier 3 (drag), tier 1 (lesson page)
- [ ] Week heading in words, today's column marked; week stepper keeps `?tab`/`?from`.
  - *Pilot finds it* · proved: e2e: week written out, Hoje pill (POOLSE-107) · yours: `?tab`/`?from` kept by the stepper
- [ ] Drag: time, lane, sideways, resize from four edges; scope popover *só esta semana / todas*; refusal is a toast with the blocker's weekday and hour; a taught class refuses to move; a week with a register is skipped and **counted** (`weeksKept`).
  - **Before the pilot** · proved: API: one week / all weeks, past left alone, lanes, a move into a closure refused · yours: the drag itself — no test drives it
- [ ] *Sem pista* column both ways; *Sem professor* amber; *A definir*; full turma fill line; *Marcar aula* ghost on hover only.
  - *Pilot finds it* · proved: walked 12-11 (Sem pista per pool) · yours: the rest
- [ ] Hover card: pin by click, students listed (POOLSE-147), plan sheet, stand-in picker (shows an error with retry, never a greyed select), Cancelar aula → families emailed within a minute + push, *Anular* → "a aula mantém-se".
  - **Before the pilot** · proved: API stand-in and cancellation notice; e2e: cancel this week and take it back, stand-in chosen · yours: families emailed (pilot runs without email) and push
- [ ] Encerramentos: holiday (all tanks incl. free swim), site, some tanks (batch), half day cut at 13:00; lift restores only live slots' lessons; a one-week move into a closure refused; families warned (push ≤ 7 days ahead).
  - **Before the pilot** · proved: API: site vs tanks, a closed tank refuses check-in in words, a move into one refused, only owner/admin close · yours: half day, lift, families warned
- [ ] Export grid PDF + Excel; print view black on white, A4.
  - *Pilot finds it* · yours: all of it
- [ ] Phone: day agenda (not the grid); lesson page = register + plan + stand-in + cancel, one-handed, Save bar sticky at bottom clearing the home indicator.
  - **Before the pilot** · proved: e2e: day agenda, lesson opens its page, register Save always in reach (e2e not re-run 12-11: demo club unseeded) · yours: a real phone, one-handed

## 11. Receção (`/dashboard/rececao`) — owner/admin — tier 1
- [ ] Sell a single entry with no payer (*Consumidor final*), a pack, a time-boxed pass; each is an invoice line, paid at sale; credit the sale → pass void.
  - **Before the pilot** · proved: API: pack, credit voids the pass, anonymous sale has no payer · yours: a time-boxed pass on screen
- [ ] Check-in decrements/validates; refused when the tank is closed ("Encerrado até") or at capacity; live occupancy = check-ins within stay minutes + classes running by enrolment.
  - **Before the pilot** · proved: API: the 11th entry refused, a closed tank refused in words · yours: capacity refusal, live occupancy
- [x] Pass revenue shown apart from mensalidades. — *✔ Claude 12-11-2026: API free-swim: its own figure, credited sales leave it*

## 12. Faturação (`/dashboard/faturacao`) — owner/admin — tier 2 (tables become cards)
- [ ] Monthly run: preview = commit (same lines); per-student run; siblings on one document addressed to the payer; line description in the club's words; `due_on` before `issued_on` allowed.
  - **Before the pilot** · proved: API: preview is what is issued, siblings on one document to the payer · yours: per-student run, wording, `due_on`
- [x] A number is never reused; a correction is a credit note; after a credit note the occurrence is chargeable again; nothing editable on an issued document. — *✔ Claude 12-11-2026: API invoices: sequential numbers, no edit, credit note, billable again*
- [ ] Payments: child rows, partial, over-payment floors at zero; status derived (credited > paid > overdue); *Selecionar todos em atraso* ticks only overdue; chase by channel; reminder email from Em dívida records a chase per document.
  - **Before the pilot** · proved: API: overpayment settles, late part-payment overdue, a reminder is a chase per document; e2e: select-all ticks only overdue · yours: chase by channel
- [ ] PDF of a document; Voltar returns to the month/view it came from; settings live with the club (POOLSE-104).
  - *Pilot finds it* · proved: e2e invoicing QA 1–3 (e2e not re-run 12-11: demo club unseeded) · yours: the PDF by eye
- [ ] Screens say *registos internos, não faturas certificadas*.
  - **Before the pilot** · yours: the sentence on screen (legal)
- [ ] Phone: `.table-stack` cards, select-all header still reachable.
  - *Pilot finds it* · proved: e2e phone-views: Em dívida select-all above the cards, no table sideways (e2e not re-run 12-11: demo club unseeded) · yours: a real phone

## 13. Alunos (`/dashboard/students`) — list, Encarregados, Pedidos, Mensagens, Competição, Níveis, Avanços; record tabs *Geral · Turmas · Semana · Mensalidades · Créditos · Documentos · Feedback · Acesso à app · Atividade* — tier 2 (record), tier 1 (find + ring)
- [ ] List: search as you type resets to page 1; 15 per page; filters travel to the **export** (Em atraso, sport, multi-modalidade); badges age bracket / adult path / seguro three states; *Convidar membros* preview/commit capped 200/day.
  - *Pilot finds it* · proved: API: the export is what is filtered · yours: search, paging, badges, invite cap
- [ ] Register import (xlsx / PDF) → preview → commit → **export → re-import = nothing to do**.
  - **Before the pilot** · proved: API: preview writes nothing, same file twice changes nothing, NIF round trip · yours: the club's own list
- [ ] Record Geral: identity (morada, filiação, nacionalidade, SNS owner/admin only), favourite stroke survives a save (POOLSE-10), photo only with consent, consent form chosen by the server (minor with guardian can't self-sign — 422), guardian block under 18, adult path = no guardian edge, emergency contact by name search, atestado upload (sealed), exame médico as a warning never a gate, medical leave.
  - **Before the pilot** · proved: API consent, adult path, medical certificate; e2e: emergency contact by search, atestado filed · yours: photo consent, the rest by eye
- [ ] Mensalidades: plan visible at the price, discount by category **or** typed (never both), `balance` matches the fee lines, seguro pro-rata mid-season, inscrição renovação price for a returning student.
  - **Before the pilot** · proved: API: balance, category discount, insurance, older periods · yours: the screen against a real family
- [ ] Documentos: ID document, FPN Anexo 2 printed filled (Portuguese), boletim on the club's template, signed copies filed, one current per kind/season; sócio import/export.
  - *Pilot finds it* · proved: API documents and boletim · yours: printing
- [ ] Semana: dates in words, previous week keeps the tab (POOLSE-108).
  - *Pilot finds it* · proved: e2e student-week QA 1–3 (e2e not re-run 12-11: demo club unseeded) · yours: one look
- [ ] Acesso à app: invite guardian / student ≥ 12 by email or shared link; last seen shown.
  - **Before the pilot** · proved: e2e: a family link shared from the record on a phone; POOLSE-218 walked 12-11 · yours: last seen; one real family's invitation end to end
- [ ] Feedback: moods from the family after a lesson, within 7 days, present only; archive via bin.
  - *Pilot finds it* · proved: API feedback window; e2e POOLSE-116 · yours: the archive
- [ ] Níveis: drag order, age bands (months < 1 yr, ceiling 100), four skill states, expanded view, a level per sport if multi-sport.
  - *Pilot finds it* · proved: API levels per sport · yours: the screen
- [ ] Avanços: skills-based and age-based proposals in one queue; *Propor*; apply mode nightly (actor = Sistema); TurmaPicker grouped by rank reason; family told by email.
  - *Pilot finds it* · proved: API advancement by age and per sport; e2e queue QA 1, 3 · yours: apply mode overnight, family email
- [ ] Pedidos: public form (`/<slug>`, owner switches it on) → request in queue; honeypot/stale stamp answer 202 silently; convert to enrolment in one action; trial lesson counts a seat; TurmaPicker grouped by level, searchable, full turma only where allowed; 12-month archive.
  - *Pilot finds it* · proved: API leads; e2e TurmaPicker QA 1–5 · yours: the public form end to end
- [ ] Mensagens: audience turma / level / site / club / sport (office only); preview count = sent count; opted-out left out and counted; 20 messages / 2,000 addresses per day refusal; instructor only to own turmas; footer unsubscribe link works with no login; closure/alert mail ignores the opt-out.
  - **Before the pilot** · proved: API: instructor only to own turmas, both daily ceilings with numbers, opt-out · yours: preview count = sent; unsubscribe with no login
- [ ] Competição: course scm/lcm/não indicada; bests per stroke/distance/course; official best beside overall; LENEX import (zip refused if nested; licence match else name+DOB confirmed; never creates a student); results by email → inbox badge → import; mínimos grid (typed times via `parseSwimTime`), FPN age groups created in one click, year wheel; *Gap to qualify*; printable meet results.
  - *Pilot finds it* · proved: API meets QA 1–6; e2e: FPN groups in one click, year wheel, LENEX link · yours: a real meet file
- [ ] Encarregados: a co-guardian's contacts withheld from a family read.
  - **Before the pilot** · yours: a co-guardian's phone hidden from a family read (privacy)
- [ ] Phone: find a student and ring home one-handed; record tabs readable.
  - *Pilot finds it* · yours: a real phone

## 14. Family (`/dashboard/family`, `/app/familia`, `/app/familia/aulas`, `/app/familia/pagamentos`, `/app/perfil`) — tier 1, **test on both phones installed**
- [ ] A family-only login opening `/dashboard` lands in `/app`; a staff member who is also a parent chooses.
  - **Before the pilot** · proved: e2e: /app and /dashboard both land on the agenda; an owner is asked (e2e not re-run 12-11: demo club unseeded) · yours: signing in as a parent
- [ ] Agenda: every child's real sessions for two weeks; cancelled / closed / moved said in words; water temperature with its age (none when the module is off).
  - **Before the pilot** · proved: e2e: both children on one agenda, named · yours: cancelled / closed / moved in words; water temperature
- [ ] *Vou / Não vou*: allowed for a live guardian, or the student from 12, never a guess with no birth date; refused once the lesson started.
  - *Pilot finds it* · proved: e2e: Não vou in one tap · yours: refused once started; the from-12 rule
- [ ] Lesson page: plan readable only for a day the child was enrolled; feedback form inside the window.
  - *Pilot finds it* · proved: e2e: the lesson opens with its plan or a sentence · yours: the enrolled-day rule
- [ ] Pagamentos: what is owed = `balance`; *Como pagar* = IBAN + MB WAY with copy buttons + reference (open document numbers, else the child's name); matches the reminder email.
  - **Before the pilot** · proved: API: a guardian reads IBAN, MB WAY and the reference; family fees · yours: against a real family
- [ ] Join a class from the phone (POOLSE-121) → appears in Pedidos.
  - *Pilot finds it* · proved: e2e POOLSE-121; API app requests (e2e not re-run 12-11: demo club unseeded) · yours: one request from a phone
- [ ] Perfil: language/theme, opt-out, club switcher, devices signed in, **push switch prompts only on tap**; tap a notification → opens its lesson.
  - *Pilot finds it* · proved: e2e: Perfil reads then edits, Idioma sheet, push never prompts on load · yours: devices, a notification opening its lesson
- [ ] Install: iOS Add to Home Screen (icon, name, no browser chrome, notch cleared); Android install prompt; theme toggle applies at once (POOLSE-99); text cursor visible in inputs (POOLSE-95).
  - **Before the pilot** · proved: e2e: manifest, iOS tags, nothing blocks Android install · yours: installing on your iPhone and an Android — the pilot's first impression
- [ ] A guardian: cannot open another child's id (404), cannot see staff contacts, the price list, or a co-guardian's phone.
  - **Before the pilot** · proved: e2e: a stranger's id is a 404 · yours: staff contacts, price list, co-guardian phone (privacy)

## 15. Instructor app (`/app/aulas`, `?semana`) — tier 1, both phones
- [ ] Today's lessons: regular instructor sees own; a stand-in sees the class he covers and the regular one does not; a lesson with the register owed stays as the next.
  - **Before the pilot** · proved: API stand-in; e2e: /app is their lessons, a lesson opens its register · yours: the owed register staying next
- [ ] Register: present / falta / justificada, notices shown as chips, pre-marks nothing; plan sheet; Cancelar aula allowed per `canCancel`.
  - **Before the pilot** · proved: e2e poolside QA 5–6 and POOLSE-180 (e2e not re-run 12-11: demo club unseeded) · yours: one lesson on a real phone
- [x] Multi-sport: instructor scoped to one sport reads only its students (403, never an empty list elsewhere). — *✔ Claude 12-11-2026: API POOLSE-145 b/c*

## 16. O meu perfil (backoffice) + Subscrição (owner) — tier 2
- [ ] Photo → Clerk and back; locale/theme persist across devices; sessions list + revoke; opt-out.
  - *Pilot finds it* · yours: all of it
- [ ] Subscrição: with no Stripe key says *pagamentos ainda não configurados*; with staging keys: checkout on Stripe's page, portal, interval switch, `past_due` keeps the club open, read-only trial can still pay. **Do this in staging with test keys, never a live account.**
  - *Pilot finds it* · proved: API subscription and Stripe events · yours: staging keys — the pilot is free, so this waits for the first paying club

## 17. Public pages (no login): `/<slug>` form, `/public/water/<token>`, `/email/<token>`, `/join/<token>` — desk + phone
- [ ] Each carries the complaints-book link and the regulation in force; `?lang=en`; every miss is the same 404; throttled per token/slug.
  - **Before the pilot** · proved: DB public notices; API throttle · yours: by eye on each page (legal)
- [x] `/join` signed out: *Criar conta / Entrar* returns to the same link with the address seeded; accepting lands in `/app`. — *✔ Claude 12-11-2026: e2e invitation: reads with no account, the account links come back to it*

## 18. `/admin` (Rui only) — tier 3
- [ ] Tenants: trial dates, grant a new trial (frees the address), read-only, suspend (name typed back, reason required), archive, manual payment moves `paid_through` only forward, modules on/off (dependency 409), sports on/off (in-use 409), AI readers tick + cap + usage € , platform switches, support request / force (4 h, alert), health dots, backup check.
  - *Pilot finds it* · proved: API: trial dates, suspend needs name and reason, one tenant only, grants per column · yours: the rest; it is your own screen
- [x] A non-admin gets 403 and the refusal is logged; `/platform` 60/min ceiling. — *✔ Claude 12-11-2026: API platform hardening 64.5–64.6*

---

## Cross-cutting passes (one evening each)

- **Importers/exporters round trip** — alunos, horário, parcerias, salários, inventário, mínimos, água, energia faturas, sócios, exame médico: export → import → preview says nothing to do → commit writes 0 rows. Under `en` and `pt-PT` both.
  - **Before the pilot** · proved: API round trips for alunos, parcerias, salários · yours: horário, inventário, mínimos, água, faturas, sócios, exame; under `en` too
- **Role probe on screens** — as instructor/maintenance/guardian/student: every menu entry visible should open; every URL from the owner's menu pasted in should 403/404 cleanly (*not allowed*, not a crash).
  - **Before the pilot** · proved: API role probe calls every route as every role · yours: the screens and pasted URLs
- **Email + push** — set Resend to a real sandbox, trigger: invitation, water alert, lab não conforme, qualification crossing, message, closure, cancellation, reminder, IBAN change, trial notice, level change. Each arrives once; a failed one retries hourly.
  - *Pilot finds it* · yours: the pilot runs without email (Rui 10-11); push on real phones
- **Retention** — on a copy: a student left > 1 year → health gone; > 5 → identity anonymised; invoices keep their snapshot.
  - *Pilot finds it* · proved: API: health after 1 year, identity after 5 · yours: on a copy; invoices keep their snapshot
- **Bin + revert** — archive each of the ten restorable kinds, restore from the bin, *Anular* on the toast; revert a student field edit; a field changed since → 409 with three values.
  - *Pilot finds it* · proved: API: restore conflicts, twice, licence; revert 409 with three values, revert of a revert · yours: the ten kinds by hand

## Findings — paste back in this shape

```
screen | role | device (desk / iPhone / Android, installed?) | what you did | what you saw | what you expected | severity (blocks go-live / before invite / later)
```

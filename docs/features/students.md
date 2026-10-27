# Students — the adult and senior path

What a club records about a person, and how that differs when the person is an adult.

## Which path somebody is on

An **adult** is a student at or above the club's own `age_of_majority` with **no live guardian
link**. The absence of the edge is the definition — there is deliberately no `is_adult`
column, so correcting a birth date or adding a guardian moves somebody between paths with
nothing to migrate.

Two consequences worth stating, because both are easy to get wrong from age alone:

- An **adult who has a guardian** is on the guardian path. A supported adult is precisely the
  case the distinction exists for.
- A student with **no birth date on file** is on the guardian path. Guessing "adult" for
  missing data skips the guardian block for a child nobody has finished registering, which is
  the mistake you cannot recover from; guessing the other way asks for a guardian an adult is
  then corrected out of.

The answer is computed **once, on the server** (`student_is_adult_path`) and travels with the
medical page as `enrolment`. The screens branch on it; none of them re-derives it.

## Consent

The server chooses the form — `self` for the adult path, `guardian` for everyone else — and
**validates it on the way back**. A request that claims a fifteen-year-old with a guardian
signed for themselves is refused with **422**, and so is one claiming a guardian signed for an
adult who has none. The request is well-formed; what is wrong is the claim about who signed,
which only the server is in a position to check.

A caller that says nothing about who signed is accepted. `signedBy` is optional, and absent
means "the client did not say" rather than "the client said self".

## Medical and mobility notes

**Mobility and physical limitations sit beside the medical notes**, in the same table, under
the same encryption, the same audited read and the same permission. They are the same class of
fact: something about a person's body that whoever is at the poolside needs to know before that
person is in the water.

**Who may read them: the owner, an admin, and any instructor.** Slice 1.12 settled this for the
medical notes and considered narrowing it to an instructor's own turmas — rejected, because the
person covering a colleague's class at short notice is exactly who would be locked out. The
**unconditional audit log** is what makes the open read safe: every read is an event, recorded
with who did it. The note itself is never written to the log.

Writing is the owner and admins. Both boxes save together, under one Save.

## The emergency contact

Who to call. It is **either a person already in the club or a name and a number**, never both —
a link keeps the name right when that person changes it, and choosing one clears the other
rather than refusing the pair.

**Naming somebody grants them nothing**: no role, no login, no access to the student's record,
and no place in any guardian list. That is a property of the shape rather than of a check — the
contact is three columns on `student`, touching neither `membership_role` nor `guardian_link`,
so there is no path by which it could confer anything. The form says so in words, because a
contact block under a medical page looks exactly like the guardian block one screen over.

The person is **found by name** (POOLSE-109): type two letters and the club's people whose
name contains them appear, accents and case aside, each with their roles, twenty at most
(`GET /students/:id/emergency-contact/candidates?q=`, owner and admin). It replaced a list of
every member, which was unusable at 300 people. *Alterar* clears the person and brings back the
typed name and phone, for somebody outside the club. Support logins are never offered.

## The atestado on a medical leave

POOLSE-109. Each medical leave takes **one atestado** — PDF or a photograph, 10 MB — and
replacing it keeps the earlier file.

| Action | Who |
|---|---|
| Attach or replace | owner, admin; and the child's own family (the student, or a live encarregado) from app mode |
| Remove | owner, admin |
| Open the file, see earlier ones | owner, admin; the family opens its own child's current one |
| Know it is attached, and when | the coach (instructor) — never the file or its name |

- **Encrypted at rest**, with a key of its own per file, and read only through `GET /files/:id`.
  Every download is in the audit log (`file.read`: who, which student, when).
- **On the staff page** (Saúde e consentimentos → Baixa médica) the office files it on the
  leave once the leave is saved, and sees who attached each version and who replaced it.
- **In app mode** a family sees *Atestados médicos* on `/app/familia`. It lists the leaves the
  club recorded for its children, current or ended in the last 90 days, with the dates and its
  file, never the reason. A family records no leave itself; the office does.
- **Retention**: an atestado is destroyed 24 months after its leave is removed, or as soon as
  the student's health data is erased or the student is anonymised. Its key is deleted, so the
  stored bytes can never be read again. The upload control says so.
- **Export**: the Excel student export carries no atestado. A GDPR data export does not exist
  yet; when one is built it must include the file.

## The fee category

Why one person pays a different price from the person in the next lane: **Sénior**,
**Estudante**, **Funcionário**. A club invents its own, so it is a list the club maintains
rather than a fixed set.

**The category carries what it is worth** — a percentage or a fixed amount, one or the other
or neither. This *reverses* POOLSE-23's "a reference, never a percentage": nothing consulted
the reference, so a club giving seniors 20 % off typed −20 and the word "sénior" into a
free-text reason once per family. One decision with forty authors is exactly what the original
rule was written to prevent. `docs/decisions.md`, 2026-09-14.

**A category with no value is still a category.** It is a label — a club may keep
"Funcionário" to count them — and it is not 0 %, which would be a decision somebody took.
Nothing is charged differently for it.

**The figure is snapshotted onto the fee line.** Correcting what a category is worth reaches
every line agreed *afterwards* and none agreed before, exactly as the price list does: a line
that re-read its category would re-price a family the moment somebody fixed a typo. Renaming
still reaches everything at once, because the line holds the id.

**One author, never two.** A line's discount comes from a category or from a person, and the
form is a single control with three answers — no discount, one of the club's concessions, or a
figure typed with a reason. A request carrying both is refused rather than resolved by
precedence. A typed discount still requires a reason; the category *is* the reason for the
other kind.

**All four fee kinds.** A senior concession on the quota and a waived inscrição for staff are
both ordinary, and the schema treats the four as one price list.

**Set on the turma or on the enrolment, and the enrolment wins.** A senior turma carries the
category so nobody types it forty times; the one member of it who is staff carries their own.
Clearing a person's own category puts them back on their turma's — *not* on none, which is why
that clear is its own action rather than saving an empty value.

When a fee is charged, the student's category is **suggested** — the one every live enrolment
of theirs resolves to, and nothing at all the moment two of them disagree, because a child in a
senior turma and a staff turma is somebody a person has to choose for. A suggestion is
pre-selected and confirmed, never applied behind somebody's back, and an *existing* line shows
what it was agreed at rather than what would be suggested today.

A category a turma or an enrolment still names cannot be archived, and the refusal counts both.
Fee lines are deliberately not counted: a line holds the figure it snapshotted rather than a
live reference, so old lines naming an archived category read correctly, and counting them
would make a category unarchivable for ever the first time it was used.

Reading the **names** is open to anyone who may see a turma — the label is printed beside a
turma and on an enrolment. Reading what a category is **worth** is not: the price list refuses
an instructor outright, so the values come back null with `canSeeValues: false` beside them
rather than as a blank that would read as "no discount". Writing is the owner and admins.

**Where each is set.** The club's list is a panel on each site's page, under **Instalações →
*site* → Preços**, ordered by dragging rather than by a typed position — the same control the
levels ladder uses, keyboard included. The old **Alunos → Categorias** route redirects there. The list is still the
club's and organization-scoped — the same categories on every site — and the panel says so,
because a "Sénior" meaning one thing at one pool and another at the next is a concession nobody
could report on. A turma's category is part of the turma's own form, beside its level and its
pool — there is deliberately no separate endpoint for that one field, because a second write
path is how two screens end up disagreeing about what was saved. A student's own category is
set from their enrolment, which has no form of its own.

On a document, the concession is printed by name beside the line: the amount is already net of
the discount, so without it an invoice says 28,00 where the price list says 35,00 and nothing
accounts for the rest. The name is snapshotted onto `invoice_line`, like every other name on a
document.

## Both capacities, one record

A person who is an adult student **and** an encarregado de educação is one record and appears
once in Alunos, with a badge for each. She has to: the list is over `student`, and she has one
student record.

The half worth stating is how "guardian" is asked. It is an **outbound** edge — she is
somebody's encarregada. Asking "does this person have any guardian edges at all" finds the ones
she holds over her granddaughter, which would take her off the adult path and address her own
consent form to a parent she does not have.

## On a phone: who to ring, and the seguro (POOLSE-88)

A student's General tab opens with two things an instructor at the poolside needs. Both are for staff only.

- **The seguro line.** It reads covered until a date, the cover ran out, or never insured. It is the fees read's own `readCover`, carried on `GET /students/:id` as `cover`. An instructor sees it without seeing what anybody pays, and the field holds no amounts. A family's `cover` is null, because its fees tab says it.
- **Contactos.** The guardians, the primary contact first, then the student's own contacts. Each phone is a `tel:` link and each address a `mailto:`. It is read-only: the editing form below changes the numbers.

The facts list stacks label over value below `sm`. A NIF field opens the numeric keypad, and a phone field is `type="tel"`.

## A family reads its own record

Since 15 October 2026 (Rui), a guardian opens *Os meus educandos* and a student opens *O meu
registo*. `GET /family` lists the reader's own records: the children they are a live guardian
of, and themselves as a student. One record goes straight to its page.

The record is the staff page in a read-only family mode (`familyView` from `GET /students/:id`):

- **General**, without the club's internal notes. Another guardian is named but their contacts,
  NIF and address are left out.
- **Mensalidades**, through `GET /students/:id/fees`'s family path: the lines, paid or due, and
  what is outstanding. Discount reasons, the club's concessions and the charges it could add are
  left out. The totals are the API's `balance` (`billing/fee-balance.ts`), which the office's
  block and the family dashboard card read too.
- **Turmas**, **Semana** with each lesson's plan, **Reposições** and **Progress**.

Never shown: the medical record, the identity document, any form. Somebody else's child is a
404. An instructor is still refused a family's fees with a 403.

## The Semana tab — a student's dated week

The week the student is actually in, Monday to Sunday, with *Semana anterior*, *Esta semana*
and *Semana seguinte*. The heading writes the week out — *16 a 22 de novembro de 2026* /
*16–22 November 2026* — and each day is its weekday over its date (POOLSE-108). Stepping
fetches only the week and changes only `?week=` in the address: the tab, the way back
(`?from=`) and anything else stay, so a reload comes back to the same tab and week, and
Voltar still returns to the screen the page was opened from. Browser Back leaves the page
rather than stepping back a week.

## Levels

Senior levels sit in the **same ladder** as everything else, ordered by the same `sort_order`
and bounded by the same age range. Not a parallel programme: POOLSE-19's "next level" logic
walks that one ladder, and a second list would need a branch in it.

### Advancement by age — POOLSE-112

A child advances for two reasons. **By skills**, mid-season, when every required skill of
their level is attained (POOLSE-19: a trigger proposes, a person confirms into a turma). **By
age**, at the season change: when a season is published, every student whose age **on its
first day** is above their level's maximum is proposed, reason *idade*, into the **first level
after theirs in the ladder whose band admits that age** (and their sex) — a nine-year-old
skips a level that also stops at eight. A child below a level's minimum is flagged on the
queue and never proposed down. A child who has left (`student_left_on()`), or has no birth
date, is never proposed. Both reasons share one queue (`transfer_proposal.reason`), one card
and one confirm path; the card says which it was.

**The card picks its turma in `TurmaPicker`** (POOLSE-113), the same component as Pedidos: one
picker, the *A partir de* date and one *Confirmar* per card. The rows are the proposal's
candidates only — turmas at the level being advanced to, with a seat — **grouped by why they
rank, in rank order**: *Mesmo dia e hora*, *Mesmo instrutor*, *Com vaga*. Each row shows its
slots, its instructor (named from their own record when they have no login) and how full it is.
A full turma is not offered; if one fills between loading the page and confirming, the card says
the seat went and the proposal stays pending. With no candidates there is no picker, only the
*sem vaga* sentence. On an applied proposal the picker sits under *nível já alterado*, and
confirming moves only the enrolment.

**The club chooses how automatic it is**, on the Níveis page (owner and admin;
`PATCH /levels/advancement-mode`): *Propor* (default) queues for a person to confirm with the
turma; *Aplicar automaticamente* moves the level on the season's first day — a nightly pass
(`AdvancementApplyService`, 04:20 Lisbon, per-tenant advisory lock) acting as *sistema*
through `setStudentLevelIn`, so the student's Atividade records it with no actor and
*Reverter* (POOLSE-80) puts it back. The proposal stays in the queue marked *nível já
alterado* and only the turma is left to pick; confirming it then moves the enrolment and
nothing else — unless the move was reverted since, in which case confirming moves the level
again. The pass acts only on a child still at the level being left: one a person already moved
to the target is marked done with no second email, and one moved anywhere else leaves the queue
(*retirada*, in Atividade). A skill marked at the old level never withdraws an age proposal.

**The queue is informative when empty** (`GET /transfer-proposals/outlook`): the next season
change — the earliest season starting after today, draft or published — with how many will
move under the current mode; and per level, who is above or below the band *today*, with
*Propor* (owner and admin, `POST /transfer-proposals/propose-by-age`, one level or all) to
queue the ones above now, judged on today — the day the counts beside it use — and filed under
the running season. Pressing it twice queues nothing new,
and a dismissal is kept for that season.

**The family is told** whenever a level changes through the queue — a person's confirmation
or the automatic pass — by `level_change_notice`, the `payment_change_notice` pattern: written
in the transaction, the live guardians' addresses (else the student's) snapshotted, emailed
after the commit by `deliverLevelChangeNotice` and retried hourly. It is account mail about one
child, not a club *message*: no daily quota and no opt-out reads it.

## The competition pathway — POOLSE-81

**A level can be marked *Competição*** on the Escalões page (pré-competição, competição). It is the
same ladder: POOLSE-19's advancement proposes swimmers into it like any level. A student in a
competitive level with no **Licença FPN** gets a warning on their record — never a gate; they are
enrolled and marked as before.

**The FPN licence** is on the student form and its General tab, optional, unique per club (a second
student with the same number is refused with a sentence). It travels in the student import and
export (*Licença FPN*); an import fills it only where nobody else in the club holds it. It is
identity: retention clears it, and the activity log names it without its value.

**Every time states its pool** — *Piscina de 25 m*, *de 50 m*, or *não indicada*. The time form
starts on the length of the turma's pool. Bests are shown one table per pool; a time with no pool is
its own table and counts as neither. A time may name the **meet** it was swum at — an existing one,
or a new one named on the form and marked *Prova oficial* (Rui, 19-10-2026). Where the best is not
from an official meet, the best at an official meet is shown beside it, because that is what
qualifying reads. Owner, admin and instructor record; a family reads its own child's times in
Progressão and nothing else.

### Provas — importing a meet's results (slice 2)

**Competição → Provas** under Alunos (renamed 20-10-2026) lists the meets, newest first, paged. *Importar resultados* takes the
meet's **LENEX** file — `.lef`, or a `.lxf` holding exactly one `.lef`, up to 10 MB — dropped on the
page or chosen. The file is read on the Next server (`lib/lenex.ts`) and never leaves it.

1. **The club.** A results file holds every club at the meet; the operator picks this one, and it is
   remembered (`organization.federation_club_code`) and pre-selected next time. Only its swimmers are
   sent to the API.
2. **The preview.** A swimmer whose FPN licence matches a student is matched. One with the same
   surname, first name and birth date is **proposed** and imported only if confirmed — and gains the
   file's licence, ticked by default, if they had none. Anybody else is **unmatched**: listed, never
   created, nothing written. Relays, DSQ/DNS/DNF/WDR, no time (NT), yards and unknown strokes are
   skipped and counted. Each row says whether it is new, a corrected time, or already there, and
   whether it is a new personal best.
3. **The commit** writes all of it in one transaction or none. A heat and a final are two results; a
   second import of the same file writes nothing, and a corrected time is one audited update.

*Prova oficial* is ticked for an imported meet and can be unticked for a friendly. The meet's page
shows the club's results with their PB marks and a warning beside a competitive swimmer with no
licence, and lists the unmatched by name. **Who:** owner, admin and every instructor import and read;
archiving a meet (with its results) is owner and admin, restorable from Arquivados. The parser
refuses any DOCTYPE or entity, a `.lxf` with two `.lef`s or a nested archive, and anything that
inflates past 40 MB.

### A meet on paper (POOLSE-115)

*Imprimir / Guardar PDF* on a meet's page opens `provas/[id]/print` in its own tab with the print
dialog: the browser's "Guardar como PDF", like every other print page. A4 portrait, black on white in
either theme. The header has the club's name and logo, the meet, its dates, city and course, whether it
was *Oficial* or *Particular*, and how many swimmers and results it holds. Results are grouped
**by swimmer**, alphabetically by the name as the club writes it, with events in FPN order. They can
instead be grouped **by event**, with swimmers by time. The columns are *Prova*, *Tempo*, *Escalão*
and *Obs.* The *Escalão* column appears only when the club has set that season's FPN age groups.
*Obs.* is words, never colour: **RP** for a time that is still the swimmer's best, and **Mín.**
followed by the standard's name for each live standard whose entry time the swim met
(`qualifying_attempts()`). A friendly or 25 m swim is never a mínimo. A swimmer's block stays on one
page when it fits, and its heading repeats on a page it continues onto. Every page carries
*Gerado pelo Poolse em …* and *n / N* in its margin, where the browser supports it.

The options *Todos os nadadores / Só com recorde pessoal / Só com mínimos* and *Por nadador / Por
prova* filter the **results** (a swimmer appears if they have one) and live in the address, so the tab
reloads and is shared as it is. Only the meet page's button adds `print=1`, which opens the dialog;
changing an option does not. The unmatched swimmers are not listed: one line says how many of the
file's results matched nobody, so the sheet never passes for the whole file. DSQ and DNS do not
appear, because the import skips them and they are never stored. **Who:** whoever can read the meet
(owner, admin, every instructor), because the sheet reads `GET /meets/:id`. Another club's meet is
a 404.

## Mínimos — gap to qualify (POOLSE-85)

**The club types each championship's entry times; the FPN's age groups come in one click** (POOLSE-111, Rui 23-10-2026, reversing "Poolse ships none" of 19-10 for this one table). *Criar os escalões FPN desta época* — on Escalões, and on a standard's Tempos tab while the season has none — creates the federation's nine natação pura groups, Cadetes C (9 and under) to Seniores (19 and over), one ladder for both sexes, as birth years for the year the season ends in: for 2025/2026, Cadetes A is born 2014 and Juniores 2008–2009 (FPN Comunicado 26/25). Groups the season already has are left alone; all are edited or archived like any other. Under **Competição**, two more
entries, each its own route (`/provas/minimos`, `/provas/escaloes`):

- **Escalões FPN** — the FPN's age groups for a season: a name, a gender (or both) and the birth years.
  Girls a year earlier is two rows, not a rule. They are not the club's levels and change nobody's
  turma.
- **Mínimos** — a championship's entry times for a season, with an optional window (else the whole
  season). Its page has **Tempos** — one age group at a time, the FPN's individual events down and
  25 m / 50 m across, typed as `1:05,00` or `28,91` and read by the same `parseSwimTime`
  (`@poolse/rules`) the API uses — and **Nadadores**, the coach's board: swimmers in competitive
  levels or with an official time, what each has qualified for and what is within 1, 2 or 5 s, and
  the competitive swimmers no band admits (no birth date, or no band fits).

**Tempos is always a table** (POOLSE-111). A standard opens on *Tempos* once the season has groups (*Geral* stays first in the strip). With none, the tab still draws every FPN event, greyed and disabled, under *"Esta época ainda não tem escalões FPN. Os tempos são por escalão."*, with the one-click button and a link to Escalões; the click lands back on Tempos on the first group. The group pills are led by *Escalão:*.

**Born from / born up to are year wheels** (`YearWheel`): a five-row listbox, newest year first, with *Sem limite* for an open end — scroll, arrows (PageUp/PageDown five), Home/End, or type a year to jump to it; a plain number field before the page's script runs. The API takes a year within the last hundred years up to this one, and refuses *from* after *to*.

**Results are imported from LENEX only** (Rui, 22-10-2026): the import says *"Ficheiro LENEX (.lef/.lxf), o formato que a FPN e o ranking nacional exportam."* and links *Como obter o ficheiro* to the FPN's site. A results PDF is a picture of that data and an Excel is whatever the organiser typed; neither carries the licence, event, course and exact time a swimmer is matched by.

**What counts** is the best time at an **official** meet, in the **same pool length**, inside the
window. 25 m and 50 m are never converted; no valid time is said in words and is never a gap. A
swimmer's band is derived from birth year, gender and season — no birth date, no band.

**On Progressão**, a *Mínimos* tab appears when the published season has a standard with times: the
swimmer's band and, per standard, entry time, best valid time and gap. Families see it for their own
child. **Who:** owner, admin and instructor create and type; archiving a band or a standard (with its
times) is owner and admin.

**Importing entry times (slice 2).** *Importar tempos* on a standard's Tempos tab reads the FPN's
table as published — one row per event, one column per age group and gender — from Excel, CSV or,
with the PDF reader switched on, a PDF. The operator says once whether the file is 25 m or 50 m.
Columns are matched to the season's age groups: "Juvenis F" is certain, a bare "Juvenis" over two
bands is asked. The preview says per cell *novo*, *substitui 1:05.00*, *igual* or why it is refused
(a relay or unknown event, an unreadable time, a band not of this season, the same cell twice). An
empty cell in the file leaves the existing time alone; clearing is the grid's job. The commit is one
transaction. *Exportar 50 m / 25 m* writes the same shape back, and a round trip changes nothing
(`qualifying-sheet.test.ts`, against the catalogue in both languages). Who: owner, admin and instructor.

## Not built yet

- **AC7 — communications routed to the adult student rather than a guardian.** There is
  nothing to route: `notifications/` sends invitation and vacation email and no messaging
  feature exists. The rule is written down in the ticket and should be built with the feature
  it belongs to, not stubbed ahead of it. It is the only criterion of POOLSE-23 still open.

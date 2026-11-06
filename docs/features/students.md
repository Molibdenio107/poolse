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

## Feedback after a lesson — staff side (POOLSE-116)

What a student or their guardian said about a lesson they attended (the family side is in
`docs/features/app.md`). Each entry shows a face with its word, the comment, who wrote it
(*Pelo aluno*, or *Por {name}, encarregado de educação*, derived from the author's relation to the
student and never stored) and when.

- **On the lesson's register**, below the roll: every answer for the lesson. Owner and admin see
  them all. An instructor sees them only for a lesson they taught (`resolved_instructor_id`), so a
  stand-in reads the night they covered and the regular instructor does not. A colleague's
  register shows no strip.
- **On the student's record**, its own *Feedback* tab (staff only), newest lesson first, paginated
  (`GET /students/:id/feedback`) under the same rule. It has its own tab rather than sitting on
  *Semana*, because one card is one tab and the week tab is a calendar.
- **Arquivar** (owner and admin, `POST /feedback/:id/archive`) removes an answer from both views
  and reopens the family's box. The toast offers *Anular*, and Arquivados restores it. Maintenance
  and families are refused, and another club's student is a 404.

## Inviting a family into the app — POOLSE-129

*Acesso à app* is a staff tab on the student's record. It lists everyone on the record who may hold a
login: each live guardian, and the student themself once they are 12 (`self_answer_min_age()`, the
rule `family_may_answer` reads; no birth date, no row). Each row says its state in words — *Sem
convite*, *Convite enviado em dd-MM-yyyy* (or *Link criado em*), *Convite expirado em*, *Usa a app*.

- **Two ways in.** *Enviar convite por email* sends the ordinary invitation email; a person with no
  address on file gets a box, and the address typed there is saved on the person (409 `email_taken`
  if another live person in the club holds it). *Criar link para partilhar* makes an invitation with
  **no address**, and *Partilhar* opens the phone's share menu (WhatsApp, SMS) with the club's message
  and the link; with no share menu it copies them. The link is shown once — only its hash is stored —
  so a pending invitation offers *Novo link* (the old token dies) and *Cancelar convite*.
- **The invitation names the person the club already has.** `invitation.membership_id` is the
  guardian's own membership, or the student's (made on the first invitation, active, carrying
  `student`, holding the student's name until a login binds). Nothing makes a placeholder, so
  accepting binds the login to the record the child's `guardian_link` already points at. Accepted by
  somebody already in the club (a parent who also teaches), `accept_invitation` merges the guardian
  record into theirs with `merge_memberships`, so the link follows the login.
- **Who may.** Owner and admin for any student; an instructor for a student actively enrolled in a
  turma they teach (403 `not_your_student`, echoed as `canInvite`); a support session never.
- **One live invitation per person** (unique index on `membership_id`); an expired one is withdrawn
  when a new one is made. A staff invitation still needs an address, by CHECK.
- **Convidar aluno** on Alunos (owner/admin, Rui 30-10-2026) is for somebody not yet registered: first
  name, surname, a phone and/or an email. `POST /family-invitations/new-student` creates the student by
  the ordinary insert and invites them in one transaction (no birth date, so the 12-year rule is waived
  for this one path), emails if there is an address, and returns the link for *Partilhar*. A taken
  address is a 409 and leaves no student behind.
- **Convidar para a app** on the record's General tab opens the same rows in place, one student at a
  time; it shows only while somebody on the record has not joined.
- **Convidar membros** (renamed from *Convidar famílias*) on Alunos takes the list's search and level, previews (students, by email,
  phone only, already invited, in the app) and sends the email invitations in one transaction under
  an advisory lock; phone-only families stay on **Por convidar** (`?invite=pending`, the same
  predicate, `HAS_UNINVITED`). An instructor's run covers their own turmas. **200 family invitations
  per club per Lisbon day**, refused whole with the figures (409 `invitation_ceiling`). Invitations
  are account mail: the family opt-out and the messages ceiling do not apply.
- Invitations still expire after 24 hours (`INVITATION_TTL_HOURS`). Family invitations sent from
  Pessoas before this change still accept, and do not show on the record.

## Identity and address — POOLSE-131

On the General tab, a folded *Identificação e morada* section: morada, localidade, código postal
(`0000-000`), filho/a de / e de, estado civil, profissão, habilitações, naturalidade, nacionalidade (a
country select, `Intl.DisplayNames`, Portugal first, ISO stored) and nº de utente (nine digits). All
optional, the student's own. `students/identity.ts` carries them as one group through every read and
write; a body without the group leaves them alone. Named and never valued in the change log; cleared on
anonymisation by the licence trigger. **The SNS number reaches owner and admin only** — everybody else
reads `snsRecorded`. The student import and export carry all eleven (a round trip changes nothing; an
existing student only has blanks filled).

## Last access — POOLSE-130

`app_user.last_seen_at`, stamped by `/me` (`touch_app_user_seen`, at most every 15 minutes, never failing
the read). *Acesso à app* reads *Usa a app · último acesso há 3 dias*, or *Entrou a …, sem acessos depois*.

## A date of birth the person gave — POOLSE-186

A new student on the desktop form needs a date of birth; imports and invitations may leave it blank. When the club's record is blank and the person's login holds a date, the record takes it once, unless a guardian is on the record. It shows *Data de nascimento por confirmar* to the owner and admins, and works at once for answering and sending in the app. It never counts for the adult path, so it does not decide who signs consent, until the office confirms it: with *Confirmar a data* on the record, or by accepting an ID document, which asks for the date as written on it. A warning, never a gate. Changing the date clears the confirmation.

## What a family sent — POOLSE-179

*Por rever* sits above the sections of the record's *Documentos* tab (`GET /students/:id/documents/submissions`, owner and admin). *Aceitar* files the copy through the office's own path, in one transaction, and an exam needs the result the office reads off it. *Rejeitar* files nothing: a sealed file is shredded, a plain one archived, and the family can send again. Both ask first, and a decision is final. Until then nothing on the record changes, so a pending exam is never the child's standing.

**Who sees it** (POOLSE-190): a student with anything waiting there, or a date of birth to confirm, raises a circle on *Alunos* (counting students; each sport's copy counts its own) and a dot beside the name in the list, in every filter and without changing the order. Owner and admin only; each clears when the thing is decided. Each line says *Enviado pelo aluno* or *Enviado pelo encarregado*, from who sent it and never from the age.

*Data de nascimento por confirmar* shows the date given. Its button opens the ID on *Documentos*: a copy waiting is accepted there, which confirms the date; a copy on file shows the same banner above it, and that one confirms. With no ID, it says so and confirms directly.

## Documentos — POOLSE-132

The tab formerly *Documento de identificação*. Three sections: **Identificação** (the ID upload, and the ID
document's type, number, issue and expiry — the number encrypted, shown as *registado*, decrypted only
for the print and audited as `student.id_document_read`), **Declaração FPN** and **Declaração FPN –
Menores** (only for a minor). Each FPN section keeps the student's FPN disciplines (seven checkboxes on
the record), picks the season from the club's seasons, lists what the form would print blank, prints the
FPN's *Anexo 2* filled from the record (`documentos/fpn`, always Portuguese, `lib/fpn-forms.ts`), and
files the signed scan per season in `student_document`, older copies kept. The club's *Associação* and
*Sigla FPN* are set in the same section (`PATCH /fpn-settings`). Owner and admin.

**The ID number is information on *Geral* and official on *Documentos*** (Rui, 01-11-2026). On *Geral* the
number is asked alone, with no type and no check, and stored as typed: changing it there clears the
type, because a number typed there is unverified. On *Documentos* the type is chosen, and a Cartão de
Cidadão is judged as the whole number the card prints under *N.º Documento*: 8 digits, the check digit,
two letters and a digit (`isValidCcNumber`). Choosing *Cartão de Cidadão* for a number already on file
judges that number too (`documents.error.ccStored`), and the refusal says what is expected, under the
field and in the toast.

**The ID document's photograph** (Rui, 30-10-2026) is filed on *Identificação* as a `student_document`
of kind `id_document` (no season, older ones kept), chosen or dropped anywhere on the page. With
the *Leitura do documento* switch on /admin → Plataforma (`platform_switch.id_document_ai`, off by default) and an API key, `lib/id-document-agent.ts` reads the type, number and dates
from it and proposes them in the form beside it; nothing is saved until a person confirms. Every upload
button takes a dropped file on its own area, and a photo box (`IdPhoto`) on the whole box
(`components/drop-target.tsx`).

## Exame médico — POOLSE-133

`medical_exam`: date, result (apto / apto condicionalmente / não apto), valid until (a missing one is a
year, labelled *estimada*), a note and an optional sealed certificate (a `medical_certificate` file,
attached once). The latest live row is the standing — *válido até*, *expirou a*, *sem exame* — judged
against `club_today()`. A warning, never a gate: shown on *Saúde e consentimentos* and in the register
beside the seguro. An instructor sees the state, never the note or the file. A spreadsheet import (match
by NIF, else name and birth date confirmed; never creates a student) and export, on one route with
`commit` — **removed 30-10-2026 (Rui)**: exams are kept per student only. A student has as many exams
as needed (one a season, or more), each with its own certificate: a certificate dropped anywhere on the
exam tab goes to the newest exam without one, or waits in the new-exam form and is attached when it is
saved. Erasing a student's health data clears the notes and shreds the certificates' keys (trigger).

## Boletim de sócio — POOLSE-134

On the student's *Documentos* tab, section *Boletim de sócio* (moved from Mensalidades, Rui 01-11-2026):
*Imprimir preenchido* (`/boletim`) and the signed copy filed in
`student_document` (kind `socio_form`, no season), older ones kept. The sócios list exports and imports
through the student sheet (`socios=1`), no second pipeline.

### The club's own boletim — POOLSE-142

On a site's **Documentos** tab (owner and admin) a club keeps its own paper forms, one section at a time. *Boletim de sócio* holds the club's membership form. *Declaração FPN* holds the club's copy of the FPN's Anexo 2, in two versions (*Maiores* / *Menores*), because the federation prints two forms (Rui, 01-11-2026). Each form is uploaded as a PDF or an image. A PDF's
first page is drawn to a JPEG in the browser (`lib/page-image.ts`, pdf.js), so the stored file (purpose
`boletim_template`, office only) is always an image.

The club then places Poolse's fields on it:
- arm a field in the list and click its line on the form;
- drag it, or nudge it with the arrow keys, and size it from 6 to 24 pt;
- *Guardar posições* saves the set. A field may be placed twice.

Positions are fractions of the page, and sizes are points of A4. `BoletimSheet` / `placementStyle` draw both the
editor and the print, so what is placed is what prints.

*Imprimir preenchido* then uses the club's form. It is written in Portuguese whatever the reader's language
(`boletimValue` in `@poolse/rules`: split dates, the month in words, the year's last two digits).

**Only the club's form prints** (Rui, 01-11-2026). Poolse no longer composes a boletim or an Anexo 2 of its own.
Without a form placed for that kind, the student's print button is replaced by a sentence and a link to
*Instalações → Documentos* (`NoClubForm`, from the documents read's `templates` and `templateSiteId`), and the
print route says the same.

**A white strip under each value** (`width`): the value prints on a white band from where it starts to where the
blank ends, slightly above and below the text, so whatever the scan has on that line (an old answer, a mark) never
shows through. A blank form is still the one to upload. A new text field starts with a strip (`defaultStripWidth`)
whose right edge is dragged (or `[` / `]`). It can be switched off, and a tick box never has one. The AI reader
proposes each blank's end as well.

The FPN declaration offers its own fields: the signer (the guardian on a minor's), the season, the club's association, FPN code and place, and the ID document's type, number and dates. It also offers one box per modalidade, which prints an X centred on the box where the student's own *Documentos* tab ticks it. The ticks are never taken from a level. Each kind offers only its own fields (`fieldsFor`, refused otherwise), and the student's *Documentos* print uses the club's adult or minor form when it is placed, with Poolse's one link away.

**The ID number and the SNS number are read only when the template places them**, and the ID read is audited
(`student.id_document_read`). Replacing the form drops its placements, and the screen asks first. Removing it
returns to Poolse's form.

**Slice B: the AI proposes the positions.** *Propor posições com IA* sends the stored form image and the field list, nothing about any student, to the sixth AI reader (`boletim_template`, `lib/boletim-template-agent.ts`). It is gated like the others: the `boletim_template_ai` switch on /admin, the club's tick, the monthly cap and a key, behind `guardAiCall` (owner and admin). Positions come back on a 0–1000 grid and are judged by `placementsFromGrid` in `@poolse/rules`. They fill in **only the fields not placed yet**, so nothing the club placed is moved. They load into the editor unsaved, for a person to adjust and save. A closed gate or a failed read is a sentence beside the button, and the manual editor always works.

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
page or chosen, or forwarded by email (below). The file is read on a server (`@poolse/rules/lenex`)
and never in the browser.

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

### Recebidos por email (POOLSE-114)

Each club has one results address, `resultados-<token>@<INBOUND_DOMAIN>`, shown in **Como obter os
resultados** under the import button (also on the empty meets list). That dialog says three things in
order: download the LENEX file from the FPN and drop it here; or forward the email carrying it to the
address (copy button) and confirm it here; and who may send. Poolse does not fetch from the FPN
itself: its site requires a human check, and no credentials are ever stored.

- **Who may send:** the `From` address of a live owner, admin or instructor of the club. Anybody
  else is dropped and logged (club, sender, reason) with **no reply**. An address the club has
  regenerated, a club with the Competição module off, and a closed or read-only club drop the same
  way.
- **What is taken:** every `.lef`/`.lxf` attachment up to 10 MB that the parser reads and that names
  a meet; the body and other attachments are ignored. A known sender whose message held nothing
  usable gets one reply in their language. One provider message is processed once per club.
- **Recebidos por email** is a fourth part of Competição (`/provas/recebidos`), offered only while it
  holds a file; its pill and the menu's Competição entry carry the count still to import. Newest
  first, 15 a page. *Importar* opens the ordinary import dialog with the file loaded, and the commit
  marks the row imported with a link to its meet; an imported file stays listed. *Rejeitar* (owner,
  admin) takes it off the list with an optional reason, audited. A file pending past 90 days is
  tagged *Antigo*; nothing is deleted on its own.
- **A new address** (owner, admin, in the dialog) stops the old one at once, audited.
- **No notice is sent** when a file lands (Rui, 28-10-2026): the count is the signal.
- `From` can be forged, as on any email. The sender rule keeps junk out of the list; nothing reaches
  a swimmer's record until a signed-in member imports and confirms.

Receiving needs `INBOUND_DOMAIN`, the Resend inbound webhook and the file bucket
(`docs/deploy.md`). Without them the dialog says receiving is not switched on.
`POST /webhooks/inbound-dev` takes one file, with `from`/`to`/`name` in the query and
`x-inbound-dev-secret`, so staging can be tested without DNS; it answers 404 unless
`INBOUND_DEV_SECRET` is set.

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
page when it fits, and its heading repeats on a page it continues onto. The sheet ends with
*Gerado pelo Poolse em …*, in the body so every browser prints it, and every page carries *n / N*
in its margin where the browser supports margin boxes. A result swum in another pool than the
meet's names its course in the event's title. *Escalão* reads one season: the meet's, and the
published one where a draft overlaps it.

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

**Results are imported from LENEX only** (Rui, 22-10-2026): the import says *"Ficheiro LENEX (.lef/.lxf), o formato que a FPN e o ranking nacional exportam."* and, under it, *Como obter os resultados* (POOLSE-114) links the FPN's site and gives the club's address for forwarding. A results PDF is a picture of that data and an Excel is whatever the organiser typed; neither carries the licence, event, course and exact time a swimmer is matched by.

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

## Modalidades — multi-sport Slice 3 (1 November 2026)

None of this appears for a pool-only club (`isMultiSport`).

- **The register.** Each row carries a `SportChip` per sport of the student's active turmas. A turma's sport is its
  recinto's (`STUDENT_SPORTS` in `students.repository.ts`, `pool` for a turma with none), never a level's.

  Above the list sits a chip row: *Todos · n*, one per sport with its count, and *Multi-modalidade · n*. The filters
  are `?sport=` and `?multi=1`; an unknown sport matches nobody. The counts come from `studentSportCounts`, one
  grouped statement, and are fetched only when the web asks (`sportCounts=1`), which it does only for a multi-sport
  club.
- **The record's *Turmas* tab** has one card per sport, the handoff's enrolment cards: the sport's 4 px bar, icon and
  name, then that sport's turmas with their attendance strips. With one sport it is one card, as before.
- **The combined mensalidade.** Under *Plano atual*, a student whose turmas span two or more sports gets one line:
  each sport's priced plans, then their total. A sport with nothing priced says *sem preço* and is never 0,00 €, and
  the line counts the unpriced turmas. These are the prices the turmas imply, not what is charged. Each
  `currentPlans` entry carries its turmas' `sport`.

## The export is the list it was asked from (sweep 01-11-2026)

*Exportar* under a filtered register exports that register: the search, the level, *Em atraso*
(`sort=overdue`) and, for a multi-sport club, the sport and *Multi-modalidade* chips. The page
always sent the overdue filter, and the export route dropped it; an export from *Em atraso* handed
over every student. `exportStudents` reads the list's own predicates (`PAYMENT_STATE`,
`STUDENT_SPORTS`), never a copy.

## Alunos per sport — POOLSE-143 (1 November 2026)

With a second sport on (`isMultiSport`):

- **Alunos.** Each sport's group has the register filtered by `?sport=`. The shared register
  stays, with a *Sem modalidade* chip for students in no live turma (`?sport=none`). The chips
  always include the sport being read, at 0 if it has nobody yet. `readSportFilter` checks the
  value against the club's sports: an unknown sport is a 400, not an empty list (this reverses
  Slice 3's "an unknown sport matches nobody").
- **Níveis** is one sport's ladder. `GET /students?sport=` lists only its levels, and
  `POST /levels` takes `sportId`, adding to the end of that sport's own ladder.
- **Avanços** (`GET /transfer-proposals?sport=`) is the proposals onto that sport's ladder.
- **Pedidos** gets a filtered copy per sport. A lead's sport is `LEAD_SPORT` in
  `leads.repository.ts`: the recinto of the turma asked for, else the level's sport, else none.
  It is never stored. The list, the chips (`sportCounts=1`) and the menu circle all read it.
- **Competição** is swimming only.

Instructors may filter any sport, as before, until POOLSE-145.

## A level in each sport — POOLSE-148, slice A (1 November 2026)

A student in two sports holds a level in each, and the two are independent (Rui, 01-11-2026).

- **The record's *Turmas* tab** has one card per sport, each with that sport's level. Swimming's
  is read-only there, because it is the *Nível · Natação* field on Geral. Every other sport's is a
  select of that sport's ladder and *Guardar*, for owner and admin
  (`PUT /students/:id/sport-level`, `{ sport, levelId }`; null clears it). A sport the student
  holds a level in gets its card even with no turma in it yet.
- **The Geral form's level is the swimming level.** With a second ladder in the club, its label
  says *Nível · Natação* and it lists only the swimming ladder. A level from another ladder is a
  400 under the field, never a 500.
- Each change is recorded as `student.sport_level_set` (sport, before, after). Reverting it from
  Atividade is slice C.
- **Not built yet:** a sport's *Alunos* row and level filter reading that sport's level (slice B),
  and advancement by skills and by age per sport (slice C).

## A level in each sport — slices B and C (1 November 2026)

- **A sport's *Alunos*** shows each student's level in that sport, and its *Nível* filter reads the
  same level (`LIST_LEVEL`). The shared register and the export read the swimming level, because
  the export re-imports into it.
- **Advancement is per sport.** A skills proposal comes from the skill's level, and an age proposal
  from each level the student holds. Both move to the next level of the **same** sport's ladder.
  Confirming a proposal, by hand or in the automatic mode, moves only that sport's level, and ends
  only the enrolments at the level being left. A swimmer's swimming level and turmas are untouched
  by a tennis move.
- **Not yet:** reverting another sport's level change from Atividade. It is recorded, but its revert
  needs its own path. POOLSE-148 says so.

## An instructor reads their sports' students (POOLSE-145, 02-11-2026)

The sports a staff member belongs to (set on their record) decide whose students an instructor
reads. `sportScope()` in `tenant/sport-scope.ts` is the one decision; `requireSport` refuses on it and
every list filters by it.

- **Owner and admin read every sport**; so does anybody who is not an instructor, and **an instructor
  who belongs to every sport the club has on** — every instructor of a pool-only club, which is
  therefore unchanged.
- **Alunos.** Another sport in `?sport=` is a 403 `sport_not_yours`, never an empty list; so is
  *Sem modalidade*. No sport asked for lists students with an active turma in one of the
  instructor's sports, and the *Modalidades* chips count those only.
- **A student's record** (and their timetable, calendar and times — every route behind
  `requireActsForStudent`) opens for an instructor only when the student has an active turma in one
  of their sports, or is their own child. Otherwise a 403 `sport_not_yours`, which the screen says
  in words.
- **Another sport's cards are absent, not blank.** A tennis instructor reading a student who also
  swims gets no swimming level and no federation licence in the JSON, and only their sports' levels
  and cards on *Turmas*.
- **A stand-in** (POOLSE-53) taking one lesson of another sport takes its register — the register
  has its own guard — and reads nothing more.
- **The menu** offers a scoped instructor only their sports' sections (`readableSports`, web).
- **Levels** (slice c): a scoped instructor's register offers their sports' ladders only.
- **Avanços**: another sport's queue is a 403; no sport asked for is their sports' proposals, *sem
  vaga* included.
- **Competition and times are swimming's** (`requireCompetition()`): qualifying, meets, the results
  inbox and a swimmer's *Progressão* refuse an instructor who does not teach swimming, and the
  record does not offer *Progressão* (`canViewProgress`).
- **The timetable** answers a scoped instructor their sports' turmas only. The attendance strip and
  the student's calendar stay whole: attendance is read as before (rule 4).
- **Lesson feedback** needs nothing new: an instructor already reads only the lessons they taught.

## Alunos as a table — POOLSE-164 (4 November 2026)

- **One *Filtros* row.** Search, *Desporto* (multi-sport clubs, shared register only), *Nível*, *Turma* (with
  *Sem turma*), *Seguro* (com seguro / caducado / sem seguro), *Em atraso* (owner and admin) and *Por convidar*,
  then *Limpar*. Every filter is in the URL (`modalidade`, `levelId`, `classGroupId`, `insurance`, `overdue=1`,
  `invite=pending`); a select's prompt is its bare name ("Nível") and no option carries a count. On a phone the
  row scrolls sideways. The old `sort=overdue`, `multi=1` and `sport=none` links still work.
- **`?modalidade=` is a filter, `?sport=` is a place** (Rui, 04-11-2026). The shared register's *Desporto*
  narrows the list and the menu stays on the club's section; `?sport=` is a sport's own *Alunos*, reached from its
  tab, and the menu follows it. Both reach the API as `sport`.
- **The count** ("63 alunos") sits in the table's top-right corner, filtered or not.
- **Long text keeps its start and ends in "…"** — "Hidroginást…" — by `shorten` (`lib/shorten.ts`):
  the name (its link's title holds the whole), the level and the turmas through `ShortText`
  (`components/short-text.tsx`), whose `Hint` opens on hover and keyboard focus and whose screen-reader text
  is the whole. The record's own page always says it in full. On a desk *Arquivar* is an icon square.
- **The table.** Nome, Idade (a link: youngest first, `order=age`, no birth date last), Desportos (multi-sport
  only), Nível, Turmas (active enrolments in live turmas), Seguro, Mensalidade (owner and admin), Acesso (the
  family's last visit — the student's own login or a live guardian's), and *Arquivar*. Below `md` it is
  `.table-stack` cards. The seguro is three words from `INSURANCE_STATE` (a live seguro line covering
  `club_today()`, else one that ended, else never); it is information and gates nothing.
- **The turma filter's options** are `turmas` on the list read (`listTurmaOptions`): live turmas, narrowed to the
  `?sport=` and to an instructor's own sports.
- **Exportar** carries the turma and seguro filters too, as it does the others, and writes two more columns:
  *Turmas* (names separated by `;`) after the level, and *Seguro* last — export-only, the Portuguese words in both
  locales, read back by nothing (no import field may claim its header, `sheet.test.ts`).
- **Importar reads a *Turma* column** (found as Turma, Turmas, Aula, Grupo, Classe, Class, Group…; "Grupo de
  nível" stays the level's). Optional: a name matched accent- and case-blind enrols the student through
  `insertEnrollment`, several split on `;` or, when the whole cell is no turma, on `,`. Two live turmas sharing a
  name resolve to the published season's, else the row warns *ambígua*. An unknown name is a warning and the
  student still imports. For a student already in the register a turma is a blank to fill: only enrolments
  they lack are added, never removed, so the round trip changes nothing. At commit each enrolment has its own
  savepoint: a full turma or a time clash refuses that one and is listed by line on the result screen (`matchTurmas`
  in `import.ts`, `enrolmentsRefused` on the result).
- *Convidar membros* sits on the header's right; *Convidar aluno* stays above the list. The page is `width="wide"`,
  the second wide page after the calendar.

## A linked adult's details — POOLSE-177

An adult-path student with a login reads their name, email, birth date and phone from their own account, on the record, the list, search and every document drawn from them. A guardian's phone reads through to the child's *Contactos* the same way (`person_phone`), and so does an emergency contact's. A minor with a login, and a student with none, are the club's record. A record with no birth date reads through too, when there is no guardian and the login's own date says adult; consent and age rules still wait for the club's date.

**The office** (owner, admin): a linked adult's name and email are read-only, with no label beside them (Rui, 05-11-2026), and a change is a 409 `field_owned_by_app_user`. Birth date and phone may be corrected: they land on the person's account, which is one row in every club they belong to, and the birth date also lands on the club's record, which the rules read. Audited on the student, named and never valued.

**The app:** *O meu perfil* says whose it is, *Encarregado de educação de …* or *A sua conta*. Editing it never changes a child's record.

Reading through costs the Alunos list its sort index, about 14 ms on 400 students. `docs/data-model.md`, *A student read through their login*.

## Older unpaid periods — POOLSE-187

`balance` counts every unpaid occurrence of a line, not only the current one, from the period holding the line's `created_at` or its start if later, because an earlier month may have been paid before Poolse. A payment or an external invoice settles one. An ended line owes up to its end, and stays among the running lines so the office can settle it. A late charge stays one per kind of charge.

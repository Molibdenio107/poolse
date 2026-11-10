# Staff

*Instalações → Staff*. This page starts with qualifications; the rest of the section (invitations,
roles, the staff record, Férias, Salários) is described in `navigation.md`, `salaries.md` and the
tickets that built it.

## Invitations: the page is public, the button is not (29-10-2026)

`/join?token=…` is a public route on the web and `GET /join/preview` is in `PUBLIC_ROUTES` on the
API. A person opening the link with no account reads the club, the roles offered, the address it
was sent to and the expiry first; the accept control is then *Criar conta* / *Entrar*, both of
which return to the same link, with the invited address seeded into sign-up. `POST /join` stays
authenticated: accepting binds an `app_user`, so the account must exist by then. The preview is
throttled per token (`publicInvitationTracker`), reads through `find_invitation_by_token` and
nothing else, and answers every miss as a status. The page has no Voltar — an invitee may belong
to nothing yet — and after accepting the way in is `/app`, which routes by role.

## Pessoas invites staff only (POOLSE-129, 30-10-2026)

The invite form on Pessoas offers admin, instructor and maintenance; `POST /invitations` refuses
`guardian` and `student` with 422 `family_role_from_student`, and Pessoas' pending list leaves family
invitations out. A family is invited from the student's record — `students.md`, *Inviting a family into
the app*. Pessoas already listed staff only (`scope=staff`).

## An email or a mobile identifies a person (30-10-2026, Rui)

The staff invite takes an email and/or a mobile. With no email it is a link, shared from the club's
phone (WhatsApp, SMS). The contact is looked up first (`findPersonByContact`: the email, or the last nine
digits of the mobile, so "+351 912 345 678" is "912345678"):

- **Somebody the club already has, with no login** (a guardian who will teach) — the invitation names
  their own record; no placeholder. The roles arrive with the login: `accept_invitation` adds them on
  binding, so nobody shows as staff before they answer.
- **Somebody who already signs in here** — 409 `person_in_app`, naming them; their roles change on
  their record.
- **A pending invitation to that email or mobile** — 409 `already_invited`; use *Novo link*.
- **Nobody** — a placeholder as before, carrying the mobile so the next lookup finds it.

*Convidar aluno* applies the same rule (409 `person_exists`).

## What nobody does to themselves, and what only the person does

Sweep of 15 October 2026:

- **A login's name is the person's.** On the staff record, an Owner, Admin or support session may not
  change the name of somebody who signs in (`name_is_theirs`). Clerk holds one name for them in every
  club. They change it under O meu perfil, and the record says so beside the name.
- **Nobody but the Owner decides their own leave**, sets their own entitlement or writes their own pay.
  An Admin's own rate is readable and set by the Owner (`compensation_not_your_own`, `own_request`,
  `own_entitlement`).
- **A merge never absorbs the Owner**, two records with their own login, or a support membership
  (`POST /people/merge` answers 409). History stays with the absorbed record, which points at the
  survivor (`merged_into`).

## The staff list is a table (POOLSE-158, 04-11-2026)

*Pessoas → Membros* (owner, admin) is a table: **Nome** (a link to the record), **E-mail**, one
**Desportos** column listing the person's sports by name and icon (only in a multi-sport club; Rui,
04-11-2026), one column per staff role under **Funções**, and **Acesso**. It is paginated at 10, and the search and the role chips work as before.

- A role cell is a **read-only mark**: a check glyph and *sim*, or a dash and *não*, for a
  screen reader. The record is where a role or a sport is changed.
- **The Desportos header is the sport filter** (`?sport=`), with no label above it: its prompt,
  *Desportos: todos*, is the select's first option, and the label is kept for a screen reader. `GET /people` reads it through
  `readSportFilter` and filters inside the paged statement, so the total counts the filtered set. A
  sport the club does not have is a 400. The role chips keep the chosen sport.
- **Acesso** says *Por aceitar* for an open invitation, *Sem conta na app* with no login, *Ainda sem
  acessos* for a login that has not been back, and *Último acesso há …* from `app_user.last_seen_at`
  (POOLSE-130) otherwise.
- Below `md` the table is `.table-stack`. A card shows only the marks that are set, and the filter
  stays above the cards (its header cell un-clips, as Em dívida's select-all does).
- Support memberships never appear (`support_grant_id IS NULL`, POOLSE-79).

## Who sees which staff screen (POOLSE-157, 04-11-2026)

Rui's sweep. *Workers* means owner, admin, instructor and maintenance; a guardian or a student is
refused every row below (403), their own id included. Each row is a role-probe test in
`security/role-probe.integration.test.ts` (*POOLSE-157 rule N*).

| Screen | Owner | Admin | Instructor, maintenance | Endpoints |
|---|---|---|---|---|
| Staff record → *Funções* | ✓ | ✓ | — | `POST /people/:id/roles`, `…/roles/:role/revoke` (a staff member's) |
| Staff record → *Acesso* | ✓ | — | — | `POST /staff/:id/reinvite`, `…/cancel` |
| *Férias* → *As minhas férias*, filing a request | ✓ | ✓ | ✓ | `GET /vacations/mine`, `POST /vacations/requests` |
| *Férias* → *Pedidos por aprovar*, reading | ✓ | ✓ | names and dates only | `GET /vacations/pending` |
| *Aprovar* / *Recusar* | ✓ | ✓ (not their own) | — | `POST /vacations/requests/:id/approve`, `…/reject` |
| *Férias* → *Mapa da equipa* | ✓ | ✓ | ✓ | `GET /vacations/team` |
| *Salários* | ✓ | ✓, not the Owner's | — | `GET /staff/salaries`, `…/summary`, `GET /staff/:id/compensation` |
| *Qualificações* (club list) | ✓ | ✓ | — | `GET /qualifications/expiring` |
| A person's *Qualificações* tab | ✓ | ✓ | their own | `GET /staff/:id/qualifications` |
| Faturação → *Abrir os dados do clube* | ✓ | ✓ | — | the page itself refuses anybody else |

- **The queue is read by every worker since POOLSE-157** (reversing story 8's office-only queue and
  map). The API sends a non-office reader `kind: null` and `reason: null` (*baixa médica* beside a
  colleague's name is health data) and `canDecide: false`. The page then shows the requests with no
  buttons, and a sentence saying who decides. The team map was always names and approved days.
- *Acesso* stays the Owner's alone. Re-inviting moves a login, which the ticket's "owner/admin" did
  not widen.
- `GET /staff/:id/qualifications` now checks for a working role before the self check. A guardian
  asking for their own id was answered before.

## Personal details (POOLSE-149, 02-11-2026)

A *Dados pessoais* card on the staff record's General tab: morada, código postal, localidade,
nacionalidade, naturalidade, NIF, NISS and an emergency contact (nome, telefone, relação). All
optional.

- **Who.** The Owner, an Admin and the person on their own record read and edit it
  (`GET/PATCH /staff/:id/details`). Anybody else gets a 403, and the card is not shown.
- **NIF and NISS are the club's.** The person reads theirs but cannot change them (403
  `forbidden_role`). Everything else the person keeps up to date themself.
- **Checks.** The NIF passes `isValidNif` and the NISS `isValidNiss`; the postcode is 0000-000.
  A refusal lands under its field and keeps what was typed. One NIF is one person in a club (409
  `tax_number_taken`).
- **The change log** (`membership.details_updated`) names the fields that moved, never their
  values.
- **Retention.** The NISS and the emergency contact go with the ID document after the person
  leaves (see below).

## Sports (POOLSE-145, 02-11-2026)

A staff member belongs to the sports the club assigns them — explicitly, by the Owner or an
Admin (Rui, 01-11-2026). Everybody belonged to swimming the day the column arrived, so a pool-only
club is unchanged.

- **Where.** In a club with more than one sport, an instructor's *Geral* tab has a *Desportos* card:
  the Owner and an Admin tick the sports (`PATCH /staff/:id/sports`, audited with before and after);
  the person reads theirs. The staff list shows a chip per person's sport.
- **Rules.** Never empty; only a sport the club has on. A sport with instructors assigned stays on
  for the club: the platform refuses to switch it off (409 `sport_has_staff`) and names them.
- **What it decides** (slice b): an instructor reads only their sports' students. See *Alunos per
  sport* in `students.md`.

## Contract (POOLSE-149, 02-11-2026)

A *Contrato* tab on the staff record: the signed contract (PDF, Word or a photograph), dropped
anywhere on the screen or picked, with earlier versions listed under it; and what it says — tipo
(sem termo, termo certo, termo incerto, prestação de serviços, estágio), data de início and data de
fim. **For reading only**: nothing in salaries or vacations reads it (Rui).

- **Who reads it is the pay rule.** The Owner, an Admin and the person. An Admin never sees the
  Owner's: the API answers 404 and the tab is absent.
- **Who writes it**: the Owner and an Admin, but not an Admin's own (403 `own_contract`) — the
  Owner files that, as the Owner writes an Admin's pay. The read returns `canEdit`, the guard's
  own answer.
- **Rules.** A termo certo needs its end date; a contrato sem termo has none; the end is not
  before the start.
- **Versions.** Filing a new contract keeps the previous one in the history; *Retirar* closes the
  current one, and it stays in the history too. The facts are named in the change log
  (`staff.contract_updated`), never valued.

## Date of birth and identity document (POOLSE-100)

An *Identificação* card on the staff record's General tab. It is read and edited by the Owner, an
Admin, or the person on their own record. Anyone else gets a 403, and the card is not shown.

- **The date of birth.**
  - For a person with a login it is theirs: set in *O meu perfil*, shown here read-only. The
    office cannot overwrite it (`birth_date_is_theirs`, 409).
  - For a person without a login it is the club's, edited here.
- **The identity document** (Cartão de Cidadão, passaporte, título de residência or outro) is a
  type and a number.
  - A Cartão de Cidadão number must pass its check digit (`isValidCcNumber` in `@poolse/rules`).
  - It is stored encrypted, and every read by anybody but the person is in the audit log
    (`membership.id_document_read`).
  - The field says why the club records it and that it is deleted the club's
    `id_document_retention_months` (12) after the person leaves. `apply_retention()` does the
    deleting.
- **It has its own route** (`GET/PATCH /staff/:id/identity`), so the number is never in the staff
  record, the list, the export or an import.
- **Since POOLSE-149 it is its own tab, *Identificação***, with the document's photograph above
  the number: front and back, an image or a PDF, filed by the Owner, an Admin or the person
  (`POST /staff/:id/identity/photo/:side`, raw bytes, one step) and removed after a confirmation
  (`DELETE …/photo/:side`).
  - The file is **sealed** (purpose `staff_id_document`). It is shown as a link, never drawn on
    the page, and every look by anybody but the person writes `membership.id_document_read`.
  - A replaced or removed side is **shredded** by the database; retention shreds both with the
    number.
  - With the `id_document` reader on (switch, club tick, key) and an owner or admin filing the
    front, the type and number are proposed in the card for a person to confirm. Off, the card
    says so and the fields are typed.

## Qualifications

POOLSE-27, brought forward as roadmap 7b.2. Who holds which qualification, and until when.

**Where.** The staff record's **Qualificações** tab, and **Staff → Qualificações**, which lists
everybody who needs attention plus the club's types and its warning window. A management card on
the dashboard (`mgmt.qualifications`) shows the counts and the most urgent five.

**Status — derived, never stored**, by `qualification_status()` in SQL:

| Status | When | Shown as |
|---|---|---|
| verde | expiry more than the window away, or no expiry | "Válida até …" / "Sem validade" |
| âmbar | expiry within the window (inclusive: 90 days out is âmbar, 91 is verde) | "Expira a …" |
| vermelho | expiry before today (the Lisbon day) | "Expirou a …" |
| em falta | an **instructor** with no live record of a type marked *exigida para dar aulas* | "Em falta" |

The window is the club's (default 90 days); a type may override it. A person's standing per type is
their **latest** live record — a renewal is a new record, and the old one stays in the history. A
record is archived, never edited; a correction is archive and add again. Status chips are outlined
with a shield icon and always carry their words and date — a separate system from the filled
attendance chips.

**Types** are the club's own data, in its own words, never translated. Every business club starts
with **TPTD — Título Profissional de Treinador de Desporto** (usual validity 60 months, required to
teach), **Nadador-salvador (ISN)** and **SBV — Suporte Básico de Vida**. Edit, archive or add as
the club needs; a type the club archived is never re-created.

**Warning by default; a block only where the club asks** (decisions, 11-10-2026). Expired and
missing qualifications are flagged and never stop anything. A type marked *exigida para dar aulas*
can additionally **bloquear novas atribuições**: then an instructor whose record of it is vermelho
cannot be made a turma's instructor or a weekly booking's instructor — the database refuses, and
the form says which certificate lapsed. It never removes anybody from what they already teach,
never refuses a one-week stand-in, and a *missing* record never blocks.

**Alerts.** A daily job (07:00) records each crossing — into âmbar, into vermelho — once per record,
and emails the person and the club's owners and admins after it commits. Widening the window
reaches the people newly inside it, once. Nothing is sent until an email provider is configured; the
record is kept either way.

**Per sport** (POOLSE-146, 02-11-2026). In a club with more than one sport, a type says which sport it
is for (*Todos os desportos* by default). A required type is *em falta* only for an instructor of its
sport (their record's *Desportos*), the daily alert emails nobody about another sport's title, and
*bloquear novas atribuições* blocks only that sport's turmas. TPTD and ISN are swimming's; SBV, first
aid, is every sport's. A pool-only club reads exactly as before.

**Who can do what.**

| | Owner | Admin | The person themselves | Others |
|---|---|---|---|---|
| See a person's qualifications | ✓ | ✓ | their own | — |
| Record or archive a qualification | ✓ | ✓ | — | — |
| Manage types and the window | ✓ | ✓ | — | — |
| See the list and the dashboard card | ✓ | ✓ | — | — |

**Certificates.** A record carries one scanned certificate, attached once (`qualification_document_once`):
a different scan is a different record, i.e. a renewal. It is attached on the person's Qualificações tab
or, since POOLSE-97, from its row on **Staff → Qualificações**, which shows 📎 *Certificado* (a download
through `/files/:id`, under the file's own read rule) or *Anexar* (the same upload and the same route,
`PUT qualifications/:id/document`, Owner and Admin). An *em falta* row has no record and shows neither.

**A certificate can come first** (POOLSE-149, 02-11-2026). On the person's Qualificações tab, a
certificate (PDF or photograph) dropped anywhere on the screen, or picked, is uploaded at once and the
new-qualification form holds it. With the `qualification_certificate` reader on (switch, club tick, key)
the form is filled with the type (one of the club's own, matched by name and never created), the issuer
and the dates, for a person to confirm. Off, the form opens empty around the file and says why. Saving
creates the record and attaches the file through the same `PUT qualifications/:id/document` as above,
so it is an ordinary record on Staff → Qualificações, the dashboard card and the alert job.
The list's **Sem certificado** filter (`?certificate=missing` on `GET /qualifications/expiring`) narrows it
on the server, before paging, to records with no certificate; *em falta* rows are not among them.

## Who writes what on a staff record

**Past roles and leaving.** On *Funções* the Owner removes a past *Aluno* or *Encarregado* role; an Admin does not remove *Aluno* from staff. Staff do not become students on the same login: adding *Aluno* to staff, or removing the last staff role from somebody who is a student, is refused with `new_account_needed`. *Arquivar conta*, Owner only, `POST /staff/:id/archive`: the login stops at this club, its roles and open invitations close, and lessons, registers and pay stay. Refused for the Owner and support, and while they have a turma, a coming lesson or children they answer for, saying how many. A student record on the login stays, keeps the name and contacts, and loses the link, so it can be invited again. Not in the bin: coming back is an invitation.

POOLSE-196. The Owner writes everything. An Admin reads the NIF, NISS, ID document, contract, notes and staff roles of somebody else, and writes phone, address, sports and family roles. The person writes their own identity. The Owner may correct the name, date of birth and photo of somebody who signs in; each changes on their account, in every club. The email stays locked.

A student with a login becomes staff on their record: the invitation refuses and links there. Archive the student record before removing the Aluno role, or the removal is refused.

**Qualifications a person sends (07-11-2026).** An instructor or maintenance member may
`POST /staff/:ownId/qualifications` for themselves, with an optional `fileId` that must be a
`qualification_document` they uploaded and nobody's record holds. It is filed with `confirmed_at` null,
shown as *Por confirmar*, and counts for nothing until an Owner or Admin presses *Confirmar*
(`POST /qualifications/:id/confirm`, audited `qualification.confirmed`). Anybody else's record is 403.

## Pending invitations: the circle and Reenviar (10-11-2026)

- **The circle.** A pending staff invitation (not accepted, not withdrawn, expired or not) lights *Pessoas* in the menu, rolls up to *Instalações*, the *Convites* tab and the bell (*N convites por aceitar*). It counts only invitations whose every role the reader may grant (`grantableRoles`, the same test as Reenviar and Revogar). In practice that is Owner and Admin. An instructor, maintenance or a support session sees no circle, and a family's invitation lives on the student. Counted in `GET /attention` as `menu.staff`.
- **Reenviar shows the new link in a dialog.** A reissue replaces the invitation with a new row, so the list redraws without the old one. The link used to sit under the old row's button and vanished with it. `ReissuedLinks` holds it above the list.

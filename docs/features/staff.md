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
The list's **Sem certificado** filter (`?certificate=missing` on `GET /qualifications/expiring`) narrows it
on the server, before paging, to records with no certificate; *em falta* rows are not among them.

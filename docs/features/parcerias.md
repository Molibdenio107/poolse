# Parcerias — partnerships, their groups, and getting the list in and out

`/dashboard/facilities/<site>`, in the **Parcerias** panel. A partnership is an agreement
with *one building*: the price, the contact and the contract are all per site, so the same
school using two of the club's pools is two partnerships.

A partnership has **groups** — `6A`, `10G 11B`, `Sala Azul`. The group, not the partnership,
is what lands on the lane grid: `ES D. Dinis` never has a booking; `6A` does.

## Who can do what

| Action | Roles |
|---|---|
| Read the list | everybody who can read the site |
| Add or edit a partnership, a contact, an agreement or a group | owner, admin |
| Attach, replace or remove the signed contract | owner, admin |
| Download the signed contract | owner, admin, instructor, maintenance |
| See the agreement's terms and the contract's earlier versions | owner, admin |
| Import a partnerships sheet | owner, admin |
| Export the partner list | owner, admin |

Bulk creation takes the role single creation takes, and the export takes the same one again:
a partner sheet carries every school the club works with and its coordinators' telephone
numbers, which is not a list an instructor needs in order to teach. All three are enforced in
the API; hiding the control is never the control.

## The signed contract

POOLSE-105. The **Acordo** tab takes the signed contract from the day the partner exists —
PDF, Word (.docx) or a photograph, up to 10 MB.

- **Before any terms.** With no agreement yet, attaching the contract creates one with no
  start date, billing model or price, shown as **Termos por preencher**. It counts towards no
  contracted figure. *Registar os termos* fills that same agreement in rather than adding a
  second one. The three terms are set together or not at all (a CHECK).
- **Replacing keeps the old one.** Each file attached to an agreement is a row in
  `partner_contract_version`, with who attached it and when. Replacing or removing it records
  who did that and when. *Versões anteriores* lists the earlier files, each still downloadable.
  The history is insert-only for the app, bar closing a version.
- **Staff download, the office decides** (Rui, 23-10-2026). Instructors and maintenance see
  the tab only when there is a contract. They see the file and a download link — never the
  price, the terms or the earlier versions, which the API leaves out for them. A family is
  refused the file.
- **Word is a download.** No browser shows a .docx, so the link says *Descarregar documento*
  and the file arrives under its own name. A PDF or a photograph opens in a new tab.

## Importing a partnerships sheet

A school sends its list in August and typing forty classes into a web form is a reason to
keep using the spreadsheet. The importer takes that file.

Four steps, the same four every Poolse importer walks — **ficheiro → mapeamento →
pré-visualização → importar** — and nothing is written until the last one. The file is read
on the Next server and never leaves it; what crosses to the API is a list of rows keyed by
Poolse's own field names.

**One row is one group, not one partnership.** This is the thing that differs from every
other importer and the thing most likely to be misread. A school's sheet has a row per class
with the school's name repeating down the column:

| Escola | Turma | Alunos |
|---|---|---|
| ES D. Dinis | 6A | 24 |
| ES D. Dinis | 6B | 22 |
| ES D. Dinis | 10G 11B | 27 |

Three rows, **one** partnership, three groups. On the register a repeated name is a duplicate
to warn about; here it is the normal case. So the preview is a *tree* — partnerships as
headings with their groups beneath — and the button says it will create one partnership and
three groups. A flat list of three rows each saying "this partnership already exists" would
be technically true and completely misleading.

### What a row can carry

`partnerName` and `groupName` are the only required fields. A sheet with no headcount column
is the list of which classes come, which is worth having on its own.

The rest are optional: the type, the participant count, a level, a tag (`DE` for desporto
escolar), the entity's own instructor, one contact — name, email, telephone — and notes.

### What happens to a row

- **A partnership already at the site** is matched by name, accents and case folded exactly
  as the database's unique index folds them, and gains the groups rather than being
  duplicated.
- **A group already on that partnership** is a **stocktake**: the row shows `24 → 31` for the
  headcount and is **unticked by default**. An unasked-for overwrite of somebody's numbers is
  not a favour. The API applies the same default when a caller sends no selection at all.
- **A blank cell is silence, never an instruction to clear.** A file with no Notas column
  does not empty the notes a club already wrote.
- **An unrecognised type** imports as `outro` with a warning rather than refusing the row.
  Refusing a school over the word in its Tipo column would fail the file for the least
  important cell in it.
- **A type that disagrees with the one recorded** is reported, and the recorded one wins.
- **A contact with neither an email nor a telephone** is warned about and skipped — the
  database refuses one, and the alternative is a 500 that rolls back the whole file.
- **A row repeating an earlier line of the same file** is refused, naming the line it repeats.
- **A row with no partnership name or no group name** is refused with a named cause, in a
  section of its own — a refused row belongs to no partnership and is never saved.

The commit is **one transaction**. A partnership created without the groups that justified it
is worse than nothing, because the operator would re-import to fix it and get a second,
differently-broken half. A partnership every one of whose groups was unticked is never created
at all.

Counts on the preview follow the ticks, not the file. At most 2 000 rows: a few hundred groups
is already an implausible club.

### Dragging the file in

The whole screen is the drop target, not a rectangle somewhere down the page — a zone people
miss is a zone whose miss makes the browser navigate away to render the spreadsheet. A drop
**asks before anything is read**, because files get dragged by accident. Escape cancels. A
file the reader cannot open — a `.pdf`, say — is told so in the same dialog and offered only a
way out.

## Exporting the list

`.xlsx` and `.csv`, from the panel's two links. One line per group, ordered by partnership and
then group, with the partnership's details repeated — the same grain the importer reads.

**The header row is the importer's own field labels**, so a club can export the list, correct
the headcounts the schools sent late, and import the file back without mapping a single column
by hand. A round trip is a list where nothing has changed: every row is a stocktake with
nothing to update, and committing it writes nothing.

Two details that make the round trip work:

- **The type is written as the enum's own spelling** — `jardim_infancia`, not "Jardim de
  infância" — so a list exported under `en` re-imports under `pt-PT` unchanged. The importer
  reads the human words in both languages as well, for a column a person typed.
- **The level is written as its name, not its id.** A uuid in a spreadsheet is a cell nobody
  can correct.

**A partnership with no groups still gets a line**, with the group cell empty. Leaving it out
would drop a real partnership out of its own export, and an operator who exported, edited and
re-imported would silently lose it. As a blank it comes back as one refused row naming the
missing group, which is a question rather than a disappearance.

Only the first contact of a partnership is exported, by name. The sheet has one set of contact
columns and a partnership with three contacts cannot be flattened into them without inventing
a rule about which one matters; a re-import neither duplicates that one nor deletes the other
two.

## A group on several days — POOLSE-117

A school's class may swim on more than one day. Each day is its own booking (one per group, weekday and hour), and **one write path creates them**: `POST /partners/groups/:groupId/bookings` with `{ weekdays[], startTime, durationMinutes, laneIds[] }`, owner and admin only. Every chosen day is judged before anything is kept — the lane check a drag uses, the group already there at that day and hour, and the opening-hours and tank triggers under a savepoint — and **if any day is refused, nothing is written**; the 409 `partner_days_clash` lists every refused day, which the screen says as *Quarta 10:00 · Pista 2 já tem 6A*. With no published season it is a 409 `no_published_season`.

- **The calendar's *Colocar aqui*** lists the site's partnership groups that have no day yet, beside the turmas. Choosing one ticks the day clicked and offers the site's other open days; all go at the clicked hour, lane and the slot's length.
- **Turmas → Parcerias** draws **one card per group**: the headcount once (the group's), then a line per day with its day, hour, first lane and number of lanes, and *Remover este dia* (`DELETE /partners/groups/bookings/:scheduleId`: the booking is archived and its future, untaught lessons cancelled). *Adicionar dia* books one more day through the same path. A group whose last day is removed reappears in *Colocar aqui*.
- **The sheet carries days**: *Dias*, *Hora* and *Duração (min)* columns, all optional. Days are read in either language (*Seg, Qua*, *2ª e 4ª*, *segunda-feira e quinta*, *Mon/Wed*); **a range such as *Seg a Qua* is refused, never guessed**. The length is the cell, else the site's slot that starts at that hour; a row with neither is refused with its reason. A group on several rows with other days **adds days**; the same day and hour twice is still a duplicate. Imported days land in **Sem pista**, and a day already booked reads *igual* and is not written again. The commit stays one transaction.
- **The export writes the days back**, one line per hour and length a group swims at, so a round trip books nothing.

## Not in scope here

The importer brings in partnerships and their groups. **It does not create bookings** — where
a group sits in the week is decided on the lane grid, which is where conflicts are visible. An
importer that silently created forty conflicting bookings would be worse than forty drags. The
wall timetable has its own importer for that, on the Calendar.

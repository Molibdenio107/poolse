# Classes — turmas, parcerias and the lane grid

`/dashboard/classes`. What swims, when, and in which lane. Schema in `docs/data-model.md`.

## Who can do what

| Action | Roles |
|---|---|
| Read the screen, the grid and a turma's card | everybody |
| Create or edit a turma | owner, admin |
| Move a booking on the grid | owner, admin |
| Edit a partnership's day, hour, lanes or headcount | owner, admin |

An instructor sees the same figures read-only. Hiding a control is never the control: every
write above is refused by the API for anyone else.

## Partnerships on this screen

**A partnership can be one the club runs the lessons for.** `Aulas dadas por nós`, a single
switch on the partnership's own screen under Instalações, off by default. Turned on, its
blocks on the calendar carry a training plan and can be cancelled, exactly like a turma's.

It never brings a register. A partnership group has a `participant_count` and no student
records, so there is nobody to mark present — a headcount would be a different feature with
its own table. Off by default means every partnership that existed before goes on behaving as
POOLSE-46 settled: an hour of water, sold, with the school's own coach on the deck.

One card per **booking**, not per group. A school group that swims Monday and Wednesday is
two rows on the grid and two lines on an invoice, so editing "6A" as one thing would beg the
question of which hour had just moved.

### Lanes in use, on hover

Each card says how much of the tank is busy at that hour, counted across **everything**
sharing the water — a turma holding the other half makes "all lanes taken" true.

The sentence is visible on the card. Hovering (or focusing) it opens a breakdown listing
each busy lane with what is in it. The list is an ordered list whose markers are the lane's
own numbers — lanes 1, 3 and 4 read `1.` `3.` `4.`, not `1.` `2.` `3.`, because a marker
that counts the items would name the wrong lanes.

The numbers are the lanes' own positions at the tank, not positions within this booking.

## On a phone

The weekly board (`WeekGrid`) is one column below `md`: each day is a heading with its turmas under it. From `md` up it keeps one column per day (POOLSE-88 phone views).

## Cartões — multi-sport Slice 4 (1 November 2026)

Turmas opens on **Cartões**, the handoff's *05 Turmas*. *Semana*, *Sem horário* and *Parcerias* follow it in the
same pill row, and `?section=week` still opens the weekly board.

Each turma is one card (`turma-cards.tsx`), drawn from the list the page already loads, with no new read:

- **State.** A `Badge` says *Aberta*, *Completa* (active students at or over capacity) or *Sem professor*. *Sem
  professor* wins over full. A card with no instructor is also outlined in amber, and its instructor line says so in
  amber. The word always carries the state, never the colour alone.
- **Details.** The turma's colour dot and name (a link to the turma), its level, its weekly slots (*Seg 17:00 ·
  Qua 18:00*, else *Sem horário*), the instructor, and the tank and lane.
- **Lotação.** A bar and *n / m alunos*. With no capacity set it says *sem limite* and draws no bar, because a null
  ceiling is "not measured". Anyone on the waiting list is counted in amber.
- **Actions.** *Alunos* opens the turma's students tab. Owner and admin also get *Atribuir professor* on a card that
  has no instructor.

An instructor without a login is named from their membership, as the turma page already was (sweep 31-10-2026); the
list used to read only the login's cached name, and its cards said *Sem professor atribuído* beside *Aberta*.

The calendar's event states from the same handoff are **not built**. They wait for Rui to see them in a mockup on the
real calendar.

## A student in two turmas at once — POOLSE-144 (1 November 2026)

A student cannot be enrolled in two turmas that meet at the same time, **whatever the sport
or the site**. The rule is `enrollment_clashes()`: the same season, the same weekday, and
lesson windows that overlap. Touching is not overlapping: 18:00–18:45 and 18:45–19:30 is two
lessons in a row. The rule is in `docs/data-model.md`.

- **Enrolling is refused.** Every way in answers the same 409 `enrollment_clash`, naming the
  other turma, its weekday and hour (*Este aluno já tem aula a essa hora, na turma Golfinhos
  (segunda às 18:00)*). The sentence lands under the field that chose the turma.
  - **The turma's *Inscrever aluno* form**: under *Aluno*.
  - ***Colocar* in Pedidos**, including a request from the app: under *Turma*.
  - **The advancement queue**: on the card. The whole transfer rolls back, so the student
    keeps the enrolment they were leaving.
  - **The bin's restore**: an ended enrolment that would come back into an hour the student
    has filled since.
  - **Not the Excel import.** No importer writes an enrolment today. If one ever does, the
    trigger covers it.
- **Waiting is never refused.** The check runs when a waiting enrolment becomes active.
- **Moving is never refused.** A series move, a new slot or a timetable import that makes two
  of a child's turmas meet is written. The calendar card then names the students under
  *Aulas sobrepostas*, and the block carries the attention dot.
- **Existing clashes are kept and listed.** For owner and admin, Turmas shows *N alunos têm
  aulas sobrepostas* with *Ver quais*, which opens the **Sobreposições** section: each
  student, with links to their record and to each turma and slot involved. Nothing is ended
  or changed; the club moves the child or the turma by hand. The section and the line exist
  only while there is somebody on the list. `GET /class-groups/clashes` is owner/admin, and
  the list is exempt from paging as a queue worked down.

## The Desafio — POOLSE-195

An optional short text beside a turma's lesson plan, 200 characters, written by whoever may write the plan (`PUT /sessions/:id/challenge`). Emptying it ends it. Families read it with the plan, below it, in a colour of its own. After the lesson it is answered *Consegui* or *Não consegui* inside the feedback, under the feedback's own rules, and it is optional. The instructor and the office read the answers on the feedback list. Classmates see them under POOLSE-194's rules: by name for adults, a count for minors. It is the student's own word, never a grade.

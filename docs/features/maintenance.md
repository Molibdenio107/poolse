# Manutenção

The jobs that come round again: contralavagem every Monday, service the dosing pump every
quarter, test the emergency lighting monthly.

Schema in [../data-model.md](../data-model.md), "Planned maintenance". The arguments are in
[../decisions.md](../decisions.md).

## A task, or a request?

Two tables, and the boundary is whether the job has a cadence.

| | **Task** (`maintenance_task`) | **Request** (`maintenance_request`) |
|---|---|---|
| What it is | Planned work that repeats | Something somebody noticed |
| Example | "Contralavagem, de 7 em 7 dias" | "O chuveiro 3 está avariado" |
| Has | An interval, a person, a history | A reporter, a description, a resolver |
| Lives on | The site's page, under **Manutenção** | Each espaço, under **Problemas** |

A job with no cadence is a request, which is why `interval_days` is NOT NULL. Making it
optional would give the same fact two homes, and then two screens disagree about where a
one-off job lives.

## Where it lives

**The site's own page**, `/dashboard/facilities/{id}`, in a **Manutenção** section after
Espaços — a task may be about a tank, a room, a piece of kit or the building itself, so it is
a section of the site rather than a block inside any one of them.

**The dashboard**, as *As minhas tarefas*, for anybody with a management login. Absent rather
than empty when there is nothing: a card saying "nothing" costs a scroll on every load.

**The task's own page**, `/dashboard/facilities/tasks/{id}`, with the history and the settings.

## What a task is

A title, an optional description, an interval in **days**, an optional person, and optionally
one thing it is about.

- **Days, not hours.** Cleaning an espaço is measured in hours because a balneário is cleaned
  twice a day. These are quarterly jobs; asking somebody to type 2160 hours is arithmetic in
  place of a schedule.
- **One target, or none.** A space, a pool, or an inventory item — or nothing, which is right
  for "test the emergency lighting". Two is refused: a task about both a tank and a room is one
  nobody could describe.
- **The target must be at the same site.** Enforced by composite foreign keys, not by the
  form.
- **A person, not a role.** "Sandra does the Monday backwash" is how a club works, and a job
  assigned to three people is a job none of them does. Unassigned is a real state and means
  anybody at the site — those tasks appear on *everybody's* list, so nothing is invisible.

## Due, on schedule, or paused

Read the branches in order; the order is the rule.

1. **Paused** → never due. A task suspended while a tank is drained is not a failure.
2. **Never done** → due. An absence of history is not evidence that the work happened.
3. Otherwise → the time since the last completion, against the interval.

Computed in SQL when the list is read. Nothing is stored, and nothing runs in the background —
there is no `next_due_at` column, and a stored one would need recomputing every time a
completion was backdated.

The state is shown with an icon *and* words, never colour alone. The list is worst first: due
by how late, then on schedule, then paused — listed, never hidden.

## Recording the work

**"Feito" is one tap** on the list. The server fills in who; it cannot be supplied by the
client, because a record of who did something that the doer can address to somebody else is
not a record.

The task's own page adds a **date and a note**. The date is the point: a job done on Saturday
and typed in on Monday is the ordinary case, and the whole calculation runs from when the work
happened. A completion dated Monday would silently hide two days of the gap.

**There is no edit.** An entry is a claim about a moment, and editing one rewrites what a
colleague said they did. A mistake is deleted, which is Owner/Admin — and **a deleted
completion did not happen**, so the task goes straight back to due if that was its only one.

**Pausing is not deleting.** A paused task is still listed and still editable; removing one
says the club no longer does the job. The history is kept either way.

## Who can do what

| Action | Owner | Admin | Instructor | Maintenance | Student / Encarregado |
|---|:-:|:-:|:-:|:-:|:-:|
| See tasks and their history | ✓ | ✓ | ✓ | ✓ | ✓ |
| Record that a job was done | ✓ | ✓ | ✓ | ✓ | — |
| See *As minhas tarefas* | ✓ | ✓ | ✓ | ✓ | — |
| Create, edit or pause a task | ✓ | ✓ | — | — | — |
| Remove a task or a history entry | ✓ | ✓ | — | — | — |

Every one of these is enforced server-side. The screen hides controls it knows would be
refused, using the same answer the guards use — hiding a control is never the control.

**An instructor may record and not plan.** Recording is saying what happened; planning is
deciding what the club maintains and how often, which is a decision about the club rather than
about today. Maintenance is refused the plan for the same reason.

## Not in this slice

- Notifications when a task falls due. The missing-reading alert (POOLSE-26) is the same shape
  and is still open; both want a scheduled per-tenant job, which nothing here has yet.
- Assignment by role as well as by person. The column can be added beside `assigned_to`;
  un-picking a role-only design could not.
- Moving a task from one target to another after it is created — re-create it instead.
- A task that repeats on a weekday ("every Monday") rather than on an interval ("every 7
  days"). The interval is honest about what it measures: time since the work was last done.

## The public water page

POOLSE-71, roadmap 7b.1. A tank's latest readings on a page anybody can open, with no login:
for a QR at the entrance, or a screen at reception.

**Where.** The pool's page, tab **Página pública** (Owner, Admin, Maintenance — the people who
record analyses). Off until somebody turns it on. When on, the tab shows the link with a copy
button, the QR as PNG and SVG to download, and links to the page and to its screen version.

**What a visitor sees** at `/agua/<token>`: the site and the tank, then for each metric its
latest reading, when it was taken, and whether it is **dentro / acima / abaixo dos valores** —
in words and with an icon. The band is the pool's own (the club's override where it set one),
the same answer the pool's page gives; a metric the pool is not judged on shows its value with
*sem valor de referência*. A reading more than 24 hours old says so. Nothing else about the
club is shown: no staff, no notes, no students, no other tanks. `?lang=en` for English;
`?screen=1` for the lobby version, in large type, refreshing itself every five minutes.

**Rules.**
- One live link per tank. **Gerar novo link** and **Desligar** both kill the current link — and
  every printed QR — at once, and both ask first. Turning the page on again makes a new link.
- The link is kept and shown again on the tab, so a lost printout is reprinted rather than
  replaced (decisions, 11-10-2026).
- An unknown, replaced or switched-off link, an archived tank and a closed club all show the
  same "not available" page.
- The page is limited to 60 requests a minute per link.
- Not on the page yet: the lab result's date and grade (POOLSE-72), the complaints book and the
  operating regulation (POOLSE-73).

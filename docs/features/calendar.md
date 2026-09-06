# Calendar — the week that is actually happening

`/dashboard/calendar`. The lane grid drawn for one dated week, with the sessions the season
generated. The Classes screen draws the same board as a recurring *pattern*; this one draws
a particular Tuesday, which is why only this screen has a register to take and a class to
call off.

## Who can do what

| Action | Roles |
|---|---|
| Read the week, the hover card and the register | everybody |
| Take the register | owner, admin, instructor |
| Cancel a class, and undo it | owner, admin |
| Move a class on the grid | owner, admin |
| Adjust the slot grid | owner, admin |

Every write is refused by the API for anyone else. Hiding a control is never the control.

## The week grid

The calendar draws its own grid (`calendar/calendar-grid.tsx`), not the turma board. The
Turmas screen goes on using `classes/schedule-board.tsx` for the recurring pattern; the two
were one component told apart by whether a week was passed, which meant every change to the
calendar was a change to Turmas as well.

**Columns are day × pista, time down the left**, with a sticky two-row header and a sticky
time gutter. The header names the row "Pistas" once and numbers the columns by each lane's
place in its pool — the lane's own name is on hover, and is what the hover card and the
printed sheet still use.

**Only the weekdays the site opens on are drawn**, from the opening hours on the facility's
own screen — with the exception round 5 settled: a closed day that still carries a class is
drawn anyway, shaded, so the class can be seen and moved. A class you cannot see is a class
you cannot fix.

**The calendar is the one page with a wider content column.** Its content is a grid rather
than prose, so the app's single width was throwing away half the monitor rather than
protecting anybody's reading. See the note in `components/page-shell.tsx`; it is meant to
stay the only caller. A club with more than one pool sees a pool
picker and one pool at a time — three pools of eight lanes is 168 columns, which is not a
first paint anybody can read.

**Blocks are placed from their minutes**, not from table rows, at one pixel per minute. A
45-minute class in a 60-minute slot is three-quarters of it, and two classes that overlap by
ten minutes overlap by ten minutes on screen.

**Colour is the turma's own, and the level's when it has none.** A turma can be given one of
eight colours on its own screen; without one it takes its level's tint, which is what an
uncoloured club sees. A parceria keeps its partner's colour; an evento and a manutenção take
the neutral. The legend names each level in words — colour never carries meaning alone.

The grid opens scrolled to the first class of the week, and on the week containing today it
draws a line at the current time.

**The card does not scroll vertically.** It is as tall as the day and the page scrolls
instead, so a pool day is not read through a letterbox. The cost is that the day and lane
headers scroll away with it: CSS cannot scroll one axis inside a container and stick to the
viewport on the other, and the grid still needs its own horizontal scrolling for the lanes.
What survives is the sideways stickiness — the time gutter stays pinned as you scroll across
the week.

## Moving a class

Drag a block to move it. Drag its **bottom** edge to change how long it runs — snapped to the
facility's own slot rows, falling back to the grid's granularity where no row covers that
time. Drag its **left or right** edge to change how many pistas it takes; a booking always
occupies a contiguous run of lanes, and one lane is the floor.

A lane change applies to **every week**, and the confirmation says so with a single button
rather than offering a choice. Lanes belong to the recurring booking: there is no
per-occurrence field to put them in, so "this week only" is not something the data can
express. A move or a duration change still asks the two-way question.

**The block moves the moment it is dropped**, and a small popover at the drop point asks the
one thing a drag cannot say for itself — whether this is *this week only* or *every week*.
That question is unchanged from round 5; what changed is that it is asked beside the block
instead of in a modal, and the answer is written in the background. If the server refuses,
the block goes back where it came from and the reason appears above the grid.

Escape, or a click away, puts the block back and writes nothing.

Classes are faded on a day already past, on a public holiday, and on a day the pool is shut —
all three mean "nothing is expected here", which is worth seeing at a glance on a week that is
otherwise uniform.

**Faded classes still drag.** Round 5 made past ones undraggable on the argument that moving
one rewrites the past; in use that read as the grid being broken, because the block looks like
every other block and does not move. Rearranging Monday from Wednesday is ordinary planning,
and the server is what refuses a move that is actually impossible.

Clicking empty space offers the club's unscheduled turmas and puts the chosen one on that
day at that time. It does not open the new-turma form: that form deliberately carries no day
or time, so a day and a time sent to it would go nowhere. Creating a genuinely new turma is a
link inside the same dialog, and it comes back here to be placed.

**The lane is not set by the click.** `placeSlotAction` does not return the schedule it
created, so there is no id to give a lane to; drag the block across to the right pista once it
is placed.

## The hover card

Hovering or keyboard-focusing a class opens the same card the turma screens use, extended
with what you do to that class. It carries the turma's name, its level, the instructor —
or **"ainda sem instrutor"**, written out rather than omitted, because a missing row reads
as "not applicable" and an unstaffed class is a gap the club needs to see — the time, the
tank, the lanes it occupies, how full it is, and the roll.

At the foot: **Take the register** and **Cancel class**, icon and label.

Round 5 had those two controls inside the block itself, revealed on hover. A block on this
grid is a rectangle whose height is a duration and whose rows are lanes; there is no spare
room in it, and at compact density there is none at all.

A **parceria gets no card**: it has no register to take, and POOLSE-46 settled that it never
will. Neither does the continuation row of a class that crosses an hour line — it is the
same class, and two cards from one block would be one too many.

## Cancelling a class

The confirmation is the app's dialog, centred over the page. It names the turma and the
date, because seven columns of small cards are easy to mis-click and "are you sure?" cannot
tell you that you are about to call off Thursday's class instead of Tuesday's.

**Scope** is a pair of radios — this occurrence, or this and every future one — with the
narrow, recoverable choice selected. The past is never affected either way.

Cancelling raises a toast with **Undo**, which restores the session. A class taken down by a
*closure* refuses the undo and says so: that one is undone by removing the closure.

The session row survives cancellation. Attendance history, invoicing and any later "was
there a class that Tuesday?" all rest on it.

There is **one dialog for the whole board**, not one per class. Round 5 mounted a
confirmation per session, each rendering in place of its own trigger — which on this screen
is a box a seventh of a column wide with `overflow-hidden` on it, so the form was clipped by
the cell it lived in.

## Who teaches a lesson

The hover card and the plan sheet both carry a teacher picker for that one lesson. Choosing
somebody records a **stand-in**: the turma's own instructor is unchanged, and the following
week goes back to normal by itself. Reassigning the turma for good is done on the turma's own
screen.

An instructor on approved leave appears in the list with the reason against their name, greyed
and unselectable — and the endpoint refuses them as well, because hiding a control is never
the control. Somebody already teaching at that hour is shown with "já tem aula a esta hora"
and can still be chosen; the database's own overlap constraint is what refuses it, and it says
so.

Owner, admin and the lesson's own instructor may set a stand-in.

## The training plan

Clicking a class opens a sheet down the side of the page — the week stays visible behind it,
because somebody writing Tuesday's plan is looking at Tuesday. Partnership bookings are not
clickable: a school's hour has no lesson to plan.

| Action | Roles |
|---|---|
| Read the plan | everybody |
| Write it | owner, admin, the turma's instructor, and a substitute covering that lesson |

A **substitute** counts because they are the person who will actually teach it, and a plan
they cannot edit is a plan they will keep somewhere else. Where a turma has **no instructor
at all**, only owner and admin can write — there is nobody else to name.

The check is about a row rather than a role, so `requireRole` cannot express it: the API
resolves the occurrence and answers, and a refusal is a 403. The response carries `canEdit`,
which is the same answer, so the screen and the guard cannot disagree.

The panel holds:

- **A plain-text plan**, saved with an explicit button. Not autosave — a plan is prose
  somebody is composing, and writing half a sentence to a colleague's screen is worse than a
  button.
- **Copy from the previous lesson**, which fills the box from the same turma's last plan.
  Disabled once anything is typed, so it cannot overwrite five minutes of work. It looks at
  plans rather than at sessions: what somebody wants is the last thing they wrote, not the
  last Tuesday the club opened.
- **The level's skills**, in teaching order, each adding its name as a line. Suggestions,
  not a checklist — what was actually covered is `skill_progress`, which is about a student.

A **cancelled** lesson keeps its plan and says so; a class brought back by Undo comes back
with what was written for it. A **past** lesson opens too, so the history can be read.

## The past

Days already behind the current one are faded and cannot be dragged: a lesson that has
happened is a record, and moving it would be rewriting rather than planning. Their registers
still open.

## Adjust the slot grid

A booking whose hour matches no row of the grid is listed under it as **fora da grelha** —
never dropped, since it still occupies the pool. There are two ways out and the hint names
both: drag it onto a row, or give the grid a row at that hour.

The second is **Adjust the slot grid**, owner/admin, which asks before it goes:

> This changes the calendar grid and this site's schedule grid together. Continue?

That warning is literal. The calendar's rows and the facility's schedule grid are one table
(`facility_time_slot`), so a new grid moves the week under whoever has the calendar open.
The same sentence is asked again at the slot editor's Generate button, from the same
translation key.

**The opening hours are not rewritten.** The grid is validated to sit inside them; a slot
editor that could widen a building's hours would have the relationship the wrong way round.

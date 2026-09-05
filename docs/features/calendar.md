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

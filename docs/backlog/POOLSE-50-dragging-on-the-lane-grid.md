# POOLSE-50 · Dragging on the lane grid

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Calendar / Scheduling · **Priority:** High

### PO — why this exists
Building a season is a morning of moving blocks around. The reference schedule repeats the same block
on 2ª, 4ª and 6ª — so the single most-used action is not "move", it is "put another one of these on
Thursday". Making that a drag with a modifier instead of three form submissions is most of what makes
this feature worth having.

**Not in scope:** what counts as a conflict and how it is refused (POOLSE-51). This ticket is the
gestures and their feedback; the rules live next door.

### BA — rules and data
- **Move** a block to another day, slot or lane.
- **Span lanes** by dragging the block's edge across lane rows. This is how a multi-lane booking is
  made and unmade — competition squads take two or three lanes, hidroginástica takes the tank.
- **`Alt`+drag duplicates** to another day. The copy carries the group, instructor, category and lane
  span; it does not carry the original's notes, because a note usually names a date or a reason.
- **Every drag has a keyboard equivalent, and the grid is fully usable without a mouse.** Space picks
  up, arrows move by cell, `Shift`+arrows grow and shrink the lane span, `Alt`+Space drops a copy,
  Escape cancels. dnd-kit announces each step; the announcements are translated.
- The drop behaviour follows what was settled in round 6 for the week board and is not re-litigated:
  **the block moves first, then a centred modal asks to confirm or undo.** Escape in that dialog is
  undo, not dismiss — a dialog closable without answering would leave a block drawn where it is not.
- A duplicate asks the same way, naming the day it will land on.
- After a confirmed move, the existing undo affordance stays: a move that was deliberate and wrong
  goes back in one click.
- Live conflict feedback appears **during** the drag, before the drop (POOLSE-51 defines what it
  says). A drop onto a hard-blocked target is refused at the drop rather than silently reverted, and
  the modal is not shown for it.
- Dragging is owner/admin. For everyone else the grid is read-only and the blocks are not draggable —
  and the API refuses the write regardless.

### Dev — implementation notes
- Extend `schedule-board.tsx`. The confirm-modal, optimistic-overlay and undo machinery from round 6
  is already there; what changes is that `Optimistic` gains a lane dimension and a third kind:
  ```
  type Optimistic =
    | { kind: 'move';      scheduleId, weekday, slotId, laneIds }
    | { kind: 'place';     groupId,   weekday, slotId, laneIds }
    | { kind: 'duplicate'; scheduleId, weekday, slotId, laneIds }
    | { kind: 'span';      scheduleId, laneIds }
  ```
- **Most likely to be got wrong:** the edge-drag for lane span. dnd-kit's `useDraggable` on the block
  and a second draggable handle on its edge will fight over the pointer unless the handle stops
  propagation on pointer-down — the same trick the chip's register and cancel controls already use.
  The 6px activation distance means an ordinary click still is not a drag.
- Second: `Alt` is read from the **drop** event, not the drag start. A user presses it mid-drag once
  they have decided, which is the natural gesture, and reading it at start makes the modifier feel
  broken.
- Third: lane spans must stay contiguous. Lanes 2 and 4 with 3 free between them is not a booking a
  pool can honour and not something the reference sheet ever does; refuse a non-contiguous span at
  the gesture rather than storing it and discovering it in the export.
- Fourth: a duplicate creates a **new** `class_schedule` row and its `booking_lane` rows in one
  transaction. Duplicating into a slot that already holds the same turma must be refused by
  `class_schedule_slot_uq`, and the message has to say so rather than surfacing a constraint name.
- The keyboard path is not an afterthought to be bolted on at the end: build the reducer that applies
  a move so both the pointer and the keyboard call it, or the two will diverge.
- Touch: a long-press to pick up, since a 18px compact row is not a comfortable drag target. The
  backoffice is a desktop product, so this is a courtesy rather than a requirement — but the block
  must not be *impossible* to move on a tablet.

### QA — test scenarios
- **50.1** Given a block on 3ª 18:30 lane 2 / When dragged to 5ª 19:15 lane 4 / Then the block moves there immediately and a centred modal asks to confirm.
- **50.2** Given that modal / When Escape is pressed / Then the block returns to 3ª 18:30 lane 2 and nothing was written.
- **50.3** Given that modal / When confirmed / Then the booking is saved and an undo affordance appears.
- **50.4** Given the undo / When clicked / Then the booking returns to its original day, slot and lane.
- **50.5** Given a block on lane 2 / When its edge is dragged down to lane 4 / Then it spans lanes 2–4 and the modal names the span.
- **50.6** Given a block on lane 2 / When its edge is dragged to lane 4 with lane 3 held by another booking / Then the span is refused with a message naming the booking in the way.
- **50.7** Given an attempt to span lanes 2 and 4 skipping 3 / When dropped / Then it is refused as non-contiguous.
- **50.8** Given a block on 2ª / When `Alt`+dragged to 4ª / Then a copy is proposed, the original stays, and the modal says it will duplicate rather than move.
- **50.9** Given `Alt` pressed only after the drag started / When dropped / Then it still duplicates.
- **50.10** Given a duplicate onto a slot already holding that turma / When confirmed / Then it is refused with a message about the turma already being there, not a constraint name.
- **50.11** Given the keyboard alone / When a block is picked up with Space, moved with arrows and dropped with Space / Then the same modal appears and the same move is made.
- **50.12** Given the keyboard / When `Shift`+arrow is used / Then the lane span grows and shrinks.
- **50.13** Given the keyboard / When `Alt`+Space is used / Then a duplicate is proposed.
- **50.14** Given a screen reader / When each of those steps happens / Then it is announced, in the reader's own language.
- **50.15** Given an instructor / When they open the grid / Then no block is draggable, and a POST to the move endpoint is refused.
- **50.16** Given a drag onto a closed day / When released / Then the drop is refused at the drop, not reverted after a modal.
- **50.17** Given a compact-density grid on a tablet / When a block is long-pressed / Then it can be moved.

### Acceptance criteria

1. A block moves between day, slot and lane by drag, and by keyboard.
2. Dragging a block's edge across lane rows sets its lane span, by drag and by keyboard.
3. `Alt`+drag duplicates to another day; the modifier is read at the drop, not at the start.
4. The block moves first and a centred modal then asks to confirm or undo; Escape is undo.
5. A confirmed move keeps the existing one-click undo.
6. Non-contiguous lane spans are refused at the gesture.
7. A duplicate creates the booking and its lane rows in one transaction, and a collision is reported in words rather than as a constraint name.
8. A hard-blocked drop is refused at the drop, without showing the confirm modal.
9. Every drag action has a keyboard equivalent and the grid is fully usable without a mouse, with each step announced in the reader's language.
10. Pointer and keyboard paths call the same reducer, so they cannot diverge.
11. Dragging is owner/admin in the interface and refused server-side for everyone else.
12. A block can be moved on a touch device via long-press.

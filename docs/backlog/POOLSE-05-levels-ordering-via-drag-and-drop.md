# POOLSE-05 · Levels ordering via drag and drop

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Levels / Settings · **Priority:** Medium

### PO — why this exists
Reordering a level with arrow buttons costs one round trip per position, so moving a new level into the middle of a fifteen-level ladder is a dozen clicks and a dozen writes. Admins configuring a season are the users, and the ordering is not cosmetic — it defines what "the next level" means for POOLSE-19's advancement proposals. Medium: painful but survivable, and it becomes a dependency once advancement is built.
**Not in scope:** nesting or grouping levels, reordering anything other than levels, and per-pool or per-season level orderings.

### BA — rules and data
- Order is an integer index on the level, scoped to the tenant; the persisted order is what every consumer reads.
- Reordering is a single batch call carrying the full ordered set, with optimistic UI and a rollback to the server's order on failure.
- The arrow buttons are removed, so a keyboard path (focus a row, modifier + arrow keys) is mandatory rather than a nicety.
- Touch support is long-press to grab, for tablet use poolside.
- The order is reflected everywhere levels appear: pickers, filters, reports and exports.
- Because POOLSE-19 derives "next level" from this order, reordering while students are mid-progression changes their advancement targets silently — no warning is specified.
- **Open:** are order indexes contiguous (rewritten on every move) or sparse/gap-based? The "single batch call" in AC3 implies a rewrite of the affected rows, but the storage rule is not stated.
- **Open:** do archived levels appear in the reorder list, and does an archived level occupy an index?
- **Open:** two admins reordering concurrently — last write wins, or a version check that rejects a stale order?

### Dev — implementation notes
- Migration: ensure `order_index` exists as `NOT NULL`. If a unique index on `(tenant, order_index)` is wanted, it must be `DEFERRABLE INITIALLY DEFERRED`, or a batch rewrite collides with itself mid-transaction.
- API: `PATCH /levels/order` taking the full ordered id array; the server asserts the set is exactly the tenant's levels — no additions, no omissions — and rewrites in one transaction.
- Use dnd-kit rather than HTML5 drag-and-drop: HTML5 DnD has no touch support (AC5) and no built-in keyboard story (AC4).
- Announce each move through an `aria-live` region ("Nível 3 movido para a posição 2") so the keyboard path is usable without sight of the drop indicator.
- The drop indicator uses a design token, not a hardcoded colour, and must be visible against both light and dark row backgrounds; pair it with position, not colour alone.
- Everywhere that lists levels must order by `order_index`, not by name or id — a single shared query fragment or repository method avoids one list drifting.
- Most likely to be got wrong: the optimistic UI not rolling back on failure, leaving the client showing an order the server rejected until a hard refresh.

### QA — test scenarios
05.1 Given the levels list, When a row is dragged between two others and dropped, Then a drop indicator was shown during the drag and the row lands in that position.
05.2 Given the levels list, When it renders, Then no up/down arrow buttons are present.
05.3 Given a reorder of four rows, When the network is inspected, Then exactly one batch request is sent.
05.4 Given the batch call returns 500, When the response arrives, Then the list reverts to the server order and a localised error is shown.
05.5 Given keyboard focus on a level row, When modifier + arrow down is pressed twice, Then the row moves two positions and the change persists.
05.6 Given a touch device, When a row is long-pressed and dragged, Then it can be reordered without triggering a page scroll.
05.7 Given a new order saved, When a level picker, a filter and a report are opened, Then all three reflect the new order.
05.8 Given a reorder saved, When the page is reloaded, Then the order persists.
05.9 Given a crafted `PATCH /levels/order` omitting one level id, When it is posted, Then the API rejects it and no order is written.
05.10 Given a crafted request containing a level id from another tenant, When it is posted, Then the API rejects it and neither tenant's order changes.
05.11 Given two admins reordering the same list simultaneously, When both save, Then the final stored order is a complete valid permutation with no duplicate or missing index.
05.12 Given dark mode and pt-PT, When a drag is in progress, Then the drop indicator is visible and the `aria-live` announcement is translated.

### Acceptance criteria

1. Rows can be dragged to a new position; a drop indicator shows where the row will land.
2. The small arrow buttons are removed.
3. New order persists (single batch call updating the order index), with optimistic UI and rollback on failure.
4. Keyboard-accessible alternative exists (focus row, move with arrow keys + modifier) so removing the buttons does not remove keyboard reordering.
5. Works on touch (long-press to grab) for tablet use.
6. Order is reflected everywhere levels are listed (dropdowns, filters, reports).

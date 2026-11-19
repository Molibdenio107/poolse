# POOLSE-234 · Férias: a floating *Pedir {n} dias* button follows the year, and a dialog shows the days before anything is sent

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Staff / Férias · **Priority:** Medium (pilot) · **Depends on** —

### PO — why this exists

Rui, 19-11-2026: on *As minhas férias* (`facilities/staff/vacations/my-vacations.tsx`) the submit sits at the top of a twelve-month grid. Somebody picking days in October has scrolled away from it, and a request goes the moment it is pressed, with no look at what was picked. A small button that follows the scroll, and a dialog that lists the days, fix both. The second also meets *A decision asks first* (`interface.md`).

**Not in scope:**
- The approval side, the balance rules, half days, or carry-over (still not tracked, CLAUDE.md).
- A change to `requestVacationAction` or its validation.

### BA — rules

1. **The top-of-page submit goes.** The grid and the chosen-days count stay as they are.
2. **A floating button appears when at least one day is chosen**: *Pedir {n, plural, one {# dia} other {# dias}}*. It is fixed at the bottom-right on the desk and bottom-centre below `md`. It is `data-bottom-bar` with `var(--safe-bottom)` in its padding, so it never covers the last row of the grid on a phone: the page gets bottom padding equal to its height while it shows. It is gone at zero days.
3. **It opens a `Dialog`** (`components/ui/dialog.tsx`, `placement="sheet"` below `md`):
   - **Title:** *Pedir estes dias?*
   - **Body:** the chosen days grouped by month (*Março: 3, 4, 5*), dates as `dd-MM-yyyy` through `lib/date-format.ts`, in the **facility's timezone**. The days are dates, not instants, so nothing shifts.
   - **Buttons:** *Pedir estes dias* (primary, submits) and *Escolher mais dias* (closes, keeps the selection).
4. **Nothing is sent until the dialog's confirm.** The form posts the same `days` field to the same `requestVacationAction`, and its refusals come back as today, in the toast.
5. **Limpar stays reachable**: in the floating bar beside *Pedir…* as a quiet text button, and in the dialog's footer. It clears without asking, since nothing has been sent.
6. **Keyboard and motion:** the floating button is in the tab order after the grid. The dialog traps focus and returns it to the button, and Escape closes it. The button's entrance is a fade and rise that does not run under reduced motion.

### Dev notes

- `my-vacations.tsx` only, plus keys `vacations.floating`, `vacations.confirmTitle`, `vacations.chooseMore` (the existing `vacations.submit` stays the confirm's label). Group by month in the client from the sorted `chosen` array, and name the months through the locale.
- The button is POOLSE-232's `<Button variant="primary">` if built after it, else the same classes.
- Phone: the teacher's phone is the app (decided 07-11-2026), but *Férias* opens in the backoffice under `md` for maintenance and admins. Add a line to `phone-tier2.spec.ts`.

### QA

1. Pick 3 days in March and 2 in October: the button says *Pedir 5 dias* and stays visible while scrolling to December.
2. Click it: the dialog lists *Março* (3 days) and *Outubro* (2), in `dd-MM-yyyy`. *Escolher mais dias* closes it with the 5 still chosen.
3. Confirm: one request with the 5 days, the same as today's path. The toast or refusal is unchanged.
4. Pick 1 day: *Pedir 1 dia* (singular).
5. *Limpar*: the selection is gone and so is the button.
6. Phone (360 px): the button sits above the safe area and the last grid row is reachable.
7. Keyboard only: reach the button, open, Tab stays in the dialog, Escape returns focus to the button.
8. Reduced motion: the button appears without moving. Both themes are contrast-checked.
9. **Wrong role / tampering:** posting `days` for another member's id is refused, as today (the action's own check, unchanged). A guardian cannot reach the page.
10. Cross-tenant: unchanged action, existing tests.

### Acceptance criteria
- [x] Top submit removed; floating button with ICU plural, safe-area aware.
- [x] Confirm dialog with days grouped by month in the facility's time zone; nothing sent before confirm.
- [x] Limpar in both places; keyboard, focus and reduced motion as rule 6; phone spec line.

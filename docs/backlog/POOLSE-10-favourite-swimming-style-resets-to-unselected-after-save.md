# POOLSE-10 · Favourite swimming style resets to unselected after save

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Students / Widgets · **Priority:** Medium

### PO — why this exists

An instructor or student picks a favourite swimming style, saves, and the widget immediately shows nothing selected — so they save again, or assume the record is broken. The value is in fact stored, which makes this a trust bug rather than a data bug: the app lies about what it just did. It sits at Medium because nothing is lost, but the same refetch pattern is almost certainly repeated on the sibling widgets of that page, so one fix buys several.

**Not in scope:** changing which swimming styles exist, editing the style list per tenant, or redesigning the widget.

### BA — rules and data

- The stored value is already correct after save; the defect is the widget's post-mutation render state, confirmed by a page reload showing the right value (AC2).
- Field involved: the student's favourite swimming style — a nullable single-select on the student record, scoped by tenant like every student field.
- **Open:** the exact enum of styles is not stated anywhere in the backlog (crawl / costas / bruços / mariposa / …); confirm the list and whether it is tenant-configurable before touching the type.
- "No style chosen" is a legitimate persisted state, so the UI cannot treat unselected as "not loaded" — the two must be distinguishable in the widget's state model.
- Success feedback (toast or inline) may only appear once the widget shows the saved value; a toast over a contradictory widget is itself a defect (AC3).
- A failed save must return the widget to its **previous** value, never to unselected — a rollback that lands on empty reproduces the same bug for a different reason.
- Edge case: the same student open in two tabs. Decided default is last write wins, consistent with the rest of the student form. **Open:** whether any student field warrants a conflict warning — not decided in this backlog, and not to be invented here.
- Sibling widgets on the same student page are in scope for audit (AC4): any widget that saves and re-renders from the same data source must be checked, and fixed if it shares the fault.

### Dev — implementation notes

- No migration expected. First confirm the write reaches the column — if it does not, this ticket changes shape and the API side is the fix.
- The likely cause is the mutation response being discarded and the widget re-reading a stale or default-initialised cache entry; find it in the shared student data hook, not in the widget.
- Fix belongs in the shared fetch/mutate helper: seed the cache from the mutation's returned entity, or invalidate the exact query key (including the tenant and student id) — not a broad invalidate-everything, which papers over the bug and costs a round trip.
- Optimistic update plus rollback to the prior value; the rollback path needs its own test because it is the one that silently reintroduces the empty state.
- Toast fires only after the cache holds the new value — bind it to the settled success, not to the request being sent.
- i18n: style names and all feedback copy come from i18n keys in pt-PT and en; no hardcoded Portuguese strings in the widget.
- Theming: the selected chip must read in light and dark mode and must carry a check mark or border weight — selection cannot be signalled by colour alone.
- Most likely to get wrong: patching this one widget's local state so the symptom disappears, leaving the shared cache bug in place and every sibling widget still broken. AC4 exists precisely to stop that.

### QA — test scenarios

10.1 Given a student with no favourite style / When an Owner selects "Bruços" and saves / Then the widget shows Bruços selected without a reload.
10.2 Given the save in 10.1 succeeded / When the page is reloaded / Then Bruços is still selected, proving persistence.
10.3 Given a student with a saved style / When the user clears the selection and saves / Then the widget shows unselected and a reload confirms it — an intentional clear still works.
10.4 Given the API returns 500 on save / When the user selects a style / Then the widget reverts to the previously saved style, not to unselected, and an error is shown.
10.5 Given the network is slow / When the user saves / Then the success toast does not appear before the widget shows the saved value.
10.6 Given the same student page open in two tabs / When tab A saves Costas and tab B then saves Mariposa / Then tab B shows Mariposa, and tab A shows Mariposa after refetch — neither lands on unselected.
10.7 Given a Student role user on their own record / When they attempt to save a favourite style for a different student via the API directly / Then the API returns 403 regardless of what the UI offers.
10.8 Given the locale is pt-PT / When the widget renders / Then style names and the success message are Portuguese; switching to en renders the English strings with no key leakage.
10.9 Given dark mode / When a style is selected / Then the selected state is distinguishable from unselected without relying on colour, and passes contrast; repeat in light mode.
10.10 Given the sibling widgets on the same student page / When each is saved / Then none of them reverts to an empty state after save (AC4).
10.11 Given a save is in flight / When the user rapidly picks a second style before the first resolves / Then the last selection wins and the widget does not flip back to the first or to unselected when the earlier response lands.
10.12 Given a student record the user has no read access to / When the widget mounts via a crafted request / Then no style data is returned.

### Acceptance criteria

1. After save, the widget shows the saved style as selected.
2. Reloading the page shows the same value (confirms it was a UI-state bug, not persistence).
3. The success feedback (toast/inline) does not fire while the widget shows a contradictory state.
4. Check the same pattern on sibling widgets on that page — likely a shared refetch/cache-invalidation issue rather than a one-off.

# POOLSE-36 · Menu order — Pessoas below Instalações

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Navigation · **Priority:** Low

### PO — why this exists

The main menu's current order does not match how staff move through the app; Pessoas belongs directly below Instalações. Everyone using the backoffice benefits marginally, nobody is blocked. Low priority, and worth doing in the same pass as POOLSE-34 since both edit the navigation configuration.

**Not in scope:** any route, permission, label or icon change, and any reordering of submenu items (POOLSE-34 owns Férias' position within Pessoas).

### BA — rules and data

- Pessoas sits directly below Instalações in the main menu. Every other item keeps its relative order.
- Nothing else changes: no route changes, no permission changes, no label changes. Order only.
- The order is defined once, in a single navigation configuration, and consumed by every layout — desktop, mobile and collapsed.
- Mobile and collapsed navigation reflect the same order as desktop; there is no second, divergent list.
- Items hidden by permission are removed from the rendered list without altering the relative order of the rest — if Instalações is hidden for a role, Pessoas moves up into its place rather than to an arbitrary position.
- POOLSE-34 nests Férias under Pessoas. Both tickets edit the same configuration and must be applied coherently; after both, Pessoas sits below Instalações and carries Férias as a child.
- **Open:** where Pessoas currently sits and therefore which items shift. The doc states the destination, not the origin, so the resulting full order should be written down and agreed before the change.

### Dev — implementation notes

- The whole ticket is one edit to the navigation config array, plus deleting any hardcoded order that survives in a layout component — AC 3 is the real work, not the reorder.
- Grep for every place the menu is rendered (desktop sidebar, mobile drawer, collapsed rail, any command palette or quick-switcher) and confirm each reads the shared config rather than its own list.
- No API change, no schema change, no migration.
- Permission enforcement is untouched. Verify by diffing the rendered menu per role before and after: the same items, in a new order — never a different set.
- i18n: no new strings. Confirm the labels still resolve after the array is reordered, in case any index-based key lookup exists (it should not, and finding one is a bug worth fixing here).
- Theming: no visual change beyond position; check that any first-item or last-item styling (a top border, a divider, rounded corners) follows the new order rather than staying pinned to the old first item.
- Most likely to be got wrong: a second hardcoded order in the mobile navigation that nobody notices because it is only visible on a narrow viewport.

### QA — test scenarios

- **36.1** Given the main desktop navigation / When it renders / Then Pessoas sits directly below Instalações and no other item's relative order has changed.
- **36.2** Given the mobile/collapsed navigation / When it renders / Then the order is identical to the desktop order.
- **36.3** Given each role in turn / When the menu renders / Then exactly the same set of items is visible as before the change, only reordered.
- **36.4** Given a role for whom Instalações is hidden / When the menu renders / Then Pessoas occupies the position Instalações would have held, and the remaining order is unbroken.
- **36.5** Given any menu item / When it is clicked / Then it navigates to the same route as before — no route or label changed.
- **36.6** Given the navigation config / When a developer changes the order there / Then every rendering surface reflects it with no other edit — proving AC 3.
- **36.7** Given locale pt-PT and en / When the menu renders / Then every label resolves correctly in the new order and no label is mismatched to the wrong item.
- **36.8** Given light and dark mode / When the menu renders / Then first/last-item styling, dividers and the active highlight follow the new order and look correct in both.
- **36.9** Given POOLSE-34 is also applied / When the menu renders / Then Pessoas sits below Instalações **and** carries Férias as a submenu item — the two config edits do not conflict.
- **36.10** Given a deep link straight into a page whose menu item moved / When it loads / Then the correct item is highlighted as active despite the new position.
- **36.11** Given a keyboard user tabbing through the menu / When they traverse it / Then focus order matches the new visual order, with no leftover DOM ordering from the old layout.

### Acceptance criteria

1. **Pessoas** moves to sit directly below **Instalações** in the main menu.
2. No routes, permissions or labels change — order only.
3. The order is defined in one navigation config, not hardcoded per layout.
4. Mobile/collapsed navigation reflects the same order.

# POOLSE-34 · Move Férias under the People menu

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Navigation · **Priority:** Low
**Depends on:** POOLSE-35 (Pessoas becomes the staff section, which is what makes Férias belong there)

### PO — why this exists

Férias is staff leave, and once Pessoas is the staff section (POOLSE-35) the page has an obvious home it does not currently sit in. Owners and Admins planning cover are the ones who go looking for it. Low priority: it is a relocation, and nobody is blocked by the current placement — but doing it alongside POOLSE-35 costs almost nothing and doing it later means a second round of bookmarks breaking.

**Not in scope:** any change to what the Férias page does, who can see it, or how leave is recorded — this is a move, nothing more.

### BA — rules and data

- Férias becomes a submenu item under Pessoas and is removed from its current top-level position. It appears in exactly one place in the navigation.
- The old route redirects to the new path, permanently, so existing links, bookmarks and any deep links from emails keep working.
- Breadcrumbs read Pessoas → Férias, and the active-menu highlight marks Pessoas as the active top-level item when the Férias page is open.
- Permissions are unchanged: whoever could reach Férias before can reach it after, and whoever could not, still cannot. The move must not accidentally inherit the Pessoas menu item's visibility rule.
- The redirect must preserve query parameters and any path segments below the page (a linked year or a specific person's leave record).
- If a role can see Férias but not Pessoas, the submenu must still be reachable. **Open:** whether such a role exists, and if so whether the Pessoas parent renders with only the Férias child visible, or Férias stays reachable by route only.
- The navigation order of items within the Pessoas submenu is undecided. **Open:** where Férias sits relative to the existing submenu items.
- This ticket and POOLSE-36 both touch the navigation configuration; they must land as one coherent config change, not two conflicting edits to the same file.

### Dev — implementation notes

- Navigation is defined in one config object (also required by POOLSE-36 AC 3). Both the move and the reorder are edits to that config, not to layout components.
- Next.js App Router: the page directory moves under the Pessoas route segment. Add a permanent redirect from the old path in `next.config` (or a redirect route) with a wildcard so child segments and query strings survive.
- Verify the new segment does not inherit a layout-level permission guard from the Pessoas segment. If Pessoas' layout enforces a staff-role check, Férias now sits inside it and its effective permission silently changes — this is the trap in an otherwise trivial ticket.
- Breadcrumbs should be derived from the same navigation config as the menu, so the parent label is not written twice and cannot drift.
- No API change and no schema change. Any hardcoded internal link to the old Férias path must be updated at source rather than relying on the redirect.
- i18n: the submenu label uses the existing Férias key; only the breadcrumb parent key is new. No new user-facing copy.
- Theming: submenu items must have the same active/hover treatment as elsewhere in both modes; a nested item's active state is easy to lose in dark mode where the parent is also highlighted.
- Most likely to be got wrong: the redirect losing query parameters, or the active-highlight marking neither Pessoas nor Férias because the matcher checks for an exact path.

### QA — test scenarios

- **34.1** Given the main navigation / When Pessoas is expanded / Then Férias appears as a submenu item and no longer appears at its old top-level position.
- **34.2** Given a bookmark to the old Férias URL / When it is opened / Then it redirects to the new path and the page renders.
- **34.3** Given an old-path URL carrying a query string and a child segment / When it is opened / Then both survive the redirect intact.
- **34.4** Given the Férias page is open / When breadcrumbs and the menu render / Then breadcrumbs read Pessoas → Férias and Pessoas is highlighted as the active top-level item.
- **34.5** Given each role in turn / When Férias is requested by direct URL / Then access is granted or refused exactly as it was before the move — no role gains or loses access.
- **34.6** Given a role that could reach Férias but cannot see Pessoas / When they navigate / Then the decided behaviour holds and the page is not silently unreachable.
- **34.7** Given locale pt-PT and en / When the submenu and breadcrumbs render / Then both labels come from the i18n layer and neither is a hardcoded string.
- **34.8** Given light and dark mode / When Férias is the active submenu item / Then its active state is visible and distinguishable from the parent's highlight in both.
- **34.9** Given the mobile/collapsed navigation / When Pessoas is opened / Then Férias appears in the same position as on desktop.
- **34.10** Given POOLSE-36's reorder is applied / When both changes are live / Then the navigation config holds one consistent order and Férias remains nested under Pessoas in its new position.
- **34.11** Given an internal link elsewhere in the app pointing to Férias / When it is followed / Then it goes directly to the new path without a redirect hop.

### Acceptance criteria

1. Férias appears as a submenu item under Pessoas and is removed from its current location.
2. Old routes redirect to the new path so existing links and bookmarks keep working.
3. Breadcrumbs and the active-menu highlight reflect the new position.
4. Permissions are unchanged by the move.

# POOLSE-38 · Staff menu, nested under Instalações

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Navigation · **Priority:** Medium
**Depends on:** POOLSE-35 (the staff/students split)
**Supersedes:** POOLSE-36 — Pessoas is no longer a main menu item at all, so there is nothing to reorder.
**Amends:** POOLSE-34 — Férias becomes a submenu of Staff, which is itself a submenu of Instalações.

### PO — why this exists
"People" was never the right word once the section became staff-only, and it does not deserve a
top-level slot: staff are an attribute of a facility, not a peer of it. Renaming to **Staff** and
nesting it under Instalações says what it is and puts it where people look for it.
**Not in scope:** changing who appears in the section (POOLSE-35 decided that), or the contents of Instalações.

### BA — rules and data
- Menu label becomes **Staff** (pt-PT: *Staff*) everywhere — main navigation, breadcrumbs, page titles, empty states, permission messages.
- **Staff is a submenu of Instalações**, not a main menu item.
- **Férias remains a submenu of Staff**, so the chain is Instalações → Staff → Férias.
- Alunos is unaffected by this ticket and keeps its own place in the navigation.
- Visibility: the Staff submenu appears only to roles that may see staff records; Instalações remains visible per its own rules. A user who can see Instalações but not Staff sees Instalações without that child.
- Old routes (`/people`, `/people/ferias` or equivalent) redirect permanently to the new paths, so bookmarks and any links already sent by email keep working.
- The word "Pessoas" is retired from the UI; POOLSE-35's rules stand unchanged under the new name.
- **Open:** does Instalações become a landing page with its own content *and* a parent menu item, or is it purely a section header once it has children?

### Dev — implementation notes
- Navigation is defined in a single config (structure, labels, icons, permission predicate per item) — this ticket is the reason that config must exist rather than being hardcoded per layout.
- Nesting means the navigation component must render a second level; check the collapsed/mobile variant renders it too, and that the parent shows an active state when a child is active.
- Route changes: move the pages under the Instalações path segment, add permanent redirects from the old paths.
- i18n keys: rename rather than duplicate, and grep for hardcoded "Pessoas"/"People" strings that never went through the translation layer.
- Permission predicates move with the items; do not let a nested item inherit the parent's predicate by accident — Instalações and Staff have different audiences.
- Most likely to be got wrong: breadcrumbs and the browser tab title still saying "Pessoas" after the menu says Staff.

### QA — test scenarios
- **38.1** Given any role that can see staff / When the navigation renders / Then the item reads "Staff", never "Pessoas" or "People".
- **38.2** Given the same / When they open the navigation / Then Staff appears nested under Instalações, not as a top-level item.
- **38.3** Given the Staff section / When it is expanded / Then Férias appears as its child.
- **38.4** Given a user on the Férias page / When they look at the breadcrumb / Then it reads Instalações → Staff → Férias.
- **38.5** Given a bookmark to the old `/people` route / When it is opened / Then it redirects permanently to the new path and renders the section.
- **38.6** Given a role that may see Instalações but not Staff / When the navigation renders / Then Instalações appears without the Staff child, and the staff route returns 403 if called directly.
- **38.7** Given a user on a Staff child page / When they look at the menu / Then the Instalações parent shows an active state.
- **38.8** Given the mobile/collapsed navigation / When it opens / Then the same nesting and order are present.
- **38.9** Given pt-PT and en / When the navigation renders / Then every label in the chain resolves from the translation layer with no missing keys.
- **38.10** Given light and dark mode / When a nested item is active / Then the active state is legible in both.
- **38.11** Given the Alunos section / When this ticket ships / Then its position and label are unchanged.

### Acceptance criteria

1. The menu label is **Staff**, replacing "People"/"Pessoas" throughout the UI, breadcrumbs and page titles.
2. Staff is a **submenu of Instalações**, not a main menu item.
3. **Férias** remains a submenu of Staff.
4. Old routes redirect permanently to the new paths.
5. The Staff submenu is visible only to roles permitted to see staff records; the API enforces the same.
6. The parent shows an active state when any child is active, in both the expanded and collapsed navigation.
7. Navigation structure, labels and permission predicates live in one config.
8. POOLSE-36 is closed as superseded — there is no longer a main-menu Pessoas item to reorder.

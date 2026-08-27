# POOLSE-03 · Archive button restricted to Owner and Admin

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature (permissions) · **Area:** Global · **Priority:** High

### PO — why this exists
Archiving removes records from every default list, so an Instructor or Maintenance user can currently make a turma, a student or a level vanish for the whole tenant with one click. Owners and Admins carry the consequences and should hold the action. High because it is a live data-integrity hole across every module, and because it is one shared check rather than a feature build.
**Not in scope:** defining what archiving means per entity, hard deletion, and POOLSE-07's season archive, which is a different action with its own endpoint.

### BA — rules and data
- `canArchive` is true for Owner and Admin only, evaluated server-side against the roles held in the current tenant.
- A Person holding Instructor *and* Admin can archive: the union of roles applies here (POOLSE-17 AC5), unlike the invite matrix in POOLSE-01.
- The rule covers every surface: primary toolbars, row context menus, bulk-action menus, detail-page actions and any keyboard shortcut.
- Unarchive/restore is governed by the same predicate wherever it exists.
- An inventory of archivable entities is a deliverable of this ticket — students, turmas, levels, pools, people at minimum — because "no exceptions" cannot be verified against an unwritten list.
- Archived records remain fully consultable to permitted roles; this ticket changes who may *perform* the action, never what archived data is visible.
- **Open:** in a bulk archive of 20 rows where 3 are forbidden, does the request fail wholesale or archive the 17? An all-or-nothing rule is simpler to reason about but the source does not decide.
- **Open:** is archive/unarchive audit-logged? POOLSE-07 and POOLSE-14 log their destructive actions; this ticket's ACs are silent.

### Dev — implementation notes
- One exported `canArchive(actor, tenant)` predicate plus a NestJS guard decorator; AC4 exists specifically to prevent the per-page copies that are already the failure mode.
- API: every archive and unarchive route wears the guard. Add a test that enumerates registered routes matching `/archive|unarchive/` and asserts the guard metadata is present, so a new page cannot silently regress the rule.
- The client reads the same predicate through a shared hook to decide button visibility — cosmetic only, never the enforcement point.
- Bulk endpoints need the guard on the endpoint *and* the action array filtered by the predicate, because context menus are usually built from a config array that bypasses per-button checks.
- `403` responses carry an error code; the toast text comes from i18n in pt-PT and en.
- No schema change is expected unless some entities lack `archived_at`; if any do, add it in the same migration so the predicate has something to act on.
- Most likely to be got wrong: sweeping the visible toolbars, declaring victory, and leaving row context menus and bulk menus — the two places AC2 calls out — still rendering the action for Instructors.

### QA — test scenarios
03.1 Given an Owner, When any list or detail view with archiving loads, Then the archive action is present and works.
03.2 Given an Admin, When the same views load, Then the archive action is present and works.
03.3 Given an Instructor, When every page in the archivable-entity inventory loads, Then no archive action appears in toolbars, row menus or bulk menus.
03.4 Given a Student, EE or Maintenance user, When the same sweep is repeated, Then no archive action appears anywhere.
03.5 Given an Instructor's token, When the archive endpoint is called directly for a turma, Then the API returns `403` and `archived_at` stays null.
03.6 Given an Instructor's token, When the unarchive endpoint is called directly, Then the API returns `403`.
03.7 Given an Instructor's token, When a bulk archive request is posted directly with 20 ids, Then the API returns `403` and no row is archived.
03.8 Given a Person holding both Instructor and Admin, When they open a list, Then the archive action is available and the endpoint succeeds.
03.9 Given an Admin in tenant A, When they call the archive endpoint with an id belonging to tenant B, Then the API returns 404/403 and tenant B's row is untouched.
03.10 Given an Admin who is demoted to Instructor mid-session, When they click a still-rendered archive button, Then the API returns `403` and the UI shows the localised denial message.
03.11 Given pt-PT and then en, When a denial toast fires, Then the message renders from the i18n layer in each locale.
03.12 Given dark mode, When the denial toast renders, Then its text and icon pass contrast and the meaning is not carried by colour alone.

### Acceptance criteria

1. Sweep every page/list/detail view that exposes an archive action; the button is hidden for all other roles.
2. Bulk-action menus and row context menus are covered too, not just primary toolbars.
3. The archive endpoint returns `403` for any role other than Owner/Admin.
4. A single shared permission check (`canArchive`) is used everywhere — no per-page duplication.
5. Same rule applies to *unarchive/restore* if such an action exists.

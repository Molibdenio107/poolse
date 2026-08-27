# Poolse — Backlog Spec (PO · BA · Dev · QA)

*27 August 2026 · POOLSE-01 to 36 · supersedes the plain backlog document as the working reference*

Every ticket carries four views of the same work. **PO** says why it exists and what it deliberately
does not do. **BA** states the rules, the data and the edge cases that need a decided answer. **Dev**
covers schema, API, where the logic lives and what is most likely to be got wrong. **QA** gives
numbered `Given / When / Then` scenarios, including permission denial at the API and not only in the
UI. The original **acceptance criteria** are preserved verbatim at the end of each ticket — they are
the contract; the role sections are how it gets built and checked.

Anything genuinely undecided is marked **Open:** rather than guessed at. Those, plus the conflict
register below, are the only things that need a decision from you before work starts.

---

## Conventions that apply to every ticket

These are not repeated in each QA section — treat them as standing acceptance criteria on all work.

- **Server-side enforcement.** Every permission rule is enforced in the API. Hiding a control is a UX detail, never the control. Every QA pass includes at least one denial test issued directly against the endpoint.
- **Tenant scoping.** Every tenant table carries the tenant key and every query is scoped. Any new endpoint gets a cross-tenant access test.
- **i18n.** Every user-facing string goes through the translation layer (pt-PT + en) as it is written. No string is assembled by concatenation; plurals and dates come from the locale.
- **Light and dark.** Every visual change is checked in both themes, contrast-verified. Colour never carries meaning alone — always paired with text, icon or shape.
- **Design tokens.** Three colour systems exist and must stay visually distinct: attendance states (POOLSE-13), role badges (POOLSE-18) and age brackets (POOLSE-33). A fourth is coming with certification status (POOLSE-27).
- **Audit.** Anything destructive, permission-sensitive or GDPR-relevant records actor, subject and timestamp.
- **Soft delete.** History is never destroyed. Removals hide; they do not erase.

---

## Who owns what

| Role | Owns | Signs off on |
|---|---|---|
| **PO** | Priority order, scope boundaries, the Open questions | "Not in scope" lines; whether a ticket ships partially |
| **BA** | Business rules, data model implications, cross-ticket conflicts | The rules table in each ticket; the conflict register below |
| **Dev** | Schema and migrations, API surface, where logic lives | Dependency order; anything marked as a migration |
| **QA** | Test scenarios, regression scope, the standing conventions above | Definition of done per ticket |

Solo build, so these are hats rather than people — but the sign-off column is what to re-read before
calling a ticket done, wearing whichever hat the mistake would belong to.

---

## Conflict register

Eight real contradictions between tickets surfaced while writing this up. Each has a recommended
resolution; none is settled until you say so.

**C1 · POOLSE-06 and POOLSE-16 fight over the same field.**
06 migrates minimum/maximum age to months; 16 raises the maximum ceiling from 30 to 100. Shipped
separately, the second migration contradicts the first's stored unit.
→ *Recommended:* ship them as one migration. 06 owns the unit change, 16 owns the ceiling and the
senior seed data, and neither merges to main alone.

**C2 · POOLSE-08 sorts alphabetically, POOLSE-32 sorts by surname.**
The same students can appear in a different order in two places.
→ *Recommended:* one sort rule everywhere — by surname, then first name. Amend POOLSE-08 AC5.

**C3 · POOLSE-04 hardcodes 18, POOLSE-22 makes it a tenant setting.**
→ *Recommended:* POOLSE-22 explicitly amends POOLSE-04 AC1. If 22 ships first, 04 is written against
the setting from the start and the conflict never exists.

**C4 · POOLSE-17 says permissions are the union of roles; POOLSE-01 says the invite matrix uses the
strongest role held.** Two rules for one check.
→ *Recommended:* keep both, and say so plainly — general permissions resolve to the **union**, the
invite matrix resolves to the **strongest role**. A union reading would let an Instructor+Admin invite
through two paths that give different answers.

**C5 · POOLSE-21 AC3 and AC4 are mutually exclusive on a full turma.**
AC3 requires an open seat; AC4 restricts redemption to slots where someone is already absent.
→ *Recommended:* AC4 is a tenant toggle that *replaces* AC3's open-seat test when enabled, rather
than adding to it.

**C6 · POOLSE-22's tenant maioridade vs POOLSE-33's fixed 12–17 / 18–59 bracket boundary.**
→ *Recommended:* leave 33 fixed. Age-bracket icons are a display taxonomy, not a legal threshold —
they should not move when a tenant changes its age of majority.

**C7 · POOLSE-28 counts reposição guests per bather; POOLSE-21 AC8 excludes them from enrolled
counts.**
→ *Recommended:* both are correct and should be stated as such — **per-bather uses attendance**
(guests included, because they consume heat), **occupancy uses enrolment** (guests excluded).

**C8 · POOLSE-29 says no list renders unbounded; POOLSE-15 requires the hover card to show the full
student list.**
→ *Recommended:* the hover card is not a list view. Keep it complete, capped by a scrollable max
height — which POOLSE-15 AC3 already specifies.

---


# Batch 1 — POOLSE-01 to 18

## POOLSE-01 · Invitation permissions by role

**Type:** Feature · **Area:** Backoffice / Auth · **Priority:** High
**Depends on:** POOLSE-17 (roles are assignments on a Person; the matrix reads the roles held)

### PO — why this exists
Any account can currently invite any role, including Owner, so a single Instructor login is enough to take over a tenant. This is a privilege-escalation defect in a multi-tenant product, not a UX nicety, which is why it sits at High alongside the bugs. Owners and Admins benefit directly — they get a tenant whose membership they actually control — and every other tenant benefits from the blast radius being closed.
**Not in scope:** the invitation email, the acceptance/onboarding flow, seat counting or billing, and relaxing the Maintenance rule later.

### BA — rules and data

| Inviter | May invite |
|---|---|
| Owner | Any role, including Owner |
| Admin | Any role **except** Owner |
| Instructor | Student, Encarregado de Educação — nothing else |
| Student | Nobody |
| Encarregado de Educação | Nobody |
| Maintenance | Nobody (for now) |

- The matrix above is configuration data keyed inviter-role → allowed invitee-roles, and is the single source consulted by both the dropdown and the server guard.
- The rule governs role *changes* as well as new invitations: promoting an existing Person to a role you may not invite is the same denial, on the person-edit path.
- Entities: `Invitation` (tenant, invitee email, role, inviter person, status, created_at, expiry) and `RoleAssignment` on Person (POOLSE-17).
- POOLSE-17 AC5 says permissions resolve to the **union** of a Person's roles but that the invite matrix uses the **strongest role held** (Owner → Admin → Instructor → Maintenance → EE → Student). Keep the strongest-role reading here; a union reading would let an Instructor+Admin invite via two paths with different answers.
- Invitations already pending at ship time keep the role they were issued with, even a role their inviter could no longer issue today.
- If the invitee's email already belongs to a Person in the tenant, the operation is a role *addition* (POOLSE-17 AC9 dedup), and must pass through the same matrix check rather than a separate code path.
- Audit entry carries inviter, invitee email, role and timestamp, tenant-scoped.
- **Open:** is an Instructor limited to inviting students/EE connected to their own turmas, or any student in the tenant?
- **Open:** are *denied* attempts audit-logged as well as issued ones? AC6 covers issued invitations only, and a denial is the more interesting security event.
- **Open:** may an Owner demote or remove the last remaining Owner? The matrix says nothing about leaving a tenant ownerless.

### Dev — implementation notes
- Express the matrix as a typed constant map in a shared package imported by the NestJS guard and the Next.js client — never a second copy in the UI.
- API surface: `POST /invitations` and the role-mutating `PATCH /people/:id/roles` both call one `assertCanAssignRole(actor, targetRole, tenant)` helper, invoked in a guard before body validation so a forbidden role never reaches the service layer.
- Reject with `403` and a machine-readable error code; the client maps the code to an i18n key rather than displaying a server-authored string.
- The actor's roles must be read for the *current* tenant key, not globally — a Person may be Owner in one tenant and Student in another.
- Hiding the Invite entry point (AC2) keys off "the matrix yields a non-empty list for this actor", so relaxing the Maintenance rule stays a one-line config change with no UI edit.
- Role labels come from the shared role-label i18n keys also used by POOLSE-18 badges, so pt-PT and en stay consistent across dialog, filter and badge.
- If no audit table exists yet: `audit_log(tenant, actor_person_id, action, subject, payload jsonb, created_at)` with an index on `(tenant, created_at desc)`.
- Most likely to be got wrong: treating the filtered dropdown as the control and leaving the role-change endpoint (AC4) open — that endpoint, not the invite dialog, is the actual escalation path.

### QA — test scenarios
01.1 Given an Owner, When the invite dialog opens, Then the role dropdown lists all six roles including Owner.
01.2 Given an Admin, When the invite dialog opens, Then Owner is absent from the dropdown and the other five are present.
01.3 Given an Instructor, When the invite dialog opens, Then only Student and Encarregado de Educação are offered.
01.4 Given a Student, EE or Maintenance user, When they browse People, Alunos and any detail page, Then no Invite button or entry point appears anywhere.
01.5 Given an Admin's session token, When `POST /invitations` is called directly with `role: Owner`, Then the API returns `403` and no Invitation row is written.
01.6 Given an Admin, When `PATCH /people/:id/roles` is called directly to add Owner to an existing Person, Then the API returns `403` and the Person's roles are unchanged.
01.7 Given an Instructor's token, When `POST /invitations` is called with `role: Instructor`, Then the API returns `403`.
01.8 Given a pending Owner invitation created before this ships, When the feature is deployed, Then the invitation remains valid and acceptable.
01.9 Given a successful invitation, When the audit log is inspected, Then one entry records inviter, invitee email, role and timestamp, scoped to the correct tenant.
01.10 Given a Person who is both Instructor and Admin, When they open the invite dialog, Then the Admin row of the matrix applies (all roles except Owner), not the union of both rows.
01.11 Given an Admin in tenant A whose Person also holds Student in tenant B, When they invite while switched to tenant B, Then only tenant B's Student row applies and the Invite entry point is absent.
01.12 Given the locale set to pt-PT then en, When a `403` denial is returned, Then the message renders from the i18n layer in each locale and never shows a raw server string.

### Acceptance criteria

1. The role dropdown in the invite dialog lists **only** the roles the current user is allowed to invite.
2. Users with no invite rights (Student, EE, Maintenance) do not see the "Invite" button or entry point anywhere.
3. The API rejects a disallowed invitation with `403`, even if the request is crafted directly.
4. An Admin cannot escalate an existing user to Owner either — the rule applies to role *changes*, not only new invites.
5. Invitations already pending when this ships are unaffected.
6. Each invitation is written to the audit log with inviter, invitee email, role and timestamp.

**Notes:** "Maintenance cannot invite" is marked *for now* — implement as a matrix/config, not scattered `if` checks, so it is one line to change later.

---

## POOLSE-02 · Week calendar: show the full week range, centred

**Type:** Improvement · **Area:** Calendar · **Priority:** Medium

### PO — why this exists
In week view the header does not state which week is on screen, so staff scheduling a turma have to read the column dates to orient themselves, and screenshots sent to colleagues carry no date at all. Front-desk and instructors are the daily users of this view. Medium because it is cheap and constant friction rather than a blocker.
**Not in scope:** changing the first day of the week, day/month view headers, and the navigation controls themselves.

### BA — rules and data
- The header shows the full range of the displayed week, formatted from the active locale.
- pt-PT renders `24 de agosto de 2026 a 30 de agosto de 2026`; en renders `24 August 2026 to 30 August 2026`.
- The year is repeated on both ends even when both dates fall in the same year — AC1's example is the decided form.
- Cross-month (`31 de agosto de 2026 a 6 de setembro de 2026`) and cross-year (`28 de dezembro de 2026 a 3 de janeiro de 2027`) ranges render with each date fully qualified.
- Below a narrow breakpoint the header switches to the short month form (`24 ago 2026 a 30 ago 2026`) and truncates with an ellipsis; it never wraps to a second line, because the header height is fixed by the calendar grid.
- The text is centred against the header block, not against the space left between the prev/next controls, so unequal control widths do not shift it off centre.
- Purely presentational: no schema, no API and no permission surface.
- **Open:** is the week Monday-start for both pt-PT and en, or does the en locale start on Sunday? The rendered range depends on it and the source does not say.

### Dev — implementation notes
- Format via `Intl.DateTimeFormat` (or the date-fns locale) using the app locale; AC4 rules out concatenating day/month/year strings.
- The joining word (`a` / `to`) is an i18n key taking the two pre-formatted dates as parameters, so a locale can reorder or repunctuate the sentence.
- Build the header as a three-column grid (prev · title · next) with the title column centred, rather than a flex row with `justify-content: space-between` — the latter is where the off-centre bug comes from.
- Long/short month variants: prefer rendering both and toggling with a container query or Tailwind breakpoint over measuring in JS, which causes a layout flash on first paint.
- Derive the range from the calendar's local dates, not from a UTC instant — a Sunday 23:00 UTC boundary otherwise labels the wrong week for Lisbon in summer time. This is the thing most likely to be got wrong.
- No new colour token; confirm the existing muted-foreground token still passes contrast against the header surface in dark mode.

### QA — test scenarios
02.1 Given pt-PT and the week of 24 Aug 2026, When week view loads, Then the header reads `24 de agosto de 2026 a 30 de agosto de 2026`.
02.2 Given en and the same week, When week view loads, Then the header reads `24 August 2026 to 30 August 2026`.
02.3 Given any week, When the header is measured, Then its text is centred on the header block regardless of the widths of the prev/next controls.
02.4 Given the week of 31 Aug 2026, When week view loads, Then both months appear correctly across the boundary.
02.5 Given the week of 28 Dec 2026, When week view loads, Then both years appear correctly across the boundary.
02.6 Given a 360 px viewport, When week view loads, Then the short month form is used and the header stays on one line.
02.7 Given a 360 px viewport and a cross-month week, When week view loads, Then the text truncates with an ellipsis rather than wrapping.
02.8 Given the browser timezone set to Europe/Lisbon and the clock at Sunday 23:30 local during summer time, When week view loads, Then the header shows the week containing that local Sunday, not the next one.
02.9 Given dark mode in both locales, When week view loads, Then the header text passes contrast against the header surface.
02.10 Given the locale switched from pt-PT to en without a reload, When week view re-renders, Then the header re-formats to the en pattern.
02.11 Given the user navigates forward three weeks, When each week renders, Then the header updates to that week's range every time.
02.12 Given a locale-formatting failure (unsupported locale tag), When week view loads, Then it falls back to a valid formatted range rather than rendering `Invalid Date`.

### Acceptance criteria

1. Header reads e.g. `24 de agosto de 2026 a 30 de agosto de 2026` (pt-PT) / `24 August 2026 to 30 August 2026` (en).
2. Text is horizontally centred in the header block.
3. Cross-month and cross-year weeks render correctly (e.g. `31 de agosto de 2026 a 6 de setembro de 2026`).
4. Date formatting comes from the locale, not string concatenation.
5. Truncates gracefully on narrow/mobile widths (short month form) rather than wrapping into two lines.

---

## POOLSE-03 · Archive button restricted to Owner and Admin

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

---

## POOLSE-04 · Guardian block for students under 18

**Type:** Feature · **Area:** Students · **Priority:** High
**Depends on:** POOLSE-17 (one Person, many roles)

> **Revised 27 Aug** — supersedes the earlier "free-text fields on the student record" version.
> Depends on **POOLSE-17** (one Person, many roles).

### PO — why this exists
A minor cannot be enrolled without a responsible adult, yet the record has nowhere to say who that adult is, so the office keeps contact details in heads and spreadsheets. Storing the guardian as free text would have created a second copy of a human who is often already in the system — a second phone number to keep in sync, a second address to update. Admins doing enrolments and anyone who has to reach a family in a hurry benefit; High because it blocks correct enrolment of minors and gets more expensive with every record entered before it lands.
**Not in scope:** inviting the guardian to create a login (POOLSE-01's flow), consent and waiver forms (POOLSE-22), and routing billing to the guardian (POOLSE-24).

### BA — rules and data
- Entities: `Person` (POOLSE-17) and `GuardianLink(tenant, student_person_id, guardian_person_id, relationship, is_primary, created_at)`.
- Relationship type lives on the link, never on the Person, so the same human can be avó to one student and tutor legal to another.
- Exactly one guardian per student may be `is_primary`; a minor requires at least one link, an adult may have zero or more.
- Guardian contact data is read-only in this block and edited only on the guardian's own Person page — one source of truth for phone, email, NIF and address.
- Turning 18 collapses the block and makes the link optional; nothing is deleted, and the guardian's Person page keeps listing that student.
- The 18-year boundary is hardcoded here but POOLSE-22 makes `maioridade` a per-tenant integer. Conflict: build the boundary as one shared function reading a single value now, so POOLSE-22 is a value swap rather than a rewrite of this block.
- A guardian's own Person page lists every student they are responsible for — one guardian to many students (POOLSE-35 AC5).
- Self-links must be rejected: a Person cannot be their own encarregado de educação.
- The relationship list in AC2 reads *mãe, pai, avó, tutor legal, outro* — **Open:** is the omission of *avô* deliberate, or should the enum carry both grandparent forms (and any other gendered pairs)?
- **Open:** may a Person who is themselves a minor be selected as a guardian? Nothing currently blocks it.
- **Open:** what does the block do when date of birth is empty — hide (treating unknown as adult) or show and require a guardian? The show/hide rule in AC1 assumes a known DOB.

### Dev — implementation notes
- Migration: `guardian_links` with a relationship enum, a partial unique index `(tenant, student_person_id) WHERE is_primary`, and composite foreign keys on `(tenant, person_id)` so a link can never cross tenants.
- API: `GET /people?q=` for the search-and-select path; the inline-create path creates the Person and the link inside one transaction, so a failed link never leaves an orphan Person behind.
- Age lives in one shared `ageInMonths(dob, at)` helper reused by POOLSE-06 eligibility, POOLSE-16 and POOLSE-33 brackets; the block's show/hide is a client-side call on the form's current DOB value, but the "minor needs a guardian" rule is enforced server-side on save.
- The "same as student" address toggle copies values into the new Person at creation time; it is not a live binding, or editing the student's address later silently rewrites the guardian's.
- i18n: relationship labels, the address toggle, the empty state and every validation message; keep relationship values as stable enum keys with translated labels, never translated values.
- Theming: render as a distinct `Card`/fieldset using existing surface and border tokens — no new colour, and the visual distinction must survive dark mode without relying on a background tint alone.
- Performance: the guardian's Person page lists their students with a single tenant-scoped join, not one query per link.
- Most likely to be got wrong: re-mounting the block when DOB changes, which wipes the guardian data typed in this session and breaks AC7; keep the block's state outside the conditional render.

### QA — test scenarios
04.1 Given a new student with DOB making them 10, When the form renders, Then the guardian section appears as its own distinct section.
04.2 Given a student aged 25, When the form renders, Then no guardian section appears.
04.3 Given a minor and an existing Person searched and selected, When the form is saved, Then a link is created, the Person gains the Encarregado de Educação role, and their contact data shows read-only.
04.4 Given a minor and the inline-create path, When name, relationship, phone and email are entered and saved, Then one Person and one link are created and no duplicate Person appears in Alunos.
04.5 Given a minor with no guardian, When save is attempted, Then it is rejected with a localised inline error naming the missing guardian.
04.6 Given a minor with no guardian, When the save endpoint is called directly bypassing the UI, Then the API returns a validation error and no student record is persisted.
04.7 Given a student with two guardians, When one is marked primary, Then the other is unmarked and only one primary exists in the database.
04.8 Given a form with guardian data typed and DOB edited from 2010 to 2000 and back, When the block re-appears, Then the previously typed guardian data is still present.
04.9 Given a student who turns 18 overnight, When their record is opened the next day, Then the guardian link still exists, the block is collapsed and optional, and nothing was deleted.
04.10 Given a guardian who is avó to student A and tutor legal to student B, When each student is opened, Then each shows its own relationship value and the Person record shows one phone number.
04.11 Given a guardian's Person page, When it loads, Then all students they are responsible for are listed, and a student added afterwards appears without an edit to the guardian.
04.12 Given pt-PT then en, and light then dark mode, When the block renders, Then relationship labels and validation messages are translated and the section boundary is visible in both themes.

### Acceptance criteria

1. Age is computed from date of birth; the block appears automatically when age < 18 and is hidden when ≥ 18.
2. The block lets the user **search and select an existing Person**, or **create a new one inline** (name, relationship to student, phone, email, NIF optional, address optional with a "same as student" toggle).
3. Selecting an existing Person grants them the *Encarregado de Educação* role for this student; their contact data is shown read-only, edited on their own Person page.
4. Relationship to the student (mãe, pai, avó, tutor legal, outro) is stored on the **link**, not on the Person — the same person can be a grandmother to one student and a legal guardian to another.
5. A minor cannot be saved without at least one guardian link; more than one guardian per student is supported, with one marked primary contact.
6. The block appears as its own visually distinct section, consistent with the rest of the form.
7. Toggling the date of birth across the 18-year boundary shows/hides the block live, without losing entered data in the session.
8. When a student turns 18 the guardian link is **retained** but the block collapses and becomes optional — nothing is deleted.
9. From the guardian's own Person page, the students they are responsible for are listed.

**Out of scope:** inviting the guardian to create a login from this block — that is POOLSE-01's invite flow.

---

## POOLSE-05 · Levels ordering via drag and drop

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

---

## POOLSE-06 · Minimum age must support months under 1 year

**Type:** Improvement · **Area:** Levels / Classes · **Priority:** Medium

### PO — why this exists
Baby classes start at six months, and a field that only accepts whole years cannot express that, so baby levels are either configured wrong or configured as "0 years" and their eligibility check is meaningless. The same field's ceiling of 30 makes every senior student ineligible for every level. Admins configuring levels benefit, and so does anyone whose enrolment is currently blocked or wrongly allowed. Medium because the workaround is to ignore the eligibility check, which is exactly the wrong habit to build.
**Not in scope:** per-turma age overrides, age-based pricing (POOLSE-23 AC4), and the age-bracket badge (POOLSE-33).

### BA — rules and data
- Minimum and maximum age are both stored as integer **months**; existing year values migrate as `years × 12`.
- The picker offers `1 month … 11 months`, then `1 year … 100 years` — months only below 12, whole years above.
- Display follows the same rule in both locales, with singular and plural from i18n: `1 mês`, `6 meses`, `1 ano`, `3 anos`.
- Eligibility ("can this student join this level/class?") compares in months on both ends.
- Validation: maximum must be strictly greater than minimum; both accept 1 month … 100 years, i.e. 1 … 1200 months.
- Import and export columns use the same representation as the UI, in both directions.
- This ticket's AC6 and AC8 restate POOLSE-16's AC1 and AC4 (ceiling of 100, senior seed data). They are one change to the same field — ship them together, and do not write two migrations against the same columns.
- **Open:** at what date is a student's age evaluated for eligibility — today, the enrolment date, or the season start? The three give different answers for a child who turns 4 mid-season.
- **Open:** what does the Excel column literally carry — a locale-dependent label (`6 meses`) or an integer with the unit in the header? AC5 says "the same representation as the UI", which for a spreadsheet is ambiguous.

### Dev — implementation notes
- Migration: convert `min_age_years`/`max_age_years` to `min_age_months`/`max_age_months` with `× 12`, add `CHECK (max_age_months > min_age_months)` and `CHECK (min_age_months BETWEEN 1 AND 1200)`. Data volume is small, so a single migration is fine — but write the down path, because the year columns cannot be recovered from months once dropped without rounding.
- Raise the ceiling in the DB constraint, the API validation schema and the UI picker in the same change; a constraint left at 30 turns POOLSE-16 into a runtime error rather than a validation message.
- The picker is one grouped `Select` (a "Meses" group and an "Anos" group) whose value is always months — no unit dropdown beside a number field, which invites 6-years-meant-as-months.
- Reuse the shared `ageInMonths(dob, at)` helper from POOLSE-04 so eligibility, the guardian boundary and POOLSE-33's brackets cannot drift.
- i18n: use ICU plural forms. Portuguese has an irregular singular here — `1 mês` / `2 meses`, not `1 mes` — so a naive `+ 's'` will read wrong in the UI and in exports.
- The Excel import path validates through the same Zod schema as the API, so a fractional or out-of-range value is rejected identically in both entry points.
- Seed data gains a senior level (*Hidroginástica Sénior*, 60–100) and students aged 60+, so the top of the range is exercised by tests rather than only by production.
- Most likely to be got wrong: a code path still reading years — a report filter, an eligibility branch or an export column — which silently treats 72 months as 72 years.

### QA — test scenarios
06.1 Given an existing level with minimum age 3 years, When the migration runs, Then its stored minimum is 36 months and the UI displays `3 anos` / `3 years`.
06.2 Given the minimum-age picker, When it opens, Then it offers 1–11 months and then whole years from 1 to 100, with no `0 months` and no `12 months` entry.
06.3 Given a level with minimum 6 months, When it renders in pt-PT and en, Then it reads `6 meses` and `6 months`.
06.4 Given a level with minimum 1 month, When it renders in pt-PT, Then it reads `1 mês`, not `1 meses`.
06.5 Given a level 6–11 months and a student aged 5 months, When eligibility is checked, Then the student is ineligible; at 6 months exactly, eligible.
06.6 Given a level with minimum 100 years, When save is attempted with maximum 100 years, Then it is rejected because maximum must be greater than minimum.
06.7 Given a crafted API request with `max_age_months: 1201`, When it is posted, Then it is rejected by validation and by the DB constraint.
06.8 Given a crafted API request with `min_age_months: 0`, When it is posted, Then it is rejected.
06.9 Given a level export followed by re-import of the same file unchanged, When the import completes, Then no level's age range has changed.
06.10 Given an Excel import row with a maximum age of 85, When it is imported, Then it is accepted without a validation error.
06.11 Given the senior seed level (60–100) and a seeded student aged 84, When eligibility is checked, Then the student is eligible and appears in level filters.
06.12 Given a student who turns 4 the day after a season starts and a level with minimum 4 years, When eligibility is evaluated, Then the result is consistent with the decided evaluation date and identical in the UI and the import path.

### Acceptance criteria

1. Minimum age is **stored in months** (integer); existing year values are migrated as `years × 12`.
2. The picker offers `1 month … 11 months`, then `1 year`, `2 years`, … — i.e. months only below 12.
3. Display follows the same rule: `6 meses` / `6 months`, `1 ano` / `1 year`, `3 anos` / `3 years`. Singular/plural handled by i18n.
4. Eligibility checks (can this student join this level/class?) compare in months.
5. Any export/import column for minimum age uses the same representation as the UI.
6. **Maximum age** uses the same field type and picker, and its ceiling is raised from 30 to **100** — Poolse runs classes for older adults, and a level capped at 30 silently makes them ineligible.
7. Validation: maximum age must be greater than minimum age; both accept the full 1 month … 100 years range.
8. Any seeded/demo data includes at least one senior level (e.g. *Hidroginástica Sénior*, 60–100) so the range is exercised, and a few students aged 60+.

---

## POOLSE-07 · Reset season (Owner/Admin only)

**Type:** Feature · **Area:** Seasons · **Priority:** Medium

### PO — why this exists
At the end of an época the only way to start clean is to hand-delete classes, enrolments and attendance, which is slow and destroys the history the school needs for the following year. One explicit action that archives what happened and opens an empty season replaces a week of careful deletion. Owners and Admins are the only users, once a year. Medium because it is seasonal — but the wrong shortcut taken in its absence is irreversible.
**Not in scope:** rolling enrolments or the timetable forward into the new season, end-of-season billing closure, and reporting across seasons beyond keeping archived ones selectable.

### BA — rules and data
- Reset archives the current season — kept read-only and fully consultable, including classes, enrolments, attendance and history — and creates a new empty season, set active.
- The new season starts with no classes, enrolments or attendance. Students, levels and pools are tenant-level data and are untouched.
- Owner and Admin only; the endpoint returns `403` for every other role, and the button is hidden accordingly.
- Confirmation is typed: the user enters the season name or `RESET`; the dialog states in plain language what is kept and what starts empty.
- Read-only is a server-enforced rule, not a UI state: writes against an archived season are rejected wherever they originate.
- Exactly one season is active per tenant at any time.
- Archived seasons remain selectable in reporting and filters.
- **Open:** does skill progress (POOLSE-20) belong to the season or to the Person? If season-scoped, a reset wipes every student's progression and POOLSE-19's advancement restarts from zero — this needs deciding before the first reset is run in anger.
- **Open:** what happens to reposição credits (POOLSE-21) that are still available when a season is reset — carried, expired, or blocked from reset? This is the same question as the source doc's open point 4.

### Dev — implementation notes
- Schema: `seasons(tenant, name, starts_on, ends_on, status)` with a partial unique index enforcing one `status = 'active'` row per tenant.
- API: `POST /seasons/reset` performs archive + create + activate in one transaction, taking a row lock on the tenant's active season so two concurrent resets cannot both succeed. Accept an idempotency key so a retried request after a timeout does not create two blank seasons.
- Nothing is copied or deleted: archiving flips a status column, so every historical row stays exactly where the reports already read it from.
- Write-blocking on archived seasons belongs in one guard resolving the target season from the payload, not in each service — otherwise the enrolment and attendance endpoints each need their own check and one will be missed.
- The typed confirmation compares trimmed, case-insensitively, and accent-insensitively when the user types a Portuguese season name; `RESET` is a literal and must not be translated.
- i18n: the dialog's kept/emptied explanation is prose, so give it its own keys per sentence rather than assembling it from fragments — pt-PT will not follow English word order.
- Audit-log the action with actor, timestamp, the archived season id and the new season id.
- Most likely to be got wrong: treating "read-only" as a UI concern — the archived season stays writable through the API and last year's attendance quietly changes.

### QA — test scenarios
07.1 Given an Owner, When the Seasons page loads, Then a "Reset season" action sits next to "Add season".
07.2 Given an Instructor, When the Seasons page loads, Then no reset action is shown.
07.3 Given an Instructor's token, When `POST /seasons/reset` is called directly, Then the API returns `403` and no season is created or archived.
07.4 Given the confirmation dialog, When the typed value does not match the season name or `RESET`, Then the confirm button stays disabled.
07.5 Given a confirmed reset, When it completes, Then the previous season is archived and a new empty season is active, with zero classes, enrolments and attendance.
07.6 Given a completed reset, When the archived season is opened, Then its classes, enrolments, attendance and history are all readable.
07.7 Given an archived season, When an attendance write is posted directly against one of its occurrences, Then the API rejects it and the stored record is unchanged.
07.8 Given a completed reset, When the Alunos, Levels and Pools lists are opened, Then all tenant-level data is intact.
07.9 Given a completed reset, When a report's season filter is opened, Then the archived season is selectable and its figures are unchanged.
07.10 Given the confirm button double-clicked, or the request retried after a timeout, When the calls complete, Then exactly one new season exists.
07.11 Given two Admins confirming a reset at the same moment, When both requests land, Then one succeeds, the other fails cleanly, and exactly one active season remains.
07.12 Given pt-PT and en, and light and dark mode, When the dialog renders, Then the kept/emptied explanation is translated and the destructive styling passes contrast without carrying the warning by colour alone.

### Acceptance criteria

1. Button visible only to Owner and Admin; endpoint returns `403` for anyone else.
2. On confirm: the current season is archived (kept read-only and fully consultable — classes, enrolments, attendance, history) and a new empty season is created and set active.
3. The new season starts with **no** classes, enrolments or attendance. Students, levels and pools remain as tenant-level data.
4. Confirmation dialog is explicit and typed-confirmation style (user types the season name or "RESET"), since the action is not undoable in one click.
5. The dialog states in plain language what is kept and what starts empty.
6. Action is audit-logged with actor and timestamp.
7. Archived seasons remain selectable in reporting/filters.

**Open question left as a default:** the new season's name/date range — default to the next period suggestion, editable in the dialog.

---

## POOLSE-08 · Turmas: list student names

**Type:** Improvement · **Area:** Classes (Turmas) · **Priority:** Low

### PO — why this exists
A turma card shows a count but not who is in it, so identifying the right turma means opening several. Instructors scanning for their group and admins moving a student are the beneficiaries. Low because it is a convenience over an existing count, and because POOLSE-15 carries the fuller version.
**Not in scope:** the hover card with the untruncated list (POOLSE-15), editing enrolments from the card, and showing anything beyond names.

### BA — rules and data
- Names come from enrolments in the **currently selected season** only; an archived season's enrolments never leak into the active view.
- Names render as a bulleted list inside the turma card or row, one step smaller than body text, in the muted style, still contrast-compliant.
- The list collapses after N names (N = 8 suggested) with a "+X more" affordance rather than stretching the card.
- Empty state: `Sem alunos inscritos` / `No students enrolled`.
- AC5 says names are "ordered alphabetically", while POOLSE-32 AC5 says sorting is by **surname** and AC2 says the displayed name in rosters is first name + last surname. Conflict: alphabetical-by-displayed-name and alphabetical-by-surname give different lists. **Open:** which wins here?
- Forward constraint from POOLSE-21 AC8: a student attending as a reposição is a guest on that roster and is **excluded** from this enrolled-student list, though they count for attendance.
- Occupancy figures elsewhere on the card count enrolments, never the truncated list length.
- **Open:** does "+X more" expand in place or open the turma detail? POOLSE-15 puts the remainder in a hover card, and POOLSE-15 AC7 removes hover on touch — so a touch user needs a non-hover route to the rest of the names.

### Dev — implementation notes
- The turma list endpoint returns the first N + 1 names and the total per turma from one query — a lateral join with `LIMIT` — never a follow-up request per card. With POOLSE-29's 15 rows per page, per-card fetching is 15 extra round trips.
- Display names come from the shared display-name helper (POOLSE-32), so the abbreviated form is derived, never assembled in the component and never stored.
- Sorting happens in SQL on the name part the decision above selects, so the truncated set is the first 8 of the true order rather than the first 8 of an arbitrary order sorted client-side.
- i18n: the empty-state key and a pluralised "+X more" key; both locales.
- Use the muted-foreground token and an existing type step rather than a hardcoded grey and font size, so the list stays legible in dark mode.
- Cap the rendered list height so cards in a grid keep a stable row height when one turma has eight names and its neighbour has one.
- Most likely to be got wrong: forgetting the season scope, so a card lists last year's enrolments alongside this year's.

### QA — test scenarios
08.1 Given a turma with three enrolled students in the active season, When its card renders, Then the three names appear as a bulleted list.
08.2 Given a turma with no enrolments, When its card renders, Then it reads `Sem alunos inscritos` in pt-PT and `No students enrolled` in en.
08.3 Given a turma with 12 enrolled students, When its card renders, Then 8 names are listed with a "+4 more" affordance and the card does not stretch.
08.4 Given a turma with exactly 8 students, When its card renders, Then all 8 appear and no "+X more" affordance is shown.
08.5 Given a student enrolled only in an archived season, When the active season is selected, Then that name does not appear on the turma card.
08.6 Given the season selector switched, When the list re-renders, Then the names change to that season's enrolments.
08.7 Given a page of 15 turmas, When the network is inspected, Then no per-card request for names is fired.
08.8 Given a student attending as a reposição guest, When the turma card renders, Then that student is not in the enrolled list although they appear in attendance.
08.9 Given a student named "Maria Isabel Costa Silva", When the card renders, Then the abbreviated display form is used and the row does not wrap or overflow.
08.10 Given the same turma, When the list order is inspected, Then it matches the decided sort rule and is identical after a reload.
08.11 Given light and dark mode, When the name list renders, Then the muted text passes contrast in both.
08.12 Given a student unenrolled from a turma, When the list is refreshed, Then the name disappears and the count and "+X more" figure both update.

### Acceptance criteria

1. Student names render as a bulleted list inside the turma card/row.
2. Font size one step smaller than the card's body text (secondary/muted style), still contrast-compliant.
3. Long lists collapse after N names with a "+X more" affordance (suggest N = 8) instead of stretching the card.
4. Empty state reads "Sem alunos inscritos" / "No students enrolled".
5. Names are ordered alphabetically and reflect enrolments for the currently selected season.

---

## POOLSE-09 · Invite form must not clear the email field on validation error

**Type:** Bug · **Area:** Backoffice / Invitations · **Priority:** High
**Depends on:** POOLSE-01 (the same dialog gains a role-permission denial path)

### PO — why this exists
A mistyped email or a forgotten role wipes the address the user just typed, so the correction they were about to make becomes a retype from memory — and the misspelling they need to see is gone. Owners, Admins and Instructors hit this on the tenant's main onboarding path. High because it is a defect on an everyday flow and the fix is small.
**Not in scope:** redesigning the invite dialog, building bulk invite (AC5 governs its behaviour only if it already exists), and the role matrix itself (POOLSE-01).

### BA — rules and data
- On any validation failure the typed email is preserved **verbatim**, including the misspelling and any stray whitespace the user can see, so it can be corrected in place.
- Field-level inline errors are required for both cases named in the bug: invalid email format, and role not selected.
- Focus moves to the first field in visual order that carries an error.
- The field is cleared only after a successful invitation.
- Validation fires on submit and on blur — not on every keystroke, which would flag a half-typed address as invalid.
- If bulk invite exists, the same rule applies per entry: valid entries and invalid entries are distinguishable and the invalid text survives.
- **Open:** in a partial bulk success — 3 of 5 invitations issued — are the successful entries cleared and the failures kept, or is the whole input retained?
- **Open:** do server-side failures count as "validation failure" for AC1? A `403` from POOLSE-01, a duplicate pending invitation, or an email that already belongs to a member all clear the field today. The user-visible defect is identical, so the rule should be "any non-success response preserves the input" — confirm.

### Dev — implementation notes
- The likely root cause is an unconditional `reset()` in the mutation handler (or `onSettled`, which fires on error too) rather than in `onSuccess`; check that before rewriting the form.
- A changing `key` on the dialog or the form that re-mounts on state change produces the same symptom — rule it out, since the fix differs.
- Errors live in form state and render inline; a toast-only error path cannot satisfy AC2 or AC3.
- Focus management: set focus on the first errored field and wire `aria-describedby` from the input to its message, so the error is announced rather than only seen.
- i18n: validation messages are keys with the field name interpolated. Zod schemas must carry message keys, not English literals, or the pt-PT dialog shows English errors.
- Error styling is border + icon + text; colour never carries the meaning alone, and both variants need contrast checking in dark mode.
- The dialog almost certainly shares a form wrapper with other dialogs, so check whether the same reset bug is present there before closing — the sibling-widget lesson from POOLSE-10.
- Most likely to be got wrong: fixing the client-side validation path and leaving the server-error path resetting the form, which is the case a user hits when POOLSE-01's `403` lands.

### QA — test scenarios
09.1 Given the invite dialog, When `maria@exemplo` is submitted with a role selected, Then the input still contains `maria@exemplo` and an inline format error is shown.
09.2 Given a valid email and no role selected, When submit is pressed, Then the email is preserved and an inline "role required" error is shown on the role field.
09.3 Given both fields invalid, When submit is pressed, Then focus lands on the email field, the first in visual order.
09.4 Given only the role missing, When submit is pressed, Then focus lands on the role control.
09.5 Given a valid email and role, When the invitation succeeds, Then the email field is cleared.
09.6 Given an Admin submitting `role: Owner` and the API returning `403` (POOLSE-01), When the response arrives, Then the typed email is still present and a localised error explains the denial.
09.7 Given an email already invited, When submit returns a duplicate error, Then the typed email is preserved.
09.8 Given an email pasted with a trailing space, When submit fails validation, Then the input still shows exactly what was pasted, trailing space included.
09.9 Given submit pressed twice rapidly with a valid payload, When both requests settle, Then one invitation exists and the field is cleared once.
09.10 Given bulk invite with three valid and two malformed addresses, When submit is pressed, Then the malformed entries remain visible and individually flagged.
09.11 Given pt-PT and then en, When each validation error fires, Then the message renders translated with no English fallback.
09.12 Given dark mode, When an error state renders, Then the field border, icon and message all pass contrast and the error is identifiable without colour.

### Acceptance criteria

1. On any validation failure the typed email is preserved verbatim (including a misspelling, so it can be corrected).
2. Inline field-level errors: invalid email format; role not selected.
3. Focus moves to the first field with an error.
4. The field is cleared **only** after a successful invitation.
5. Same behaviour when several emails are entered at once, if bulk invite exists.

---

## POOLSE-10 · Favourite swimming style resets to unselected after save

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

---

## POOLSE-11 · Student photo + Cartão de Cidadão upload

**Type:** Feature · **Area:** Students / Mobile app · **Priority:** Medium
**Depends on:** POOLSE-17 (the document belongs to the Person, not to a role)

### PO — why this exists

Schools need a copy of a student's identification on file, and today staff keep it in email or on a phone. Putting the Cartão de Cidadão next to the profile picture — in the backoffice and in the mobile app, where the student or their encarregado de educação can submit it themselves — removes the paper chase at enrolment. It is Medium rather than High because enrolment works without it, but the storage, access and audit rules must land correctly the first time: this is sensitive personal data and retrofitting privacy is expensive.

**Not in scope:** the GDPR retention rule and the purpose notice shown at upload time (flagged below as its own ticket), OCR or automated extraction of card data, and identity verification of any kind.

### BA — rules and data

- Two distinct slots on the record: profile picture and identification document. They are different objects with different access rules and must never share a storage path or a component (AC1, AC3).
- Per POOLSE-17 the document hangs off the **Person**, once — not off the student role and not duplicated when the same human is also an encarregado de educação.
- Accepted types JPG, PNG, PDF; cap suggested at 10 MB; front and back supported either as two files or as a multi-page PDF (AC2).
- Read/download access: Owner, Admin, Instructor. Student and Encarregado de Educação may view and replace **their own**; every other role sees only a binary "ID submitted ✓ / missing" indicator and never the file (AC4).
- Guardianship grants access: an encarregado de educação may view and replace the document of a student they are linked to (POOLSE-04 link), which is what "their own" means for a guardian.
- Every view or download is audit-logged with actor, student and timestamp (AC6). Uploads and deletions should be logged on the same trail — the acceptance criteria name views and downloads explicitly, and there is no reason for the write path to be quieter.
- Files are stored privately; access is only ever through short-lived signed links (AC7). A signed link must not outlive the session that requested it, and must not be reusable by a different actor once shared.
- Replacement supersedes the previous document rather than overwriting it blindly; deletion is Owner/Admin only (AC8). **Open:** whether the superseded version is retained and for how long — this is exactly the retention question the note defers, so do not decide it here.
- Edge case: a Person who is both a student and an encarregado de educação has one document; a change made from the Alunos side is the same change seen from the guardian side.
- Conflict to watch: POOLSE-35 splits Pessoas (staff) from Alunos (students and guardians), but the document is one object on one Person — the two views must reach the same file, not two.

### Dev — implementation notes

- Schema: a document table keyed on the Person (not the student enrolment), carrying tenant key, kind (`photo` | `id_document`), storage key, MIME type, byte size, page/side ordinal, uploaded-by, uploaded-at, superseded-by. Tenant key on the row and every query scoped, per the data-model rule.
- Storage: private bucket, no public URLs, object keys that are not guessable and carry no personal data. Signed link generation is a server responsibility with a short TTL; never hand the client long-lived credentials or a raw path.
- API surface: request-upload (returns a signed PUT or a server-side upload endpoint), list documents for a Person, request-download (returns a signed GET **and writes the audit row in the same transaction**), replace, delete.
- The audit write must not be a fire-and-forget side effect of the download handler — if the log write fails, the link is not issued. An unlogged download is a compliance failure, not a minor bug.
- Permission logic lives in one shared server-side policy (`canViewIdDocument(person, actor)`), resolving the actor's role union per POOLSE-17 plus any guardianship edge. The mobile app and the backoffice call the same policy; the "submitted ✓ / missing" indicator is a separate, cheaper query that returns a boolean and never a link.
- MIME sniffing on the server, not trust in the client-declared type or the file extension; reject anything outside the allowed set, and reject at the size cap before the bytes are stored, not after.
- i18n: slot labels, empty states, the submitted/missing indicator, error copy and the eventual purpose notice all go through pt-PT and en keys. Theming: both empty-state placeholders and the indicator must read in light and dark mode, and "submitted" must not be signalled by a green dot alone (AC and the global colour rule).
- Mobile app: camera and gallery capture, replace-existing, and resilience to a backgrounded upload — a half-finished upload must not leave a document row pointing at nothing.
- Most likely to get wrong: letting the ID document render through the same avatar component as the profile picture, so a citizen card shows up as a thumbnail in a turma roster. AC3 forbids it; enforce it by giving the document no avatar-shaped accessor at all.

### QA — test scenarios

11.1 Given an Admin on a student record / When they upload a 3 MB JPG to the ID slot / Then it is stored, the slot shows the document state, and the profile picture slot is unchanged.
11.2 Given an ID document exists / When any turma roster, card or avatar is rendered anywhere in the app / Then the document image never appears as the avatar.
11.3 Given an Instructor / When they open the document / Then it opens through a signed link and an audit row records actor, student and timestamp.
11.4 Given a Maintenance user / When they call the download endpoint directly with a valid document id / Then the API returns 403 and no signed link is issued — regardless of the UI hiding the slot.
11.5 Given an encarregado de educação linked to student A / When they request the document of unrelated student B via the API / Then 403; requesting student A's document succeeds.
11.6 Given a 12 MB PDF / When upload is attempted / Then it is rejected with an inline size error before storage, and the slot keeps its previous document.
11.7 Given a file named `card.jpg` whose bytes are actually an executable / When upload is attempted / Then server-side type detection rejects it.
11.8 Given a signed link issued to an Admin / When the link is used after its TTL expires / Then access is denied and re-issuing requires a fresh authorised request.
11.9 Given a document is replaced / When the record is reopened / Then the new document is shown, the previous one is superseded rather than silently destroyed, and the replacement is on the audit trail.
11.10 Given a Person who is both a student and an encarregado de educação / When their document is uploaded from the Alunos side / Then the same single document is visible from their guardian profile — no second record (POOLSE-17).
11.11 Given locale pt-PT then en / When the slots are empty / Then both empty states and the "ID submitted / missing" indicator render in the active language with no missing keys.
11.12 Given dark mode then light mode / When one slot is filled and one is empty / Then both states are legible and distinguishable without relying on colour.
11.13 Given the mobile app with a flaky connection / When an upload from the camera is interrupted / Then no orphan document row is created and the user is told to retry.

**Note — worth flagging:** a Cartão de Cidadão is sensitive personal data under GDPR. Recommend a stated retention rule and a purpose note shown at upload time before this ships. Say the word and I'll write that as its own ticket.

### Acceptance criteria

1. Student record shows two upload slots: profile picture and identification document, each with its own empty-state placeholder.
2. Accepted: JPG, PNG, PDF; size cap (suggest 10 MB); both sides of the card supported (front/back, or multi-page PDF).
3. Uploaded document is **not** rendered as an avatar anywhere — it opens only from its own slot.
4. Visible/downloadable by Owner, Admin and Instructor. Student and EE can view and replace their own; other roles see only an "ID submitted ✓ / missing" indicator.
5. Mobile app: student and EE can upload from camera or gallery, and replace an existing upload.
6. Every view/download of an ID document is audit-logged (actor, student, timestamp).
7. Files are stored privately (no public URLs); access goes through short-lived signed links.
8. Replacing a document supersedes the previous one; deletion allowed for Owner/Admin.

---

## POOLSE-12 · Colourful weather icons in installation details

**Type:** Improvement · **Area:** Installations / Weather · **Priority:** Low

### PO — why this exists

The weather block on an installation page is glanced at, not read — staff want to know in half a second whether today is a rain day for an outdoor basin. Flat monochrome icons force people to read the label to tell cloud from rain. Low priority because nothing is broken, but it is a cheap, visible polish that also fixes an accessibility gap: the icons carry no text alternative today.

**Not in scope:** changing the weather provider, adding forecast horizons, or wiring weather into the energy reporting (that is POOLSE-28).

### BA — rules and data

- Minimum icon set: clear, partly cloudy, cloudy, rain, heavy rain, thunderstorm, snow, fog, wind (AC1).
- Day and night variants only where the provider distinguishes them; where it does not, one variant is used for both and the mapping must not invent a night state (AC2).
- Every icon carries a text label or `aria-label` — colour and shape never carry the meaning alone (AC4), consistent with the global colour rule.
- The provider's condition codes map to the Poolse icon set through one explicit mapping table; an unmapped or unknown code renders a defined fallback icon plus its raw label rather than a blank space.
- Icons must remain legible on light and dark backgrounds (AC3) — a set that only works on white is not acceptable.
- Licence: the chosen set must be licensed for commercial use and the licence recorded in the repo (AC5). This is a ship blocker, not a follow-up.
- Labels are i18n keys in pt-PT and en — "Trovoada" / "Thunderstorm" — never the provider's English strings passed through.
- Edge case: the provider returns a condition with no temperature, or is unreachable. The block must degrade to a stated "sem dados" state rather than to a sun icon.

### Dev — implementation notes

- No schema change. This is a presentation mapping plus assets.
- Ship the icons as inline SVG components with `currentColor` where the design allows, and explicit fills where the set is deliberately multicoloured; avoid a sprite fetched at runtime.
- Keep the provider-code → icon mapping in one module with a total mapping and an explicit default, so a new provider code degrades predictably instead of throwing.
- The icon component takes a condition code and renders icon plus accessible label together; there is no way to render the icon without its label, which is how AC4 is enforced structurally rather than by review.
- Theming: multicoloured icons need a checked contrast pass against both surface tokens; where a colour disappears on one background, add a stroke or adjust the token rather than swapping icon sets per theme.
- i18n: condition names live in the message catalogues; the mapping module returns keys, not strings.
- Performance: the set is small and static — inline it, and do not pull a full icon library for nine conditions.
- Most likely to get wrong: shipping a set whose licence forbids commercial use, or one whose yellows and light greys vanish on the dark surface. Record the licence in the repo at the same commit as the assets.

### QA — test scenarios

12.1 Given an installation whose current condition is "rain" / When the details page loads / Then the rain icon renders in colour with its text label.
12.2 Given each of the nine required conditions in turn / When rendered / Then each has a visually distinct icon — no two conditions share one.
12.3 Given a night-time timestamp and a provider that distinguishes day/night / When the block renders / Then the night variant is used; given a provider that does not, the single variant renders without error.
12.4 Given dark mode / When every icon in the set is rendered / Then each is legible against the dark surface and passes contrast; repeat in light mode.
12.5 Given a screen reader / When focus reaches the weather block / Then the condition is announced as text, not as an image name.
12.6 Given locale pt-PT / When the condition is thunderstorm / Then the label reads "Trovoada"; in en it reads "Thunderstorm".
12.7 Given the provider returns a condition code not present in the mapping / When the block renders / Then the fallback icon and the raw condition text are shown, and nothing throws.
12.8 Given the weather provider is unreachable / When the page loads / Then the block shows a no-data state and the rest of the installation page renders normally.
12.9 Given the page is rendered in greyscale (simulating colour blindness) / When conditions are compared / Then each is still identifiable from its shape and label.
12.10 Given the repo / When the icon assets are reviewed / Then a licence file or note covering commercial use accompanies them.

### Acceptance criteria

1. Distinct coloured icons for at least: clear, partly cloudy, cloudy, rain, heavy rain, thunderstorm, snow, fog, wind.
2. Day and night variants where the provider distinguishes them.
3. Icons remain legible on both light and dark backgrounds.
4. Each icon carries a text label/`aria-label` — colour alone never carries the meaning.
5. Icon set is licensed for commercial use; note the licence in the repo.

---

## POOLSE-13 · Attendance states: colour scheme, drop the static "Atrasado"

**Type:** Improvement · **Area:** Students / Presenças · **Priority:** Medium

### PO — why this exists

Attendance has three real states and a fourth, "Atrasado", that nobody uses meaningfully — a student who arrives late still swam. Keeping it forces instructors to make a judgement call poolside and pollutes every report with a state that answers no question. This ticket removes late arrival as a concept and gives the three surviving states a colour scheme that is scannable at a glance in a grid. Medium priority: it is a data-model change with a migration, and POOLSE-21's reposição credits are built on *falta justificada*, so the state set needs to be final before that lands.

**Not in scope:** minting credits from a justified absence (POOLSE-21), and any change to how attendance is taken or who may take it.

### BA — rules and data

- Surviving states: **Presente**, **Faltou**, **Falta justificada**. Colours: Presente keeps its current colour, Faltou soft red, Falta justificada soft orange.
- "Atrasado" is removed as a concept, not as a label (AC6). Late arrival is not recorded anywhere after this ships, and a late student is simply *Presente*.
- Migration: every existing record stored as Atrasado becomes *Presente*, and the enum value is dropped so it can never be set again (AC7). Dropping the value is what makes the removal permanent — a retained-but-hidden value drifts back.
- Every filter, report column, chart series and export field referencing the late state is removed (AC8), including saved filters and any dashboard tile.
- Colour is always paired with a text label or icon; the state must be readable without colour (AC3) — this is the same rule as everywhere else in the product.
- A legend appears wherever multiple states are shown together, i.e. list and grid views (AC4); a single-state chip on a detail row does not need one.
- Colours are design tokens, defined once and reused in attendance summaries and reports (AC5) — not re-declared per component.
- Palette conflict to respect: POOLSE-18's role badges must stay clear of these red/orange values, and POOLSE-20's four skill states must be distinct from both. The attendance tokens are the senior claim on red and orange.
- **Open:** whether historic exports and previously generated reports that already contain the string "Atrasado" are reissued or left as they are; the ticket only covers live filters, columns and fields.
- Edge case: a record migrated from Atrasado to Presente is indistinguishable afterwards from one entered as Presente. If audit needs to know it was migrated, that fact must live in the audit/migration report, not in the attendance state.

### Dev — implementation notes

- Migration in two steps in one release: `UPDATE` all Atrasado rows to Presente, then drop the enum value (Postgres requires recreating the type or a check-constraint swap — plan for the table lock and the ordering, and make the update idempotent so a re-run is safe).
- Write the migration report: how many rows changed, per tenant. Multi-tenant means "no Atrasado rows exist" is a per-tenant claim, not a global one — scope the update and the count by tenant key.
- Search the whole codebase for the late state before dropping it: enum references, filter option lists, report column definitions, chart series keys, export column headers, seed data and fixtures. A dropped enum value with a live reference is a runtime error, not a type error, if any of these are string-typed.
- Define three colour tokens (surface, foreground, border per state) in the theme layer with light and dark values, and consume them from a single `AttendanceStateBadge` component. No component may reach for a raw colour.
- The badge renders colour + label (and optionally an icon) as one unit, so there is no way to render the colour without the text — this is how AC3 is enforced structurally.
- i18n: Presente / Faltou / Falta justificada as keys in pt-PT and en, reused by the legend, the filters and the exports.
- Performance: attendance grids render many badges at once — keep the badge cheap and pure, and do not compute token lookups per cell.
- Most likely to get wrong: treating this as a colour change and leaving the enum value in place "just in case". AC7 is explicit — if the value survives, some legacy code path will keep writing it and POOLSE-21's credit rule will inherit an undefined state.

### QA — test scenarios

13.1 Given an attendance grid with all three states present / When it renders / Then each state shows its specified colour together with its text label.
13.2 Given the app after migration / When any attendance UI is opened / Then no "Atrasado"/"Late" label, option or column appears anywhere.
13.3 Given a tenant with pre-existing Atrasado records / When the migration runs / Then every one of them reads *Presente* afterwards and the migration report states the count for that tenant.
13.4 Given the migration has already run / When it is run a second time / Then it completes without error and changes nothing.
13.5 Given a crafted API request setting attendance to the old late value / When it is submitted / Then it is rejected — the value no longer exists in the enum.
13.6 Given a list view with mixed states / When it renders / Then a legend is present; given a detail view with one state, no legend is required.
13.7 Given dark mode / When the three states render / Then soft red and soft orange pass contrast and remain distinguishable from each other; repeat in light mode.
13.8 Given a greyscale or colour-blind simulation / When the grid renders / Then the three states are still tellable apart by label or icon.
13.9 Given locale pt-PT then en / When the legend and filters render / Then "Falta justificada" / "Excused absence" appear correctly with no untranslated keys.
13.10 Given an attendance export / When it is generated / Then no column or value references the late state, and the three states export with their i18n labels.
13.11 Given a saved filter or dashboard tile created before this change that filtered on Atrasado / When it is opened after the migration / Then it degrades to a valid state rather than erroring or returning nothing silently.
13.12 Given an attendance summary or report component / When inspected / Then it consumes the shared state tokens rather than declaring its own colours (AC5).
13.13 Given a student marked *Falta justificada* / When POOLSE-21 is later enabled / Then that state is the one the credit rule reads — no orphaned late state in the path.

### Acceptance criteria

1. The static "Atrasado"/"Late" label is removed from the attendance UI.
2. The three states render with the colours above, in both light and dark mode, contrast-checked.
3. Colour is paired with a text label or icon — the state must be readable without relying on colour (colour-blind users).
4. A legend is shown where multiple states appear together (list/grid view).
5. Colours are defined as design tokens, reused in any attendance summary/report, not re-declared per component.

6. "Atrasado" disappears as a **concept**, not just as a label — late arrival is no longer recorded anywhere. A student who arrives late is simply *Presente*.
7. Any existing records currently stored as "Atrasado" are migrated to *Presente*; the enum value is dropped so it cannot be set again.
8. Remove any filter, report column, chart series or export field that referenced the late state.

---

## POOLSE-14 · Remove classes from the Calendar

**Type:** Feature · **Area:** Calendar · **Priority:** High

### PO — why this exists

An instructor is ill, a lane is out of service, a turma stops running in March — today there is no way to take a class off the calendar, so staff work around it by cancelling verbally and the calendar stops matching reality. Removing a class needs a scope choice, because "today only" and "from now on" are different intentions and guessing wrong destroys or preserves the wrong thing. High priority: it is the calendar's most obviously missing verb.

**Not in scope:** notifying students or encarregados de educação (recommended as no notification in v1 — see the open point), moving or rescheduling a class rather than removing it, and closure-driven cancellation, which is POOLSE-31 and behaves differently.

### BA — rules and data

- A class occurrence in the calendar exposes a Remove action from the context menu and/or the detail panel (AC1).
- Scope choice is mandatory and explicit: **this occurrence only**, or **this and all future occurrences** (AC2). There is no "all occurrences including past" option.
- Removal is a soft delete: attendance and history for past occurrences are never destroyed (AC3), and past occurrences are untouched by a "this and all future" removal (AC4).
- Removed occurrences disappear from the calendar and from class counts for the affected dates (AC6) — counts must recompute, not just hide the block.
- **Open (from the source doc):** may an Instructor remove a class, or Owner/Admin only? The assumption on record is Owner, Admin and the Instructor **assigned to that class**; this must be confirmed before build, because it changes the shape of the permission check from a role test to a role-plus-assignment test.
- Permissions resolve against the union of the actor's roles (POOLSE-17); an Instructor who is also an Admin removes as an Admin.
- Every removal is audit-logged (AC8) with actor, scope chosen, class, occurrence date and timestamp — the scope is the part that matters later.
- Edge case: two users remove overlapping scopes concurrently (one removes today, the other removes today-and-future). The result must be deterministic and must not resurrect an occurrence.
- Edge case: an occurrence with recorded attendance is removed. It vanishes from the calendar but its attendance survives per AC3 — so an attendance report may legitimately contain a date the calendar no longer shows, and reports must not treat that as corruption.
- Conflict to note: POOLSE-31 also removes classes from the calendar, but with different semantics (no charge, no reposição credit) and must remain distinguishable in history from removals made here (POOLSE-31 AC9).

### Dev — implementation notes

- Schema: recurring classes need per-occurrence records or an exception table. If occurrences are currently generated on the fly from a recurrence rule, this ticket forces the decision — materialise occurrences, or store removal exceptions plus a series end date. Pick one and apply it consistently; a hybrid is where the bugs live.
- "This and all future" is best expressed as setting the series' effective end immediately before the chosen date, plus an exception for that date if needed — not as a bulk delete of generated rows, which cannot be reasoned about later.
- Soft delete columns: `removed_at`, `removed_by`, `removal_scope`, `removal_kind` (manual removal vs closure cancellation, so POOLSE-31 stays distinguishable). Tenant key on every row, every query scoped.
- API surface: one endpoint taking class id, occurrence date and scope; the server, not the client, expands the scope. A client that sends a list of dates to delete is the wrong design.
- Permission enforcement server-side in a shared `canRemoveClassOccurrence(actor, class)` helper that covers both the role test and, if confirmed, the assigned-instructor test. The UI hides the action using the same helper's result, never its own copy of the rule.
- Class counts, occupancy figures and any calendar aggregate must exclude removed occurrences at query level, not by post-filtering in the client.
- i18n: the scope dialog's two options, the confirmation copy and the audit-visible strings in pt-PT and en. The scope wording must be unambiguous in both languages — "esta e todas as futuras" beats anything shorter.
- Concurrency: apply removals under a transaction with the series row locked, so overlapping scopes serialise rather than interleave.
- Most likely to get wrong: letting "this and all future" reach backwards through generated occurrences and take attendance history with it. AC3 and AC4 both exist because that is the natural failure of a naive recurrence delete.

### QA — test scenarios

14.1 Given a weekly turma with occurrences in the past and future / When an Admin removes a single future occurrence / Then only that date disappears and every other occurrence remains.
14.2 Given the same turma / When an Admin removes "this and all future" from a mid-series date / Then that date and all later ones disappear and every earlier occurrence, including its attendance, is untouched.
14.3 Given a past occurrence with recorded attendance / When "this and all future" is applied from a later date / Then the past attendance record is still readable in reports.
14.4 Given a Student user / When they call the removal endpoint directly for any occurrence / Then 403 is returned and nothing is removed.
14.5 Given an Instructor not assigned to the class / When they attempt removal via the API / Then the result matches the confirmed permission decision — and the test is updated once the open point is closed.
14.6 Given an Instructor assigned to the class / When they remove an occurrence / Then the audit log records them as the actor with the scope chosen.
14.7 Given an occurrence is removed / When the calendar and any class-count figure for that date are read / Then the count excludes it, rather than showing the class as still scheduled.
14.8 Given two Admins acting at once / When one removes a single occurrence and the other removes "this and all future" covering it / Then the final state is consistently removed and no occurrence reappears.
14.9 Given a removed occurrence / When history is inspected / Then it is distinguishable from an occurrence cancelled by a closure (POOLSE-31) and from a *falta*.
14.10 Given locale pt-PT then en / When the scope dialog opens / Then both options and the confirmation read correctly and unambiguously in the active language.
14.11 Given dark mode then light mode / When the removal dialog and the calendar's post-removal state render / Then both are legible and the removed slot is not signalled by colour alone.
14.12 Given a class whose entire remaining series is removed / When the turma is opened / Then it shows no future occurrences without erroring, and its enrolments are not silently deleted.
14.13 Given a removal request with a scope value not in the allowed set / When submitted / Then the API rejects it rather than defaulting to the wider scope.

**Open point:** should removing a class notify enrolled students / encarregados de educação (in-app or email)? Recommend: no notification in v1, add later with the parent-communication module.

### Acceptance criteria

1. A class in the calendar exposes a "Remove" action (context menu and/or detail panel).
2. Dialog offers: **this occurrence only** or **this and all future occurrences**.
3. Removal is a soft delete — attendance and history for past occurrences are never destroyed.
4. Past occurrences are not affected by a "this and all future" removal.
5. Enrolled students/EE are handled per the notification rules (see below).
6. Removed occurrences disappear from the calendar and from class counts for the affected dates.
7. Permission: which roles may remove — **assumed Owner, Admin and the Instructor assigned to that class**. Confirm if Instructor should be excluded.
8. Action is audit-logged.

---

## POOLSE-15 · Turma hover card with full student list

**Type:** Improvement · **Area:** Classes (Turmas) · **Priority:** Medium
**Depends on:** POOLSE-08 (names in the card, collapsed after 8)

### PO — why this exists

The compact turma card can only show so much before it stops being compact, so POOLSE-08 collapses the roster after eight names. Staff planning a week need the rest without leaving the view they are in — hovering a turma should show the whole thing. Medium priority: it makes an existing screen materially faster to work with, and it is where the truncated content from POOLSE-08 goes to live.

**Not in scope:** editing anything from the hover card, a mobile hover equivalent (touch opens the detail instead), and the compact card's own layout, which POOLSE-08 owns.

### BA — rules and data

- Hovering a turma card or a calendar block opens a floating panel after roughly 300 ms, with no flicker when the cursor merely passes over (AC1).
- Panel contents: turma name, level, instructor, day/time, pool/lane, occupancy (e.g. 9/12), and the complete bulleted student list with no truncation (AC2).
- The student list reflects enrolments for the currently selected season (inherited from POOLSE-08 AC5) and is ordered alphabetically — display follows POOLSE-32, first name plus last surname in this list context.
- The panel scrolls internally when the list exceeds its maximum height; it never grows past the viewport and is never clipped by a parent container (AC3) — this rules out rendering it inside an `overflow: hidden` ancestor.
- It flips side or above near a viewport edge (AC4), dismisses on mouse-out or `Esc`, and stays open while the cursor is inside it so names can be read and selected (AC5).
- Keyboard focus on the turma opens the same panel (AC6) — accessibility parity, not a lesser variant.
- Touch devices have no hover: a tap opens the turma detail and the panel is not used at all (AC7).
- Content is fetched once and cached per turma (AC8); moving the cursor must not fire a request per pixel.
- Access rule: the panel shows the same data the user is permitted to see. A role that may not see the roster does not get one through a hover — the endpoint enforces it.
- Edge case: a turma with a guest attending as a reposição (POOLSE-21) is counted for attendance but excluded from the enrolled list, so the panel's list and its occupancy figure can legitimately disagree by the number of guests. **Open:** whether the panel should show guests separately once POOLSE-21 lands — not decided.
- Edge case: an empty turma. The panel still opens and shows the POOLSE-08 empty state rather than an empty box.

### Dev — implementation notes

- Build on the shadcn/ui hover-card primitive rather than a bespoke floating element — it brings the open delay, dismissal and focus parity, and a positioning engine that already handles edge flipping.
- Render the panel in a portal at the document root so no ancestor's overflow can clip it (AC3).
- One API call per turma returning the panel payload; cache by turma id with a sensible stale time so repeated hovers in a session are free. The open delay must also debounce the fetch — start the request when the delay elapses, not on mouse-enter.
- Reuse the roster query the card already uses where possible, so the panel and the card cannot disagree about who is enrolled; the panel simply asks for the untruncated list.
- Permission check is server-side on that endpoint; the panel is not a back door to a roster the user cannot open normally.
- Touch detection by pointer capability, not by viewport width — a small window on a laptop still hovers, a large tablet does not (AC7).
- i18n: field labels, the occupancy format and the empty state in pt-PT and en; occupancy renders through the locale's number formatting.
- Theming: the panel needs its own elevated surface token with a border that reads against both light and dark backgrounds — a shadow alone disappears in dark mode.
- Most likely to get wrong: a fetch on every mouse-move or every re-render, which is invisible locally and obvious on a calendar with forty turmas. AC8 is the guard; test it by counting requests, not by feel.

### QA — test scenarios

15.1 Given a turma card with 20 enrolled students / When the cursor rests on it for ~300 ms / Then the panel opens showing all 20 names plus name, level, instructor, day/time, pool/lane and occupancy.
15.2 Given the cursor passes quickly across three turma cards / When it does not rest on any / Then no panel opens and no request is fired.
15.3 Given a panel is open / When the cursor moves into the panel / Then it stays open and the names can be selected with the mouse.
15.4 Given a panel is open / When `Esc` is pressed or the cursor leaves both card and panel / Then it dismisses.
15.5 Given a turma at the right edge of the viewport / When its panel opens / Then it flips to the other side and is fully visible; repeat near the bottom edge.
15.6 Given a turma inside a scrollable container with hidden overflow / When the panel opens / Then it is not clipped by the container.
15.7 Given a turma with 60 students / When the panel opens / Then the list scrolls inside the panel and the panel does not exceed the viewport height.
15.8 Given keyboard navigation / When the turma receives focus / Then the same panel opens and its contents are reachable by screen reader.
15.9 Given a touch device / When a turma is tapped / Then the turma detail opens and no hover panel appears.
15.10 Given the same turma is hovered five times in a session / When network requests are counted / Then only one panel fetch occurred.
15.11 Given an Instructor with no access to another instructor's turma roster / When they trigger the panel via the API endpoint directly / Then 403 and no roster data is returned.
15.12 Given locale pt-PT then en / When the panel opens / Then labels, occupancy and the empty state render in the active language.
15.13 Given dark mode then light mode / When the panel opens over a busy calendar / Then its surface and border are clearly separated from the content behind it.
15.14 Given a turma with no enrolments / When the panel opens / Then it shows "Sem alunos inscritos" / "No students enrolled" rather than an empty area.

### Acceptance criteria

1. Hovering a turma (card or calendar block) opens a floating panel after a short delay (~300 ms) — no flicker on cursor pass-through.
2. Panel shows: turma name, level, instructor, day/time, pool/lane, occupancy (e.g. 9/12), and the **full** bulleted student list with no truncation.
3. Panel is scrollable if the list exceeds its max height; it never grows past the viewport or gets clipped by the container.
4. It flips side/above automatically near a viewport edge.
5. Dismisses on mouse-out or `Esc`; stays open while the cursor is inside it, so names can be read and selected.
6. Keyboard-focusing the turma opens the same panel (accessibility parity with hover).
7. On touch devices there is no hover — tap opens the turma detail instead; the panel is not used.
8. Content is fetched once and cached per turma; hovering does not fire a request per pixel of movement.

---

## POOLSE-16 · Raise level maximum age to 100 + senior demo data

**Type:** Bug / Data · **Area:** Levels · **Priority:** High

### PO — why this exists

Poolse runs hidroginástica and adult classes, and the level maximum age is capped at 30 — so every student over 30 is silently ineligible for every level, with no error explaining why. That is a correctness bug wearing the clothes of a settings limit, and it blocks the adult and senior programme entirely. High priority, and cheap: a ceiling change plus seed data that keeps the range exercised.

**Not in scope:** month granularity at the bottom of the range (POOLSE-06), the adult enrolment flow (POOLSE-23), and pricing for concessions.

### BA — rules and data

- The maximum-age ceiling rises from 30 to 100 in the UI picker, the API validation and any database constraint (AC1) — all three, or the bug survives in whichever layer is missed.
- No existing level data is altered by the change (AC2): raising a ceiling must not touch stored values.
- Eligibility checks accept students up to 100 (AC3), so the comparison used when enrolling a student into a level or turma must be re-tested at the new boundary.
- Excel import accepts maximum ages above 30 without a validation error (AC5) — the import has its own validation copy and it is the layer most likely to be forgotten.
- Seed/demo data gains at least one senior level (e.g. *Hidroginástica Sénior*, 60–100) and a handful of students aged 60–85 (AC4), so the range is covered by tests and visible in the demo tenant.
- Existing rule from POOLSE-06 AC7 applies: maximum age must be greater than minimum age, and both accept the full 1 month … 100 years range.
- **Direct conflict with POOLSE-06:** POOLSE-06 AC6 specifies the same 30 → 100 ceiling change *and* changes the field's storage to months. If these ship separately, one migration will contradict the other's assumptions about the stored unit. They must ship together, or POOLSE-16 must ship first with the explicit note that its ceiling is expressed in whatever unit POOLSE-06 later migrates to.
- Edge case: a student aged exactly 100, and a level with max exactly 100 — inclusive or exclusive must be decided and applied identically in the UI, the API, the DB constraint and the import. **Open:** the backlog does not state inclusivity; decide once and document it.
- Age brackets in POOLSE-33 define Sénior as 60+ and must share the boundary definitions with this logic (POOLSE-33 AC7) so they cannot drift.

### Dev — implementation notes

- Migration touches constraints only: widen or drop-and-recreate the check constraint on the level's maximum age. No data rows change (AC2) — assert that with a count before and after.
- Find every copy of the number 30: the picker's option list, the API DTO validation, the DB constraint, the Excel import validator, any seed fixture and any test that asserts the old ceiling. A grep for the literal is the honest first step.
- Put the age bounds in one shared constant module consumed by the picker, the validators and the eligibility helper, so the next ceiling change is one line — the same discipline POOLSE-33 AC7 asks for on bracket boundaries.
- Eligibility is a shared helper, not per-page logic; it is called from enrolment, from the transfer proposals in POOLSE-19 and from import.
- Coordinate with POOLSE-06: if that lands first the comparison unit is months, and 100 years is 1200 months. Writing 100 into a months-typed field is the single most likely defect here.
- Permission: editing a level remains Owner/Admin as today; this ticket does not widen who may set ages, and the endpoint check stays server-side.
- i18n: age labels follow POOLSE-06's singular/plural rules in pt-PT and en; "100 anos" and "100 years" must both render from the same key.
- Seed data is production-shaped, not throwaway: the senior level and the 60–85 students must be realistic enough that the demo tenant shows the feature working.
- Most likely to get wrong: fixing the picker and the API, and leaving the Excel import validator or the DB check constraint at 30 — the failure then only appears on an import or on a write that bypasses the API path.

### QA — test scenarios

16.1 Given an Owner editing a level / When they set the maximum age to 100 / Then it saves and is shown as 100 on reload.
16.2 Given the picker / When it is opened / Then values above 30 up to 100 are offered, with no gap at the old ceiling.
16.3 Given a level with max 100 / When a student aged 85 is enrolled / Then eligibility passes and the enrolment succeeds.
16.4 Given a student aged exactly 100 and a level with maximum 100 / When eligibility is checked / Then the result matches the documented inclusivity decision, identically in the UI, the API and the import.
16.5 Given a maximum age of 101 submitted directly to the API / When validated / Then it is rejected — the ceiling still exists, it has only moved.
16.6 Given a maximum age lower than the level's minimum / When saved / Then it is rejected with a clear message (POOLSE-06 AC7).
16.7 Given an Excel file with a level whose maximum age is 100 / When imported / Then it imports with no validation error.
16.8 Given existing levels before the change / When the migration runs / Then not one stored age value differs afterwards.
16.9 Given an Instructor / When they call the level-update endpoint with a new maximum age / Then 403 — the permission surface is unchanged by this ticket.
16.10 Given the demo tenant after seeding / When levels are listed / Then *Hidroginástica Sénior* (60–100) exists and students aged 60–85 are present and eligible for it.
16.11 Given locale pt-PT then en / When an age of 100 and an age of 1 are displayed / Then singular and plural render correctly in both languages.
16.12 Given light and dark mode / When the age picker is opened at its full range / Then the long option list is legible and scrollable in both.
16.13 Given POOLSE-06 has landed and ages are stored in months / When a level's maximum is set to 100 years / Then it is stored as 1200 months and eligibility for an 85-year-old still passes.

**See also:** POOLSE-06 — same field, month granularity at the bottom of the range.

### Acceptance criteria

1. Maximum age ceiling raised from 30 to **100**, in the UI picker, the API validation and any DB constraint.
2. No existing level data is altered by the change.
3. Eligibility checks accept students up to 100.
4. Seed/demo data gains at least one senior level (e.g. *Hidroginástica Sénior*, 60–100) and a handful of students aged 60–85, so the range is covered by tests and visible in the demo tenant.
5. Excel import accepts maximum ages above 30 without a validation error.

---

## POOLSE-17 · One Person, many roles

**Type:** Architecture / Feature · **Area:** People / Data model · **Priority:** High — blocks POOLSE-04

### PO — why this exists

A senior student can also be the encarregado de educação of a grandchild, and today that is two unrelated records for one human: two phone numbers to keep in sync, two ID documents, two addresses that drift apart the moment one is edited. Modelling a single Person with roles attached fixes the duplication at its root and is the precondition for the guardian block (POOLSE-04), the adult path (POOLSE-23), the Pessoas/Alunos split (POOLSE-35) and the multi-badge display (POOLSE-18). It is High and it blocks: every week it waits, more code is written against the wrong shape.

**Not in scope:** deciding whether adult students get app logins in v1 (left open below), the invitation matrix itself (POOLSE-01), and the navigation split between Pessoas and Alunos (POOLSE-35).

### BA — rules and data

- A Person holds identity and contact data exactly once: name parts, date of birth, phone, email, NIF, address, photo, ID document. No role-specific copy of any of these exists.
- Roles — Owner, Admin, Instructor, Student, Encarregado de Educação, Maintenance — are assignments on the Person, and one Person may hold several at once. Removing one role removes neither the Person nor their other roles.
- Guardianship is a relation between two Persons carrying the relationship type (mãe, pai, avó, tutor legal, outro) and a primary-contact flag; per POOLSE-04 AC4 the relationship lives on the link, because the same person can be a grandmother to one student and a legal guardian to another. Per POOLSE-35 AC5 the relation is one guardian to many students.
- Permissions resolve to the **union** of the Person's roles (AC5). The same criterion then says the invite matrix (POOLSE-01) uses the **strongest role held** — for invitation rights these give the same answer, since the matrix is a strict hierarchy, but the two phrasings must be reconciled in one written rule rather than implemented twice. **Open:** confirm that "strongest" is defined by the seniority order Owner → Admin → Instructor → Maintenance → EE → Student, the same order POOLSE-18 AC3 uses for badges.
- The deduplication key is **NIF, else email** (AC8). Creating or importing a Person whose NIF or email already exists warns and offers to add the role to the existing Person instead of creating a second record (AC9).
- A Person with neither NIF nor email cannot be deduplicated automatically. **Open:** whether such a record may be created at all, or whether one of the two is mandatory — the backlog does not say, and a silent "create anyway" quietly reintroduces duplicates.
- The migration merges existing duplicate student/guardian pairs matched by NIF or email, and produces a report of what was merged (AC10). Merging is a one-way operation on live tenant data and must be reviewable before and after.
- The People list shows every Person once with all their role badges — never the same human twice (AC4); a Person's Student view and Encarregado view are sections of one profile, not separate pages (AC6).
- Edge case: two existing records share an email but have different NIFs. They are **not** the same person — NIF wins over email whenever both are present and disagree.
- Edge case: two existing records share a NIF but differ in every other field. They are the same person by the stated key; the merge must decide field by field which value survives rather than picking a record wholesale.
- **Open:** does a senior student who is also an EE need one login or none — i.e. do adult students get app accounts in v1, or only guardians? Recorded as open in the source doc and not decided here.

### Dev — implementation notes

- Schema: `person` (tenant key, name parts, date of birth, phone, email, NIF, address, photo ref, ID document ref), `person_role` (person, role, granted_at, granted_by — unique on person + role), `guardianship` (guardian person, student person, relationship type, is_primary_contact, unique on the pair). Tenant key on every table, every query scoped, no exceptions.
- Enforce the dedup key in the database, not only in application code: a partial unique index on (tenant, NIF) where NIF is not null, and on (tenant, lower(email)) where email is not null. Application-level checks lose the race; the index does not.
- **The merge migration is the risky part and deserves its own phased build.** Phase 1: a read-only pass that groups candidate duplicates by NIF, then by email among the NIF-less, and writes the report — actor-visible, per tenant, listing every pair it intends to merge and every field where the two records disagree. Phase 2: the merge itself, executed only after the report is reviewed. Phase 3: the constraint that prevents new duplicates.
- Merge mechanics: choose a surviving person id (oldest created, deterministic), repoint every foreign key — enrolments, attendance, guardianship edges on both sides, documents, invitations, audit rows — then soft-delete the absorbed record with a `merged_into` pointer rather than deleting it. Keeping the pointer is what makes an incorrect merge recoverable and keeps old audit references resolvable.
- Field-level merge rules must be explicit and written down: non-null wins over null; on a genuine conflict, the record with the more recent update wins and the discarded value goes into the report. Do not silently drop a phone number or an address — every discarded value is reported.
- Merging must be idempotent and re-runnable per tenant, and must run inside a transaction per merge group so a failure on one pair does not leave a half-repointed graph. Run it against a restored copy of production data before it runs on production.
- Permission resolution is one server-side function returning the union of the Person's role grants, plus a `strongestRole()` derived from the single seniority order, used by the invite matrix. Every authorisation check in the codebase goes through it — the old "user has role X" single-role assumption must be hunted down and removed, because it will silently deny an Instructor who is also a parent, or grant on the wrong role.
- API surface: person CRUD, role grant/revoke, guardianship create/remove, a dedup-check endpoint called by both the create form and the Excel import, and a merge endpoint for the manual "add the role to the existing Person instead" path (AC9).
- Import: the Excel importer calls the same dedup helper as the UI — one implementation, or the two will diverge and the importer will be the one creating duplicates.
- i18n: role names, relationship types, the duplicate warning and the merge report copy in pt-PT and en. Theming: role badges follow POOLSE-18's tokens; the profile's role sections must read in both modes.
- Performance: the People list joins roles per Person — aggregate the badges in one query rather than N+1 per row, and index `person_role` on person. The list is paginated at 15 (POOLSE-29), so the badge aggregation must respect the page, not the whole set.
- Most likely to get wrong: leaving a single-role assumption behind somewhere in the authorisation path — a `person.role` accessor, a JWT claim carrying one role, a UI guard reading the first badge. The union is only true if nothing anywhere still asks for "the" role.

### QA — test scenarios

17.1 Given a Person holding Student and Encarregado de Educação / When the People list is opened / Then they appear exactly once, with both role badges.
17.2 Given that Person / When their profile is opened / Then their student enrolments and their guardianship appear as sections of one profile, not as two pages.
17.3 Given a Person holding Instructor and Student / When they attempt an action permitted to Instructors / Then it succeeds — the union grants it, the Student role does not block it.
17.4 Given a Person holding Admin and Student / When they open the invite dialog / Then the role list is the Admin list per POOLSE-01, and an attempt to invite an Owner returns 403 from the API.
17.5 Given a Person with Instructor and Student / When the Instructor role is revoked / Then the Person, their Student role and all their data survive.
17.6 Given an existing Person with NIF 123456789 / When a new Person with the same NIF is created in the UI / Then a duplicate warning appears offering to add the role to the existing Person, and no second record is created.
17.7 Given the same NIF submitted twice concurrently via the API / When both requests are processed / Then the unique index rejects the second — the check does not depend on timing.
17.8 Given an Excel import containing a guardian who already exists as a student / When it is imported / Then the existing Person gains the EE role and no duplicate is created (AC8).
17.9 Given two records sharing an email but with different NIFs / When the dedup check runs / Then they are treated as different people and neither is merged.
17.10 Given two records sharing a NIF with different phone numbers / When the merge migration runs / Then one Person survives, the discarded phone number appears in the merge report, and no contact data vanishes unreported.
17.11 Given a tenant with duplicate student/guardian pairs / When the migration runs / Then every enrolment, attendance row, guardianship edge and document from both records points at the surviving Person, and the absorbed record carries a `merged_into` pointer.
17.12 Given the migration has run / When it is run again on the same tenant / Then nothing further is merged and no error occurs.
17.13 Given tenant A and tenant B each containing a Person with the same NIF / When the migration runs / Then nothing is merged across tenants and tenant isolation holds.
17.14 Given a guardian responsible for three students / When their profile is opened / Then all three are listed, and each student's record links back to the one guardian Person.
17.15 Given locale pt-PT then en / When role badges, relationship types and the duplicate warning render / Then all are translated with no key leakage.
17.16 Given light and dark mode / When a Person with four role badges is displayed / Then every badge is legible, contrast-checked, and carries its role name as text.
17.17 Given a Person record with neither NIF nor email / When creation is attempted / Then the behaviour matches the documented decision on the open question rather than silently creating an undedupable record.

**Knock-on effects to check:** POOLSE-04 (guardian block), POOLSE-11 (one ID document per Person, not per role), POOLSE-01 (invite matrix reads the union of roles), POOLSE-18 (a Person can show several role badges).

### Acceptance criteria

1. A Person holds identity and contact data once: name, date of birth, phone, email, NIF, address, photo, ID document.
2. Roles (Owner, Admin, Instructor, Student, Encarregado de Educação, Maintenance) are **assignments on the Person**, not separate record types. One Person may hold several simultaneously.
3. Guardianship is a relation between two Persons, carrying the relationship type and a primary-contact flag (see POOLSE-04).
4. The People list shows every Person once, with all their role badges — never the same human twice.
5. Permissions resolve to the **union** of the Person's roles; the invite matrix (POOLSE-01) uses the strongest role held.
6. A person's Student view and their Encarregado view are tabs/sections of one profile, not separate pages.
7. Removing one role does not delete the Person or their other roles.
8. Excel import matches on a stable key (NIF, else email) so importing a guardian who is already a student does not create a duplicate.
9. Deduplication check: importing or creating a Person whose NIF/email already exists warns and offers to add the role to the existing Person instead.
10. Migration merges any existing duplicate student/guardian pairs, matched by NIF or email, with a report of what was merged.

---

## POOLSE-18 · Role colour scheme in the People section

**Type:** Improvement · **Area:** People · **Priority:** Low
**Depends on:** POOLSE-17 (a Person can hold several roles), POOLSE-35 (Pessoas is staff-only)

> **Amended 27 Aug** — Pessoas is now staff-only (POOLSE-35). Staff badges appear there; Student and
> Encarregado de Educação badges appear in the Alunos section. Same token set, two places.

### PO — why this exists

Once one Person can hold several roles, a list of names tells you nothing about who is what. A distinct colour per role badge makes Pessoas and Alunos scannable — you find the instructors without reading. Low priority because it is presentation on top of POOLSE-17's real work, but doing it as tokens now stops six components inventing six greens later.

**Not in scope:** which people appear in Pessoas versus Alunos (POOLSE-35), and any change to what the roles mean or who may grant them.

### BA — rules and data

- Six distinct colour tokens, one per role: Owner, Admin, Instructor, Student, Encarregado de Educação, Maintenance (AC1).
- Colour applies to the role badge or chip only. Rows, avatars and text stay neutral (AC2) — a coloured row would collide with selection and hover states.
- A Person holding several roles shows several badges, ordered by seniority: Owner → Admin → Instructor → Maintenance → EE → Student (AC3). This is the same ordering POOLSE-17's "strongest role held" should use.
- Badges always carry the role name as text; colour never carries the meaning alone (AC4).
- Contrast-checked in light and dark mode, and the palette stays clear of the attendance colours in POOLSE-13 so red and orange never read as an attendance state (AC5). It should also stay clear of POOLSE-20's four skill-state colours for the same reason.
- Tokens are reused everywhere a role is displayed — filters, detail header, invite dialog — never redefined per component (AC6).
- Per the amendment: staff badges (Owner, Admin, Instructor, Maintenance) render in Pessoas; Student and Encarregado de Educação badges render in Alunos. One token set, two locations.
- Edge case: a Person holding both a staff role and a student role appears in both sections (POOLSE-35 AC4). **Open:** whether each section shows only the badges relevant to it, or all of the Person's badges. The amendment says where each badge appears, which reads as scoped-to-section, but the detail header is one profile — decide once so the list and the profile do not disagree.
- Edge case: a Person with four or more roles in a narrow list column — the badge row must wrap or overflow predictably rather than pushing the name out of view.

### Dev — implementation notes

- No schema change. Six semantic colour tokens per role, each with surface, foreground and border values defined for light and dark, alongside the attendance tokens from POOLSE-13 so the clash is visible at definition time rather than in review.
- One `RoleBadge` component takes a role and renders token plus translated name together; there is no prop that renders the colour without the label, which is how AC4 is enforced structurally.
- A `RoleBadgeList` handles the seniority ordering in one place, taking the Person's role set and sorting it — no call site sorts its own. The same seniority constant feeds POOLSE-17's `strongestRole()`.
- Consume the badge in the People list, the Alunos list, the profile header, filter chips and the invite dialog; grep for any hand-rolled role pill and delete it (AC6).
- Ordering must be stable and deterministic for a Person whose roles were granted in any order — sort by the seniority constant, never by grant date or by the array's incidental order.
- i18n: role names come from the shared role keys used by POOLSE-01 and POOLSE-17, in pt-PT and en, so a role is never spelled two ways in one app.
- Theming: verify all six tokens against both surfaces with a contrast tool, and confirm all six are distinguishable in a greyscale render — if two are not, the text label is doing all the work and the palette needs adjusting.
- Performance: badges render in paginated lists of 15 rows (POOLSE-29) with up to six badges each — keep the component pure and free of per-render token lookups.
- Most likely to get wrong: picking a red for Owner or an orange for Admin, so a People list reads like an attendance grid. AC5 names this explicitly; choose the role palette against the attendance and skill palettes side by side.

### QA — test scenarios

18.1 Given a Person holding one role / When they appear in a list / Then a single badge renders in that role's colour with the role name as text.
18.2 Given a Person holding Owner, Instructor and Student / When their badges render / Then they appear in the order Owner, Instructor, Student.
18.3 Given a Person whose roles were granted in reverse seniority order / When their badges render / Then the display order is unchanged — sorting is by seniority, not by grant order.
18.4 Given the Pessoas section / When a staff member is listed / Then their staff badges appear; given the Alunos section, Student and EE badges appear per the amendment.
18.5 Given a Person who is both staff and a student / When they appear in both sections / Then the badge display matches the documented decision on the open question, consistently in list and profile.
18.6 Given the People list / When a row is inspected / Then the row background, avatar and name text are neutral — only the badge is coloured (AC2).
18.7 Given light mode then dark mode / When all six role badges are displayed together / Then every one passes contrast and all six are distinguishable from each other.
18.8 Given a greyscale render / When all six badges are shown / Then each is identifiable from its text label alone.
18.9 Given the attendance palette from POOLSE-13 on screen at the same time / When role badges render / Then no role badge reads as an attendance state — no shared red or orange.
18.10 Given locale pt-PT then en / When badges render / Then "Encarregado de Educação" and "Guardian"/"Encarregado de Educação" render from the shared role keys with no untranslated values.
18.11 Given a Person with six roles in a narrow viewport / When the row renders / Then badges wrap or truncate predictably and the person's name stays visible.
18.12 Given the invite dialog, a filter chip and the profile header / When each shows a role / Then all three use the same token — none declares its own colour (AC6).
18.13 Given a Student user / When they attempt to read the People list via the API / Then the permission rules apply as before — this ticket changes presentation only and grants nothing.

### Acceptance criteria

1. Every role has a distinct colour token: Owner, Admin, Instructor, Student, Encarregado de Educação, Maintenance.
2. Colour is applied to the **role badge/chip only** — rows, avatars and text stay neutral.
3. A Person holding several roles shows several badges, ordered by seniority (Owner → Admin → Instructor → Maintenance → EE → Student).
4. Badges always carry the role name as text; colour never carries the meaning alone.
5. Contrast-checked in light and dark mode; the palette stays clear of the attendance colours (POOLSE-13) so red/orange do not read as a state.
6. Colours are design tokens reused anywhere a role is displayed — filters, detail header, invite dialog — not redefined per component.

---

# Batch 2 — POOLSE-19 to 28 (from the competitive scan)

## POOLSE-19 · Automatic level advancement

**Type:** Feature · **Area:** Levels / Turmas · **Priority:** High — the differentiator
**Borrowed from:** nobody. iClassPro keeps skill levels and class levels as two unrelated systems and instructs staff to link them by hand; Jackrabbit's progression is advisory only.
**Depends on:** POOLSE-20 (skill states), POOLSE-05 (level ordering defines "next").

### PO — why this exists

Today a student can finish every skill in their level and sit there until a human notices. The instructor marks the last skill poolside, nothing happens, and the family waits until someone reviews the turma by hand — often a whole época. Admins and instructors get a queue instead of a memory exercise; students and encarregados de educação get told they are ready. It sits at High because it is the one mechanic no competitor has, and because it defines the shape of levels and skills while both are still cheap to change.

**Not in scope:** enrolling anyone without a human confirmation; waiting-list management for the "no seat" case; any change to the mensalidade schedule on transfer (POOLSE-24).

### BA — rules and data

- A level carries a set of required skills. A level is **complete** for a student when every skill flagged required on that level is at *Adquirido* (POOLSE-20). Skills not flagged required never gate completion.
- "Next level" is the next level in the tenant's level order index (POOLSE-05). Order is tenant-scoped; there is no global ladder.
- A **transfer proposal** is a record: student, from_level, to_level, generated_at, status (pending / confirmed / dismissed / invalidated / expired), ranked candidate turmas, confirming actor, effective date.
- Candidate turmas must satisfy all of: same tenant, active época, level = to_level, at least one open seat, and the student's age in months inside the turma level's min/max range (POOLSE-06 months, POOLSE-16 ceiling of 100).
- Ranking is strictly: (1) same weekday **and** same start time as the student's current turma, (2) same instructor, (3) any remaining eligible turma. Ties break on most open seats, then turma name.
- Zero candidates → the student is flagged **ready to advance — no seat** and appears on the demand report. The flag clears automatically the moment an eligible seat exists; it is not a manual to-do.
- Confirmation transfers the enrolment: the old enrolment ends on the chosen effective date, the new one begins on it. Attendance already recorded against the old turma stays on the old turma; nothing is re-parented.
- If a skill is downgraded from *Adquirido* after a proposal is generated (correction, override reversal), the pending proposal moves to **invalidated** and disappears from the queue. It is never silently re-graded to a different level.
- Interaction with POOLSE-21: credits belong to the student, not to the turma, so unused reposição credits survive a transfer. Redemption eligibility (matching level) then resolves against the **new** level from the effective date onward.
- Seat counting must exclude reposição guests, who are on the roster for attendance but not enrolled (POOLSE-21 AC8). Counting them consumes seats that do not exist.
- **Open:** what happens when the completed level is the last in the order — no proposal and a "programme complete" state, or a proposal into the same level's advanced turma? The source doc does not decide.
- **Open:** may a student or encarregado de educação *accept* a proposal from the mobile app, or only see it and wait for staff? AC 4 says surfaced as a notification; AC 7 says a human confirms, without saying which human.

### Dev — implementation notes

- Migration: `level_required_skill` (tenant_id, level_id, skill_id), `transfer_proposal`, `transfer_proposal_candidate`. Tenant key on every table, every query scoped, per the data-model rule.
- Completion evaluation lives in one shared service method called from the skill-progress write path — never from the instructor grid's UI code. The grid saves incrementally over a flaky poolside connection (POOLSE-20 AC5), so evaluation must be idempotent and deduplicate per (student, level) rather than firing per mark.
- API: `GET /transfer-proposals` (queue, server-side paginated at 15 per POOLSE-29), `POST /transfer-proposals/:id/confirm` `{turmaId, effectiveDate}`, `POST /transfer-proposals/:id/dismiss`, `GET /reports/ready-no-seat`.
- Confirmation runs in a transaction that takes a row lock on the target turma and re-checks the seat count inside it. Two admins confirming into the last seat from two stale queues is the realistic failure, not a theoretical one.
- Permission enforcement is server-side on the confirm endpoint: Owner, Admin, and the Instructor assigned to the source or target turma. Student and EE tokens get `403` on confirm regardless of what the mobile app renders.
- Seat availability, age-range eligibility and "next level" resolution are one shared helper reused by the proposal generator, the redemption filter (POOLSE-21) and the enrolment screens — three copies will drift.
- i18n: level names are renameable per tenant (POOLSE-20 AC8), so proposal copy interpolates the stored name and never a hardcoded label; the ranking explanation ("mesmo dia e hora") is a translated string in pt-PT and en. Queue status chips need their own tokens, checked in light and dark, and clear of the attendance (POOLSE-13) and role (POOLSE-18) palettes.
- Most likely to be got wrong: treating "next level" as the level's id order or creation order instead of the drag-and-drop order index, so reordering levels in Settings silently reroutes every future proposal.

### QA — test scenarios

19.1 Given a student one skill short of completing a level / When the instructor marks that skill *Adquirido* / Then a pending proposal appears in the queue within the same session.
19.2 Given a level with required and optional skills / When only the optional ones are outstanding / Then the level counts as complete and a proposal is generated.
19.3 Given a pending proposal / When an Instructor not assigned to either turma calls the confirm endpoint directly with a valid token / Then the API returns `403` and no enrolment changes.
19.4 Given a student authenticated on the mobile app / When they POST to the confirm endpoint / Then `403`, even though the proposal notification is visible to them.
19.5 Given a target turma with exactly one open seat / When two admins confirm into it concurrently / Then one succeeds and the other is rejected with a seat-unavailable error, never overbooking.
19.6 Given the tenant's levels reordered by drag and drop (POOLSE-05) / When a student completes a level / Then the proposal targets the newly adjacent level, not the previous one.
19.7 Given a student aged 61 completing an adult level / When candidates are ranked / Then *Hidroginástica Sénior* (60–100) is eligible and not filtered out by a stale age ceiling of 30.
19.8 Given a proposal is pending / When the instructor corrects the last skill back to *Avaliado* / Then the proposal moves to invalidated and leaves the queue without enrolling anyone.
19.9 Given no eligible turma exists / When the student completes their level / Then they appear on the ready-to-advance-no-seat report; and when a seat later opens, the flag clears and a proposal is generated without staff action.
19.10 Given a target turma whose roster includes two reposição guests / When seats are counted / Then the guests do not consume enrolled seats and the turma is still offered.
19.11 Given the pt-PT locale / When the queue and the mobile notification render / Then all copy including the tenant's custom level name is in pt-PT; switching to en changes the copy but not the level name.
19.12 Given dark mode / When the proposal queue renders status chips / Then contrast passes and the chips are distinguishable without colour, and are not confusable with attendance states.

### Acceptance criteria

1. A level defines which skills are required to complete it; completion is evaluated automatically as skills are marked attained.
2. On completion, the system generates a **transfer proposal**: next-level turmas that have open seats, are compatible with the student's current day/time slot, and whose age range fits.
3. Proposals are ranked — same weekday and time first, then same instructor, then any open seat.
4. Proposal is surfaced to the admin/instructor as a queue, and (mobile app) to the student or encarregado de educação as a notification.
5. Confirming a proposal performs the enrolment transfer: the student leaves the old turma at a chosen effective date and joins the new one, with attendance history preserved on both.
6. If no eligible turma exists, the student is flagged **ready to advance — no seat**, and appears on a report; this is a demand signal for scheduling the next season.
7. Advancement is never automatic without a human confirmation.
8. Class levels and skill levels are **the same objects** — not two parallel systems that need manual mapping.

---

## POOLSE-20 · Four-state skill progress

**Type:** Feature · **Area:** Levels / Skills · **Priority:** High
**Borrowed from:** Jackrabbit (Not Started / Started / Tested / Attained, plus per-skill minimums).

### PO — why this exists

A boolean tells a parent nothing: their child either "has" a skill or does not, with no sense of movement between the two. Four states let an instructor record that a skill is being worked on and has been tested but not yet attained, which is what actually happens in the water. Instructors benefit most — the grid is built around a poolside pass, not a desk — and students and EE get a progress view worth opening. High priority because it is schema-shaped, blocks POOLSE-19, and gets more expensive every week it waits.

**Not in scope:** the advancement proposal itself (POOLSE-19); per-student skill notes or free-text assessment; parent-facing comparison against other students.

### BA — rules and data

- States are ordered: **Não iniciado → Iniciado → Avaliado → Adquirido**. Movement in either direction is allowed; a downgrade is a correction, is logged, and invalidates any POOLSE-19 proposal it undermines.
- `skill_progress` holds: tenant, student, skill, state, changed_at, changed_by, override_by, override_reason. It is a current-state row plus an append-only history — the history is what "timestamped and attributed" (AC 7) means.
- A skill may carry **dias mínimos** (distinct calendar days on which the student attended a turma teaching this skill) and **aulas mínimas** (count of attended occurrences). Both optional, both integers ≥ 0.
- *Adquirido* is blocked while either minimum is unmet. The override is available to Owner, Admin and the assigned Instructor, and records who overrode and when. An override never disappears from history.
- Minimums count **attended** occurrences only. A *falta justificada* does not count towards them; nor does an occurrence cancelled by a closure (POOLSE-31). A reposição attended as a guest **does** count, because the student was in the water.
- Skills belong to a level; a skill may carry one demonstration video link (URL only, no upload) shown to student/EE in the mobile app.
- Level labels are renameable per tenant. The stored key is stable; the display name is tenant data and must propagate to every progress surface, the mobile app, the printable sheet and POOLSE-19's proposals.
- Grid semantics: tapping a **column header** applies one state to that skill for every student on the roster in one pass; tapping a **row** opens that student across all skills. Bulk marking must not overwrite a state that is already further along unless the instructor confirms — silently downgrading a whole turma is the destructive case.
- Incremental save: each mark is its own write, queued locally and replayed on reconnect, with last-write-wins by client timestamp within a turma session.
- **Open:** none flagged in the source. Minimum thresholds are per skill, not per level, and the source does not ask for level-level minimums.

### Dev — implementation notes

- Migration: `skill` gains `min_days`, `min_lessons`, `video_url`; new `skill_progress` and `skill_progress_event`; the old boolean column migrates to *Adquirido* where true, *Não iniciado* where false. Tenant key on all of them.
- The state enum and its ordering live in one shared module used by the API, the grid, the printable sheet and POOLSE-19's completion check. Do not re-declare the order in the UI.
- API: `GET /turmas/:id/skill-grid` returns the whole matrix in one call (students × skills × state) — never one request per cell. `POST /skill-progress/batch` accepts an array of marks with client timestamps and returns per-mark results so a partial failure is visible.
- Offline queue lives in the mobile/tablet client with an idempotency key per mark, so replay after reconnect cannot double-apply. The server must accept the same key twice and return the first result.
- Permissions server-side on the batch endpoint: Owner, Admin, assigned Instructor. The override flag is a separate check on the same endpoint — an Instructor who may mark is not automatically an Instructor who may override, so decide it explicitly and enforce it there.
- Four colour tokens plus four icons, contrast-checked in light and dark, deliberately clear of the attendance palette (POOLSE-13) and the role palette (POOLSE-18). Icon plus text label everywhere; colour never alone.
- i18n: the four state names are keys in pt-PT and en; the tenant's custom level names are data and are never translated. The printable sheet needs its own locale-aware layout.
- Performance: the grid is a full turma × full skill set matrix. Fetch once, mutate locally, reconcile — a refetch per mark makes it unusable on pool wifi.
- Most likely to be got wrong: enforcing dias/aulas mínimas only in the UI. The batch endpoint must re-check them server-side, because the offline queue replays marks the client validated against stale attendance.

### QA — test scenarios

20.1 Given a skill with no minimums / When the instructor marks it *Adquirido* / Then it saves and the change is attributed to that instructor with a timestamp.
20.2 Given a skill with dias mínimos 4 and the student attended 3 days / When *Adquirido* is submitted via the API / Then it is rejected, and the same submission with a valid override succeeds and records the overriding user.
20.3 Given a student whose 4th attendance was a *falta justificada* / When the minimum is evaluated / Then it counts as 3 and *Adquirido* is still blocked.
20.4 Given an occurrence cancelled by a closure (POOLSE-31) / When aulas mínimas are counted / Then that occurrence does not count.
20.5 Given a student who attended a turma as a reposição guest / When aulas mínimas are counted / Then that attendance counts.
20.6 Given a Student-role token / When it POSTs to the skill-progress batch endpoint / Then `403`, regardless of the mobile app hiding the grid.
20.7 Given the grid open on a tablet / When the connection drops mid-turma and ten marks are entered / Then on reconnect all ten replay exactly once and none is duplicated or lost.
20.8 Given a column header tap that would downgrade three students already at *Adquirido* / When applied / Then the instructor is warned and those three are not silently downgraded.
20.9 Given a tenant that renamed its levels / When the grid, the printable sheet and the mobile app render / Then all three show the custom name.
20.10 Given the en locale and then pt-PT / When the four states render / Then labels switch between Not started/Started/Tested/Attained and Não iniciado/Iniciado/Avaliado/Adquirido, and the icons do not change meaning.
20.11 Given dark mode / When all four states appear in one grid / Then each is distinguishable by icon and text with colour removed, and none is confusable with *falta justificada* orange.
20.12 Given a skill with a demonstration video link / When a student views it in the mobile app / Then it opens; and when the link is absent / Then no empty affordance is shown.

### Acceptance criteria

1. Skill progress states: **Não iniciado / Iniciado / Avaliado / Adquirido** (Not started / Started / Tested / Attained), each with its own icon and colour token, distinct from the attendance palette (POOLSE-13) and the role palette (POOLSE-18).
2. Each skill carries optional **dias mínimos** and **aulas mínimas** — a skill cannot be marked *Adquirido* before those thresholds are met, with an override that records who overrode it.
3. Each skill may carry a demonstration video link, shown to the student/EE in the mobile app.
4. Instructor screen is a grid: students as rows, skills as columns. Tapping a **column header** marks that one skill across the whole turma in a single pass; tapping a **row** marks one student across all skills.
5. The grid works on tablet and phone, and saves incrementally — a lost connection mid-turma never loses entered marks.
6. A printable turma skills sheet exists for when the tablet stays dry.
7. Progress changes are timestamped and attributed to the instructor.
8. Level labels are renameable per tenant, and the custom names propagate everywhere progress is shown.

---

## POOLSE-21 · Aula de reposição as a credit object

**Type:** Feature · **Area:** Calendar / Attendance · **Priority:** Medium
**Borrowed from:** iClassPro makeup tokens (expiry, eligibility filtering, backfill-only rule).

### PO — why this exists

A reposição owed to a family is currently a note someone remembers, which means it is either forgotten or honoured twice. Making it a credit object gives the family something they can see and book, and gives the office a number it can close out at the end of the época. Families and front desk both benefit; the office stops arbitrating from memory. Medium priority because it depends on attendance being stable and on POOLSE-13's *falta justificada* state landing first.

**Not in scope:** compensating closures — a closure cancels the class and mints nothing (POOLSE-31 AC 8, and its Note); refunds or any monetary settlement of an unused credit; credits for unjustified faltas.

### BA — rules and data

- A credit is minted **only** by an absence marked *Falta justificada*. *Faltou* mints nothing. An occurrence cancelled by a closure mints nothing and is not an absence at all — deliberate, per POOLSE-31.
- Minting is configurable per tenant **and** per turma. The turma setting wins where both are set; the effective rule must be resolvable at mint time and stored on the credit, so changing the setting later does not retroactively rewrite history.
- Credit record: tenant, student, originating_absence (occurrence + attendance row), issue_date, expiry_date, status (available / booked / used / expired), booked_occurrence, redeemed_at, source_rule snapshot.
- Redemption candidates are filtered to: matching level, student's age inside the turma's range, a date strictly before expiry, not a closure date, not a feriado (POOLSE-31), and an open seat.
- The optional tenant rule **backfill-only** restricts candidates further to occurrences where another enrolled student has a recorded absence. **Conflict with AC 3:** a full turma with one absence has no "open seat" under a naive count, so backfill-only and open-seat are mutually exclusive unless a recorded absence is treated as temporarily freeing a seat for that occurrence. Decide it as: for the purposes of reposição eligibility on a given occurrence, capacity = enrolled minus recorded absences on that occurrence, so both filters can hold at once.
- Credits are always offered oldest-expiry-first. Where expiries tie, oldest issue date first.
- Redemption mode is per tenant: self-service (student/EE books from the mobile app) or request (staff approve). In request mode a booking sits in a pending state that holds the seat until approved or rejected, with a timeout so an abandoned request does not block the slot indefinitely.
- A student attending as a reposição is a **guest** on that roster: attendance is recorded, they do not appear in the turma's enrolled-student list (POOLSE-08), they do not count towards enrolled seats for POOLSE-19's proposals, and they are addressable as a separate audience in communications.
- Cap on credits per student per época is configurable. When the cap is reached, further justified absences mint nothing and the fact is recorded so staff can explain it.
- A scheduled job expires unused credits, writes the expiry and stops any pending notification. Expiry must be evaluated in the tenant's timezone against the credit's expiry date, not in UTC.
- Cancelling a booked reposição before the occurrence returns the credit to *available* with its original expiry unchanged; after the occurrence it is *used* whether or not the student turned up.
- **Open:** the expiry basis is undecided — do reposições expire at the end of the época, or on a fixed window (e.g. 60 days) from the absence? The two produce very different behaviour for an absence in the last month of the época, and the redemption filter, the oldest-expiry-first ordering and the expiry job all key off it.

### Dev — implementation notes

- Migration: `reposicao_credit`, `reposicao_booking`, tenant-level and turma-level minting settings, per-época cap. Tenant key on all; index on (tenant_id, student_id, status, expiry_date) because oldest-expiry-first ordering is the hot query.
- Minting hooks into the attendance write path, transactionally with the attendance row, so an attendance state change and its credit cannot diverge. Changing *Faltou* → *Falta justificada* mints; the reverse revokes an unbooked credit and must refuse if the credit is already used.
- One shared eligibility helper computes occurrence capacity as enrolled minus recorded absences, and is reused by redemption filtering, POOLSE-19 seat counting and the roster view. This is the single most important piece of shared logic in the ticket.
- API: `GET /credits?studentId=` (oldest-expiry-first), `POST /credits/:id/book {occurrenceId}`, `POST /bookings/:id/approve|reject`, `POST /bookings/:id/cancel`. Booking takes a row lock on the occurrence and re-validates capacity inside the transaction.
- Permissions server-side: a Student or EE may book only for themselves or their own linked students (POOLSE-04 guardianship edges), and only when the tenant is in self-service mode. In request mode their booking endpoint creates a pending request, never a confirmed booking; approval is Owner/Admin/assigned Instructor.
- Expiry job is a per-tenant scheduled task, idempotent, safe to re-run, and must not re-notify on a second pass.
- i18n: *reposição*, *falta justificada* and credit status names are keys in pt-PT and en; expiry dates and any "expires in N days" copy use locale formatting and plural rules. The guest marker on the roster needs a text label, not a colour dot, and its token must be checked in light and dark and stay clear of the attendance palette.
- Most likely to be got wrong: counting the reposição guest as an enrolled student somewhere — the POOLSE-08 list, the seat count, an occupancy figure, or a communications audience — which is exactly what AC 8 exists to prevent.

### QA — test scenarios

21.1 Given a tenant with minting on / When an absence is marked *Falta justificada* / Then exactly one credit is minted with a status of available.
21.2 Given the same tenant / When an absence is marked *Faltou* / Then no credit is minted.
21.3 Given a closure covering a turma occurrence (POOLSE-31) / When the closure is saved / Then the occurrence is cancelled, no attendance is recorded, and no credit is minted for anybody.
21.4 Given a turma at full capacity with one recorded absence on an occurrence and backfill-only enabled / When a credit is redeemed / Then that occurrence is offered and the turma is not pushed over capacity.
21.5 Given a turma at full capacity with no absences / When a credit is redeemed with backfill-only enabled / Then the occurrence is not offered.
21.6 Given a student with three credits of differing expiry / When they open redemption / Then the earliest-expiring is offered first.
21.7 Given a credit expiring on the 30th / When the student tries to book an occurrence on the 31st / Then the occurrence is not listed, and a direct API booking of it returns a validation error.
21.8 Given an EE authenticated on the mobile app / When they call the booking endpoint for a student they are not linked to / Then `403`.
21.9 Given the tenant in request mode / When an EE books from the app / Then a pending request is created, the seat is held, and no attendance-bearing booking exists until staff approve.
21.10 Given a booked reposição / When the student is added to that roster / Then they appear as a guest, are absent from the POOLSE-08 enrolled list, and do not consume a seat in a POOLSE-19 proposal for that turma.
21.11 Given a student who has hit the per-época credit cap / When another justified absence is marked / Then no credit is minted and the reason is recorded and explainable to staff.
21.12 Given the pt-PT and then the en locale, in light and dark mode / When the credits list and the guest marker render / Then all copy and dates are localised and the guest marker is legible and readable without colour.

### Acceptance criteria

1. Marking an absence as *Falta justificada* (POOLSE-13) optionally mints one credit — configurable per tenant, and per turma.
2. A credit is a record with: student, originating absence, issue date, **expiry date**, status (available / booked / used / expired).
3. Redemption lists only eligible turmas — matching level, within the student's age range, with an open seat, on a date before the credit expires. Closed dates and holidays are excluded.
4. Optional tenant rule: **redeemable only into a slot where another student has a recorded absence**, so a reposição never pushes a turma over capacity.
5. Credits are presented oldest-expiry-first so the perishable ones are used first.
6. Two redemption modes per tenant: self-service (student/EE books directly from the mobile app) or request (staff approve).
7. A scheduled job expires unused credits and records the expiry.
8. A student attending as a reposição is visibly a **guest on that roster** — counted for attendance, excluded from the turma's enrolled-student list (POOLSE-08), and addressable separately in communications.
9. Configurable cap on credits per student per season.

---

## POOLSE-22 · Age of majority as a tenant setting

**Type:** Improvement · **Area:** Settings / Students · **Priority:** Medium — cheap now, migration later
**Borrowed from:** Pike13 (age of majority as a business setting that drives which waiver is presented).

### PO — why this exists

Eighteen is hardcoded in the guardian logic and in the copy around it. It is correct for Portugal today and wrong the first time Poolse sells anywhere else, or the first time a school wants guardian consent up to 16 for its own reasons. Owners get a setting; developers get one place to read instead of a scattered constant. Medium priority purely because it is a one-line read now and a data migration later.

**Not in scope:** changing the default from 18; the consent form content itself; the age brackets on the avatar badge (POOLSE-33), which are a display device, not a legal boundary.

### BA — rules and data

- `maioridade` is a per-tenant integer, default 18. Sensible bounds are needed — reject 0 and anything above the maximum age ceiling of 100 (POOLSE-16).
- Every consumer reads the setting: POOLSE-04's guardian block trigger, the consent/terms selection at enrolment, and any copy that currently says "under 18".
- Consent selection: below the threshold the guardian-signed form is presented; at or above it the self-signed form (POOLSE-23 AC 2).
- Age comparison uses the same months-based age computation as POOLSE-06, so a tenant setting of 18 means 216 months and a student one day short is still a minor.
- Changing the setting **re-evaluates** which students currently require a guardian and produces a report of the affected list. It never deletes a guardian link — POOLSE-04 AC 8 already establishes that links are retained when a student ages past the boundary.
- Lowering the threshold makes some minors adults: their guardian block collapses to optional, links are kept, and they appear on the report. Raising it makes some adults minors: they appear on the report as **missing a guardian**, but existing enrolments are not blocked retroactively.
- Consent already signed under the old threshold stays valid. Re-consent is not triggered by a setting change; if a school wants it, that is an explicit action.
- **Conflict to note:** POOLSE-33 fixes the *Jovem* bracket at 12–17 and *Adulto* at 18–59, and POOLSE-33 AC 7 asks for boundaries shared with the age logic. A tenant with maioridade ≠ 18 will have a badge that disagrees with the guardian rule. The badge is cosmetic and the source doc does not resolve this; treat the brackets as display-only and independent of maioridade unless told otherwise.
- Copy rule: no string anywhere contains the literal "18". Strings interpolate the setting via i18n, in both pt-PT and en, with correct pluralisation.

### Dev — implementation notes

- Migration: add `maioridade` (integer, default 18, not null) to the tenant settings table. Backfill 18 for every existing tenant.
- One shared helper — `isMinor(person, tenantSettings)` — replaces every hardcoded comparison. Grep for the literal 18 across the students, enrolment and consent code before closing this ticket; that sweep *is* the ticket.
- API: settings read is available to any authenticated user of the tenant (the guardian block needs it client-side); write is Owner/Admin only, enforced server-side with `403` for everyone else.
- The re-evaluation report is computed on save, in a transaction with the setting change, and returned to the caller — not generated as a background job whose result nobody sees.
- Where the client needs the threshold to render the guardian block live as a date of birth is typed (POOLSE-04 AC 7), it comes from the same settings payload the page already loads, not a separate fetch per keystroke.
- i18n: strings become parameterised — `"Menor de {{age}} anos"` / `"Under {{age}}"` — with pt-PT and en both carrying the parameter. Anything with a baked-in numeral fails review.
- Most likely to be got wrong: leaving the threshold enforced only client-side, so a crafted enrolment request presents the self-signed consent form for a 15-year-old.

### QA — test scenarios

22.1 Given a tenant with maioridade 18 / When a student aged 17 is opened / Then the guardian block appears; and at 18 it collapses to optional.
22.2 Given the tenant sets maioridade to 16 / When the setting is saved / Then a report lists every 16- and 17-year-old whose guardian requirement changed, and no guardian link is deleted.
22.3 Given the tenant raises maioridade to 21 / When the setting is saved / Then 18–20-year-olds appear on the report as missing a guardian, and their existing enrolments remain active.
22.4 Given an Instructor token / When it PATCHes the maioridade setting / Then `403` and the value is unchanged.
22.5 Given a student one day short of the threshold / When they enrol / Then the guardian-signed consent form is presented, not the self-signed one.
22.6 Given a crafted enrolment request for a 15-year-old asserting self-signed consent / When the API receives it / Then it is rejected server-side.
22.7 Given maioridade set to 0 or 101 / When saved / Then validation rejects it with an inline message.
22.8 Given the pt-PT locale and maioridade 16 / When the guardian block heading renders / Then it reads "menor de 16 anos" with correct pluralisation; in en it reads "under 16".
22.9 Given the en locale / When maioridade is 1 / Then the singular form is used, not "1 years".
22.10 Given a student whose consent was signed under a threshold of 18 / When the tenant changes it to 21 / Then the existing consent is not invalidated and no re-consent prompt fires.
22.11 Given the date of birth is edited across the threshold in a form session / When the block shows and hides / Then entered data is not lost, and the threshold used is the tenant's, not 18.
22.12 Given light and dark mode / When the affected-students report renders / Then the changed-requirement indicator is readable by text alone in both.

### Acceptance criteria

1. `maioridade` is a per-tenant integer, defaulting to **18**.
2. POOLSE-04's guardian block triggers off this value rather than a hardcoded 18.
3. The same value selects which consent/terms form is presented at enrolment — guardian-signed below it, self-signed at or above it.
4. Changing the setting re-evaluates which students currently require a guardian and reports the affected list; it never silently deletes guardian links.
5. Anywhere the UI says "under 18", the text is generated from the setting via i18n, not written into the string.

---

## POOLSE-23 · Adult and senior enrolment path

**Type:** Feature · **Area:** Students / Enrolment · **Priority:** Medium
**Borrowed from:** nobody — none of the five lesson platforms models an adult programme as anything other than a children's path with the guardian fields left blank.

### PO — why this exists

An adult signing up for hidroginástica should not be walked through a form built for somebody else's child, with guardian copy greyed out and a consent form addressed to a parent. Adult and senior participants are a real programme at Poolse, not an edge case of the children's path. They benefit directly, and the office stops explaining why the form asks who the child is. Medium priority because most of it falls out of the Person model once POOLSE-17 lands.

**Not in scope:** the pricing engine itself — this ticket only requires that a fee category can be expressed; medical record-keeping beyond a notes field; whether adult students get app logins (open at doc level).

### BA — rules and data

- An adult participant is a Person with **no inbound guardian edge** (POOLSE-17 AC 3). There is no adult flag; the absence of the edge is the definition, combined with age ≥ maioridade (POOLSE-22).
- The enrolment flow branches on that: no guardian block, no guardian-consent copy, no "which child are you enrolling?" step. Branch on the data, not on a checkbox the user ticks.
- Adults self-sign consent and terms; the form presented is the one POOLSE-22 AC 3 selects.
- Adult and senior student records carry **health and mobility notes** (free text, per-student, not per-enrolment) and an **emergency contact**. The emergency contact is either a Person link or free text and is explicitly not a guardian — it grants no role, no login, no access to the student's record, and does not appear in guardian lists.
- A fee category is expressible on the turma or on the enrolment; the enrolment-level value wins where both exist. It is a category reference, not a discount percentage computed in the UI.
- Senior levels sit in the same level ordering as everything else (POOLSE-05, POOLSE-16), so POOLSE-19's "next level" logic works across them without a parallel branch.
- A Person who is both an adult student and an encarregado de educação has one record, one profile, with their enrolments and their guardianship as separate sections (POOLSE-17 AC 6, POOLSE-35 AC 6). They appear once in Alunos with both badges.
- Communications routing: for a student at or above maioridade with no guardian edge, messages go to the student. Where a person is both an adult student and an EE, the two audiences are distinct — a message to guardians must not reach them in their student capacity and vice versa.
- Health and mobility notes are sensitive. Visibility should be restricted, and the source doc does not say to whom. **Open:** which roles may read health and mobility notes — Owner/Admin only, or the assigned Instructor too? An instructor running a senior class arguably needs to know about a mobility limitation.
- **Open (doc-level, POOLSE-17):** whether adult students get app accounts in v1 or only guardians do. This ticket's AC 7 assumes an adult student is reachable directly, which is satisfiable by email even without an app login.

### Dev — implementation notes

- Migration: `health_notes` and emergency contact fields (person link nullable + free-text fallback) on the Person or student-role assignment; `fee_category` reference on turma and enrolment. Tenant key throughout.
- The enrolment wizard reads one `enrolmentContext` computed server-side (age in months, maioridade, guardian edges present, consent form to present) rather than deciding the branch in the client from scattered fields.
- Guardian-edge absence is the discriminator everywhere. Do not add an `is_adult` column — it will drift the first time a date of birth is corrected.
- API: consent form selection is returned by the server and validated on submit; a submitted self-signed consent for a Person with a guardian edge and age below maioridade is rejected with `422`.
- Permissions: health and mobility notes need their own server-side read check, distinct from the general student read. Whatever the open question resolves to, enforce it on the endpoint, not by omitting the field from one screen.
- Communications audience resolution belongs in a shared helper that returns recipients for (student, capacity), so guardian-routing and student-routing cannot both fire for a dual-role Person.
- i18n: adult and senior enrolment copy is a distinct string set in pt-PT and en — reusing the child strings with the guardian words removed reads badly in Portuguese. Emergency-contact and health-notes labels included.
- Most likely to be got wrong: routing an adult student's communications to a guardian because the code asks "does this Person have any guardian edges at all?" instead of "does this student, in their student capacity, have an inbound guardian edge?" — a senior who is also an avó guardian has outbound edges and would be misrouted.

### QA — test scenarios

23.1 Given a Person aged 45 with no inbound guardian edge / When they enrol / Then no guardian block, no guardian consent copy and no child-selection step appear anywhere in the flow.
23.2 Given the same Person / When they submit consent / Then the self-signed form is recorded against them.
23.3 Given a 15-year-old / When a request submits self-signed adult consent directly to the API / Then `422` and nothing is recorded.
23.4 Given an adult student with an emergency contact that is a Person link / When that contact logs in / Then they have no access to the student's record and hold no EE role.
23.5 Given a senior student aged 72 / When levels are listed / Then *Hidroginástica Sénior* appears in the shared level ordering, not a separate list.
23.6 Given a Person who is both an adult student and an EE for a grandchild / When Alunos is opened / Then they appear exactly once, with both badges, and one profile with two sections.
23.7 Given that same dual-role Person / When a message is sent to guardians of a turma / Then they receive it only in their EE capacity, and a message to adult students of their own turma reaches them separately.
23.8 Given an Instructor token / When it reads the health and mobility notes endpoint / Then the response matches the decided permission rule and is enforced server-side, not by hiding the field.
23.9 Given a fee category set on both the turma and the enrolment / When the price is resolved / Then the enrolment-level category wins.
23.10 Given the pt-PT locale / When the adult enrolment flow renders / Then the copy is adult-addressed Portuguese, with no leftover guardian phrasing; the same holds in en.
23.11 Given light and dark mode / When the health-notes and emergency-contact sections render / Then both are legible and visually distinct from the guardian block used on the minors' path.
23.12 Given an adult student whose date of birth is corrected to make them a minor / When the record is reopened / Then the guardian block appears and enrolment is blocked until a guardian link exists (POOLSE-04 AC 5), with no data silently discarded.

### Acceptance criteria

1. Enrolling an adult never shows the guardian block, guardian-consent copy, or any "which child are you enrolling?" step.
2. Adult students self-sign consent and terms.
3. Adult/senior student records support **health and mobility notes** and an emergency contact — the emergency contact is a Person link or free text, and is explicitly *not* a guardian.
4. Concession/senior pricing is expressible as a fee category on the turma or the enrolment.
5. Senior levels (e.g. *Hidroginástica Sénior*, 60–100 per POOLSE-16) appear in the same level ordering, not a separate parallel system.
6. A Person who is both an adult student and an encarregado de educação sees both, as sections of one profile (POOLSE-17), with no duplicate record.
7. Communications to adult students go to the student, never routed to a guardian.

---

## POOLSE-24 · Mensalidade plan visible at the price

**Type:** Feature · **Area:** Billing / Enrolment · **Priority:** Medium
**Borrowed from:** Amilia — the instalment schedule is shown three times: under the price, at checkout, and in the account.

### PO — why this exists

A family looking at a turma sees one number and has to guess whether it is the term, the month or the year. Showing the mensalidade schedule at the price, again at checkout and again in the account removes the single most common phone call to the office. Guardians and adult students benefit; the office stops explaining arithmetic. Medium priority, and it ships with POOLSE-25 — the plan and the failure path are one story from the family's side.

**Not in scope:** editing or renegotiating a schedule after enrolment; proration for mid-season joins; the collection mechanics themselves (POOLSE-25).

### BA — rules and data

- A **payment plan** belongs to a season/turma price: an upfront amount (inscrição), an instalment amount, a count of instalments, and a day-of-month for collection. The total is derived, never stored twice.
- The schedule shown before payment is the schedule that is charged. At enrolment the plan is **materialised** into concrete dated charges attached to the enrolment; from that moment the family's view reads the materialised charges, not a recomputed preview.
- Charge states: upcoming, due, paid, failed (POOLSE-25 owns failed). The billing section groups by state and shows dates.
- The plain-sentence rendering is composed from the plan's parts, not a stored sentence: upfront, instalment amount, instalment count, total.
- Day-of-month edge case: a collection day of 29, 30 or 31 must resolve to the last day of shorter months. Decide it once, in the materialiser.
- Where the enrolment starts mid-plan, the schedule shown must be the schedule actually generated. If proration is out of scope, then the plan starts at the next instalment date and the sentence must say so rather than showing a total the family will not be charged.
- Closures do not alter the schedule. POOLSE-31 AC 8 says a closure means no charge for the cancelled occurrence; a mensalidade is a monthly instalment, not a per-occurrence charge, so a closure inside a month does not reduce that month's instalment. **Open:** does a long closure reduce or suspend the mensalidade? The source doc says closures produce no charge for the class and no credit, without saying what a monthly plan does. Treat "no charge" as applying to per-occurrence billing only until decided.
- Currency is euro; amounts are stored in cents as integers. Dates and currency format by locale (pt-PT: `50,00 €`; en: `€50.00`).
- The control reads **"Ver mensalidades"** in pt-PT and its en equivalent, and expands in place — not a modal, not a separate page.

### Dev — implementation notes

- Migration: `payment_plan` on season/turma pricing, `enrolment_charge` (tenant, enrolment, due_date, amount_cents, state, plan_ref). Tenant key on both; index on (tenant_id, enrolment_id, due_date).
- One materialiser function generates the charge rows and is the same code path used to render the pre-payment preview, called with the same inputs. Two implementations is how the preview and the charges drift apart, which AC 5 exists to prevent.
- API: `GET /pricing/:id/plan` returns plan parts and a rendered breakdown; `GET /enrolments/:id/charges` returns the materialised list. The plain sentence is composed client-side from parts via i18n interpolation so pt-PT and en can order the clauses differently.
- The expander under the price is one shared component reused on the turma card, the enrolment step, the checkout summary and the billing section — four copies is exactly the drift risk.
- Permissions server-side: a guardian sees charges for their linked students only; an adult student sees their own; Owner/Admin see all. Instructor sees none — enforce on the charges endpoint, not by hiding the section.
- Money never touches floating point. Cents as integers end to end, including the total in the sentence.
- i18n and theming: currency and date formatting from the locale (never string concatenation, per POOLSE-02's precedent); the paid/due/upcoming state indicators need text labels and tokens checked in light and dark, kept clear of the attendance palette.
- Most likely to be got wrong: recomputing the schedule at render time from the plan instead of reading the materialised charges, so a price change in Settings retroactively changes what an already-enrolled family thinks they owe.

### QA — test scenarios

24.1 Given a turma priced with a plan / When the price is displayed anywhere / Then a "Ver mensalidades" control sits directly beneath it and expands the schedule in place.
24.2 Given a plan of €50 upfront plus €50 × 9 / When the sentence renders / Then it reads with a total of €500 and the total matches the sum of the materialised charges exactly.
24.3 Given checkout / When the page renders / Then the amount charged now is shown beside the full list of upcoming charges with their dates.
24.4 Given the plan's collection day is 31 / When charges are materialised across February / Then that instalment falls on the last day of February, and no charge is skipped.
24.5 Given an enrolment completes / When the pricing is later changed in Settings / Then the family's billing section still shows the originally materialised schedule.
24.6 Given an Instructor token / When it requests the charges endpoint for a student / Then `403`.
24.7 Given a guardian token / When it requests charges for a student they are not linked to / Then `403`.
24.8 Given a guardian of two students / When they open the billing section / Then each student's schedule is separately identifiable and totals are not merged into one ambiguous figure.
24.9 Given the pt-PT locale / When amounts and dates render / Then they read `50,00 €` and `31 de janeiro de 2027`; in en, `€50.00` and `31 January 2027`.
24.10 Given a plan with one instalment / When the sentence renders in en and pt-PT / Then the singular form is used, not "1 months".
24.11 Given light and dark mode / When paid, due and upcoming charges appear in one list / Then each state is distinguishable by text alone and contrast passes in both.
24.12 Given a mid-season enrolment / When the schedule is previewed and then materialised / Then the previewed dates and amounts are identical to the charges created, with no extra or missing instalment.

### Acceptance criteria

1. Wherever a season/turma price is shown, a **"Ver mensalidades"** control sits directly beneath it and expands the schedule in place.
2. Terms read as a plain sentence: *"€50 na inscrição, depois €50 por mês durante 9 meses — total €500."*
3. At checkout, the amount charged now is shown **beside** the full list of upcoming charges with their dates.
4. After enrolment, the same schedule lives in the guardian's (or adult student's) billing section, showing paid, due and upcoming.
5. Amounts and dates come from one source — the schedule shown before payment is the schedule that is charged.
6. Currency and date formatting follow the locale.

---

## POOLSE-25 · Self-cure for failed débito direto

**Type:** Feature · **Area:** Billing · **Priority:** High once collections go live
**Borrowed from:** Amilia's self-cure button — improving on their single retry, and on their failure to notify admins.

### PO — why this exists

SEPA débito direto fails routinely and slowly: the collection is presented, the family believes it is paid, and days later the bank returns it. Today that becomes a phone call to the office and an awkward conversation. A balance due the family can settle themselves with MB WAY or card closes the loop without staff. Guardians and adult students benefit first, the office second. High the moment collections go live — before that it has nothing to cure.

**Not in scope:** the mandate signature flow itself; dunning letters or debt collection; deciding a tenant's suspension policy beyond providing the setting (default flag only).

### BA — rules and data

- SEPA returns are **asynchronous and late**. A collection presented on day 0 can be returned by the bank on day 2 for insufficient funds, or up to 13 months later for an unauthorised transaction. The system must never treat "not yet returned" as "settled" — a charge moves to paid only on settlement confirmation, and a return can arrive after it was marked paid, which must be handled as a reversal rather than an error.
- Return reasons are stored **as received** — the ISO/SEPA reason code and the bank's text, unflattened. The distinctions that matter: `AC04`/`AC06` account closed or blocked, `AM04` insufficient funds, `MD01` no valid mandate, `MD06` disputed by the debtor, `MS03` unspecified. Insufficient funds is a retry case; no valid mandate is not.
- A return creates a **balance due** on the account with a plain-language explanation derived from the reason code, plus the original charge reference and date.
- The **retry ladder** is per-tenant configurable (default +3 days, +7 days, then stop). Each attempt is a new collection presentation, logged with its own presentation date, result and return reason.
- The ladder interacts with the mandate: a return whose reason indicates the mandate is invalid (`MD01`, `MD07` debtor deceased, `AC04` account closed) **terminates the ladder immediately** and marks the mandate as requiring re-signature. Retrying against a dead mandate produces further returns and, in some banks' handling, fees. Insufficient-funds returns are the only ones the ladder should retry by default.
- A `MD06` dispute is not a payment failure to retry — it is a chargeback-shaped event. It creates a balance due, notifies Owner/Admin, and does not enter the ladder.
- Because returns are late, a scheduled retry must be **cancelled** if the balance was cleared in the meantime by a self-cure payment. Presenting a collection for money already received is the worst failure mode in this ticket.
- Notifications to the family stop the moment the balance reaches zero, including cancelling an already-queued reminder. Admin notifications fire on the **first** failure and again when the ladder is **exhausted** — not on every rung.
- A self-cure payment settles the specific balance due, not an arbitrary amount. Partial payment is either disallowed or explicitly modelled; disallow it in v1 and say so.
- Tenant rule for a persistent failure's effect on enrolment: nothing / flag / suspend, defaulting to **flag only**.
- Currency and reason-code display: the raw code is retained for staff and the audit trail, but the family sees the plain-language explanation only.
- **Open:** the definition of "persistent" that triggers the enrolment rule — ladder exhausted once, or N exhausted ladders in an época? The source doc names the rule but not its trigger threshold.

### Dev — implementation notes

- Migration: `collection_attempt` (tenant, charge, presented_at, status, return_code, return_text, returned_at), `balance_due`, `mandate` status fields, tenant retry-ladder and enrolment-rule settings. Tenant key on all.
- The return webhook/ingestion from Stripe (and the Portuguese rails) must be **idempotent by provider event id** — banks and PSPs re-deliver, and applying the same return twice doubles a balance due.
- Return handling is a state machine on the charge, not a set of `if` branches at the webhook. Reversal of a settled charge is a legal transition and must be modelled, not an exception path.
- The ladder is a scheduled job per pending attempt. Before presenting, it re-reads the balance and the mandate status inside a transaction and aborts if either says stop. A scheduler that fires blind on a stored date is the bug this ticket most likely ships with.
- API: `GET /billing/balances` (family scope), `POST /balances/:id/pay` returning a payment intent for MB WAY or card; `GET /reports/open-failures` for admins. All server-side scoped: a guardian may only see and pay balances for their own linked students, an adult student their own; Instructor gets `403` outright.
- Payment amounts in cents as integers, shared with POOLSE-24's charge model — the balance due must reconcile exactly with the failed charge.
- i18n: every reason code maps to a pt-PT and en explanation string; unmapped codes fall back to a generic message plus the raw code for staff, never a blank. Notification templates in both languages. Failure and balance indicators need text labels and tokens checked in light and dark, distinct from attendance red.
- Most likely to be got wrong: retrying after `MD01` or `AC04`. The ladder must branch on the reason code, not simply count rungs.

### QA — test scenarios

25.1 Given a collection returned with `AM04` / When the return is ingested / Then a balance due appears on the account with a plain-language explanation, and the first retry is scheduled per the ladder.
25.2 Given a return with `MD01` / When it is ingested / Then the ladder terminates immediately, the mandate is marked as requiring re-signature, and no retry is presented.
25.3 Given a return with `MD06` / When it is ingested / Then Owner/Admin are notified, a balance due is created, and the charge does not enter the retry ladder.
25.4 Given a scheduled retry for tomorrow / When the family self-cures today with MB WAY / Then the retry is cancelled, no collection is presented, and family notifications stop.
25.5 Given the same PSP return event delivered twice / When both are ingested / Then exactly one balance due exists and no amount is doubled.
25.6 Given a charge marked paid on settlement / When a return arrives eleven days later / Then it is processed as a reversal, not rejected as invalid, and the account balance reflects it.
25.7 Given an Instructor token / When it calls the balances endpoint / Then `403`.
25.8 Given a guardian token / When it attempts to pay a balance belonging to another family / Then `403` and no payment intent is created.
25.9 Given a ladder of +3, +7, then stop / When all attempts fail with `AM04` / Then admins are notified on the first failure and once at exhaustion — twice in total, not four times.
25.10 Given the tenant rule set to flag only / When a ladder is exhausted / Then the enrolment is flagged and remains active; and with the rule set to suspend / Then it is suspended, and neither happens without the rule being set.
25.11 Given an unmapped bank return code / When the family views the balance / Then a generic explanation is shown, and staff can still see the raw code in the attempt log.
25.12 Given the pt-PT and en locales, in light and dark mode / When the balance-due screen and the "Pagar agora" action render / Then copy, currency and dates are localised and the failure state is readable without relying on colour.

### Acceptance criteria

1. A returned or failed collection creates a **balance due** on the account, visible to the guardian/adult student with a clear explanation of what happened.
2. A **"Pagar agora"** action lets them settle it themselves — MB WAY or card — without staff involvement.
3. A configurable **retry ladder** (e.g. +3 days, +7 days, then stop) replaces a single retry; each attempt is logged with its return reason.
4. Admins are notified on the first failure and again when the ladder is exhausted; a report lists all open failures.
5. Notifications to the family are polite and factual, and stop as soon as the balance is cleared.
6. Return reasons are stored as received from the bank, not flattened to "failed" — insufficient funds and a cancelled mandate need different follow-up.
7. Tenant rule for what a persistent failure does to enrolment (nothing / flag / suspend), defaulting to **flag only**.

---

## POOLSE-26 · Missing-reading alert

**Type:** Feature · **Area:** Maintenance · **Priority:** Medium
**Borrowed from:** Pool Shark H2O and SILOE — both alert when a pool *hasn't* been tested, not only when a value is out of range.

### PO — why this exists

Every water-quality system alerts on a bad reading. None of the cheap ones alerts on a reading that never happened, which is the failure that actually closes pools and fails inspections. Maintenance staff get a nudge before the gap becomes a compliance hole; supervisors get an escalation instead of a surprise. Medium priority, shipping with the maintenance module.

**Not in scope:** out-of-range alerting, which already exists and stays independently configurable; automated readings from probes; the compliance report format itself.

### BA — rules and data

- Each basin has one or more **testing intervals**, configurable per parameter or per parameter group (e.g. pH and chlorine every 4 hours, combined chlorine daily).
- An interval elapsing with no reading for that parameter fires a **missing-reading alert**. This is a distinct alert type from out-of-range, with its own enable/disable and its own thresholds.
- Escalation is two-tier: the responsible staff member first; the supervisor after a configurable grace period with the reading still unlogged. The grace period is per interval configuration, not global.
- The interval clock restarts from the **timestamp of the reading**, not from when it was entered — a reading taken at 08:00 and logged at 11:00 restarts the clock at 08:00.
- Suppression rules: no alert fires for a basin on a closure date (POOLSE-31), for a basin marked out of season, or for a basin marked drained. A drained pool paging someone nightly is the specific failure the AC names.
- Recipients resolve by **role** (POOLSE-01 roles), not by named individuals, so staff turnover does not silently orphan an alert. Delivery via in-app and email; SMS optional per tenant.
- **Open-ish, decide explicitly:** if no Person currently holds the responsible role for a basin, the alert must escalate straight to the supervisor tier rather than vanishing.
- The dashboard shows, per basin, last tested timestamp, the interval, and whether it is within it — colour-coded, with the state also stated as text and the timestamp always visible (colour never alone).
- Alert history is retained as part of the compliance record: fired_at, basin, parameter, tier, recipients, acknowledged_by, acknowledged_at. Retention is indefinite unless a tenant retention policy says otherwise; it is not pruned with operational logs.
- Acknowledging an alert does not satisfy the interval — only a reading does. An acknowledged alert stops the notification; the basin stays out of interval until tested.

### Dev — implementation notes

- Migration: `basin_test_interval` (tenant, basin, parameter_or_group, interval, grace_period, responsible_role, supervisor_role, enabled), `maintenance_alert` history. Tenant key on all; index on (tenant_id, basin_id, parameter, reading_ts desc) for the last-reading lookup.
- Evaluation is a scheduled per-tenant job, idempotent, that computes due-ness from the last reading timestamp rather than from a stored "next due" field that drifts when a reading is backdated.
- Suppression is one shared predicate — `isBasinAlertable(basin, instant)` — consulted by both the missing-reading job and the out-of-range path, so closure and drained handling cannot diverge between them.
- Closure dates come from POOLSE-31 and are evaluated in the tenant's timezone. A closure defined as a date range must suppress the whole of each local day, not a UTC window offset by an hour.
- API: interval configuration is Owner/Admin only, enforced server-side; the dashboard is readable by Owner, Admin and Maintenance; Student, EE and Instructor get `403` on both. Acknowledgement is available to the responsible and supervisor roles.
- Notification fan-out resolves role → Persons at send time, deduplicating a Person who holds both tiers (POOLSE-17 union of roles) so one human does not get the same alert twice.
- i18n and theming: parameter names, alert copy and email templates in pt-PT and en; the dashboard's within-interval / overdue states need tokens checked in light and dark, plus a text label and the last-tested timestamp so colour is never the only signal.
- Most likely to be got wrong: restarting the interval clock from the entry time instead of the reading time, which makes a backdated reading look like a fresh one and silently hides a real gap.

### QA — test scenarios

26.1 Given a basin with a 4-hour pH interval and a reading at 08:00 / When 12:01 passes with no new reading / Then a missing-reading alert fires to the responsible role.
26.2 Given that alert and a grace period of 2 hours / When the reading is still absent at 14:01 / Then the supervisor is notified and the first-tier alert is not re-sent.
26.3 Given a reading taken at 08:00 but entered at 11:00 / When due-ness is evaluated / Then the clock runs from 08:00 and the alert fires at 12:00, not 15:00.
26.4 Given a closure covering today (POOLSE-31) / When the interval elapses / Then no alert fires for that basin.
26.5 Given a basin marked drained / When intervals elapse nightly for a week / Then no alert is sent on any night.
26.6 Given out-of-range alerting disabled and missing-reading alerting enabled / When a reading is skipped / Then the missing-reading alert still fires; and the reverse configuration behaves symmetrically.
26.7 Given an Instructor token / When it PATCHes a basin's testing interval / Then `403` and the configuration is unchanged.
26.8 Given a Student token / When it requests the maintenance dashboard / Then `403`.
26.9 Given a Person holding both the responsible and the supervisor role / When both tiers fire / Then they receive the alert once per tier at most, with no duplicate delivery within a tier.
26.10 Given no Person holds the responsible role for a basin / When the interval elapses / Then the alert escalates to the supervisor tier rather than being dropped.
26.11 Given an alert is acknowledged but no reading is entered / When the dashboard renders / Then the basin still shows as out of interval, and the acknowledgement is recorded in the alert history.
26.12 Given the pt-PT and en locales in light and dark mode / When the dashboard renders within-interval and overdue basins / Then both states are readable by text and timestamp alone, and contrast passes in both themes.

### Acceptance criteria

1. Each basin has a configurable testing interval (per parameter or per parameter group).
2. When an interval elapses with no reading, an alert fires — separate from, and independently configurable to, out-of-range alerting.
3. Two-tier escalation: the responsible staff member first, the supervisor if it remains unlogged after a configurable grace period.
4. Alerts reach the right people by their role (POOLSE-01 roles), via in-app and email; SMS optional.
5. A dashboard shows, per basin, when it was last tested and whether it is within interval — colour-coded.
6. Alerts respect closed dates and out-of-season basins; a pool that is drained does not page anyone nightly.
7. The alert history is retained as part of the compliance record.

---

## POOLSE-27 · Certification expiry with amber window

**Type:** Feature · **Area:** People / Staff · **Priority:** Medium
**Borrowed from:** OpsPal — green / amber / red staff qualification tracking with a 90-day amber window.

### PO — why this exists

A lapsed lifeguard certificate is not an administrative detail; without a valid one the pool cannot open. Tracking qualifications as a status alone tells you the day it is too late. An amber window turns it into something the office can act on with three months' notice. Owners and Admins benefit, and the staff member gets warned about their own certificate. Medium priority, shipping with the People work.

**Not in scope:** booking or paying for renewal courses; a national qualification registry integration; blocking pool opening — this ticket flags, it does not enforce operations.

### BA — rules and data

- A qualification is a record on a **Person** (POOLSE-17), not on a role assignment: type, issuing body, issue date, expiry date, document upload. One Person may hold several, including two of the same type across renewals.
- Status is **derived, never stored**: verde (expiry > today + window), âmbar (today ≤ expiry ≤ today + window), vermelho (expiry < today). Same reasoning as POOLSE-33's brackets — a stored status ages wrong.
- The amber window is configurable, default 90 days, per tenant. **Open-adjacent, decide explicitly:** whether it is also overridable per qualification type — a first-aid certificate and a lifeguard licence have different renewal lead times. Implement per tenant with an optional per-type override.
- A qualification with no expiry date (some are lifetime) is always verde and never notifies. Do not treat a null expiry as expired.
- Renewal: adding a new record of the same type with a later expiry supersedes the old one for status purposes; the old record is retained for history, not deleted. The Person's status for that type is the latest expiry.
- Document uploads use the same private-storage handling as POOLSE-11: no public URLs, short-lived signed links, and every view or download audit-logged.
- Optional per-qualification rule: an instructor whose required qualification is vermelho cannot be **assigned to new turmas**; existing assignments are flagged, not severed. Removing an instructor mid-época from a class of children is worse than flagging it.
- That assignment block interacts with POOLSE-19: a transfer proposal must not rank a turma whose instructor is blocked — or if it does, the confirmation must surface the flag rather than fail opaquely.
- Notifications fire at the amber threshold (once, on crossing) and again on expiry, to the Person and to Owner/Admin. Crossing is evaluated daily; a window change that puts someone newly into amber notifies them on the next evaluation.
- Qualification types are tenant-configurable — the list differs by country and by role. Types are tenant data, so type names are never translated; only the status words and UI chrome are.

### Dev — implementation notes

- Migration: `qualification_type` (tenant-configurable, with optional per-type amber window), `qualification` (tenant, person, type, issuing_body, issue_date, expiry_date, document_ref), tenant amber-window setting. Tenant key on all; index on (tenant_id, expiry_date) for the amber/red report.
- Status derivation lives in one shared function taking (expiry, today, window) and is used by the report, the Person page, the assignment check and the notification job. Never compute it inline in a query in one place and in TypeScript in another.
- The daily evaluation job is idempotent and records which notifications it has already sent per (qualification, threshold), so a re-run does not re-notify.
- API: `GET /qualifications/expiring?status=amber,red` sorted by expiry, paginated at 15 (POOLSE-29). Write access is Owner/Admin; a Person may read their own qualifications. Instructor reading another Person's qualification documents gets `403`.
- The assignment block is enforced on the turma-assignment endpoint server-side, and its result is exposed to POOLSE-19's proposal ranking through the same helper rather than duplicated.
- Document access: signed links only, generated per request with a short expiry, and every access written to the audit log with actor, person, timestamp — identical handling to POOLSE-11, ideally the same storage service call.
- i18n and theming: verde/âmbar/vermelho are status keys with pt-PT and en labels; the status text and the expiry date are always rendered beside the colour token. Tokens checked in light and dark, and kept clear of the attendance palette (POOLSE-13) so âmbar does not read as *falta justificada*.
- Most likely to be got wrong: computing amber against a stored status or a cached "days remaining" value, so the dashboard is correct on the day it renders and quietly wrong a week later.

### QA — test scenarios

27.1 Given a qualification expiring in 200 days and a 90-day window / When the report renders / Then the status is verde and it is absent from the amber/red list.
27.2 Given a qualification expiring in exactly 90 days / When status is derived / Then it is âmbar, and at 91 days it is verde — the boundary is inclusive at the window edge.
27.3 Given a qualification expiring yesterday / When status is derived / Then it is vermelho, and the person appears at the top of the report sorted by expiry.
27.4 Given a qualification with no expiry date / When status is derived / Then it is verde and no notification is ever sent for it.
27.5 Given an instructor with a vermelho required qualification / When an Owner assigns them to a new turma via the API / Then the request is rejected, and their existing turma assignments remain in place but flagged.
27.6 Given that same instructor / When POOLSE-19 ranks candidate turmas / Then their turma is either excluded or the block is surfaced at confirmation, never failing silently.
27.7 Given an Instructor token / When it requests another Person's qualification document / Then `403`.
27.8 Given an Owner downloads a qualification document / When the download completes / Then the access is audit-logged with actor, person and timestamp, and the link expires shortly afterwards.
27.9 Given a renewal added with a later expiry / When the Person page renders / Then the status reflects the new expiry, the old record is still listed in history, and nothing was deleted.
27.10 Given the amber window is changed from 90 to 120 days / When the daily job next runs / Then people newly inside the window are notified once, and people already notified are not notified again.
27.11 Given the daily job runs twice on the same day / When notifications are evaluated / Then no duplicate notification is sent.
27.12 Given the pt-PT and en locales in light and dark mode / When verde, âmbar and vermelho appear together / Then each carries its status text and expiry date, contrast passes in both themes, and âmbar is not confusable with the attendance orange.

### Acceptance criteria

1. Qualifications are records on a Person: type, issuing body, issue date, expiry date, document upload (stored privately, same handling as POOLSE-11).
2. Status is derived and colour-coded: **verde** (current), **âmbar** (expires within a configurable window, default 90 days), **vermelho** (expired).
3. Colour never carries the meaning alone — status text and the expiry date are always shown.
4. A dashboard/report lists everyone in amber or red, sorted by expiry date.
5. Notifications at the amber threshold and again on expiry, to the person and to Owner/Admin.
6. Optional per-qualification rule: an instructor with an expired required qualification cannot be assigned to new turmas, and existing assignments are flagged.
7. Qualification types are tenant-configurable — the list differs by country and by role.

---

## POOLSE-28 · Heating cost per lesson hour

**Type:** Feature · **Area:** Energy / Dashboards · **Priority:** Medium — the strongest argument for the four-module product
**Borrowed from:** nobody. Every product that tracks pool energy reports kWh and euros; none normalises against a pool-specific denominator, because none of them holds the class schedule.

### PO — why this exists

Every energy product tells a pool it used 14,000 kWh last month. None tells it that a Tuesday 07:00 turma with four bathers costs €38 an hour to heat while the Saturday morning turma costs €4 per bather. That second number decides which classes are worth running, and only Poolse can compute it because only Poolse holds both the meter and the schedule. Owners and Admins benefit; it is the demo moment for the whole product. Medium priority, shipping with the energy module.

**Not in scope:** recommending which turmas to cancel; forecasting; automated tariff imports from the utility; hardware or meter installation.

### BA — rules and data

- Three normalisations are required, all derived from the same joined dataset: **per turma hour** (cost ÷ scheduled turma hours in the window), **per bather** (cost ÷ recorded attendances), **per m³ of basin** (cost ÷ basin volume).
- The per-bather denominator uses **recorded attendance**, which includes reposição guests (POOLSE-21 AC 8) — they were in the water and heated by the same energy. This is a deliberate divergence from the enrolled-student count; state it on the report so the two figures are not mistaken for each other.
- Occurrences cancelled by a closure (POOLSE-31) contribute zero turma hours and zero bathers, but the basin may still have consumed energy. The report must not divide by zero or silently drop that consumption; it is attributed to the period as unallocated.
- Basin physical data required: volume in m³, surface area, and whether it is heated. A basin without volume cannot produce the per-m³ figure and must say so rather than showing a blank.
- **Tariff periods** (tarifa bi-horária / tri-horária) map time-of-day bands to a price per kWh, with effective-from dates. Cost is computed by allocating each consumption interval to its band; a naive average price produces a wrong number for early-morning classes, which is exactly the case the report exists for.
- Tariff bands shift with Portuguese summer/winter time changes and with the legal schedule. Model bands with effective date ranges and evaluate in the tenant's local time, not UTC.
- Figures are reported per basin, per turma, per instructor slot and per period, and must be comparable across periods — the same denominator definition in every period, or a comparison is meaningless.
- Where sub-metering does not isolate heating, the report states the derivation and names the meters it used. It must not present a derived figure with the same visual confidence as a measured one.
- Weather data is retained alongside consumption so a cold week is explicable. It is context, not a correction — no weather normalisation is applied to the headline figures.
- A turma's detail view shows its own energy cost beside its occupancy.
- **Open:** is sub-metering of the heating circuit realistic at the pilot pool, or does v1 derive heating from the main meter? This determines whether AC 5's "where sub-metering exists" branch is the primary path or the fallback, and whether the pilot's headline number is measured or estimated.

### Dev — implementation notes

- Storage: meter readings are a TimescaleDB hypertable partitioned on time, keyed (tenant_id, meter_id, ts). Every query is tenant-scoped, like every other table.
- Do not join raw readings to schedule occurrences at query time. Build **continuous aggregates** at a fixed bucket (15 minutes is the natural grain for tariff bands and lesson slots) carrying kWh and, where the tariff is resolvable at rollup time, cost. The dashboards read the aggregate, never the raw hypertable.
- The occurrence side must also be pre-shaped: a materialised table of (tenant, occurrence, basin, start, end, turma, instructor, attendance_count) refreshed as attendance is recorded. Joining the aggregate to a live view that itself joins enrolments, closures and attendance is where this report becomes unusable.
- The join is a **time-range overlap**, not an equality — a 15-minute bucket can straddle two occurrences. Allocate proportionally by overlap duration and be explicit about it, or the numbers will not sum to the period total.
- Tariff resolution is a shared function (band lookup by local timestamp and effective date range) used by the rollup and by any ad-hoc query. Two implementations will disagree on the DST boundary day.
- API: one reporting endpoint taking (scope, entity id, period, normalisation) and returning figures plus a provenance block naming the meters and whether heating was measured or derived. The provenance block is not optional — AC 5 depends on it.
- Permissions server-side: energy reporting is Owner/Admin. The turma detail view's cost panel is the same check — an Instructor viewing their own turma gets the occupancy but `403` on the cost endpoint unless the tenant decides otherwise, and that decision is enforced on the endpoint.
- i18n and theming: kWh, m³, currency and dates format by locale; per-bather and per-m³ labels are pt-PT and en keys. Charts must not carry meaning by colour alone — series need labels or patterns, and the tokens must be legible in light and dark against a chart background.
- Most likely to be got wrong: the DST changeover day. Twenty-three- and twenty-five-hour days break both the tariff band allocation and the per-hour denominator, and the error is small enough to look plausible.

### QA — test scenarios

28.1 Given a basin with meter data and a scheduled turma / When the per-turma-hour figure is requested / Then it equals the allocated cost divided by scheduled turma hours in the window, to the stated rounding.
28.2 Given a turma with 8 enrolled students, 6 present and 1 reposição guest / When the per-bather figure is computed / Then the denominator is 7 recorded attendances, and the report states that guests are included.
28.3 Given an occurrence cancelled by a closure (POOLSE-31) / When the period report runs / Then it contributes zero turma hours and zero bathers, the consumption is shown as unallocated, and no division by zero occurs.
28.4 Given a basin with no volume recorded / When the per-m³ figure is requested / Then the report says the figure is unavailable and why, rather than rendering blank or zero.
28.5 Given a tarifa bi-horária with a band change at 08:00 / When a 07:00–08:30 turma is costed / Then the two halves are priced at their respective band rates, not at an average.
28.6 Given the March DST change / When a 24-hour period report runs on that day / Then band allocation and the per-hour denominator use the 23-hour local day and the total reconciles with the metered kWh.
28.7 Given the October DST change / When the same report runs / Then the repeated local hour is counted once in the denominator and its consumption is not double-attributed.
28.8 Given a 15-minute bucket straddling the end of one turma and the start of the next / When consumption is allocated / Then it is split proportionally and the two turmas' figures sum to the bucket total.
28.9 Given a pool with no heating sub-meter / When the heating figure is shown / Then the provenance block names the meters used and states that the figure is derived, and the UI does not present it as measured.
28.10 Given an Instructor token / When it requests the energy cost endpoint for its own turma / Then the decided permission rule is enforced server-side, and a Student or EE token receives `403`.
28.11 Given a year of readings for a busy tenant / When the per-basin period report is requested / Then it is served from the continuous aggregate within the dashboard's performance budget, with no scan of the raw hypertable.
28.12 Given the pt-PT and en locales in light and dark mode / When the turma detail cost panel and the comparison chart render / Then units, currency and dates are localised, series are distinguishable without colour, and contrast passes in both themes.

### Acceptance criteria

1. Join the energy time-series to the class schedule and the basin's physical data.
2. Report cost and consumption normalised three ways: **per turma hour**, **per bather** (using attendance), and **per m³ of basin**.
3. Figures are available per basin, per turma, per instructor slot and per period, and are comparable across periods.
4. Tariff periods (tarifa bi-horária / tri-horária) are modelled so cost, not just kWh, is correct.
5. Heating is separable from other consumption where sub-metering exists; where it does not, the report says which meters it is derived from rather than implying precision it lacks.
6. A turma's detail view shows its own energy cost alongside its occupancy — the two numbers that decide whether a class is worth running.
7. Weather data is retained alongside consumption so cold-week spikes are explicable rather than alarming.

**Note:** this is the number no competitor can compute, because none of them holds both the meter reading and the lesson schedule. Worth treating as the demo moment for the whole product.

---

# Batch 3 — POOLSE-29 to 36 (UI, navigation, Encerramentos)

## POOLSE-29 · Paginate lists at 15 per page

**Type:** Improvement · **Area:** Global · **Priority:** Medium

### PO — why this exists

Lists today render whatever the API returns, so a tenant with 200 alunos gets a 200-row page that is slow to paint and impossible to scan. Every role feels this — instructors scrolling a roster, admins working through Pessoas — and it gets worse for exactly the tenants we most want to keep. It sits at Medium rather than High because nothing is broken or wrong, only unbounded; but it is cheap now and expensive once each list has grown its own bespoke fetch.

**Not in scope:** a user-configurable page size, infinite scroll, virtualised tables, or cursor/keyset pagination — 15 is fixed, offset-based, and one shared component.

### BA — rules and data

- Default page size is 15 on every list surface in the app, without exception; there is no per-list override and no user setting.
- The API contract for every list endpoint gains `page` (1-based) and `limit`, and every list response returns `items`, `total`, `page`, `limit`. `total` is the count after filters and search, before pagination.
- Sorting and filtering are applied server-side across the whole result set; the page is a window onto the sorted, filtered set, never a client-side slice.
- Any change to a filter value, search term or sort key resets `page` to 1. A change to page alone leaves filters and sort untouched.
- The pagination control is suppressed entirely when `total <= limit` — one page means no control, not a disabled control.
- The range label reads "16–30 de 214" / "16–30 of 214"; the upper bound is `min(page × limit, total)`, so the last page reads "211–214 de 214".
- Current page lives in the URL query string, so a page is linkable and survives refresh and browser back. Page 1 may be represented by the absence of the param; the same convention applies everywhere.
- Edge cases with decided answers: `total = 0` renders the list's empty state and no control; a requested page beyond the last page returns an empty items array with the true `total` (the client then redirects to the last valid page rather than showing a blank list); `page < 1` or a non-numeric page is coerced to 1; deleting the last row on the last page leaves the user on a now-empty page and must fall back to the previous page.
- **Open:** whether the twelve-month Encerramentos calendar (POOLSE-31), the Férias calendar and the turma hover card (POOLSE-15) count as "lists" under AC 1. They render bounded sets that cannot be paginated meaningfully — a written exemption list is needed rather than a case-by-case judgement.
- Conflicts to resolve: POOLSE-15 AC 2 requires the hover card to show the **full** student list "with no truncation", which reads against "no list renders unbounded". POOLSE-08's "+X more after 8 names" is a display collapse, not pagination, and must not be reimplemented as a page.

### Dev — implementation notes

- No schema change. Migration impact is limited to indexes: every list's default sort column plus its tenant key needs a composite index, or `OFFSET` scans degrade as tenants grow.
- Add a shared `PaginationQueryDto` (page, limit with a server-enforced max) and a `Paginated<T>` response envelope in the NestJS API; every list controller adopts both. Reject `limit` above the cap rather than honouring it — this is the endpoint that gets used to dump a tenant's data.
- `COUNT(*)` on every request doubles the query load. Run count and page in one round trip (window function `count(*) OVER ()` on the same filtered query) so the filter predicate cannot drift between the two.
- Client side: one `usePagination` hook that owns the URL query param plus one shadcn/ui `<Pagination>` component. Page size is a single exported constant so 15 → 20 is a one-line change.
- Permission enforcement stays where it already is — the tenant scope and role filter are part of the same query, applied **before** limit/offset. Never paginate a set and then filter it, or page 2 will silently hold fewer rows than page 1.
- i18n: the range label and total need a plural- and number-formatted key per locale ("16–30 de 214" vs "16–30 of 214"); do not concatenate. Page numerals use locale number formatting.
- Theming: the control is shadcn/ui tokens only, no hardcoded greys; the current-page indicator must be distinguishable in dark mode without relying on a background tint alone (add a border or weight change).
- Most likely to be got wrong: resetting the page on filter change. Set the filter and the page in one URL update, otherwise the client fires a request for page 7 of the new filter, gets an empty set, and flashes an empty state before correcting itself.

### QA — test scenarios

Global change — coverage is sampled, not enumerated. Pick a representative list per shape: a plain list (Pessoas), a filtered + searched list (Alunos), a nested list inside a detail page (enrolments on a turma), a list behind a role restriction (audit log), and one list that also carries a sort control. Verify AC 1 across the rest by a static sweep — grep for every list endpoint and assert each one declares the pagination DTO, plus a route-level test that no list response exceeds `limit`.

- **29.1** Given a tenant with 214 alunos / When the list loads / Then 15 rows render and the label reads "1–15 de 214".
- **29.2** Given page 2 / When the user clicks "last" / Then page 15 loads showing rows 211–214 and next/last are disabled.
- **29.3** Given a list of 12 items / When it loads / Then no pagination control is rendered at all.
- **29.4** Given the user is on page 7 / When they type into the search box / Then the request is for page 1 and the URL shows page 1 — no intermediate empty-state flash.
- **29.5** Given a URL with `?page=4` / When it is opened in a fresh tab / Then page 4 renders directly, and browser back returns to the previous page.
- **29.6** Given `?page=999` on a 15-page list / When it loads / Then the client lands on the last valid page rather than rendering blank.
- **29.7** Given `?page=abc` or `?page=-3` / When it loads / Then page 1 renders and nothing throws.
- **29.8** Given an Instructor calling a list endpoint directly with `limit=10000` / When the request is made / Then the API rejects or clamps it — the response never exceeds the server cap, regardless of UI.
- **29.9** Given a sort by name descending across 214 rows / When page 2 is requested / Then rows 16–30 of the **whole** sorted set are returned, not the second 15 of an unsorted page.
- **29.10** Given locale pt-PT and then en / When the control renders / Then the range label reads "16–30 de 214" and "16–30 of 214" respectively, with locale number formatting and no concatenated fragments.
- **29.11** Given light and dark mode / When the control renders / Then the current page, disabled arrows and hover state are all distinguishable, contrast-checked, with the active page marked by more than a background tint.
- **29.12** Given the user is on the last page holding exactly one row / When that row is archived / Then the list falls back to the previous page rather than showing an empty page with a control that says page 15 of 14.
- **29.13** Given a second admin adds a record while the user sits on page 2 / When the user clicks next / Then no row is skipped or duplicated by more than the known offset drift, and the total updates — document the accepted behaviour rather than leaving it undefined.

### Acceptance criteria

1. Default page size is **15** on every list, everywhere — no list renders unbounded.
2. Pagination control shows current page, total pages and total result count ("16–30 de 214").
3. First/previous/next/last controls; the control is hidden entirely when there is only one page.
4. Pagination is **server-side** — the API takes page/limit and returns the total; the client never fetches everything and slices it.
5. Page resets to 1 whenever a filter, search term or sort changes.
6. Current page is reflected in the URL so a page can be linked and survives a browser refresh.
7. Sorting and filtering apply across the whole result set, not just the visible page.
8. One shared pagination component, so page size becomes a one-line change if 15 turns out to be wrong.

---

## POOLSE-30 · Search filters as you type

**Type:** Improvement · **Area:** Global · **Priority:** Medium
**Depends on:** POOLSE-29 (search resets pagination to page 1)

### PO — why this exists

Search today needs a button press, so staff type a name, see nothing happen, and press Enter or click before the list responds — a dead half-second on the most-used control in the backoffice. Instructors looking up one student poolside on a tablet feel it most. Medium priority because the current behaviour works; it is simply slower than the product should feel, and the fix is one shared component rather than a per-page rewrite.

**Not in scope:** fuzzy or typo-tolerant matching, search ranking, cross-entity global search, and search-term history or suggestions.

### BA — rules and data

- Search fires on input change after a debounce of ~300 ms. Not per keystroke, not on Enter only. Enter bypasses the debounce and fires immediately.
- The "Pesquisar"/"Search" button is removed from every search box in the app; no surface keeps a submit affordance.
- A clear (×) control appears once the box is non-empty, empties the term, and restores the unfiltered list immediately with no debounce wait.
- Matching is case-insensitive **and** accent-insensitive in both directions: "jose" matches "José", "José" matches "jose", "maria" matches "MARIA". Substring match, anywhere in the field — typing a surname finds the person (POOLSE-32 AC 6).
- Responses are applied only if they correspond to the current term. A late response for an earlier term is discarded, never rendered, and never used to update the total count.
- While a request is in flight a subtle loading indicator shows, and the previously rendered results stay on screen. Results must not flicker to empty and back.
- Every search change resets pagination to page 1 (POOLSE-29 AC 5) and the search term lives in the URL alongside the page, so a searched view is linkable.
- Empty results show the term used verbatim ("Sem resultados para «josé»" / "No results for 'josé'") plus a clear affordance, distinct from the list's own "nothing here yet" empty state.
- Edge cases with decided answers: clearing the box while a request for the old term is in flight discards that response; a term of only whitespace is treated as empty; leading/trailing whitespace is trimmed before comparison but preserved in the input.
- **Open:** whether search is scoped per list (each list searches only its own fields) and what field set each list searches — the doc names accent- and case-insensitivity but never the searchable columns. Needs a decided per-entity field list before build.
- **Open:** minimum term length before a request fires. One character on a large tenant is an expensive full-table scan; the doc does not set a floor.

### Dev — implementation notes

- One `useDebouncedSearch` hook plus one shared `<SearchInput>`; per-page debounce implementations are how the 300 ms drifts to 250 in one place and 500 in another.
- Race control belongs in the request layer, not the component: tag each request with a monotonically increasing sequence number (or an `AbortController` per keystroke) and drop any response whose tag is not the latest. Aborting alone is not enough — an already-inflight response can still resolve after abort in some transports.
- Accent-insensitivity is a database concern, not a JS one. Use PostgreSQL `unaccent()` on both sides plus a case-insensitive comparison, backed by a functional index on `unaccent(lower(col))` — otherwise every keystroke is a sequential scan. `ILIKE '%term%'` cannot use a b-tree prefix index; consider `pg_trgm` with a GIN index for substring search at tenant scale.
- Search predicate is applied inside the same tenant-scoped query as the list filter and the pagination window — search must never widen the tenant scope, and must be applied before `LIMIT`.
- Permission enforcement point: the searched set is the set the caller may already see. A search on Pessoas by an Instructor returns only what the Pessoas list would return for that Instructor (POOLSE-35 AC 7) — verify at the API, not by hiding the box.
- i18n: placeholder, clear-button `aria-label`, loading announcement and the no-results message with the interpolated term all need keys; the term is interpolated, never concatenated, and must be escaped for display.
- Theming and a11y: the loading indicator must be visible in both modes and must not be the only signal — use `aria-busy` and an `aria-live="polite"` region announcing the result count, so the state is not conveyed by a spinner's colour alone.
- Most likely to be got wrong: the interaction between debounce and Enter. Pressing Enter must cancel the pending debounced call, not fire a second identical request alongside it — and the immediate request still participates in the sequence-number ordering.
- Performance: debounce reduces requests but does not bound them. Coalesce identical in-flight terms and keep a short-lived client cache keyed by term + page so backspacing one character does not re-hit the API.

### QA — test scenarios

Global change — coverage is sampled. Take one search box per shape: a large list (Alunos), a small list (Níveis), a list with an active filter alongside search, one behind a role scope (Pessoas), and one on a nested detail page. Then a static sweep asserting no "Pesquisar"/"Search" submit button remains anywhere and that every search box resolves to the shared component. Race and debounce scenarios below are run with an artificially throttled/staggered API, not against a fast local one — they cannot be observed otherwise.

- **30.1** Given an empty search box / When "maria" is typed at normal speed / Then exactly one request fires, ~300 ms after the last keystroke, and the list filters to matches.
- **30.2** Given the user types "mar" then immediately presses Enter / When the key is pressed / Then the search fires at once and the pending debounced call is cancelled — one request, not two.
- **30.3** Given the response for "ma" is delayed 2 s and the response for "maria" returns in 100 ms / When both resolve / Then the list shows results for "maria" and the late "ma" response is discarded, including its total count.
- **30.4** Given a search is in flight / When the user clears the box with × / Then the full list is restored immediately and the in-flight response never renders.
- **30.5** Given results are on screen / When a new term is typed / Then the old results remain visible with a loading indicator and never flash to an empty list in between.
- **30.6** Given a student named "José Faría" / When "jose faria" is typed unaccented and lowercase / Then the student is found; and given "JOSÉ" is typed / Then the same student is found.
- **30.7** Given the user is on page 4 of Alunos / When a search term is entered / Then the request is for page 1 and the URL reflects both the term and page 1.
- **30.8** Given a term with no matches / When the search settles / Then a message naming the term verbatim is shown with a clear affordance, distinct from the list's "no records yet" state — in pt-PT and in en.
- **30.9** Given an Instructor calling the Pessoas search endpoint directly with a student's name / When the request is made / Then no student or encarregado de educação is returned, regardless of what the UI would render.
- **30.10** Given light and dark mode / When a search is in flight and when it returns empty / Then the loading indicator, clear control and empty-state message are all legible and contrast-compliant in both.
- **30.11** Given a user types "maria", backspaces to "mar", then retypes "maria" within the debounce window / When it settles / Then one final render for "maria" occurs and no stale intermediate result is ever displayed.
- **30.12** Given a term containing `%`, `_`, a quote or an emoji / When it is searched / Then it is treated as a literal string, returns cleanly, and is echoed safely in the no-results message.
- **30.13** Given a screen reader / When results update after typing / Then the new result count is announced once via the live region, not once per keystroke.

### Acceptance criteria

1. Typing filters the list after a **debounce of ~300 ms** — not on every keystroke, not on Enter only.
2. The "Search"/"Pesquisar" button is removed from every search box in the app.
3. Enter still submits immediately, for people who type and hit Enter out of habit.
4. A clear (×) control empties the box and restores the full list.
5. A subtle loading indicator shows while a search is in flight; results never flicker between old and new sets.
6. Out-of-order responses are discarded — a slow response for "ma" must never overwrite results for "maria".
7. Search is case- and accent-insensitive: "jose" matches "José", "maria" matches "MARIA".
8. Empty results show a clear message with the term used, and a way to clear it.
9. Search resets pagination to page 1 (POOLSE-29).

---

## POOLSE-31 · Encerramentos page

**Type:** Feature · **Area:** Settings / Calendar · **Priority:** High
**Depends on:** POOLSE-13 (attendance states, for what a cancelled occurrence is *not*), POOLSE-14 (removal history must stay distinguishable), POOLSE-21 (credit minting — closures explicitly mint none)

### PO — why this exists

Encerramentos is where a school records that the pool is shut — Christmas, annual maintenance, a municipal feriado — and today it does not resemble the Férias page staff already know, so closures get entered wrongly or not at all. When a closure is missing, classes stay on the calendar, instructors are marked absent-by-omission and families are charged for a lesson that never happened. Owners and Admins do this work a handful of times a year, but each mistake costs a round of phone calls. High priority: it is the correctness backbone for the whole calendar.

**Not in scope:** compensating families for a long closure (an explicit action, never a side effect of a closure), partial-day or per-basin closures, and recurring closures that repeat automatically year on year.

### BA — rules and data

- The page renders a 4×3 grid of the twelve months of a selected year, using the Férias page's layout and visual language. The year is switchable and defaults to the current year.
- Two distinct day markers exist and must never be conflated: **feriado** (greyed day, name on hover and on focus) and **encerramento** (a named band spanning its days, visually distinct from a feriado). A day may carry both.
- The feriado set = Portuguese national holidays, plus tenant-configurable municipal holidays layered on top. Municipal holidays are tenant data and carry the same name-on-hover treatment.
- A closure is a record with: tenant key, start date, end date (inclusive), name/reason, created-by, timestamps. A single-day closure is start = end, produced by clicking the same day twice.
- Range selection is Booking.com style: first click sets the anchor, hover previews the range, second click confirms. A reversed selection (second click before the anchor) is normalised, not rejected.
- Closures may not overlap. On an attempted overlap the save is refused with a message naming the existing closure. Adjacency (one ends the day before the next begins) is allowed and stays two records.
- **Effect on classes:** every class occurrence inside a closure is cancelled — removed from the calendar, no attendance taken, **no charge, and no reposição credit minted** (POOLSE-21). This is a deliberate decision, not an oversight.
- Cancelled-by-closure occurrences must be distinguishable in history from POOLSE-14 removals and from *faltas* — three separate reasons, stored as a reason code, not inferred.
- Creating a closure over dates that already carry recorded attendance warns before saving and lists the affected turmas and dates. **Open:** what happens to that already-recorded attendance on confirm — is it deleted, retained-but-flagged, or does the closure refuse to cover those days? The doc mandates the warning and stops there.
- **Open:** what happens to a closure when it is shortened or deleted — do previously cancelled occurrences reappear on the calendar, and with what attendance state? Extend/shorten/rename are all required (AC 6) but the reversal semantics are undecided.
- Create, edit and delete of a closure are restricted to Owner and Admin, and every one is audit-logged (actor, closure, dates, timestamp).
- Conflict to watch: POOLSE-21 AC 3 already excludes "closed dates and holidays" from reposição redemption targets — that rule and this ticket's AC 8 must read from the same closure/feriado source, or a credit will be bookable into a closed day.

### Dev — implementation notes

- Schema: a `closure` table (tenant key, start_date, end_date, name, created_by) with an exclusion constraint on the tenant + daterange to enforce non-overlap in the database rather than in application code — an application-level check races two concurrent admins. Plus a `municipal_holiday` table (tenant key, date, name) and a national-holiday source.
- Class occurrences need a cancellation reason column with distinct values for closure, POOLSE-14 removal and any future reason; do not overload a boolean `cancelled` flag, or AC 9 becomes unimplementable after the fact.
- Portuguese national holidays include movable feasts (Sexta-Feira Santa, Páscoa, Corpo de Deus, Carnaval where observed) computed from Easter. Compute them, do not hardcode a table per year — a full-year calendar that is switchable by year will be opened for 2031.
- **Dates are dates, not instants.** Store and compare closure bounds as `date` in Europe/Lisbon civil terms. Serialising a closure boundary through a UTC timestamp is how 1 January becomes 31 December for a client an hour behind; Portugal's DST transitions (late March, late October) will surface this in exactly the weeks a school schedules maintenance.
- API surface: `GET /closures?year=`, `POST /closures`, `PATCH /closures/:id`, `DELETE /closures/:id`, plus `GET /holidays?year=` returning the merged national + municipal set. Cancellation of occurrences is a server-side effect of the closure write, inside the same transaction, not a client loop.
- Permission enforcement: Owner/Admin checked at the endpoint for all four mutations, reusing the shared permission helper rather than a local `if`. The calendar read is available to anyone who can see the calendar.
- i18n: month and weekday names, holiday names (national names are Portuguese proper nouns — decide per name whether they are translated or kept), the range-preview and overlap messages, and the warning listing affected turmas. Date formatting via the locale, never concatenated.
- Theming: feriado grey, closure band and range-preview highlight all need tokens that work in both modes and stay clear of the attendance palette (POOLSE-13) and role palette (POOLSE-18). None of the three may be identified by colour alone — the closure band carries its name as text, the feriado exposes its name on hover **and focus**.
- Performance: rendering twelve months means ~365 day cells plus overlays. Compute the day → {feriado, closure} map once per year load, not per cell; do not issue a request per month.
- Most likely to be got wrong: the inclusive end date. Off-by-one at the closing boundary silently leaves the last day of the Christmas closure open, with classes still scheduled on it.

### QA — test scenarios

- **31.1** Given the Encerramentos page for 2026 / When it loads / Then twelve months render in a 4×3 grid matching the Férias page, with the year switcher on the current year.
- **31.2** Given 10 June 2026 / When the day is hovered and separately keyboard-focused / Then it renders greyed and reveals "Dia de Portugal" in both cases.
- **31.3** Given a tenant with a municipal feriado configured / When the calendar loads / Then that day is greyed with its own name, alongside the national set, and a second tenant without it does not see it.
- **31.4** Given an Owner selects 21 December then 3 January of the next year / When confirmed / Then the closure spans the year boundary, renders on both years' calendars, and the band is unbroken across 31 Dec–1 Jan.
- **31.5** Given a closure exists for 10–14 August / When a new closure is attempted for 12–20 August / Then the save is refused with a message naming the existing closure by name.
- **31.6** Given a closure covering a Tuesday with three scheduled turmas / When it is saved / Then those occurrences vanish from the calendar, no attendance can be recorded, no charge is raised, and **no** reposição credit is minted for any enrolled student.
- **31.7** Given a class cancelled by a closure and a class removed via POOLSE-14 on adjacent days / When history is inspected / Then the two carry different reason codes and are distinguishable in the UI, and neither reads as a *falta*.
- **31.8** Given dates that already have recorded attendance / When a closure is drawn over them / Then a warning lists the affected turmas and dates before saving is possible.
- **31.9** Given an Instructor calling `POST /closures` directly with a valid payload / When the request is made / Then it returns 403 and no closure is created — verified at the API, not by the hidden button.
- **31.10** Given a range selected by clicking the later day first / When the second click lands on the earlier day / Then the range is normalised rather than rejected, and saves with the correct start and end.
- **31.11** Given the last DST change of the year (late October) falls inside a closure / When the closure is saved and reloaded / Then the start and end dates are unchanged, and no day shifts by one in either direction.
- **31.12** Given 2028 (a leap year) / When February is rendered and a closure covering 28 Feb – 1 Mar is created / Then 29 February exists, is included, and the band spans three days.
- **31.13** Given locale pt-PT and then en / When the calendar, a closure band and the overlap message render / Then month names, holiday names and messages are localised with no concatenated date strings.
- **31.14** Given light and dark mode / When a day is both a feriado and inside a closure / Then both markers remain distinguishable from each other and from attendance colours, and each is identifiable without relying on colour.
- **31.15** Given two Admins saving overlapping closures at the same instant / When both requests land / Then exactly one succeeds and the other is refused by the database constraint, not by a partially applied write.

### Acceptance criteria

1. **4×3 grid of the twelve months** of the selected year, same layout and visual language as the Férias page. Year is switchable.
2. **Feriados** are greyed out on their days, with the holiday's name shown on hover (and on focus, for keyboard users) — e.g. "Dia de Portugal".
3. The holiday set is Portuguese national holidays, with tenant-configurable **municipal holidays** added on top.
4. **Closure periods are selected as a range**, Booking.com style: click the first day, hover previews the range, click the last day to confirm. Single-day closures are a click and a second click on the same day.
5. Each closure carries a name/reason (e.g. "Manutenção anual", "Encerramento de Natal") and is shown as a distinct band across the days it covers, visually different from feriados.
6. Existing closures can be edited (extend, shorten, rename) and removed.
7. Overlapping closures are prevented, with a clear message naming the closure already there.
8. **Effect on classes:** all classes falling inside a closure are **cancelled** — removed from the calendar, no attendance taken, **no charge, and no reposição credit minted**. The pool was closed; nobody was absent.
9. Cancelled-by-closure occurrences are distinguishable in history from classes removed by POOLSE-14, and from *faltas*.
10. Creating a closure over dates that already have recorded attendance warns before saving and lists what would be affected.
11. Create/edit/delete of a closure is restricted to Owner and Admin, and is audit-logged.

**Note:** point 8 is a deliberate decision — closures do not generate credits. If a school ever wants to compensate a long closure, that should be an explicit action, not a side effect.

---

## POOLSE-32 · Names read first name + surname

**Type:** Improvement · **Area:** Global · **Priority:** Medium
**Depends on:** POOLSE-17 (one Person record holding the name parts), POOLSE-30 (search must match any part of the name)

### PO — why this exists

"Silva, Maria" is filing-cabinet notation; nobody says it out loud, and staff reading a roster have to mentally re-order every row. Portuguese full names also run to five or six parts, so printing the whole thing in a turma card breaks the layout. Everyone reading a list benefits — instructors most, since they read rosters at the poolside on a small screen. Medium: it is a readability fix across the app, not a defect.

**Not in scope:** changing how names are captured or stored (the name-part fields themselves), nicknames or preferred names, and any transliteration or normalisation of stored name parts.

### BA — rules and data

- Three separate concerns, decided independently and never conflated: **display order** (first name before surname, everywhere), **list abbreviation** (first name + last surname only, in dense surfaces), and **sort order** (by surname).
- Display order: "Maria Silva". The "Apelido, Nome" form is removed from every surface, including sorted lists where it was previously used as a sorting cue.
- Abbreviation applies in lists, cards, turma rosters and the calendar: first given name + **last** surname. "Maria Joana Ferreira Silva Santos" renders "Maria Santos".
- Full legal name — every stored part in order — is used on the person's detail page and on every document, export, invoice and official output. No abbreviation ever reaches a document.
- Both forms are derived at render time from stored name parts. The abbreviated form is never persisted as its own editable field.
- Sorting is by surname (the sort key), while display is first-name-first. **Open:** which surname sorts — the last part, or the first surname after the given names? Portuguese convention often files under the paternal (final) surname, but the doc says only "by surname". Needs one decided rule, applied in one place.
- Search matches any part of the name (POOLSE-30), so a surname query finds the person even when the surname is not in the abbreviated display form.
- The rule applies uniformly to students, staff and encarregados de educação — one helper, one behaviour, no per-section variation.
- Boundary cases needing a decided answer: a single-part name ("Madonna") — display and abbreviation both return the one part, and it sorts as its own surname; a two-part name is already the abbreviated form; particles ("de", "da", "dos", "e") that belong to a compound surname must not be returned alone as the "last surname" — "Maria da Silva" must abbreviate to "Maria da Silva" or "Maria Silva", not "Maria da". **Open:** which of those two.
- Conflict to resolve: POOLSE-08 AC 5 says turma student names are "ordered alphabetically" without saying by what; under this ticket that must mean by surname, matching AC 5 here, or two lists of the same people will sort differently.

### Dev — implementation notes

- Schema: requires the Person name to exist as parts (given names, surnames), not a single `name` string. If the current model stores one string, this ticket needs a migration that splits it, with a report of rows it could not split confidently — that is the real cost of this ticket, not the rendering.
- One shared module exports three pure functions — `displayName(person)`, `shortName(person)`, `sortKey(person)` — used by web, API-side exports and any PDF/invoice generation. Per-page string juggling is how "Silva, Maria" survives in one forgotten export.
- Sorting must happen in the database, on a stored or generated sort key column with an index, not in JS — POOLSE-29 paginates server-side, so a client-side sort would only order the visible 15.
- Sorting must be locale-aware and diacritic-correct: use a Portuguese collation (`pt-PT` ICU collation) so "Álvares" files with "Alvares" rather than after "Zé". A `lower()` sort key alone is not enough.
- API surface: list endpoints return the name parts plus the precomputed short and full forms, so the client never re-derives them differently from the server. Exports and invoices call the same helper server-side.
- Permission enforcement is unchanged by this ticket. The one thing to verify is that the full legal name on a detail page is not exposed to a role that can only see the abbreviated list form — check the field set returned by each endpoint, not the rendered page.
- i18n and theming: name rendering must not be templated into a translated string with a fixed order — the helper returns the composed name and the i18n layer interpolates it as one token. Text length changes when abbreviation applies, so re-check truncation and ellipsis in narrow columns in both themes.
- Most likely to be got wrong: assuming the last whitespace-delimited token is the surname. Particles, hyphenated surnames and single-part names all break that assumption, and the failure is silent and embarrassing on a roster.

### QA — test scenarios

- **32.1** Given a student "Maria Joana Ferreira Silva Santos" / When the Alunos list renders / Then the row reads "Maria Santos" and never "Santos, Maria".
- **32.2** Given the same student / When her detail page opens / Then the full legal name "Maria Joana Ferreira Silva Santos" is shown in full.
- **32.3** Given the same student / When an invoice, an export and a PDF document are generated / Then all three carry the full legal name, not the abbreviation.
- **32.4** Given a list of students / When sorted by name / Then the order follows the surname while every row displays first name first — and the order is stable across pages 1 and 2 of POOLSE-29.
- **32.5** Given a person with a single-part name "Madonna" / When lists, cards and the detail page render / Then the one part is shown in all three and sorting places it under M without error.
- **32.6** Given "Maria da Silva" / When the abbreviated form is produced / Then the particle is not orphaned — the result is never "Maria da".
- **32.7** Given "Álvares" and "Alvares" and "Zé" / When the list is sorted / Then Portuguese collation places the accented and unaccented forms together, ahead of Z.
- **32.8** Given a search for "Ferreira", a middle surname absent from the displayed short name / When it is typed / Then "Maria Santos" is returned (POOLSE-30 AC 7 and this ticket's AC 6).
- **32.9** Given a member of staff and an encarregado de educação with long names / When Pessoas and the student's guardian block render / Then both follow the same abbreviation rule as students.
- **32.10** Given a caller requesting a list endpoint directly / When the response is inspected / Then no role receives a full legal name in a list payload it is not entitled to see on the detail page.
- **32.11** Given locale pt-PT and en / When a name renders in a list, a card and a heading / Then the name order is identical in both and no translated string encodes the order.
- **32.12** Given a very long compound name in the narrowest turma roster column, in light and in dark mode / When it renders / Then it truncates with an ellipsis and a title/tooltip rather than wrapping or overflowing, and stays contrast-compliant.
- **32.13** Given a hyphenated surname "Ana Costa-Ribeiro" / When the short name is derived / Then the hyphenated surname is kept whole, not split at the hyphen.

### Acceptance criteria

1. Names render as **first name + surname** — "Maria Silva", never "Silva, Maria".
2. In **lists, cards, turma rosters and the calendar**, the display name is the **first name plus the last surname** — Portuguese full names are long and would break every layout.
3. The **full legal name** is shown on the person's detail page, and used on every document, export, invoice and official output.
4. Both forms are derived from stored name parts; the abbreviated form is never stored as a separate editable field that can drift.
5. Sorting is by **surname** even though display is first-name-first — the order people read and the order they scan a list by are different things.
6. Search matches any part of the name (POOLSE-30), so typing a surname still finds the person.
7. Applies to students, staff and encarregados de educação alike.

---

## POOLSE-33 · Age-bracket icon on the avatar

**Type:** Improvement · **Area:** Students · **Priority:** Low
**Depends on:** POOLSE-06 and POOLSE-16 (shared age boundary logic), POOLSE-17 (date of birth on the Person)

### PO — why this exists

Scanning a turma roster, an instructor cannot tell a bebé from a jovem without opening each record, and a class that mixes brackets is a safety-relevant thing to notice at a glance. A small badge on the avatar gives that for free wherever a photo already appears. Low priority: it is a convenience over information already on screen elsewhere, and nothing is wrong today.

**Not in scope:** filtering or reporting by bracket, tenant-configurable bracket boundaries, and any use of the bracket in eligibility rules — eligibility stays on min/max age (POOLSE-06, POOLSE-16).

### BA — rules and data

- Five brackets derived from date of birth: **Bebé** 0–3, **Criança** 4–11, **Jovem** 12–17, **Adulto** 18–59, **Sénior** 60+. Boundaries are inclusive as written; a person aged exactly 4 is Criança, exactly 18 is Adulto, exactly 60 is Sénior.
- The bracket is computed from date of birth at render time and never stored, so a record cannot go stale as the person ages.
- Boundaries live in one shared definition, shared with the minimum/maximum-age logic of POOLSE-06 and POOLSE-16, so the two cannot drift.
- Each bracket has its own icon **and** colour token. The badge sits bottom-right on the circular avatar, with a ring or border so it stays legible over any photograph.
- The badge carries a tooltip and an `aria-label` naming the bracket in words. Colour and shape never carry the meaning alone.
- No date of birth means no badge at all — not an "unknown" badge, not a neutral placeholder.
- Below a defined minimum avatar size the badge is suppressed entirely rather than shrunk into illegibility. **Open:** the exact pixel threshold and which avatar sizes fall below it — the doc mandates the rule but names no number.
- POOLSE-06 stores minimum age in months to express ages under one year. The bracket scale is in whole years, so a 6-month-old and a 3-year-old share the Bébé badge; this is intended, not a gap.
- The palette must stay clear of the attendance colours (POOLSE-13) and the role colours (POOLSE-18), which already claim red, orange and the six role tokens.
- **Open:** whether the badge appears on staff and encarregado avatars too or only on students. The ticket's area is Students, but avatars are shared components used in Pessoas.

### Dev — implementation notes

- No schema change. Date of birth already exists on the Person (POOLSE-17); if any surface renders an avatar without fetching date of birth, that field must be added to its payload — otherwise the badge silently never appears there.
- Age computation must use civil dates in Europe/Lisbon, not a UTC timestamp difference. Someone born on 29 February needs a decided birthday rule in non-leap years (28 February is the conventional choice) so they do not age a day late.
- Put the bracket logic in the same shared age module as POOLSE-06/16 — a `brackets` constant plus `bracketFor(dateOfBirth, at = today)`. Passing the reference date in makes it testable and stops `new Date()` appearing inside a render.
- The badge belongs inside the shared `<Avatar>` component as an optional slot, so every existing avatar call site gains it without edits and the size-suppression rule is enforced in one place.
- Permission enforcement: date of birth is personal data. Any role that can see the avatar but not the date of birth must not receive a bracket — the bracket is a low-resolution disclosure of the DOB, so gate the field server-side rather than computing it client-side from data that should not have been sent.
- i18n: five bracket names plus the tooltip pattern, in pt-PT and en. The Portuguese names are the product vocabulary (Bebé, Criança, Jovem, Adulto, Sénior) and are the keys, not the strings.
- Theming: five colour tokens defined in both modes, checked against the avatar ring and against arbitrary photo backgrounds — the ring is what makes the badge survive a dark photo in light mode and vice versa.
- Performance: brackets are computed per avatar; on a 15-row roster with the shared component that is trivial, but memoise per person id rather than recomputing on every re-render of a hovering list.
- Most likely to be got wrong: the boundary arithmetic. "18–59" must be evaluated as completed years at today's date, not as a year subtraction — a person whose 18th birthday is tomorrow is still Jovem.

### QA — test scenarios

- **33.1** Given a student with date of birth making them 7 today / When their avatar renders / Then a Criança badge sits bottom-right on the circle, with a ring, over their photo.
- **33.2** Given students aged exactly 3, 4, 11, 12, 17, 18, 59 and 60 today / When each avatar renders / Then the brackets read Bebé, Criança, Criança, Jovem, Jovem, Adulto, Adulto, Sénior respectively.
- **33.3** Given a student whose 18th birthday is tomorrow / When the avatar renders / Then the badge reads Jovem, and given it is their birthday today / Then it reads Adulto.
- **33.4** Given a person with no date of birth / When the avatar renders / Then no badge appears at all — not a neutral or "unknown" badge.
- **33.5** Given the smallest avatar size used in a turma roster / When it renders / Then the badge is suppressed entirely rather than rendered illegibly; and at every larger size it renders correctly.
- **33.6** Given a keyboard user focusing the badge and a screen-reader user / When it is reached / Then the bracket name is announced in words via the `aria-label`, and hovering shows the same as a tooltip.
- **33.7** Given locale pt-PT and then en / When the tooltip renders / Then it reads "Sénior" and "Senior" from the i18n layer, with no hardcoded string.
- **33.8** Given light and dark mode, over a white photo and a black photo / When each of the five badges renders / Then all five remain distinguishable from each other, from the attendance colours and from the role colours, and the ring keeps the badge legible in every combination.
- **33.9** Given a student born on 29 February / When their avatar renders in a non-leap year on 28 February and again on 1 March / Then the computed age follows the decided rule consistently and never jumps twice.
- **33.10** Given the minimum-age setting on a level is 6 months (POOLSE-06) / When a 6-month-old student's avatar renders / Then the badge reads Bebé, and the bracket boundaries come from the same shared module as the level's age validation.
- **33.11** Given a role that may see a person's avatar but not their date of birth / When the list payload is inspected directly / Then it carries neither the date of birth nor a derived bracket.
- **33.12** Given a page rendering fifteen avatars (POOLSE-29) / When the list re-renders on hover or filter change / Then no visible recomputation flicker occurs and each badge is stable.

### Acceptance criteria

1. Five brackets, derived from date of birth: **Bebé** (0–3), **Criança** (4–11), **Jovem** (12–17), **Adulto** (18–59), **Sénior** (60+).
2. Each bracket has its own icon and colour token; the badge sits bottom-right on the avatar circle, with a ring/border so it stays legible over any photo.
3. The badge has a tooltip and an `aria-label` naming the bracket — never colour or shape alone.
4. Brackets are recomputed from date of birth, never stored, so nobody ages incorrectly in the database.
5. No date of birth → no badge (not a "unknown" badge).
6. Renders correctly at every avatar size used in the app, including the small size in turma rosters; below a minimum avatar size the badge is suppressed rather than shrunk into illegibility.
7. Bracket boundaries are defined in one place, shared with the minimum/maximum-age logic (POOLSE-06, POOLSE-16) so they cannot drift apart.

---

## POOLSE-34 · Move Férias under the People menu

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

---

## POOLSE-35 · Pessoas is staff only; Alunos holds the rest

**Type:** Feature · **Area:** Navigation / People · **Priority:** High
**Depends on:** POOLSE-17 (one Person, many roles), POOLSE-18 (role badges, amended for two sections)

### PO — why this exists

Pessoas today mixes staff, students and encarregados de educação into one list, so an Admin looking for an instructor wades through three hundred alunos. Splitting the two views matches how the school actually thinks — staff are one population, families are another — while keeping one underlying record so nobody's phone number lives in two places. High priority because POOLSE-18 and POOLSE-34 are both already written against this split.

**Not in scope:** merging or deduplicating existing duplicate records (POOLSE-17 AC 10 owns the migration), and any change to the guardian-link model itself (POOLSE-04).

### BA — rules and data

- Pessoas and Alunos are two **filtered views over the same Person model** (POOLSE-17). No new record type, no duplicated record, no copy of contact data.
- Pessoas lists Persons holding at least one of Owner, Admin, Instructor, Maintenance. Alunos lists Persons holding Student or Encarregado de Educação.
- A Person holding both a staff role and a student or EE role appears in **both** sections, as one record with one profile. Editing them in either place edits the same Person, and a change made in Alunos is immediately visible in Pessoas.
- Each view's search is scoped to its own set: searching Pessoas never returns a Person whose only roles are Student or EE, and vice versa. A dual-role Person is returned by both, because they legitimately belong to both scopes — the exclusion is by role, not by person.
- An encarregado de educação is reached from the student's record; their own profile lists **all** students they are responsible for. The relation is one guardian to many students.
- An EE may also be a student. They then appear in Alunos with both badges, and their own enrolments and their guardianships are separate sections of one profile — not two records and not one merged list.
- Role badges follow POOLSE-18: staff badges render in Pessoas, Student and EE badges in Alunos, from the same token set.
- Rule that needs reconciling: POOLSE-17 AC 4 says "The People list shows every Person once, with all their role badges". Under this ticket there is no single People list, and a dual-role Person shows staff badges in one view and Student/EE badges in the other. POOLSE-18's 27 Aug amendment already records this; POOLSE-17 AC 4 should be read as "once per view", not "once in the app".
- **Open:** which badges a dual-role Person shows in each view — only the roles in that view's scope (implied by POOLSE-18's amendment), or all their roles with the out-of-scope ones muted. The two readings produce visibly different rows.
- **Open:** which roles may see which view. Pessoas listing staff is plainly not for a Student to read, but the doc states no permission rule for either section.
- Edge cases with decided answers: a Person whose only roles are removed appears in neither view but is not deleted (POOLSE-17 AC 7); adding a Student role to an existing instructor makes them appear in Alunos with no new record; counts shown on each view count Persons in that scope, so a dual-role Person is counted in both totals.

### Dev — implementation notes

- No new tables. Both views are queries over `person` joined to its role assignments, filtered by role set and tenant key. Resist a `person_type` column — it reintroduces the duplication POOLSE-17 exists to remove.
- The role filter is an `EXISTS` over role assignments, not a join that multiplies rows: a Person with three roles must appear once per view, and a naive join breaks both the row count and POOLSE-29's `total`.
- Index the role-assignment table on (tenant key, role, person id) — every page load of both views filters on exactly that.
- API surface: either one `GET /people?scope=staff|students` or two endpoints. Either way the scope is enforced server-side; a client-supplied role filter must not be able to widen the set. The detail endpoint is shared — one Person, one profile payload, reached from both views.
- Permission enforcement: the scope filter and the caller's own permission filter are two separate predicates and both must be applied. Do not let "the caller may see Pessoas" stand in for "this row belongs in the Pessoas scope".
- Search (POOLSE-30) must apply the scope predicate inside the same query as the search predicate; a search that bypasses the scope filter is the most likely way students leak into Pessoas.
- i18n: section names, empty states for each view, badge labels, and the guardian-to-students section heading. "Encarregado de educação" and "Alunos" are product vocabulary and stay Portuguese in the pt-PT locale as keys.
- Theming: two badge families rendered by the same component; verify the staff palette and the Student/EE palette are both contrast-checked in light and dark and stay clear of the attendance colours (POOLSE-13).
- Most likely to be got wrong: the dual-role Person. It is easy to write the filter as "not a student" instead of "has a staff role", which correctly hides pure students and incorrectly hides the instructor who is also a student.

### QA — test scenarios

- **35.1** Given a tenant with staff, students and guardians / When Pessoas loads / Then only Owner, Admin, Instructor and Maintenance appear, and no student or encarregado de educação is listed.
- **35.2** Given the same tenant / When Alunos loads / Then students and encarregados de educação appear, and no staff-only Person is listed.
- **35.3** Given an instructor who is also enrolled as an adult student / When both views load / Then they appear in both, as one record, and opening them from either lands on the same profile.
- **35.4** Given that dual-role Person / When their phone number is edited from Alunos / Then the change is immediately visible on their row and profile in Pessoas — one record, not two.
- **35.5** Given a search for a student's name in Pessoas, issued directly against the API / When it runs / Then no student or EE is returned, regardless of the UI.
- **35.6** Given a search for an instructor's name in Alunos / When it runs / Then they are not returned, unless they also hold a Student or EE role.
- **35.7** Given an encarregado de educação responsible for three students / When their profile opens / Then all three are listed, and each student's record links back to that same guardian.
- **35.8** Given an EE who is also a student / When their profile opens / Then their own enrolments and their guardianships appear as separate sections, both badges show in Alunos, and there is exactly one record for them.
- **35.9** Given a Person whose last remaining role is removed / When both views load / Then they appear in neither, and their record still exists and is retrievable.
- **35.10** Given a caller crafting a request with a role filter naming a staff role against the Alunos scope / When the request is made / Then the server-side scope wins and no staff-only Person is returned.
- **35.11** Given each view with more than fifteen rows / When paginated (POOLSE-29) / Then the total counts Persons once per view — a dual-role Person counts in both totals and appears exactly once on one page of each.
- **35.12** Given locale pt-PT and en / When both views, their empty states and the badges render / Then all strings come from the i18n layer, with "Encarregado de Educação" rendered correctly in full and abbreviated forms.
- **35.13** Given light and dark mode / When a Person shows several badges / Then every badge is legible, carries its role name as text, and does not read as an attendance state.
- **35.14** Given a Person who is granted a Student role while an admin has Pessoas open / When the admin refreshes / Then the Person remains in Pessoas (they still hold a staff role) and now also appears in Alunos.

### Acceptance criteria

1. **Pessoas** lists only Owner, Admin, Instructor and Maintenance. No students, no encarregados de educação.
2. **Alunos** holds students and their encarregados de educação.
3. Both are **filtered views over the same Person model** (POOLSE-17) — not separate record types, and never a duplicated record for someone who appears in both.
4. A **Person holding both a staff role and a student role appears in both sections**, as one record with one profile; editing them in either place edits the same Person.
5. An encarregado de educação is reached from the student's record, and their own profile lists **all students they are responsible for** — the relation is **one guardian to many students**.
6. An encarregado de educação **may also be a student**; they then appear in Alunos with both badges, and their own enrolments and their guardianship are separate sections of one profile.
7. Searching in Pessoas never returns students or guardians, and vice versa — each view searches its own scope.
8. Role badges follow POOLSE-18: staff roles in Pessoas, Student and EE badges in Alunos.

---

## POOLSE-36 · Menu order — Pessoas below Instalações

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

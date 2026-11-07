# POOLSE-196 · The Owner can do anything in their club, an Admin some things, and the search bar reaches it all

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature / Security · **Area:** Roles / Search · **Priority:** High (pre go-live) · **Depends on** [POOLSE-39](./POOLSE-39-editable-staff-record-immutable-email.md), [POOLSE-118](./POOLSE-118-command-palette.md)

### PO — why this exists

Rui, 07-11-2026: *"The main goal here is to make the owner able to do anything anywhere inside their tenant. Then the admin only do some things, then the remaining employees are already truncated."* And: *"If the owner wants to access the facility documents, simply can type 'documents' there and it goes there."*

A real case started it: a student becomes an employee. One person, one login, and the invitation screen is the door somebody tries first.

**Not in scope:** changing the invitation matrix; a person's email, which stays the login's identity and moves only by re-invitation; pay, already the Owner's; searching for people or records in the bar.

### BA — rules

1. **Only the Owner changes, on somebody else's record:** the NIF, the NISS, the ID document and its photographs, the contract, the notes, and staff roles (`admin`, `instructor`, `maintenance`). An Admin reads all of it. (Rui, 07-11-2026.)
2. **An Admin keeps the everyday:** phone, address, sports, and family roles.
3. **The person keeps their own identity.** An Admin's own contract and NIF are the Owner's.
4. **The Owner may correct the name, the date of birth and the photograph of somebody who signs in** (Rui, 07-11-2026). They belong to the account, so each follows the person to any other club, and the screen says so. This narrows the sweep of 15-10-2026. An Admin and support stay refused. The email stays locked: it is how they sign in.
5. **A student who is still one keeps the role.** Removing `student` from somebody with a live student record is refused (409 `student_still_active`): archive first. Archived, the role goes and the login stays.
6. **A student with a login becomes staff on their record.** The invitation refuses (`person_in_app`), says why and links to the record, which opens for somebody who is not staff yet.
7. **The search bar reaches the site's tabs by a plain word,** in the reader's language, and *documents* works in pt-PT as well. `/dashboard/facilities/site?tab=` finds the site; a club with several goes to Instalações.

### Dev notes

`requireOwnerOrSelf` in `staff/staff.controller.ts`; `refuseStaffRoleByNonOwner` in `students/students.controller.ts`. Support holds `admin`, so every Owner rule refuses it without a line of its own. A contract's write refuses with 403 before the Owner's concealment rule, which still answers 404 on read. Search entries are `ACTIONS` in `lib/commands.ts`.

### QA

1. Given an Admin, when any field in rule 1 is written for somebody else, then 403; when it is read, then it answers.
2. Given an Admin, when a phone is saved beside unchanged notes, then it saves and the notes stay.
3. Given a live student, when `student` is removed, then 409; archived, then it goes and the login stays.
4. Given a student with a login, archived or not, when invited, then `person_in_app` with the record's id, and the record opens.
5. Given a login's name, then an Admin and support are refused and the Owner reaches Clerk.
6. Given the search bar, when *documents* is typed, then Enter lands on that tab.
7. Given an Admin, then the subscription, support access and app views are not offered.

### Acceptance criteria
- [x] Rules 1 to 7, in `staff/owner-only.integration.test.ts`, `invitations/student-becomes-staff.integration.test.ts` and `lib/commands.test.ts`.
- [ ] Walked as an Admin in a browser: there is no Admin test login.
- [ ] A real rename or photograph reaching Clerk: tested only to the guard.

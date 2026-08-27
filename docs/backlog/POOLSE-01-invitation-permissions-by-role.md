# POOLSE-01 · Invitation permissions by role

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

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

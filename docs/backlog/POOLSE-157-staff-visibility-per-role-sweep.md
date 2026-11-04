# POOLSE-157 · Staff screens by role: Funções and Acesso for the office; Férias and Mapa for every worker; Salários and Qualificações for the office or the person

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Sweep / Security · **Area:** Staff · **Priority:** High (pre go-live) · **Depends on** [POOLSE-97], [POOLSE-149] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "'Staff' details screen – 'Roles' should only be visible by owner/admin, 'Access' too"; "Leave can be accessed by all roles (people that work) to request days off, however on 'Awaiting approval' only owner/admin can accept or refuse, the others only see information"; "'Team map' can also be viewed by all working roles"; "salaries should only be visible by owner/admin"; "'Qualifications' screen should also only be visible by owner/admin or the person itself"; and under Faturação: "'invoice settings' link 'Open the club details' should only be visible to owner and admin".

Some of these already hold in the API (salaries, per CLAUDE.md). The ticket proves each with a probe line and fixes what does not.

**Not in scope:** the staff list layout (POOLSE-158); new leave rules; who sees a *colleague's* leave reason.

### BA — rules
1. Staff record tabs *Funções* and *Acesso*: owner/admin only — tab absent for others, endpoints 403.
2. *Férias*: every working role (owner, admin, instructor, maintenance) opens it and files a request for themselves; *Em aprovação* is read by all workers, and *Aprovar*/*Recusar* answer owner/admin only (403 otherwise). A worker reads other people's requests as dates and names, no reason text. **Open:** should an instructor see other people's requests at all? Default: yes, dates only (the team map already shows absences).
3. *Mapa de equipa*: every working role reads.
4. *Salários*: owner/admin only — verify the Admin-minus-Owner rule still holds; add nothing.
5. *Qualificações* page: owner/admin; a person reaches only their own through their record (`/staff/:id?tab=qualificacoes` where `:id` is self). The menu entry is `OFFICE`.
6. Faturação → *Definições* → *Abrir os dados do clube* link: shown only to owner/admin (the site page already refuses others — this is the dead link).
7. Guardian and student: 403 on every endpoint above.

### Dev notes
- Each rule = first-line `requireRole` + a line in `security/role-probe.integration.test.ts` as instructor, maintenance, guardian, student. Row-level "self" (rule 5) is a repository answer, not a role.
- Web: `visible:` from the loaded `can*` flags; menu roles in `nav-entries.ts`; the invoicing link through the page's `canManage`.
- Trap: hiding the tab is not the control — every item here needs its API line proven.

### QA
1. Given instructor, when `GET /staff/:id/roles` and `/access`, then 403; tabs absent.
2. Given maintenance, when filing leave, then 201; when approving another's, then 403; *Em aprovação* lists without reasons.
3. Given instructor, when opening the team map, then 200.
4. Given admin, when reading salaries, then the Owner's row is absent (existing test still green).
5. Given instructor X, when `GET /staff/X/qualifications`, then 200; `GET /staff/Y/qualifications`, then 403; the Qualificações menu entry is absent.
6. Given instructor on Faturação definições, then no *Abrir os dados do clube* link.
7. Guardian and student: 403 on each endpoint; cross-tenant ids 404.

### Acceptance criteria
- [ ] Every rule enforced server-side with a probe line.
- [ ] Tabs, menu entries and the invoicing link follow the same flags.
- [ ] `docs/features/staff.md` roles table updated.

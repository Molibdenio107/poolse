# POOLSE-227 · Everyone confirms their own details once, before Início, asked only for what is missing; the create-club form stops offering "A minha piscina"

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Onboarding / Identity / Staff / Family app · **Priority:** Medium (pilot) · **Depends on** [POOLSE-177](./POOLSE-177-app-profile-edits-never-reach-the-student-record.md), [POOLSE-149](./POOLSE-149-staff-record-details-id-card-contract-certificates.md), [POOLSE-196](./POOLSE-196-the-owner-can-do-anything-in-the-club.md) · **Unblocks** [POOLSE-228](./POOLSE-228-a-new-club-s-owner-is-walked-through-setup-after-creating-it.md)

### PO — why this exists

Rui, 19-11-2026, deciding onboarding in chat: a short *"Confirmar os seus dados"* step after sign-up or accepting an invitation, before Início, *"prefilled from what exists. Nothing is typed twice."* Today a person can use Poolse for months with no mobile on file, and an instructor's NIF and morada are typed by the office from paper, if at all. The office then chases them one by one. One screen, shown once, and only to people who have something missing, fixes that at the moment the person is already paying attention.

The second half is small: the create-club form stops offering *A minha piscina*. Personal tenants (slice 4.5) stay in the schema, the API and every code path, and the one that exists keeps working. The form simply opens on the club's fields.

**Not in scope:**
- The owner's club-setup wizard (POOLSE-228), the checklist (POOLSE-229), the tour (POOLSE-230).
- A guardian editing a child's fields. They stay office-only (POOLSE-177). A guardian sees them and can tell the office.
- Removing the `personal` kind, its enum value, `provision_organization`'s branch or any personal-tenant screen.
- Changing what Clerk owns (name, email, photo) or how it is saved (`updateClerkName` → `refreshFromClerk`).
- Asking for NISS, ID document, emergency contact or bank details. Those stay where POOLSE-100/149 put them.

### Changed after build (19-11-2026)

- **The owner's and admins' mobile is optional** (Rui): shown and prefilled on the gate, never required. Nothing in Poolse sends to it, so it was a requirement with no use. An owner whose name is on file goes straight from creating the club to the setup steps. Guardians, adult students and staff keep it required.

### BA — rules

1. **Who is asked what** (Rui, 19-11-2026). The required set is a function of the reader's roles in the active club, `requiredDetails(roles, …)` in `@poolse/rules`, with one definition for the API and the form. A person with several roles is asked for the union.
   | Role | Required |
   |---|---|
   | owner, admin | first and last name, mobile |
   | instructor, maintenance | first and last name, mobile, NIF, morada (address, código postal, localidade) |
   | guardian, student on the adult path | first and last name, mobile |
2. **Only what is missing, and only once.** The gate shows when at least one required field is blank. It lists every required field, prefilled, with the missing ones marked `*` and focused first. Once nothing is missing it never shows again. Nothing is stored to say it was seen: the data decides, so a person who later clears their mobile on *Perfil* sees it again on the next load.
3. **Nothing is typed twice.** Name from Clerk (`cached_first_name`/`cached_last_name`). Mobile from `person_phone()`, or `app_user.contact_phone` for a login. NIF and morada from the person's `membership` row (`tax_number`, `address`, `postal_code`, `locality`), which may already have been typed by the office.
4. **Where each field is saved** follows POOLSE-177's ownership. Name goes to Clerk, mobile to `app_user`, through the existing `PUT /me/profile`. NIF and morada go to the membership through the existing `PATCH /staff/:id/details`. The gate adds no second write path for any field.
5. **A staff member's NIF: the person fills it when blank** (Rui, 19-11-2026). POOLSE-149 made the NIF *the club's to set*, and `PATCH /staff/:id/details` refuses a non-owner who changes it (`staffDetails.errors.clubsToSet`). From now on the person may *fill their own NIF when none is on file*; changing a NIF that is already set stays the Owner's, as now. That partly **reverses** POOLSE-149's rule and gets its own line in `docs/decisions.md` and `docs/conventions/database-and-security.md`. NISS stays the club's.
6. **NIF and morada are read by the Owner, an Admin and the person, nobody else** (`requireOwnOrManaged`, as today), and under POOLSE-196 an Admin reads but does not write another person's NIF. The gate shows this as visible text under the fields: *"O seu NIF e morada são vistos apenas por si e pela administração do clube, para processar salários."* (GDPR line, Rui 19-11-2026: purpose, the club's payroll).
7. **GDPR basis.** Purpose: the club's payroll as an employer or contracting party (RGPD art. 6.º 1 b/c). Readers as rule 6. Kept as long as the membership is live. On leaving, the same retention POOLSE-149 already gives `membership.tax_number` and `address`; this ticket adds no new rule. **Required at every club, whether or not Salários is switched on** (Rui, 19-11-2026, over making it required only where `salaries` is on). Write that choice and its purpose in `docs/features/staff.md`.
8. **A guardian sees their children, read-only.** A list under their own fields: each child's name and relationship, as `GET /family` returns them (it carries no birth date, and no new read was added for one). No control edits a child. One button, *Avisar a secretaria*, per child (Rui, 19-11-2026). There is no "tell the office" path today, so it opens the club's contact from `GET /app/club-contact` (the reply email, with a prefilled subject naming the child, and the published phone if there is one). No new table and no new endpoint. A proper queue is a later ticket if the pilot asks.
9. **A minor student with a login (from 12) is not asked.** Their contacts are their guardian's, and the club's record holds their name.
10. **Enforced server-side.** `GET /me` returns `detailsMissing: string[]` for the active membership, computed in the API from rule 1. The `(app)` server layouts (`dashboard/layout.tsx` and `app/layout.tsx`) render the gate *in place of the page* when the list is non-empty. They render rather than redirect, so it holds whatever address the person types, and the Clerk landing trap (below) does not apply. The two save endpoints keep their own role checks in their first line. No handler is opened to a new role.
11. **Never under a borrowed identity.** No gate under *Ver como* (POOLSE-188, `refuseUnderView`), for a Poolse support membership (POOLSE-79), on `/admin`, on `/join` or on the create-club form itself (no membership yet). An owner creating a club meets the gate after creation, before POOLSE-228's wizard.
12. **Works on the phone and the desk.** In the `/app` shell it is a full screen in the app frame's detail shape (no tab bar). On the desk it is a `PageShell` card. Controlled fields (`TextField`), `*` on the required ones, field errors under the field, and one button, *Confirmar*.
13. **Existing users and the pilot.** Rules 1–2 apply to everybody on the next load, including the pilot club. A person who is complete sees nothing. A pilot instructor with no NIF sees the gate once.
14. **The create-club form drops *A minha piscina*** (Rui, 19-11-2026). The first fieldset (`KindOption` × 2) is not rendered, the steps renumber (1 *O clube*, 2 *Contactos*), and the form posts no `kind`. One constant, `OFFER_PERSONAL = false`, beside the form, brings it back. The API, the enum and `createOrganizationAction`'s mapping are unchanged, so a hand-posted `kind=personal` still creates a personal tenant, exactly as today. The existing personal tenant keeps working.
15. **Personal tenants in seeds and tests** (checked 19-11-2026): none in `packages/db/seeds` or `packages/db/src/seed.ts`. Tests create them on the fly: `packages/db/test/personal.sql`, and two tests in `organizations.integration.test.ts` (*4.5 — a personal signup…*, *62 — a personal signup claims…*), all through `provision_organization` / the controller, not the form. They stay green untouched.

### Dev notes

- **No migration.** Rule 5 is a controller change only: `PATCH /staff/:id/details` lets a non-owner set `taxNumber` when `was.taxNumber === null`. NISS keeps the refusal. Test both ways in `staff-details.integration.test.ts`.
- `requiredDetails(roles, { adultPath, minorStudent })` in `@poolse/rules`, with unit tests per row of rule 1. `GET /me` (`identity/me.controller.ts`) adds `detailsMissing`, computed with one read per request. `student_is_adult_path()` decides the student row, never the browser.
- The gate's form is `components/confirm-details.tsx`, reused by both layouts. Its server action calls `PUT /me/profile` then, for staff, `PATCH /staff/:id/details`. Two calls are not atomic. A failure in the second leaves the first saved, and the gate re-shows only what is still missing, which is correct by rule 2. `PUT /me/profile` is a PUT, so the action sends locale and theme from `/me` unchanged.
- Validation reuses `phone()` / `name()` in `me.controller.ts` and `parseDetails` in `staff.controller.ts`, with `isValidNif` from `@poolse/rules`. The only new thing is *required*, which the API checks in the gate's own sense: `detailsMissing` is recomputed after the save.
- **Trap, the Clerk landing (`interface.md`):** after Clerk's own post-sign-in navigation, a server `redirect()` leaves a blank page. That is why the gate renders in the layout instead of redirecting. Do not "simplify" it into a redirect.
- **Trap, e2e and seeds:** every Playwright session (`auth.setup.ts`: owner, instructor, family, student) and the seed's test logins must be *complete*, or every spec lands on the gate. Fill mobile, NIF and morada in `db:seed` and in the e2e club rebuild recipe, and add one spec that blanks a field and sees the gate.
- **Trap, under view:** `refuseUnderView` already blocks `PUT /me/profile`. The layout must also not *render* the gate under view, or an owner viewing as a family is stuck on someone else's form.
- i18n keys under `confirmDetails.*`. pt-PT: *Confirmar os seus dados*, *Telemóvel*, *NIF*, *Morada*, *Código postal*, *Localidade*, *Os seus educandos*, *Avisar a secretaria*, *Confirmar*.
- Create form: remove the `KindOption` fieldset behind `OFFER_PERSONAL`, renumber `StepLegend`, and leave `KindOption`/`StepLegend` in the file. Rewrite the file's top comment (see `docs/decisions.md`, 19-11-2026). Update `docs/features/onboarding.md` (*Creating the club* and a new *Confirmar os seus dados*) in the same commit.
- **Security review required** (`poolse-security-review`): new server action, a widened write on `staff/:id/details` (rule 5), personal data shown to a guardian (rule 8).

### QA

1. Given a new instructor accepting an invitation with no mobile, NIF or morada, when they reach `/app`, then the gate shows with name prefilled and the three fields marked `*`. After *Confirmar*, Início shows and the gate never returns.
2. Given an owner with name and mobile on file, then no gate on any page (snapshot of Início unchanged).
3. Given a pilot guardian with no mobile, when they open the app, then the gate asks only for the mobile. Their children are listed read-only with *Avisar a secretaria*, and no child field is an input.
4. Given an instructor whose NIF the office already typed, then the NIF is prefilled. Changing it to another valid NIF is refused with the existing *clubsToSet* sentence under the field (rule 5).
5. **Permission, against the endpoint:** an instructor calling `PATCH /staff/<colleague>/details` with a NIF → 403. A guardian calling `PATCH /staff/<any>/details` → 403. A guardian calling `GET /staff/<instructor>/details` → 403/404 as today. Each is a line in `role-probe.integration.test.ts`.
6. **Cross-tenant:** an instructor of club A calling `PATCH /staff/<membership in club B>/details` → 404, and nothing written.
7. **Tampering:** posting `kind=personal` by hand to the create-club action creates a personal tenant exactly as today (test 4.5's assertions). Posting extra fields (`organizationId`, `roles`, `taxNumber` for another membership) to the gate's action changes nothing beyond the reader's own fields.
8. Under *Ver como* a family with gaps, the owner sees the family's screens and no gate. `PUT /me/profile` under view → refused as today.
9. Phone (`iphone`, `android` projects): the gate in the app frame, one-handed, 16 px fields, the button above the safe area.
10. Both themes, contrast checked. The `*` and the error are text, not colour alone.
11. The create-club form opens on *O clube* with steps 1–2, and *A minha piscina* is nowhere on it. With `OFFER_PERSONAL = true` it is back unchanged.

### Acceptance criteria
- [x] `requiredDetails` in `@poolse/rules` with unit tests. `GET /me` returns `detailsMissing`.
- [x] Gate rendered server-side by both `(app)` layouts, never under view, support, `/admin`, `/join` or the create form.
- [x] Saves through `PUT /me/profile` and `PATCH /staff/:id/details` only, with rule 5 tested both ways (a blank NIF fills, a set one stays the Owner's).
- [x] Guardian sees children read-only with *Avisar a secretaria* opening the club's contact.
- [x] GDPR line visible on the gate. Rule 7 written in `docs/features/staff.md`; rule 5 in `docs/decisions.md` and `docs/conventions/database-and-security.md`.
- [x] Seed and e2e logins complete, and a spec proves the gate appears and clears.
- [x] Create form without *A minha piscina* behind `OFFER_PERSONAL`. `kind=personal` posted by hand behaves as today. Personal-tenant tests green.
- [x] `docs/features/onboarding.md` updated. `pnpm i18n:check`, `pt:check`, `contrast:check`, `security:check` green. `poolse-security-review` run.

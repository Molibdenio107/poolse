# POOLSE-228 · A new club's Owner is walked through four skippable setup steps after creating it, and can stop and come back

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Onboarding / Organizations / Facilities / Seasons / Staff · **Priority:** Medium (pilot) · **Depends on** [POOLSE-227](./POOLSE-227-everyone-confirms-their-own-details-once-before-inicio.md) · **Unblocks** [POOLSE-229](./POOLSE-229-vamos-comecar-a-checklist-on-inicio-that-ticks-itself.md)

### PO — why this exists

Rui, 19-11-2026: the creation form stays one screen, and *"the wizard comes after it, with every step skippable."* This **partly reverses** the rule in the comment at the top of `create-organization-form.tsx`: *"a six-step wizard between someone and their first screen is how trials end"*. The form is still the one screen between a person and their club. What comes after is a guide to the four things a new club needs, each with *Configurar mais tarde*, so it can never be a wall.

Today Início's *Configurar o clube* (17-11-2026) sends an owner to a site page with nine tabs. The wizard asks the same questions in order, saves through the same endpoints, and then gets out of the way.

**Not in scope:**
- New settings. Every step writes through an endpoint that exists.
- **The season** (Rui, 19-11-2026): no step for it. The season `provision_organization` opens stands, and *Épocas* is the only place to change it. No season endpoint is added.
- The checklist on Início (POOLSE-229). This ticket only records which steps were skipped.
- A wizard for admins, for a second site, or for existing clubs.
- Building a new importer. Step 5 opens the existing ones.

### BA — rules

1. **When.** Right after `createOrganizationAction` (and POOLSE-227's gate, if the owner has gaps), the owner lands on `/dashboard/setup`, not `/dashboard/welcome?new=1`. Finishing or skipping the last step goes to `/dashboard/welcome?new=1`, so *Tudo pronto* still shows once.
2. **Only for clubs created from now on.** The wizard is offered when the reader's `onboarding_progress` row has `wizard_started_at` set and `wizard_finished_at` null. `createOrganization` writes that row, in the same transaction as the club. A club with no such row (the pilot, every existing club, a personal tenant) never sees the wizard, and nothing it does creates one.
3. **Owner only.** The wizard's page and its progress endpoints answer the Owner. An Admin gets 403 and is shown Início.
4. **The four steps, in order** (Rui, 19-11-2026; a fifth, *Época atual*, was dropped the same day). Each saves through the endpoint named, prefilled from what exists:
   1. **Clube.** NIF (`PUT /organizations/tax`), the first site's morada (`PUT /facilities/:id`, `address`/postal code/locality, POOLSE-210), the logo (`PUT /settings/logo`), the reply email and phone (`PUT /organizations/contacts`, prefilled from creation). The name is not asked again.
   2. **Recintos e horário.** The first site's pools (the existing pool-create path on the site page) and its opening hours (`PUT /facilities/:id/hours`), shown as the site page's own panels mounted inside the step.
   3. **Convidar equipa.** Email plus role (admin, instructor, maintenance), one row per person, through `POST /invitations`. The existing contact lookup applies (an email the club already has invites that record). Family roles are not offered, and the endpoint refuses them anyway.
   4. **Já tem alunos ou horários numa folha?** Two buttons, to the students importer (`/dashboard/students/import`) and the calendar's timetable import (`/dashboard/calendar/import`), each opened with `?from=/dashboard/setup?step=import`, so their own *Voltar* and done state come back. A third button, *Não, começar do zero*, finishes the wizard.
5. **Every step has *Configurar mais tarde*.** It records the step as skipped and moves on, and saves nothing on that step. *Seguinte* saves the step's fields, then moves on. A step saved with some fields blank is *done*, not skipped. Blanks show up on POOLSE-229's checklist through its own data rules.
6. **Resumable.** `onboarding_progress.wizard_step` is the step to open. Leaving the wizard (menu, closing the tab) is allowed: it is a guide, not a gate. While unfinished, Início shows *Continuar a configuração* above everything, to the saved step. *Terminar mais tarde* on every step goes to Início and keeps the step.
7. **One row per person per club.** Progress is the Owner's own. If ownership is transferred, the new owner gets no wizard (rule 2) and sees the checklist.
8. **The logo goes through the existing upload path.** It is content-sniffed by `judgeUpload`, stored in R2 (S3Mock in dev), read only through the app (`GET /settings/logo`), never a public or pre-signed URL, with the size and type limits that route already has.
9. **Phone and desk.** A step per screen, a progress line (*Passo 2 de 4* as text, not a bar alone), *Seguinte* / *Configurar mais tarde* / *Voltar*, controlled fields, and decisions asked through `ConfirmButton` only where they already are (none should be).

### Dev notes

- **Migration (`write-migration` skill):** table `onboarding_progress`
  `(id, organization_id, membership_id, wizard_started_at, wizard_step onboarding_step, wizard_skipped onboarding_step[] default '{}', wizard_finished_at, created_at, updated_at)`. Enum `onboarding_step` = `club, places, team, import` (English snake_case; the Portuguese is i18n). Composite FK `(organization_id, membership_id) → membership`, RLS on `current_organization_id()`, and `unique (organization_id, membership_id)` (partial on `archived_at is null` if the table soft-deletes; it holds no history, so no `archived_at` is proposed). Add it to `TENANT_TABLES` in `apps/api/src/test/harness.ts`, child-first, in the same commit. Columns for POOLSE-229/230 are added by those tickets, not here.
- **Trap:** `wizard_skipped` is an enum array, so read it `::text[]` (`database-and-security.md`), or the browser gets the string `'{club}'`.
- `provision_organization` is SECURITY DEFINER and was last restated in `1790762400000_sweep-oct-16.sql`. Insert the progress row from `createOrganization` in the controller's transaction, not by restating that function, unless it must happen inside it. If it must, copy the *live* body (the definer-restate trap).
- Endpoints: `GET /onboarding` (Owner: progress plus each step's prefill, one read) and `PUT /onboarding/step` (`{ step, outcome: 'done' | 'skipped' }`). `requireRole('owner')` in the first line of both, plus lines in `role-probe.integration.test.ts`. Step saves call the existing endpoints. `/onboarding` only moves the pointer.
- Web: `/dashboard/setup?step=`, one page, one component per step mounting the existing panels (`logo-panel.tsx`, the hours and pools panels from `facilities/[facilityId]`). `createOrganizationAction` redirects to `/dashboard/setup`, with the same no-`revalidatePath` reason it has today. Add *Configurar o clube* to `nav-entries.ts`/`ACTIONS` only if Rui wants it in Ctrl+K (standing AC of 04-11-2026). **Default:** an `ACTIONS` line *Continuar a configuração*, shown only while unfinished.
- Update the top comment of `create-organization-form.tsx` and `docs/features/onboarding.md` (*The setup after creating*). Add `docs/data-model.md` for the table.
- **Security review required** (`poolse-security-review`): new endpoints and a new upload entry point (even though it reuses the route).

### QA

1. Given a new signup, when they create *Clube Teste*, then they land on step 1 with the reply email prefilled. Skipping every step lands on *Tudo pronto*, and the four steps are recorded as skipped.
2. Given a new club, then the wizard never asks about the season, and *Épocas* shows the season provisioning opened.
3. Given step 2 left halfway (browser closed), when the owner signs in again, then Início shows *Continuar a configuração*, which opens step 2.
4. Given step 3 with an instructor's email, then an invitation exists exactly as from Staff, and the email the club already has invites that record.
5. Given step 4, *Importar alunos* opens the importer, and finishing it returns to the wizard's last step.
6. Given the logo step with a renamed `.exe` as `logo.png`, then it is refused by the sniff, as on the site page.
7. **Pilot unchanged:** given the pilot's owner, `/dashboard/setup` shows Início, and nothing on Início changes (snapshot) beyond POOLSE-229.
8. **Permission, against the endpoint:** an Admin, an instructor and a guardian calling `GET /onboarding` and `PUT /onboarding/step` → 403.
9. **Cross-tenant:** the owner of club A sending `PUT /onboarding/step` while their session is in club A cannot move club B's row. A SQL test inserts a row with B's membership and A's organization and is refused by the composite FK. RLS hides B's rows from A.
10. **Tampering:** `PUT /onboarding/step` with an unknown step, an extra `membershipId` or `organizationId` → 400 or ignored, and only the reader's row moves.
11. Phone and desk, both themes. *Passo n de 4* is text.

### Acceptance criteria
- [ ] `onboarding_progress` + enum, RLS, composite FK, in `TENANT_TABLES`, `docs/data-model.md`, with a SQL test.
- [ ] Wizard only for clubs created after this ships. The pilot never sees it.
- [ ] Four steps, all on existing endpoints. No season step and no season endpoint.
- [ ] Every step skippable, progress resumable, *Continuar a configuração* on Início while unfinished.
- [ ] Logo through the existing sniffed upload, read only through the app.
- [ ] Role-probe and cross-tenant tests green. `poolse-security-review` run.
- [ ] `create-organization-form.tsx` comment and `docs/features/onboarding.md` say what the form and the wizard are now.

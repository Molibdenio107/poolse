# POOLSE-229 · *Vamos começar*: a checklist on Início that ticks itself from the club's real data, for new and existing clubs

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Onboarding / Início / Dashboard · **Priority:** Medium (pilot) · **Depends on** [POOLSE-228](./POOLSE-228-a-new-club-s-owner-is-walked-through-setup-after-creating-it.md) · **Unblocks** [POOLSE-230](./POOLSE-230-a-guided-tour-per-role-launched-never-forced.md)

### PO — why this exists

Rui, 19-11-2026: a skipped wizard step *"becomes a checklist item"*, joined by the things a club needs before its first month: turmas, prices, the public form and a short tour. Each item ticks itself from real data, *"never from a stored done flag"*. A list that says *done* because somebody clicked is a list that lies the day a turma is archived. It is also offered to existing clubs, the pilot included.

**Not in scope:**
- New attention circles, bell lines or menu dots. The checklist is Início's card, not a POOLSE-120 kind.
- Building the tour (POOLSE-230). This ticket adds its item and the launch button.
- Any item for families or teaching staff.

### BA — rules

1. **Where.** A card *Vamos começar* on Início (`/dashboard/welcome`), under the club's name, for a `business` club. Never on a personal tenant.
2. **Who.** The Owner sees, uses and dismisses it. **Open:** an Admin. **Default:** an Admin sees it read-only (items and links, no *Dispensar*), because every item but the public form is theirs to do too. The public form's item shows its state with the line *Só o titular pode abrir o formulário* instead of a link (`public_registration_open` is Owner-only).
3. **Items, each ticked by one SQL predicate** in `onboarding.repository.ts` (`readChecklist`, one grouped statement, never a loop):
   | Item | Shown | Ticks when |
   |---|---|---|
   | Dados do clube | wizard step `club` skipped | `organization.vat_number` set **and** the first live site's morada set |
   | Recintos e horário | step `places` skipped | ≥1 live pool **and** ≥1 `facility_hours` row at a live site |
   | Equipa | step `team` skipped | ≥1 invitation sent (any status) **or** ≥2 live staff memberships |
   | Alunos | step `import` skipped | ≥1 live student |
   | Criar as primeiras turmas | always | ≥1 live `class_group` in the published season |
   | Definir preços | always | ≥1 live `fee_plan` |
   | Abrir a pré-inscrição | always | `organization.public_registration_open` (closed by default) |
   | Fazer a visita guiada | always | the reader's `tour_finished_at` or `tour_dismissed_at` (POOLSE-230), the one stored exception (Rui) |
   For an existing club (no wizard row), the four *skipped-step* items are not shown; the four *always* items are.
4. **Each item links to the real screen** with `FromLink`: Dados do clube → the site's Geral; Recintos → the site page; Equipa → `/dashboard/facilities/staff`; Alunos → `/dashboard/students/import`; Turmas → `/dashboard/classes`; Preços → the site's price list (`fee_plan` lives per facility); Pré-inscrição → `/dashboard/students/pedidos` (`registration-settings.tsx`); Visita → starts the tour.
5. **Ticked is shown three ways:** a tick icon, the words *Feito*, and struck-through-free muted text. Never colour alone. Ticked items sink below open ones. The heading says *3 de 7 feitos* in words.
6. **Stays until complete or dismissed.** All items ticked: the card shows *Tudo pronto* once for that visit and then is not drawn. *Dispensar* (Owner, asks first with `ConfirmButton`) sets `checklist_dismissed_at`. A dismissed checklist is gone for that person in that club. **Default:** it comes back from Perfil → *Mostrar "Vamos começar"* in the same row as the tour's replay.
7. **Ticks are live.** Archive the only turma and the item opens again. That is the point of rule 3.
8. **The pilot** sees it on its next visit to Início with whatever is still open, probably the tour and the public form. Nothing else on Início moves.

### Dev notes

- **Migration (`write-migration`):** `onboarding_progress.checklist_dismissed_at timestamptz`. Rows are created lazily (`INSERT … ON CONFLICT DO NOTHING`) for a reader with none, **with `wizard_started_at` left null**, so the pilot's new row never opens POOLSE-228's wizard. That column is the wizard's only switch, and this is the trap to test.
- `GET /onboarding/checklist` (owner, admin) → `{ items: [{ key, done, href? }], canDismiss }`. `PUT /onboarding/checklist/dismiss` and `…/restore` (owner). `requireRole` first line, role-probe lines. Item keys are an English snake_case union (`club_details, places, team, students, turmas, prices, public_form, tour`).
- Predicates read `class_group` with `LEFT JOIN`s where a partnership might hide (`database-and-security.md`). "Published season" lookups must add `sport_id IS NULL` (POOLSE-126 debt). One statement, proved by `countStatements`.
- Início reads it in parallel with `/facilities`. A failed read shows nothing, never "all done" (`Outcome`, `interface.md`).
- i18n under `checklist.*`. pt-PT: *Vamos começar*, *Feito*, *Dispensar*, *{done} de {total} feitos* with plurals from the locale.

### QA

1. Given a new club that skipped *Equipa* and *Alunos*, then the card lists Equipa, Alunos, Turmas, Preços, Pré-inscrição and Visita, 0 of 6.
2. Given the owner creates one turma, then on the next load *Criar as primeiras turmas* is *Feito*. Archiving it opens it again.
3. Given the owner opens the public form on Pedidos, then *Abrir a pré-inscrição* ticks, and closing it un-ticks it.
4. Given the pilot club, then the card shows only the *always* items, ticked from its real data, and `/dashboard/setup` still shows no wizard after the lazy row is created.
5. Given an Admin (default), then the card shows with no *Dispensar*, and the public form item shows the owner-only line.
6. **Permission, against the endpoint:** an instructor and a guardian calling `GET /onboarding/checklist` → 403. An Admin calling `PUT …/dismiss` → 403.
7. **Cross-tenant:** the checklist of club A never counts club B's turmas, fees or invitations (SQL test with two clubs). A's owner cannot dismiss B's row.
8. **Tampering:** `PUT …/dismiss` with a `membershipId` in the body dismisses only the reader's own row.
9. Both themes. *Feito* readable without colour. Phone width shows the card as a single column.

### Acceptance criteria
- [ ] Eight item predicates in one statement, each with an integration test that ticks and un-ticks it.
- [ ] Skipped-step items only for wizard clubs. Always-items for every business club, the pilot included.
- [ ] Owner dismisses, and restores from Perfil. Admin read-only (rule 2 settled).
- [ ] Lazy row never opens the wizard (test).
- [ ] Role-probe and cross-tenant tests green. Both themes checked.

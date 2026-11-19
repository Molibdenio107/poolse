# POOLSE-230 · A short guided tour per role, built in-house, launched from *Vamos começar* or Perfil and never started on its own

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Onboarding / Interface / Family app / Navigation · **Priority:** Medium (pilot) · **Depends on** [POOLSE-229](./POOLSE-229-vamos-comecar-a-checklist-on-inicio-that-ticks-itself.md)

### PO — why this exists

Rui, 19-11-2026: small in-house coach marks, *"NO new dependency"*, three to six steps per role, pointing at that role's main menu areas. It *"never auto-starts"*. A person who wants it presses for it from *Vamos começar*, and anybody can replay it from Perfil → Definições. A tour that plays on its own is the thing everybody closes without reading.

**Not in scope:**
- A tour library, or tours inside a page (a form, the calendar's grid).
- Tours per sport, or per module beyond hiding a step whose entry the reader cannot see.
- Auto-start, nagging, or a dot on Perfil.

### BA — rules

1. **Steps per role, from the real menus** (checked against `lib/nav-entries.ts` and `TABS` in `lib/app-hats.ts`, 19-11-2026). The ticket's first list is corrected as follows.
   - **Owner / Admin (backoffice):** *Início* · the sport's tab, *Natação*, which holds **Calendário, Turmas and Piscinas** (all three are `perSport`, so they live in the sport's group, not top-level; POOLSE-141/150) · *Alunos* · *Faturação* · *Instalações → Staff*. The menu says **Staff**, not *Equipa*. 5 steps. *Recintos* as such is not a menu entry for a pool-only club: it is *Piscinas* inside *Natação*.
   - **Instructor (`/app`, `teaching`):** *Início* · *Aulas* · *Alunos* · *Perfil*. There is no *Hoje* or *Registo* tab. The register opens from a lesson in Início or Aulas, and the tour's *Aulas* step says so. 4 steps.
   - **Family / student (`/app`, `family`):** *Início* · *Aulas* · *Progressos* · *Perfil*. *Pagamentos* is not a tab. It is `/app/familia/pagamentos`, reached from a card on Início, so the *Início* step names it. With two sports the hexagon *Modalidades* replaces *Aulas* (POOLSE-127), and the step follows whichever is drawn. 4 steps.
   - **Maintenance (`/app`, `maintenance`):** *Hoje* · *Registar* · *Perfil*. 3 steps.
2. **A step whose anchor is not on screen is skipped**, never pointed at nothing. The steps are filtered by the same filter the menu uses (roles, `module`, `kinds`, sport), so a club with Faturação off gets no Faturação step.
3. **Which tour.** The tour of the shell the reader is in: the backoffice shows the owner/admin tour, and `/app` shows the tour of the current hat (`?home=`, `app-hats.ts`). A person with two hats sees the tour of the one they launched from.
4. **Never auto-starts.** Launched only by *Fazer a visita guiada* on *Vamos começar* (POOLSE-229), or *Rever visita guiada*: on `/app/perfil/definicoes`, and on the desk on *O meu perfil* (`/dashboard/profile`), which is the desk's Definições.
5. **A coach mark** is a small card beside its anchor with a highlighted ring round the anchor and the page dimmed. It shows the title, one or two sentences, *Passo 2 de 5* as text, and *Anterior*, *Seguinte* / *Concluir*, *Fechar*. Below `md` in the backoffice, where the sidebar is `MobileMenu`, the step anchors on the menu button and names the entry.
6. **Accessibility.** Focus moves into the card and is trapped there. Tab cycles its buttons. Arrows move between steps, Esc closes, and focus returns to the control that launched it. The card is a labelled `role="dialog"`, and every string is i18n (pt-PT source, European Portuguese). Reduced motion means no glide between anchors and no pulse on the ring. Light and dark are contrast-checked, and the ring is not the only marker (the card names the area).
7. **Stored per person per club.** *Concluir* sets `tour_finished_at`; *Fechar* before the end sets `tour_dismissed_at`. Either ticks POOLSE-229's item. A replay changes neither. A person in two clubs sees the tour item in each, which is deliberate: the menus differ by club.

### Dev notes

- **No new dependency.** `components/coach-marks.tsx` plus `lib/tours.ts` (one array of steps per hat, each `{ anchor, titleKey, bodyKey }`). Anchors are `data-tour="<id>"` attributes added to the sidebar entries (`SidebarNav`), the top bar's sport tab, and the app frame's tab bar (`app-frame.tsx`). Position from `getBoundingClientRect`, re-measured on resize and scroll, the card portalled to `document.body` as `Dialog` is. Reuse `Dialog`'s focus-trap and Escape handling (`components/ui/dialog.tsx`, which respects stacking and `data-own-escape`) rather than writing a second trap.
- **Migration (`write-migration`):** `onboarding_progress.tour_finished_at`, `tour_dismissed_at`. The lazy row from POOLSE-229 now also exists for instructors, maintenance and families, still with `wizard_started_at` null. `PUT /onboarding/tour` `{ outcome: 'finished' | 'dismissed' }` answers **any member of the club for their own row**: `requireRole(...MEMBER_ROLES)` first line, the row chosen by the session's membership, never a body id.
- Trap: the anchors live in client components that move by CSS between desk and phone (`interface.md`: rendered once, moved by CSS). Measure the visible one and never render a second copy for the tour.
- Trap: the app frame's `PreferenceSync` resets state in e2e (POOLSE-99 memory). Start the tour in tests by its button, not by a stored flag.
- Add *Rever visita guiada* to `ACTIONS` in `lib/commands.ts` (standing AC, 04-11-2026).
- i18n under `tour.<hat>.<step>.*`. A line per step in `phone-app.spec.ts` (`iphone`, `android`) and one desk spec.

### QA

1. Given the owner on Início, when they press *Fazer a visita guiada*, then five steps play in order, each ringed on its real menu entry, and *Concluir* ticks the checklist item.
2. Given a club with Faturação switched off, then the owner's tour has four steps and never points at an empty space.
3. Given an instructor on the phone, when they replay from Perfil → Definições, then four steps play on the bottom tab bar, and Esc returns focus to *Rever visita guiada*.
4. Given a family with two sports, then step 2 rings *Modalidades*.
5. Given reduced motion, then the card jumps between anchors with no animation.
6. Keyboard only: Tab never leaves the card, arrows move steps, Esc closes.
7. **Never auto-starts:** a new owner, instructor and family each sign in and no tour appears (desk and phone specs).
8. **Permission, against the endpoint:** `PUT /onboarding/tour` as a guardian sets only the guardian's own row. With a `membershipId` of somebody else in the body, still only their own.
9. **Cross-tenant:** a member of club A cannot set a row in club B (RLS and the composite FK, SQL test).
10. Both themes, desk and phone, contrast checked (the ring is a fill in `contrast:check`'s `PAIRS`).

### Acceptance criteria
- [ ] In-house coach marks, no new package in any `package.json`.
- [ ] Step lists per hat as rule 1, filtered by the menu's own filter.
- [ ] Launched only from *Vamos começar* and *Rever visita guiada* (desk and `/app`) and Ctrl+K. Never automatic.
- [ ] Focus trapped and restored, Esc, arrows, reduced motion, both themes, phone shell.
- [ ] Finished/dismissed stored per person per club and ticking POOLSE-229.
- [ ] Role-probe, cross-tenant and phone specs green.

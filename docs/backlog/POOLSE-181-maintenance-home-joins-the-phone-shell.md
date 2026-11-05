# POOLSE-181 · The maintenance home joins the phone shell: *Hoje*, *Registar* and *Perfil* tabs, the old header goes

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Maintenance · **Priority:** Medium (pilot) · **Depends on** [POOLSE-136](./POOLSE-136-the-app-phone-shell.md), [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md) slice 3, [POOLSE-169](./POOLSE-169-dashboard-post-it-for-staff.md)

### As built (05-11-2026) — wins over what follows

- **Classic shape removed.** `app-frame.tsx` has two shapes now, tabs and detail. Its `chrome` and `staff` props went with the old header, and the layout no longer renders `PreferenceControls` / `UserMenu` for app mode. All of that is on *Perfil* and *Definições*.
- **`TabbedHat` is every hat.** `isHat()` in `app-hats.ts` validates `?home=` for `tabFor`, *Perfil* and *Definições*, which accepted only `family | teaching` before.
- ***Registar*** reads `/app/maintenance`, the same endpoint as *Hoje*. Its sheets reuse `OneTap`, with no new action. *Reportar* opened with `?from=registar` goes back to *Registar*. That is a fixed token, never a path, so it can't be used as an open redirect.
- **Hoje's list is unchanged**, but the page now wears the tab screens' type scale (`data-shell="tabs"`), so the title and section sizes follow the other homes.
- **e2e:** there is no maintenance storage state in `e2e/.auth`, so QA 1–3 are manual until a fixture exists. `app-hats.test.ts` covers the tabs.

### PO — why this exists

Rui, 05-11-2026: *"i would also like to see a 'teachers and maintenance mobile view'"*. Reviewed the same day: the instructor has the shell (POOLSE-136: *Hoje*, *Semana*, *Perfil*); the maintenance home is the one app screen still wearing its pre-shell header — POOLSE-136 said so: *"The maintenance home keeps its old header until its own phone view."* This is that view. The to-do list itself (tasks, espaços, avarias, pools) is right and stays; what it lacks is the bar, the profile and a place to record something without being sent to the backoffice.

**Not in scope:**
- Recording a water analysis in the app — it still opens the pool's *water* tab in the backoffice (POOLSE-90 slice 3's rule), until the office asks otherwise.
- Any change to what the home lists or to the one-tap actions.

### BA — rules

1. **Tabs**: *Hoje* (`/app/manutencao`, the list as now, the staff board on top per POOLSE-169), *Registar* (`/app/manutencao/registar`: three rows — *Concluir tarefa*, *Limpeza*, *Reportar avaria* — the last opening the existing `reportar` form; the first two open a picker sheet of the open items), *Perfil* (the shared `/app/perfil?home=manutencao`). Shapes: square, triangle, diamond — the circle/hexagon is the family's.
2. **The header** is the club's logo or initials (POOLSE-176 rule 5) and the club's name, nothing else.
3. **Deeper screens** (*Reportar*, a picker sheet's target) have *Voltar* and no bar, the POOLSE-136 rule.
4. **Nothing in the list changes**: snapshot of *Hoje*'s rows before and after differs only in the header and the bar.

### Dev notes

- `app-frame.tsx`: add the `manutencao` home to the tab definitions beside `familia` and `aulas`; `lib/app-hats.ts` already lands maintenance here.
- `app/manutencao/registar/page.tsx` is a thin page composing the three rows; the pickers reuse `one-tap.tsx`'s actions.
- Trap (POOLSE-90 slice 3): a one-tap row leaves the list on `useSavedAction`'s refresh, after its toast — do not revalidate inside the action or the button unmounts before the toast.

### QA

1. Given a maintenance login on a phone, then *Hoje* shows the bar with three tabs and the club in the header; *Perfil* opens the shared profile with *Áreas*.
2. Given *Registar › Concluir tarefa*, then the sheet lists the open tasks; completing one shows the toast and it leaves *Hoje*.
3. Given *Reportar*, then no bar and *Voltar* returns to *Registar*.
4. Given an instructor's token on `/app/manutencao` → 403; given the backoffice on a laptop → unchanged.
5. Both themes, snapshot.

### Acceptance criteria
- [ ] Maintenance home wears the shell: three tabs, club header, shared *Perfil*.
- [ ] *Registar* reaches the three actions without the backoffice.
- [ ] The list is unchanged; QA 1–5 green.

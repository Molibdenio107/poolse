# POOLSE-233 · An empty Inventário, Energia or Ocorrências offers its first action as a button; Perdidos e achados says *Registar*

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Interface / Instalações · **Priority:** Medium (pilot) · **Depends on** [POOLSE-232](./POOLSE-232-one-shared-button-and-every-page-s-main-action-stands-out.md)

### PO — why this exists

Rui, 19-11-2026: an empty list should say what to do and offer it. *Ocorrências* already has a good empty card (*Sem ocorrências…*) but no button on it. *Inventário* and *Energia* say less. `PageEmpty` (`components/page-shell.tsx`) already takes `action` and `secondaryAction`, so this is wiring, not a new component.

**Not in scope:**
- Empty states on other pages (they follow when touched, with the same pattern).
- A new importer. *Importar* appears only where one exists.

### As built (19-11-2026)

- Walked in a browser on a fresh throwaway club (all three lists empty): each card shows its buttons, and Inventário's *Adicionar artigo* opens the add form. Energia's card sits under the cost summary, with the same two actions in the header.
- **The e2e line for an empty state is not written.** The E2E club has data in all three lists, and making one empty means a site the suite would have to create and archive each run. Left for a later pass; the walk above stands in for it.
- An empty Inventário now shows *Importar de ficheiro* three times (header, the search card's own, the empty card). Both tickets asked for it; worth a look when Rui walks it.

### BA — rules

1. **Inventário**, empty for the chosen site: `PageEmpty` with `action` = *Adicionar artigo* (primary `<Button>`) and `secondaryAction` = *Importar de ficheiro* (secondary), both opening what the header's buttons open.
2. **Energia**, a site with no meters: `PageEmpty` with *Adicionar contador* (primary) and *Importar fatura* (secondary).
3. **Ocorrências**, none at the site: the existing card (`incidents.empty`, `incidents.emptyHint`) gains *Registar ocorrência* (primary). There is no importer, so no secondary.
4. **Only for roles that may add**, from the page's existing flag or refusal (`interface.md`: never a new role list). The server still enforces. A reader who may not add sees the card with no buttons and one quiet line (`NothingYet`'s rule).
5. **Shown only after a read that succeeded.** A failed read keeps `PageError`, never "nothing yet" (`interface.md`).
6. **Perdidos e achados:** the add button's visible label `inventory.lostAndFound.add` becomes *Registar* (en *Record*). It keeps `aria-label` *Registar um achado* (new key `inventory.lostAndFound.addAria`) so a screen reader hears what is registered. The save button (`inventory.lostAndFound.save`, already *Registar*) is unchanged.

### Dev notes

- `facilities/inventory/page.tsx` and `inventory-panel.tsx`, `energy/page.tsx` and `facilities/energy-panel.tsx`, `facilities/incidents/page.tsx`, `facilities/inventory/lost-and-found-panel.tsx`.
- The buttons are POOLSE-232's `<Button>`; the empty card's buttons and the header's call the same opener (one state, not two forms).
- Add an e2e line to an existing desk spec for the empty Ocorrências card's button (a scratch site with no incidents).

### QA

1. Given a site with no stock, an owner sees the empty card with *Adicionar artigo* and *Importar de ficheiro*; each opens the same thing as the header's.
2. Given a site with no meters, the owner sees *Adicionar contador* and *Importar fatura*.
3. Given a site with no incidents, an instructor (who may record one) sees *Registar ocorrência*.
4. **Wrong role:** a guardian cannot reach these pages (as today). On Inventário, a role that may read but not add sees the card without buttons, and posting the add directly is 403, as today.
5. Given the read fails, `PageError` shows, not the empty card.
6. A screen reader on Perdidos e achados hears *Registar um achado*; the visible button says *Registar*.
7. Phone width: the two buttons stack under the hint; both themes.
8. Cross-tenant: no new route.

### Acceptance criteria
- [x] Three empty states with their actions, role-gated by existing flags.
- [x] Perdidos e achados label and aria-label.
- [ ] e2e line for one empty state (not written, see *As built*); light theme walked.

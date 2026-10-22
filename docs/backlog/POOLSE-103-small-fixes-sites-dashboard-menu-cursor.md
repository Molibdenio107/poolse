# POOLSE-103 · Small fixes: the site's name opens it, no Energia tab, a quieter subscription card, the make-up menu, a lighter I-beam

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bugs + small UX · **Area:** Instalações / Dashboard / Navigation · **Priority:** Medium · **Depends on** [POOLSE-91](./POOLSE-91-back-returns-to-where-you-came-from.md), [POOLSE-95](./POOLSE-95-text-cursor-disappears-in-inputs.md)

### PO — why this exists

Rui's second test pass, 22-10-2026. Each item is small; one session clears them, one commit each.

### The items

#### A · Instalações list: the site's name is a link to its configuration

- On each site card (`facilities/page.tsx`), the `<h2>` with the site's name becomes a `FromLink` to `/dashboard/facilities/<id>`, the same place *Configurar* goes. Nothing else moves or changes appearance; the name just underlines on hover and is focusable.
- Only when the reader may open the site (`canOpenSite`). Otherwise it stays plain text.

#### B · Site configuration page: no Energia tab

- Remove the `energy` tab from `facilities/[facilityId]/page.tsx`. Energia has its own page (`/dashboard/energy`), which already lists every site's meters.
- **Watch out:** the meter, bill and new-bill pages fall back to `…/facilities/<id>?tab=energy` for Voltar (`backTarget` fallbacks). Change those fallbacks to `/dashboard/energy`. `lib/back.ts` LABELS already has `/dashboard/energy`.
- The *Abrir* / per-site energy panel on the Energia page stays.

#### C · Dashboard: the subscription card is discreet

- The subscription widget (`widgets.tsx` ≈ l.144, registry band `management`, roles `['owner']`) is already owner-only; it is its prominence that's wrong. Make it a **compact card at the end of the management band**: one line with the plan and status, and *Ver subscrição*. No large figure, no emphasis colour, unless the status needs attention (trial ending, payment failed), in which case the existing warning styling applies.
- The focus of the dashboard is what's happening at the pool (POOLSE-66).

#### D · Menu: *Aulas de reposição* moves under Turmas

- In `app-sidebar.tsx` the entry `/dashboard/classes/reposicoes` sits in the **Alunos** group (≈ l.376). Move it to the **Turmas** group, after Épocas. The route already lives under `/classes`, and `lib/back.ts` already labels it. Update `docs/features/navigation.md`.

#### E · The new I-beam is too heavy

- POOLSE-95's `ibeam.svg` reads as bold. Redraw it at regular weight: a 1 px stem and 1 px serifs with the 1 px white outline, like the OS default but outlined. Keep the hotspot centred on the stem. Check on a 100 % and a 150 % Windows display.

### QA — scenarios

1. **A:** Clicking a site's name opens its configuration page, and Voltar returns to the list.
2. **B:** No Energia tab on the site page; from a bill, Voltar lands on Energia.
3. **C:** As an owner, the subscription card is one line at the end of the management band; as an admin, it is absent.
4. **D:** *Aulas de reposição* appears under Turmas and nowhere else; the page still opens and Voltar still names it.
5. **E:** The pointer over a field looks like a normal I-beam with a faint outline, in light mode.

### Acceptance criteria

1. Items A–E done, one commit each.
2. `layout:check`, `check-contrast` and the phone specs pass; both languages, light and dark.

### Open questions

- None.

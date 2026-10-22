# POOLSE-92 · Instalações: a round of fixes from the 22-10 test pass

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bugs + small UX · **Area:** Instalações / Dashboard / Incidentes · **Priority:** Medium · **Depends on** — (the Voltar items are in [POOLSE-91](./POOLSE-91-back-returns-to-where-you-came-from.md))

### PO — why this exists

Rui's manual test pass on 22-10-2026 found small things on Instalações and its configuration page. Each fix is a few lines. They are grouped here so one session clears them. Larger items have their own tickets: Ocupação (POOLSE-93), Como pagar (POOLSE-94), the cursor (POOLSE-95), the lifeguard week (POOLSE-96), the staff files (POOLSE-97) and loading feedback (POOLSE-98).

**Not in scope:** making space types configurable (see open question 2).

### The items

Each item is one commit and one QA scenario.

#### A · Dashboard: the "Espaços" link lands on the site's Espaços tab

- **Now:** the Manutenção widget links with `siteHref(scope, 'spaces')` (`dashboard/widgets.tsx` ≈ l.683). When the dashboard is on *all sites*, `siteHref` drops the tab and returns `/dashboard/facilities`, the list.
- **Fix:** in single-site scope, go to `/dashboard/facilities/<id>?tab=spaces`. In all-sites scope, go to the site with the most overdue spaces. If that's ambiguous, show one link per site in the card. Add `withFrom(…, '/dashboard')` (POOLSE-91).
- Also check: the link sits on the *maintenance* widget, but its target is *spaces*. If the label says Manutenção, the target should be `?tab=maintenance`. Make label and target agree.

#### B · Site card on the Instalações list: no Espaços / Manutenção / Energia links

- Remove the `<nav>` of tab links from each card (`facilities/page.tsx` ≈ l.229–254). They are reached from the site's configuration page only (Rui, 22-10-2026).
- **Watch out:** the code comment says *"Maintenance has no Configurar button, so these are its way in."* The maintenance role has `canOpenSite` but not `canManage`. Removing the links leaves it with no way into the site page. Show a quiet **Abrir** button where `canOpenSite && !canManage`, so the maintenance role still gets in.

#### C · Site card: "Adicionar piscina" above the photographs

- Move the *Add pool* link to directly after the tank list, before the *Fotografias da instalação* block.

#### D · Site card: more space before *Fotografias da instalação*

- Give the photographs block a clearly larger gap from what is above it: `mt-4` → around `mt-8`, plus the existing rule. Check it on a phone too (POOLSE-88).

#### E · Configuration page: the section pills stay in view while scrolling

- When a tab has sub-sections (*Preços*: Mensalidade, Quota, Inscrição, Natação livre, Categorias, Pagamentos; and any other tab using `SectionPills`), the pill row **sticks** under the app bar and the tab strip when the content scrolls, like a frozen pane.
- One change in `components/section-pills.tsx` (sticky, `top` = app bar + tab strip height, opaque background), so every tab using it gets it. On a phone, check it doesn't stack too high with the sticky title from `page-shell.tsx`.

#### F · Espaços tab: the card is open by default

- `spaces-panel.tsx` starts collapsed (`useState(false)`, ≈ l.106). On the site's Espaços tab it starts **open**. If the same component still renders anywhere else as a summary, pass `defaultOpen` per caller rather than changing every caller.

#### G · Regulamento: "Publicar nova versão" is a button

- Today the publish form (`PublishRegulationForm`) is laid out inline under the versions. Make it a primary button at the side of the tab's header, *Publicar nova versão*, which opens the form in a dialog or side sheet, pre-filled with the current text. The version history stays the body of the tab. Owner and admin only, as today.

#### H · Incidentes: after recording, go to the list

- `incident-form.tsx` ≈ l.136 does `router.push('/dashboard/facilities/incidents/<id>')` after a create. Change it to the incidents list, keeping its site filter if there was one. Keep the success toast, and give the new row a brief highlight so the person sees it landed.

### QA — scenarios

1. **A:** Given the dashboard in single-site scope, when I click the widget's link, then I am on that site's matching tab.
2. **A:** Given all-sites scope, the link never lands on the bare Instalações list.
3. **B:** Given an owner, the site card shows no Espaços/Manutenção/Energia links. Given the maintenance role, the card shows *Abrir*, and it opens the site page.
4. **C/D:** *Adicionar piscina* sits above the photographs, with a visible gap before them, on desktop and phone.
5. **E:** On Preços, scroll down a long Mensalidade list: the pills stay visible and clicking one switches section. The same holds in dark mode and on a phone.
6. **F:** Opening the Espaços tab shows the spaces without a click.
7. **G:** On Regulamento, *Publicar nova versão* is a button. Publishing from it adds a version, and a non-manager never sees it.
8. **H:** Recording an incident lands on the list with a success toast, and the new incident is first.

### Acceptance criteria

1. Items A–H done as described, each with its QA scenario passing.
2. `layout:check` and `check-contrast` pass; both languages, light and dark.
3. The phone specs (`phone-*.spec.ts`) still pass.

### Open questions

1. **A:** in all-sites scope, should the link go to the "worst" site, or should the card list one link per site? Recommended: one per site, as long as there are 3 sites or fewer.
2. **Space types (Rui asked where they are configured).** They are **not configurable**. `space_type` is a fixed Postgres enum: `changing_room`, `technical`, `storage`, `reception`, `outdoor`, `other` (migration `1788048000000_spaces-and-maintenance.sql`), and the labels are i18n keys. Making them per-club would need a `space_type` table per tenant, a migration of existing rows, and a settings screen. Do you want that? If so, it becomes its own ticket.

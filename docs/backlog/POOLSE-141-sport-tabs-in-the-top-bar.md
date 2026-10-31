# POOLSE-141 · A club with two or more sports gets the handoff's sections: Instalação and a tab per sport in the top bar, the sidebar showing the chosen one

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Global / Navigation / Design · **Priority:** High (pre go-live) · **Depends on** [POOLSE-125](./POOLSE-125-navigation-per-sport.md) (per-sport entries, `?sport=`), [POOLSE-139](./POOLSE-139-backoffice-frame-from-the-handoff.md) (the top bar and its empty middle) · **Spec** `docs/design/README.md` *Backoffice top bar*, *Backoffice sidebar*, *Backoffice shell*, *Multi-sport rules*; `docs/design/designs/PoolseTopBar.dc.html`, `PoolseSidebar.dc.html`

### PO — why this exists

> "on the piscinas do juncal, there are 2 sports, so it should be on the top nav bar right, like the design?" — Rui, 31-10-2026

It should. POOLSE-125 gave each sport its own group of menu entries in the sidebar; the handoff's sections — *Instalação* and a tab per sport in the top bar, and a sidebar that shows only the section chosen — were never ticketed. POOLSE-139 left the top bar's middle empty for them. Rui chose (31-10-2026) to run the stabilising sweep first and build this after.

**Not in scope:**
- Anything for a pool-only club: it renders exactly as today (the handoff's own rule).
- *Métricas* (the handoff's fourth sport page) — no such page exists.
- Material Symbols; Lucide icons at the handoff's sizes, and the padel SVG from the handoff if padel is on.
- The app's per-sport screens (POOLSE-127).

### BA — rules

1. **Only with two or more enabled sports** (`/me.sports.length > 1`). One sport: no tabs, no sport labels, no wash.
2. **The top bar's middle:** *Instalação* (a building icon), a 1 × 20 px separator, then one tab per enabled sport in catalogue order (its icon + name, 19 px icon, 13 px; inactive 500 muted, active 600 ink). The current one has a 3 px bar at its foot — `--primary` under *Instalação*, the sport's `--sport-wash` solid under a sport — and a sport tab's background is the wash at `--wash-a`.
3. **Which section is current** is derived, never stored: a page that is `perSport` (POOLSE-125's entries) with `?sport=x` is section *x*; every other page is *Instalação*. A tab is a link to its section's first page (*Instalação* → *Painel*; a sport → its *Calendário*, `?sport=x`).
4. **The sidebar shows only the current section.** *Instalação*: *Painel* and the shared pages (Alunos, Staff, Faturação, Energia, Instalações, …). A sport: a 44 px header (4 px left border in the sport's colour, the wash behind, icon + name, Poppins 600 14 px), then that sport's `perSport` entries (*Calendário*, *Turmas*, *Recintos*). Attention dots keep working in both.
5. **A sport section's content area** gets `data-sport="x"` and `.sport-shell` (the wash over `--background`, from 138). Shared pages never do. The wash is atmosphere only: never on a button, a text or a primary colour; the sport's name and icon always say which sport.
6. **Phone:** the same sections as a row of tabs at the top of the menu sheet (`MobileMenu`), the sheet listing the current section's entries.
7. **Permissions unchanged:** a section or entry a role cannot use is not offered (the same filter as today); hiding is not the control.

### Dev notes

- The groupings exist: `lib/nav-entries.ts` (`perSport`, `groupBySport`) and `useCurrentSport()` in `app-sidebar.tsx`. Add a `currentSection(pathname, search, sports)` beside them; the top bar's tabs (a client component in the bar's middle slot, `(app)/dashboard/layout.tsx`) and the sidebar's filter both read it.
- Sport icons: one `SportIcon` (Lucide stand-ins: waves for pool, a ball per court sport, dumbbell for gym; the handoff's padel SVG).
- `data-sport` / `.sport-shell` on the content wrapper from the same derivation, client-side, so the server layout stays as is.
- Most likely to be got wrong: a shared page reached with a stale `?sport=` showing a sport's wash; and the attention dot of a section that is not current disappearing — the tab should carry the dot when something inside it needs doing.

### QA

1. **Given** Piscinas do Juncal (pool + tennis) on *Painel*, **then** the bar shows *Instalação* (current, primary bar) | *Piscina* | *Ténis*; the sidebar shows the shared pages only; no wash.
2. **When** *Ténis* is tapped, **then** its *Calendário* opens with `?sport=tennis`, the tab is current with the tennis bar and wash, the sidebar shows the tennis header and its entries, and the content has the tennis wash.
3. **Given** a pool-only club, **then** the bar and sidebar are as before (screenshot).
4. **Given** a phone, **then** the sections are a row at the top of the menu sheet.
5. **Given** an instructor in Juncal, **then** only sections and entries their roles reach are offered.
6. Light and dark; the wash pairs pass AA (the handoff's own check, re-run in `contrast:check`).

### Acceptance criteria

- [ ] Sections in the top bar only with 2+ sports; pool-only unchanged.
- [ ] Sidebar filtered to the current section, sport header per the handoff.
- [ ] Sport pages washed, shared pages not; name and icon always present.
- [ ] Phone menu carries the sections; permissions unchanged; both themes; contrast checked.

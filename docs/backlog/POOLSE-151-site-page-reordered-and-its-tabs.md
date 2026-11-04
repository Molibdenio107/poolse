# POOLSE-151 · The site page leads with the club, then its photos, then a *Desportos* tab; insurance, payments and occupancy each get their own shape

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Facilities / Site page · **Priority:** Medium (pilot) · **Depends on** [POOLSE-150], [POOLSE-92] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026, testing week: "'Facilities' should have the 'Club de Santo Tirso' upfront to configure the site, then the photo sections, and then have a sub menu 'sports' where the user see what sports the facility have"; "'joining and insurance' should have insurance own sub menu tab"; "'Payments' sub menu should have 'payments' and 'periodicities' collapsed by default"; "'Occupancy' should then display the sports available and only then display information, because there's a redirect link below to move to a calendar and should be specified of which sport calendar".

The site page is the club's configuration surface and it opens on the wrong thing first. The order the owner reads it in is: the site itself, how it looks, what it offers.

**Not in scope:** moving any address, endpoint or permission; the tabs' content beyond what is named below; the Instalações *list* (POOLSE-150 settled it).

### BA — rules
1. The site page's *Geral* tab opens on the site's own card (name, address, timezone, hours) first, then *Fotos* as the second block, then a *Desportos* block listing the sports the club has on with a link to each sport's recintos (`/dashboard/recintos?sport=`). (Rui, 04-11-2026)
2. Under *Preços*, *Seguro* is its own section pill; *Inscrição* keeps its own. The *Inscrição e seguro* combined panel goes. Values stay `canSeeValues`-gated as today.
3. Under *Pagamentos*, the *Pagamentos* (IBAN/MB WAY) and *Periodicidades* panels are each a `<details>` closed by default; opening one is remembered nowhere (every visit closed).
4. *Ocupação* opens on a sport chooser (one chip per enabled sport, `SportChip`) and shows its figures only once a sport is chosen; the *Abrir o calendário* link below names the sport and goes to that sport's calendar. A single-sport club skips the chooser and the link still names the sport.
5. Nothing a maintenance login sees changes: it still opens Espaços, Manutenção and Energia only.

### Dev notes
- `apps/web/src/app/(app)/dashboard/facilities/[id]/` — `DetailPage` tabs; reorder blocks inside the *Geral* tab, do not add a tab. *Desportos* reads `/me.sports` (POOLSE-124) and `isMultiSport`.
- Section pills via `SectionPills` (`?section=`); insurance becomes a section of *Preços*. Keep `sectionHref` so the other params survive.
- `<details>` in rule 3 animates through `DetailsAnimator` already mounted; nothing to add.
- Occupancy: `readOccupancy*` already takes a recinto; filter by the recintos of the chosen sport (`playing_area.sport_id`). The calendar link is `/dashboard/calendar?sport=` through `FromLink`.
- Trap: POOLSE-150 removed the site page's Piscinas/Recintos tabs — do not bring a tank list back under *Desportos*; it links out only.
- Palette: no new entries; existing ones keep their hrefs.

### QA
1. Given an owner on the site page, when it opens, then the site card is first, photos second, *Desportos* third with one link per enabled sport.
2. Given a pool-only club, when *Desportos* renders, then it shows Natação alone and the link goes to Piscinas.
3. Given *Preços*, when the pill row renders, then *Seguro* and *Inscrição* are separate pills and an instructor sees names without values in both.
4. Given *Pagamentos*, when it opens, then both panels are closed; opening one leaves the other closed.
5. Given a two-sport club on *Ocupação*, when no sport is chosen, then no figures show and the calendar link is absent; choosing Ténis shows its recintos' figures and a link reading *Calendário de Ténis*.
6. Given a maintenance login, when the site page opens, then only Espaços, Manutenção and Energia exist (snapshot unchanged).
7. Both themes on *Geral*, *Preços* and *Ocupação*.

### Acceptance criteria
- [ ] Geral order: site → photos → Desportos.
- [ ] Seguro is its own section under Preços.
- [ ] Pagamentos panels closed by default.
- [ ] Ocupação asks the sport first (multi-sport) and the calendar link names the sport.
- [ ] Maintenance view unchanged; both themes checked; i18n for every new label.

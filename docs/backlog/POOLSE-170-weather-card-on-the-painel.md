# POOLSE-170 · The Painel shows the weather at the site being looked at: now, today's high and low, the next three days

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Dashboard · **Priority:** Medium (pilot) · **Depends on** [POOLSE-66], [POOLSE-12] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "it would be nice to have a small section on the dashboard, since it's the home page of a logged owner/admin, display the weather like we have for the facility detail page."

Decided the same day (Rui): every role sees it, in the operational band; it follows the dashboard's site selector; now + today's high/low + three days; the API's shared per-city cache, no switch.

**Not in scope:** weather history or degree-days (5.4b); alerts on weather; a widget per site.

### BA — rules
1. Widget `ops.weather`, operational band, every role, `kinds` both. It is decoration: it is never escalated and never ranked above the pool's card; it is the last of the band's four when present.
2. The site is the reader's `membership.dashboard_facility_id`, else the club's first site; a site with no coordinates makes the resolver answer `null` (card absent, not an error).
3. Content: the condition icon and word (`weatherKind`, one function), the temperature now, today's high/low, a wind flag past `WINDY_KMH`, and three day columns (day name by `formatDayMonthShort`, icon, high/low). The card's title is the site's city, and it links to the site's *Geral → Meteorologia* section.
4. The forecast fails quietly: a provider error is the `error` card, muted, with its usual sentence.
5. Below `md` the three days sit in one row; nothing is hidden.

### Dev notes
- Registry declaration + one case in `widgets.tsx`; the resolver calls the same API weather read the site panel uses (the cache the API holds, keyed on rounded coordinates), inside the 2 s ceiling.
- `WeatherIcon` / `WindIcon` / `weatherKind` from `components/weather-icon.tsx` — never a second bucketing.
- Trap: `widgetsFor` caps at four per band after escalation; a card with something to say outranks an empty one, so weather must never claim a slot from a card that has work in it — give it the lowest rank in the band.
- No new env var; the non-commercial note in `docs/deploy.md` already covers the provider.

### QA
1. Given an owner with the selector on site A, when the Painel loads, then the card names A's city and shows now, high/low and three days.
2. Given a site with no coordinates, then no `ops.weather` in the raw JSON.
3. Given the provider times out, then the muted error card and every other card unaffected.
4. Given a guardian, then the card is present (every role) with the same content.
5. Given four operational cards with work plus weather, then weather is the one left out.
6. Phone row, both themes; icons carry their word.

### Acceptance criteria
- [ ] Declared widget, every role, operational band, lowest rank.
- [ ] Follows the selector; absent without coordinates; quiet on failure.
- [ ] Shared cache, no new fetch path; `docs/features/dashboard.md` updated.

# POOLSE-140 · The app wears the handoff's own palette and its child cards — tinted ground, the app's ink, avatars on Início

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Design · **Priority:** High (pre go-live) · **Depends on** [POOLSE-136](./POOLSE-136-the-app-phone-shell.md) (8758676), [POOLSE-138](./POOLSE-138-design-tokens-from-the-handoff.md) · **Spec** `docs/design/README.md` *Design tokens* (App light / dark), *App: Início*

### PO — why this exists

POOLSE-136 said the app's own design pass is "the next ticket" and no ticket existed. Rui, 31-10-2026, after 138 and 139: *"alright go!"* — on the slice named as the next one: the tinted background and *Início*'s cards.

The handoff gives app mode its own ground and ink: a tinted background (`243 247 247`) under white cards, text in the app's dark teal (`#1f3f48`) and a muted tone to match — which is what makes the borderless cards from 138 read as cards on a phone. And *Início*'s child cards carry an avatar.

**Not in scope:**
- The child card's age and sport line ("13 anos · 2 modalidades") and its segmented sport strip: neither the age nor a child's sports is in `GET /app/agenda`, and this ticket adds no data. Written down for POOLSE-127, which brings the per-sport app.
- The sport screen, the *Modalidades* sheet, the hexagon (POOLSE-127).
- The backoffice palette, which the handoff leaves unchanged.

### BA — rules

1. **App light palette** under `[data-surface='app']`: background `243 247 247`, foreground `31 63 72`, muted foreground `90 112 120`; cards stay white. The app's ink (`--app-primary-ink`), the fill (`#4FA3C7`, 138) and the accent are unchanged. **App dark** is the backoffice dark the handoff already lists — nothing changes in dark.
2. **Every pair is contrast-checked**: foreground and muted foreground on the tinted background and on a card, both AA (4.5:1), as lines in `check-contrast.mjs` `PAIRS`.
3. **Início's child card** (the handoff's): a 44 px round avatar with the child's initials (a wash of the app fill, ink initials), the name at 17 px 700, and *Próxima: …* muted. Several children: the card is the link to that child's agenda, as now.
4. **Only app mode changes.** The backoffice and the public pages read their own palette (snapshot sweep).

### Dev notes

- Tokens: `--app-background`, `--app-foreground`, `--app-foreground-muted` next to `--app-primary` in `globals.css` (light only; dark maps to the backoffice values), and `[data-surface='app']` points `--background`, `--foreground`, `--foreground-muted` at them — the POOLSE-90 pattern, so no component is restyled by hand.
- Initials: the same rule the staff and student avatars use (`IdPhoto`'s fallback) — reuse it rather than writing a second one.
- Most likely to be got wrong: a component in app mode that reads `bg-background` for a surface that should be a card, now visibly tinted. Read the screenshot sweep for it.

### QA

1. **Given** app mode in light, **then** the page is tinted, cards white, text dark teal, both pairs AA.
2. **Given** app mode in dark, **then** unchanged.
3. **Given** a guardian of two, **then** *Início* shows two cards each with an avatar, the name and *Próxima*.
4. **Given** the backoffice, **then** unchanged (screenshots).
5. `phone-app.spec.ts` green on both phones.

### Acceptance criteria

- [ ] App light palette from the handoff, tokens only, contrast-checked.
- [ ] *Início*'s child cards with the avatar.
- [ ] Backoffice and dark unchanged; phone-app spec green.

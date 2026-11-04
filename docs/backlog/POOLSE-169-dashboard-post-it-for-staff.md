# POOLSE-169 · A *post-it* on the Painel: a note from the office to the people who work here, pinned until taken down

> **Reshaped 04-11-2026 (Rui): "it has nothing to do with Avisos."** Built as a staff board — any employee pins a post-it (`staff_note`), every employee sees it at the top of the Painel, its author or the office takes it down, never edited, four paper colours, writing kept apart in *Novo recado*. The BA rules below (audiences, office-only writers) are superseded; `docs/features/dashboard.md` is the behaviour.
>
> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Dashboard / Messages · **Priority:** Medium (pilot) · **Depends on** [POOLSE-166], [POOLSE-66] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "add a 'post it note' card in the dashboard for internal communications (from admin to maintenance etc.). The admin sees something and wants to communicate for everyone to see, so it displays on the dashboard."

Same shape as an aviso — an `app` message with a window — aimed at staff instead of families, drawn as one widget. One table, one audience rule, one archive.

**Not in scope:** replies or threads; per-person acknowledgement; email.

### BA — rules
1. `message_audience` gains `staff` (every working role: owner, admin, instructor, maintenance) and `role` (one role, `role_target`). Only `channel = app` may use them (CHECK); `message_recipients()` resolves them from live memberships, support excluded.
2. Widget `mgmt.notes` — **Open:** which band? Default: a *trailing* widget in the operational band so every worker sees it, never ranked above the pool (CLAUDE.md: none trailing since 28-10; this reintroduces one, said out loud). Shows the live notes (window as POOLSE-166), newest first, max 3, link *Ver todos* to Alunos → Avisos filtered to staff.
3. Writers: owner and admin. Ending it: archive, owner/admin, through the bin.
4. Rendered as the handoff's card with a soft-orange wash (`--app-*` accent on the backoffice surface is new — one token, both themes, contrast pairs added), the author's name and the date.
5. The maintenance home `/app/manutencao` and the instructor home `/app/aulas` show the same notes as their first card.

### Dev notes
- Registry declaration + one case in `widgets.tsx`; resolver reads `message` where `channel='app' AND audience IN ('staff','role')` ∩ reader's roles; `null` when none → the card is absent (trailing widgets are one line, never empty).
- Migration extends POOLSE-166's; `role_target member_role`.
- Trap: `widgetsFor` applies roles before resolvers — a guardian never sees it; assert on raw JSON.

### QA
1. Given admin posts a staff note, when maintenance opens the Painel, then the card shows it; a guardian's payload has no `mgmt.notes`.
2. Given a `role = maintenance` note, then an instructor's Painel lacks it.
3. Given the window has passed, then absent everywhere.
4. Given instructor, when posting a staff note, then 403.
5. Both themes; the wash passes `contrast:check`.

### Acceptance criteria
- [ ] Audiences `staff` / `role`, app-only, resolved by `message_recipients()`.
- [ ] Widget declared, trailing, absent when empty; app homes show it.
- [ ] Office-only write/end; tests above; `dashboard.md` updated.

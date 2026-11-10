# POOLSE-212 · A bell beside the search lists what needs doing and opens where to do it

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** App shell / Attention · **Priority:** High (pre go-live) · **Depends on** POOLSE-120 (attention), POOLSE-211

### PO — why this exists

Rui, 10-11-2026: *"Another good system to add to Poolse, would be a small notification icon besides the search bar on top right corner, to see whats going on and then redirecting to the problem when clicked. But keep the blinking animation we already have for the respective pages, its only removed when the issue is solved, either via notification icon or going directly to the screen."*

The dots tell you *where*, one menu entry at a time. Nothing tells you *what* in one place.

**Decided (Rui, 10-11-2026):** the bell reads the same attention map as the dots. Whatever lights a dot for this person lights a line in the bell, a teacher's own lessons included. There is no "mark as read": a line goes when the thing is solved, as the dots do.

**Not in scope:** push or email for these (POOLSE-86 and 3.0 keep their own); a history of past notifications; per-person mute.

### BA — rules

1. **One source.** The bell lists `attention.menu`'s kinds, each as one line: its count in words (*2 tanques com água fora dos limites*, *3 pedidos de inscrição*, *1 turma sem professor*, *4 respostas das famílias*…), linking to the page where that kind's dot breathes. A sport's copy (`leads:tennis`) is its own line, named with its sport.
2. **The icon** sits left of the search in the app bar, desk and phone. With anything listed it carries the breathing dot (never a number in red, never a sound); with nothing, it is still and its menu says *Nada por tratar*.
3. **Opening** is a menu (`DropdownMenu`), keyboard reachable, each line a `FromLink`. The icon has a visible name for screen readers (*Notificações*); the menu lists, it never only informs by tooltip.
4. **Clearing** is the solving: the page's own dot and the bell's line go together on the next read. Following a line changes nothing by itself.
5. **Only who can act** sees a line, as the dots: the attention scope decides, and the bell adds no query of its own.
6. **Ctrl+K** gains *Notificações*, opening the menu.

### Dev notes

- Web only: `components/notification-bell.tsx`, a client component fed the menu map by the layout (the layout already reads `/shell`, which carries `attention`; no new request, per "the layout reads /me and GET /shell, and nothing else").
- A small registry `lib/attention-items.ts`: kind → { i18n key with plural, href, sport-aware }. A kind the registry does not know is not shown (and a test lists the API's kinds against it so a new one cannot be forgotten).
- App bar: beside `SearchTrigger` in the backoffice bar and the app frame's header.

### QA

1. Given pedidos waiting and a tank out of range, when the owner opens the bell, then two lines show with their counts and each opens its page.
2. Given nothing to do, then the icon is still and the menu says *Nada por tratar*.
3. Given a teacher with a *Não vou* on their lesson, then the bell lists it; the office's kinds are absent.
4. Given a line is solved on its page, when the next page loads, then the line and the dot are gone.
5. Keyboard: Tab reaches the bell, Enter opens it, arrows move, Enter follows. Light and dark.

### Acceptance criteria

- [ ] Bell in the backoffice and app headers, beside the search.
- [ ] One line per attention kind, worded and linked by a registry with a completeness test.
- [ ] No extra request; clears only when solved.
- [ ] Ctrl+K *Notificações*; pt-PT and en.

# POOLSE-108 · A student's week: dates written out, and "previous week" stays on the week tab

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug + UX · **Area:** Students · **Priority:** Medium · **Depends on** [POOLSE-96](./POOLSE-96-lifeguard-week-as-a-grid.md) (`formatDateRange`)

### PO — why this exists

Rui, 22-10-2026, on the student detail page's *Semana* tab:
- the week should be written out, as on the calendar;
- *"there seems to be a bug when clicking 'previous week': it redirects to the 'general' tab."*

### BA — what happens

`students/[id]/student-week.tsx` steps weeks client-side and keeps the URL truthful with:

```ts
window.history.replaceState(null, '', `/dashboard/students/${studentId}?week=${target}`);
```

That URL **drops `?tab=week`**. Anything that re-reads the URL afterwards (a server action's re-render, the busy indicator's link status, a reload, Voltar from elsewhere) resolves the tab from the query string, finds none, and lands on *Geral*. Also lost: `from` (POOLSE-91), so Voltar after stepping goes to the default parent.

### Rules

1. Stepping a week keeps **every other query parameter** (`tab`, `from`, anything else) and changes only `week`.
2. The week heading uses `formatDateRange`; day headers use the weekday plus `formatDayMonth`.
3. Keyboard: ← → on the stepper work as today.

### Dev notes

- Build the URL from `new URL(window.location.href)`, set `searchParams.set('week', target)`, and `replaceState` with that. One line.
- A unit test on the helper that builds the URL, and a Playwright step: open `?tab=week`, click previous, reload, still on *Semana*.

### QA — scenarios

1. **Given** the week tab, **when** I click previous week twice and reload, **then** I'm still on the week tab, two weeks back.
2. **Given** I arrived from Turmas, **when** I step a week and click Voltar, **then** I land on Turmas.
3. The heading reads *16 a 22 de novembro de 2026* / *16–22 November 2026*.

### Acceptance criteria

1. Stepping never changes the tab or loses the origin.
2. Dates written out.

### Open questions

- None.

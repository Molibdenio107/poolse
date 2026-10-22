# POOLSE-111 · Competição: the times table you can see, a year picker for age groups, and what "import results" can read

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX + question · **Area:** Students / Competition · **Priority:** Low · **Depends on** [POOLSE-81](./POOLSE-81-competition-pathway-and-meet-results.md), [POOLSE-85](./POOLSE-85-gap-to-qualify.md)

### PO — why this exists

Rui, 22-10-2026:
- *"Qualifying times should have a style selector (crawl, butterfly, etc.)."* Then, 22-10-2026 evening: *"I don't see any table there."*
- *"Age groups 'born from' / 'born up to' should be a year selector dropdown, like a slot machine, not filling the page."*
- *"Should importing results also accept PDF, Excel, etc.? Why only .lef or .lxf?"*

**What exists.**
- **Times** (`minimos/[id]/page.tsx`, *Tempos* tab): a grid with one row per FPN individual event (stroke × distance) and a column per course (25 m / 50 m), so every stroke is already a row. **But the grid only renders once the season has age groups.** With none, the tab shows one sentence and a link to *Escalões*, so an owner on a fresh club opens Mínimos → a standard → Tempos and sees no table at all. That is what Rui saw. The "style selector" was a request for a screen that shows what it is for.
- **Age groups**: *born from* / *born up to* are 4-digit text fields.
- **Import results** (`import-meet.tsx` ≈ l.144): `.lef` / `.lxf` only. That is **LENEX**, the format every FPN meet and the national ranking system export, and the only one that carries the swimmer's licence number, the event, the course and the exact time in a structure that can be matched to a student without guessing. A PDF of results is a picture of that data; an Excel is whatever the organiser typed.

**Not in scope:** relay events; reading a results PDF by AI (see open question 2).

### BA — rules

1. **The times table is always visible.** On *Tempos*, with no age groups yet, the grid renders anyway with every event row greyed and the cells disabled, under a notice: *"Esta época ainda não tem escalões FPN. Os tempos são por escalão."* Beside it, one button, **Criar os escalões FPN desta época**, which creates the standard FPN groups for the season in one click (the same set *Escalões* offers), then reloads with the first group selected and the grid live. The link to *Escalões* stays for a club with custom groups.
   - *Tempos* is the **default tab** of a standard once it has groups; *Geral* stays first in the strip.
   - The group pills above the grid say *Escalão:* before them, so it is clear the table is per group.
2. **Year picker:** *born from* / *born up to* become a **scrollable year wheel** (the slot-machine idea): a compact listbox showing ±5 years around the current value, scroll or arrow keys to move, typing jumps to a year. Native `<input type=number>` as the fallback without JavaScript. Range validated: *from ≤ to*, and both within the last 100 years.
3. **Import formats:** keep LENEX as the import. Say so on the control, in one line: *"Ficheiro LENEX (.lef/.lxf), o formato que a FPN e o ranking nacional exportam."* Add a *Como obter o ficheiro* hint linking to the FPN results page.

### Dev notes

- 1: the one-click creation reuses the *Escalões* page's FPN seed action; the grid's disabled state is a prop on `EntryTimesGrid`. No migration.
- 2: one `YearWheel` component, reusable where a year is picked elsewhere (seasons).
- 3: copy only.

### QA — scenarios

1. **Given** a standard with no age groups, **when** I open *Tempos*, **then** I see the greyed event rows, the notice and the one-click button; clicking it creates the FPN groups and the grid becomes editable on the first group.
2. **Given** the year wheel, **when** I scroll to 2014 and tab out, **then** the field holds 2014; typing "20" then "15" jumps to 2015; *from* 2016 / *to* 2014 is refused.
3. The import control explains LENEX and links to where to get it.

### Acceptance criteria

1. The times table visible from the first visit, with one-click FPN groups; the year wheel; the LENEX explanation.
2. Both languages, keyboard operable, light and dark.

### Open questions

1. ~~Style selector~~ **Settled (Rui, 22-10-2026): the table wasn't visible at all.** BA-1 now makes it visible. A filter by stroke is not included unless Rui asks.
2. ~~Import formats~~ **Settled (Rui, 22-10-2026): LENEX only for the pilot.** BA-3 stands.

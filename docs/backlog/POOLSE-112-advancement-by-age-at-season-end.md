# POOLSE-112 · Advancement by age at the end of a season, and a queue worth opening

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Levels / Turmas · **Priority:** Medium · **Depends on** [POOLSE-19](./POOLSE-19-automatic-level-advancement.md), [POOLSE-06](./POOLSE-06-minimum-age-must-support-months-under-1-year.md) / [POOLSE-16](./POOLSE-16-raise-level-maximum-age-to-100-senior-demo-data.md) (level age bounds), [POOLSE-45](./POOLSE-45-draft-seasons-and-duplication.md) (seasons)

### PO — why this exists

Rui, 22-10-2026: *"The 'Advancement' page seems a bit useless. Can we improve it? For example, if a student is 9 and a season has passed, the advancement to the next level should be automatic, according to age."*

**What exists.** POOLSE-19's queue is driven by **skills**: a database trigger proposes when a student completes every skill of their level, and a person confirms. Criterion 7 of that ticket says advancement is never automatic without confirmation. The queue is empty whenever nobody records skills, which is most clubs most of the time, so the page looks useless.

**Two kinds of advancement exist in a real club:**
- **by skill**, mid-season, when a child is clearly ready (what POOLSE-19 does);
- **by age**, at the season change, when a child has outgrown the level's age band whatever their skills.

**Not in scope:** changing the skill trigger, or auto-enrolling into a specific turma (the person still picks the turma, as the queue does today).

### BA — rules

1. **Age proposals at season end.** When a season is published for the next year (POOLSE-45), every enrolled student whose age **on the new season's first day** is above their level's maximum age gets a proposal to the next level in the ordering (POOLSE-05), reason *idade*. A student also above the *next* level's maximum skips to the first level whose band fits.
2. **A club chooses how automatic it is**, a tenant setting on Níveis:
   - *Propor* (**default**, Rui 22-10-2026): the proposals land in the queue, a person confirms, as today;
   - *Aplicar automaticamente*: the proposals are applied on the season's first day, the student's new level is set, and the person only picks turmas. Every automatic application is audited and reversible for 30 days (POOLSE-78 undo).
3. **The queue page becomes useful even when empty:** it shows, per level, how many students are above the age band *now*, with *propor* buttons, and the date of the next season change with what will happen then under the current setting. An empty queue says *"Ninguém a aguardar. Na mudança de época a 15 de setembro, 12 alunos passam de nível por idade."*
4. **Guardians are told** (POOLSE-67 messages) when their child's level changes, with the reason.
5. A child **below** a level's minimum age is never proposed down; it's flagged on the level page instead.

### Dev notes

- The proposal table gets a `reason` (`skills` | `age`) and a `season_id`. The generator is one SQL function run when a season is published, and nightly for the *now* counts; idempotent (no duplicate proposals).
- Age at a date reuses the bracket helpers from POOLSE-33.
- Auto-apply runs under the same `confirmProposal` path with actor *sistema*, so audit and undo work unchanged.
- Role probe: owner/admin set the mode; office staff confirm; coaches read.

### QA — scenarios

1. **Given** a 9-year-old in a level with maximum age 8, **when** the next season is published, **then** a proposal with reason *idade* appears in the queue.
2. **Given** mode *Aplicar automaticamente*, **then** on the season's first day the level changes, the audit records *sistema*, and undo restores it within 30 days.
3. **Given** a student above two levels' bands, **then** the proposal targets the first level whose band fits.
4. **Given** an empty queue, **then** the page shows the per-level counts and the next season change line.
5. The guardian receives the message.

### Acceptance criteria

1. Age-based proposals at season change, with a per-club choice between proposing and applying.
2. The queue page is informative when empty.
3. Both languages, audit, undo, role probe, `docs/features/levels.md` updated.

### Open questions

- None. Default is *Propor*; *Aplicar automaticamente* is the setting one click away (Rui, 22-10-2026).

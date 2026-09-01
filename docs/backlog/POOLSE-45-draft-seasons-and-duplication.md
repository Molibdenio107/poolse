# POOLSE-45 · Draft seasons, and duplicar época

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Seasons · **Priority:** High — blocks POOLSE-44, 46

### PO — why this exists
Planning next season happens while this season is running. A club builds the 2026/2027 grid in June,
argues about it for three weeks, and switches over in September — and for those three weeks both
versions have to exist without the draft one showing up on anybody's calendar.

Poolse has seasons (POOLSE-07) but exactly one of them can be current, enforced by a unique index.
That was right when a season was only a container for turmas. It is wrong the moment the season also
owns a slot grid and a set of bookings, because then "planning next year" means editing the thing the
club is currently running.

**Not in scope:** the reset flow (POOLSE-07, unchanged), and anything about what a season contains
beyond slots and bookings.

### BA — rules and data
- `season` gains `status`: `draft`, `published`, `archived`.
- **Exactly one published season per organization.** Not per facility — see the Dev note. A club's
  season is its school year; a multi-site club does not run September-to-June at one pool and
  January-to-December at another, and making the season per-facility would mean migrating
  `class_group.season_id`, the seasons screen and the reset flow to buy a case nobody has asked for.
  Per-facility variation lives in the slot grid (POOLSE-44), which already carries `facility_id`.
- Any number of drafts may exist alongside the published one.
- **Publishing is atomic**: the draft becomes published and the previously published becomes archived,
  in one statement. A moment with two published seasons, or none, is a moment where every screen that
  filters by the current season is wrong.
- An archived season stays fully readable — POOLSE-07's rule, unchanged. Archived is not deleted.
- **"Duplicar época"** creates a draft from an existing season, cloning:
  - its `facility_time_slot` rows, for every facility and day group;
  - its bookings, with their lanes, categories and instructor assignments.
  It does **not** clone turmas, enrolments, sessions or attendance. Those belong to the year that
  happened.
- A booking cloned into a draft whose turma has since been archived keeps the reference; the draft
  shows it as needing attention rather than dropping it. The operator is planning — they want to see
  that Infantis B has no turma yet, not to find the row missing.
- Editing a draft never touches the published grid, and no dated session is ever generated from a
  draft. Session generation reads the published season only.
- **Open:** should a draft be visible to instructors, or only to owner/admin until published? A grid
  people can see but that is not the real one causes the wrong kind of question at poolside.
  *Recommendation:* owner/admin only until published, and say so on the screen.

### Dev — implementation notes
- ```
  season_status enum ('draft','published','archived')
  alter table season add column status season_status not null default 'published';
  update season set status = case when archived_at is null then 'published' else 'archived' end;
  drop index season_one_active;
  create unique index season_one_published
    on season (organization_id) where status = 'published';
  ```
- **`archived_at` stays.** It records *when* a season stopped being current, which the status does
  not, and POOLSE-07's migration and the reset flow both write it. Status is the state; `archived_at`
  is the timestamp. Do not collapse them — a season archived by the reset flow must keep its date.
- **Most likely to be got wrong:** the publish transition. It has to be one transaction that archives
  the incumbent and publishes the draft, and it has to be in that order or the partial unique index
  refuses the second statement. Write it as a single `UPDATE … FROM` or an explicit
  `SET CONSTRAINTS`-free two-statement transaction with the archive first, and test that a failure
  half way leaves exactly one published season.
- Duplication is a `SECURITY INVOKER` function or ordinary repository code inside one transaction —
  **not** a `SECURITY DEFINER` function. Nothing here needs to escape RLS; the caller is already
  scoped, and the skill's rule about `SECURITY DEFINER` being only for provisioning holds.
- Cloning bookings must clone `booking_lane` rows too, remapping nothing: lanes belong to pools, not
  to seasons, so the same lane ids are correct in the new season.
- Session generation (`generate_sessions`) gains a guard: it refuses a season that is not published.
  That guard is the thing standing between a draft and two hundred phantom sessions on the calendar.
- The Épocas screen gains the status, a "Duplicar" action and a "Publicar" action. Publishing asks
  for confirmation and names what it will archive.

### QA — test scenarios
- **45.1** Given a club with one season / When the migration runs / Then it is `published` and `archived_at` is unchanged.
- **45.2** Given a club with archived seasons / When the migration runs / Then each is `archived` and keeps its `archived_at`.
- **45.3** Given a published season / When a second is created as a draft / Then both exist and only one is published.
- **45.4** Given a published season / When a second is inserted directly as published / Then the unique index refuses it.
- **45.5** Given a draft / When it is published / Then it is published, the previous one is archived, and exactly one published season exists at every point a reader could observe.
- **45.6** Given a publish that fails part way / When it rolls back / Then the original published season is still published and the draft is still a draft.
- **45.7** Given a season with slots and bookings / When it is duplicated / Then the new season is a draft carrying copies of both, and no turmas, enrolments, sessions or attendance were copied.
- **45.8** Given a duplicated booking whose turma has since been archived / When the draft is read / Then the booking is present and flagged as needing attention.
- **45.9** Given a draft season / When session generation is asked to run for it / Then it is refused.
- **45.10** Given a draft being edited / When the published grid is read / Then it is unchanged.
- **45.11** Given an admin / When they publish / Then it succeeds. Given an instructor / Then the API refuses it.
- **45.12** Given tenant A's draft / When tenant B lists seasons / Then it is not returned.
- **45.13** Given pt-PT and en / When the Épocas screen renders / Then the three statuses and both actions exist in both.

### Built — decisions taken while building

- **A CHECK stops `archived_at` and `status` disagreeing.** Archiving used to *be* setting
  `archived_at`, so any writer still doing only that would leave a season looking current to
  the partial index and retired to a reader — and the next season could not be opened, with
  an error naming an index rather than the mistake. Refused rather than silently corrected:
  the write is wrong and being told so is more useful.
- **Three places in the product had the bug the CHECK now catches** — the reset, its preview,
  and where a new turma finds its season all read `archived_at IS NULL`, which after this
  ticket matches every plan for next year. The reset would have quietly retired somebody's
  June planning. There is a test for that specific regression.
- **Discarding a draft is a real delete**, and the only one in the product. A draft is a plan
  nobody acted on: no sessions, no registers, no history. The rule that history is never
  destroyed is about what happened, not about what somebody considered — and a draft holding
  turmas is refused, because by then it is not a scrap of paper.
- **The open question is answered: drafts are owner/admin only.** Not by hiding them — the API
  refuses every write — and the list stays readable, because which season is running is not a
  secret.
- `publish_season` lives in the database because the ordering *is* the correctness, and it
  should not be re-derived by the next caller.

### Acceptance criteria

1. `season.status` exists with `draft`, `published` and `archived`, migrated from the existing `archived_at` without losing a timestamp.
2. Exactly one published season per organization, enforced by a partial unique index rather than by application code.
3. Any number of drafts may coexist with the published season.
4. Publishing is atomic: the incumbent is archived and the draft published in one transaction, and no reader can observe zero or two published seasons.
5. An archived season remains fully readable, as POOLSE-07 requires.
6. "Duplicar época" clones slots and bookings — including their lanes — into a new draft, and clones no turmas, enrolments, sessions or attendance.
7. A cloned booking whose turma is archived is kept and flagged, not dropped.
8. Session generation refuses a season that is not published.
9. Editing a draft has no effect on the published grid, proven by a test.
10. Publishing and duplicating are owner/admin, enforced in the API.

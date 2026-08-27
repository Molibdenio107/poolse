# POOLSE-20 · Four-state skill progress

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Levels / Skills · **Priority:** High
**Borrowed from:** Jackrabbit (Not Started / Started / Tested / Attained, plus per-skill minimums).

### PO — why this exists

A boolean tells a parent nothing: their child either "has" a skill or does not, with no sense of movement between the two. Four states let an instructor record that a skill is being worked on and has been tested but not yet attained, which is what actually happens in the water. Instructors benefit most — the grid is built around a poolside pass, not a desk — and students and EE get a progress view worth opening. High priority because it is schema-shaped, blocks POOLSE-19, and gets more expensive every week it waits.

**Not in scope:** the advancement proposal itself (POOLSE-19); per-student skill notes or free-text assessment; parent-facing comparison against other students.

### BA — rules and data

- States are ordered: **Não iniciado → Iniciado → Avaliado → Adquirido**. Movement in either direction is allowed; a downgrade is a correction, is logged, and invalidates any POOLSE-19 proposal it undermines.
- `skill_progress` holds: tenant, student, skill, state, changed_at, changed_by, override_by, override_reason. It is a current-state row plus an append-only history — the history is what "timestamped and attributed" (AC 7) means.
- A skill may carry **dias mínimos** (distinct calendar days on which the student attended a turma teaching this skill) and **aulas mínimas** (count of attended occurrences). Both optional, both integers ≥ 0.
- *Adquirido* is blocked while either minimum is unmet. The override is available to Owner, Admin and the assigned Instructor, and records who overrode and when. An override never disappears from history.
- Minimums count **attended** occurrences only. A *falta justificada* does not count towards them; nor does an occurrence cancelled by a closure (POOLSE-31). A reposição attended as a guest **does** count, because the student was in the water.
- Skills belong to a level; a skill may carry one demonstration video link (URL only, no upload) shown to student/EE in the mobile app.
- Level labels are renameable per tenant. The stored key is stable; the display name is tenant data and must propagate to every progress surface, the mobile app, the printable sheet and POOLSE-19's proposals.
- Grid semantics: tapping a **column header** applies one state to that skill for every student on the roster in one pass; tapping a **row** opens that student across all skills. Bulk marking must not overwrite a state that is already further along unless the instructor confirms — silently downgrading a whole turma is the destructive case.
- Incremental save: each mark is its own write, queued locally and replayed on reconnect, with last-write-wins by client timestamp within a turma session.
- **Open:** none flagged in the source. Minimum thresholds are per skill, not per level, and the source does not ask for level-level minimums.

### Dev — implementation notes

- Migration: `skill` gains `min_days`, `min_lessons`, `video_url`; new `skill_progress` and `skill_progress_event`; the old boolean column migrates to *Adquirido* where true, *Não iniciado* where false. Tenant key on all of them.
- The state enum and its ordering live in one shared module used by the API, the grid, the printable sheet and POOLSE-19's completion check. Do not re-declare the order in the UI.
- API: `GET /turmas/:id/skill-grid` returns the whole matrix in one call (students × skills × state) — never one request per cell. `POST /skill-progress/batch` accepts an array of marks with client timestamps and returns per-mark results so a partial failure is visible.
- Offline queue lives in the mobile/tablet client with an idempotency key per mark, so replay after reconnect cannot double-apply. The server must accept the same key twice and return the first result.
- Permissions server-side on the batch endpoint: Owner, Admin, assigned Instructor. The override flag is a separate check on the same endpoint — an Instructor who may mark is not automatically an Instructor who may override, so decide it explicitly and enforce it there.
- Four colour tokens plus four icons, contrast-checked in light and dark, deliberately clear of the attendance palette (POOLSE-13) and the role palette (POOLSE-18). Icon plus text label everywhere; colour never alone.
- i18n: the four state names are keys in pt-PT and en; the tenant's custom level names are data and are never translated. The printable sheet needs its own locale-aware layout.
- Performance: the grid is a full turma × full skill set matrix. Fetch once, mutate locally, reconcile — a refetch per mark makes it unusable on pool wifi.
- Most likely to be got wrong: enforcing dias/aulas mínimas only in the UI. The batch endpoint must re-check them server-side, because the offline queue replays marks the client validated against stale attendance.

### QA — test scenarios

20.1 Given a skill with no minimums / When the instructor marks it *Adquirido* / Then it saves and the change is attributed to that instructor with a timestamp.
20.2 Given a skill with dias mínimos 4 and the student attended 3 days / When *Adquirido* is submitted via the API / Then it is rejected, and the same submission with a valid override succeeds and records the overriding user.
20.3 Given a student whose 4th attendance was a *falta justificada* / When the minimum is evaluated / Then it counts as 3 and *Adquirido* is still blocked.
20.4 Given an occurrence cancelled by a closure (POOLSE-31) / When aulas mínimas are counted / Then that occurrence does not count.
20.5 Given a student who attended a turma as a reposição guest / When aulas mínimas are counted / Then that attendance counts.
20.6 Given a Student-role token / When it POSTs to the skill-progress batch endpoint / Then `403`, regardless of the mobile app hiding the grid.
20.7 Given the grid open on a tablet / When the connection drops mid-turma and ten marks are entered / Then on reconnect all ten replay exactly once and none is duplicated or lost.
20.8 Given a column header tap that would downgrade three students already at *Adquirido* / When applied / Then the instructor is warned and those three are not silently downgraded.
20.9 Given a tenant that renamed its levels / When the grid, the printable sheet and the mobile app render / Then all three show the custom name.
20.10 Given the en locale and then pt-PT / When the four states render / Then labels switch between Not started/Started/Tested/Attained and Não iniciado/Iniciado/Avaliado/Adquirido, and the icons do not change meaning.
20.11 Given dark mode / When all four states appear in one grid / Then each is distinguishable by icon and text with colour removed, and none is confusable with *falta justificada* orange.
20.12 Given a skill with a demonstration video link / When a student views it in the mobile app / Then it opens; and when the link is absent / Then no empty affordance is shown.

### Acceptance criteria

1. Skill progress states: **Não iniciado / Iniciado / Avaliado / Adquirido** (Not started / Started / Tested / Attained), each with its own icon and colour token, distinct from the attendance palette (POOLSE-13) and the role palette (POOLSE-18).
2. Each skill carries optional **dias mínimos** and **aulas mínimas** — a skill cannot be marked *Adquirido* before those thresholds are met, with an override that records who overrode it.
3. Each skill may carry a demonstration video link, shown to the student/EE in the mobile app.
4. Instructor screen is a grid: students as rows, skills as columns. Tapping a **column header** marks that one skill across the whole turma in a single pass; tapping a **row** marks one student across all skills.
5. The grid works on tablet and phone, and saves incrementally — a lost connection mid-turma never loses entered marks.
6. A printable turma skills sheet exists for when the tablet stays dry.
7. Progress changes are timestamped and attributed to the instructor.
8. Level labels are renameable per tenant, and the custom names propagate everywhere progress is shown.

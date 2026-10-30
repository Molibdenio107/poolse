# POOLSE-135 · Lesson feedback rates with the sport's own glyph instead of faces

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Students / Multi-sport · **Priority:** Low (post go-live) · **Depends on** [POOLSE-116](./POOLSE-116-lesson-feedback-from-the-family-app.md) (built 27-10-2026), [POOLSE-122](./POOLSE-122-recintos-typed-playing-areas.md) · **Related** [POOLSE-127](./POOLSE-127-student-app-sport-tabs.md) (the per-sport feel in the app)

### PO — why this exists

Rui, 30-10-2026: *"Students should be able to give class feedback after each class, by rating with a star system and a small comment. Each sport should have something related with the sport instead of stars, like tenis ball, footballs, for swimming can be for example, strokes."*

The feedback itself already exists: POOLSE-116 built the 1–5 mood, the ≤ 500-character comment, the 7-day window, who answers for a minor and who reads it. What is new here is the **face of the scale**. Today it is five faces. Rui wants the scale to belong to the sport the lesson was in — five tennis balls for a tennis lesson, five footballs for football — so the app carries the sport's feel into the one screen a family answers most often. It is the same idea as the per-sport tint (POOLSE-127): the sport is recognised at a glance, the data underneath does not change.

**Not in scope:**
- Any change to what is stored. `lesson_feedback.mood` stays a 1–5 integer; no "stars" column, no per-sport scale length.
- Changing the rules of POOLSE-116 — window, who answers, who reads, retention. If any of those is wrong, that is a separate ticket.
- A club choosing its own glyph. The glyph is the sport's, from the catalogue; a club does not configure it.
- The push nudge (*Como correu a aula?*) — still deferred with POOLSE-116.
- Sports with no glyph drawn yet (handball, volleyball, gym): they keep the faces until someone draws one. No placeholder art.

### BA — rules

1. **The scale is the sport's.** A lesson's feedback form draws the 1–5 scale with the glyph of the sport of the recinto the lesson is in: `class_group.playing_area_id → playing_area.sport`. Pool → swimmer glyph; tennis → tennis ball; padel → padel ball; basketball → basketball; football → football. Any other sport, or a lesson whose recinto cannot be resolved → the five faces of today (Decided, Rui 30-10-2026: the sport decides the glyph; faces stay the fallback).
2. **A rating pattern, not five different icons.** Five copies of one glyph in a row; picking the third fills the first three and leaves two outlined — the star-rating gesture everyone already knows. The faces keep their current behaviour (one distinct face per value), because a filled-up row of faces means nothing.
3. **The word still carries the meaning.** The chosen value's word (*Muito mal … Muito bem*, the `feedback.mood.N` keys) is shown beside the row exactly as today, and each radio keeps its spoken label, so a screen reader says *Bem*, never *3 bolas*. Colour and fill never carry the value alone.
4. **Same glyph wherever that feedback is read.** The register strip (staff), the student's record tab, and the agenda's *Últimas aulas* strip draw the given value with the same sport glyph, as *3 of 5 filled*, never as a bare number. A reader sees at once which sport the comment was about when a child does two.
5. **Nothing changes for the pilot's pool-only club** apart from the glyph on the pool lessons; it keeps layout, sizes and the 44 px targets. With `enabled_sports = {pool}` the swimmer glyph is what every family sees.

**Open:** which glyph for the pool. Rui said *strokes*; a stroke is a motion and does not read as a countable unit at 28 px. Default: a **swimmer silhouette** (head and arm above a wave) filled 1–5, drawn once as an SVG in both themes — it says *swimming* and still counts. Decide before building; a goggles glyph is the other reasonable candidate.

### Dev notes

- **No schema, no migration.** `sport` already exists as the platform catalogue (`pool`, `tennis`, `padel`, `basketball`, `football`, `handball`, `volleyball`, `gym`); the glyph lives in web code keyed on `sport.id`, with `faces` as the fallback. Do not add an `icon` column to `sport` — a glyph is an asset of the web app, not data, and a new sport's row must not block on art.
- **API.** The three reads that carry feedback gain the lesson's `sport` (the `sport.id` string): `GET /app/lessons/:sessionId`, `GET /app/agenda` (`recent[]` items), `GET /sessions/:id/register` (`feedback[]` items) and `GET /students/:id/feedback` rows. Resolve it in SQL through `class_session.class_group_id → class_group.playing_area_id → playing_area.sport` — **not** through `class_session.pool_id`, which only answers for pools and would hard-wire the fallback for every other sport. One `LEFT JOIN`; null when the recinto is gone, and the client falls back.
- **Web.** `components/mood.tsx` becomes the one place that answers *how is a value drawn for sport X*: `moodGlyph(sport: string | null)` returning either `{ kind: 'faces', icons }` (today's `MOOD_ICONS`) or `{ kind: 'count', Glyph }` (one component drawn filled/outlined). `FeedbackForm` and the three read-side renders consume it; nothing else imports `MOOD_ICONS` directly afterwards. The count glyphs are inline SVGs under `components/sport-glyphs/`, `currentColor` only, so the existing `text-primary` / `text-foreground` classes theme them; checked in both themes.
- **i18n.** No new user-facing string if the mood words are reused. If the `aria` of the row needs a group label (*Avaliação da aula*), it is one key in both files.
- **Tier 1 phone rules stay**: each target `min-h-control` and 44 px wide, one row of five at the narrowest viewport, a line in `phone-app.spec.ts` per glyph kind.
- **Most likely to be got wrong:** resolving the sport from the pool. A tennis lesson has no `pool_id`, so any path through `pool` silently shows faces for every non-pool sport and the ticket looks built when it is not. Second: making the filled count the accessible name — the radios must keep the mood word.

### QA — scenarios

1. **Given** a pool lesson, **when** the guardian opens the feedback form, **then** five swimmer glyphs (or whatever the open point decides) in one row; picking the fourth fills four, and *Bem* is read beside the row and by the screen reader.
2. **Given** a tennis lesson in a club with tennis enabled, **then** five tennis balls, same behaviour.
3. **Given** a handball lesson, **then** today's five faces, unchanged.
4. **Given** a saved mood of 3 on a football lesson, **when** the instructor opens the register strip and the admin opens the student's record tab, **then** three of five footballs filled, with the mood word in the accessible name.
5. **Given** a child enrolled in pool and tennis, **when** the guardian opens *Últimas aulas*, **then** each row carries its own sport's glyph.
6. **Given** a lesson whose recinto was archived, **then** faces, no error.
7. **Nothing the pilot sees changes** beyond the glyph: snapshot of the feedback form and register strip for a pool lesson, sizes and layout identical.
8. Both themes, pt-PT and en, `iphone` and `android` projects; the outlined and filled states are distinguishable without colour (fill vs outline, never tint only).
9. Permission and tenant tests of POOLSE-116 still pass unchanged — this ticket adds no endpoint and widens no read.

### Acceptance criteria

- [ ] `moodGlyph(sport)` in `components/mood.tsx` is the one mapping; faces are the fallback; no schema change.
- [ ] Pool, tennis, padel, basketball and football lessons draw their glyph as a filled count; other sports draw the faces.
- [ ] The four feedback reads carry `sport`, resolved through the recinto, with an integration test for a non-pool lesson.
- [ ] The mood word remains the accessible name and is shown beside the row; both themes checked.
- [ ] Phone spec line per glyph kind; pool-lesson snapshots unchanged apart from the glyph.
- [ ] The pool glyph is decided (open point) before the build starts.

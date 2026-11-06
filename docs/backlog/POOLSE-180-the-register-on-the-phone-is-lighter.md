# POOLSE-180 · The register on the phone is lighter: no seguro or exame chips per row, the three states as one compact control — the warnings become one line at the top

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Staff / Attendance · **Priority:** Medium (pilot) · **Depends on** [POOLSE-88](./POOLSE-88-staff-on-the-phone.md), [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md), [POOLSE-13](./POOLSE-13-attendance-states-colour-scheme-drop-the-static-atrasado.md), [POOLSE-133](./POOLSE-133-exame-medico.md)

### As built (05-11-2026) — wins over what follows

- **`compact` comes from `?from=/app…`, not `data-surface`.** The register lives under `/dashboard`, outside the app frame, so there is no `data-surface` to read. The page sets `compact` from the origin `readFrom` already validates; the backoffice calendar sends no `from`, so it never turns on. Below `md` only: every compact class is `max-md:` or undone at `md:`.
- **No `components/app/segmented.tsx` yet.** One consumer, so the control stays inline in `register-form.tsx` as two class sets. Extract it when POOLSE-176's sheets want it.
- **Avatar is initials only** (`PersonAvatar` with no photo), because this screen has no photo-consent check.
- **Warning line:** *N sem seguro · N exames em falta*. *Exames em falta* counts both missing and expired; the sheet names which one.
- **Contrast (QA 6):** the three chosen tones' words are in `check-contrast.mjs` as `*-ink` on their `/15` wash, which is what `text-primary` and the others resolve to. All pass.
- **e2e:** `phone-poolside.spec.ts` › *the register from app mode — POOLSE-180*. QA 3 is the existing register tests, which open without `from`.

### PO — why this exists

Rui, 05-11-2026: *"on mobile app, 'for teaching and maintenance' when viewing students on the classes etc, the information about a student having no insurance or no medical exam on a class detail screen is not needed. Then, the 'present, excused and absent' labels also do not need to be there, its to much visual information. — The mobile app is not the core it is supposed to be simple and clean."*

The instructor's *Hoje* opens the backoffice's register (`dashboard/calendar/sessions/:id`, `register-form.tsx`): per student, the name, a *Confirmou / Avisou que não vem* chip, a *Sem seguro* chip, an *Exame em falta / expirado* chip, then three radio segments *Presente · Falta justificada · Faltou* that each wrap to two lines at 360 px, then the note box. Fifteen students is fifteen rows of four chips and three buttons. The office needs the seguro and the exame; the instructor on the deck needs a name and a mark. **Review of the staff homes done the same day** (Rui asked to *"see a 'teachers and maintenance mobile view'"*): *Hoje* and *Semana* are right as rows; the register is the heavy screen; the maintenance home has no phone shell yet (POOLSE-181).

**Not in scope:**
- Removing the seguro and exame information from the data or from the office's register on a laptop — on a wide screen the chips stay.
- Changing the attendance states, their colours (POOLSE-13) or the rule that a note needs a mark.
- Dropping the words entirely: CONVENTIONS keep every state in words — the words get smaller and stop competing with the name, they do not go (see rule 2 for how).

### BA — rules

1. **Scope**: `[data-surface='app']` and below `md` — the register opened from `/app/aulas`. From `md` up, and from the backoffice calendar, nothing changes (snapshot).
2. **The row is the name and one control.** Per student: avatar (initials), name at 700, the *Confirmou / não vem* chip only (it is the family's word to the instructor, worth keeping), and a **segmented control** of three 44 px cells carrying the state's icon (POOLSE-13's glyphs) with its word beneath at 11 px — the word stays, so colour and glyph are never alone, but it reads as a label on a button, not a sentence. The chosen cell fills with the state's tone.
3. **The warnings move up and become a count**: above the roll, one muted line — *2 sem seguro · 1 exame em falta* — that opens a bottom sheet listing the names. Nothing per row. A lesson with nothing to warn shows no line.
4. **The note box stays** below a marked row, as now.
5. ***Marcar todos presentes*** stays at the top; *Guardar* is the sticky bar at the bottom (POOLSE-88's rule for a phone Save).
6. **Maintenance view**: no register there; this ticket touches the instructor's screens only.

### Dev notes

- `register-form.tsx` reads a `compact` prop set by the page when the surface is app and the viewport below `md` (the frame already exposes `data-surface`; width by the same `md` container query POOLSE-136 uses for the bar). No second component: one form, two densities.
- The segmented control is `components/app/segmented.tsx`, generic (used again by POOLSE-176's sheets if it fits). Radios stay radios (`sr-only` input, visible label), so keyboard and screen readers lose nothing.
- The count line reads `insured` and `examState` already in the register payload — no API change.
- Trap: the comment in `register-form.tsx` explains why the icon was dropped on phones ("the word carries the state"). This ticket inverts it — icon first, word small — because the control is now one cell per state at 44 px, which fits both.

### QA

1. Given the register from *Hoje* on a 360 px phone, then no row carries a seguro or exame chip; the line above the roll says *2 sem seguro · 1 exame em falta* and opens the sheet with the three names.
2. Given a lesson where everyone is insured and examined, then no warning line.
3. Given the same lesson on a laptop from the backoffice calendar, then the chips are per row as before (snapshot unchanged).
4. Given a cell tapped, then the mark is set, the word beneath it is readable, and the note box appears; keyboard: arrow keys move between the three cells.
5. Given a stand-in instructor opens it, then the same compact view; given a maintenance role → 403 as today.
6. Both themes: the three tones at the new size are in `check-contrast.mjs`.

### Acceptance criteria
- [ ] On a phone in app mode, each row is name + family chip + segmented state; warnings are one line at the top.
- [ ] Nothing changes from `md` up or in the backoffice.
- [ ] Words remain on every state; QA 1–6 green.

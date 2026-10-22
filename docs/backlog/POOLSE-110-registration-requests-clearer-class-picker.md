# POOLSE-110 · Pedidos de inscrição: choosing a turma without reading a wall of text

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX · **Area:** Students / Registration · **Priority:** Medium · **Depends on** [POOLSE-69](./POOLSE-69-online-pre-registration.md), [POOLSE-82](./POOLSE-82-app-enrolment-and-waiting-list-offers.md)

### PO — why this exists

Rui, 22-10-2026: *"On 'Registration requests', when clicking 'enroll', 'waiting list' or 'trial lesson', the 'choose a class' dropdown should have a better and clearer view; currently it's very confusing with everything piled up."*

In `students/pedidos/lead-actions.tsx` the three dialogs share one `<select>` whose options are built as *name · level · 8/12* joined into one string (≈ l.55). With 30 turmas that's 30 near-identical lines in a native dropdown, requested level first but not labelled as such.

**Not in scope:** changing what a turma offer or a trial does once picked.

### BA — rules

1. **One picker, used by all three dialogs**, as a list, not a `<select>`:
   - **grouped by level**, the requested level's group first and labelled *Nível pedido*;
   - each turma is a row: name in bold, the weekly slots (*seg. 18:00 · qua. 18:00*), the instructor, and a small fill bar with *8 / 12* (colour and text), or *sem limite*;
   - **full turmas** are shown, greyed, with *cheia*, and pickable only in the *waiting list* dialog;
   - a search box at the top filters by turma name, level or instructor as you type (POOLSE-30 behaviour);
   - keyboard: arrows move, Enter picks, Esc closes; the picked row is announced.
2. **The picked turma is shown back** in the dialog as a line (*Golfinhos · seg. e qua. 18:00 · 8/12*) with *alterar*, so the person confirms what they chose.
3. **Trial lesson** also shows the next 3 dates for the picked turma to choose from, as today, but only after a turma is picked.
4. On a phone the picker is a full-height sheet.

### Dev notes

- A `TurmaPicker` component in `components/`, since the same need exists on the enrolment form (new student → turma) and in the app's enrolment (POOLSE-82). Build it once here and swap the other two in follow-ups.
- The data is already there (`TurmaChoice`: name, levelName, active, capacity); add the slots and the instructor to the endpoint's choice list (one join, no N+1).
- No migration.

### QA — scenarios

1. **Given** a request for level *Iniciação*, **when** I open *Inscrever*, **then** the Iniciação turmas are listed first under *Nível pedido*, each with slots, instructor and fill.
2. **Given** a full turma, **then** it is greyed and not pickable in *Inscrever* but pickable in *Lista de espera*.
3. **Given** I type "Gol", **then** only matching turmas remain.
4. **Given** a picked turma, **then** the dialog shows it back with *alterar*, and *Aula experimental* then offers its next 3 dates.
5. Keyboard-only run of scenario 1.

### Acceptance criteria

1. The three dialogs use the grouped, searchable picker.
2. Both languages, light and dark, phone sheet, contrast on the fill bar.

### Open questions

- None.

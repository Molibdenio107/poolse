# POOLSE-101 · A tank's water: one place to record, one place for the laboratory, and a report that lands in the right one

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX / Bug · **Area:** Instalações / Water quality · **Priority:** Medium · **Depends on** [POOLSE-72](./POOLSE-72-national-water-reference-and-lab-grading.md), round 6 ticket 1 (report import)

### PO — why this exists

Rui, 22-10-2026: *"On the pool details screen there are two ways to add an analysis that look similar: the 'Lab results' submenu and 'Record'. Why are they both there if they do the same?"* and *"the 'Record' submenu has a huge button (card-section width) to import an analysis report."*

They are **not** the same thing, but the page doesn't say so:

| Section | What it is | Who produces it |
|---|---|---|
| **Registar** (`record`) | The club's own daily readings: pH, chlorine, temperature, turbidity. Typed into a form, several times a day. | A technician at the pool |
| **Laboratório** (`lab`) | The certified laboratory's monthly analysis, graded against the national reference (POOLSE-72). | An external lab, by report |

The confusion comes from where the **report import** sits. It reads *"a one-page report a laboratory sends back"* into readings, but it lives under *Registar*, directly beneath the manual form. So *Registar* looks like a second way to enter a lab analysis.

**Not in scope:** changing how readings or lab results are stored or graded.

### BA — rules

1. **Registar** keeps only the manual form for the club's own readings. Its heading says so: *"Registar uma leitura própria"* with one line: *"As análises de pH, cloro e temperatura feitas pelo clube."*
2. **Laboratório** gets the report import: *"Importar um relatório do laboratório"*, beside *"Registar um resultado"*. Its intro line: *"As análises mensais feitas por um laboratório acreditado, avaliadas contra o referencial nacional."*
3. **Which table an imported report lands in** is decided by the parser's output: values that match the lab's parameter set (coliforms, legionella, etc.) go to `lab_result`; a report that only has pH/chlorine goes to readings. The preview says where each row will land before anything is written, as today.
4. **The import button** is a normal-width primary button, not stretched to the card. The cause: it sits directly inside a `flex-col` container, which stretches children; `self-start` fixes it (`water-import.tsx` ≈ l.198).
5. A one-line explainer at the top of the water tab, above the pills: *"Leituras próprias todos os dias; resultados do laboratório todos os meses."*

### Dev notes

- `readings-block.tsx`: move `<WaterImport>` from `current === 'record'` to `current === 'lab'`. The wizard already parses to a preview; add the routing rule from BA-3 in the confirm action (`water-import.actions.ts`), so a lab-type report creates `lab_result` rows through the POOLSE-72 path and grading.
- Rename pill keys: `facilities.readings.record` → *Registar leitura*, `lab` → *Laboratório*.
- No migration.

### QA — scenarios

1. **Given** the water tab, **then** *Registar leitura* shows only the manual form, and *Laboratório* shows the results list, *Registar um resultado* and *Importar relatório*.
2. **Given** I drop a lab PDF on the page, **then** the preview says the rows go to the laboratory results, and confirming creates graded results.
3. **Given** a PDF with only daily readings, **then** the preview says they go to readings.
4. The import button is content-width in both themes and on a phone.

### Acceptance criteria

1. One place to record own readings, one place for the laboratory, and the report import under the laboratory.
2. The import button no longer stretches.
3. Both languages, `docs/features/water-quality.md` updated.

### Open questions

- None. Split confirmed (Rui, 22-10-2026): *Registar* keeps only the club's own daily readings; the report import moves under *Laboratório*. Not a combined section.

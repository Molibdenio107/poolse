# POOLSE-153 · Laboratório shows every analysis — imported and typed — and the newest drives *Última análise* and *Tendências*

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Water quality · **Priority:** Medium (pilot) · **Depends on** [POOLSE-72], [POOLSE-101] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "'Laboratory' should also have a history of 'imported' and recorded analysis. We have 'history' which are 'manual' analysis, but we need a history of the uploaded analysis. The most recent analysis should be reflected on 'Trends' and on 'Latest analysis'."

Since 29-10-2026 a lab result's chemistry is also a reading (`pool_analysis.lab_result_id`), so the data is there; the screen lists only what was typed.

**Not in scope:** the parser, the grading (`gradeLabResult`), alerts.

### BA — rules
1. *Laboratório → Histórico* lists every `lab_result` of the tank, newest first, paginated at 10, each row saying its origin: *Importado* (a `stored_file` attached / parser-filed) or *Registado* (typed), its grade, laboratory and sample point.
2. *Última análise* is the newest live `pool_analysis` by `taken_at`, whether or not it came from a lab result.
3. *Tendências* plots all live readings; a point from a lab result is drawn with a distinct marker shape and a legend entry (never colour alone).
4. Archiving a lab result still archives its reading (trigger, unchanged), so both views drop it together.

### Dev notes
- `water-quality/lab-results.repository.ts` — `listLabResults(poolId, page)`; origin is `lab_result.report_file_id IS NOT NULL` or the parser's stamp — grep `createLabResultIn` for which column records the file; never invent one.
- `latestAnalysis` query: confirm it is not filtered on `lab_result_id IS NULL` (that is the likely bug).
- Chart: `components/water-trends.tsx`; add `symbol` per series point; `dataviz` skill applies.
- Trap: a lab result with no chemistry (organisms only) has no reading — it appears in Histórico and not in Tendências; say so in the row.

### QA
1. Given a tank with one typed reading and one imported report, when Histórico opens, then two rows with origins *Registado* and *Importado*.
2. Given the imported report is newer, when the tank page opens, then *Última análise* shows its values and date.
3. Given Tendências, when it renders, then the imported point has the second marker and the legend names it.
4. Given maintenance, when Histórico opens, then it reads; given a guardian, 403 on the endpoint.
5. Cross-tenant: another tenant's `pool_id` → 404.
6. Both themes on the chart.

### Acceptance criteria
- [ ] Histórico lists imported and typed results with origin.
- [ ] Última análise and Tendências read the newest reading regardless of origin.
- [ ] Lab-sourced points visibly distinct in the chart, legend and table view.

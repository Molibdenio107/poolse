---
paths:
  - "apps/web/src/lib/{column-mapping,import-preview,timetable-mapping}*.ts"
  - "apps/web/src/**/*import*"
  - "apps/web/src/app/**/{import,importar,export}/**"
  - "apps/api/src/**/*import*"
  - "apps/api/src/**/*export*"
  - "apps/api/src/ai/**"
  - "apps/web/src/lib/{csv,*sheet,timetable-*,analysis-report*,energy-invoice*,*-agent}.ts"
---

# Importers and exports

Read [`docs/conventions/importers-and-exports.md`](docs/conventions/importers-and-exports.md) before touching an importer, an export or a file a club uploads.

- A column-mapping importer uses `useImportWizard`, and maps through `lib/column-mapping.ts` (never its own `assign`).
- A document importer is an `AnalysisReportParser`.
- A list importer takes a PDF by `readSheet(file, { pdf: true })`, and the PDF becomes a spreadsheet.
- An imported timetable is a preview in the tab (`lib/import-preview.ts`, bar `components/import-preview-bar.tsx`) until *Confirmar*; nothing provisional is ever in the database (POOLSE-224).
- A pool with a calendar is never imported onto: *Substituir* (all of it to the bin) or a new pool; every import is a `timetable_import`, undone from *Importações anteriores* (Rui, 12-11-2026).
- A timetable PDF or photo is read for its meaning (`timetable-reader-agent.ts`) and mapped in `lib/timetable-mapping.ts`; a reader change ships with a recorded `pnpm timetable:eval` (POOLSE-223).
- An importer is a `MatchSpec`, never a new pipeline.
- What an export writes, its importer reads back — and a test proves it against the real catalogue.
- A round trip changes nothing.
- A file of money is the one importer that commits whole or not at all, and its export carries the contract rather than the derived figures.

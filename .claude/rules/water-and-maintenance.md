---
paths:
  - "apps/api/src/{maintenance,spaces,facilities}/**"
  - "apps/web/src/app/**/{facilities,manutencao,agua}/**"
  - "packages/rules/src/{water,lab}*.ts"
  - "apps/web/src/lib/{water,water-*,public-water*,analysis-report*}.ts"
  - "apps/web/src/components/lab-grade-chip.tsx"
  - "apps/api/src/dashboard/maintenance-band.repository.ts"
---

# Water quality and maintenance

Read [`docs/conventions/water-and-maintenance.md`](docs/conventions/water-and-maintenance.md) before touching readings, bands, alerts, tasks or spaces.

- A derived answer is derived once, on the server.
- A breach is derived; being told about it is a record.
- The published band is NP 4542:2017, and a lab result's grade is derived, never stored.
- A pool's band is the published one until a club says otherwise, and `resolveBands` is where the two meet.
- Only a recent sample alerts, and the screen says whether anything was sent.
- A recurring job is a `maintenance_task`; a one-off is a `maintenance_request`, and `interval_days` is the boundary.
- Assignment is a person here and a role in 4.2's alerts, and the difference is the point.
- A null ceiling, interval or limit means "not measured" and enforces nothing.
- Out of service is not deleted.

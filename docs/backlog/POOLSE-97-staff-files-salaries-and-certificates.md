# POOLSE-97 · Staff files: salaries import/export in plain sight, certificates on the qualifications list

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX + Feature · **Area:** Staff / Payroll / Qualifications · **Priority:** Medium · **Depends on** [POOLSE-59](./POOLSE-59-importing-and-exporting-salaries.md) (built), [POOLSE-27](./POOLSE-27-certification-expiry-with-amber-window.md), stored files (`1790157600000_stored-files.sql`, `qualification.document_file_id`)

### PO — why this exists

Rui, 22-10-2026:

- *"On Salaries turn on the import/export PDF functionality."*
- *"The qualifications for each professional should have an import/export functionality of qualification certificates, then display each item on the qualifications main page list."*

**What already exists.** Both halves are mostly built and hard to find:

- **Salaries:** import (`.xlsx`, `.csv`, `.pdf`) and export (Excel, CSV, PDF) are built (`salary-file-panel.tsx`). They were folded into a closed `<details>` after the table on 12-10-2026, because a club uses them about once a year. In testing, that read as "not switched on".
- **Certificates:** each qualification can carry one certificate file (`document_file_id`, purpose `qualification_document`, served via `GET /files/:id`). It is attached on the **person's** page, one at a time. The Qualificações list doesn't show whether a certificate is on file.

**Not in scope:**
- Reading dates or types out of a certificate (OCR).
- Changing the "attached once" rule (`qualification_document_once` trigger). Replacing a certificate means renewing the qualification, as today.

### Slices

#### 97a · Salaries: import and export are visible

- Move *Exportar Excel / CSV / PDF* and *Importar* out of the folded box into the page header's actions (an *Exportar ▾* menu and an *Importar* button), Owner/Admin as today.
- Drag-and-drop anywhere on the page still opens the import wizard.
- Delete the `<details>`, and update the 12-10 comment and `decisions.md` with the reversal and its reason (Rui, 22-10-2026).

#### 97b · Qualificações list: the certificate on every row

- Each row on Qualificações gets:
  - a 📎 *Certificado* link that downloads the file, when there is one;
  - an *Anexar* button that opens the existing upload for that qualification, when there isn't. Manager roles only, as on the person page.
- A filter: *Sem certificado*.
- The list endpoint returns `documentFileId` (and filename) per row. No N+1.

#### ~~97c · Certificates in bulk~~ — dropped (Rui, 22-10-2026)

Attaching and downloading per row (97b) is enough.

### Dev notes

- 97a is web only.
- 97b: add the file id to `GET /qualifications` (the list). Download goes through the existing `/files/:id` read rule, so no new access path.
- 97b: *Anexar* from the list reuses the person page's upload action. The `qualification_document_once` trigger still holds.

### QA — scenarios

1. **97a:** On Salários, *Exportar ▾* and *Importar* are visible in the header without unfolding anything. Each export downloads, and PDF opens its own tab.
2. **97b:** A row with a certificate shows 📎 and downloads it. A row without shows *Anexar* to a manager and nothing to others.
3. **97b:** *Sem certificado* filters correctly and keeps pagination.
4. Permission: a coach sees no *Anexar*, and the upload endpoint refuses them.

### Acceptance criteria

1. Salaries import/export is reachable in one click.
2. The qualifications list shows and serves each certificate, and can attach one.
3. Both languages, light and dark, role probe, `docs/features/staff.md` updated.

### Open questions

- None.

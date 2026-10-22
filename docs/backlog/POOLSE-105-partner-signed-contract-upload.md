# POOLSE-105 · The signed contract on a partnership, as PDF or Word, from the first day

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX / small feature · **Area:** Partnerships / Files · **Priority:** Medium · **Depends on** stored files (`1790157600000_stored-files.sql`, purpose `agreement_document`), [POOLSE-47](./POOLSE-47-parcerias-partners-agreements-groups.md)

### PO — why this exists

Rui, 22-10-2026: *"On the Partnerships details page, add an import functionality to the 'Agreement' submenu, 'signed contract', the same we already have in the app, for docx and pdf."*

**What exists.** `partner-agreement.tsx` already renders an `AttachedDocument` for the signed contract (upload, download, replace), but it is shown only when:
- the agreement's terms have been recorded (`agreement !== null`), otherwise it prints *"record the agreement first"*;
- file storage is configured (`storageReady`), otherwise the control is visibly inert.

And `file-upload.tsx` accepts **PDF and images only** (`ACCEPT_DOCUMENTS`). No `.docx` anywhere in the app yet.

**Not in scope:** reading the terms out of the contract.

### BA — rules

1. **The upload is available as soon as the partner exists.** A club often has the signed paper before it has typed the rates. If the agreement row doesn't exist yet, uploading creates it with empty terms, flagged *"termos por preencher"* until somebody fills them.
2. **Accepted:** PDF, Word (`.docx`), and images (a photographed contract). 10 MB, as everywhere.
3. **Word files are served as a download**, never previewed inline. PDF keeps the in-browser viewer. The file's own name is kept for the download.
4. **Replace keeps history:** the previous file isn't deleted; it's listed under *versões anteriores* with who replaced it and when. Owner/Admin.
5. **Storage not configured** keeps the current inert control with its reason, and the go-live checklist already says to configure R2.

### Dev notes

- `file-upload.tsx`: a per-purpose accept list. `agreement_document` gains `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. The API's upload validation (`stored_file.content_type`) gains the same type, for that purpose only.
- `GET /files/:id` sets `Content-Disposition: attachment` for Word.
- A `replaced_by` link on `stored_file`, or a small `agreement_document_version` table, for BA-4. Use the `write-migration` skill.
- No change to the agreement's terms form.

### QA — scenarios

1. **Given** a new partner with no terms, **then** the *Contrato assinado* card shows the upload, and uploading works.
2. **Given** a `.docx`, **then** it uploads and downloads with its name; a `.pptx` is refused with a message.
3. **Given** a replaced contract, **then** the old one is listed as a previous version with actor and date.
4. **Given** a coach, **then** they can download but not upload or replace (API 403).

### Acceptance criteria

1. Upload available from the partner's creation, PDF/Word/images.
2. Previous versions kept and listed.
3. Role probe, both languages, `docs/features/partnerships.md` updated.

### Open questions

- None. Checked 22-10-2026: the development `.env` has the S3 variables set (S3Mock via `docker compose up -d storage`), so storage is configured. The control was missing because the agreement's terms hadn't been recorded (BA-1), which this ticket fixes. If the storage container wasn't running, the control is inert with a reason, which is the designed behaviour.

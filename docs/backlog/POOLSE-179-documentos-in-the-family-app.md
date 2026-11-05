# POOLSE-179 · *Documentos* in the family app: upload the ID and the exame médico, download the filled FPN declaration and the boletim de sócio — each only for the sports the student is in

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Students / Documents · **Priority:** Medium (pilot) · **Depends on** [POOLSE-131](./POOLSE-131-student-identity-and-address.md), [POOLSE-132](./POOLSE-132-student-documents-fpn-declarations.md), [POOLSE-133](./POOLSE-133-exame-medico.md), [POOLSE-134](./POOLSE-134-boletim-de-socio.md), [POOLSE-109](./POOLSE-109-emergency-contact-picker-and-atestado-upload.md), [POOLSE-11](./POOLSE-11-student-photo-cartao-de-cidadao-upload.md), [POOLSE-145](./POOLSE-145-instructor-scoped-to-sports.md)

### PO — why this exists

Rui, 05-11-2026: *"'Student' mobile app should allow the student to import and export their id, FPN declaration (using the templates from the club configurable by the 'facilities set up screen'), membership. Remember but some of those things should be filter by the student sports that hes enrolled."* Clarified the same day: upload **and** download — the family uploads scans, the club's generated PDFs come down filled.

The office already has all of it (POOLSE-132/133/134): the ID document encrypted on the record, the exame médico with its validity, the FPN *Declaração de Consentimento Informado* and the *Boletim de sócio* printed from the club's templates with placed fields. What a swim school still does by hand is the round trip with the family: print, hand over, wait for the signed copy, scan, file. This ticket moves both ends of that round trip to the phone. The documents a family sees are the ones that apply: the FPN declaration is a swimming thing (FPN = Federação Portuguesa de Natação); a child who only plays padel never sees it.

**Not in scope:**
- Electronic signatures and sending anything to the FPN or FPNSystem (POOLSE-132's own exclusions).
- Editing any field that feeds the templates from the app (address, filiação, NIF stay office-only, POOLSE-177).
- Medical **information**: the exame médico upload is the file and its date; the result is read by the office (POOLSE-133).
- Other federations' forms. One template kind per sport is the model; the second federation is a new `student_document.kind`, not this ticket.

### As built (05-11-2026): slice 1 of 2 — wins over what follows

**Built:** the list per child with a status, the sport filter, the club's filled forms, the row on *Aulas*.

- **No PDF generator and no signed links.** CLAUDE.md settled both: a document on paper is a route with print styles, and a file is read only through the app. *Preencher e imprimir* opens the office's own print page, so there is one renderer, and on a phone printing is *Save as PDF*. So QA 3's byte comparison and QA 7's 410 do not apply.
- **The family's copy leaves the SNS number off** (POOLSE-131: the office's alone). Otherwise it is the office's form.
- **`boletim_template` is readable by anyone in the club:** a family's form is drawn on it, and the blank holds nobody's details.
- **A family's print is audited** as `student.document_printed`.
- **No *Enviado* status yet:** nothing can be sent until slice 2.

**Slice 2, not built, and it needs care:**
1. **The ID scan must be sealed.** `student_document` is not in `SEALED_PURPOSES`, so even the office's ID scans sit unencrypted today. Slice 2 needs a sealed purpose for them, the `stored_file_sealed` CHECK and shredding on retention, and that gap should be closed whether or not families upload.
2. **HEIC:** `sniffType` does not know it, and it is what an iPhone produces.
3. **`medical_exam.result`:** a family's upload has no result, so the column has to allow that for the office to fill in.
4. **Rate limit, a family's upload route, *enviado pela família* on the office's tab, and the security review.**

### Slice 2, part 1 — the ID photo is sealed (built 05-11-2026)

- **Migration `1794653000000_student-id-document-sealed`.** A new purpose, `student_id_document`, is in `SEALED_PURPOSES` and in the `stored_file_sealed` CHECK. The FPN forms and boletim stay plain `student_document`. A trigger refuses an `id_document` on anything but a sealed file. A replaced ID photo is shredded at once (it used to be kept), and retention's anonymisation shreds them all. `test/student-id-document.sql` has 4 assertions. On a fresh database all 207 earlier migrations, this one, its down and up again, and the whole `db:test` suite pass.
- **API:** the office uploads with `purpose=student_id_document`. `fileCopy` requires that purpose for `id_document` and refuses it for every other kind. Each read writes `student.id_document_read` (photo).
- **Existing plaintext ID photos** stay until `apps/api/src/files/reseal-student-id-documents.ts` runs in each environment. It is a dry run unless `--apply`. It seals, checks the round trip, re-points, audits `file.resealed`, then **deletes the plaintext object**.

#### Security review (05-11-2026, diff scope)

**[S2] The ID photos filed before tonight are still plaintext in the bucket.** *Confidence: certain.* Anyone holding the uploads bucket's token can read a child's identity card. Fix: run the re-seal, a dry run first and then `--apply`, in staging and then production. Cost: minutes. Listed in `docs/security.md` until done.

**[S4] One file can be filed on two students.** `fileCopy` does not check whether the file id is already filed. Replacing or anonymising one student would then shred the other student's current photo. Only the office can do this, and only by replaying a file id. Fix: `NOT EXISTS (SELECT 1 FROM student_document WHERE file_id = $1)` in `fileCopy`. Cost: minutes.

**[S4] An ID photo uploaded but never filed is never shredded.** If `POST /files` succeeds and the `copies` call fails, a sealed file with a live key stays readable by the office for ever, and retention never reaches it (no student is linked). Fix: one route that uploads and files together (the staff photo's `write: null` shape), or a nightly sweep. Cost: an evening.

**[S4] Crypto-shredding vs database backups.** A shredded key survives in the 30-day pg backups, so a restore within 30 days revives it. This applies to every sealed purpose, not only this one. Fix: one paragraph in `security.md`, *Two limits worth knowing*. Cost: minutes.

**What held:**
- Tenant isolation: 608 existing assertions and 4 new ones pass.
- The CHECK refuses a sealed purpose without a key, and the trigger refuses a plain ID photo.
- The definer helper sets `search_path`, re-checks the club, only destroys, and another club cannot call it on ours (test 4).
- Reads are office-only and audited, and the uploader rule does not apply to sealed purposes.
- The envelope binds club and file id.
- The re-seal deletes only after commit and after a verified round trip.
- `sql:check` is green, and there are no secrets in the diff.

**Not reviewed:** the family upload (not built yet), HEIC, the AI reader's call on an ID photo (unchanged, flag-gated).

### Slice 2, part 2 — a family sends (built 05-11-2026)

Rui decided on 05-11-2026: convert HEIC, give the exam no result until the office reads it, and "don't break anything".

- **`family_submission`** (migration `1794653100000_family-submission`). What a family sends waits here and **changes nothing on file** until the office accepts it. A pending exam therefore never becomes the child's standing, and a wrong upload never replaces or shreds the office's copy. That makes `medical_exam.result` nullable unnecessary, so it stays NOT NULL: the office types the result when it accepts.
  - One pending per child, kind and season.
  - The file's purpose must match the kind: an ID is a sealed `student_id_document`, an exam a sealed `medical_certificate`, a form a plain `student_document`.
  - A decision is final.
  - A rejected sealed file is shredded. Anonymisation shreds everything sent; erasing health data shreds the exams.
  - `test/family-submission.sql` has 5 assertions.
- **`POST /app/documents/:kind?child=`** takes the raw file.
  - Who may send: a live encarregado, or the student from 18. A minor's own login gets **403**, another family's child **404**.
  - The kind must be one the child's sports ask for.
  - Throttled at **10 an hour** per person (`FAMILY_UPLOAD`).
  - **HEIC → JPEG** (`files/heic.ts`, `heic-decode` + `jpeg-js`, pinned). The size is read before decoding, with a 50 MP cap; EXIF, GPS included, is not carried over. The result is then judged like any upload: sniffed, 10 MB at most.
  - Audited `student.document_sent`.
- **The office:** `GET /students/:id/documents/submissions`, then `…/:sid/accept` (an exam needs `result`) or `…/:sid/reject`. Accepting files the copy through `fileCopyIn` / `insertExamIn` in one transaction. Both are audited. The panel *Enviado pela família* sits above the Documentos sections.
- **The family:** *Documentos* shows *Enviado — a aguardar a secretaria*, and *Enviar* where `canSend`. The ID photo is never shown back.
- **Also fixed:** the review's [S4] *one file on two students*. `fileCopyIn` now refuses a file that is already filed.
- **Tests:** `family-submissions.integration.test.ts` has 5 tests (QA 4–7 and the accept/reject paths). On a fresh database: 613 SQL assertions, and **all 1,129 API integration tests** with the platform role and a local S3 stand-in. API and web typecheck, 257 API unit tests and 104 rules tests pass. The web unit tests pass 311 of 312; the one failure is `date-format.test.ts`, where this machine's Node ICU puts spaces around a date range's dash, so check it on Windows.

#### Security review of the upload path (05-11-2026)

**[S4, fixed 05-11-2026: a reject archives the file, so `openFile` serves it to nobody, the sender included; the bucket object stays until a sweep exists] Rejected plain forms stay in the bucket.** A rejected FPN declaration or boletim is a plain file, so it is not shredded and never deleted, and it carries a signature. Fix: archive on reject, and a sweep that deletes objects of archived, unreferenced `student_document` files. Cost: an evening.

**[S4, fixed 05-11-2026: `files/jpeg-metadata.ts`, for every JPEG upload in `judgeUpload`. It is lossless: APP1/APP13 are cut out and a minimal orientation tag is written back. Tested on a real EXIF file: GPS and make gone, orientation 6 kept] JPEGs keep their EXIF.** HEIC is re-encoded, but a JPEG from Android or an iPhone set to *Most Compatible* keeps its GPS. The file is sealed for an ID photo or an exam, and office-only for the rest. Fix: strip EXIF from JPEG on upload with `jpeg-js` (decode, then encode). Cost: an hour.

**[S4, fixed 05-11-2026: one HEIC decode at a time, process-wide] Decoding memory.** A 50 MP HEIC decodes to about 200 MB of RGBA. The throttle bounds it per person, not across people. Fix if Railway's memory is tight: a cap of 24 MP, or one decode at a time. Cost: minutes.

**What held:**
- A stranger's child is a 404 before anything is read, and that is tested.
- A minor's own login gets a 403, and that is tested.
- A renamed executable is refused, and that is tested.
- The bucket holds ciphertext for an ID photo, and that is tested.
- A sending files nothing, and that is tested.
- A decision is final.
- Only the office decides (`requireRole('owner','admin')`).
- The definer helper re-checks the club, and another club cannot shred ours (SQL test 5).
- `security:check` is green, and the new packages have no advisories.

### BA — rules

1. **Where**: a *Documentos* row on *Aulas* (POOLSE-175) per child, opening `/app/familia/documentos?child=` — a screen deeper in. Guardian always; the student's own login from 18 (the adult path, `family_may_answer()`'s adult branch) — a minor's login reads, never uploads.
2. **Sport filter.** Document kinds are listed per sport in `@poolse/rules` (`DOCUMENT_KINDS_BY_SPORT`): `fpn_declaration` / `fpn_declaration_minor` → `pool` only; `socio_form`, `id_document`, `medical_exam` → every sport. A child sees the union over the sports they hold a live enrolment or pass in **this season** (the POOLSE-145 resolution of a person's sports), never the club's whole list.
3. **Download**: *Declaração FPN* (minor or adult by the child's age at the season start, POOLSE-132 rule 3) and *Boletim de sócio*, each generated on demand from the club's live template for that kind — the same PDF the office prints, same placements. Absent, with *O clube ainda não configurou este documento*, when the club has no live template of that kind. A download is audited against the student (who, when, which kind, which season).
4. **Upload**: the signed FPN declaration (filed as this season's `student_document`, replacing a previous one exactly as the office's filing does), the signed boletim, the ID document (both faces, `student_photo`/ID storage path of POOLSE-11, encrypted at rest as POOLSE-100 requires), the exame médico (POOLSE-133's `medical_exam` with `examined_on` typed by the family and `result` left for the office). PDF, JPEG, PNG and HEIC, 10 MB each, checked by **content sniffing**, not extension; anything else is refused in words.
5. **Status, not inbox.** Each kind shows one of: *Em falta*, *Enviado — a aguardar a secretaria*, *Em dia (até dd-MM-yyyy)* for dated ones, *Expirado*. The office's screens are unchanged; a family's upload lands there flagged *enviado pela família*.
6. **Privacy**: a family reads only its own children's documents; an ID document is never shown back as an image after upload — only *Enviado a dd-MM-yyyy*. Download links are signed, 5 minutes, single use, and never carry the storage key.
7. **Security review** (`poolse-security-review` skill) before go-live of this ticket: a new public-ish upload path and a PDF generator fed by user-visible data.

### Dev notes

- `GET /app/documents?child=` → `{ kinds: [{ kind, applies: true, status, validUntil, canDownload, canUpload }] }`; `POST /app/documents/:kind` (multipart, one file; two for `id_document`); `GET /app/documents/:kind/pdf` streams the generated file with `Content-Disposition: attachment`.
- Generation reuses POOLSE-132/134's renderer whole (`boletim_template` + `boletim_template_field`); a second renderer is a bug.
- Uploads go through the same storage adapter and virus/size checks as POOLSE-109's atestado; `storageConfigured()` gates the whole screen (it already gates certificates on *Aulas*).
- Authorisation is `guardian_link` live on the student, or the student's own `app_user_id` on the adult path — the predicate `familyMayReadPlan` uses, extracted to `familyOf(studentId)` if it is not already.
- Trap: POOLSE-132's print carries the FPN's title and text, not its logos. Same here.
- Rate limit uploads per membership (10/hour) on the same limiter the pedido form uses.

### QA

1. Given a child in swimming and padel, then *Documentos* lists the FPN declaration, boletim, ID and exame; given a child in padel only, then no FPN line.
2. Given the club has no live FPN template, then the line says so and offers no download.
3. Given a guardian downloads the FPN declaration, then the PDF equals the office's print for the same child byte-for-byte except the generation time, and an audit row names the guardian.
4. Given a `.exe` renamed `.pdf`, then refused in words; given a 12 MB JPEG, refused in words; given a 3 MB HEIC, accepted.
5. Given a signed FPN uploaded by the family, then the office's *Documentos* tab shows it as this season's, flagged *enviado pela família*, and the previous one is `replaced_by` it.
6. Given a minor's own login, then every upload is 403 and the statuses still read.
7. Given another family's child id → 404; another tenant → 404; an expired download link → 410.
8. Both themes, snapshot of the list.

### Acceptance criteria
- [ ] Documents listed per child, filtered by the child's sports.
- [ ] Filled PDFs download from the club's live templates; uploads file where the office already looks.
- [ ] Encrypted ID at rest, signed short-lived downloads, content-sniffed uploads, rate limit, audit.
- [ ] Security review done and recorded in the ticket; QA 1–8 green.

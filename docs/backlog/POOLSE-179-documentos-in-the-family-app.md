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

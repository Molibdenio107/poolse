# POOLSE-193 · The student checks the FPN form on the phone, downloads a real PDF, signs it and sends it back, and the club only reviews the signed copy

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature + Bug · **Area:** Mobile app / Students / Documents · **Priority:** High (pilot) · **Depends on** [POOLSE-179](./POOLSE-179-documentos-in-the-family-app.md), [POOLSE-142](./POOLSE-142-club-boletim-template.md), [POOLSE-177](./POOLSE-177-app-profile-edits-never-reach-the-student-record.md), [POOLSE-190](./POOLSE-190-the-office-sees-what-a-student-sent.md) · **Build after** POOLSE-191 and POOLSE-192 (Rui, 06-11-2026)

### As built (06-11-2026): slice A of 4

- **`lib/form-pdf.ts`** builds the file with `pdf-lib`, in two route handlers, and `lib/form-values.ts` is now the one definition of a form's values, read by the print pages too.
- **`pdf-lib` was last published in 2022.** It is MIT, has no native code and no network, and runs on Vercel unchanged, where `pdfkit` needs its font files bundled. Cheap to swap: only `form-pdf.ts` imports it.
- **A name Helvetica cannot write prints `?` for that letter**, rather than failing the form.
- **The family's print pages are now unlinked** (`[id]/boletim/page.tsx`, `[id]/fpn/page.tsx`, their layout). Left in place, as a proposal to remove.
- **Slice B built the same night:** the review page, `GET /app/documents/fpn`, and `form_incomplete` on the form and on the sending. A minor's own login no longer takes the FPN form at all, which the old print allowed. Test fixtures complete the form with `completeFpnForm` (`test/fpn-fixture.ts`).
- **Slice C is direct editing** (Rui): no table, `PATCH /app/documents/fpn`. **Slice D:** the office's FPN section reads the state and the signed copies first, and printing and uploading sit in a fold.

### PO — why this exists

Rui, 06-11-2026: *"on 'student' detail screen from desktop app, the club only needs to review the FPN declaration after signed by the student. On The mobile app, student needs to verify if all fields are correct, check the mandatory ones and then download to their phone to sign by either hand or with the chave movel digital. Then the student re-upload the signed fpn form and only then the club validates. We need to adapt this logic on mobile phone and check the downloads from mobile app are not working when trying to download boletim de socio etc."*

**The download bug, reproduced 06-11-2026 as a guardian at a phone's width.** The download icon gives no file. It opens the office's A4 print page, 811px wide on a 412px screen, with *Imprimir ou guardar como PDF*, which calls `window.print()`. That is unreliable in an installed iPhone app (not tested on a real iPhone). The form's image and data load correctly, so the read path is fine.

Chave Móvel Digital signs a PDF, so a print page or an image cannot carry the signature.

**Not in scope:** Poolse signing anything or calling Autenticação.gov; verifying a signature's validity; sending anything to the FPN; the boletim's flow, which stays download only (Rui, 06-11-2026, confirming that day's earlier decision); the desktop's print pages; a PDF of anything else.

### BA — rules

**The order on the phone.** Review → complete → download → sign → send → the office decides.

1. A live encarregado, or the student on the adult path, walks the flow, as `maySendFor` says today. A minor's own login reads and does not act.
2. **Review.** Before the download, the screen lists every value the club's form prints for this person, and marks the mandatory ones.
3. **Mandatory** is the `missing` list `fpnPrint` already returns: address, locality, postal code, ID number, ID validity, modalidades, and the club's association and code.
4. **Blocked until complete** (Rui): while one is empty the download is off, and the screen lists what is missing and whose it is: the person's to fill, or the club's.
5. **The person edits their details directly** (Rui, 06-11-2026, reversing this ticket's first answer that a correction waits for the office): the record changes on *Guardar*, through the office's own reading and save, and the log names each change without its value. The signed form is what the office reviews.
6. The details lock while a signed copy waits for the office, so what it reviews matches the record.
7. **Download** is a real PDF file: the club's form with the same fields at the same places as the office's print, always in Portuguese. It is audited as `student.document_printed`, as the print is. The SNS number stays off.
8. **Signing** is the person's, outside Poolse: Chave Móvel Digital on the PDF, or printed, signed by hand and photographed. The screen says both, in few words.
9. **Sending** uses today's upload. PDF, JPEG, PNG and HEIC, 10 MB. A signed PDF is stored byte for byte, or the signature breaks.
10. The office's *Aceitar* or *Rejeitar* is the validation, in *Por rever*. A rejection returns the paper to *por enviar* in the app.
11. **The office's FPN section** (Rui): the state of the form and *Por rever* come first. Printing and uploading a copy stay, folded, for someone who signs at the desk or has no app.
12. **The boletim** gets the working PDF (rule 7's file) and nothing else. It stays download only, with no mandatory check.

13. **What the person may edit** (Rui, 06-11-2026): address, locality, postal code, the ID document's type, number and dates, and the modalidades. The FPN form does not print the NIF or filiação. The club's association and code stay the office's.
14. **The review shows the ID number in full** (Rui, 06-11-2026): the person can really check it, the PDF prints it anyway, and each read is audited.

### Dev notes

- **Slices:** A, the PDF for both forms, fixes the download bug alone. B, review and blocking. C, proposals and *Por rever*. D, the office's section. A can ship first if families need it sooner.
- **This is a dated exception to** *A document on paper is a route with print styles, never a PDF library*. Edit that line in `CLAUDE.md` and its paragraph in `docs/conventions/interface.md` in this ticket's commit, app forms only. `docs/decisions.md` holds the call.
- **PDF:** `pdf-lib`, in a server-only route handler under `/app/familia/documentos/[id]/`, `attachment`, `Cache-Control: no-store`, a file name with no person's name. It reads `GET /students/:id/documents/fpn` or `/boletim`, so `requireOfficeOrFamily`, the SNS rule and the audit stay in one place. Use `boletimValue` and the placements as `BoletimSheet` / `placementStyle` do, so the two renders share their inputs. Check the white strip (`width`) and the disciplines' X, and that Helvetica's WinAnsi carries Portuguese accents. `embedJpg`, because `lib/page-image.ts` stores a JPEG.
- **Links:** a plain anchor, never prefetched, as today.
- **Decided earlier and reversed:** POOLSE-177 and POOLSE-179 kept these fields office-only. `docs/decisions.md` holds the reversal.
- **Trap:** `judgeUpload` strips EXIF from JPEGs. Prove with a test that a PDF is stored unchanged.
- **Trap:** `POST /app/documents/fpn_declaration` must refuse while rule 4 or 6 holds, because hiding the button is not the control. Decide this with the office's desk path, which never passes through it.
- **Trap:** `/app/documents` carries no number, file or name. The review needs its own endpoint, its own audit, and the same family check.
- **Real device:** the iPhone and Android installed apps must be walked before this is called done. The dev build cannot prove a download in an installed app.
- Run `/poolse-security-review`: a new file route, a new write from the family, and personal data in a PDF.

### QA

1. Given a guardian on a phone, when they tap the boletim's download, then a PDF file arrives with the form and the child's values, and one audit row.
2. Given a complete FPN form, when the guardian downloads it, then the PDF matches the office's print, field for field, with no SNS number.
3. Given a Portuguese name with accents, then it prints correctly in the PDF.
4. Given an empty address, then the download is off and the screen says it is the person's to fill.
5. Given no club code, then the screen says it is the club's.
6. Given a request straight to the PDF route with a mandatory field empty, then it is refused.
7. Given a correction saved, then the record changes, and the log names the fields without their values.
8. Given a wrong postal code or Cartão de Cidadão number, then it is refused beside the field.
9. Given a signed copy waiting, then a correction is refused.
10. Given a PDF with a digital signature, when it is sent and opened by the office, then the bytes are identical.
11. Given a photo of a signed paper, then it is sent and waits as before.
12. Given a sent form accepted, then the app reads *ok*; rejected, then it reads *por enviar* again.
13. Given a minor's own login, when they post a proposal or read the review, then 403 where they may not act (permission denial).
14. Given another family's child, then 404; given another club's student, then 404 (cross-tenant).
15. Given the office's section, then *Por rever* comes first, and printing and uploading work from the folded part.
16. Both themes and a phone width; an installed iPhone and an installed Android.

### Acceptance criteria

- [ ] Both forms download as a real PDF on a phone, in an installed app, walked on real devices.
- [ ] The FPN form cannot be downloaded or sent while mandatory data is missing or proposed, enforced by the API.
- [ ] A guardian or adult student corrects the details directly, and the change is on the record.
- [ ] A signed PDF is stored byte for byte.
- [ ] The office reviews the signed copy first; the desk path still works.
- [ ] The boletim stays download only.
- [ ] Roles, tenancy and audit proved by tests.
- [ ] `CLAUDE.md`, `docs/conventions/interface.md`, `docs/data-model.md`, `docs/features/app.md` and `docs/features/students.md` updated.
- [ ] pt-PT and `en`; `/poolse-security-review` run.

# POOLSE-193 · The student checks the FPN form on the phone, downloads a real PDF, signs it and sends it back, and the club only reviews the signed copy

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature + Bug · **Area:** Mobile app / Students / Documents · **Priority:** High (pilot) · **Depends on** [POOLSE-179](./POOLSE-179-documentos-in-the-family-app.md), [POOLSE-142](./POOLSE-142-club-boletim-template.md), [POOLSE-177](./POOLSE-177-app-profile-edits-never-reach-the-student-record.md), [POOLSE-190](./POOLSE-190-the-office-sees-what-a-student-sent.md) · **Build after** POOLSE-191 and POOLSE-192 (Rui, 06-11-2026)

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
5. **A correction is a proposal** (Rui): the person changes a wrong or empty value in the app. It waits in the office's *Por rever*, raises POOLSE-190's circle, and the record changes only on *Aceitar*. A rejected proposal says so in the app.
6. A pending proposal keeps the download off for the field it touches, so nobody signs a form the office has not agreed.
7. **Download** is a real PDF file: the club's form with the same fields at the same places as the office's print, always in Portuguese. It is audited as `student.document_printed`, as the print is. The SNS number stays off.
8. **Signing** is the person's, outside Poolse: Chave Móvel Digital on the PDF, or printed, signed by hand and photographed. The screen says both, in few words.
9. **Sending** uses today's upload. PDF, JPEG, PNG and HEIC, 10 MB. A signed PDF is stored byte for byte, or the signature breaks.
10. The office's *Aceitar* or *Rejeitar* is the validation, in *Por rever*. A rejection returns the paper to *por enviar* in the app.
11. **The office's FPN section** (Rui): the state of the form and *Por rever* come first. Printing and uploading a copy stay, folded, for someone who signs at the desk or has no app.
12. **The boletim** gets the working PDF (rule 7's file) and nothing else. It stays download only, with no mandatory check.

**Open:** which values are the person's to propose. Default: address, locality, postal code, NIF, filiação, ID number and validity. Modalidades and the club's association and code stay the office's.

**Open:** how the review shows the ID number. Default: the last 4 digits only, and a proposal replaces the whole number.

### Dev notes

- **Slices:** A, the PDF for both forms, fixes the download bug alone. B, review and blocking. C, proposals and *Por rever*. D, the office's section. A can ship first if families need it sooner.
- **This is a dated exception to** *A document on paper is a route with print styles, never a PDF library*. Edit that line in `CLAUDE.md` and its paragraph in `docs/conventions/interface.md` in this ticket's commit, app forms only. `docs/decisions.md` holds the call.
- **PDF:** `pdf-lib`, in a server-only route handler under `/app/familia/documentos/[id]/`, `attachment`, `Cache-Control: no-store`, a file name with no person's name. It reads `GET /students/:id/documents/fpn` or `/boletim`, so `requireOfficeOrFamily`, the SNS rule and the audit stay in one place. Use `boletimValue` and the placements as `BoletimSheet` / `placementStyle` do, so the two renders share their inputs. Check the white strip (`width`) and the disciplines' X, and that Helvetica's WinAnsi carries Portuguese accents. `embedJpg`, because `lib/page-image.ts` stores a JPEG.
- **Links:** a plain anchor, never prefetched, as today.
- **Proposals:** use the `write-migration` skill. A new table in `TENANT_TABLES`, RLS, composite FKs. An ID number in a proposal is encrypted as the record's is, and its read audits. Accepting writes through the record's own paths (`docs/conventions/students-and-families.md`: *An edit records what it changed*). Add it to `studentsToReview`, keeping one definition of the circle.
- **Decided earlier and reversed in part:** POOLSE-177 and POOLSE-179 keep those fields office-only. They still are, because a proposal changes nothing until accepted, so say that plainly in the ticket's commit.
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
7. Given a proposal, then the record is unchanged, the office's circle shows, and the field's download stays off.
8. Given *Aceitar*, then the record changes, the audit says so, and the download opens.
9. Given *Rejeitar*, then the record is unchanged and the app says so.
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
- [ ] A correction changes nothing until the office accepts it, and raises the circle.
- [ ] A signed PDF is stored byte for byte.
- [ ] The office reviews the signed copy first; the desk path still works.
- [ ] The boletim stays download only.
- [ ] Roles, tenancy and audit proved by tests.
- [ ] `CLAUDE.md`, `docs/conventions/interface.md`, `docs/data-model.md`, `docs/features/app.md` and `docs/features/students.md` updated.
- [ ] pt-PT and `en`; `/poolse-security-review` run.

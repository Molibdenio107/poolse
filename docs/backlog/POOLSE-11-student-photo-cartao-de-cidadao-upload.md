# POOLSE-11 · Student photo + Cartão de Cidadão upload

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Mobile app · **Priority:** Medium
**Depends on:** POOLSE-17 (the document belongs to the Person, not to a role)

### PO — why this exists

Schools need a copy of a student's identification on file, and today staff keep it in email or on a phone. Putting the Cartão de Cidadão next to the profile picture — in the backoffice and in the mobile app, where the student or their encarregado de educação can submit it themselves — removes the paper chase at enrolment. It is Medium rather than High because enrolment works without it, but the storage, access and audit rules must land correctly the first time: this is sensitive personal data and retrofitting privacy is expensive.

**Not in scope:** the GDPR retention rule and the purpose notice shown at upload time (flagged below as its own ticket), OCR or automated extraction of card data, and identity verification of any kind.

### BA — rules and data

- Two distinct slots on the record: profile picture and identification document. They are different objects with different access rules and must never share a storage path or a component (AC1, AC3).
- Per POOLSE-17 the document hangs off the **Person**, once — not off the student role and not duplicated when the same human is also an encarregado de educação.
- Accepted types JPG, PNG, PDF; cap suggested at 10 MB; front and back supported either as two files or as a multi-page PDF (AC2).
- Read/download access: Owner, Admin, Instructor. Student and Encarregado de Educação may view and replace **their own**; every other role sees only a binary "ID submitted ✓ / missing" indicator and never the file (AC4).
- Guardianship grants access: an encarregado de educação may view and replace the document of a student they are linked to (POOLSE-04 link), which is what "their own" means for a guardian.
- Every view or download is audit-logged with actor, student and timestamp (AC6). Uploads and deletions should be logged on the same trail — the acceptance criteria name views and downloads explicitly, and there is no reason for the write path to be quieter.
- Files are stored privately; access is only ever through short-lived signed links (AC7). A signed link must not outlive the session that requested it, and must not be reusable by a different actor once shared.
- Replacement supersedes the previous document rather than overwriting it blindly; deletion is Owner/Admin only (AC8). **Open:** whether the superseded version is retained and for how long — this is exactly the retention question the note defers, so do not decide it here.
- Edge case: a Person who is both a student and an encarregado de educação has one document; a change made from the Alunos side is the same change seen from the guardian side.
- Conflict to watch: POOLSE-35 splits Pessoas (staff) from Alunos (students and guardians), but the document is one object on one Person — the two views must reach the same file, not two.

### Dev — implementation notes

- Schema: a document table keyed on the Person (not the student enrolment), carrying tenant key, kind (`photo` | `id_document`), storage key, MIME type, byte size, page/side ordinal, uploaded-by, uploaded-at, superseded-by. Tenant key on the row and every query scoped, per the data-model rule.
- Storage: private bucket, no public URLs, object keys that are not guessable and carry no personal data. Signed link generation is a server responsibility with a short TTL; never hand the client long-lived credentials or a raw path.
- API surface: request-upload (returns a signed PUT or a server-side upload endpoint), list documents for a Person, request-download (returns a signed GET **and writes the audit row in the same transaction**), replace, delete.
- The audit write must not be a fire-and-forget side effect of the download handler — if the log write fails, the link is not issued. An unlogged download is a compliance failure, not a minor bug.
- Permission logic lives in one shared server-side policy (`canViewIdDocument(person, actor)`), resolving the actor's role union per POOLSE-17 plus any guardianship edge. The mobile app and the backoffice call the same policy; the "submitted ✓ / missing" indicator is a separate, cheaper query that returns a boolean and never a link.
- MIME sniffing on the server, not trust in the client-declared type or the file extension; reject anything outside the allowed set, and reject at the size cap before the bytes are stored, not after.
- i18n: slot labels, empty states, the submitted/missing indicator, error copy and the eventual purpose notice all go through pt-PT and en keys. Theming: both empty-state placeholders and the indicator must read in light and dark mode, and "submitted" must not be signalled by a green dot alone (AC and the global colour rule).
- Mobile app: camera and gallery capture, replace-existing, and resilience to a backgrounded upload — a half-finished upload must not leave a document row pointing at nothing.
- Most likely to get wrong: letting the ID document render through the same avatar component as the profile picture, so a citizen card shows up as a thumbnail in a turma roster. AC3 forbids it; enforce it by giving the document no avatar-shaped accessor at all.

### QA — test scenarios

11.1 Given an Admin on a student record / When they upload a 3 MB JPG to the ID slot / Then it is stored, the slot shows the document state, and the profile picture slot is unchanged.
11.2 Given an ID document exists / When any turma roster, card or avatar is rendered anywhere in the app / Then the document image never appears as the avatar.
11.3 Given an Instructor / When they open the document / Then it opens through a signed link and an audit row records actor, student and timestamp.
11.4 Given a Maintenance user / When they call the download endpoint directly with a valid document id / Then the API returns 403 and no signed link is issued — regardless of the UI hiding the slot.
11.5 Given an encarregado de educação linked to student A / When they request the document of unrelated student B via the API / Then 403; requesting student A's document succeeds.
11.6 Given a 12 MB PDF / When upload is attempted / Then it is rejected with an inline size error before storage, and the slot keeps its previous document.
11.7 Given a file named `card.jpg` whose bytes are actually an executable / When upload is attempted / Then server-side type detection rejects it.
11.8 Given a signed link issued to an Admin / When the link is used after its TTL expires / Then access is denied and re-issuing requires a fresh authorised request.
11.9 Given a document is replaced / When the record is reopened / Then the new document is shown, the previous one is superseded rather than silently destroyed, and the replacement is on the audit trail.
11.10 Given a Person who is both a student and an encarregado de educação / When their document is uploaded from the Alunos side / Then the same single document is visible from their guardian profile — no second record (POOLSE-17).
11.11 Given locale pt-PT then en / When the slots are empty / Then both empty states and the "ID submitted / missing" indicator render in the active language with no missing keys.
11.12 Given dark mode then light mode / When one slot is filled and one is empty / Then both states are legible and distinguishable without relying on colour.
11.13 Given the mobile app with a flaky connection / When an upload from the camera is interrupted / Then no orphan document row is created and the user is told to retry.

**Note — worth flagging:** a Cartão de Cidadão is sensitive personal data under GDPR. Recommend a stated retention rule and a purpose note shown at upload time before this ships. Say the word and I'll write that as its own ticket.

### Acceptance criteria

1. Student record shows two upload slots: profile picture and identification document, each with its own empty-state placeholder.
2. Accepted: JPG, PNG, PDF; size cap (suggest 10 MB); both sides of the card supported (front/back, or multi-page PDF).
3. Uploaded document is **not** rendered as an avatar anywhere — it opens only from its own slot.
4. Visible/downloadable by Owner, Admin and Instructor. Student and EE can view and replace their own; other roles see only an "ID submitted ✓ / missing" indicator.
5. Mobile app: student and EE can upload from camera or gallery, and replace an existing upload.
6. Every view/download of an ID document is audit-logged (actor, student, timestamp).
7. Files are stored privately (no public URLs); access goes through short-lived signed links.
8. Replacing a document supersedes the previous one; deletion allowed for Owner/Admin.

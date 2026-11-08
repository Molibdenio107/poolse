# POOLSE-201 · The payer sees their payment documents in the app, under *Perfil*

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Billing · **Priority:** Medium (pilot) · **Depends on** [POOLSE-178](./POOLSE-178-pagamentos-says-what-is-due-and-what-is-coming.md), [POOLSE-176](./POOLSE-176-perfil-reads-first-edits-second.md) · **Related** 7b.7 (certified invoicing), [POOLSE-162](./POOLSE-162-payment-against-an-external-invoice.md)

### As built (08-11-2026) — wins over what follows

- **API**: `GET /app/invoices?offset=` and `GET /app/invoices/:id` in `app.controller.ts`, both `Cache-Control: private, no-store`, on `billing/payer-invoices.repository.ts`. That file reuses the office's `INVOICE_COLUMNS` / `JOINS_SQL` / `TOTALS_SQL` / `toInvoice` / `readLines`, now exported from `invoices.repository.ts`. The payer test is one SQL predicate (`MINE_SQL`). `payer` is also true for a guardian who is `invoice_payer_membership_id` for any child, before the first document exists.
- **The detail drops** the payments, the chases, the chase count and the payer ids. It is built field by field, so a new `Invoice` field is not sent to families by default. Every detail read writes `invoice.read_by_payer` with the document number.
- **Paging is newer/older by 20** (`?offset=`), not *Ver mais* appending.
- **Status words are the office's** (`StatusBadge`): *Em aberto*, *Pago em parte*, *Em atraso*, *Pago*, *Anulado por nota de crédito*.
- **The A4 paper is `dashboard/faturacao/invoice-paper.tsx`**, lifted out of the office's print page unchanged. It takes `kindLabel`, so the family's paper says *Extrato*, never *Fatura*. The office's paper is unchanged. The logo comes from the shell, not `/settings/logo`, which is staff-only.
- **Routes**: `/app/perfil/extratos`, `/app/perfil/extratos/[id]` and `/app/perfil/extratos/[id]/print`.
- ***Ver extratos* on *Pagamentos*** shows only for a payer, like the *Perfil* row.
- **Module**: with invoicing switched off for the club, the list answers `payer: false` and a document is a 404 (security review, 08-11-2026).
- **Tests**: `apps/api/src/app/payer-invoices.integration.test.ts` (QA 1–7, plus a real cross-tenant id and the module switched off; needs `pnpm db:up`), role-probe lines for both routes and `apps/web/src/lib/service-worker.test.ts` (the worker stays push-only).

### PO — why this exists

Rui, 08-11-2026: *"Invoices for student app"* and *"a submenu on student mobile app inside 'profile' to consult those 'invoices' similar to 'documents' or 'settings'."*

*Pagamentos* is per child: what is owed, what is coming. A document is per **payer**: one fatura can cover two siblings (the `invoice` migration's own rule). A parent who wants "the paper for October" has nowhere to find it today except asking the office. So the list belongs to the person who pays, as a row on *Perfil* beside *Pagamentos* and *Documentos*.

This narrows POOLSE-178's *not in scope* line ("invoices and receipts as PDFs in the app — after certified invoicing"): the **internal** documents come to the app now, labelled as what they are; the certified PDF replaces them when 7b.7 ships.

**Not in scope:**
- Certified faturas (ATCUD, QR, AT communication): 7b.7. Nothing here pretends to be one.
- Paying from a document: POOLSE-83 / 121.
- Emailing a document to the family, documents of fees marked *invoiced elsewhere* (POOLSE-163), the office's *Faturação* pages.

### BA — rules

1. **The row.** *Perfil* gains *Extratos* (`Receipt` icon) between *Pagamentos* and *Convidar amigos*, same row style, under the same `familyRows` condition **and** only when the reader is a payer: `GET /app/invoices` answers `payer: true`. A child signed in as a student (not on the adult path) never sees it.
2. **The name says what it is.** Label *Extratos* while Poolse issues internal records. The certification ticket renames it *Faturas* and swaps the view for the certified PDF. Never *Faturas* before then: a parent hands a "fatura" to an accountant or to the IRS.
3. **The list**, `/app/perfil/extratos`: newest first, 20 at a time with *Ver mais*. Each row: document number, issue date, total, a status word (*Pago*, *Por pagar*, *Em dívida*, *Anulado*) and the children it covers (*Golfinhos · Tomás, Inês*). A credit note is its own row, *Nota de crédito de FT …*. Nothing: *Ainda não há extratos.* Status comes from the same status the backoffice badge uses, never recomputed on the phone.
4. **One document**, `/app/perfil/extratos/[id]`: what the backoffice print page says, and nothing more. Number, dates, payer as snapshotted, lines through `LineLabel`, VAT, totals, paid and owed. The **internal-record notice is first on the screen**, not in the footer.
5. **On paper.** *Guardar PDF* opens `/app/perfil/extratos/[id]/print`: the same A4, monochrome print page as the backoffice one, with its notice. No generated PDF (the standing print-page decision).
6. ***Pagamentos* points here.** Below *Pagos*, one link: *Ver extratos*. *Pagamentos* lists no documents itself, so money never lives in two lists that drift apart.
7. **Whose documents.** Only documents where the reader **is the payer**: `payer_membership_id` is the reader's membership, or `payer_student_id` is the reader's own student record on the adult path. A second guardian who is not the payer sees none of them, even for their own child. That is the paper's addressee rule, not a bug (open point 2).

### Security

- **Reads go through the payer, never through the child.** The repository filters on the reader's own membership / own student, not on "a child I guard". Being a live guardian of a student on line 3 does not open the document.
- **A document that is not yours is a 404**, not a 403: the API does not say whether a number exists. Same for another tenant's id. Instructor or staff-only token on `/app/invoices` → 403.
- **The payer's NIF and address** are on the document. They show only to the payer, and they are left out of the list response (number, dates, totals, status and child names only).
- **`Cache-Control: private, no-store`** on `GET /app/invoices*` and on the three pages. `sw.js` has no fetch handler today; this ticket adds a test that keeps it that way for `/app/perfil/extratos`.
- **Reads are audited** with the existing read-audit (document id, reader), as the medical notes are: a fiscal document opened from a phone is worth a line.
- Ids are uuids in the path; no storage key, no pre-signed address. The club logo goes through `/files/<id>` as everywhere.
- Before go-live: `poolse-security-review` on the new controller methods and the print route.

### Dev notes

- New in `app.controller.ts`: `GET /app/invoices?cursor=` → `{ payer: boolean, documents: [...], next: string | null }` and `GET /app/invoices/:id`. Build both on `invoices.repository.ts`'s existing reads with a payer filter added there. Not a second SELECT that could drift from the office's.
- The payer resolution is `invoice_payer_membership_id`'s rule, read once per request, not re-derived in TypeScript.
- Reuse `LineLabel` and the print page's layout. Lift the shared part into a component rather than copying the 200 lines.
- `AppFrame`'s `tabbed` list is unchanged: these are screens deeper in, with *Voltar* to `/app/perfil?home=family`.
- i18n: `app.invoices.*` in pt and en; `i18n:check`.
- Trap: `window.print()` inside an Android WebView (a later Capacitor APK) does nothing. On the PWA it works. Leave a note in the Capacitor spike ticket rather than solving it here.

### QA

1. Given a guardian who pays for two siblings with three documents, then *Extratos* lists three rows, newest first, each naming both children.
2. Given a second guardian of the same child who is not the payer, then the *Perfil* row is absent, `GET /app/invoices` → `payer: false, documents: []`, and `GET /app/invoices/:id` of the first guardian's document → 404.
3. Given a minor signed in as a student, then no row. Given an adult student who pays for themselves, then the row and their documents.
4. Given a credit note against FT 2026/12, then it is its own row and the original reads *Anulado* (or partly, as the backoffice says).
5. Given another tenant's document id → 404; given an instructor's token → 403.
6. Given the list response, then it carries no `payerTaxNumber` or `payerAddress` (contract test).
7. Given a document page and its print page, then the internal-record notice is the first text block, and the response has `Cache-Control: private, no-store`.
8. Given *Pagamentos*, then *Ver extratos* opens the list, and *Pagamentos* lists no document numbers.
9. Both themes on list and detail; print page monochrome.

### Acceptance criteria
- [ ] *Extratos* row on *Perfil*, payers only.
- [ ] List, detail and print page, internal notice first.
- [ ] Payer-only reads, 404 for others, no-store, audited.
- [ ] *Ver extratos* link on *Pagamentos*.
- [ ] QA 1–9 green; `i18n:check`; security review done.

### Decided (Rui, 08-11-2026)

1. **Label**: *Extratos*. Not *Faturas* until 7b.7.
2. **Second guardian**: payer only. A guardian who is not the payer sees no documents.
3. **Timing**: build now.

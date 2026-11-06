# POOLSE-178 · *Pagamentos* says what is due, what is coming and how to pay — and says plainly that paying in the app is not here yet

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Billing · **Priority:** Medium (pilot) · **Depends on** [POOLSE-136](./POOLSE-136-the-app-phone-shell.md), [POOLSE-94](./POOLSE-94-club-payment-details-iban-mbway.md), [POOLSE-42](./README.md) (fee periods) · **Related** [POOLSE-83](./POOLSE-83-paying-at-enrolment.md), [POOLSE-121](./POOLSE-121-free-swim-and-enrolment-from-the-phone.md) (paying in the app, still open)

### PO — why this exists

Rui, 05-11-2026: *"if 'pagamentos' are not yet working please say something that is 'building'. This will have to show the fees due and the next expects payments for this student and such."*

*Pagamentos* today is `FeeStatus` moved off the agenda: one line per child — *Em dívida 45,00 €* / *Por pagar 45,00 € até 08-11-2026* / *Em dia* — and nothing else. Two things are wrong with it. The line **links to `/dashboard/students/:id?tab=fees`**, a backoffice page: a parent who taps it is sent out of app mode into a screen built for the office (and, for a plain guardian, to a 403). And a parent who expects to pay finds no button and no sentence saying why. The screen has to say three things: what is owed now, what comes next, and how to pay today — by transfer or MB WAY to the club's details (POOLSE-94) — with one honest line that paying inside the app is on its way.

**Not in scope:**
- Paying in the app (Stripe, MB WAY, débito direto): POOLSE-83 / 121's open point. This ticket neither starts nor pre-empts it.
- Invoices and receipts as PDFs in the app — after certified invoicing (`docs/research`, the competitor gaps doc).
- The office's fee pages.

### As built (05-11-2026) — wins over what follows

- **There is no `fee_occurrence`.** A fee line tracks its current occurrence, so `GET /app/fees` reads `studentFees` and walks later ones with `current_period_start` and `fee_due_on`.
- ***Em dívida* is what `balance` calls overdue:** each line's current occurrence. An older period left unpaid is in no total anywhere in Poolse, and a list that walked them would disagree with every other screen. Filed as a question for Rui, not fixed here.
- ***Pagos* shows no euros.** `student_fee_payment` records the period settled, not the amount, and a line's amount today is not what was paid then.
- **The late charge** is its own line under *Em dívida*, because `balance` adds it to no single occurrence.
- **The card is POOLSE-94's `PaymentDestinations`,** with its reference: the open documents, else the child's name. *Copiar IBAN* is its copy button.
- **`FeeStatus` is gone,** and with it the link to the backoffice. The chips are `ChildFilter`.

### BA — rules

1. **Three sections per child, in this order**: *Em dívida* (overdue occurrences, each with its period, amount and due date), *Próximos pagamentos* (the next three fee occurrences from `fee_occurrence`, by due date, amount and what it covers — *Mensalidade Dezembro · Golfinhos*), *Pagos* (the last six settled periods, folded). A child with nothing in a section shows the section with *Nada* — never the section missing, so a parent learns the shape once.
2. **The money is the invoice's**, never recomputed on the phone: amounts and dates come from the fee read the owner's page uses, filtered to the reader's children.
3. **How to pay**: a card with the club's IBAN and MB WAY number (POOLSE-94) and *Indique o nome do aluno na referência*. *Copiar IBAN* copies it. Absent when the club recorded neither.
4. **The honest line**, last on the screen while in-app payment is not built: *Pagar na app — em breve. Por agora, pague por transferência ou MB WAY.* It is a sentence, not a disabled button (a disabled button promises a date). It is removed by the ticket that ships payment.
5. **No link leaves app mode.** The backoffice link goes. A guardian never reaches `/dashboard/students/:id` from here.
6. **Siblings on one payer** (the payer-addressed invoice groups them): the sections are per child, and a line *Fatura conjunta com Tomás* says when one occurrence covers both, so the same amount is not read twice.

### Dev notes

- New `GET /app/fees` (guardian or student): `{ children: [{ id, name, overdue: [...], upcoming: [...], paid: [...] }], club: { iban, mbway } }`, built on the same repository reads as the student's *Mensalidades* tab; `upcoming` limited to 3, `paid` to 6. A child the reader is not a live guardian of is a 404.
- `FeeStatus` on *Início* (POOLSE-174) keeps using `balance` from the agenda; only its `href` changes to `/app/familia/pagamentos?child=`.
- Copy to clipboard in a try/catch with a toast; no `navigator.clipboard` assumption on an older WebView.
- Trap (POOLSE-104): the club's IBAN lives on the invoicing settings, column-granted; the API must read it through the same path the invoice template does, not a new SELECT.

### QA

1. Given a child with November overdue and December/January/February scheduled, then *Em dívida* lists November, *Próximos* lists the three, *Pagos* folds the last six.
2. Given the club has an IBAN and no MB WAY, then the card shows the IBAN only and *Copiar IBAN* copies it.
3. Given the screen, then no element links to `/dashboard/...` (DOM assertion).
4. Given two siblings on one invoice, then each child's section shows the occurrence and the *Fatura conjunta* line.
5. Given a guardian of another family's child, `GET /app/fees?child=` → 404; given a cross-tenant token → 404; given an instructor's token → 403.
6. Given the honest line, then it is a paragraph with no button role.
7. Both themes, snapshot.

### Acceptance criteria
- [x] Overdue, upcoming and paid per child, from the invoice data.
- [x] How to pay from POOLSE-94; a plain sentence that paying in the app is coming.
- [x] The backoffice link from the app is gone.
- [x] QA 1–7 green; `i18n:check`.

# Invoicing — what goes out to a family

The document a fee line becomes. The price list is in `docs/features/billing.md`; the schema
is in `docs/data-model.md`.

## What these documents are — and are not

**They are internal records, not legal faturas.** Decreto-Lei 28/2019 requires certified
software, a validation code obtained from the AT for each series, an ATCUD and a QR code on
every document, and a SAF-T (PT) export. Poolse produces none of that. What a club gets here
is a priced, numbered, immutable record it hands to whatever software issues its faturas — and
the screens say so, in both languages, rather than leaving a club to find out from its
accountant.

The shape is nevertheless the shape certification needs, because that is the part that cannot
be retrofitted onto documents a club has already sent: a number is allocated by the database
inside the transaction that writes the document, a document is written once, and a correction
is a credit note rather than an edit.

## Who can do what

| Action | Roles |
|---|---|
| See the run, the issued documents and one document | owner, admin |
| Issue a run, or part of one | owner, admin |
| Issue a credit note | owner, admin |
| Rename a numbering book, or change its letter | owner, admin |

An instructor, guardian or student is refused by the API, not merely shown a page without the
controls. What a family is charged is a commercial fact, like the price list beside it.

## Numbering

Each **facility** numbers its documents in its own books — one for faturas, one for credit
notes — created automatically when the facility is. A document number reads `FT A/17`: the
document type, the book's letter, and the sequential number within that book.

- The sequence is **gap-free**. A document that is written and then rolled back gives its
  number back with it.
- A number is **never reused, back-filled or edited**.
- The **letter** may be changed only while the book is empty. After the first document it is
  fixed, and the screen says how many documents have been issued under it.
- A book's letter is unique across the whole club, so two sites cannot issue two different
  documents under one number.

The books are a card on the site page's **Dados do clube** tab, under the NIPC and *Como pagar*, shown while the invoicing module is on (POOLSE-104 B). Faturação itself has two views, *Este mês* and *Em dívida*, and one line saying where *Configuração* went, with a link — to be removed after the pilot.

## What a run bills

A month at a time. Each live fee line contributes the occurrence that falls in that month —
a monthly line every month, a trimestral line every third month from where it started, and a
line charged once (an inscrição, a seguro) only in the month it started. A line that has ended
contributes nothing after it ends.

An occurrence already on a live document is left out, and the count of those is **shown**:
"there is nothing to bill" and "everything here is already billed" are different things for an
operator to do, and only one of them means the price list needs looking at.

The run is safe to press twice. Pressing it again finds nothing.

## One document per payer

A document is addressed to whoever is responsible for the student: the primary guardian where
there is one, or the student themselves where there is not — which is the adult path, and also
a student nobody has given a guardian yet. **Two siblings under one guardian therefore land on
one document with two lines**, which is what a family pays and what direct debit will collect
against.

The payer's name, NIF, address and email are **snapshotted** onto the document, as are each
line's student name and NIF. A family that corrects a surname or moves house does not rewrite
what they were sent last March.

`student.tax_number` and the payer's NIF are different facts and both appear: a parent
deducting lessons on their IRS does it against the child's number.

## The per-student action

The same run, narrowed to one or more students. There is no second code path: a joiner
half-way through the month is billed by running the month for them alone, and everybody else
stays billable.

An operator may also deselect any family in the preview and issue the rest, so a club can bill
the families it has heard back from and leave the others for Friday.

## VAT

Amounts are **gross**, with the VAT already inside them, and each line records the rate that
describes what is in it. **Isento is its own flag, never a rate of zero** — on a Portuguese
document an exemption and a zero rate are two different statements. Where the club recorded an
exemption reason, the document prints it.

The document shows the amount before VAT, the VAT, and the total, all derived from the lines.

## Correcting a document

There is no edit and no delete: the application holds no privilege to do either. A document
that is wrong is corrected by issuing a **credit note** against it — a second document, with
its own number in its own book, mirroring every line and naming the line it reverses.

Once the credit note exists, the periods the original covered become **billable again**, so a
corrected document is issued by running the month afresh. Both documents stay in the list,
each marked with what it corrects or what corrected it, because hiding either would make the
numbering look gappy.

A document can be credited once. Crediting the wrong one is fixed by issuing a fresh invoice,
which is what the sequence is for.

## What is owed — phase 2.3

The **Em dívida** view lists everything still outstanding, oldest debt first, because that is
a job to work through rather than a record to look something up in.

Deliberately *outstanding* and not *overdue*: a club working through its debtors on a
Wednesday wants Friday's document in front of it too, and a list that appeared only once the
date had passed is a list nobody can get ahead of. Each row carries its own status.

A document is in exactly one state, and the state is worked out fresh every time it is read:

| Status | Means |
|---|---|
| **Em aberto** | Issued, nothing paid, not yet due |
| **Pago em parte** | Some money has arrived, not yet due |
| **Em atraso** | Past its due date and not settled — shown with the number of days |
| **Pago** | Settled, whenever that happened |
| **Anulado por nota de crédito** | Owed by nobody, whatever was paid against it |

Two rules inside that are worth stating. A partly paid document past its due date is still
**overdue** — half of nothing arriving on time is still late. And a **credited** document is
owed by nobody even if a payment had already arrived: the money is still on the record, but
the debt is not.

Every status is a word before it is a colour, so the screen reads the same to somebody who
cannot tell the amber from the red.

## Recording a payment

One row per arrival, so a family paying in two instalments produces two records that add up.
Each carries the amount, the day the money arrived (not the day it was typed in — Friday's
transfers get entered on Monday), how it arrived, and an optional reference: a bank reference,
an MB WAY id, a receipt number.

Nothing about the document changes. Recording €45,00 moves the badge from *em aberto* to
*pago* because the state is recomputed, not because anything was written to the invoice — it
holds no UPDATE grant at all.

An **overpayment settles** rather than making the club owe the family money; the outstanding
figure floors at zero. A payment entered against the wrong document is **archived, not
deleted** — money is history, and so is the record of the mistake.

A **credit note is never paid**. Money against one is money against the wrong document, and
the refusal is the database's rather than a screen's.

## Chasing

A chase records that a person telephoned, wrote or spoke to a family on a day — which is what
makes a second chase a different conversation from the first, and what somebody needs to know
before picking up the telephone. A person never records a Poolse email by hand.

**A reminder by email (POOLSE-86).** On **Em dívida**, owner or admin ticks documents and presses *Enviar lembrete por email*. The ticked documents name their
payers, and the dialog shows, before anything is written, each payer's **overdue** documents at
this site with the total, the address, anyone with no address (named, sent nothing), anyone whose
ticked documents are not late yet, and the club's *Como pagar*. A payer reminded by email in the
last 7 days is flagged with the date and starts unticked — never blocked (Rui, 19-10-2026). Each
payer gets one email: what is overdue, document by document, the total, and *Como pagar* verbatim
(else "contact the club"). Each send is an `invoice_reminder` row (what it listed, snapshotted)
and an ordinary chase on every document it listed, channel *Email (Poolse)*, so "last contact"
counts it; the document's history says whether the email left. The emails leave after the
request has answered (sweep 19-10b), so a long list never times out the page. It counts against the club's
shared daily address ceiling with messages (2,000), and a failed send is retried hourly.
*Como pagar* is the club's own text on the site page's *Clube* tab.

**Where families pay (POOLSE-94).** *Como pagar* on *Dados do clube* is three cards: **Transferência
bancária** (IBAN and account holder), **MB WAY** (a mobile number) and **Outras instruções** (the
free text above). One account for the whole club, not per site (Rui, 22-10-2026); owner and admin
set it, and it is behind the invoicing module like the rest of *Como pagar*. Every field may be
left empty, which clears it. An IBAN must be Portuguese (`PT50` + 21 digits, spaces allowed) and
pass the mod-97 check; an MB WAY number must be a Portuguese mobile (`9…`, with or without +351).
Both are judged by `@poolse/rules` (`normalizeIban`, `ibanChecksumOk`, `normalizeMbwayPhone`) and
refused beside the field. A holder left empty shows the club's name; a holder with no IBAN is not
kept.

A family reads the result on the child's **Mensalidades** tab and on app mode's fee card,
whenever something is owed: the IBAN and the MB WAY number with a copy button each, and *Indique
como referência* — the child's open documents (`FT 2026/14, FT 2026/31`) or, with nothing
invoiced yet, the child's name (Rui, 22-10-2026). The office's own read carries none of it. A
payment reminder's *Como pagar* says the same, in the same order: transfer, MB WAY, the
reference (that email's documents), then the club's words; with nothing filled in it still says
to contact the club.

**An IBAN change is told to every owner.** Saving a different IBAN (including the first one, and
clearing it) writes a `payment_change_notice` and emails every active owner after the commit:
who changed it, when, and the account's **last four digits** before and after — enough to
recognise, not enough to use. The full values are in *Atividade*
(`organization.payment_details_changed`, before and after of the fields that moved). A change to
MB WAY or the holder alone is audited and emails nobody. A notice that did not leave is retried
hourly like every email.

**Not yet: online payments into this IBAN** (BA rule 5). When Stripe/débito direto/MB WAY
payments arrive with slice 3.5, the money a club collects through Poolse is meant to settle into
this same account. Nothing reads these columns for that today.

Each record carries the channel (email, telephone, message, in person, letter), the date and
an optional note of what was said or answered. The **Em dívida** list shows when each family
was last asked and how many times.

When the notification subsystem lands it writes into this same history with a channel of its
own; nothing about these screens has to change.

## Not here yet

Automated collection — Stripe, débito direto, MB WAY — needs the payer to authorise it, and
the payer has no account until the student app. `student_fee_payment` is still where a settled
*fee period* is marked, separately from a document; joining the two is work nobody has asked
for yet. The ATCUD, the QR code and the SAF-T export arrive with certification, if it is ever
pursued.

## PDF — 12 October 2026

A document's page has a **PDF** link. It opens the document laid out for A4 in a new tab and
brings up the print dialog, where *Guardar como PDF* saves it. The printout shows what the
screen shows, including the notice that it is an internal record and not a legal fatura, under the club's logo when one is set (POOLSE-104 C).

Its **Voltar** is the page shell's, like every record's (POOLSE-104 A): back to the view and month the document was opened from — *Em dívida* to *Em dívida*, a month to that month — else the month it was issued in.

## On a phone

Below `md` the three tables — the month's run, the issued documents and *Em dívida* — become one card per row through `.table-stack`. Each cell is a "label  value" line, and the label comes from its `data-label`. The table is the same element, so the run's checkboxes and the reminder ticks work as on a desk. From `md` up nothing changes (POOLSE-88 phone views).

**Selecting the overdue (POOLSE-104 D).** The checkbox column's header, *Selecionar todos em atraso*, ticks every overdue row shown — never one that is open but not yet due — keeping any row ticked by hand. It is indeterminate while only some are ticked, and a click with every overdue row ticked clears the selection. It replaced the *Escolher o que está em atraso* button. Below `md` the table un-clips that one header cell as a labelled line above the cards (the same element, moved by CSS) and hides the column titles the cards already carry.

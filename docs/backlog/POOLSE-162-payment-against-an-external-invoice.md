# POOLSE-162 · A payment can be recorded against an invoice the club issued outside Poolse, with its number

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Invoicing · **Priority:** Medium (pilot) · **Depends on** [POOLSE-23] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "'Invoicing' should have a way to register an invoice, if the club manually did an invoice for a student but not through Poolse. For example if a student goes personally to the pool reception and the reception uses their own invoice program but still wants to register the student as paid for."

Decided 04-11-2026 (Rui): two shapes, two tickets — this one records the payment on the Poolse document; POOLSE-163 marks an occurrence as invoiced elsewhere so no Poolse document is made.

**Not in scope:** storing the external invoice's file; certified invoicing (7b.7).

### BA — rules
1. `payment_source` gains `external_invoice`. A payment with that source requires `reference` (the external document's number, ≤ 60 chars) — by CHECK.
2. The *Registar pagamento* dialog offers *Fatura externa* as a source and then requires the number; the document's badge reads *Pago* as for any payment and the history line reads *Pago por fatura externa n.º …*.
3. The family's fee read shows the same line (snapshot words, no new field).
4. Owner/admin only, as every payment is.

### Dev notes
- Migration: enum value + `CHECK (source <> 'external_invoice' OR reference IS NOT NULL)`. `invoice_status` unchanged.
- Form: `payment-form.tsx`, controlled `SelectField`; the reference field appears with `Reveal`.
- Trap: the reference is free text displayed to families — plain text, never a link.

### QA
1. Given an open document, when a payment `external_invoice` with reference FT 2026/12 is recorded, then the document reads paid and the history names the number.
2. Given the same with no reference, then 422 under the field.
3. Instructor → 403; cross-tenant invoice → 404.
4. Both themes on the dialog.

### Acceptance criteria
- [ ] Source value with its CHECK.
- [ ] Dialog and history wording.
- [ ] Tests above; `docs/features/invoicing.md` updated.

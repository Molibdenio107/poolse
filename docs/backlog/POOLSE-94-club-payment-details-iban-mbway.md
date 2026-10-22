# POOLSE-94 · How families pay the club: IBAN and MB WAY as real fields

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Club data / Billing · **Priority:** High · **Related** [POOLSE-83](./POOLSE-83-paying-at-enrolment.md) (online payments, BA-5) · **Depends on** [POOLSE-86](./POOLSE-86-email-delivery.md) 3.0b (`organization.payment_instructions`, the *Como pagar* free text), [POOLSE-87](./POOLSE-87-modules-per-club.md) (invoicing module)

### PO — why this exists

Rui, 22-10-2026: *"Club details 'how to pay' should be transformed to separated card sections, containing as recipients: IBAN, MB WAY phone number. Displayed only for owner and admin. The payments for the club should have this as a destination. And when a student or guardian wants to pay, they should see the destination IBAN."*

Today *Como pagar* is one free-text box on *Dados do clube* (`tax-panel.tsx`, `PaymentInstructionsPanel`). Only the invoice reminder email reads it, verbatim. A family looking at what they owe in the app sees nowhere to pay to. A typo in an IBAN inside free text goes unnoticed.

**Not in scope:**
- Collecting money online. Stripe and checkout belong to POOLSE-83, and débito direto to POOLSE-25.
- Matching incoming transfers to invoices automatically.
- More than one IBAN per club. Per-site accounts would be a later ticket if a club asks.

### BA — rules

1. **Dados do clube** gets a *Como pagar* area with **separate cards**:
   - **Transferência bancária:** IBAN (validated: PT50 format and mod-97 checksum, stored without spaces, shown grouped in 4s) and account holder name (defaults to the club's name).
   - **MB WAY:** phone number (PT mobile, +351 9xxxxxxxx).
   - **Outras instruções:** the existing free text, kept for office hours, cash at reception and the like.
   - Each card can be left empty. A family only sees the methods that are filled in.
2. **Editing:** Owner and Admin only, enforced in the API. Other staff do not see these cards (Rui: *"displayed only for the owner and admin"*).
3. **Families see where to pay.** A guardian or adult student sees the filled-in methods wherever they see money owed:
   - the app's money/invoices view;
   - the invoice reminder email (POOLSE-86 3.0b, which today only shows the free text);
   - an invoice or receipt page or print, if they have one.
   Each value has a copy button.
4. **The reference:** each payment destination shows *"Indique como referência: <document number>"*, so the club can match the transfer.
5. **Online payments land in the same account (Rui, 22-10-2026).** When families pay in the app (POOLSE-83 / 3.5), the money must reach this IBAN. Under POOLSE-83 the money **never passes through Poolse**: each club has its own contract with the provider (Ifthenpay or Eupago), and the provider settles into the account registered **on that contract**. Poolse can't redirect a payout. What it can do:
   - On the payment-provider setup (3.5), show the IBAN from Dados do clube as *"Os pagamentos online são liquidados nesta conta"*, and ask the owner to confirm it matches the account on their provider contract (a checkbox, recorded with actor and date).
   - If the provider's API exposes the settlement IBAN, compare it automatically and warn on a mismatch.
   - When the IBAN changes here, flag the provider setup as *a confirmar* again until the owner re-confirms.
6. **Audit:** every change to IBAN or MB WAY records actor, old and new value, and when. A changed IBAN is the classic fraud vector, so an IBAN change also **emails every Owner**.

### Dev notes

- Migration (use the `write-migration` skill): add `payment_iban`, `payment_account_holder` and `payment_mbway_phone` to `organization`, or create a `club_payment_method` table if open question 1 says per-site. Add a CHECK for IBAN shape. Do the checksum in the API, so the error message is translatable. Keep `payment_instructions` as the free-text card.
- Rendering: one `PaymentDestinations` component, used by Dados do clube (edit), the family view (read) and the email template (plain text). Never three copies of the wording.
- Family read: the family endpoint returns only the filled-in methods. RLS stays as is: families already read their own club's public settings. Add a role-probe line for the edit endpoint (family and staff denied).
- Gated by the invoicing module, as *Como pagar* is today.

### QA — scenarios

1. **Given** an owner, **when** I save an IBAN with a bad checksum, **then** it is refused with a clear message.
2. **Given** a valid IBAN and an MB WAY number, **when** a guardian opens what they owe, **then** both are shown with copy buttons and the document number as reference.
3. **Given** only MB WAY is filled, **then** the family sees only MB WAY.
4. **Given** a coach or receptionist, **then** they don't see the *Como pagar* cards, and the API refuses the edit.
5. **Given** an IBAN change, **then** every owner gets an email and the audit log records it.
6. **Given** an invoice reminder email, **then** it lists the structured methods, then the free text.

### Acceptance criteria

1. IBAN and MB WAY are separate, validated fields on Dados do clube, editable by Owner/Admin only.
2. Families see them wherever they see money owed, and so does the reminder email.
3. IBAN changes are audited and notify owners.
4. When 3.5 is built, the provider setup shows this IBAN and needs the owner's confirmation that it matches (BA-5).
5. Both languages, light and dark, role probe, `docs/features/invoicing.md` updated.

### Open questions

1. **One club account, or per site?** A club with two sites might bank separately. Recommended: one per club now.
2. ~~Online payments to this IBAN?~~ **Settled (Rui, 22-10-2026): yes.** Because the money goes through the club's own provider contract (POOLSE-83), Poolse confirms the match rather than setting the payout. See BA-5. Rule 5 is built with 3.5, not before.

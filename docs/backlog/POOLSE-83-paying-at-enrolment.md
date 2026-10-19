# POOLSE-83 · Paying at enrolment — checkout with a held place

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Billing / Mobile app · **Priority:** High · **Depends on** POOLSE-82, 3.5 (student pays operator), **POOLSE-76 (certified invoicing — blocking)**

### PO — why this exists

After POOLSE-82 a family can take a place in the app, but it still pays at reception. For the
office, a place that is taken and not paid for is the same problem as before, only moved later.
This ticket makes paying part of signing up. The inscrição, the seguro and the first mensalidade
are paid in one go, and the place is held until the money arrives.

**Two rules frame the whole ticket.**

- **The money goes to the club, never through Poolse.** Each club has its own contract with the
  payment provider (Ifthenpay or Eupago, decided in 3.5). Poolse stores that club's credentials and
  creates payment requests in the club's name. It never receives, holds or refunds a euro. If money
  passed through Poolse, it would be acting as a payment intermediary, which needs a licence.
  This is also the answer this ticket proposes for `data-model.md` open question 1, to be confirmed
  in 3.5.
- **No certified invoicing, no checkout.** A payment taken in the app is a sale, and a sale needs a
  legal fatura. Poolse's internal invoices are not one. This ticket does not start before POOLSE-76.

**Not in scope:**
- **The monthly collection after the first payment.** That is 3.5's SEPA mandate and MB WAY
  collection. Checkout may *start* the mandate, but collecting runs in 3.5.
- **Refunds.** Poolse never refunds. It records that one is owed and the club refunds through its
  provider.
- **Card payments.** Add them only if the chosen provider offers them at no extra integration cost.
- **Paying for a trial lesson.**
- **Paying from the public pre-registration form.**

### BA — rules and data

**Checkout is switched on per club, and it is off by default** (`app_payments_enabled`, Owner
only). It needs both the provider's credentials and certified invoicing to be configured. Without
them, the switch cannot be turned on, and the screen says which of the two is missing. With it off,
POOLSE-82 works exactly as it does without this ticket.

**What a checkout charges is decided by the server, from the price list.** The client never sends
an amount; it never does in Poolse.
- **Inscrição**, if the student has none for that season. One per student per season is already
  enforced.
- **Seguro**, if the student has no cover for that season.
- **The first mensalidade period** of the turma's fee plan, with the student's fee category discount
  applied the way a line is agreed today: the figure is copied onto the line, and the category is
  named.
- Each part is shown as its own line with its amount, and then the total, before the family pays.

**Open:** is the first mensalidade charged in full, or pro rata when the turma has already started?
**Default:** in full for a period that has not started, and the club decides in the backoffice for
one already running. Poolse does not compute a proportion until a club asks for one.

**The held place.** Paying is what turns a held place into an enrolment.

| Method | How long the place is held | Why |
|---|---|---|
| MB WAY | 10 minutes | The family confirms on their phone, or it fails |
| Multibanco reference | Until the reference expires, **48 h by default** (club setting) | Paid at an ATM or in home banking, often the next day |

- A place held for checkout uses the same capacity count as a waiting-list offer (POOLSE-82). There
  is one held-place mechanism, not two.
- **An accepted waiting-list offer** moves straight to checkout. Its hold is the offer's own
  deadline or the payment method's, whichever ends later. A family is never cut short for choosing
  Multibanco.
- **When the hold runs out unpaid**, the place is released. If it came from the waiting list, the
  next offer goes out, exactly as a declined offer does.

**Payment confirms through the provider's callback, and only that.**
- The callback is checked as the provider requires (its key, signature or anti-phishing value). That
  check is the whole authentication.
- **Every callback is recorded once, keyed on the provider's own id**, in the same transaction as
  what it changes. This is the `stripe_event` pattern: a retry finds the row and stops.
- **A confirmed payment, in one transaction:**
  - the enrolment becomes active;
  - the fee lines are agreed;
  - the document is issued through the certified provider (a fatura-recibo, because it is paid in
    full) to the payer;
  - the payment is recorded against it.
- **No document exists before the money does.** A pending checkout is not an invoice.
- **An amount that differs from the checkout's** is not applied. It is recorded and shown to the
  office.

**Late money, the case that will happen.** A Multibanco payment can arrive after its hold expired.
- **If the place is still free**, the enrolment is made as if the payment had been on time.
- **If it is not**, the payment is recorded, the student goes to the **front of their tier** on that
  turma's waiting list, and the office gets a *reembolso ou lugar* task. Poolse never takes money
  and leaves the family with nothing on screen.

**The family sees every state in words:** *a aguardar pagamento até …*, *pago*, *expirou*,
*pagamento recebido após o prazo — a secretaria vai contactar*. The Multibanco reference (entity,
reference, amount, deadline) is visible text that can be copied, not only an image.

**Who may do what:**
- A **guardian or adult student** checks out for their own student.
- **The Owner** sets the credentials and the switch.
- **Owner and Admin** see checkouts and resolve late payments.
- **The payer** on the document is the guardian for a minor, or the student on the adult path, as
  invoices are addressed today.

### Dev — schema, API, where it goes

**Migration:**
- `payment_provider_account`, one per club: provider, credentials as ciphertext by
  `sensitive/cipher.ts` (CHECK on the shape), `configured_by`. Owner only, and never returned by any
  read.
- `checkout`:
  - student, turma, payer, the `waitlist_offer` it came from (nullable);
  - method, status (`pending`, `paid`, `expired`, `late_paid`, `failed`), `hold_expires_at`;
  - `amount_cents`, the provider's request id, and the MB reference fields;
  - with `checkout_line` snapshotting each part (kind, plan, category, amount).
- `payment_event`: the provider's event id as the primary key, the raw payload, the outcome. It is
  insert-only by grant.
- `organization.app_payments_enabled`, `multibanco_hold_hours`.
- **The capacity trigger counts pending checkouts** through the same held-place definition as live
  offers. If POOLSE-82 put that definition in a function, this ticket adds one branch to it.
- New tables go into `TENANT_TABLES`. Amounts are integer cents. Credentials never appear in logs,
  paths or the audit trail.

**API:**
- `POST /students/:id/checkout`, which previews the lines and total and creates nothing.
- `POST /checkouts` (the same body plus the method) creates the provider request and the hold in one
  transaction. If the provider call fails, the hold is not kept.
- `GET /checkouts/:id`.
- **`POST /webhooks/payments/:provider`** is public. It has a ceiling, answers 200 to anything it has
  already seen, and resolves the club from the provider request id, never from a parameter the caller
  sends.
- Office: the list of checkouts with late and mismatched ones first, and resolving a late payment
  (enrol, or mark a refund owed with a reason).
- The expiry joins POOLSE-82's 15-minute job and lock.
- Each endpoint is guarded by role or `requireActsForStudent` and added to the role probe.

**Where the logic lives:**
- The line list is composed by one function, read by the preview and the commit. A preview must never
  offer a line the commit then refuses, which is the same reason `invoice_charged_on` is one
  definition.
- Issuing the document goes through POOLSE-76's provider path, never a second invoicing route.

**What will be got wrong:**
- **Trusting the amount from the client**, or from the callback without checking it against the
  checkout.
- **Issuing the fatura when the checkout is created** rather than when it is paid.
- **Two held-place counts** (offers and checkouts) that disagree.
- **A callback that looks the club up from a field the caller controls.**
- **A slow provider call inside the transaction that holds the turma's capacity lock.** Create the
  provider request first, and write the hold with its id. If the provider call worked but the write
  failed, the unanswered request simply expires.
- **Letting a late payment vanish** because its checkout had expired.
- **Credentials readable** by an Admin, by the support grant, or in an error message.

### QA — test scenarios

1. **Given** checkout is switched off, **when** a family enrols, **then** POOLSE-82's behaviour,
   unchanged.
2. **Given** credentials set but certified invoicing not configured, **when** the Owner switches
   checkout on, **then** refused, naming what is missing.
3. **Given** a student with no inscrição or seguro this season, **then** the preview shows three
   lines and their total. **Given** one who already has both, **then** only the mensalidade.
4. **Given** a fee category of 20 % on the turma, **then** the mensalidade line shows the discounted
   figure and names the category.
5. **Given** a checkout body carrying an amount, **then** the amount is ignored and the server's
   total is used.
6. **Given** the last place and an MB WAY checkout pending, **when** the office enrols someone else,
   **then** refused as full.
7. **Given** MB WAY unpaid after 10 minutes, **then** the hold is released. If the place came from a
   waiting-list offer, the next person is offered it.
8. **Given** a paid callback, **then** one transaction: active enrolment, agreed lines, a certified
   document to the payer, and the payment recorded. **Given** the same callback again, **then**
   nothing changes and the answer is 200.
9. **Given** a callback with a bad signature or key, **then** refused and nothing changes. **Given**
   a callback naming another club's request, **then** it changes only the club that owns the
   request.
10. **Given** a Multibanco payment after expiry with the place still free, **then** enrolled.
    **Given** the place taken, **then** the payment is recorded, the student is at the front of their
    tier, and the office sees *reembolso ou lugar*.
11. **Given** a paid amount different from the checkout, **then** nothing is enrolled, and the
    mismatch shows to the office.
12. **Given** an Admin, **when** they read the provider account, **then** no credential appears.
    **Given** an Admin, **when** they write it, **then** 403.
13. **Given** another family's student, **when** a guardian checks out for them, **then** 404.
    Club B's checkout is not found from Club A.
14. **Given** a pending Multibanco checkout, **then** the app shows the entity, the reference, the
    amount and the deadline as text.

### Acceptance criteria

1. Checkout is per club, off by default, and cannot be switched on without provider credentials and
   certified invoicing.
2. The money goes to the club's own provider account. Poolse never holds or refunds it.
3. The lines (inscrição, seguro, first mensalidade, with discounts) are composed on the server by
   one function shared by preview and commit.
4. A pending checkout holds the place through the same held-place count as a waiting-list offer, for
   a time that depends on the method.
5. Only a verified, recorded-once provider callback confirms a payment. Confirming enrols, agrees the
   lines, issues the certified document and records the payment in one transaction.
6. An unpaid hold expires and passes the place on. A late payment is never lost: it enrols if the
   place is free, otherwise it queues the student and raises an office task.
7. Every state is shown to the family in words, and the Multibanco reference is copyable text.
8. Credentials are encrypted, Owner-only and never read back.

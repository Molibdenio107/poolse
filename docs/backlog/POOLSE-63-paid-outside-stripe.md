# POOLSE-63 · Subscriptions paid outside Stripe

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Platform / Billing · **Priority:** High — the first clients are people Rui knows, and they will pay him directly · **Depends on** POOLSE-61 (the lifecycle job it rides on) · **Slice D**

### PO — why this exists

Some clients will pay in cash, by transfer, on a handshake. `/admin` has to be able to turn a
subscription on for them **without a Stripe customer existing at all**.

**Do not reuse `comped` for this.** The platform slice reasoned explicitly that a free pilot
must not look like revenue and must not look like a trial. A paying client who hands over cash
is a third thing again, and folding it into `comped` would understate revenue in the one set of
numbers that has to be right — Rui's own.

**Not in scope:** invoicing Poolse's own revenue. That is a later ticket. What this ticket must
do is make sure the *data* exists from the first payment, because it never will if it does not
start now.

### BA — rules and data

**`billing_mode` is `stripe | manual | comped`**, NOT NULL, default `stripe`. It says *how* a
club pays. `subscription_status` goes on saying *whether* they are paying, and `suspended_at`
goes on saying whether the door is open — three columns, three questions, none of them merged.

**A manual subscription must have an end date.** This is the constraint the slice exists for:

```sql
CHECK (billing_mode <> 'manual'
       OR subscription_status <> 'active'
       OR paid_through IS NOT NULL)
```

Without it Rui flips a tenant to active, forgets, and they run free for two years. **A manual
subscription that cannot be forgotten is the whole requirement.**

**`paid_through` is set by recording a payment, never typed directly.** The payment is the
fact; the date is derived from it. A field somebody fills in by hand is a field that disagrees
with the money.

**The Stripe webhook refuses to touch a tenant whose `billing_mode` is not `stripe`**, and
records the refusal in `stripe_event` with an outcome saying so. A stray event must never
silently take over a hand-managed club.

**`manual_payment` is insert-only** — same reasoning as every other book in this schema, and
`invoice` in particular: a record that can be edited is not a record.

```
manual_payment (
  id, organization_id NOT NULL,
  amount_cents int NOT NULL, currency text NOT NULL,
  received_on date NOT NULL,
  method text NOT NULL,              -- cash | transferência | other
  covers_from date, covers_to date,
  note text,
  recorded_by_clerk_user_id text NOT NULL,
  created_at timestamptz
)
```

Portugal: cash still needs a receipt. This table is the record that one was owed and for what.

**The lifecycle is the same hourly job as POOLSE-61.** `billing_mode = 'manual'` and
`subscription_status = 'active'` and `paid_through < now()` → `past_due`, and read-only after a
configurable grace, default 15 days. A club that pays in cash gets the same courtesy as a card
that bounced, not a locked door.

### Dev — implementation notes

`billing_mode` and `paid_through` join the `poolse_platform` UPDATE grant and the `changeTenant`
write path, so every flip lands in `platform_audit_log`. Recording a payment is a second write
in the same transaction: the `manual_payment` row and the `paid_through` it implies commit
together or neither does.

`manual_payment` is platform-scoped, like `trial_claim` and `stripe_event`. It carries
`amount_cents` and a currency, which means **`docs/financials.md` applies to it**: this is
Poolse's own revenue, it is `actual` by definition, and it is the second table to carry a
provenance column if one is added. Say so in the migration rather than leaving it to be
noticed.

**A contradiction to settle before writing SQL.** `subscription_status` already has a `comped`
value and `billing_mode` will have one too. Two homes for one fact is how they drift. The
recommendation is that **`billing_mode` owns it** and `subscription_status.comped` stops being
written — a comped club becomes `billing_mode = 'comped'`, `subscription_status = 'active'`,
which is also more honest, since a free pilot *is* active. That is a reversal of a settled
decision and needs Rui's word; it is in `CONFLICTS.md`.

### QA — test scenarios

1. **Given** `billing_mode = 'manual'` and `subscription_status = 'active'`, **when**
   `paid_through` is null, **then** the database refuses the row.
2. **Given** the same tenant set to `past_due`, **then** a null `paid_through` is allowed —
   the CHECK binds only an active manual subscription.
3. **Given** a manual tenant, **when** a Stripe event arrives naming its customer, **then**
   nothing on the organization moves and `stripe_event` records the refusal with its outcome.
4. **Given** a recorded payment, **then** `paid_through` moves, a `manual_payment` row exists,
   and `platform_audit_log` has the change — all in one transaction.
5. **Given** a recorded payment, **when** somebody tries to edit or delete it, **then** the
   grant refuses: insert-only.
6. **Given** `paid_through` an hour in the past, **when** the hourly job runs, **then**
   `past_due`; **given** the grace has also passed, **then** read-only.
7. **Given** a manual tenant that pays again, **then** `paid_through` moves forward and access
   is restored in the same pass.
8. **Given** the `/admin` revenue figures, **then** Stripe, manual and comped are three numbers
   and are never summed blind.
9. **Given** a manual subscription expiring in 20 days, **then** it appears on the renewals-due
   list; **given** one expiring in 40, **then** it does not.
10. **Given** the tenant-isolation suite, **then** `manual_payment` is invisible from a tenant
    connection.

### Acceptance criteria

1. `billing_mode` and `paid_through` exist, are on the platform grant and go through
   `changeTenant`.
2. The CHECK makes an active manual subscription without an end date impossible.
3. `paid_through` is only ever moved by recording a payment.
4. The Stripe webhook refuses a non-Stripe tenant and records why.
5. `manual_payment` is insert-only, platform-scoped, and carries who recorded it.
6. The hourly job handles manual expiry with a configurable grace, defaulting to 15 days.
7. `/admin` shows the billing mode, the paid-through date and the payment history, and has a
   *record a payment* form.
8. `/admin` has a renewals-due list for the next 30 days.
9. Revenue is reported as three separate figures.
10. The `comped` contradiction is settled in `CONFLICTS.md` before any SQL is written.

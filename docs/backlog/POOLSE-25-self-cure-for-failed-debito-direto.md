# POOLSE-25 · Self-cure for failed débito direto

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Billing · **Priority:** High once collections go live
**Borrowed from:** Amilia's self-cure button — improving on their single retry, and on their failure to notify admins.

### PO — why this exists

SEPA débito direto fails routinely and slowly: the collection is presented, the family believes it is paid, and days later the bank returns it. Today that becomes a phone call to the office and an awkward conversation. A balance due the family can settle themselves with MB WAY or card closes the loop without staff. Guardians and adult students benefit first, the office second. High the moment collections go live — before that it has nothing to cure.

**Not in scope:** the mandate signature flow itself; dunning letters or debt collection; deciding a tenant's suspension policy beyond providing the setting (default flag only).

### BA — rules and data

- SEPA returns are **asynchronous and late**. A collection presented on day 0 can be returned by the bank on day 2 for insufficient funds, or up to 13 months later for an unauthorised transaction. The system must never treat "not yet returned" as "settled" — a charge moves to paid only on settlement confirmation, and a return can arrive after it was marked paid, which must be handled as a reversal rather than an error.
- Return reasons are stored **as received** — the ISO/SEPA reason code and the bank's text, unflattened. The distinctions that matter: `AC04`/`AC06` account closed or blocked, `AM04` insufficient funds, `MD01` no valid mandate, `MD06` disputed by the debtor, `MS03` unspecified. Insufficient funds is a retry case; no valid mandate is not.
- A return creates a **balance due** on the account with a plain-language explanation derived from the reason code, plus the original charge reference and date.
- The **retry ladder** is per-tenant configurable (default +3 days, +7 days, then stop). Each attempt is a new collection presentation, logged with its own presentation date, result and return reason.
- The ladder interacts with the mandate: a return whose reason indicates the mandate is invalid (`MD01`, `MD07` debtor deceased, `AC04` account closed) **terminates the ladder immediately** and marks the mandate as requiring re-signature. Retrying against a dead mandate produces further returns and, in some banks' handling, fees. Insufficient-funds returns are the only ones the ladder should retry by default.
- A `MD06` dispute is not a payment failure to retry — it is a chargeback-shaped event. It creates a balance due, notifies Owner/Admin, and does not enter the ladder.
- Because returns are late, a scheduled retry must be **cancelled** if the balance was cleared in the meantime by a self-cure payment. Presenting a collection for money already received is the worst failure mode in this ticket.
- Notifications to the family stop the moment the balance reaches zero, including cancelling an already-queued reminder. Admin notifications fire on the **first** failure and again when the ladder is **exhausted** — not on every rung.
- A self-cure payment settles the specific balance due, not an arbitrary amount. Partial payment is either disallowed or explicitly modelled; disallow it in v1 and say so.
- Tenant rule for a persistent failure's effect on enrolment: nothing / flag / suspend, defaulting to **flag only**.
- Currency and reason-code display: the raw code is retained for staff and the audit trail, but the family sees the plain-language explanation only.
- **Open:** the definition of "persistent" that triggers the enrolment rule — ladder exhausted once, or N exhausted ladders in an época? The source doc names the rule but not its trigger threshold.

### Dev — implementation notes

- Migration: `collection_attempt` (tenant, charge, presented_at, status, return_code, return_text, returned_at), `balance_due`, `mandate` status fields, tenant retry-ladder and enrolment-rule settings. Tenant key on all.
- The return webhook/ingestion from Stripe (and the Portuguese rails) must be **idempotent by provider event id** — banks and PSPs re-deliver, and applying the same return twice doubles a balance due.
- Return handling is a state machine on the charge, not a set of `if` branches at the webhook. Reversal of a settled charge is a legal transition and must be modelled, not an exception path.
- The ladder is a scheduled job per pending attempt. Before presenting, it re-reads the balance and the mandate status inside a transaction and aborts if either says stop. A scheduler that fires blind on a stored date is the bug this ticket most likely ships with.
- API: `GET /billing/balances` (family scope), `POST /balances/:id/pay` returning a payment intent for MB WAY or card; `GET /reports/open-failures` for admins. All server-side scoped: a guardian may only see and pay balances for their own linked students, an adult student their own; Instructor gets `403` outright.
- Payment amounts in cents as integers, shared with POOLSE-24's charge model — the balance due must reconcile exactly with the failed charge.
- i18n: every reason code maps to a pt-PT and en explanation string; unmapped codes fall back to a generic message plus the raw code for staff, never a blank. Notification templates in both languages. Failure and balance indicators need text labels and tokens checked in light and dark, distinct from attendance red.
- Most likely to be got wrong: retrying after `MD01` or `AC04`. The ladder must branch on the reason code, not simply count rungs.

### QA — test scenarios

25.1 Given a collection returned with `AM04` / When the return is ingested / Then a balance due appears on the account with a plain-language explanation, and the first retry is scheduled per the ladder.
25.2 Given a return with `MD01` / When it is ingested / Then the ladder terminates immediately, the mandate is marked as requiring re-signature, and no retry is presented.
25.3 Given a return with `MD06` / When it is ingested / Then Owner/Admin are notified, a balance due is created, and the charge does not enter the retry ladder.
25.4 Given a scheduled retry for tomorrow / When the family self-cures today with MB WAY / Then the retry is cancelled, no collection is presented, and family notifications stop.
25.5 Given the same PSP return event delivered twice / When both are ingested / Then exactly one balance due exists and no amount is doubled.
25.6 Given a charge marked paid on settlement / When a return arrives eleven days later / Then it is processed as a reversal, not rejected as invalid, and the account balance reflects it.
25.7 Given an Instructor token / When it calls the balances endpoint / Then `403`.
25.8 Given a guardian token / When it attempts to pay a balance belonging to another family / Then `403` and no payment intent is created.
25.9 Given a ladder of +3, +7, then stop / When all attempts fail with `AM04` / Then admins are notified on the first failure and once at exhaustion — twice in total, not four times.
25.10 Given the tenant rule set to flag only / When a ladder is exhausted / Then the enrolment is flagged and remains active; and with the rule set to suspend / Then it is suspended, and neither happens without the rule being set.
25.11 Given an unmapped bank return code / When the family views the balance / Then a generic explanation is shown, and staff can still see the raw code in the attempt log.
25.12 Given the pt-PT and en locales, in light and dark mode / When the balance-due screen and the "Pagar agora" action render / Then copy, currency and dates are localised and the failure state is readable without relying on colour.

### Acceptance criteria

1. A returned or failed collection creates a **balance due** on the account, visible to the guardian/adult student with a clear explanation of what happened.
2. A **"Pagar agora"** action lets them settle it themselves — MB WAY or card — without staff involvement.
3. A configurable **retry ladder** (e.g. +3 days, +7 days, then stop) replaces a single retry; each attempt is logged with its return reason.
4. Admins are notified on the first failure and again when the ladder is exhausted; a report lists all open failures.
5. Notifications to the family are polite and factual, and stop as soon as the balance is cleared.
6. Return reasons are stored as received from the bank, not flattened to "failed" — insufficient funds and a cancelled mandate need different follow-up.
7. Tenant rule for what a persistent failure does to enrolment (nothing / flag / suspend), defaulting to **flag only**.

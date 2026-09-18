# Subscrição

What the club pays Poolse. The one screen in the product whose subject is the bill *we*
send — everything else in phase 2 is money moving between a club and its families.

Schema in [../data-model.md](../data-model.md), "The operator's subscription". The arguments
are in [../decisions.md](../decisions.md), 13 September 2026.

## Off unless a key says otherwise

With no `STRIPE_SECRET_KEY` the page says *pagamentos ainda não configurados*, the plans come
back unpriced and unbuyable, and the webhook answers 503. Nothing else in the app changes
shape. That is the state of every development machine and of the free pilot, and it is
deliberate: a module that threw at boot because a key was absent would make those a broken
application rather than one that does not sell anything yet.

Everything needed is in `.env.example` under *Stripe*.

## Where it lives

**O meu perfil → Subscrição**, `/dashboard/profile/subscription`. Not in the main menu, and
**owner only** — narrowed on 13 September 2026, the day after it shipped.

Both halves of that are the same reasoning. What Poolse charges the club is the owner's own
business: their card, their renewal date, their decision to cancel. So it sits with the account
rather than in the menu of the club's work, and an admin is refused it outright — no more
entitled to it than to the owner's salary. There is exactly one owner per tenant precisely so
that "who pays" has an answer.

The link on *O meu perfil* is a courtesy. The endpoint refuses everybody but the owner however
they arrived.

## What the page says

It says where the club stands **before** it offers anything. A page that led with three price
cards would be selling to somebody who came to find out whether they were already paying.

| State | What it means |
|---|---|
| Em período experimental | The 14-day trial from signup. No card was ever asked for |
| Subscrição ativa | Paying |
| Pagamento em falta | The last charge was refused. **The club carries on working** |
| Subscrição terminada | Cancelled, and the period has run out |
| Acesso oferecido | `comped` — the free pilot. An operator's word, and it does not expire |
| Sem subscrição | Never subscribed, and the trial is not running |

**Billing state is not access state.** *Past due* says the card failed; it does not say the
club is shut, and nothing on this page or in the webhook shuts one. Only `suspended_at` does
that, it is an operator's decision in `/admin`, and a suspended club never reaches this page —
it sees the notice instead.

A subscription set to cancel says so and counts down to the period end. Until that date
nothing changes.

## One plan, two intervals

**There is one plan, `poolse_full`** — POOLSE-60, which reversed the three tiers that shipped a
day earlier. An organization either pays for Poolse and gets everything, or it does not pay and
is on a trial. **No feature is gated by plan, ever.** What is left to choose is how often they
pay: `billing_interval` is `monthly` or `yearly`, written only by the webhook from the price the
subscription carries, and null until they subscribe.

Both are descriptive. Neither decides anything — see *What a subscription does not change*.

**Switching interval goes through the customer portal.** Proration is a solved problem on
Stripe's own screen, and a second path to it here would be a worse copy of one that works.

## Prices

**They live in Stripe and nowhere else.** The public pricing page has said *valor por definir*
since it was written; hardcoding a figure would put a price in a deploy that belongs in a
dashboard. Each interval names an environment variable carrying a Stripe **price id**
(`STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`), and the amount is read back for display and
cached for five minutes.

An interval with no price still appears, unpriced and not buyable. Both are the product, and a
page showing one because somebody had not finished the dashboard would be a worse lie than
*valor por definir*. A Stripe outage answers the same way — this screen exists to tell a club
where it stands, and losing that over a figure they could read on the public site would be the
wrong trade.

**What yearly saves is computed on the API**, from the two prices, and appears only when both
are known and yearly is genuinely cheaper. *Poupa 17%* is a sentence the page renders rather
than a sum it does; *poupa 0%* is worse than silence.

**The public pricing page cannot read those prices**, and that is not an oversight: the figures
come from the API, which requires a session, and that page is open to the world. It shows one
card, a Mensal/Anual toggle defaulting to Anual, and the placeholder. A small public endpoint is
what closes that gap on the day the numbers are settled.

## Paying

**Poolse never holds a card.** Subscrever creates a Stripe Checkout session and sends the
owner to Stripe's own page; the button is the only thing on our side. A payment form here
would be a PCI question with no upside.

The customer is created once and remembered, so abandoning a checkout and coming back does not
accumulate customers, and a club that already pays is sent to the **customer portal** rather
than offered a second checkout — two subscriptions against one customer is two charges a
month.

The portal is where changing the card, switching plan, reading receipts and cancelling all
happen. That is most of the value of using Stripe: every one of those is a screen somebody
else maintains.

## What makes it true

**The webhook, and nothing else.** A checkout session finishing tells the browser something;
it does not tell Poolse anything a browser could not have made up. `POST /webhooks/stripe` is
excluded from both auth middlewares — Stripe carries no bearer token — so **the signature check
is the entire authentication for the route**, over the raw request bytes. An absent signing
secret is a 503 rather than a skipped check.

Four event types are handled:

| Event | What moves |
|---|---|
| `customer.subscription.created` / `.updated` | Plan, **interval**, status, period end, cancel-at-period-end |
| `customer.subscription.deleted` | Status `canceled`; the subscription, plan, interval and period cleared |
| `invoice.payment_failed` | Status `past_due`, and only that |

`checkout.session.completed` is deliberately not among them: the subscription events carry
everything it would and arrive for portal changes too, and handling both would be two code
paths writing the same columns from payloads shaped differently.

Anything else is ignored and **not** recorded — the trail is what Poolse did, not what Stripe
sent.

### It answers 200 to almost everything

An unhandled type, a customer Poolse does not know, a redelivery of an event already applied —
all 200. Stripe retries anything that is not a 2xx and disables an endpoint that keeps
failing, so a 500 over an event nobody cared about would eventually take the events we do care
about with it.

### Applied once, however many times it is delivered

`stripe_event` is the idempotency key **and** the trail, because they are the same fact
written down: this event arrived, this is what it did. Its primary key is Stripe's own event
id, and the insert happens in the same transaction as the change — so a retry either finds the
row and stops, or finds nothing because the first attempt rolled back. An out-of-order
redelivery cannot undo what came after it.

It records the columns that moved and never the Stripe payload: that carries the customer's
name and address, and a copy of those in a log is a second copy to protect.

## What a subscription does not change

**Nothing about what the club may do.** Paying does not raise `max_facilities`. The ceilings
stay a hand-set operator decision in `/admin`, so there is exactly one place a limit is decided
and no webhook can quietly widen a licence. `plan` and `billing_interval` are descriptive: they
name what the club bought and how often it pays, so the screen can say it and the operator can
see it beside the ceilings — a paying club whose site limit still says 1 is a real state, and an
operator seeing both figures is how that gets noticed.

This is also what made reversing three plans into one cheap: there was nothing hanging off the
tiers to unpick.

## Who may write what

The webhook runs on `poolse_platform`, the same narrow cross-tenant login the operator's area
uses: it holds `UPDATE` on seventeen **named** columns of `organization` and SELECT on eight
tables, and cannot rename a club or delete a tenant. It is cross-tenant by nature — an event
names a customer, not an organization — which the tenant role has no way to resolve.

There are now two write paths to a tenant's billing state, and **each records itself in its own
book**: an operator's through `changeTenant` into `platform_audit_log`, Stripe's through
`applyStripeEvent` into `stripe_event`. They are separate because their actors are — one is a
person, and `platform_audit_log.clerk_user_id` is `NOT NULL`.

## Paid outside Stripe — POOLSE-63

Some clubs pay in cash, by transfer, on a handshake. `/admin` turns a subscription on for them
with no Stripe customer existing at all.

**`billing_mode` says *how* a club pays** — `stripe | manual | comped`, `NOT NULL`, default
`stripe`. `subscription_status` goes on saying *whether* they are paying and `suspended_at`
goes on saying whether the door is open: three columns, three questions, none of them merged.

**`comped` lives there now.** It was a `subscription_status` from the platform slice until
18 September 2026; once the mode existed that was one fact with two homes, and a club could be
`manual` and `comped` at once — "pays in cash" and "is not billed" in the same breath. A free
pilot is `billing_mode = 'comped'` with an ordinary `active` status, which is also the more
honest pair: a pilot *is* active, and what is unusual is how it pays. The value stays in the
status enum because removing one is a rebuild, and nothing writes it again.

**A manual subscription cannot be forgotten.** A CHECK refuses an *active manual* club with no
`paid_through`:

```sql
CHECK (billing_mode <> 'manual'
       OR subscription_status <> 'active'
       OR paid_through IS NOT NULL)
```

Without it an operator flips a club to active, forgets, and they run free for two years. It
binds only an active one: a club marked manual before the first money arrives, or one that has
lapsed to `past_due`, is a real state.

**`paid_through` is a date, and only a payment moves it.** The last day covered, inclusive, in
`dd-MM-yyyy` on every screen. There is no control that types it — the payment is the fact and
the date is derived from it, because a field somebody fills in by hand is a field that
disagrees with the money.

**`manual_payment` is insert-only and platform-scoped**, like `stripe_event` and
`platform_audit_log`: amount in integer cents with its currency and a `money_provenance` of
`actual`, the day it arrived, how (`cash | bank_transfer | other`), what period it covers, an
optional note, and who recorded it. No UPDATE and no DELETE on the grant — a record that can be
edited is not a record, so a correction is another row. `docs/financials.md` applies, with one
stated exception: this is Poolse's own revenue rather than a club's money, so it carries no RLS
policy for `poolse_app`, no composite key and no `archived_at`.

Recording one does everything the money means, in a single transaction: the payment row, the
mode to `manual`, the status to `active`, `paid_through` to the **greater** of what is there and
what this buys — so a payment recorded out of order extends cover and never shortens it — and
read-only lifted. It does not clear `suspended_at`: a suspension is an operator's own decision
with a reason attached, and a payment is not an argument against it.

**A stray Stripe event never takes over a hand-managed club.** A customer id outlives the
arrangement it was made for, and a subscription object can keep drifting towards `past_due` in
Stripe's own records. The webhook refuses any tenant whose mode is not `stripe`, records the
refusal in `stripe_event` with outcome `not_stripe_billed`, and still answers 200.

### What the clock does to a late club

The hourly job from POOLSE-61 gained two steps, and **where they stop is the point**:

| | |
|---|---|
| `paid_through` passes | `past_due`. The door stays open — a club mid-lesson does not lose its register because a transfer is late |
| plus `manual_grace_period()`, 15 days | `read_only_at`. Reads and exports still work, and so does paying |
| after that | **nothing**. No deletion date, no closed door, no archive |

A trial walks all the way down to an archive because nobody ever paid for it. A customer who is
late is a customer, and the machine never files one away. Both transitions go to `trial_event`
(`payment_lapsed`, `payment_read_only`) rather than `platform_audit_log`, because a cron is not
a person — and both are owed a `trial_notice`, recorded and undelivered until an email provider
exists.

### What `/admin` shows

- **On the index**: counts per mode, the manual money actually received over twelve months and
  all time, and a **renewals-due** list for the next 30 days. A club whose cover has already
  lapsed sorts first and is marked — a renewals list that hides the overdue one fails at the one
  job it has.
- **On the tenant page**: the mode, the paid-through date, a *record a payment* form, and the
  payment history.

**There is no Stripe revenue figure, and the panel says why.** Nothing in this database stores
what a Stripe subscription is worth — the prices live in Stripe and are read back for display —
so the counts are honest and the euros are only what Poolse actually holds a record of. The
screen points at the Stripe dashboard rather than showing a number this product guessed.

## Not built

- **No banner elsewhere in the app** counting the trial down. Worth adding when a real club is
  on a real trial.
- **The `/admin` tenant page does not show the Stripe trail yet.** It shows the plan; the
  events are in `stripe_event` for an operator with a database client.
- **Nothing is ever sent.** A `trial_notice` records what a club was owed and stays
  `delivered_at` null; choosing an email provider is its own slice, and it writes into the same
  history.
- **Poolse does not invoice its own revenue.** `manual_payment` is the record that a receipt was
  owed and for what — Portugal requires one for cash — and issuing it is a later ticket.

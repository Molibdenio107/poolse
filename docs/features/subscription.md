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

**Subscrição**, `/dashboard/subscription`, last in the menu. Owner and admin see it — an
admin needs to know the trial ends on Friday — and **only the owner can act on it**. An admin
committing the owner's card to a monthly charge is a different thing from reading a date, and
there is exactly one owner per tenant precisely so "who pays" has an answer.

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

## Prices

**They live in Stripe and nowhere else.** The public pricing page has said *valor por definir*
since it was written; hardcoding a figure would put a price in a deploy that belongs in a
dashboard. Each plan names an environment variable carrying a Stripe **price id**, and the
amount is read back for display and cached for five minutes.

A plan with no price still appears, unpriced and not buyable. The three plans are the product,
and a page showing two of them because somebody had not finished the dashboard would be a
worse lie than *valor por definir*. A Stripe outage answers the same way — this screen exists
to tell a club where it stands, and losing that over a figure they could read on the public
site would be the wrong trade.

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
| `customer.subscription.created` / `.updated` | Plan, status, period end, cancel-at-period-end |
| `customer.subscription.deleted` | Status `canceled`; the subscription, plan and period cleared |
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

**Nothing about what the club may do.** Paying for Clube does not raise `max_facilities`. The
ceilings stay a hand-set operator decision in `/admin`, so there is exactly one place a limit
is decided and no webhook can quietly widen a licence. `plan` is descriptive: it names what
they bought so the screen can say it and the operator can see it beside the ceilings — a club
on Clube whose site limit still says 1 is a real state, and an operator seeing both figures is
how that gets noticed.

## Who may write what

The webhook runs on `poolse_platform`, the same narrow cross-tenant login the operator's area
uses: it holds `UPDATE` on eleven **named** columns of `organization` and SELECT on seven
tables, and cannot rename a club or delete a tenant. It is cross-tenant by nature — an event
names a customer, not an organization — which the tenant role has no way to resolve.

There are now two write paths to a tenant's billing state, and **each records itself in its own
book**: an operator's through `changeTenant` into `platform_audit_log`, Stripe's through
`applyStripeEvent` into `stripe_event`. They are separate because their actors are — one is a
person, and `platform_audit_log.clerk_user_id` is `NOT NULL`.

## Not built

- **Nothing happens automatically when a trial ends.** No worker, no auto-suspension. The page
  says when it ends; closing a club is still an operator pressing a button, which is the only
  place that decision has ever lived.
- **No banner elsewhere in the app** counting the trial down. Worth adding when a real club is
  on a real trial.
- **The `/admin` tenant page does not show the Stripe trail yet.** It shows the plan; the
  events are in `stripe_event` for an operator with a database client.

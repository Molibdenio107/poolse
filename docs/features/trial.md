# The trial, and what happens when it ends

What a club gets before it pays, what changes on the day the trial runs out, and how long
its data is kept. Schema in `docs/data-model.md`; the argument in `docs/decisions.md`.

**B1 and B2 are built: the states, the door, and the clock.** An hourly job moves a tenant all
the way down the ladder, and an operator can do it by hand from `/admin`. **Nothing in the
product destroys anything** — the last rung files a club away, reversibly; the purge is its own
ticket.

## What the trial is

**15 days from signup**, set by `trial_period()` and read by `provision_organization`.
Not from the first facility — from the moment the organization exists.

**The full product, uncapped.** No volume limits, no feature gates, nothing switched off.
A club on day 3 and a club that has paid for a year see the same software.

**No card at signup.** Payment is collected at conversion, through the checkout that
already exists.

## The ladder

| Day | `subscription_status` | Access | What the club sees |
|---|---|---|---|
| 0–15 | `trialing` | Full | The app, and a countdown from day 10 |
| 15 | `expired` | **Read-only** | A banner: what ended, until when data is kept, and a way to pay |
| 15–45 | `expired` | Read-only | The same, counting down |
| 45 | `expired` | Login refused | Email only |
| 75 | `expired`, archived | — | Gone from every list, and restorable |

**Paying at any point before day 75 restores everything.** That is one status change,
because nothing was ever moved: a trial tenant is an ordinary organization row with a
different status. There is no trial database, no copy step and no import.

## Where the ladder stops

The clock expires a trial into read-only, closes sign-in thirty days later, and thirty days
after that files the club away. Then it stops.

**Archiving is not deleting.** Every row the club owns survives; the organization simply
leaves every list, and the same login can put it back. What actually destroys data is the
purge, which is its own ticket and is not built.

**It archives only a club it closed itself.** `trial_event` is the proof it requires, so a club
an operator suspended for a reason of their own is never filed away by the machine — that
closure is about something the ladder knows nothing about.

Letting the clock archive at all meant granting `poolse_platform` an `UPDATE` on
`archived_at`, which reversed a settled rule that *removing a tenant is not an operator
action*. It was taken knowingly on 14 September 2026, and what survives is the half that
matters most: `DELETE` on an organization is refused for every login but the owner's.

## Two books, and why they are not the audit log

Every transition the clock makes is written to **`trial_event`**, in the same transaction as
the change. Not to `platform_audit_log`: that table's actor is `clerk_user_id NOT NULL` and
a cron has nobody behind it, so writing `'system'` there would be a lie in the one place
that exists to be believed. It is also what makes a machine-set suspension distinguishable,
six weeks later, from a sentence an operator typed — on the `organization` row the two are
identical.

**`trial_notice`** records what a club was owed and when: a warning before the trial ends,
the last day, the day it ended, a week before sign-in closes, the day it closes, and a week
before the data is due to go.

**Nothing is sent.** There is no email provider wired, so `delivered_at` is null on every row
and the screens say so plainly. The **recipients are recorded** — the club's owners, resolved
by role when the notice falls due, because only an owner can pay and because turnover must not
orphan a notice. Reading an address meant putting `app_user` on the platform login's grant: the
eighth table, two columns of it, decided on 14 September 2026. Empty stays legitimate and means
nobody in the club has an address on file. The slice that chooses a provider stamps
`delivered_at` into this same history.

Both books are the platform's alone: invisible and unwritable from a tenant connection, for
two independent reasons — no grant, and no policy naming the tenant login — and asserted in
`tenant-isolation.sql`.

## Read-only is not suspension

Three access states, and the order matters: **suspended beats read-only beats open.**

- **Suspended** is a door we closed, always with a reason, and the club gets a page instead
  of the app because every call behind it refuses.
- **Read-only** is a trial that ran out. The club signs in, reads everything it built,
  **exports all of it**, and pays. A banner sits above the app rather than in front of it.

A club that is both is a club we have closed: the refusal says `tenant_suspended`, because
"your trial ran out, pay here" would be the wrong sentence and the wrong thing to do next.

### What read-only actually allows

**Every safe method**: `GET`, `HEAD`, `OPTIONS`. By method rather than by route, because
an allowlist of safe endpoints is a list somebody forgets to add to — and the first
omission is a club that cannot read its own register. **Every export in Poolse is a GET**,
which is what makes "you can still get your data out" true without naming a single route.

**Two writes**: the billing checkout and the customer portal. That is the conversion path,
and the reason it is open is the whole design — *a read-only tenant that cannot pay is a
read-only tenant for ever*. The Stripe webhook is not on the list and must not be added: it
is a public route that authenticates by signature, so the tenant middleware never runs for
it at all.

Everything else is refused with `403 tenant_read_only`, carrying `trialEndedAt` and
`dataKeptUntil` so a screen can explain itself where the write failed rather than making a
second request to find out why.

## Data retention — the words for the privacy policy

This is the stated retention policy for a club that stops paying. It covers everything the
club entered, which includes **minors, guardians, health and mobility notes, and payment
records**.

- **While a subscription is live**, data is kept for as long as the club keeps its account.
- **When a trial ends without payment**, the account becomes read-only immediately. Nothing
  is deleted. The club may sign in, read everything, and export all of it.
- **Data is kept for 30 days** after that, during which paying restores full access
  immediately and nothing has been lost.
- **After 30 days**, sign-in is closed. The data still exists and can still be restored by
  contacting us.
- **After a further 30 days** — 60 days after the trial ended — the account and everything
  in it is permanently deleted. This cannot be undone.
- **Exporting is available at every stage before deletion**, in the formats the product
  already offers.
- A club may ask for its data to be deleted sooner, and may ask for a copy at any time.

**The last step is still a person's.** The product closes sign-in and files the account away on
its own; *permanently deleting* it is done by hand, because nothing in Poolse destroys a tenant
automatically — see *Where the ladder stops*. Nothing written above is untrue for a club, but a
privacy policy quoting it should not imply the deletion is a machine's.

**Locking an account does not touch the person's login.** One person may belong to several
clubs; closing one must never lock them out of another they still pay for.

## What an operator can do

From `/admin`, on a tenant's page:

- **Make read-only**, optionally naming the day the data is kept until. Blank means no
  deletion is scheduled — an operator doing this by hand may have a reason with no deletion
  attached.
- **Restore writing**, which also cancels the deletion date. The two are set together and
  mean one thing between them; a club writing normally with a deletion still scheduled is
  the worst of the two states and the one nobody would think to check for.

Neither touches `subscription_status`: billing state and access state are separate, and an
operator lifting read-only because a bank transfer arrived is making an access decision.

Both go through the audited platform write path, so every change lands in
`platform_audit_log` with the operator's name against it.

## Not built yet

- **Delivery.** Notices are recorded, with their recipients, and nothing leaves the building.
  Choosing a provider is a small slice that stamps `delivered_at` into the same table.
- **The purge.** Permanently destroying an archived tenant — its own ticket, and deliberately
  not a cron's.
- **The countdown in the app** from day 10, and a screen showing a club's own notices.

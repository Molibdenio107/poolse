# The trial, and what happens when it ends

What a club gets before it pays, what changes on the day the trial runs out, and how long
its data is kept. Schema in `docs/data-model.md`; the argument in `docs/decisions.md`.

**Slice B1 is built: the states and the door.** The clock that moves a tenant through them
is B2 and is not built — today an operator sets read-only from `/admin`. Where this page
says "after 30 days", that is the policy the job will apply, not something that happens on
its own yet. The purge is a separate ticket and nothing in the product deletes anything.

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
| 75 | Archived, then purged | — | A confirmation that it is gone |

**Paying at any point before day 75 restores everything.** That is one status change,
because nothing was ever moved: a trial tenant is an ordinary organization row with a
different status. There is no trial database, no copy step and no import.

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

- **The clock** — nothing moves a tenant onto the ladder automatically (B2).
- **Notices** — days 10, 14, 15, 38, 45 and 68. When built they are *recorded*, not sent:
  there is no email provider wired, and the screens will say so plainly.
- **The purge.** Its own ticket, with its own argument.
- **The countdown from day 10**, which needs the clock to be meaningful.

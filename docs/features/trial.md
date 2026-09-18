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

## One person, one trial — POOLSE-62

The trial is uncapped and takes no card, which is the right product decision and also means
nothing stops one person running a club on a fresh organization every fifteen days. **The fix
is at the door, not inside the trial**: every limit added to the trial would be paid for by
every honest club evaluating the product, and a ledger at the door is paid for by nobody.

### What is blocked, and what is only noticed

| Signal | Response |
|---|---|
| The same normalised address | **Refused at signup** |
| A known disposable domain | **Refused at signup** |
| Another club on the same e-mail domain | A count on `/admin`. Blocks nothing |
| Another signup from the same origin | A count on `/admin`. Blocks nothing |

A municipality has several pools and a swimming club shares an office with three other clubs,
so a hard block on a domain or an address would refuse real customers. Those two are numbers on
a screen for a person to weigh, and the screen says so in words.

### The same address, spelled differently

`normalize_signup_email()` is the one definition, in SQL, because the ledger is written in SQL
and a second implementation in TypeScript would agree until the day it did not. Lowercased;
`+tags` stripped for every domain; dots stripped **for gmail only**, where they are genuinely
ignored — everywhere else `j.silva@` and `jsilva@` are two people. Googlemail folds into gmail:
the same mailbox spelled two ways.

### How the block is made

**The unique index is the enforcement and nothing asks first.** The claim is written by
`provision_organization` itself, inside the one transaction that makes a tenant, so:

- a refused signup leaves **no organization, no membership and no claim** — it is one
  transaction and it rolls back whole;
- two signups racing on one address end with **exactly one club**, because they both reach the
  index;
- there is no window between a check and a write for a second request to slip through.

The API turns the `23505` into a 403 with the code `trial_not_available`.

**The refusal never says which lever it was.** "Já usou o seu período experimental" tells an
abuser exactly what to change. The message points at signing in and at writing to us, and the
disposable-domain refusal is word-for-word the same one — because the person reading it may be
a real customer whose club is coming back.

### A claim outlives its club

Including the archiving the trial clock does on day 75. Releasing it then would be the abuse
path with extra steps — let the trial lapse, wait for the sweep, start again — so a club that
genuinely leaves and returns writes in, and an operator frees the address in one click.

That makes the override **load-bearing rather than a convenience**, which is why it shipped in
the same slice as the block: a hard rule with no appeal inside the product needs a person who
can say yes.

### Conceder novo período

On the trial card in `/admin`, as a checkbox on the date that is already there. One control,
because granting a fresh trial *is* a new end date **and** a freed address: two would let an
operator free the address and leave the club on a trial that ran out in March.

A release is a row, never a deletion — `released_at` and who did it — and both unique indexes
are partial on it, which is what actually frees the address. The count of claims freed goes onto
the same `platform_audit_log` entry as the date.

### The origin is a flag, never a record

Hashed with `SIGNUP_IP_SALT` and stored as a digest; the address itself never reaches the
database, a log line or an error. **No salt, no hash, no flag** — an unsalted digest of an IPv4
address is the address with extra steps, so a deployment that has not configured one records
nothing rather than pretending.

The web app forwards the visitor's address on the signup call, because by the time the request
reaches the API the only address it can see is the web server's, which every signup shares. It
is forgeable by anybody holding a session token, and that is acceptable for a flag that blocks
nothing: defeating it costs an abuser a proxy and gains them nothing the ledger was not already
refusing.

### The same club under a different address

A second e-mail costs nothing. The thing that does not change is the legal entity, so the
second block is on the club's NIPC.

**It is asked for under Faturação, not at signup.** Signup stays three fields and thirty
seconds, and a tax number is the most intrusive question you can put to somebody who has not
decided yet — and the one they cannot answer from memory. Under Faturação it is where it is
already true: a fatura's issuer is the club, and its number is what the document carries. The
panel says out loud that the number is also checked against other clubs, because a field that
quietly does two things is a field somebody fills in wrongly.

**Saving it claims it, through a trigger.** `claim_tax_number()` keeps `trial_claim.tax_number`
in step with `organization.vat_number`, so the cross-tenant check happens inside the club's own
transaction — one write path, and the partial unique index is the enforcement exactly as it is
for the address. The alternatives were a unique index on `organization` itself, which would have
broken the operator's override (freeing a false positive would mean asking the *other* club to
clear their number), and the API writing both sides on two connections, which is not atomic. The
argument is in the migration header.

**`isValidNif` in `@poolse/rules` is the checksum**, shared by the form and the API so a screen
cannot accept what the server refuses; the schema enforces the shape — nine digits, normalised,
so `500 123 456` and `500123456` are one club.

**An empty box clears it; a box full of nonsense does not.** Emptying the field is a club saying
"we would rather not say yet" and releases the hold on the number — the address stays claimed,
and only an operator frees that. Typing something unparseable is a mistake, and reading it as
"clear it" would silently throw away the number that was there and report a save.

**A tenant with no live claim gets no NIPC protection**, and that is stated rather than hidden:
a claim needs a normalised address, and an organization created before the ledger has none.
Every organization created since POOLSE-62 has one, so it is a closed set that only shrinks. The
SQL suite asserts the gap so a future reader finds a test rather than a surprise.

### What `/admin` shows

- **Filters** — todas, em avaliação, terminadas, a caminho de eliminação. Links rather than
  buttons, like the sort control beside them: a GET that survives a refresh and works before any
  JavaScript. An unknown filter shows everything rather than an error page.
- **Trials started against converted**, on the billing panel. **Started counts the ledger, not
  the survivors** — a trial that lapsed and was archived still happened, and a rate computed
  over the clubs still here would flatter itself. It is what makes "is fifteen days the right
  number" an argument with evidence.
- **The claim itself** on the tenant page: the normalised address, when it was claimed, whether
  it has been released and by whom, and the two soft flags as counts.

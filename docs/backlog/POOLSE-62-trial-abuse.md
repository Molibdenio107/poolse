# POOLSE-62 · Trial abuse

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Signup / Platform · **Priority:** Medium — it only bites once somebody wants to abuse it, and the fix must not arrive by crippling the trial · **Depends on** POOLSE-61 · **Slice C**

### PO — why this exists

The trial is uncapped and takes no card, which is the right product decision and also means
nothing stops one person running a club on a fresh organization every fifteen days.

**Fix it at signup, not by crippling the trial.** Every limit added to the trial is paid for by
every honest club evaluating the product; a ledger at the door is paid for by nobody.

**Not in scope:** anything that makes the trial smaller, shorter or capped.

### BA — rules and data

**`trial_claim` is platform-scoped**, for the reason `platform_audit_log` and `stripe_event`
are: a row is *about* a tenant rather than belonging to one, and the entire point is the
cross-tenant lookup a tenant connection cannot do.

```
trial_claim (
  id, organization_id,
  normalized_email  text NOT NULL,   -- lowercased; gmail dots and +tags stripped
  email_domain      text NOT NULL,
  tax_number        text,            -- NIPC, normalized, null until known
  signup_ip_hash    text,            -- hashed, never the raw address
  created_at        timestamptz
)
```

Unique index on `normalized_email`. Partial unique index on `tax_number` where not null.

| Signal | Response | Why |
|---|---|---|
| Repeated `normalized_email` | **Hard block at signup** | One person, one trial |
| Repeated NIPC | **Hard block when it is saved** in the club's settings | The club is the same club |
| Repeated IP hash | **Soft flag** on `/admin` | Clubs share offices; NAT is real |
| Repeated email domain | **Soft flag** | A municipality has many pools |
| Known disposable domain | **Reject at signup** | The list lives in a data file, not in code |

**A block never says which lever was pulled.** The message points at signing in and at
contacting us — *"já usou o seu período experimental"* tells an abuser exactly what to change.

**The NIPC is not on the signup form and should not be** — and, as of 13 September 2026, it is
not anywhere else either. `organization.vat_number` has existed since the first migration and
**nothing reads or writes it**: no form, no endpoint. So this ticket has to ask for it before it
can block on it.

**It is asked for in the club's own settings, not at signup and not at facility creation**
(settled 13 September 2026). Signup stays three fields and thirty seconds — a tax number is the
most intrusive question you can put to somebody who has not decided yet, and the one they cannot
answer from memory. A facility is a building; a NIPC belongs to the legal entity, which is also
where invoicing will need it, since a fatura's issuer is the club. The check runs the moment the
field is saved.

**Every block is reversible by Rui in one click.** `/admin` gains *grant a fresh trial*, which
clears the claim and sets `trial_ends_at` — built by **extending the trial action that already
exists** rather than adding a second one. A false positive must cost one click, not a support
thread.

**The IP is hashed and never stored raw.** It is a signal, not a record, and an IP address is
personal data under RGPD.

### Dev — implementation notes

The claim is written **inside the provisioning transaction**, so a signup that fails leaves no
claim and a claim that fails leaves no tenant. `provision_organization` is already the one
`SECURITY DEFINER` write path for a brand-new organization; this joins it rather than becoming
a second one.

The unique index is the enforcement, not the application check — the same reasoning as every
other constraint in this schema. The application asks first so the message is a sentence rather
than a constraint name, and the index is what holds when two signups race.

**An archived organization keeps its claim, for ever** (settled 13 September 2026). Releasing it
would be the abuse path with extra steps — let the trial lapse, wait for the sweep, start again.
A club that genuinely leaves and returns writes in, and *grant a fresh trial* is one click. The
cost is a support message from an honest person; the alternative is no protection at all.

That makes the one-click override load-bearing rather than a convenience, and it is why the
refusal message points at contacting us: the person reading it may be a real customer.

### Built — 18 September 2026, in two slices

Two evenings, as the estimate said, and both are done.

**The first**: `trial_claim`, the unique index that refuses a repeated normalised address, the
claim written inside `provision_organization`, the disposable-domain data file, the hashed
origin, the soft flags, *conceder novo período* on the trial-date action, and the claim panel.

**The second**: the NIPC. `organization.vat_number` gains a shape, a form under Faturação and a
`SECURITY DEFINER` trigger that keeps `trial_claim.tax_number` in step — so the cross-tenant
check happens inside the club's own transaction rather than across two connections, which was
the open question this half had to settle. The recommendation in the split note was a unique
index on `organization` itself; it was **rejected on writing it**, because `poolse_platform`
cannot clear another club's `vat_number`, so freeing a false positive would have meant asking
the *other* club to edit theirs — exactly the support thread the PO section forbids. Plus the
`/admin` filters and the started-against-converted count.

**Every QA scenario is covered by a test** except the parts that were deliberately reshaped:

- **QA 4** is covered, and the check runs when the club saves its NIPC under Faturação rather
  than at facility creation — settled 13 September 2026 and unchanged.
- **One gap is asserted rather than closed**: an organization created *before* the ledger has no
  claim to attach a number to, so it gets no NIPC protection. A claim needs a normalised address
  and a pre-ledger tenant has none; inventing one would put a row in the book that no signup
  ever wrote. `trial-claim.sql` test 7d pins the behaviour, and the set only shrinks.

### QA — test scenarios

1. **Given** an email that has claimed a trial, **when** somebody signs up with the same
   address in different case with dots and a `+tag`, **then** it is refused and the message
   names neither the reason nor the first tenant.
2. **Given** two signups racing on one address, **then** exactly one succeeds — the index.
3. **Given** a refused signup, **then** no organization, no membership and no claim exist.
4. **Given** a NIPC already claimed, **when** a club saves it in its settings, **then** refused
   there, and the organization that already claimed it is untouched.
5. **Given** a repeated IP hash, **then** the signup succeeds and `/admin` shows a flag.
6. **Given** a disposable domain in the data file, **then** signup is refused; **given** one
   removed from the file, **then** it is allowed without a deploy of code.
7. **Given** an operator pressing *grant a fresh trial*, **then** the claim is cleared, the
   trial date moves, and both land in `platform_audit_log`.
8. **Given** the tenant-isolation suite, **then** `trial_claim` is invisible and unwritable
   from a tenant connection.
9. **Given** a raw IP, **then** it appears nowhere in the database or in any log line.

### Acceptance criteria

1. `trial_claim` exists, platform-scoped, with the two unique indexes, and is written inside
   the provisioning transaction.
2. A repeated normalized email is refused at signup; a repeated NIPC is refused when the club
   saves it in its own settings.
3. Neither refusal reveals which signal fired or that a previous trial exists.
4. IP and domain are soft flags shown in `/admin` and block nothing.
5. Disposable domains come from a data file.
6. The existing extend-trial action gains *grant a fresh trial*; it clears the claim and is
   audited.
7. No raw IP address is stored anywhere.
8. `/admin` filters by `trialing`, `expired` and pending-delete, shows the claim and the flags
   on the tenant detail, and counts trials started against trials converted.
9. Tenant isolation still passes, with a new block for the table.
10. `organization.vat_number` gains a form field in the club's settings, validated as a NIPC,
    and the duplicate check runs when it is saved rather than at signup.
11. A claim survives the archiving of the organization that made it, proven by test.

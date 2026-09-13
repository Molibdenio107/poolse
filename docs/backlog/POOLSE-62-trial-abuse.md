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
| Repeated NIPC | **Hard block at facility creation** | The club is the same club |
| Repeated IP hash | **Soft flag** on `/admin` | Clubs share offices; NAT is real |
| Repeated email domain | **Soft flag** | A municipality has many pools |
| Known disposable domain | **Reject at signup** | The list lives in a data file, not in code |

**A block never says which lever was pulled.** The message points at signing in and at
contacting us — *"já usou o seu período experimental"* tells an abuser exactly what to change.

**The NIPC is not on the signup form and should not be.** It is captured at facility creation,
where invoicing already needs it, and refused there.

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

**Open:** where the NIPC lives today. `organization.vat_number` exists and `facility` may not
carry one; the check belongs wherever the form actually writes it, and that needs reading
before the ticket is estimated.

**Open:** whether an organization archived by the lifecycle releases its claim. It probably
should not — that would be the abuse path with extra steps — but it means a club that genuinely
leaves and returns two years later needs the one-click reset. Ask.

### QA — test scenarios

1. **Given** an email that has claimed a trial, **when** somebody signs up with the same
   address in different case with dots and a `+tag`, **then** it is refused and the message
   names neither the reason nor the first tenant.
2. **Given** two signups racing on one address, **then** exactly one succeeds — the index.
3. **Given** a refused signup, **then** no organization, no membership and no claim exist.
4. **Given** a NIPC already claimed, **when** a facility is created with it, **then** refused
   there, and the organization that already existed is untouched.
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
2. A repeated normalized email is refused at signup; a repeated NIPC is refused at facility
   creation.
3. Neither refusal reveals which signal fired or that a previous trial exists.
4. IP and domain are soft flags shown in `/admin` and block nothing.
5. Disposable domains come from a data file.
6. The existing extend-trial action gains *grant a fresh trial*; it clears the claim and is
   audited.
7. No raw IP address is stored anywhere.
8. `/admin` filters by `trialing`, `expired` and pending-delete, shows the claim and the flags
   on the tenant detail, and counts trials started against trials converted.
9. Tenant isolation still passes, with a new block for the table.

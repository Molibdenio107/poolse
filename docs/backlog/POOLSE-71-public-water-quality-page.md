# POOLSE-71 · A public water-quality page per tank

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Maintenance / Public · **Priority:** High — ungated, and a legal duty the club already has · **Depends on** slice 4.2 (bands and excursions, built) · **Roadmap** 7b.1

### PO — why this exists

A Portuguese pool has to show its users the water's current readings. Today that is a
whiteboard by the door, rewritten by hand when somebody remembers. Poolse already holds every
reading and already knows whether each one is inside its band. This ticket puts that on a page a
bather opens by scanning a QR code at the entrance, or that a lobby screen shows all day.

It is also the first page of Poolse that anybody can open without signing in, so how it reads
across the tenant boundary matters more than what it shows.

**Not in scope:** lab PDFs on the page, history charts, the complaints-book link and the
operating regulation (POOLSE-73), and **a lab result's classification** — Poolse does not yet
tell a lab analysis from a poolside one, and *conforme / não conforme* is POOLSE-72's
(7b.3, gated on checking the values against a primary source). Until then the page shows the
latest reading of each metric, whichever way it was recorded.

### BA — rules and data

**One public link per tank, off until somebody turns it on.** Owner, Admin and Maintenance may
turn it on, turn it off and regenerate it. Regenerating kills the old link — and so the printed
QR — at once; turning it off does the same. Turning it on again issues a new link, never the old
one back.

**The token is unguessable**: at least 128 bits from a CSPRNG, URL-safe. **Open:** stored hashed
(as the brief asked) or retrievable — see below.

**The page** at `/[locale]/agua/[token]`, no login, both locales:

- the site's name and the tank's name;
- for each metric the pool is judged on, its **latest reading** with the date and time it was
  taken (`formatDate` / `formatTime`, in the site's timezone) and whether it is **inside or
  outside its band** — in words and with an icon, never colour alone;
- a reading older than 24 hours says so in words ("medido há 2 dias"), because a stale good
  reading is not a good reading;
- a tank with no reading at all says so, rather than showing an empty table.

**Nothing else about the tenant**: no staff names, no notes, no students, no other tanks, no ids
beyond the token itself. A token that is unknown, revoked or switched off answers exactly like a
token that never existed.

**The band** is the one `resolveBands` gives this pool — **Open**, see below.

**A lobby-screen variant**, `?screen=1`: large type, no navigation, refreshes itself every five
minutes, light and dark by the screen's own preference.

**On the pool's page, a *Página pública* tab** (Owner, Admin, Maintenance): the on/off switch, the
QR as PNG and SVG to download for printing, the link with a copy button, and *Gerar novo link*
behind a `Dialog` that says the printed QR will stop working.

**Open — 1:** does the page judge a reading against the club's own overridden band, or always
the published reference? *Recommend:* the **resolved** band — the answer the pool's own page and
the alert email already give. A hotel tank kept at 30 °C would otherwise read "fora dos valores"
every day of its life on the wall of its own lobby.

**Open — 2:** the brief asks for the token to be **stored hashed**. A hash means the link can be
shown once, at the moment it is made, and never again: lose the printout and the only way to a
new QR is to regenerate, which kills every copy already on a wall. *Recommend:* **store it
retrievable** — it is printed at the entrance by design, it grants read access to public
readings and nothing else, and the protection that matters is revocation, which either way has.

### Dev — schema, API, where it goes

```
pool_public_link (
  id, organization_id, pool_id        -- composite fk to pool
  token text NOT NULL                 -- or token_hash bytea, per Open 2
  created_by_membership_id, created_at
  revoked_at timestamptz              -- null = live
)
unique (organization_id, pool_id) where revoked_at is null   -- one live link per tank
unique (token)                                                 -- across every tenant
```

A row per link ever issued, so "who turned the public page on, and when was the old QR killed"
has an answer; regenerating is a revoke and an insert in one transaction. In `TENANT_TABLES`.

**The public read is one `SECURITY DEFINER` function** with a fixed body —
`public_water_page(p_token text) RETURNS jsonb` — that resolves a live link to its pool and
returns that pool's public fields and nothing else: site name, tank name, site timezone, the
latest live reading per metric with its `taken_at`, and the pool's band overrides. `SET
search_path`, `REVOKE ALL FROM public`, `GRANT EXECUTE` to `poolse_app`. The pattern is
`provision_organization`; a looser RLS policy is never the answer. The function is the whole
boundary, so its result has a fixed key list and a test asserts it.

**API:** `GET /public/water/:token` — in `PUBLIC_ROUTES`, outside Clerk and the tenant
middleware, with its own throttle; judging happens in TypeScript with `resolveBands` and
`excursions()` from `@poolse/rules`, as everywhere else. 404 for every kind of miss. The tenant
side: `GET/POST/DELETE /pools/:id/public-link` (on, regenerate, off), roles owner, admin,
maintenance.

**Web:** the public route is added to the Clerk public matcher, renders without the app shell,
and sets `robots: noindex`. The QR is generated in the browser from the link (no service call).

**What will be got wrong:** a public endpoint that reads through the ordinary `withOrg` path by
first looking the tenant up — that is a second, unreviewed cross-tenant read; a payload built by
spreading a row, which leaks the next column somebody adds; and a 410 or a "this link was
revoked" page, which tells a stranger the token once existed.

### QA — test scenarios

1. **Given** a tank with readings, **when** its link is turned on and the token is fetched, **then**
   the payload carries exactly the allowed keys and each metric's latest reading.
2. **Given** a reading outside the pool's resolved band, **then** it is marked outside, with its
   band; **given** a metric the pool has switched off, **then** it is not judged.
3. **Given** the link is regenerated, **then** the old token answers 404 and the new one answers.
4. **Given** the link is turned off, **then** the token answers 404, identical to an unknown one.
5. **Given** club B's live token, **when** club A's staff call the tenant endpoints with B's pool id,
   **then** 404; the public endpoint serves B's pool and no field of A's.
6. **Given** an Instructor, **when** they turn a link on, **then** 403; Maintenance may.
7. **Given** a tank with no readings, **then** the page says so.
8. **Given** a reading taken 30 hours ago, **then** it is marked as older than 24 hours.
9. **Given** an archived analysis, **then** its values are not the latest.
10. **Given** 61 requests a minute from one client, **then** the excess is throttled.

### Acceptance criteria

1. Owner, Admin and Maintenance can turn a tank's public page on and off and regenerate its link;
   regenerating or switching off kills the old link at once.
2. The token is unguessable (≥128 bits) and unique across tenants.
3. `/[locale]/agua/[token]` shows the site, the tank and the latest reading per judged metric with
   its date and time and whether it is inside its band, in words and an icon; stale readings and
   an empty tank say so.
4. The public read is a single `SECURITY DEFINER` function with a fixed result shape, and the
   payload is asserted to carry nothing beyond it.
5. Unknown, revoked and disabled tokens are indistinguishable; the endpoint is throttled.
6. `?screen=1` is a lobby variant that refreshes every five minutes, in light and dark.
7. The pool's page has a *Página pública* tab with the switch, the QR (PNG and SVG), the link and
   regenerate behind a confirmation.
8. Both Open items answered and logged; pt-PT and en; `docs/features/maintenance.md` and
   `docs/data-model.md` updated.

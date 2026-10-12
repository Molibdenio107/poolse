# Poolse — Phase 7b: public water page (POOLSE-71) and qualifications (POOLSE-27)

Read `CLAUDE.md`, `docs/backlog/CONVENTIONS.md`, the **Phase 7b** section of `docs/roadmap.md`
(added 10-10-2026) and `docs/backlog/POOLSE-27-certification-expiry-with-amber-window.md`.
Do not load the rest of the backlog folder. Use the `write-migration` rules for every SQL change.

Phase 7b is the Portuguese compliance layer. Tonight covers only its two ungated slices, 7b.1 and
7b.2. Do not start 7b.3–7b.8; they wait on answers from outside.

## Part 1 — tickets (docs only)

**Write `docs/backlog/POOLSE-71-public-water-quality-page.md`** in the house format (PO / BA /
Dev / QA / Acceptance criteria). Add it to `docs/backlog/README.md` and update the count. Rules:
- One token per pool: unguessable (≥128 bits), stored hashed, revocable and regenerable by
  Owner/Admin/Maintenance. Regenerating one kills the old QR at once.
- The public route `/[locale]/agua/[token]` needs no login. It shows the facility and pool name,
  the latest reading per metric with its own date and time (`formatDate`/`formatTime`), whether
  each reading is inside the resolved band (reuse `excursions()`/`resolveBands` from
  `@poolse/rules`, words plus icon and never colour alone), and the latest lab result's date and
  outcome. A reading older than 24 h says so in words. Nothing else about the tenant: no staff
  names, no notes, no students.
- Reads bypass the request's tenant context, so they go through one `SECURITY DEFINER` function
  with a fixed body (token hash → that pool's public fields only), granted to the app role. The
  pattern is `provision_organization`; never a looser RLS policy. Public endpoint rate-limited.
- The pool's page gets a "Public page" tab: on/off switch, the QR as a downloadable PNG/SVG for
  printing, copy link, regenerate (with a `Dialog` confirmation).
- A lobby-screen variant (`?screen=1`): large type, auto-refresh every 5 min, light and dark.
- Out of scope: lab PDFs on the public page, history charts, the complaints-book link and the
  operating regulation (POOLSE-73).
- **Open:** does the page show a club's own overridden band, or always the published reference?
  (Recommend: the resolved band, the same answer the pool's own page gives.)

**Revise POOLSE-27** in place. Keep its structure and record what changed in a short
"Revised 10-10-2026" note at the top:
- Seed the Portuguese qualification types on every business tenant (tenant data, editable, names
  not translated): **TPTD — Título Profissional de Treinador de Desporto** (default validity
  5 years; Lei 40/2012), **Nadador-salvador (ISN)**, **SBV — Suporte Básico de Vida**
  (Lei 61/2017's alternative to a lifeguard). Seeding is idempotent and never re-creates one a
  club deleted.
- AC 6, the assignment rule, conflicts with CLAUDE.md "a warning about a person never gates what a
  club does with them". Resolve it as: **warn by default**, with an opt-in per-type "required to
  teach" block that is off unless Owner/Admin turns it on. Flag it as `**Open:**` with that
  recommendation, and append the answer to `docs/decisions.md`.
- Document upload stays a present, visibly disabled control until file storage lands. This is
  the settled rule for logo, photos and the CC, and AC 1 is met minus the upload.
- Notifications: write the alert records now and email them through `notifier.ts` after commit
  (the 4.2 pattern). A daily cron under `pg_try_advisory_xact_lock`, evaluated on crossing so
  nobody is emailed twice.
- The amber/red list becomes a widget in the dashboard registry (management band) as well as its
  own list under Staff.

## Part 2 — build, in this order

1. **POOLSE-71 first.** Before any code, show me its acceptance criteria and your answer to its
   Open item, and wait for my OK. Then: migration → API (integration tests: a revoked token,
   a regenerated token, a token from another tenant's pool, and a payload carrying no field
   beyond the allowed list) → UI → QA pass.
2. **Then POOLSE-27**, the same way: acceptance criteria and the Open answer first, then wait for
   my OK. Migration (`qualification_type`, `qualification`, the tenant window; tables added to
   `TENANT_TABLES`) → API (derived status in SQL, never stored; denial and cross-tenant tests)
   → UI on the staff record as a `DetailPage` tab → widget → cron → QA pass.
3. If the session runs out after POOLSE-71, stop cleanly and say so. A finished 71 is worth more
   than a half-built 27.

## Housekeeping (every prompt)
- Docs follow behaviour in the same commit: `docs/data-model.md` for schema,
  `docs/features/maintenance.md` (public page) and `docs/features/staff.md` or the existing staff
  page (qualifications), created if missing.
- New conventions or shared components earn one line in `CLAUDE.md`. The public-token +
  `SECURITY DEFINER` read path is one.
- Refactors are proposed in one line in the session summary and never done inline.
- Append to `docs/decisions.md`: "10-10-2026 — Phase 7b added (POOLSE-71…77) from the
  competitor/regulation research; 7b.1 and 7b.2 ungated and first", plus a line for each Open
  item I answer.
- i18n pt-PT (European, not Brazilian) + en as written; dates via `formatDate`; light/dark,
  contrast-checked; colour never carries meaning alone.
- Close with two lines: what now works, and the single next slice.

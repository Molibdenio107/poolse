# POOLSE-137 · Rui switches each AI reader on per club in /admin, and sees what each club's reads cost

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Platform / AI · **Priority:** Medium (pilot) · **Depends on** fab72df (`platform_switch`, the ID reader switch), POOLSE-106 (`energy_invoice_read`), POOLSE-87 (the per-club card pattern)

### PO — why this exists

> "the 'Energy' screen has the Ai feature to read the Bills, right? can we do also a toggle per tenant to activate this feature on /admin screen too? Lets brain storm this because this screen can also give some more information maybe" — Rui, 30-10-2026

Poolse calls the model in five places, and today four of them are switched by environment
variables for the whole platform and one (the ID photo, fab72df) by a switch on /admin, also
for the whole platform. Every read is paid by Poolse, the first club is a free pilot, and only
the bill reader records that it was used. Rui chose (30-10-2026) one rule for all five: a
switch per reader per club, on top of the platform switch, with each club's usage, an
estimated cost and an optional monthly cap on the same card.

**Not in scope:** ticks per role (`guardAiCall`'s `AI_ROLES` already decides who in a club may
read); showing usage or cost to the club; billing a club for reads; changing what any reader
extracts or its prompt; a new reader.

### BA — rules

1. **Five readers, one list.** `AI_READERS` = `energy_invoice` (Energia → *Importar fatura*),
   `id_document` (student → Documentos), `water_report` (pool → lab report / analysis import),
   `pdf_table` (a PDF given to any list importer), `column_match` (column mapping in the
   importers). One list in `@poolse/rules`, equal to the SQL enum by test. (Rui, 30-10-2026)
2. **A reader runs only when all three hold:** its platform switch is on, the club's tick for
   it is on, and the web app has `ANTHROPIC_API_KEY`. Then `AI_ROLES` and the per-person rate
   limit apply as today. (Rui, 30-10-2026)
3. **Platform switches.** `platform_switch` gains `energy_invoice_ai`, `water_report_ai`,
   `pdf_table_ai`, `column_match_ai` beside `id_document_ai`. The env flags
   `ENERGY_INVOICE_AI_ENABLED`, `WATER_REPORT_AI_ENABLED`, `PDF_TABLE_AI_ENABLED` and
   `COLUMN_MATCH_AI_ENABLED` are removed from the code, as `ID_DOCUMENT_AI_ENABLED` was.
   Each new switch starts **off**.
4. **Per-club ticks, off by default.** A club stores the readers that are **on**; a new club
   has none. Only `poolse_platform` writes it, through `changeTenant`, one click either way,
   audited and alerted (POOLSE-87's shape). (Rui, 30-10-2026)
5. **The club is told which gate closed**, in visible text where the reader would have acted:
   *desligada* (platform off or club tick off — the club is not told which, because both are
   Poolse's decision), *sem chave* (no key), *limite do mês atingido* (rule 9). Each ends
   "preencha à mão" / the importer's manual path. The reader's absence never blocks the manual
   path.
6. **Every call is logged, read or not.** One row per call: club, reader, when, succeeded,
   model, input and output tokens. A call that came back with nothing usable still counts —
   it was paid for (the `energy_invoice_read` rule, now for all five).
7. **The card on /admin → club** (*Leitura com IA*), one row per reader: the tick; reads this
   month and last month (Lisbon months); how many failed; last used (`formatStamp`); estimated
   cost this month and last. A platform switch that is off shows on the row as *desligada na
   plataforma*, so a ticked reader that cannot run does not look as though it runs.
8. **The cost is an estimate, derived and never stored.** Tokens × the model's price per
   million tokens, in euros, labelled *estimativa* and muted (`docs/financials.md` §9). A model
   with no known price shows `—`, never `0`. No figure appears in a URL, a log line, a toast
   or `platform_audit_log`. Never shown to the club.
9. **Optional monthly cap per club**, one number for all five readers together: null = no
   limit (a null ceiling enforces nothing); `0` is not accepted (switch the readers off
   instead). The month is the Lisbon calendar month. The cap is checked **before** the call,
   and the call that would exceed it is not made. Set on the same card, audited.
   **Open:** one cap per club (default) or one per reader.
10. **The platform-wide monthly totals on /admin → Faturação keep working** (POOLSE-106's
    *Faturas lidas*), now read from the shared log filtered to `energy_invoice`, plus the same
    total for all readers.
11. **Open:** where prices live. Default: a constant `AI_MODEL_PRICES` in `@poolse/rules`
    (USD per million input and output tokens per model id, from Anthropic's price list) and one
    USD→EUR constant, both commented with the date they were copied. Not an env var and not a
    table, because only a developer changes them and a table invites editing them per club.

### Dev notes

- **Migration** (`write-migration` skill):
  - `CREATE TYPE ai_reader AS ENUM (...)` — rule 1.
  - `organization.ai_readers ai_reader[] NOT NULL DEFAULT '{}'` and
    `organization.ai_monthly_cap integer CHECK (ai_monthly_cap IS NULL OR ai_monthly_cap > 0)`.
    `poolse_platform` gets `GRANT UPDATE (ai_readers, ai_monthly_cap)`; the app gets no UPDATE on
    either (POOLSE-87: the app's UPDATE on `organization` is column by column already). Read it
    `::text[]` — a bare custom-enum array arrives as the string `'{…}'` (CLAUDE.md).
  - `ai_read` replaces `energy_invoice_read`: `id, organization_id, reader ai_reader, claimed_at,
    finished_at, succeeded boolean NULL, model text, input_tokens int, output_tokens int`.
    Copy every `energy_invoice_read` row in as `reader = 'energy_invoice'` (tokens null, model
    null, `finished_at = claimed_at`), then drop the old table in the same migration. Index
    `(organization_id, claimed_at)`. Tenant table → `TENANT_TABLES` in the harness.
  - `platform_switch`: widen the CHECK, insert the four rows `enabled = false`.
- **Claim, then finish — the cap must hold under two tabs.** `POST /ai-reads/claim { reader }`
  (core route, `requireRole` = the reader's `AI_ROLES`) in one transaction: take
  `pg_advisory_xact_lock` on the club, check platform switch + club tick + cap against this
  month's `ai_read` count, insert a row with `succeeded` null, answer `{ id }` or 409 with code
  `ai_reader_off` | `ai_cap_reached`. `POST /ai-reads/:id/finish { succeeded, model, inputTokens,
  outputTokens }` fills it once (`finished_at IS NULL` guard). A claim never finished counts
  against the cap and shows as failed after an hour — a crashed call was still possibly paid.
  The app needs INSERT, SELECT (own club, by RLS) and `UPDATE (finished_at, succeeded, model,
  input_tokens, output_tokens)`; no DELETE.
- **Web.** `guardAiCall(reader)` becomes the one door: roles from `/me` as today, then the
  claim; it returns the claim id or the refusal. Each of the five call sites passes the
  response's `usage` to finish. `/me` memberships carry `aiReaders` (the effective list:
  platform on ∧ club on) so a screen can say *desligada* before anybody uploads. The key check
  stays on the web server (`anthropicKeyConfigured`). `lib/id-document-agent.ts`'s `off`/`noKey`
  notes (fab72df) become the shared pattern; `read-sheet.ts`'s `pdfDisabled` maps onto it.
- **/admin.** Platform → `GET /platform/tenants/:id/ai` (one grouped query over `ai_read`, never a
  loop over readers) and `POST /platform/tenants/:id/ai { readers, monthlyCap }` through
  `changeTenant`. The card sits beside *Módulos* in `tenant-actions.tsx`. The *Plataforma*
  section lists all five switches with the existing `SwitchToggle`.
- **Traps.** The billing overview's energy query (`platform.repository.ts`, *energyReads*) reads
  `energy_invoice_read` by name — move it in the same change or /admin 500s. `column_match` is
  called on preview *and* commit paths in `students/import/import.actions.ts` (lines ~89 and
  ~188): one claim per model call, not per button. A test that flips a platform switch resets it
  in `after` — `platform_switch` is global and every test file shares it.

### QA

1. Given the platform switch and the club's tick for `energy_invoice` are on and a key is set,
   when an owner imports a bill, then it is read and one `ai_read` row is written with tokens.
2. Given the club's tick is off, when an owner imports a bill, then no model call is made, the
   page says the reading is switched off, and the manual form is there.
3. Given the club's tick is on but the platform switch is off, then the same as 2, and the
   /admin card shows the row as *desligada na plataforma*.
4. Given a cap of 2 and two reads this month, when a third is attempted, then the claim answers
   409 `ai_cap_reached`, no call is made and the page says the month's limit was reached.
5. Given a cap of 2 and one read, when two tabs claim at once, then exactly one succeeds.
6. Given a call that returned nothing usable, then its row has `succeeded = false` and counts
   on the card and against the cap.
7. Given club A, when club A's app login selects `ai_read`, then it sees none of club B's rows;
   and it cannot UPDATE `organization.ai_readers` (insufficient_privilege).
8. Given an instructor, when they call `POST /ai-reads/claim` for `energy_invoice`, then 403 —
   and the endpoint has its role-probe line.
9. Given a non-operator, when they call `POST /platform/tenants/:id/ai`, then 403; an operator's
   change writes `platform_audit_log` with the before and after and a `platform_alert`.
10. Given the existing `energy_invoice_read` rows, after the migration, then /admin → Faturação
    shows the same monthly counts as before.
11. Given a model id with no price, then its cost cell reads `—`.
12. The card in light and dark mode, and at phone width (tier 3: readable).

### Acceptance criteria

- [ ] `AI_READERS` in `@poolse/rules` equals the `ai_reader` enum by test.
- [ ] All five readers go through `guardAiCall(reader)` → claim → finish; no reader reads an
      `*_AI_ENABLED` env var any more, and `.env.example` / `docs/deploy.md` say so.
- [ ] Platform switches for all five, off by default, on /admin → Plataforma.
- [ ] Per-club ticks (default none) and an optional cap on /admin → club, audited and alerted.
- [ ] The club sees which gate closed (off / no key / cap) in visible text, and the manual path
      always works.
- [ ] Usage this month and last, failures, last used and an estimated € cost per reader per
      club; cost labelled as an estimate, `—` when unpriced, never shown to the club.
- [ ] `energy_invoice_read` folded into `ai_read` with its history; Faturação's totals unchanged.
- [ ] SQL tests for the grants (QA 7), integration tests for QA 1–6 and 9–10, a role-probe line.
- [ ] `docs/features/platform.md`, `docs/data-model.md`, CLAUDE.md's AI-guard paragraph updated.

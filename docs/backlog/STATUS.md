# Backlog status sweep — 02-11-2026

One line per ticket. Built from `git log` (commits naming the ticket), `docs/features/*`, `docs/roadmap.md`
and `docs/decisions.md`. "Built" means the docs or a commit say so; "verify" means nothing names the
ticket and the evening it landed in is a round/slice commit — open the screen before trusting it.
Go-live is an **unpaid pilot** (Rui, 02-11-2026), so certified invoicing and collections are not blockers.

## Not built — by decision (do not test, do not expect)

| Ticket / slice | What | Why parked |
|---|---|---|
| 3.5, POOLSE-24, 25, 83 | Family pays the club online — SEPA DD, MB WAY, Multibanco refs, autopay retries, checkout with a held place | Payer authorisation; unpaid pilot shows IBAN + MB WAY as copy-and-pay instructions |
| 7b.7 (POOLSE-76, no ticket file) | Certified invoicing — ATCUD, QR, SAF-T through a provider | Blocks only a *paying* tenant and a POS |
| 7b.5 (POOLSE-74, no ticket file) | DL 10/2009 facility policy, VAT exemption reason, club CAE | Cheap, legal, after the pilot's accountant answers |
| 7b.6 (POOLSE-75, no ticket file) | Printable sanitary register, one day per page | Needs a photo of the pilot's current register first |
| Phase 3b W.1–W.6 | Apple Health, Garmin Connect, Fitbit, watch apps | After phase 3; apply to Garmin's developer programme early |
| Phase 3c I.1–I.4 | Personal trainers / nutritionists | Brainstorm only |
| POOLSE-26 (half) | Email when a maintenance task falls due | The missing-reading alert exists; the due-task notice needs the scheduled job |
| POOLSE-119 | In-app assistant | Post go-live |
| POOLSE-123 | Area units (lane as one kind) | Deferred, option (b), first non-pool sport |
| POOLSE-126 screens, 127, 128, 135 | Per-sport seasons screens, app sport tabs, energy per recinto, sport glyph feedback | Post go-live, multi-sport |
| POOLSE-65 | Resource-kind path | Low |
| POOLSE-121 free swim from the phone | Parked on how it is paid (joining a class from the app *is* built) | — |
| SMS | — | Deferred by stack decision |
| MFA / step-up on /admin | — | Gated on a production Clerk instance (`docs/deploy.md`) |
| POS / cash desk | — | After certified invoicing |

## Built but never run against a real service — configure in staging this week

| What | Needs | Where |
|---|---|---|
| Stripe (2.4, POOLSE-60–63) | `STRIPE_SECRET_KEY`, webhook secret, two price ids; **prices still undecided** (subscription.md v2 proposal of 29-10) | Subscrição, /webhooks/stripe |
| AI readers (bills, lab PDF, PDF tables, ID photo, boletim template, certificates) | `ANTHROPIC_API_KEY` + platform switch + club tick (POOLSE-137). POOLSE-142 and 149-D say *live read untested* | /admin → Plataforma |
| File storage | Cloudflare R2 bucket for staging/prod (S3Mock in dev) | photos, documents, contracts, sealed files |
| Push (POOLSE-90 4a/4b) | three `VAPID_*` vars; **real-device pass on an installed iPhone and Android still owed** (app.md *Not yet*) | /app |
| Inbound results email (POOLSE-114) | Resend inbound + Svix secret | /webhooks/resend-inbound |
| Weather history (5.4b) | `WEATHER_HISTORY_ENABLED` off by default; Open-Meteo free tier is non-commercial | energy comparison |
| Backups (POOLSE-89) | age key, S3 target — "switched on with production" | `packages/db/scripts` |
| Sentry | DSN | optional |

## Built — by ticket

Legend: ✅ docs or commit say built · ◐ partly · ❔ verify on screen (no commit or doc names it).

| Ticket | State | Note |
|---|---|---|
| 01 | ✅ | invite matrix |
| 02 | ❔ | week range centred — check calendar heading |
| 03 | ❔ | archive Owner/Admin only — probe as instructor |
| 04, 17, 22 | ✅ | one person many roles, guardian block, age of majority |
| 05 | ✅ | levels drag-and-drop |
| 06, 16 | ✅ | age in months, ceiling 100 |
| 07 | ✅ | seasons, ending one |
| 08, 15 | ❔ | turma names / hover card — superseded in part by 147 |
| 09, 10 | ✅ | controlled fields sweep (forms:check = 0) |
| 11 | ◐ | student ID document built by 132; photo by consent rule (files.md) |
| 12 | ❔ | weather icons |
| 13 | ✅ | attendance states, no *atrasado* |
| 14 | ✅ | classes out of calendar |
| 18 | ✅ | role colours |
| 19, 20, 112, 113 | ✅ | advancement, skills, age queue |
| 21 | ✅ | reposição credits |
| 23 | ◐ | adult path built as the record; AC7 open (decisions 08-09) |
| 24, 25 | ⏸ | with 3.5 |
| 26 | ◐ | reading alert ✅, due-task email ✗ |
| 27 | ✅ | qualifications (7b.2) |
| 28 | ✅ | at month grain |
| 29, 30 | ✅ | pagination, search |
| 31, 34, 35, 36, 38 | ✅ | closures, navigation split (36 superseded) |
| 32 | ✅ | names |
| 33 | ❔ | age-bracket icon |
| 37 | ↩ | reversed by POOLSE-66 — dashboard is home |
| 39 | ✅ | staff record |
| 40, 41 | ✅ | levels view, page shell |
| 42 | ✅ | fee kinds, periods |
| 43–57 | ✅ | lane grid, parcerias, imports, exports, seed (BUILD-ORDER block; 49 and 51 left open questions) |
| 56 | ❔ | full slot refuses — test by placing a 3rd turma on a full slot |
| 58, 59 | ✅ | salaries |
| 60–64 | ✅ | plan, trial, abuse, manual billing, /admin hardening |
| 65 | ⏸ | low |
| 66 | ✅ | dashboard bands |
| 67 | ✅ | messages (7.1) |
| 68 | ✅ | free swim slice 1 (7.2) |
| 69 | ✅ | pre-registration (7.3) |
| 70 | ✅ | incidents + roster (7.4) |
| 71, 72, 73 | ✅ | public water page, NP 4542 bands, public notices |
| 77 (7b.8) | ✅ | retention |
| 78, 79, 80 | ✅ | bin, support access, revert |
| 81, 85, 111, 114, 115 | ✅ | competition, LENEX, mínimos, inbox, print |
| 82 | ◐ | app enrolment ✅ (121); **waiting-list offers** parked ("to discuss", 01-11) |
| 84 | ✅ | closures by tank |
| 86 | ✅ | delivery, retries, opt-out |
| 87, 88 | ✅ | modules, phone shell (device passes owed) |
| 89 | ✅ | backups |
| 90 | ✅ | agenda, vou/não vou, push |
| 91–99 | ✅ | 22-10 test-pass fixes |
| 100–110 | ✅ | 23-10 round |
| 116–118, 120 | ✅ | feedback, partner days, palette, circles |
| 121 | ◐ | join from app ✅, free swim ✗ |
| 122, 124, 125 | ✅ | recintos, sports, nav (API `?sport=` filters wait on 123) |
| 126 | ◐ | schema ✅, screens ✗ |
| 129–134 | ✅ | family invites, last seen, identity, documents, exame, boletim |
| 136–142 | ✅ | design handoff passes, AI reader switches, boletim template |
| 143–149 | ✅ | per-sport views, clash, instructor scope, sport messages, calendar card, level per sport, staff record |

## Automated checks run 02-11-2026

- `pt-PT.json` / `en.json`: 6,122 keys each, none missing either way.
- Brazilian forms: none (the only hits are `{time}` placeholders and *toda a gente*).
- English left in pt-PT: none (`advancement.fromTo` is a symbol-only string).
- `new Intl.DateTimeFormat` outside `date-format.ts`: 7 call sites, all month/weekday *names* (allowed).

## Since this sweep (06-11-2026)

- **151–171** (testing week, main 2c9baf66), bar 155, 160, 161 parked: built. Their acceptance boxes are unticked; 152 and 157, the two pre-go-live security tickets, were checked in the code and the role probe on 06-11-2026. The rest are confirmed by walking `TEST-PLAN.md`.
- **172, 174–182, 186**: built, on `feat/poolse-186-birth-date`.
- **183, 184, 185**: not built. 183 is next.
- **187** (older unpaid periods stay owed): not built, pre go-live, after 183.

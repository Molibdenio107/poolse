# POOLSE-119 · An in-app assistant that answers from the docs and the club's own data

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Platform / AI · **Priority:** Low — **after first go-live**, phase 6 beside the AI dashboards · **Depends on** [POOLSE-118](./POOLSE-118-command-palette.md) (the deep-link target), [POOLSE-87](./POOLSE-87-modules-per-club.md) (switched on per club), the functionality-by-functionality docs in `docs/features/` (the corpus) · **Related** the `guardAiCall` convention, [POOLSE-66](./POOLSE-66-dashboard-role-bands.md) (resolver shape)

### PO — why this exists

Rui, 28-10-2026: *"does it make sense to add a RAG assistant to Poolse to help users navigate the desktop app?"* Agreed: **yes, later, and not for navigation.** Navigation is POOLSE-118. What an assistant can do that nothing else in Poolse can is answer, in the reader's words, three kinds of question:

- **"What does the app know?"** — *quem está com quotas em atraso na turma de sábado?*, *quantas leituras de cloro falhámos este mês?* An agent with read access to the club's own API, on the reader's own permissions.
- **"Why is this red?"** — a reading, a qualification, an invoice: the answer is the rule and the regulation it comes from (NP 4542:2017, the TPTD, the retention periods). The compliance layer is Poolse's differentiator and this is the cheapest way to make it visible to a sceptical owner or an inspector.
- **Onboarding of a new club** — the weeks when staff do not know the app and Rui does not want to be the help desk. That is the one place "how do I…" has value, and it is a window per tenant, not a standing need.

**Not in scope, by decision:** navigation as the purpose; any write — the assistant never changes a record, it links to the page where a person would; the app mode (`/app`): families and students would ask the most and pay the least; the free pilot until the core is stable (off by default, switched on from `/admin`); SMS or voice; a vector database as a service — pgvector in the same Postgres, or nothing.

### BA — rules

1. **Two corpora, one answer.** The docs (`docs/features/*.md`, in pt-PT and en, chunked per heading) answer *how* and *why*; the club's data answers *what* — through the existing API, **as the reader**, so `requireRole`, RLS and the module gates apply unchanged and the assistant can know nothing the reader could not open. No new read path, no `SECURITY DEFINER`, no platform login.
2. **An answer links.** Every answer that names a page carries the deep link POOLSE-118 would have offered, so the assistant is also the navigation it was first asked to be. Every answer that cites a rule names the doc section.
3. **Metered and capped.** Behind `ASSISTANT_ENABLED` + `ANTHROPIC_API_KEY`, off by default; `guardAiCall(AI_ROLES.assistant)` per call; **a monthly cap per club** (`organization.assistant_monthly_cap`, null = module off), counted in a row per call (model, tokens, cost estimate) that `/admin` sums — the `energy_invoice_read` shape. When the cap is reached the box says so in words and offers the docs link; nothing fails silently.
4. **Who may ask:** owner, admin, instructor, maintenance — staff. A `poolse_module` value `assistant`, so `disabled_modules` switches it off and the box is absent, not greyed.
5. **What is sent to the model:** the question, the retrieved chunks, the API answers the agent fetched for this question, the reader's role and language. **Never** a person's withheld fields (names are fine where the reader may read them; NIFs, notes, health data, addresses are not — the `withheld` list of `audit/change.ts` is the list). Never another club's anything, by construction (rule 1).
6. **Every exchange is a record**, kept 30 days for support and the cap, then purged — a `retention.integration.test.ts` line. The reader is told once, under the box.
7. **Honesty of the answer.** An answer from the docs says so; an answer from data names the figures and the page; an answer the model could not ground says *não encontrei isso na documentação nem nos dados do clube* rather than a guess. A wrong confident answer about an invoice is worse than no assistant.

### Dev notes

- **Retrieval.** `pgvector` in the same Postgres (an extension, like TimescaleDB; dev Docker image must carry it). A platform-scoped `doc_chunk` table — the docs are Poolse's, not a club's — embedded by a repo script at deploy (`pnpm assistant:index`), re-run when `docs/features/` changes; one row per heading per language. A small embedding model; the choice is an env var.
- **Agent.** One Nest service, `assistant/`, with a tool list of **read** endpoints only, each call made through the ordinary request path with the reader's context (an in-process call carrying `currentTenant()`, never a second HTTP hop with a borrowed token). Structured output, as `pdf-table-agent.ts` does, because `tool_choice` is refused by the current model.
- **UI.** A side sheet (the plan sheet's flex-column shape: the transcript takes `flex-1 min-h-0`), opened from the app bar beside the palette; answers render links as `FromLink`. Tier 3 — desk only.
- **Cost.** Estimate before building: a club asking 200 questions a month at ~10k tokens each is the figure to put against the plan price; write it in the PR.
- **Most likely to be got wrong:** a tool that reads through a repository function instead of the controller's `requireRole` line — the assistant would then answer an instructor with the owner's salary. Every tool goes through the same handler the screen calls, and the role probe gets one line per tool.

### QA — scenarios

1. **Given** an instructor, **when** they ask *quanto ganha o/a owner?*, **then** the answer is a refusal in words and no salary endpoint was called with elevated rights (role probe).
2. **Given** a reading out of band, **when** *porque está o cloro a vermelho?*, **then** the answer names the band, the pH it was judged at and the doc section, and links to the pool's water tab.
3. **Given** `assistant` in `disabled_modules`, **then** no box, and the endpoint answers 403 `module_disabled`.
4. **Given** the cap reached, **then** the box says so and the call is not made; `/admin` shows the month's count and estimate.
5. **Given** a question with no grounding, **then** the *não encontrei* sentence, not a guess.
6. **Given** a club's exchange 31 days old, **when** the retention job runs, **then** it is gone.
7. pt-PT and en answers in the reader's language; light and dark; the sheet fits a laptop with the Send button visible.

### Acceptance criteria

1. Off by default, switchable per club from `/admin`, metered and capped, every call guarded and recorded.
2. Reads only, as the reader, through the ordinary handlers; nothing withheld reaches the model; no cross-tenant path exists.
3. Answers ground in the docs or the club's data, link to the page, and say when they cannot.
4. The docs corpus is indexed from `docs/features/` by a repo script, in both languages, in the same Postgres.

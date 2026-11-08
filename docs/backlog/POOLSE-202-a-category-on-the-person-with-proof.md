# POOLSE-202 · A category on the person, with proof seen and a valid-until date

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Reception / Billing · **Priority:** Medium (pilot) · **Depends on** POOLSE-23 (fee categories), [POOLSE-68](./POOLSE-68-free-swim-passes-and-check-in.md) · **Unblocks** [POOLSE-203](./POOLSE-203-a-pass-price-per-category.md)

### As built (08-11-2026) — wins over what follows

- **Rank is its own column** (Rui, 08-11-2026): `fee_category.rank`, seeded from `sort_order`, with a second drag list on the categories panel (*Prioridade no preço das entradas*, `POST /fee-categories/rank`). `sort_order` stays the display order.
- **Schema**: `person_category` (migration `1794654300000_person-category.sql`), `person_category_status(valid_until)` (live / expiring ≤ 30 days / expired) and `person_categories(org, membership, student)` (valid ones by rank). A membership and the student whose login it is count as one person. Removal is an archive; the app role has no DELETE. Notes ≤ 200 and a CHECK refuses six digits in a row. Anonymising a student or a membership clears `notes` and `proof_seen_by` by trigger. The enrolment precedence view, its function and `student_fee` are untouched.
- **Where the card lives** (Rui, 08-11-2026): a student's record (General tab) and, for anybody else, Receção's person panel. No member record page was built. One component, `components/person-categories-card.tsx`, loads itself through `lib/person-categories.actions.ts`.
- **API**: `PersonCategoriesController` (`GET/POST /person-categories`, `PATCH /:id`, `POST /:id/archive`, `GET /expiring`), owner and admin only, since there is no reception role. A person of another club is a 404. Refusals carry a field and an i18n key. `GET /app/categories` gives the reader their own valid categories (name and expiry only).
- **Warnings**: *Categorias a expirar* on the Receção page (not paginated; listed as an exemption in CONVENTIONS.md) and the attention circle on the menu's *Receção* (`categories`, office only, with reception on). An expired row reads *Expirou a dd-MM-yyyy* on the card, which in Receção sits in the person panel where the check-in is done (rule 5). It is not yet on the scan itself; there is no scan until POOLSE-205.
- **Help text**: the residence warning is a visible section on the categories panel, not a link.
- **Tests**: `packages/db/test/person-category.sql`, `apps/api/src/billing/person-categories.integration.test.ts` (QA 1–5), and role-probe lines. Walked in a browser: panel, student card (refusal, add, expired, expiring, dark mode), Receção list and circle, family *Perfil*.
- **Person merge**: `merge_memberships` does not move `person_category` rows, as it does not move passes either; a merged person's categories stay on the archived membership. Proposal, not built.

### PO — why this exists

Rui, 08-11-2026: *"if a person is from 'porto' it can get a personalized discount."* Brainstormed the same evening (decisions below). A free swimmer has no enrolment, so today's categories (on the enrolment or the turma) cannot reach them. The category has to sit on the **person**.

**Poolse does not know about residence.** A club creates its own categories (*Sénior*, *Sócio*, *Munícipe*, *Parceria Junta X*), and the office ticks one after seeing proof. EU law (Services Directive art. 20(2), DL 92/2010) bars different prices by place of residence without an objective justification, and the Commission has an infringement procedure open against Portugal over residents-only museum days. The pilot is a private club. A *Munícipe* rule is the club's decision and responsibility. The category screen links to a short help text that says so and suggests *Sócio* or a partnership as alternatives. Not legal advice.

**Not in scope:** monthly fees (decided: passes only for now; fees keep the enrolment/turma rule), automatic eligibility from the postal code, uploading the proof document.

### Decided (Rui, 08-11-2026)

- One person may hold several categories. **The club ranks its categories**, and the top one sets the price (POOLSE-203).
- Proof: **who checked it, when, and valid until**. No copy of the document is kept.
- When proof is about to expire, the office is **warned 30 days ahead**, and reception sees it at the scan. The next sale is at the base price. Packs already sold are untouched.

### BA — rules

1. `fee_category` gains `rank` (the club's order, drag to reorder on the categories panel). This is separate from `sort_order` (display), unless the two turn out to be the same; decide in the migration.
2. New `person_category`: the person (`membership_id` **or** `student_id`, exactly one, by CHECK), `fee_category_id`, `proof_seen_on`, `proof_seen_by` (membership), `valid_until` (nullable means no expiry), `notes` (≤ 200, no document numbers), archive columns. One live row per person per category.
3. **Live** means not archived and (`valid_until` is null or ≥ `club_today()`). That is one SQL function, `person_categories(org, person)`, ordered by rank. Nothing in TypeScript decides validity.
4. Office: on the student and the member record, a *Categorias* card. Add, renew (new dates) or remove. Each change is audited. Owner and admin only; reception reads it.
5. Warnings: a *Categorias a expirar* list on the reception page and an attention circle (POOLSE-120) for rows expiring within 30 days. At reception check-in, a category that expired shows as a line: *Sénior expirou a 30-06*.
6. The family app shows the person's own live categories, read-only, with their expiry. It never shows the proof fields.

### Security / privacy

- The `notes` field says what was seen (*Cartão de estudante*), never its number. The UI says so under the field.
- RLS like every tenant table; composite FKs; `TENANT_TABLES` entry; tenant-isolation test.
- What was proven is personal data: retention follows the person's record (anonymise clears `notes` and `proof_seen_by`).

### QA

1. Given Sénior ranked above Sócio and a person with both, `person_categories` returns Sénior first.
2. Given `valid_until` yesterday, the row is not live, and the reception scan shows *expirou*.
3. Given a row expiring in 20 days, it is in the 30-day list and raises the circle.
4. Given an instructor, adding or removing a category → 403. Given a cross-tenant person → 404.
5. Given a person anonymised, their `notes` are null.

### Acceptance criteria
- [ ] Migration (`write-migration` skill), function, RLS, isolation test.
- [ ] *Categorias* card on student and member; ranking on the categories panel.
- [ ] Expiry list, circle, reception line; app read-only view.
- [ ] QA 1–5; `i18n:check`.

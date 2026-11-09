# POOLSE-206 · A parent's link stops counting at 18, an acompanhante's does not, and nobody is their own guardian

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Architecture · **Area:** Students / Families / Security · **Priority:** High (pre go-live) · **Depends on** POOLSE-23 (adult path), POOLSE-178 (payer in the app) · **Unblocks** [POOLSE-207](./POOLSE-207-the-office-sees-turning-18-and-supported-adults.md), [POOLSE-208](./POOLSE-208-the-young-adult-confirms-and-the-family-is-told.md)

### PO — why this exists

Rui, 09-11-2026: *"i enrolled 'Afonso Lopes' to the aula de test 2. He is 47 years old, but still displays a child on the student mobile app. what is wrong? Is this preventable for the future? We need to adjust everything correctly."* And: *"A student turns 18, how can we manage this?"*

Afonso had a live `guardian_link` ("Pai", from the 27-08 seed), and an adult with a live link is on the guardian path by design. A second adult, Rui Fonseca (36), was linked to himself. Both links were archived in dev on 09-11-2026. The design was right for a *supported* adult and wrong for every child who turns 18. **In law a parent's responsibilities end at majority (Código Civil, art. 122.º); a supported adult is a court measure, the *maior acompanhado* (Lei 49/2018), with a court-appointed *acompanhante*.** Poolse kept both kinds in one link and could not tell them apart, so a child who turned 18 stayed a child in the app forever.

This ticket is the invisible half: the kind on the link, the one rule that reads it, and every reader moved onto that rule. Nothing on screen changes except that adults with a parent's link become adults.

**Not in scope:** any office screen or flag (POOLSE-207); consents, invitations and emails at 18 (POOLSE-208); uploading court documents; partial-capacity nuances of the *maior acompanhado* regime; changing a club's `age_of_majority`.

### BA — rules

1. **A link has a kind**: `parental` (encarregado de educação of a minor: pai, mãe, tutor) or `accompanying` (acompanhante of a *maior acompanhado*). Every existing link becomes `parental`. (Rui, 09-11-2026)
2. **A `parental` link grants nothing once the student is at or above the club's `age_of_majority`**, from the birthday on, with no job and no write: it is read, never stored. An `accompanying` link grants what a guardian link grants today, at any age. (Rui, 09-11-2026)
3. **An adult is a student at or above `age_of_majority` with no live `accompanying` link** (and, below that age, no student is an adult). `student_is_adult_path` says it, and stays the one definition. A student with no birth date is still not on the adult path, and a declared date still does not count (unchanged).
4. **After 18 a former parent keeps the payer role only** (Rui, 09-11-2026): if they were the payer (`invoice_payer_membership_id`), they stay the payer, and they see that student's fees on *Pagamentos* and the documents on *Extratos*. They do **not** see lessons, progress, documents, health, messages, *Vou / Não vou* or the student in their child filter. They cannot answer for them.
5. **Nobody is their own guardian.** A link whose guardian membership is the student's own membership (`student.membership_id`) is refused by the database, on insert and on update, in words (`guardian_is_self`).
6. The kind is never inferred from `relationship` text ("Pai", "Mãe"): it is its own column, set by the office (POOLSE-207). Until then every new link is `parental`.

### Dev notes

- **Migration** (`write-migration` skill): enum `guardian_link_kind ('parental','accompanying')`, column `guardian_link.kind guardian_link_kind NOT NULL DEFAULT 'parental'`. Trigger `guardian_link_not_self` (BEFORE INSERT OR UPDATE) comparing `guardian_membership_id` with the student's `membership_id`; it cannot be a CHECK because it reads another row.
- **One SQL function for "this link grants guardian rights now"**: `guardian_link_grants(link guardian_link) RETURNS boolean` (STABLE: it reads `club_today()`), true when live and (`kind = 'accompanying'` or the student is below majority, or has no birth date, or only a declared one). Or a view `guardian_access` of the granting links. Pick one, and say why in the migration header.
- **Move every reader onto it, except the payer.** Live today: 17 API files (`app-passes`, `payer-invoices`, `lesson-plans`, `feedback`, `files`, `app-requests`, `avisos`, `passes`, `sensitive.controller`, `sensitive`, `staff`, `documents`, `family-invitations`, `family-submissions`, `import`, `redemption`, `students`) and 12 functions (`accept_invitation`, `app_user_birth_date_fill`, `apply_retention`, `family_may_answer`, `invoice_payer_membership_id`, `level_change_recipients`, `membership_birth_date_fill`, `merge_memberships`, `message_recipients_all`, `pass_family`, `student_birth_date_fill`, `student_is_adult_path`). Each one gets a decision written in the PR description: **grants** (moves to the rule), **payer** (keeps all live links: `invoice_payer_membership_id`, the payer reads of POOLSE-201, the fee read for the payer), or **history** (keeps all links: `apply_retention`, `merge_memberships`).
- **The payer's fee read** (rule 4): `/app/fees` lists children through `familyStudents`. A former parent who is the payer must still see that student's fees there, and nothing else of them. Add the student to the fee read by payer, not to `familyStudents`.
- **The trap**: `pass_family` and `family_may_answer` are the ones a reader forgets. A 19-year-old must not check in on a parent's family pack, and the parent must not answer *Vou / Não vou* for them.
- Seed: `seed.ts` must not create a parental link to an adult. Fix the generator that gave Afonso a "Pai".
- Docs in the same commit: `docs/data-model.md` (adult path section), `docs/conventions/students-and-families.md` (the "An adult is the absence of a guardian edge" paragraph, now "of an acompanhante's edge"), and that `CLAUDE.md` line.

### QA

1. Given a student born exactly 18 years ago today with a `parental` link, then `student_is_adult_path` is true today and false yesterday (fixed `club_today()`).
2. Given a 30-year-old with an `accompanying` link, then they are on the guardian path, and the acompanhante answers *Vou / Não vou* for them.
3. Given a 19-year-old whose mother is the payer through a `parental` link, when the mother opens the app, then *Pagamentos* lists the son's fees and *Extratos* his documents; *Início*, *Aulas*, *Progressos* and *Documentos* do not show him; `GET /app/lessons/:id` for his lesson answers 404 to her; she cannot post a notice for him (403).
4. Given the same mother, when she checks in at reception with a family pack, then the son is not on the pack (`pass_family`).
5. Given a 16-year-old with a `parental` link, then nothing changes from today (snapshot of the family app reads for the E2E family).
6. When an insert links a student to their own membership as guardian, then it is refused (`guardian_is_self`); same on an update that makes it so.
7. Cross-tenant: a link in club A never grants anything in club B (the existing isolation test, plus `guardian_link_grants` called on B's student from A's session returns nothing).
8. Given a 17-year-old with no birth date confirmed (declared only), then the parental link still grants (missing or declared data never makes an adult).

### Acceptance criteria

- [ ] `guardian_link.kind` exists, all current links are `parental`, the self-guardian trigger refuses in words.
- [ ] One function or view decides "grants now"; `student_is_adult_path` reads it.
- [ ] Every one of the 17 API files and 12 functions is listed with its decision (grants / payer / history), and moved accordingly.
- [ ] A former parent who pays sees fees and *Extratos* for the adult and nothing else of them.
- [ ] QA 1–8 are tests (SQL for 1, 2, 6, 8; integration for 3, 4, 7; the e2e family snapshot for 5).
- [ ] Data model, the students-and-families convention and its `CLAUDE.md` line say the new definition.

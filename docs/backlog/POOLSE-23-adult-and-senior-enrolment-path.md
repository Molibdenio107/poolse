# POOLSE-23 · Adult and senior enrolment path

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Enrolment · **Priority:** Medium
**Borrowed from:** nobody — none of the five lesson platforms models an adult programme as anything other than a children's path with the guardian fields left blank.

### PO — why this exists

An adult signing up for hidroginástica should not be walked through a form built for somebody else's child, with guardian copy greyed out and a consent form addressed to a parent. Adult and senior participants are a real programme at Poolse, not an edge case of the children's path. They benefit directly, and the office stops explaining why the form asks who the child is. Medium priority because most of it falls out of the Person model once POOLSE-17 lands.

**Not in scope:** the pricing engine itself — this ticket only requires that a fee category can be expressed; medical record-keeping beyond a notes field; whether adult students get app logins (open at doc level).

### BA — rules and data

- An adult participant is a Person with **no inbound guardian edge** (POOLSE-17 AC 3). There is no adult flag; the absence of the edge is the definition, combined with age ≥ maioridade (POOLSE-22).
- The enrolment flow branches on that: no guardian block, no guardian-consent copy, no "which child are you enrolling?" step. Branch on the data, not on a checkbox the user ticks.
- Adults self-sign consent and terms; the form presented is the one POOLSE-22 AC 3 selects.
- Adult and senior student records carry **health and mobility notes** (free text, per-student, not per-enrolment) and an **emergency contact**. The emergency contact is either a Person link or free text and is explicitly not a guardian — it grants no role, no login, no access to the student's record, and does not appear in guardian lists.
- A fee category is expressible on the turma or on the enrolment; the enrolment-level value wins where both exist. It is a category reference, not a discount percentage computed in the UI.
- Senior levels sit in the same level ordering as everything else (POOLSE-05, POOLSE-16), so POOLSE-19's "next level" logic works across them without a parallel branch.
- A Person who is both an adult student and an encarregado de educação has one record, one profile, with their enrolments and their guardianship as separate sections (POOLSE-17 AC 6, POOLSE-35 AC 6). They appear once in Alunos with both badges.
- Communications routing: for a student at or above maioridade with no guardian edge, messages go to the student. Where a person is both an adult student and an EE, the two audiences are distinct — a message to guardians must not reach them in their student capacity and vice versa.
- Health and mobility notes are sensitive. Visibility should be restricted, and the source doc does not say to whom. **Open:** which roles may read health and mobility notes — Owner/Admin only, or the assigned Instructor too? An instructor running a senior class arguably needs to know about a mobility limitation.
- **Open (doc-level, POOLSE-17):** whether adult students get app accounts in v1 or only guardians do. This ticket's AC 7 assumes an adult student is reachable directly, which is satisfiable by email even without an app login.

### Dev — implementation notes

- Migration: `health_notes` and emergency contact fields (person link nullable + free-text fallback) on the Person or student-role assignment; `fee_category` reference on turma and enrolment. Tenant key throughout.
- The enrolment wizard reads one `enrolmentContext` computed server-side (age in months, maioridade, guardian edges present, consent form to present) rather than deciding the branch in the client from scattered fields.
- Guardian-edge absence is the discriminator everywhere. Do not add an `is_adult` column — it will drift the first time a date of birth is corrected.
- API: consent form selection is returned by the server and validated on submit; a submitted self-signed consent for a Person with a guardian edge and age below maioridade is rejected with `422`.
- Permissions: health and mobility notes need their own server-side read check, distinct from the general student read. Whatever the open question resolves to, enforce it on the endpoint, not by omitting the field from one screen.
- Communications audience resolution belongs in a shared helper that returns recipients for (student, capacity), so guardian-routing and student-routing cannot both fire for a dual-role Person.
- i18n: adult and senior enrolment copy is a distinct string set in pt-PT and en — reusing the child strings with the guardian words removed reads badly in Portuguese. Emergency-contact and health-notes labels included.
- Most likely to be got wrong: routing an adult student's communications to a guardian because the code asks "does this Person have any guardian edges at all?" instead of "does this student, in their student capacity, have an inbound guardian edge?" — a senior who is also an avó guardian has outbound edges and would be misrouted.

### QA — test scenarios

23.1 Given a Person aged 45 with no inbound guardian edge / When they enrol / Then no guardian block, no guardian consent copy and no child-selection step appear anywhere in the flow.
23.2 Given the same Person / When they submit consent / Then the self-signed form is recorded against them.
23.3 Given a 15-year-old / When a request submits self-signed adult consent directly to the API / Then `422` and nothing is recorded.
23.4 Given an adult student with an emergency contact that is a Person link / When that contact logs in / Then they have no access to the student's record and hold no EE role.
23.5 Given a senior student aged 72 / When levels are listed / Then *Hidroginástica Sénior* appears in the shared level ordering, not a separate list.
23.6 Given a Person who is both an adult student and an EE for a grandchild / When Alunos is opened / Then they appear exactly once, with both badges, and one profile with two sections.
23.7 Given that same dual-role Person / When a message is sent to guardians of a turma / Then they receive it only in their EE capacity, and a message to adult students of their own turma reaches them separately.
23.8 Given an Instructor token / When it reads the health and mobility notes endpoint / Then the response matches the decided permission rule and is enforced server-side, not by hiding the field.
23.9 Given a fee category set on both the turma and the enrolment / When the price is resolved / Then the enrolment-level category wins.
23.10 Given the pt-PT locale / When the adult enrolment flow renders / Then the copy is adult-addressed Portuguese, with no leftover guardian phrasing; the same holds in en.
23.11 Given light and dark mode / When the health-notes and emergency-contact sections render / Then both are legible and visually distinct from the guardian block used on the minors' path.
23.12 Given an adult student whose date of birth is corrected to make them a minor / When the record is reopened / Then the guardian block appears and enrolment is blocked until a guardian link exists (POOLSE-04 AC 5), with no data silently discarded.

### Acceptance criteria

1. Enrolling an adult never shows the guardian block, guardian-consent copy, or any "which child are you enrolling?" step.
2. Adult students self-sign consent and terms.
3. Adult/senior student records support **health and mobility notes** and an emergency contact — the emergency contact is a Person link or free text, and is explicitly *not* a guardian.
4. Concession/senior pricing is expressible as a fee category on the turma or the enrolment.
5. Senior levels (e.g. *Hidroginástica Sénior*, 60–100 per POOLSE-16) appear in the same level ordering, not a separate parallel system.
6. A Person who is both an adult student and an encarregado de educação sees both, as sections of one profile (POOLSE-17), with no duplicate record.
7. Communications to adult students go to the student, never routed to a guardian.

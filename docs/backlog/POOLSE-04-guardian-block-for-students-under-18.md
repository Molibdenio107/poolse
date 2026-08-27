# POOLSE-04 · Guardian block for students under 18

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students · **Priority:** High
**Depends on:** POOLSE-17 (one Person, many roles)

> **Revised 27 Aug** — supersedes the earlier "free-text fields on the student record" version.
> Depends on **POOLSE-17** (one Person, many roles).

### PO — why this exists
A minor cannot be enrolled without a responsible adult, yet the record has nowhere to say who that adult is, so the office keeps contact details in heads and spreadsheets. Storing the guardian as free text would have created a second copy of a human who is often already in the system — a second phone number to keep in sync, a second address to update. Admins doing enrolments and anyone who has to reach a family in a hurry benefit; High because it blocks correct enrolment of minors and gets more expensive with every record entered before it lands.
**Not in scope:** inviting the guardian to create a login (POOLSE-01's flow), consent and waiver forms (POOLSE-22), and routing billing to the guardian (POOLSE-24).

### BA — rules and data
- Entities: `Person` (POOLSE-17) and `GuardianLink(tenant, student_person_id, guardian_person_id, relationship, is_primary, created_at)`.
- Relationship type lives on the link, never on the Person, so the same human can be avó to one student and tutor legal to another.
- Exactly one guardian per student may be `is_primary`; a minor requires at least one link, an adult may have zero or more.
- Guardian contact data is read-only in this block and edited only on the guardian's own Person page — one source of truth for phone, email, NIF and address.
- Turning 18 collapses the block and makes the link optional; nothing is deleted, and the guardian's Person page keeps listing that student.
- The 18-year boundary is hardcoded here but POOLSE-22 makes `maioridade` a per-tenant integer. Conflict: build the boundary as one shared function reading a single value now, so POOLSE-22 is a value swap rather than a rewrite of this block.
- A guardian's own Person page lists every student they are responsible for — one guardian to many students (POOLSE-35 AC5).
- Self-links must be rejected: a Person cannot be their own encarregado de educação.
- The relationship list in AC2 reads *mãe, pai, avó, tutor legal, outro* — **Open:** is the omission of *avô* deliberate, or should the enum carry both grandparent forms (and any other gendered pairs)?
- **Open:** may a Person who is themselves a minor be selected as a guardian? Nothing currently blocks it.
- **Open:** what does the block do when date of birth is empty — hide (treating unknown as adult) or show and require a guardian? The show/hide rule in AC1 assumes a known DOB.

### Dev — implementation notes
- Migration: `guardian_links` with a relationship enum, a partial unique index `(tenant, student_person_id) WHERE is_primary`, and composite foreign keys on `(tenant, person_id)` so a link can never cross tenants.
- API: `GET /people?q=` for the search-and-select path; the inline-create path creates the Person and the link inside one transaction, so a failed link never leaves an orphan Person behind.
- Age lives in one shared `ageInMonths(dob, at)` helper reused by POOLSE-06 eligibility, POOLSE-16 and POOLSE-33 brackets; the block's show/hide is a client-side call on the form's current DOB value, but the "minor needs a guardian" rule is enforced server-side on save.
- The "same as student" address toggle copies values into the new Person at creation time; it is not a live binding, or editing the student's address later silently rewrites the guardian's.
- i18n: relationship labels, the address toggle, the empty state and every validation message; keep relationship values as stable enum keys with translated labels, never translated values.
- Theming: render as a distinct `Card`/fieldset using existing surface and border tokens — no new colour, and the visual distinction must survive dark mode without relying on a background tint alone.
- Performance: the guardian's Person page lists their students with a single tenant-scoped join, not one query per link.
- Most likely to be got wrong: re-mounting the block when DOB changes, which wipes the guardian data typed in this session and breaks AC7; keep the block's state outside the conditional render.

### QA — test scenarios
04.1 Given a new student with DOB making them 10, When the form renders, Then the guardian section appears as its own distinct section.
04.2 Given a student aged 25, When the form renders, Then no guardian section appears.
04.3 Given a minor and an existing Person searched and selected, When the form is saved, Then a link is created, the Person gains the Encarregado de Educação role, and their contact data shows read-only.
04.4 Given a minor and the inline-create path, When name, relationship, phone and email are entered and saved, Then one Person and one link are created and no duplicate Person appears in Alunos.
04.5 Given a minor with no guardian, When save is attempted, Then it is rejected with a localised inline error naming the missing guardian.
04.6 Given a minor with no guardian, When the save endpoint is called directly bypassing the UI, Then the API returns a validation error and no student record is persisted.
04.7 Given a student with two guardians, When one is marked primary, Then the other is unmarked and only one primary exists in the database.
04.8 Given a form with guardian data typed and DOB edited from 2010 to 2000 and back, When the block re-appears, Then the previously typed guardian data is still present.
04.9 Given a student who turns 18 overnight, When their record is opened the next day, Then the guardian link still exists, the block is collapsed and optional, and nothing was deleted.
04.10 Given a guardian who is avó to student A and tutor legal to student B, When each student is opened, Then each shows its own relationship value and the Person record shows one phone number.
04.11 Given a guardian's Person page, When it loads, Then all students they are responsible for are listed, and a student added afterwards appears without an edit to the guardian.
04.12 Given pt-PT then en, and light then dark mode, When the block renders, Then relationship labels and validation messages are translated and the section boundary is visible in both themes.

### Acceptance criteria

1. Age is computed from date of birth; the block appears automatically when age < 18 and is hidden when ≥ 18.
2. The block lets the user **search and select an existing Person**, or **create a new one inline** (name, relationship to student, phone, email, NIF optional, address optional with a "same as student" toggle).
3. Selecting an existing Person grants them the *Encarregado de Educação* role for this student; their contact data is shown read-only, edited on their own Person page.
4. Relationship to the student (mãe, pai, avó, tutor legal, outro) is stored on the **link**, not on the Person — the same person can be a grandmother to one student and a legal guardian to another.
5. A minor cannot be saved without at least one guardian link; more than one guardian per student is supported, with one marked primary contact.
6. The block appears as its own visually distinct section, consistent with the rest of the form.
7. Toggling the date of birth across the 18-year boundary shows/hides the block live, without losing entered data in the session.
8. When a student turns 18 the guardian link is **retained** but the block collapses and becomes optional — nothing is deleted.
9. From the guardian's own Person page, the students they are responsible for are listed.

**Out of scope:** inviting the guardian to create a login from this block — that is POOLSE-01's invite flow.

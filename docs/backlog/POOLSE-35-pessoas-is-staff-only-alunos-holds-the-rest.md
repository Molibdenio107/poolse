# POOLSE-35 · Pessoas is staff only; Alunos holds the rest

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Navigation / People · **Priority:** High
**Depends on:** POOLSE-17 (one Person, many roles), POOLSE-18 (role badges, amended for two sections)

### PO — why this exists

Pessoas today mixes staff, students and encarregados de educação into one list, so an Admin looking for an instructor wades through three hundred alunos. Splitting the two views matches how the school actually thinks — staff are one population, families are another — while keeping one underlying record so nobody's phone number lives in two places. High priority because POOLSE-18 and POOLSE-34 are both already written against this split.

**Not in scope:** merging or deduplicating existing duplicate records (POOLSE-17 AC 10 owns the migration), and any change to the guardian-link model itself (POOLSE-04).

### BA — rules and data

- Pessoas and Alunos are two **filtered views over the same Person model** (POOLSE-17). No new record type, no duplicated record, no copy of contact data.
- Pessoas lists Persons holding at least one of Owner, Admin, Instructor, Maintenance. Alunos lists Persons holding Student or Encarregado de Educação.
- A Person holding both a staff role and a student or EE role appears in **both** sections, as one record with one profile. Editing them in either place edits the same Person, and a change made in Alunos is immediately visible in Pessoas.
- Each view's search is scoped to its own set: searching Pessoas never returns a Person whose only roles are Student or EE, and vice versa. A dual-role Person is returned by both, because they legitimately belong to both scopes — the exclusion is by role, not by person.
- An encarregado de educação is reached from the student's record; their own profile lists **all** students they are responsible for. The relation is one guardian to many students.
- An EE may also be a student. They then appear in Alunos with both badges, and their own enrolments and their guardianships are separate sections of one profile — not two records and not one merged list.
- Role badges follow POOLSE-18: staff badges render in Pessoas, Student and EE badges in Alunos, from the same token set.
- Rule that needs reconciling: POOLSE-17 AC 4 says "The People list shows every Person once, with all their role badges". Under this ticket there is no single People list, and a dual-role Person shows staff badges in one view and Student/EE badges in the other. POOLSE-18's 27 Aug amendment already records this; POOLSE-17 AC 4 should be read as "once per view", not "once in the app".
- **Open:** which badges a dual-role Person shows in each view — only the roles in that view's scope (implied by POOLSE-18's amendment), or all their roles with the out-of-scope ones muted. The two readings produce visibly different rows.
- **Open:** which roles may see which view. Pessoas listing staff is plainly not for a Student to read, but the doc states no permission rule for either section.
- Edge cases with decided answers: a Person whose only roles are removed appears in neither view but is not deleted (POOLSE-17 AC 7); adding a Student role to an existing instructor makes them appear in Alunos with no new record; counts shown on each view count Persons in that scope, so a dual-role Person is counted in both totals.

### Dev — implementation notes

- No new tables. Both views are queries over `person` joined to its role assignments, filtered by role set and tenant key. Resist a `person_type` column — it reintroduces the duplication POOLSE-17 exists to remove.
- The role filter is an `EXISTS` over role assignments, not a join that multiplies rows: a Person with three roles must appear once per view, and a naive join breaks both the row count and POOLSE-29's `total`.
- Index the role-assignment table on (tenant key, role, person id) — every page load of both views filters on exactly that.
- API surface: either one `GET /people?scope=staff|students` or two endpoints. Either way the scope is enforced server-side; a client-supplied role filter must not be able to widen the set. The detail endpoint is shared — one Person, one profile payload, reached from both views.
- Permission enforcement: the scope filter and the caller's own permission filter are two separate predicates and both must be applied. Do not let "the caller may see Pessoas" stand in for "this row belongs in the Pessoas scope".
- Search (POOLSE-30) must apply the scope predicate inside the same query as the search predicate; a search that bypasses the scope filter is the most likely way students leak into Pessoas.
- i18n: section names, empty states for each view, badge labels, and the guardian-to-students section heading. "Encarregado de educação" and "Alunos" are product vocabulary and stay Portuguese in the pt-PT locale as keys.
- Theming: two badge families rendered by the same component; verify the staff palette and the Student/EE palette are both contrast-checked in light and dark and stay clear of the attendance colours (POOLSE-13).
- Most likely to be got wrong: the dual-role Person. It is easy to write the filter as "not a student" instead of "has a staff role", which correctly hides pure students and incorrectly hides the instructor who is also a student.

### QA — test scenarios

- **35.1** Given a tenant with staff, students and guardians / When Pessoas loads / Then only Owner, Admin, Instructor and Maintenance appear, and no student or encarregado de educação is listed.
- **35.2** Given the same tenant / When Alunos loads / Then students and encarregados de educação appear, and no staff-only Person is listed.
- **35.3** Given an instructor who is also enrolled as an adult student / When both views load / Then they appear in both, as one record, and opening them from either lands on the same profile.
- **35.4** Given that dual-role Person / When their phone number is edited from Alunos / Then the change is immediately visible on their row and profile in Pessoas — one record, not two.
- **35.5** Given a search for a student's name in Pessoas, issued directly against the API / When it runs / Then no student or EE is returned, regardless of the UI.
- **35.6** Given a search for an instructor's name in Alunos / When it runs / Then they are not returned, unless they also hold a Student or EE role.
- **35.7** Given an encarregado de educação responsible for three students / When their profile opens / Then all three are listed, and each student's record links back to that same guardian.
- **35.8** Given an EE who is also a student / When their profile opens / Then their own enrolments and their guardianships appear as separate sections, both badges show in Alunos, and there is exactly one record for them.
- **35.9** Given a Person whose last remaining role is removed / When both views load / Then they appear in neither, and their record still exists and is retrievable.
- **35.10** Given a caller crafting a request with a role filter naming a staff role against the Alunos scope / When the request is made / Then the server-side scope wins and no staff-only Person is returned.
- **35.11** Given each view with more than fifteen rows / When paginated (POOLSE-29) / Then the total counts Persons once per view — a dual-role Person counts in both totals and appears exactly once on one page of each.
- **35.12** Given locale pt-PT and en / When both views, their empty states and the badges render / Then all strings come from the i18n layer, with "Encarregado de Educação" rendered correctly in full and abbreviated forms.
- **35.13** Given light and dark mode / When a Person shows several badges / Then every badge is legible, carries its role name as text, and does not read as an attendance state.
- **35.14** Given a Person who is granted a Student role while an admin has Pessoas open / When the admin refreshes / Then the Person remains in Pessoas (they still hold a staff role) and now also appears in Alunos.

### Acceptance criteria

1. **Pessoas** lists only Owner, Admin, Instructor and Maintenance. No students, no encarregados de educação.
2. **Alunos** holds students and their encarregados de educação.
3. Both are **filtered views over the same Person model** (POOLSE-17) — not separate record types, and never a duplicated record for someone who appears in both.
4. A **Person holding both a staff role and a student role appears in both sections**, as one record with one profile; editing them in either place edits the same Person.
5. An encarregado de educação is reached from the student's record, and their own profile lists **all students they are responsible for** — the relation is **one guardian to many students**.
6. An encarregado de educação **may also be a student**; they then appear in Alunos with both badges, and their own enrolments and their guardianship are separate sections of one profile.
7. Searching in Pessoas never returns students or guardians, and vice versa — each view searches its own scope.
8. Role badges follow POOLSE-18: staff roles in Pessoas, Student and EE badges in Alunos.

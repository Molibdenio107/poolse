# POOLSE-33 · Age-bracket icon on the avatar

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Students · **Priority:** Low
**Depends on:** POOLSE-06 and POOLSE-16 (shared age boundary logic), POOLSE-17 (date of birth on the Person)

### PO — why this exists

Scanning a turma roster, an instructor cannot tell a bebé from a jovem without opening each record, and a class that mixes brackets is a safety-relevant thing to notice at a glance. A small badge on the avatar gives that for free wherever a photo already appears. Low priority: it is a convenience over information already on screen elsewhere, and nothing is wrong today.

**Not in scope:** filtering or reporting by bracket, tenant-configurable bracket boundaries, and any use of the bracket in eligibility rules — eligibility stays on min/max age (POOLSE-06, POOLSE-16).

### BA — rules and data

- Five brackets derived from date of birth: **Bebé** 0–3, **Criança** 4–11, **Jovem** 12–17, **Adulto** 18–59, **Sénior** 60+. Boundaries are inclusive as written; a person aged exactly 4 is Criança, exactly 18 is Adulto, exactly 60 is Sénior.
- The bracket is computed from date of birth at render time and never stored, so a record cannot go stale as the person ages.
- Boundaries live in one shared definition, shared with the minimum/maximum-age logic of POOLSE-06 and POOLSE-16, so the two cannot drift.
- Each bracket has its own icon **and** colour token. The badge sits bottom-right on the circular avatar, with a ring or border so it stays legible over any photograph.
- The badge carries a tooltip and an `aria-label` naming the bracket in words. Colour and shape never carry the meaning alone.
- No date of birth means no badge at all — not an "unknown" badge, not a neutral placeholder.
- Below a defined minimum avatar size the badge is suppressed entirely rather than shrunk into illegibility. **Open:** the exact pixel threshold and which avatar sizes fall below it — the doc mandates the rule but names no number.
- POOLSE-06 stores minimum age in months to express ages under one year. The bracket scale is in whole years, so a 6-month-old and a 3-year-old share the Bébé badge; this is intended, not a gap.
- The palette must stay clear of the attendance colours (POOLSE-13) and the role colours (POOLSE-18), which already claim red, orange and the six role tokens.
- **Open:** whether the badge appears on staff and encarregado avatars too or only on students. The ticket's area is Students, but avatars are shared components used in Pessoas.

### Dev — implementation notes

- No schema change. Date of birth already exists on the Person (POOLSE-17); if any surface renders an avatar without fetching date of birth, that field must be added to its payload — otherwise the badge silently never appears there.
- Age computation must use civil dates in Europe/Lisbon, not a UTC timestamp difference. Someone born on 29 February needs a decided birthday rule in non-leap years (28 February is the conventional choice) so they do not age a day late.
- Put the bracket logic in the same shared age module as POOLSE-06/16 — a `brackets` constant plus `bracketFor(dateOfBirth, at = today)`. Passing the reference date in makes it testable and stops `new Date()` appearing inside a render.
- The badge belongs inside the shared `<Avatar>` component as an optional slot, so every existing avatar call site gains it without edits and the size-suppression rule is enforced in one place.
- Permission enforcement: date of birth is personal data. Any role that can see the avatar but not the date of birth must not receive a bracket — the bracket is a low-resolution disclosure of the DOB, so gate the field server-side rather than computing it client-side from data that should not have been sent.
- i18n: five bracket names plus the tooltip pattern, in pt-PT and en. The Portuguese names are the product vocabulary (Bebé, Criança, Jovem, Adulto, Sénior) and are the keys, not the strings.
- Theming: five colour tokens defined in both modes, checked against the avatar ring and against arbitrary photo backgrounds — the ring is what makes the badge survive a dark photo in light mode and vice versa.
- Performance: brackets are computed per avatar; on a 15-row roster with the shared component that is trivial, but memoise per person id rather than recomputing on every re-render of a hovering list.
- Most likely to be got wrong: the boundary arithmetic. "18–59" must be evaluated as completed years at today's date, not as a year subtraction — a person whose 18th birthday is tomorrow is still Jovem.

### QA — test scenarios

- **33.1** Given a student with date of birth making them 7 today / When their avatar renders / Then a Criança badge sits bottom-right on the circle, with a ring, over their photo.
- **33.2** Given students aged exactly 3, 4, 11, 12, 17, 18, 59 and 60 today / When each avatar renders / Then the brackets read Bebé, Criança, Criança, Jovem, Jovem, Adulto, Adulto, Sénior respectively.
- **33.3** Given a student whose 18th birthday is tomorrow / When the avatar renders / Then the badge reads Jovem, and given it is their birthday today / Then it reads Adulto.
- **33.4** Given a person with no date of birth / When the avatar renders / Then no badge appears at all — not a neutral or "unknown" badge.
- **33.5** Given the smallest avatar size used in a turma roster / When it renders / Then the badge is suppressed entirely rather than rendered illegibly; and at every larger size it renders correctly.
- **33.6** Given a keyboard user focusing the badge and a screen-reader user / When it is reached / Then the bracket name is announced in words via the `aria-label`, and hovering shows the same as a tooltip.
- **33.7** Given locale pt-PT and then en / When the tooltip renders / Then it reads "Sénior" and "Senior" from the i18n layer, with no hardcoded string.
- **33.8** Given light and dark mode, over a white photo and a black photo / When each of the five badges renders / Then all five remain distinguishable from each other, from the attendance colours and from the role colours, and the ring keeps the badge legible in every combination.
- **33.9** Given a student born on 29 February / When their avatar renders in a non-leap year on 28 February and again on 1 March / Then the computed age follows the decided rule consistently and never jumps twice.
- **33.10** Given the minimum-age setting on a level is 6 months (POOLSE-06) / When a 6-month-old student's avatar renders / Then the badge reads Bebé, and the bracket boundaries come from the same shared module as the level's age validation.
- **33.11** Given a role that may see a person's avatar but not their date of birth / When the list payload is inspected directly / Then it carries neither the date of birth nor a derived bracket.
- **33.12** Given a page rendering fifteen avatars (POOLSE-29) / When the list re-renders on hover or filter change / Then no visible recomputation flicker occurs and each badge is stable.

### Acceptance criteria

1. Five brackets, derived from date of birth: **Bebé** (0–3), **Criança** (4–11), **Jovem** (12–17), **Adulto** (18–59), **Sénior** (60+).
2. Each bracket has its own icon and colour token; the badge sits bottom-right on the avatar circle, with a ring/border so it stays legible over any photo.
3. The badge has a tooltip and an `aria-label` naming the bracket — never colour or shape alone.
4. Brackets are recomputed from date of birth, never stored, so nobody ages incorrectly in the database.
5. No date of birth → no badge (not a "unknown" badge).
6. Renders correctly at every avatar size used in the app, including the small size in turma rosters; below a minimum avatar size the badge is suppressed rather than shrunk into illegibility.
7. Bracket boundaries are defined in one place, shared with the minimum/maximum-age logic (POOLSE-06, POOLSE-16) so they cannot drift apart.

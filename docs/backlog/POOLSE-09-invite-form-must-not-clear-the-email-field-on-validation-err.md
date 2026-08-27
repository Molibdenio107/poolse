# POOLSE-09 · Invite form must not clear the email field on validation error

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Backoffice / Invitations · **Priority:** High
**Depends on:** POOLSE-01 (the same dialog gains a role-permission denial path)

### PO — why this exists
A mistyped email or a forgotten role wipes the address the user just typed, so the correction they were about to make becomes a retype from memory — and the misspelling they need to see is gone. Owners, Admins and Instructors hit this on the tenant's main onboarding path. High because it is a defect on an everyday flow and the fix is small.
**Not in scope:** redesigning the invite dialog, building bulk invite (AC5 governs its behaviour only if it already exists), and the role matrix itself (POOLSE-01).

### BA — rules and data
- On any validation failure the typed email is preserved **verbatim**, including the misspelling and any stray whitespace the user can see, so it can be corrected in place.
- Field-level inline errors are required for both cases named in the bug: invalid email format, and role not selected.
- Focus moves to the first field in visual order that carries an error.
- The field is cleared only after a successful invitation.
- Validation fires on submit and on blur — not on every keystroke, which would flag a half-typed address as invalid.
- If bulk invite exists, the same rule applies per entry: valid entries and invalid entries are distinguishable and the invalid text survives.
- **Open:** in a partial bulk success — 3 of 5 invitations issued — are the successful entries cleared and the failures kept, or is the whole input retained?
- **Open:** do server-side failures count as "validation failure" for AC1? A `403` from POOLSE-01, a duplicate pending invitation, or an email that already belongs to a member all clear the field today. The user-visible defect is identical, so the rule should be "any non-success response preserves the input" — confirm.

### Dev — implementation notes
- The likely root cause is an unconditional `reset()` in the mutation handler (or `onSettled`, which fires on error too) rather than in `onSuccess`; check that before rewriting the form.
- A changing `key` on the dialog or the form that re-mounts on state change produces the same symptom — rule it out, since the fix differs.
- Errors live in form state and render inline; a toast-only error path cannot satisfy AC2 or AC3.
- Focus management: set focus on the first errored field and wire `aria-describedby` from the input to its message, so the error is announced rather than only seen.
- i18n: validation messages are keys with the field name interpolated. Zod schemas must carry message keys, not English literals, or the pt-PT dialog shows English errors.
- Error styling is border + icon + text; colour never carries the meaning alone, and both variants need contrast checking in dark mode.
- The dialog almost certainly shares a form wrapper with other dialogs, so check whether the same reset bug is present there before closing — the sibling-widget lesson from POOLSE-10.
- Most likely to be got wrong: fixing the client-side validation path and leaving the server-error path resetting the form, which is the case a user hits when POOLSE-01's `403` lands.

### QA — test scenarios
09.1 Given the invite dialog, When `maria@exemplo` is submitted with a role selected, Then the input still contains `maria@exemplo` and an inline format error is shown.
09.2 Given a valid email and no role selected, When submit is pressed, Then the email is preserved and an inline "role required" error is shown on the role field.
09.3 Given both fields invalid, When submit is pressed, Then focus lands on the email field, the first in visual order.
09.4 Given only the role missing, When submit is pressed, Then focus lands on the role control.
09.5 Given a valid email and role, When the invitation succeeds, Then the email field is cleared.
09.6 Given an Admin submitting `role: Owner` and the API returning `403` (POOLSE-01), When the response arrives, Then the typed email is still present and a localised error explains the denial.
09.7 Given an email already invited, When submit returns a duplicate error, Then the typed email is preserved.
09.8 Given an email pasted with a trailing space, When submit fails validation, Then the input still shows exactly what was pasted, trailing space included.
09.9 Given submit pressed twice rapidly with a valid payload, When both requests settle, Then one invitation exists and the field is cleared once.
09.10 Given bulk invite with three valid and two malformed addresses, When submit is pressed, Then the malformed entries remain visible and individually flagged.
09.11 Given pt-PT and then en, When each validation error fires, Then the message renders translated with no English fallback.
09.12 Given dark mode, When an error state renders, Then the field border, icon and message all pass contrast and the error is identifiable without colour.

### Acceptance criteria

1. On any validation failure the typed email is preserved verbatim (including a misspelling, so it can be corrected).
2. Inline field-level errors: invalid email format; role not selected.
3. Focus moves to the first field with an error.
4. The field is cleared **only** after a successful invitation.
5. Same behaviour when several emails are entered at once, if bulk invite exists.

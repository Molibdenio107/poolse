# Backlog conventions

Standing rules for every ticket in `docs/backlog/`. They are **not** repeated in each ticket — treat
them as acceptance criteria on all work, and as the first thing to check in a QA pass.

- **Server-side enforcement.** Every permission rule is enforced in the API. Hiding a control is a UX detail, never the control. Every ticket that touches permissions gets at least one denial test issued directly against the endpoint.
- **Tenant scoping.** Every tenant table carries the tenant key and every query is scoped. Any new endpoint gets a cross-tenant access test.
- **i18n.** Every user-facing string goes through the translation layer (pt-PT + en) as it is written. No string is assembled by concatenation; plurals, dates and currency come from the locale.
- **Light and dark.** Every visual change is checked in both themes and contrast-verified. Colour never carries meaning alone — always paired with text, icon or shape.
- **Design tokens.** Four colour systems exist and must stay visually distinct from one another:
  - attendance states — POOLSE-13
  - role badges — POOLSE-18
  - age brackets — POOLSE-33
  - certification status — POOLSE-27
- **Audit.** Anything destructive, permission-sensitive or GDPR-relevant records actor, subject and timestamp.
- **Soft delete.** History is never destroyed. Removals hide; they do not erase.
- **Excel import parity.** Any field added to a form is considered for the import/export mapping in the same ticket, not later.

## Definition of done

A ticket is done when all of the following are true:

1. Every numbered acceptance criterion in the ticket is met.
2. The QA scenarios in the ticket pass, including the negative and permission ones.
3. The conventions above hold for the code touched.
4. Any `**Open:**` question in the ticket is either answered in the ticket or explicitly deferred with a note saying so.
5. Strings exist in both pt-PT and en.
6. The change was looked at in light and dark mode, if it is visual.

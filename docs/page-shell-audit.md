# Page shell audit — POOLSE-41 AC7

Every page in the app, and whether it is on the shared shell. The ticket asks for
this list because "a page left on its own layout is the failure mode" — a shell
that most pages use is a shell that has already started drifting back.

**This list is not maintained by hand.** `pnpm layout:check` walks the same
directories and fails the build if a page under `(app)` stops using `PageShell`
or sets its own outer padding. The table below is the state at the time of the
migration; the script is what keeps it true.

## Before

Five different content widths were in use across 26 pages, plus three vertical
rhythms:

| Width | Pages |
|---|---|
| `max-w-xl` | 1 |
| `max-w-2xl` | 3 |
| `max-w-3xl` | 15 |
| `max-w-4xl` | 2 |
| `max-w-6xl` | 5 |

Each was defensible on its own page. Together they are why moving between two
screens felt like moving between two applications.

## After

All 26 are full width with identical padding, header height and section spacing,
and none sets its own outer layout.

| Page | Status |
|---|---|
| `dashboard/page.tsx` | On the shell |
| `dashboard/calendar/page.tsx` | On the shell |
| `dashboard/calendar/closures/page.tsx` | On the shell |
| `dashboard/calendar/sessions/[sessionId]/page.tsx` | On the shell |
| `dashboard/classes/page.tsx` | On the shell — header actions |
| `dashboard/classes/new/page.tsx` | On the shell |
| `dashboard/classes/seasons/page.tsx` | On the shell |
| `dashboard/classes/[id]/page.tsx` | On the shell — header actions |
| `dashboard/classes/[id]/skills/page.tsx` | On the shell |
| `dashboard/facilities/page.tsx` | On the shell |
| `dashboard/facilities/new/page.tsx` | On the shell |
| `dashboard/facilities/[facilityId]/page.tsx` | On the shell |
| `dashboard/facilities/pools/new/page.tsx` | On the shell |
| `dashboard/facilities/pools/[poolId]/page.tsx` | On the shell |
| `dashboard/people/page.tsx` | On the shell — header actions |
| `dashboard/people/duplicates/page.tsx` | On the shell |
| `dashboard/people/vacations/page.tsx` | On the shell |
| `dashboard/profile/page.tsx` | On the shell |
| `dashboard/students/page.tsx` | On the shell |
| `dashboard/students/guardians/page.tsx` | On the shell |
| `dashboard/students/levels/page.tsx` | On the shell |
| `dashboard/students/new/page.tsx` | On the shell |
| `dashboard/students/[id]/page.tsx` | On the shell |
| `dashboard/students/[id]/progress/page.tsx` | On the shell |
| `dashboard/students/[id]/sensitive/page.tsx` | On the shell |
| `join/page.tsx` | On the shell |

## Deliberately outside the shell

Listed in the check script rather than pattern-matched, so adding to this set is
a decision somebody makes rather than something that happens quietly.

| Page | Why |
|---|---|
| `sign-in/[[...sign-in]]` | Clerk's own centred card; there is no page header to share |
| `sign-up/[[...sign-up]]` | The same |
| `(marketing)` and `(marketing-en)` | A different product surface with its own layout and its own rhythm |

## What the shell owns

- Outer padding, vertical rhythm and full width — `px-page`, `py-page-y`,
  `gap-page-gap`, all Tailwind theme tokens so a change is one edit.
- The header: title, optional subtitle, optional back link, optional actions
  slot, at a fixed `min-h-page-header` so a page with actions and one without are
  the same height.
- `PageError` and `PageEmpty`, so a failed or empty page keeps the same spacing
  as a populated one and nothing shifts when data arrives.
- `ScrollX`, for wide content that must scroll inside itself rather than making
  the page scroll sideways.

## Known gap

The title clamps to two lines rather than truncating with an ellipsis. 41.10 asks
for "wraps or truncates predictably without changing the header height", and
clamping satisfies that — but a very long translated title is cut without a
visual cue that it was cut. Worth revisiting if a real page title ever gets long
enough to hit it; none currently does.

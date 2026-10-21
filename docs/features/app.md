# App mode — a home per role (POOLSE-90)

The people who come to the pool, rather than run it, get a home built around one question. App
mode is a second front door inside the same Next.js app, installed as the same PWA (`start_url`
is `/app`). The backoffice stays for owners and admins, and staff can still reach it.

## Who lands where

`/app` decides by the reader's roles in the active club, through `lib/app-hats.ts` (one
definition, also read by the switcher and the dashboard's redirect):

| Who | Lands on |
|---|---|
| Owner or admin | `/dashboard`, the backoffice |
| Guardian or student | `/app/familia`, the family agenda |
| Instructor or maintenance | the backoffice until their homes are built (slices 2 and 3) |
| Several homes | the one last used on this device (`localStorage`, best effort) |

A reader who is only a family and opens `/dashboard` is sent to `/app`. Staff who are also
parents keep the backoffice and see *Abrir o backoffice* in app mode.

The mobile palette (pool blue, soft orange) lives in its own tokens (`--app-*` in globals.css),
checked by `contrast:check`. Inside `data-surface="app"` the shared tokens point at it, and the
desktop palette is not touched.

## The family agenda (`/app/familia`)

`GET /app/agenda` (guardian or student; `?child=` narrows, and another family's child is a 404).

- Every child the reader is a live guardian of, or the reader themselves, in one list by day, each
  entry naming its child. **Coming lessons only**, from now to two weeks ahead (Rui, 21-10-2026).
- Each entry is a `class_session`, never the pattern. "Their lesson" is a session of a turma the
  child was enrolled in on that day, the predicate `familyMayReadPlan` uses.
- States in words with an icon:
  - *Cancelada*, with the reason.
  - *Encerrado*, read from the session's own `closure_id`, which `apply_closures` stamped through
    `session_reach`; never re-derived by pool.
  - *Mudou só esta semana*, shown where the week lands.
- **Water**: the tank's latest temperature with its age (*medida há 4 dias*). None when water
  quality is off, and the API carries none.
- **Fees**: one line per child from `balance` on the fee read. *Em dívida* when something is
  overdue, *Por pagar … até* before its date, *Em dia* when nothing is owed. It links to the
  child's fee page.

## The lesson's page (`/app/familia/aulas/:sessionId`)

`GET /app/lessons/:sessionId` for the entry, plus the plan through the existing
`GET /sessions/:id/plan`, which already admits a family only for its own child's lesson. A lesson
that is not the reader's, or is already over, is a 404. *Vou / Não vou* arrives in slice 2.

## Not yet

These are slices 2 to 5 of POOLSE-90:

- *Vou / Não vou*. A student aged 12 or more with their own login may answer; under 12, a
  guardian answers (Rui, 21-10-2026).
- The instructor home.
- The maintenance home.
- Web push.
- The real-device passes.

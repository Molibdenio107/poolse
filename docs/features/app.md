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
- **Últimas aulas** (POOLSE-116, `recent` on the agenda): the lessons each child was enrolled in
  and marked *present* at inside the feedback window, newest first, each with its mood (face and
  word), or *Dar feedback* when the reader answers for that child. A missed lesson and a reposição
  (no enrolment, so the lesson page would not open) are not listed. The strip is absent when empty.
- **The window counts from the day the lesson happened** (`lesson_feedback_closes_on()`, on the
  site's clock), never from `occurs_on`, which a one-week move does not change.

## The lesson's page (`/app/familia/aulas/:sessionId`)

`GET /app/lessons/:sessionId` for the entry, plus the plan through the existing
`GET /sessions/:id/plan`, which already admits a family only for its own child's lesson. A lesson
that is not the reader's is a 404. A lesson already over opens **inside the feedback window**
(the lesson's day plus `lesson_feedback_window()`, 7 days) and is a 404 after it. The plan read is
unchanged and was never limited in time, so opening a past lesson gives a family nothing new.
*Vou / Não vou* arrives in slice 2.

### How it went (POOLSE-116)

Under the plan, one panel per child in the lesson, from `feedback` on the lesson read:

- **The form**, while the window is open and the reader answers for that child: five faces (radio
  buttons, a 44 px row on a phone, each labelled with its word, and the chosen mood shown in
  words), an optional box of up to 500 characters, and *O professor e a secretaria vão ler isto.*
  `PUT /app/lessons/:id/feedback` writes it or rewrites it; *Pode alterar até …* says until when.
- **Who answers:** a guardian always. The student's own login answers from 12 (`SELF_ANSWER_AGE`),
  or at any age on the adult path (no live guardian). A younger child's login reads the answer
  with *Quem responde por este aluno é o encarregado de educação* (403 on a write).
- **Nothing to answer**, said in words: *A presença ainda não foi registada*, *Faltou a esta aula*,
  *Falta justificada nesta aula*, *Esta aula foi cancelada*, or *Pode dizer como correu quando a
  aula terminar*. Each is also the database's refusal (409 with its code) if a write tries anyway.
- After the window the page is a 404 (ticket rule 9). A save that arrives late is refused with
  the date it closed: *Já não pode ser alterado: o prazo terminou a …*.

Feedback is never deleted. The office archives it, and the family's box reopens. Staff read it on
the lesson's register and on the student's *Feedback* tab (`docs/features/students.md`).

## Not yet

These are slices 2 to 5 of POOLSE-90:

- *Vou / Não vou*. A student aged 12 or more with their own login may answer; under 12, a
  guardian answers (Rui, 21-10-2026).
- The instructor home.
- The maintenance home.
- Web push.
- The real-device passes.

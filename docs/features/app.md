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
| Instructor | `/app/aulas`, their lessons (slice 2) |
| Maintenance | `/app/manutencao`, their to-do list (slice 3) |
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

## Vou / Não vou (slice 2)

A family's notice to the club about one coming lesson, **never attendance**: nothing is
pre-marked on the register.

- **Where:** the lesson page has one *Vem à aula?* panel per child while the lesson still takes an
  answer, with two buttons (*Vou*, *Não vou*), the chosen one pressed and said in words. Each agenda
  card shows the answer given (*Avisou que vem / que não vem*). With siblings, the shared card at
  the top of the lesson page leaves it to each child's panel.
- **Who answers:** `family_may_answer()`, the one rule for this and lesson feedback. That is a live
  guardian, or the student's own login from 12 (`self_answer_min_age()`) or on the adult path.
  With no birth date, the guardian answers (Rui, 21-10-2026). Anyone else is 403
  `notice_guardian_answers`; another family's child, or a lesson the child is not in, is 404.
- **When:** only for a turma's lesson, not cancelled and not yet started. The `session_notice`
  trigger refuses the rest with 409 `notice_closed` or `notice_not_offered`.
- One row per lesson and student, the last answer, who gave it and when. Every change goes to the
  audit log. It is keyed by session, so a moved week keeps its answers.
- **The register** shows a chip beside each child who answered (*Confirmou* / *Avisou que não
  vem*), in neutral colours with an icon so it is never read as a mark, and a count above the roll
  (*3 avisaram que não vêm*).

## The instructor home (`/app/aulas`, slice 2)

`GET /app/teaching` (instructors) is the dashboard band's own `readMyWeek`: this week's lessons
where the reader is `resolved_instructor_id`. A stand-in sees the night they cover, and the
regular instructor does not. The page shows registers still owed first, then today, then the
rest of the week. Each lesson shows its time, turma, tank and *15 inscritos · 3 não vêm*, and
opens the existing lesson page. *Voltar* there returns to `/app/aulas` (`readFrom` accepts
`/app` paths since this slice).

## The maintenance home (`/app/manutencao`, slice 3)

A to-do list rather than a calendar. `GET /app/maintenance` (maintenance only) covers every live
site, because maintenance is assigned to no site. It gathers what the dashboard band already
derives and computes nothing itself:

- **Tasks** due or overdue, assigned to the reader or to nobody (`listMyTasks`, due only), each
  saying how late it is or that it was never done.
- **Espaços overdue for cleaning**, from the band's `readOverdueSpaces`, read whole.
- **Open issues**: the band's `readOpenFaults`, read whole, with reposições included alongside the
  avarias.
- The pools, so a water analysis can be recorded.

The actions are one tap each, on the backoffice's own endpoints:
- *Concluir* records a task completion.
- *Limpo* logs a cleaning.
- *Reportar* is a short form (space, type, severity, description) posting to `/spaces/:id/issues`.
- *Registar análise* opens the pool's *water* tab in the backoffice, the one place an analysis is
  recorded. Its *Voltar* returns to `/app/manutencao`.

A one-tap row leaves the list on `useSavedAction`'s refresh, after its toast. The action does not
revalidate the path itself, because that would unmount the button before the toast was raised.

## Push (slice 4a)

Web Push, sent from the API with `web-push`: no provider and no cost. **It is off unless
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are all set**, and then the switch
says so. Production keys are a go-live item (`docs/deploy.md`).

- **The switch.** *Avisos neste telemóvel* sits at the foot of every home, own device only.
  - The permission prompt is raised only by tapping it, never on load.
  - On an iPhone where Poolse is not on the home screen, it explains how to add it instead of
    asking.
  - Blocked, unsupported and unavailable each have their own sentence.
  - The state is always said in words.
- **The worker.** `public/sw.js` has `push` and `notificationclick` handlers and **no `fetch`
  handler**, so it can never serve a stale page. Tapping a notification opens its lesson.
- **Storage.** `push_subscription` holds one row per device. It is revoked, never deleted: by the
  person, or on a 404 or 410 from the push service.
- **Push is a second channel on a recorded notice.** In this slice that notice is the cancelled
  lesson (`docs/features/messages.md`). It is pushed once, to the people the message reached, and
  the email is what is retried.

## Not yet

- Push for the other three kinds (slice 4b): a closure reaching a lesson, a one-week move, and
  *you are the stand-in*.
- The real-device passes (slice 5).

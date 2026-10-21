# POOLSE-90 · The app: an agenda per role, "Vou / Não vou", and push

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Students / Notifications · **Priority:** High — blocks the pilot preview · **Depends on** POOLSE-88 (shell, installability, phone tiers), POOLSE-84 (what a closure reaches), POOLSE-86 (recorded notices, by-id senders), POOLSE-66 (the family and instructor bands) · **Brainstormed** 21-10-2026 · **Pulls forward** roadmap 3.0 (push only), 3.1 (as a PWA), 3.3 and 3.6

### PO — why this exists

Rui opened the backoffice on his phone and the problem was immediate: it is the management tool made
smaller. POOLSE-88 made it *work* on a phone, and staff keep it. But the people who come to the pool
do not manage anything. They want to know where to be, when, and whether it is on.

So this ticket gives Poolse a second front door, **app mode**, inside the same Next.js app and
installed as the same PWA. Each role gets a home built around one question:

| Who | Their home | The question it answers |
|---|---|---|
| Encarregado de educação, adult student | The family agenda | Is there class, when, where, is the water warm, are we up to date |
| Instructor | My lessons | What do I teach today, who is not coming, is a register owed |
| Maintenance | My to-do | What is due, what is dirty, what is broken |
| Owner, Admin | — | Nothing new: they keep the backoffice and its phone tiers |

The pilot club needs this for the preview (Rui, 21-10-2026), which is why phase 3 is pulled forward
in part. **It is a PWA for the pilot.** Whether a native or Expo app follows is decided after the
pilot, from what the pilot shows; nothing here pre-empts it.

**Not in scope:**

- **Paying in the app** (3.5, POOLSE-83). Postponed until the pilot has seen and tested everything
  (Rui, 21-10-2026). The family sees a fee *status*, read-only.
- **Reposições** (make-up lessons) and **booking free swim**. Later.
- **Enrolling from the app** (POOLSE-82).
- **An app mode for Owner or Admin.**
- **Offline use** and any caching service worker. The worker here handles push and nothing else.
- **Photos on a reported issue.** The file purpose is not switched on; later.
- **Per-kind notification preferences.** One switch per device in v1.
- **Messages to families in the app.** POOLSE-67 messages stay email. Push carries cancellations,
  moves and closures.
- **A native app, wearables** (phase 3b).

### BA — rules and data

**Who lands where.**

- `/app` is app mode's root. It decides by the reader's roles in the active club (`memberships[0]`).
  - Owner or admin goes to `/dashboard`, as today.
  - Instructor or maintenance (and no owner or admin role) lands on their app home. A link,
    *Abrir o backoffice*, opens the full menu, because their backoffice pages still exist.
  - Guardian or student only lands on the family agenda. They never see the backoffice shell.
- The manifest's `start_url` becomes `/app` (it was `/dashboard`), so the installed icon opens the
  right home for everybody.
- **A person with several hats** (an instructor who is also a parent, a senior who is a student and
  an EE) gets a switcher at the top: *As minhas aulas* / *Família* / *Manutenção*, offering only
  what they hold. It is remembered per device (`localStorage`, best effort).
- App mode is width-responsive. A guardian on a laptop sees the same app, centred, never the
  backoffice.

**Look.** App mode uses the mobile palette: soft orange with pool blue, light and dark. The tokens
are scoped under app mode's root (`data-surface="app"`), so the desktop palette is untouched. Every
new fill gets an ink and a line in `contrast:check`'s `PAIRS`. The mobile palette may still move
(CLAUDE.md).

**The family agenda (3.3 and 3.6).**

- It shows this week and next, **as a list by day, not a grid**. It covers every child the reader
  is a live guardian of, or the reader themselves on the adult path. **By default every child is
  in one agenda**, each entry showing the child's name. A child filter narrows it (`?child=`, from
  `GET /family`; a stranger's id is a 404).
- **Each entry is a `class_session`, never the pattern.** It shows:
  - the turma and level
  - the time (`formatTime`) and the day (`formatDate`)
  - the site and the tank
  - the instructor's first name, and *Substituto* when a stand-in teaches
- **States, said in words with an icon, never by colour alone:**
  - *Cancelada*
  - *Encerrado*: a closure reaches the session, through `session_reach`, never by
    `pool_id`
  - *Mudou*: a moved occurrence, showing the new day and hour
- **Water temperature** is the tank's latest analysis temperature, with how long ago it was taken
  (`timeAgo`). Past 48 h it says *medida há 3 dias* rather than looking current. It is hidden when
  the water-quality module is off (`moduleIsOn`), and absent when nothing has been measured
  (never a dash pretending to be a reading).
- **Fee status**, one line per child, from `balance` on the fee read (`billing/fee-balance.ts`,
  never re-added):
  - *Em dia*
  - *Em dívida: 45,00 €*

  It is read-only and links to the child's existing fee page in `familyView`.
- **The lesson's page** opens from an entry. It shows the time, the place, the water, the training
  plan where `familyMayReadPlan` allows it, and *Vou / Não vou*.

**"Vou / Não vou".** A notice to the club, **never attendance**.

- It is one answer per student per session: **null** means not answered, the default and the
  ordinary case; **true** means *Vou*; **false** means *Não vou*. The last answer wins, recording
  who gave it and when.
- **Who may answer:**
  - a live guardian of the student
  - the student themselves when on the adult path (`student_is_adult_path`), or aged 12 or more with their own login (Decided 2)
- **When:** only for a session the student is enrolled in that day (the `familyMayReadPlan`
  predicate). Only until the session starts, in the facility's time zone. After that it is a 409
  `notice_closed`.
- **Never offered** on a cancelled or closed session, a parceria, or free swim.
- **It never writes `attendance`.** The register does not pre-mark anybody. It shows a chip beside
  the student, *Avisou que não vem* / *Confirmou*, and a count above the list, *3 avisaram que não
  vêm*. A taught class is still a record, not a plan.
- It justifies nothing and touches no fee.
- Answering pushes nothing to the instructor. One push per parent's tap is noise. They see it on
  their agenda and the register.

**The instructor home.**

- Today first, then the rest of the week, covering sessions where
  `class_session.resolved_instructor_id` is the reader, so stand-in classes count and the regular
  instructor does not see a class they are not teaching. This is the same query as the dashboard's
  instructor band (slice 3): one definition, read by both.
- Each entry shows the time, the turma, the tank and *12 inscritos · 3 não vêm*. A badge says when
  a register is owed.
- Tapping an entry opens the existing lesson page (POOLSE-88 slice 2): register, plan, stand-in,
  cancel. Nothing is copied.

**The maintenance home.** A to-do list rather than a calendar, over `ownFacilityIds` (every site the
reader works at):

1. Maintenance tasks that are due or overdue, assigned to the reader or unassigned.
2. Espaços overdue for cleaning (the server's boolean, never recomputed).
3. Open reported issues (avarias / reposições).

The actions are one tap each:

- *Limpo*: logs a cleaning
- *Concluir*: completes a task
- *Reportar*: reports an issue
- *Registar análise*: records one water analysis on a pool, which is all maintenance may do there

Every one of them calls the endpoint the backoffice already uses.

**Push (3.0, the push half).**

- **Web Push with VAPID keys**, sent from the API with the `web-push` package: no provider, no cost.
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` absent means push is off and the
  switch says so. That is the `STRIPE_SECRET_KEY` pattern.
- **Turning it on:** *Avisos neste telemóvel* is a switch, and the permission prompt is raised only
  by tapping it, never on load (iOS refuses otherwise).
- **iPhone:** push works only once the app is on the home screen. In Safari, not installed, the
  switch explains *Adicione a Poolse ao ecrã principal para receber avisos* instead.
- **What is pushed in v1:**
  1. A lesson of yours or your child's cancelled (this occurrence or the series).
  2. A closure that reaches one of those lessons.
  3. A lesson moved for one week.
  4. To an instructor: *you are the stand-in* for a session.
- **Push is a second channel on a recorded notice, never instead of it.** Closure warnings keep
  going by email whatever the device says (POOLSE-86). Email is the channel that is retried; a push
  is sent once.
- **Recipients** follow the notice's own audience. For a family that is `message_recipients()`'s
  definition (live guardians, or the adult student), so the push and the email cannot disagree
  about who was told.

### Dev — where it goes

**Data** (through the `write-migration` skill; every table goes in `TENANT_TABLES`):

- `session_notice`: `organization_id`, `class_session_id`, `student_id`, `going boolean NOT NULL`,
  `answered_by_membership_id`, `answered_at`. Composite foreign keys to the session and the student,
  and a unique key on `(organization_id, class_session_id, student_id)`. No row means null. An
  upsert writes it, and the change goes to `audit_log`. Keyed by **session id**, never by date, so
  a moved occurrence keeps its answers.
- `push_subscription`: `organization_id`, `membership_id`, `endpoint`, `p256dh`, `auth`, a
  user-agent label, `created_at`, `last_success_at`, `revoked_at`. Unique on
  `(organization_id, membership_id, endpoint)` where not revoked. A 404 or 410 from the push service
  revokes the row.

**API** (every controller tagged `@PoolseModule` or `@CoreRoute`; every route added to
`role-probe.integration.test.ts` in the same change):

- `GET /app/agenda?from&to`: family entries. `requireActsForStudent` semantics, and a window capped
  at two weeks (a fixed window, so it is exempt from pagination).
- `PUT /sessions/:id/notices/:studentId` `{ going }`. The register read gains `notices` and the
  count.
- `GET /app/teaching`: reuses the instructor band's resolver query.
- `GET /app/maintenance`: reuses the existing due-task, overdue-cleaning and open-issue queries.
- `POST /push/subscriptions` and `DELETE /push/subscriptions/:id`, own device only.
- **A single-lesson cancellation records no notice to families today** (`sessions.controller.ts`
  `cancel`). It becomes one, recorded inside the cancelling transaction and delivered after commit
  by a by-id sender, as POOLSE-86 requires. **Recommended:** reuse POOLSE-67's `message` record
  with a system audience, so email, retry, recipients and the history come for free rather than
  through a third notice table.

**Web:**

- `app/(app)/app/…`: its own layout, with a bottom tab bar per hat, the role switcher and safe-area
  padding. POOLSE-88's rules apply as written (`h-control`, `dvh`, `--safe-bottom`).
- Every app-mode screen is **tier 1** and earns a line in a new `e2e/phone-app.spec.ts`, as a
  guardian, an instructor and a maintenance user. The guardian session needs a test user on the
  dev Clerk instance (`GUARDIAN_SESSION` in `auth.setup.ts`).
- `public/sw.js`: `push` and `notificationclick` handlers **only**. No `fetch` handler: a caching
  worker serves yesterday's deploy, and offline is out of scope. A notification opens the lesson's
  page.

**What will be got wrong:**

- Drawing the family agenda from `class_schedule`. Moved weeks then show in the wrong place.
- Joining closures by `pool_id` instead of `session_reach`. A lane booked in another tank is
  missed.
- Inner-joining `class_group` in the instructor agenda, so parceria sessions with
  `managed_lessons` vanish.
- `current_date` or `new Date()` for "today" (use `club_today()` / `today()`), and the cut-off for
  *Não vou* compared in UTC.
- Asking for notification permission on load. iOS refuses it, and every platform punishes it.
- A service worker with a `fetch` handler that caches pages.
- A notice that writes `attendance`.
- Showing a water temperature from a tank the session is not in, or one from a week ago without
  saying so.

### Build plan

1. **App mode and the family agenda.** Routing by role, the switcher, palette tokens, the agenda,
   the water temperature, fee status and the lesson page. `start_url`. QA 1–6.
2. **Vou / Não vou, and the instructor home.** The table, the endpoint, the register chips and
   count, the teaching agenda. QA 7–11.
3. **The maintenance home.** QA 12.
4. **Push.** The worker, VAPID, subscriptions, the cancellation notice, the four kinds. QA 13–16.
5. **Real devices.** One iPhone (installed) and one Android pass, recorded here. Update
   `docs/features/navigation.md` (app mode, its tier), a new `docs/features/app.md`, the roadmap's
   phase 3 table, and one CLAUDE.md paragraph.

### QA — test scenarios

1. **Given** a guardian-only person, **when** they open the installed app, **then** they land on the family agenda and no backoffice menu is reachable from it. **Given** an owner, **then** `/app` sends them to `/dashboard`.
2. **Given** an instructor who is also a guardian, **then** the switcher offers *As minhas aulas* and *Família* and nothing else.
3. **Given** two children in different turmas, **then** both appear in one agenda with their names, and the child filter narrows to one. **Given** another family's child id, **then** 404.
4. **Given** a lesson moved this week from Tuesday to Thursday, **then** the agenda shows it on Thursday, marked *Mudou*, and not on Tuesday.
5. **Given** a closure of one tank that reaches a lesson through its lane, **then** the lesson reads *Encerrado*, with words and an icon, in light and dark.
6. **Given** a tank's last temperature taken four days ago, **then** it reads *medida há 4 dias*. **Given** water quality switched off for the club, **then** no temperature appears and the API carries none.
7. **Given** a guardian, **when** they tap *Não vou* before the lesson, **then** the instructor's register shows *Avisou que não vem* beside that child and the count reads 1. Nothing is marked in `attendance`.
8. **Given** the lesson has started, **when** a guardian answers, **then** 409 `notice_closed` and the toggle explains why.
9. **Given** an 11-year-old's own student login, **when** they answer, **then** it is refused; a 12-year-old's is accepted, and so is an adult-path student's. A student with no birth date is refused.
10. **Given** a cancelled lesson or a parceria, **then** no toggle is offered and the endpoint refuses.
11. **Given** a stand-in named for Thursday, **then** the lesson appears on the stand-in's home and not on the regular instructor's.
12. **Given** a maintenance user at two sites, **then** the to-do covers both. *Limpo* clears the overdue warning on that Espaço. They can record a water analysis but nothing else on the pool.
13. **Given** iPhone Safari, not installed, **then** the push switch explains how to add Poolse to the home screen and asks for no permission.
14. **Given** an installed app with push on, **when** an admin cancels this week's lesson, **then** the family's phone shows the notification within a minute. Tapping it opens the lesson. The email is sent as well.
15. **Given** VAPID keys absent, **then** the switch says notifications are not available and nothing errors.
16. **Given** a subscription the push service answers 410 for, **then** it is revoked and not tried again.
17. **Given** the `iphone` and `android` Playwright projects, **then** `phone-app.spec.ts` passes on both as a guardian, an instructor and a maintenance user.

### Acceptance criteria

1. `/app` routes every role to its home. Guardians and students never see the backoffice shell. The installed app starts at `/app`.
2. The family agenda shows two weeks of real sessions for every child (or the adult student), with cancelled, closed and moved states in words, the water temperature with its age, and fee status from `balance`.
3. *Vou / Não vou* is stored per student per session, answerable only by a live guardian or an adult-path student, only until the start, and never writes attendance. The register and the instructor agenda show it.
4. The instructor home lists the reader's own sessions, stand-ins included, and opens the existing lesson page.
5. The maintenance home lists due tasks, overdue cleanings and open issues across the reader's sites, with one-tap actions through the existing endpoints.
6. Web push delivers the four v1 kinds on Android and on an installed iPhone. It runs alongside email, never instead of it, and switches off cleanly without VAPID keys.
7. A single-lesson cancellation records a notice to its families and emails it.
8. Every new endpoint is in the role probe, with cross-tenant and denial tests. Every new table is in `TENANT_TABLES`.
9. pt-PT and en, light and dark, contrast-checked mobile palette. One real iPhone and one real Android pass are recorded here.
10. Docs, the roadmap's phase 3 and CLAUDE.md are updated in the same change.

### Open

- **Decided 1** (Rui, 21-10-2026): **no** — v1 shows coming lessons only; past lessons with the register's mark come with the record views later.
- **Decided 2** (Rui, 21-10-2026): **a student aged 12 or more with their own login may answer** *Vou / Não vou* for themselves; under 12 only a guardian answers. With no birth date it is the guardian, never a guess — the rule `student_is_adult_path` already follows. The age is one constant, `SELF_NOTICE_MIN_AGE = 12` in `@poolse/rules`, not a column, until a club asks for another.

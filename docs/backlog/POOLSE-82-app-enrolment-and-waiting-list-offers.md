# POOLSE-82 · Enrolling from the app, and a waiting list that offers places

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Mobile app · **Priority:** High · **Depends on** 1.7 (enrolment and waiting list), POOLSE-69 (pre-registration), 3.0 (notifications), 3.2 (student and guardian accounts) · **Followed by** POOLSE-83 (paying at enrolment)

### PO — why this exists

A family that already belongs to the club cannot sign up for a turma by itself. Staff do it for them,
or the family fills in the public pre-registration form as if it were new to the club. The waiting
list is just as manual. Poolse keeps it (1.7), but when a place frees up nobody is offered it. The
office has to notice, look up who is first and phone them. The most wanted turmas (early evening,
Saturday morning) are where this costs the most time and causes the most arguments.

This ticket lets a family or an adult student sign up in the app, under rules the club sets. It also
makes the waiting list offer a freed place on its own, with a deadline, before moving to the next
person.

**Build order.** The server half and the backoffice half do not need the app. Waiting-list offers
are useful as soon as they are built: they go out by the email `notifier.ts` already sends. When 3.0
arrives they also go out as push. The app screens wait for 3.1 and 3.2.

**Not in scope:**
- **Paying.** POOLSE-83. Until it ships, an enrolment made in the app creates the fee lines it
  creates today, and the family pays the way it pays today.
- **Families with no account.** They keep using the public form (POOLSE-69). This ticket is for
  people the club has already invited (3.2).
- **Moving a whole season's turmas into the next season** (season rollover).
- **Changing turma in one step.** A swap is signing up for the new turma and leaving the old one.
- **Telling a family it has dropped down the queue**, beyond showing its current position.

### BA — rules and data

**The club switches app enrolment on, and it is off by default.** It is one Owner switch on the
organization. It is off for the same reason the public form starts closed: a club decides when its
families can start signing up.

**Every turma has an enrolment mode, which is the setting.**

| Mode | What a sign-up in the app does |
|---|---|
| `closed` | The turma is not offered in the app |
| `approval` | Every sign-up is a request that staff accept or decline |
| `returning_direct` | A **returning** student is enrolled at once; anyone else sends a request |
| `direct` | Everyone who is eligible is enrolled at once |

- The mode is set **per site** in the site's configuration tab, as the default for its turmas.
  **The default is `returning_direct`.**
- A turma may **override** it. Null means it follows the site.
- **Returning** means the student has an enrolment (active or ended, never just a waiting one) in a
  turma of this season or the one before. That is a single SQL function,
  `student_is_returning(org, student)`, and every reader calls it. A student the club has known for
  years but who has not swum for two seasons counts as new, because their level is no longer known.
- **A request is its own record (`enrolment_request`), not an enrolment.** It holds no place. Staff
  answer it from the Pedidos page, in a new *Pedidos da app* section:
  - **Accept** goes through the ordinary enrolment path, so a full turma refuses, or puts the
    student on the waiting list if staff choose that;
  - **Decline** needs a reason, which the family sees;
  - **Offer a trial lesson** reuses POOLSE-69's trial-lesson booking.

**What the app offers is filtered. What staff can do is not.** The app lists a student only the
turmas that:
- are in a published season with a start date not yet passed;
- belong to the student's current level, or to the next level POOLSE-19 has proposed;
- fit the level's age range and sex flags on the turma's start date;
- clash with none of the student's other turmas.

In the backoffice, the age and sex rules stay warnings, as now. The filter only decides what the app
shows. Each turma shows its places left as a number, or *Lista de espera · N à frente* when it is
full.

**Sign-up windows control who may sign up when.** A season has zero or more windows, each with an
opening time and an audience:

| Audience | Who may sign up |
|---|---|
| `renewal` | Students enrolled in the season before (renovação de matrícula) |
| `priority` | Siblings of an enrolled student (a live guardian shared with one), and sócios (a live quota line) |
| `everyone` | Every account holder |

- Windows open in order and never close an earlier audience out. Once `everyone` opens, renewing
  students can still sign up.
- A season with **no windows** is open to everyone as soon as app enrolment is on.
- Before a window opens, the app shows when it opens. It does not hide the turma.
- Two families signing up for the last place in the same second are decided by the database
  (`enrollment_respects_capacity`, which already locks). The second one is offered the waiting list,
  never an error.

**The waiting list keeps one order, and the order is visible.**
- Order is the club's **priority tiers** (renewal, priority, everyone, the ones the club switched on),
  then the time the student joined the list. The existing `waiting_position` becomes a value derived
  from that, not one typed in.
- **Staff may move someone by hand.** The move is audited, and it pins that person's place until
  they leave the list.
- A family sees its own position as a number. It never sees who else is on the list.

**A freed place is offered, never just given.** A place frees up when an enrolment ends, a turma's
capacity goes up, or an offer is declined or runs out. When it does:

1. The first eligible person on the list gets a **`waitlist_offer`**, which has a deadline.
   - The deadline is set per club, **48 h by default**.
   - The offer **holds the place**: capacity counts active enrolments plus live offers.
2. They are told. By email now, by push after 3.0. The offer is a record first: `delivered_at` null
   means "recorded and not sent", and the screen says so in words.
3. **They accept**, and become an active enrolment through the ordinary path. Once POOLSE-83 is
   live, accepting goes through checkout instead.
4. **They decline**, or the deadline passes: the offer ends and the next person gets one.
   - A person whose offer ran out **stays on the list**, at the back of their tier, with a note.
   - A person who declined **leaves the list**.
5. **Staff can make or withdraw an offer by hand.** Withdrawing releases the place to the next
   person.

Offers run out through a job every 15 minutes, under an advisory lock like the trial clock. The job
is idempotent because each step reads the state it changes.

**Being on several waiting lists is allowed.** Accepting one offer does not take the person off
the others. The app lists the person's waiting lists so they can leave them.

**Who may do what:**
- A **guardian** acts for their own children; an **adult student** acts for themself. Both go through
  `requireActsForStudent`, and anyone else gets a 404.
- **Owner and Admin** set the modes, windows, tiers and deadline, answer requests and move people on
  the list.
- **Instructors** see the waiting list and the requests for their own turmas, and change nothing.

**Open:** should a person who already has a live offer in one turma get offers for other turmas at
the same time? **Default:** yes. Turmas are different products, and holding one place does not mean
the family wants it.

### Dev — schema, API, where it goes

**Migration:**
- New enums: `enrolment_mode` (`closed`, `approval`, `returning_direct`, `direct`) and
  `waitlist_tier` (`renewal`, `priority`, `everyone`).
- `organization`: `app_enrolment_open` (boolean, false), `waitlist_offer_hours` (smallint, default
  48), `waitlist_tiers` (`waitlist_tier[]`, default all three). Read the array column `::text[]`.
- `facility.enrolment_mode` (not null, default `returning_direct`); `class_group.enrolment_mode`
  (nullable, meaning it follows the site).
- `enrolment_window`: season, audience, `opens_at`, `archived_at`. Unique per season and audience
  among live rows.
- `enrolment_request`: student, turma, the person who asked, status (`pending`, `accepted`,
  `declined`, `withdrawn`), `decided_by`, `decision_reason`. One pending request per student per
  turma, by a partial unique index.
- `waitlist_offer`: enrolment (the waiting one), `offered_at`, `expires_at`, status (`live`,
  `accepted`, `declined`, `expired`, `withdrawn`), `delivered_at`, and who made it (a person, or
  null for the job).
- `enrollment`: `waiting_since`, `pinned_position` (nullable), `tier`. `waiting_position` is
  derived in a view or function, never stored.
- **`enrollment_respects_capacity` counts live offers.** That is the one place a held place exists;
  a second count in TypeScript would disagree with it.
- Every new table goes into `TENANT_TABLES`, child-first.

**One function each, used by every reader:**
- `student_is_returning()`;
- `student_waitlist_tier()`;
- `next_offer_candidate(class_group)`, which skips a person who is no longer eligible (archived, now
  enrolled in that turma) without dropping them from the list;
- `app_offerable_turmas(student)`, which the app's list and the sign-up's own check both call, so
  the list and the refusal cannot disagree.

**API:**
- **For a family:**
  - `GET /students/:id/turmas-available`;
  - `POST /students/:id/enrol`, which answers `enrolled`, `requested` or `waitlisted` with the reason
    as a code;
  - `GET /students/:id/waiting`;
  - `POST /offers/:id/accept` and `/decline`.
- **For staff:**
  - the requests queue;
  - `POST /enrolment-requests/:id/accept` and `/decline`;
  - `POST /enrollments/:id/move-in-queue`;
  - `POST /enrollments/:id/offer`, `POST /offers/:id/withdraw`;
  - windows CRUD under the season page.
- Every handler refuses by role, or by `requireActsForStudent`, in its first line. Add each one to
  `role-probe.integration.test.ts`.
- Where a freed place is detected (ending an enrolment, raising capacity, an offer ending), the same
  transaction calls `offer_next(class_group)`. The email goes out after the commit.

**Web (backoffice):**
- *Pedidos da app* on the Pedidos page.
- The waiting list on the turma's page, showing order, tier, a live offer with its deadline, and
  move / offer / withdraw.
- The mode on the site's configuration tab and on the turma form.
- Windows on the season page.
- The organization switch, Owner only.

**Mobile (3.1+):** the turma list, sign-up, *As minhas listas de espera*, and the offer screen with
its deadline.

**What will be got wrong:**
- **An offer that does not hold the place**, so an office enrolment takes it while the family is
  still deciding.
- **Counting `waiting` enrolments against capacity.**
- **Deciding "returning" in TypeScript in one place and in SQL in another.**
- **Moving the next person up in a different transaction** from the one that freed the place, so a
  crash leaves a free place offered to nobody.
- **The expiry job running twice** on two instances.
- **Ordering the waiting list by the old typed `waiting_position`** after it has become derived.
- **A `class_group` inner join** where a booking is involved; partnerships have none.
- **Showing a family another family's name**, even only as the person ahead of them.
- **Dates:** `opens_at` is the club's wall clock, resolved in `facility.timezone`. `club_today()`
  decides whether a season has started.

### QA — test scenarios

1. **Given** app enrolment is off, **when** a guardian asks for available turmas, **then** an empty
   list that says enrolment is not open, and `POST /enrol` is refused.
2. **Given** a site in `returning_direct` and a student enrolled last season, **when** they sign up
   for a turma with places, **then** enrolled at once.
3. **Given** the same site and a student with no enrolment in this season or the last, **then** a
   pending request and no place taken. Staff accepting it enrols them.
4. **Given** a turma overridden to `approval` on a `direct` site, **then** every sign-up is a
   request.
5. **Given** a turma of a level that is neither the student's level nor their proposed next one,
   **then** the app does not offer it, and a direct `POST` is refused with the same code.
6. **Given** a `renewal` window opening tomorrow and no other window, **when** a new family signs
   up, **then** refused, with the opening time of the window that applies to them.
7. **Given** one place and two sign-ups in the same instant, **then** one enrolled and one offered
   the waiting list. Never two enrolled, never an error.
8. **Given** a full turma with A (everyone, joined Monday) and B (renewal, joined Tuesday) waiting,
   **then** B is first.
9. **Given** an enrolment ends in a full turma with a waiting list, **then** in the same transaction
   the first eligible person gets a live offer, and capacity counts it.
10. **Given** a live offer, **when** the office tries to enrol someone else into that place, **then**
    refused as full.
11. **Given** an offer past its deadline, **when** the job runs (twice, concurrently), **then** it
    expires once, the person goes to the back of their tier, and the next person gets one offer.
12. **Given** an offer declined, **then** the person leaves that list, and the next person gets an
    offer.
13. **Given** a guardian, **when** they read the waiting list, **then** they see their child's
    position and nobody else's name.
14. **Given** staff move C to first, **then** it is audited, and C keeps that place when others join
    in a higher tier.
15. **Given** another family's student id, **when** a guardian calls any family endpoint, **then**
    404. **Given** an instructor, **when** they accept a request, **then** 403. Club B's offer is not
    found from Club A.
16. **Given** no email provider configured, **then** the offer is recorded, its deadline still runs,
    and the turma page says *registada, não enviada*.

### Acceptance criteria

1. The Owner switches app enrolment on; it is off by default.
2. Each site has a default enrolment mode (`returning_direct` unless changed) and each turma may
   override it. The four modes behave as described.
3. "Returning" has one definition in SQL, and every reader uses it.
4. The app offers only turmas the student is eligible for. The sign-up check and the list are one
   function.
5. A request holds no place and is answered from the backoffice. Accepting it goes through the
   ordinary enrolment path.
6. Season windows control who may sign up when, by audience.
7. The waiting list is ordered by the club's tiers and then by time, can be reordered by staff with
   an audit entry, and shows a family only its own position.
8. A freed place becomes an offer in the same transaction. The offer holds the place, runs out on
   the club's deadline, and moves to the next person.
9. Offers are records first; the screen says whether each was sent.
10. Every endpoint is guarded by role or by `requireActsForStudent`, and probed.

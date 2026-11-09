# POOLSE-208 · At 18 the young adult confirms the consents a parent gave, and the family is told what changed

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Families / Email · **Priority:** Medium (pilot) · **Depends on** [POOLSE-206](./POOLSE-206-a-parent-link-ends-at-majority.md), [POOLSE-207](./POOLSE-207-the-office-sees-turning-18-and-supported-adults.md), POOLSE-86 (email delivery)

### PO — why this exists

At 18 the parent's rights end (POOLSE-206) and the office is told (POOLSE-207). Two people are still in the dark: the parent, who suddenly sees less in the app, and the young adult, whose consents were signed by somebody else. Rui chose, on 09-11-2026: *re-ask consents* and *message the family* (and *invite to own login*, which is the office's button in POOLSE-207).

**Not in scope:** inviting the young adult automatically (it stays the office's button); any change for a student with an `accompanying` link; renewing documents (FPN, exam) at 18.

### BA — rules

1. **Consents a parent gave show as given by the parent.** On the young adult's own login, *Perfil* lists each consent whose grantor was a guardian as *"Dado pelo encarregado — a confirmar por si"*, with *Confirmar* and *Retirar*. *Confirmar* writes a new consent record granted by the student; *Retirar* withdraws it (the consent record, never a boolean: grantor and timestamp, per the model).
2. **Open:** until the young adult answers, does the parent's consent stay in force? **Default if unanswered: yes**, it stays until confirmed or withdrawn (a withdrawal is possible at any moment, and stopping on the birthday would remove photos nobody objected to). The office sees *"a confirmar pelo próprio"* beside it.
3. **The family is told, once** (Rui, 09-11-2026). On the day a student with a live `parental` link reaches majority, one email to each live parent and one to the student (if they have an email), in the recipient's locale: what changes (the parent keeps paying, if they paid, and no longer sees lessons, progress or documents) and, for the student, that they can sign in and confirm their consents. Sent once after its commit, rendered from its row, retried hourly (the email convention). No email for an `accompanying` link.
4. A student with no birth date, or only a declared one, never triggers any of this (POOLSE-206 rule 8).
5. The family app shows the parent a one-line notice on *Pagamentos* for that student: *"{nome} fez 18 anos: vê apenas os pagamentos."* (the family app says the least it can).

### Dev notes

- A daily job (`asSystem`, like advancement by age) finds students whose majority date is today's `club_today()` with a live `parental` link and writes `majority_notice` rows (organization_id, student_id, recipient membership or student, kind `parent`/`student`, email, locale, sent_at, attempts); the mailer sends from the rows. Idempotent per student per recipient (a unique constraint), so a rerun sends nothing twice.
- Tenant table rules: composite FKs, RLS, `TENANT_TABLES` (child-first).
- Consent reads: `consent.granted_by_membership_id` is the grantor; "given by a parent" is a grantor who is (or was) a `guardian_link` of the student. The app read and the two actions are the student's own (`requireMine`, adult path only).
- Email copy in pt-PT and en, Rui to read the Portuguese before go-live.
- `poolse-security-review` on the job and the consent actions.

### QA

1. Given a student turning 18 today with a mother (parental, with email) and their own email, when the job runs twice, then exactly two emails are sent, one each, in each recipient's locale.
2. Given a 30-year-old with an `accompanying` link reaching nothing today, then no email.
3. Given the young adult signed in, when they press *Confirmar* on the photo consent, then a new consent row is granted by them and the *"a confirmar"* tag disappears in the app and the office.
4. When they press *Retirar*, then the photo stops showing to classmates (POOLSE-194) at once.
5. A parent calling the young adult's consent action gets 403; a club B consent id gets 404.
6. Given a minor, then *Perfil* shows no consent actions (unchanged).

### Acceptance criteria

- [ ] Parent-given consents tagged and confirmable/withdrawable by the young adult; office sees the tag.
- [ ] `majority_notice` rows and one email per recipient, once; none for acompanhantes.
- [ ] The *Pagamentos* notice for the parent.
- [ ] Open point 2 answered or the default applied and written in `docs/decisions.md`.
- [ ] QA 1–6 as tests; security review done.

# POOLSE-79 · Support access: the club lets Rui in, for a while, and sees what he did

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Platform / Security · **Priority:** High · **Depends on** POOLSE-78 (most requests should never need this), POOLSE-64 (the `confirmName` and `platform_alert` machinery) · **Brainstormed** 11-10-2026

### PO — why this exists

Sometimes a club needs the operator inside its own data: a mess an Owner cannot untangle,
an import gone wrong, something POOLSE-78's bin does not cover. Today that is impossible
**by design**. `poolse_platform` cannot read `student`, `student_sensitive` or `invoice`,
and "platform access grants nothing inside any tenant" (`docs/features/platform.md`). That
rule stays. This ticket does **not** widen the platform login and does **not** create a
standing master role.

What it adds is a **support session**:

- **The club grants it.** The Owner opens access for a chosen period, or approves a request
  Rui sends.
- **Rui enters as himself.** He goes in through the ordinary tenant path with a temporary,
  flagged membership, so RLS, role checks and the audit trail all work unchanged.
- **The club can see it.** A banner shows while he is in, and every write lands in the
  club's own activity log under his name, marked as support.
- **It ends on its own** when the period runs out.

A club's data includes minors and health notes, and Rui is its processor. Access that is
owner-granted, time-boxed and logged is much easier to defend under GDPR, and easier to
sell to the pilot club, than "the vendor can see everything, always".

**Not in scope:** Clerk impersonation (rejected: the trail would say the Owner did what
Rui did), any widening of `poolse_platform`, permanent deletion in any form, and reading
`student_sensitive`. A support session is not a reason to see medical notes, and the
retention ticket (POOLSE-77) logs every access to them anyway.

### BA — rules and data

**Granting:** under *O meu perfil → Acesso de suporte*, **Owner only**. It is the club's
decision about its own data, and an Admin is not the controller. Durations are 24 h,
3 days or 7 days. The Owner can revoke at any time, effective on the next request. The
screen lists current and past grants: who granted, when, until when, and how it ended
(expired, revoked or ended by support).

**Requesting:** from `/admin/tenants/[id]`, Rui can *Pedir acesso* with a sentence of
reason. The Owner sees it as a dashboard card and on the same screen, and approves with
one click and a duration. An unanswered request expires after 7 days.

**Emergency override:** for the 08:00 case where the club is broken and the Owner is not
answering. From `/admin` it requires:

- a reason (required, at most 500 characters, as with a suspension);
- the club's name typed back (`confirmName`, POOLSE-64 E1, because entering a club without
  consent is the irreversible-feeling act);
- a fixed duration of **4 hours**, not renewable without the reason again.

It raises a `platform_alert`. It records a notice to the Owner with the reason verbatim,
which is sent once the email provider exists and says "registado, não enviado" until then.
It is shown on the Owner's grants list as *Acesso de emergência*.

**What a support session can do:** it holds role **admin** (**answered 12-10-2026, Rui — 1**), so:

- every existing role check already knows the answer;
- the Owner's salary, the subscription and transfer of ownership stay hidden, as they are
  from any Admin;
- it can archive and restore (POOLSE-78) and edit;
- it cannot hard delete, because nothing can.

**Read-only by default:** **answered 12-10-2026, Rui — 2: no.** A support session is opened to
fix something, and a read-only one that has to be re-requested to write is a second round
trip at the worst moment. The trail is the safeguard, not the mode.

**The banner:** while a support membership is the active one, every page carries a strip
reading "Sessão de suporte — Rui Fonseca · termina às 18:00 de 12-10-2026 · Terminar
agora". The club's Owner and Admins see a quieter strip: "O suporte Poolse tem acesso até …
· Revogar" (Owner) or "· ver atividade" (Admin).

**Seats:** a support membership does not count against `max_management_users` and never
appears in staff lists, salary lists, instructor pickers or `message_recipients()`.

### Dev — schema, API, where it goes

```
support_grant (
  id, organization_id
  requested_by_platform_admin_id   -- null when the Owner opened it unprompted
  granted_by_membership_id         -- null for an override
  source  ('owner' | 'request' | 'override')
  reason  text                     -- required for request and override, by CHECK
  starts_at, expires_at
  ended_at, ended_by  ('expired' | 'owner' | 'support')   -- null while live
  created_at
)
```

In `TENANT_TABLES`. Owner reads and writes it through `poolse_app`. `poolse_platform` gets
`SELECT` plus `INSERT` limited to `source in ('request','override')`. That widening is
taken out loud in `docs/decisions.md` and asserted in `platform-admin.sql`. The insert
goes through `changeTenant`, so it is audited in the same transaction.

**The membership:** `membership.support_grant_id uuid null` (composite FK). A membership
with it set is a support membership: role `admin`, linked to Rui's `app_user`.
**`resolve_memberships` drops it when its grant is expired or ended**, derived at read time
with no cron, so a session cannot outlive its grant because a job did not run. The seat
quota, staff lists and `message_recipients()` filter `support_grant_id is null`. Each of
those is a test.

**Attribution is free:** `recordAudit` takes `actor_membership_id` from the request
context, and that is the support membership. The club's activity view shows those rows
with a *Suporte* badge. Entering and leaving also write `support.entered` /
`support.ended` to both `audit_log` (the club's record) and `platform_audit_log` (Rui's).

**Web:**

- A tenant switcher entry for Rui listing clubs with a live grant.
- The banner in the app layout, driven from `/me` (which already carries the membership).
- The *Acesso de suporte* card under *O meu perfil*.
- *Pedir acesso* and *Acesso de emergência* on `/admin/tenants/[id]`, the second behind a
  `Dialog` with the reason and the name.

**What will be got wrong:**

- A list that forgets `support_grant_id is null`, so Rui appears as a staff member,
  receives family messages or eats a seat. Grep every `membership` read.
- Expiry enforced by a cron instead of in `resolve_memberships`.
- Granting `poolse_platform` anything on `membership`. The membership is created by the
  tenant-side function inside the grant's transaction, or by a `SECURITY DEFINER` function
  keyed on a live grant (**answered 12-10-2026, Rui — 3: the function**), because an override has no
  Owner session to ride on, and reconsider it per the migration checklist rather than
  adding a column grant.
- An override that does not alert.

### Build plan (12-10-2026)

**One change from the Dev section above: the role is not a row.** `resolve_memberships`
builds a member's roles from `membership_role`. A support membership is therefore created
with **no** `membership_role` rows, and `resolve_memberships` gives it `{admin}` only while
its grant is live:

- Every role-keyed list (staff, instructor pickers, payees, the management-seat count,
  owner/admin recipients of alerts) leaves it out with no edit, because it holds no role
  there.
- A forgotten filter therefore fails closed. Rui is missing from a list rather than shown on
  it as staff.
- Role checks still work. They read `currentTenant().roles`, which comes from
  `resolve_memberships`. No SQL function checks a caller's role (checked: the 16 migrations
  that touch `membership_role` define none).

What still needs `support_grant_id is null` is the handful of reads over **every**
membership regardless of role: *Pessoas*, people search and pickers, invitations and the
dedup check. The build classifies the 136 membership reads (121 in the API, 15 in SQL), and
QA 5 asserts against each list endpoint rather than trusting the grep.

Three slices, each ending working:

1. **Grant and entry (API + SQL).**
   - `support_grant` and `membership.support_grant_id`.
   - `resolve_memberships` (live-grant role, expiry and revocation at read time).
   - The `SECURITY DEFINER` entry function, keyed on a live grant.
   - The Owner's grant/revoke endpoints and the support side's "end now".
   - `support.entered` / `support.ended` on both logs.
   - QA 1–6, 9 and 10, plus the role probe.
2. **Request and override (platform).**
   - *Pedir acesso*, and the Owner's approval card on the dashboard.
   - *Acesso de emergência*: reason, `confirmName`, 4 h, `platform_alert`, and the recorded
     Owner notice.
   - The `poolse_platform` grant on `support_grant`, asserted in `platform-admin.sql`.
   - QA 7 and 8.
3. **Screens.**
   - The *Acesso de suporte* card under *O meu perfil*.
   - Both banners, from `/me`.
   - Rui's switcher entry.
   - The *Suporte* badge in the activity view.
   - Docs (`platform.md`, `security.md`, `data-model.md`).

### QA — test scenarios

1. **Given** an Owner grants 24 h, **then** Rui's next `/me` lists the club with a support membership of role admin, and the banner shows the end time in `dd-MM-yyyy`.
2. **Given** the grant has expired, **when** Rui calls any tenant endpoint for that club, **then** he is refused as a non-member, with no cron having run.
3. **Given** the Owner revokes, **then** Rui's next request is refused.
4. **Given** Rui archives a student during the session, **then** `audit_log` shows his support membership as actor and the activity view badges it *Suporte*.
5. **Given** a live support membership, **then** it is absent from staff lists, salary lists, instructor pickers and the recipients of a club message, and seats used are unchanged.
6. **Given** an Admin of the club, **when** they open *Acesso de suporte*, **then** 403; only the Owner grants.
7. **Given** an override with no reason, or with the wrong club name, **then** it is refused (`admin.error.nameMismatch` for the second).
8. **Given** a valid override, **then** a `platform_alert` is written, a notice to the Owner is recorded with the reason, and the grant ends after 4 h.
9. **Given** a support session, **when** it requests `student_sensitive`, the Owner's salary or the subscription, **then** it is refused exactly as an Admin is.
10. **Given** `poolse_platform`, **then** it still cannot read `student` or `invoice`, and cannot insert a grant with `source = 'owner'`.

### Acceptance criteria

1. The Owner can open, review and revoke support access with a fixed duration; Rui can request it from `/admin` with a reason.
2. Rui enters a club only through a live grant, as a flagged admin membership, through the tenant connection; `poolse_platform` reads no more club data than before.
3. Expiry and revocation are enforced at read time in `resolve_memberships`.
4. Every write in a session is attributed to the support membership in the club's `audit_log` and visible to the Owner; entering and leaving are logged on both sides.
5. A support membership never counts as a seat or appears among staff, payees or message recipients.
6. The emergency override needs a reason and the club's name, lasts 4 h, raises an alert and records a notice to the Owner.
7. All three Open items answered and logged; pt-PT and en; `docs/features/platform.md`, `docs/security.md` and `docs/data-model.md` updated.

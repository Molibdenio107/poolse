# POOLSE-225 · A club's Owners are emailed when the platform suspends or restores it

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Platform / Notifications · **Priority:** Medium (pilot) · **Depends on** [POOLSE-64](./POOLSE-64-hardening-admin.md), [POOLSE-79](./POOLSE-79-support-access.md), [POOLSE-86](./POOLSE-86-email-delivery.md)

### PO — why this exists

> "When the platform suspends or restores a club, email every Owner after the commit, with the
> reason verbatim and the support contact. Reuse the support-notice pattern in owner-notices.ts,
> including the hourly retry." (Rui, 17-11-2026)

Today an operator who suspends a club in `/admin` closes its door and tells nobody. The Owner
finds out by signing in and landing on the suspended screen, or by a call from the desk saying
nothing works. A support override already emails the Owners (POOLSE-79, sent since POOLSE-86),
and a suspension changes far more for them than an override does, so it gets the same
treatment. Restoring a club gets an email too, so the Owner knows the door is open again without
having to try it.

**Not in scope:**
- The trial clock's own suspension. It already sends its `access_closed` trial notice, and two
  emails about one event is one too many (Rui, 17-11-2026).
- A reason on restore. Restore stays one click and asks for nothing (Rui, 17-11-2026).
- Showing delivery state on the `/admin` tenant page. That is a follow-up if the pilot asks.
- Telling admins, staff or families. Read-only and its notices are not touched either.
- SMS and push.
- Any change to the suspended screen (`suspended-notice.tsx`).

### BA — rules

1. **Suspending a club in `/admin` records a `suspended` notice** in the same transaction as the
   suspension. The notice carries the reason exactly as the operator typed it, snapshotted,
   because restoring clears `suspension_reason`.
2. **Restoring a club in `/admin` records a `restored` notice** in the same transaction. It quotes
   no reason. It says that access is back and that nothing was deleted (Rui, 17-11-2026).
3. **Only a real transition records a notice.** Suspending a club that is already suspended, or
   restoring one that is open, records none.
4. **Only an operator's act records a notice.** The trial clock's suspension (`trial-clock.service.ts`)
   records none, because it has `access_closed`. An operator who restores a club the clock closed
   does record a `restored` notice: that restore is an operator's act.
5. **The recipients are every live Owner who has an address**, snapshotted when the notice is
   recorded: `app_user.cached_email`, falling back to `membership.email`. This is the same query
   as `openOverride` in `support.repository.ts`. If no Owner has an address, the notice is still
   recorded, with no recipients, and nothing is sent.
6. **The email is sent after the commit, rendered from the row, and stamped when mail left.** One
   Owner reached means the notice is delivered. A failed send never rolls back the suspension or
   the restore, and is retried by the hourly retry.
7. **The suspension email says, in the club's locale:**
   - which club was suspended, and when (`dd-MM-yyyy HH:mm`, Lisbon)
   - the reason, verbatim: escaped in the HTML part and untouched in the text part
   - that nothing was deleted
   - the support contact
8. **The restore email says:** which club, when access came back, that nothing was deleted, and
   the support contact.
9. **The support contact** is `SUPPORT_EMAIL`, else `NEXT_PUBLIC_SUPPORT_EMAIL`, else
   `suporte@poolse.pt`. This is the fallback the suspended screen uses (decided 12-09-2026). The
   trial notice falls back to null instead, so this email does not copy it.
10. **Both emails link to `/dashboard`.** A suspended Owner sees the suspended screen there, and a
    restored one sees their club.

### Dev notes

**Table.** A new platform-scoped table, `suspension_notice`, shaped like `trial_notice`. Use the
`write-migration` skill.
- Columns:
  - `id`, `organization_id` (FK to `organization`)
  - `kind`: an enum `suspension_notice_kind` with values `suspended` and `restored`
  - `reason text` (null for `restored`), with a CHECK that `kind = 'suspended'` exactly when
    `reason` is not null
  - `occurred_at`, `recipients text[] NOT NULL DEFAULT '{}'`
  - `delivered_at`, `delivery_attempts int NOT NULL DEFAULT 0`, `last_attempt_at`
  - `created_at`
- Grants: `GRANT SELECT, INSERT, UPDATE` to `poolse_platform` only. No grant and no policy for
  `poolse_app`, the two independent reasons `trial_notice` has.
- Add it to `TENANT_TABLES` in `apps/api/src/test/harness.ts`, next to `trial_notice`.
- Document it in `docs/data-model.md` under the platform-scoped tables.

**Why not new kinds on `trial_notice`?** Its key is (tenant, kind, `due_on`), so a club
suspended twice in a day would collide. It has no column for a reason. And an enum value cannot
be removed, so a separate table is the cheaper one to reverse.

**Recording.** In `setSuspension` (`platform.repository.ts`):
- Pass `changeTenant` a `PrepareChange`, so the notice is inserted in the same `tx` as the change.
- Decide rule 3 from `before.suspended_at`, the row that function already locks `FOR UPDATE`.
- `changeTenant` returns no id from a prepared change. Either widen its return by one optional
  field, or have `setSuspension` read back the notice it just wrote. Pick the smaller diff.
- After `changeTenant` resolves, call `deliverSuspensionNotice(id)`. This is the same
  after-commit call `openOverride` makes to `deliverSupportNotice`.

**Sending.** In `owner-notices.ts`:
- Add `deliverSuspensionNotice(id, send = sendEmail)`, a copy of `deliverSupportNotice` in shape.
  It reads the row via `withPlatform`, returns false if the row is delivered or has no
  recipients, sends to each recipient, stamps `delivered_at` if any copy left, and never throws.
- The email builder is a new `notifications/suspension-notice-email.ts` in the style of
  `support-notice-email.ts`: a `COPY` object for pt-PT and en, `escapeHtml` on the reason, and
  a signature line.
- This is API-side email copy, so it does not go through the web i18n layer. pt-PT and en both
  live in the builder, as in every other email here. Check the Portuguese: *suspenso*,
  *reposto*, *nada foi apagado*.

**Retry.** Add a `PLATFORM_KINDS` entry in `delivery-retry.service.ts`:
- `key: 'suspension_notice'`
- the pending query: `delivered_at IS NULL AND cardinality(recipients) > 0`, narrowed by the
  `$1` tenant, with `${due('created_at')}`
- bump `delivery_attempts` and `last_attempt_at`
- `deliver: deliverSuspensionNotice`

**The pilot.** The pilot runs `EMAIL_PROVIDER=console` (10-11-2026), so nothing leaves and the
retry is a no-op. The notice is still recorded, which is what the tests check.

**Traps:**
- Restoring clears `suspension_reason` in the same statement. Read the reason from the request
  or the locked `before` row, never from `organization` afterwards.
- `poolse_platform` reads `app_user` only through the narrow column grant
  (`1794655200000_narrow-login-grants.sql`). Keep the owner query exactly as `openOverride` has
  it, or the grant refuses it.
- The clock writes `suspended_at` itself, not through `setSuspension`. Keep it that way, and
  rule 4 holds by construction. Assert it anyway (QA 5).

### QA

1. **Suspend.** Given a club with two Owners, one signed in with a `cached_email` and one with
   only `membership.email`, when an operator suspends it with the reason
   `Falta de pagamento <b>desde março</b>`, then one `suspended` notice exists with both addresses
   and the reason byte for byte. Both emails are sent after the commit. The HTML part shows the
   tags as text, and both parts carry the support address.
2. **Restore.** Given that suspended club, when an operator restores it, then a `restored`
   notice exists with no reason, and its email says access is back, says nothing was deleted, and
   carries the support address.
3. **No transition.** Suspending a club that is already suspended, or restoring an open one,
   records no notice. Count the rows before and after.
4. **The provider fails.** Given a `send` that returns false, the suspension is still committed
   (`suspended_at` set), the notice stays undelivered, and `DeliveryRetryService.run` (narrowed
   to the club, given a fake `send`, the clock forced past 10 minutes) delivers it and stamps
   `delivered_at`.
5. **The clock records nothing.** Given a trial past its closed period, when the trial clock
   suspends the club, no `suspension_notice` is recorded and the `access_closed` trial notice is
   unchanged. When an operator then restores it, a `restored` notice is recorded.
6. **No Owner address.** Given a club whose Owner has no address, a suspension records a notice
   with no recipients, sends nothing, and the retry never picks it up.
7. **Cross-tenant.** From the tenant connection (`poolse_app`), `SELECT` on `suspension_notice`
   is refused, both for a club's own Owner and for another club's. In
   `packages/db/test/platform-admin.sql`, the tenant role cannot insert one either.
8. **Permission.** `POST /platform/tenants/:id/suspension` as a club Owner who is not a platform
   operator is refused by `PlatformAdminGuard`, and no notice is recorded.
9. **Locale.** A club with `locale = 'en'` gets the English email, and a pt-PT club the
   European Portuguese one. No string in either is left in the other language.

### Acceptance criteria

- [ ] 1. `suspension_notice` exists, platform-scoped, with a migration, a `TENANT_TABLES` entry, a cross-tenant SQL test and a `docs/data-model.md` entry.
- [ ] 2. An operator's suspension and restore each record one notice in the same transaction, and only on a real transition.
- [ ] 3. The trial clock's suspension records none.
- [ ] 4. Every live Owner with an address is snapshotted as a recipient.
- [ ] 5. The email is sent after the commit, rendered from the row, stamped on delivery, and never rolls back the change.
- [ ] 6. The suspension email quotes the reason verbatim (HTML-escaped) and both emails carry the support contact with the suspended screen's fallback.
- [ ] 7. The hourly retry sends an undelivered notice through `deliverSuspensionNotice`.
- [ ] 8. QA 1–9 are integration tests and pass, alongside `pnpm api:test`, `pnpm db:test`, `pnpm typecheck`, `pnpm security:check` and `pnpm pt:check`.
- [ ] 9. `docs/features/platform.md` says Owners are emailed, and `docs/decisions.md` carries the 17-11-2026 line.

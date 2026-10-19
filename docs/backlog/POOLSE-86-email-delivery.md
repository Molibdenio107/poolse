# POOLSE-86 · Email delivery — the notices nobody sends, retries, reminders and opt-outs

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Notifications (roadmap 3.0, email half) · **Priority:** High · **Depends on** `notifications/notifier.ts` (`sendEmail`, Resend, console by default)

### PO — why this exists

Roadmap 3.0 is "records, preferences, push + email delivery". The email half is mostly built already.
`sendEmail` sends through Resend after the commit, and stamps `delivered_at` for:
- water and lab alerts;
- qualification alerts;
- messages and closure warnings to families;
- invitations;
- platform alerts.

Three kinds of row are still recorded and **never sent**:
- `trial_notice`;
- the support override's notice to Owners;
- invoice chasing, which logs only what a person did.

Every sender is also fire-once: a failed Resend call leaves a row "not sent" for ever.

**Not in scope:**
- Push notifications and the mobile app (3.1+).
- SMS.
- An automatic dunning schedule (Rui, 19-10-2026: a person triggers every reminder).
- Attaching an invoice PDF (none exists, and these are internal records, not legal faturas).
- Choosing a provider: Resend is settled in `docs/deploy.md`.

### Slices

Each slice is one vertical, finished on its own.

#### 3.0a — the recorded notices go out, and a failed send is retried (built 19-10-2026)

- **Trial notices** (`trial_notice`) are sent to the recipients the row recorded, after the clock's
  transaction commits, and `delivered_at` is stamped. The wording names the club, the date and what
  happens next (read-only, and how to pay).
- **The support override notice** to every Owner is sent the same way (`notice_delivered_at`), with
  the reason verbatim. The Owner's list stops saying *registado, não enviado* once it is sent.
- **Retry.** An hourly job retries every row still unsent across the delivery tables:
  - `pool_analysis_alert`, `lab_result_alert`, `qualification_alert`, `message_recipient`,
    `platform_alert`, `trial_notice` and the support notice — not `invitation`, whose link is stored as a hash (*Novo link* re-sends one);
  - only rows created within the last **48 h** and older than ten minutes, at most once an hour and **5 retries**, with `delivery_attempts`
    and `last_attempt_at` on each row;
  - under `pg_try_advisory_xact_lock`, so a second instance is a no-op.
  - **It does nothing while `EMAIL_PROVIDER` is console.** Nothing could send, and burning attempts
    would leave real mail unsendable later.
- **What stays the same:** each sender's own wording and recipients. Retry re-renders from the row,
  so a retried email is the email that would have gone first time.

#### 3.0b — an invoice reminder by email (Rui, 19-10-2026)

- **A person triggers it**, never a schedule: *Enviar lembrete por email* per family on **Em dívida**,
  and for several selected at once. Owner and admin, as chasing is.
- **The email** is addressed to the document's payer (guardian, or the adult student) and contains:
  - the club's name;
  - each overdue document's number, date, amount outstanding and due date;
  - the club's own **Como pagar** text: a new free-text setting under Faturação (IBAN, MB WAY number,
    office hours), shown verbatim.
  With no Como pagar text, it says to contact the club.
- **It is a chase.** Each send writes an `invoice_chase` row with a new channel, `poolse_email`, and a
  delivery stamp. Em dívida's "last asked" counts it like any other.
- **Overdue only** (Rui, 19-10-2026): a document past its due date and not fully paid. A family is not chased for what is not late yet.
- **A recent reminder warns and does not block** (Rui, 19-10-2026): the confirmation says when the family was last reminded by email, and a multi-family send leaves anyone reminded in the last 7 days unticked. The person can still send.
- **A payer with no address** is listed on the confirmation by name and gets no row.
- **Limits:** counted against the club's daily email limit (`message_recipients` trigger figures).
- **Wording** is in both languages, chosen by the payer's locale where known, else the club's.

#### 3.0c — opting out of club messages (Rui, 19-10-2026)

- **Only general club messages may be opted out of** (Mensagens). Closure warnings, invoice reminders,
  safety alerts, invitations and account mail always go, because they are about the service, money
  owed or access.
- **Two ways out:**
  - a **one-click link** in every opt-out-able email, which works without a login, because most
    guardians have none;
  - a toggle on **O meu perfil** for those who do.
- **The link** carries a signed, unguessable token per person and club. It goes through one
  `SECURITY DEFINER` function keyed on the token (the `public_water_page()` pattern), and answers the
  same page whatever happened. Opting back in is on the same page.
- **The preview and the send both read it.** `message_recipients()` leaves out an opted-out address,
  and the message's confirmation says how many were left out because they opted out.
- **The opt-out is per club**, not global: a family at two clubs answers each.

### Dev notes

- Senders stay where they are. Retry is one `deliveries` registry: a table, a query for its unsent
  rows, and a function that re-sends one row. Never a second copy of each email's wording.
- Migrations:
  - 3.0a: `delivery_attempts` / `last_attempt_at` on each delivery table.
  - 3.0b: the `poolse_email` chase channel, a delivery stamp on `invoice_chase`, and
    `organization.payment_instructions`.
  - 3.0c: `message_opt_out` (tenant-scoped, keyed on the address as `message_recipients()` resolves
    it) and the token function.
- Every new route earns a `requireRole` and a role-probe line. The public opt-out route goes in
  `PUBLIC_ROUTES`, throttled per token.

### Acceptance criteria

1. 3.0a: a trial notice and a support override notice reach their recipients and are stamped. A send
   that failed is retried hourly within 48 h, up to 5 times, and never while email is console.
2. 3.0b: a person sends a reminder from Em dívida; it lists the overdue documents and the club's Como
   pagar text, and is logged as a chase with its own channel.
3. 3.0c: a family opts out of club messages by a link without logging in, or on their profile. A
   message's preview and send both leave them out and say so. Nothing else is opt-out-able.
4. Both languages, light and dark, role probe, and `docs/features/messages.md` / `invoicing.md` /
   `trial.md` / `platform.md` updated. The go-live checklist keeps "verify the sending domain".

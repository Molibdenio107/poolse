# POOLSE-209 · Families' replies reach the club's own email, and the subscription's invoices go to a billing email of the club's choosing

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Email / Club settings / Billing · **Priority:** High (pre go-live) · **Depends on** POOLSE-86 (email delivery), Stripe 2.4 (subscription)

### PO — why this exists

Rui, 09-11-2026: *"its a good thing to have the email from .env configurable per tenant on facilities configuration. So this is either created when the client first enters poolse and sets up email etc, and then it can be changed on 'Dados do clube' since its only reachable by owner and admin. This should also be reflected when buying poolse, on the subscription screen for the owner user details."*

Today every email leaves as `EMAIL_FROM` from `.env` and ends with *"As respostas a este email não chegam ao clube."* A parent who replies to an invitation or a message reaches nobody.

**Decided (Rui, 09-11-2026):**
- Emails go **from Poolse's verified address with the club's name** and **Reply-To the club's email**, not from the club's own address. Sending as a club's Gmail fails DMARC and lands in spam. Sending from a club's own domain needs per-club DNS records and a paid Resend plan, which breaks the free pilot's cost rule.
- The club's email is **asked at club creation**, defaulting to the owner's, and editable in *Dados do clube* (owner and admin).
- The subscription has a **separate billing email** (Stripe's invoices and receipts, often an accountant), defaulting to the owner's email.

**Not in scope:** sending from a club's own domain (a later, paid option with a DNS checker); several reply addresses per site; inbound email handling beyond what POOLSE-114 does; SMS.

### BA — rules

1. **The club's email** (`organization.reply_email`) is where families' replies go. Owner and admin set it in *Dados do clube*; nobody else sees the field. It is validated as an address and required once set (it can be changed, not cleared).
2. **At club creation**, the form asks *"Email do clube (para respostas das famílias)"*, prefilled with the owner's login email.
3. **Every email a club sends** (invitations, messages, cancellations, reminders, lesson notices, POOLSE-208's later) leaves as `"<Nome do clube> <EMAIL_FROM address>"` with `Reply-To: <reply_email>`. Poolse's own emails (platform, trial, support) keep Poolse's name and no club Reply-To.
4. The footer line changes from *"As respostas a este email não chegam ao clube."* to *"Enviado por {clube} através do Poolse. Pode responder a este email."* (pt-PT and en). With no `reply_email` (a club created before this ticket that never set one), Reply-To is the owner's email and the footer says the same.
5. **The billing email** (`organization.billing_email`) is on the owner's subscription screen: *"Email de faturação"*, prefilled with the owner's email, editable by the owner only. It is the Stripe customer's `email`: set when the customer is created (today it is created with no email), and updated in Stripe when changed. It never receives family mail.
6. The club's display name in `From` is the club's own name, stripped of characters a mail header cannot carry (quotes, angle brackets, line breaks).

### Dev notes

- Migration (`write-migration`): `organization.reply_email citext`, `organization.billing_email citext`, each with a format CHECK. Column grants: owner/admin write `reply_email` through the app route; `billing_email` owner only. The platform's column-grant rule ("the platform writes through column grants") stays intact: neither is a platform column.
- `apps/api/src/notifications/notifier.ts`: `sender()` gains a `club` variant `{ name, replyTo }`; `sendEmail` passes `reply_to` to Resend. The two footers live in `club-message-email.ts` and `invoice-reminder-email.ts`; grep for the sentence, there may be more.
- Club creation: `dashboard/create-organization-form.tsx` and `provision_organization(...)` take the email.
- *Dados do clube* is the `clubData` tab on the site page (`dashboard/facilities/[facilityId]/page.tsx`).
- Stripe: `customerFor` in `billing/subscription.controller.ts` creates the customer with `email: billing_email`; a change calls `customers.update`. A failure to reach Stripe saves locally and says so, never a 500.
- Header injection is the trap: a club name with a newline or quote must never reach a raw header. Use the provider's structured `from` with a sanitised name.
- `poolse-security-review` (a new write route and an outbound header built from tenant data).

### QA

1. Given a new club, when the owner creates it, then the email field is prefilled with their login email and saved as `reply_email`.
2. Given `reply_email = secretaria@clube.pt`, when an invitation is sent, then the provider receives `from: "Clube X <notificacoes@…>"` and `reply_to: secretaria@clube.pt`, and the footer says replies reach the club.
3. Given a club with no `reply_email`, then Reply-To is the owner's email.
4. An admin changes the club email in *Dados do clube*; an instructor's `PATCH` gets 403; club B's id from club A gets 404.
5. The owner changes the billing email; the Stripe customer's email changes (Stripe mocked); an admin cannot change it (403).
6. A club named `Clube "X"\r\nBcc: a@b.c` sends with a clean display name and no extra header.
7. Light and dark: the two new fields read in both themes; errors in words.

### Acceptance criteria

- [ ] `reply_email` and `billing_email` on `organization`, with format checks and the right roles.
- [ ] Asked at club creation (prefilled); editable in *Dados do clube* (owner, admin); billing email on the subscription screen (owner).
- [ ] Every club email: club name in From, Reply-To the club, the new footer; Poolse's own mail unchanged.
- [ ] Stripe customer created and updated with the billing email.
- [ ] QA 1–7 as tests; security review done; docs (`docs/features/messages.md`, billing, `data-model.md`) say it.

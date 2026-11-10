# POOLSE-210 · Families see the club's own phone in the app, at the foot of every club email and on the public pages

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Club settings / Family app / Email / Public pages · **Priority:** High (pre go-live) · **Depends on** POOLSE-209 (the club's email)

### PO — why this exists

Rui, 10-11-2026: *"Regarding yesterdays main email account to send emails and recevie through poolse, i think its also apporpriate to have the same thing for a mobile phone, when poolse contacts via mobile phone."*

Poolse never sends from a phone. A WhatsApp is a `wa.me` link opened on a staff member's own phone (POOLSE-191), and the message leaves from whatever number that phone has. A phone invitation travels the same way, and SMS is deferred. So, unlike email, there is no sender for Poolse to set. What was missing is that the club had **no phone of its own** in Poolse: the only club-level number was `payment_mbway_phone`, and `contact_phone` is a person's. A family that gets a WhatsApp from an instructor's personal mobile has no official number to save or call back. The email equivalent of POOLSE-209 is therefore a number the club *publishes*.

**Decided (Rui, 10-11-2026):** a club contact phone, asked at creation, edited in *Dados do clube*, and shown where families look for the club.

**Not in scope:** sending SMS or WhatsApp from a Poolse or club number (a paid provider such as Twilio or the WhatsApp Business API, a per-message cost that breaks the free pilot, and per-club number registration; a later, paid option, as own-domain email is); several numbers per site; office hours beside the number.

### BA — rules

1. **The club's phone** (`organization.contact_phone`) is set by the owner and the admin in *Dados do clube › Telefone do clube*. It is optional and can be cleared: blank publishes none.
2. It is typed the way people type it (`912 345 678`, `21 234 5678`, `+351…`, `00351…`, a foreign `+34…`) and stored as `+` and 8 to 15 digits. A number with no country code is Portuguese (it starts 2 or 9). Anything else is refused with *"Indique um número de telefone…"*. The rule is `whatsappNumber`'s, so a stored number always opens a WhatsApp conversation.
3. **At club creation** the form asks *"Telefone do clube (opcional)"*, **blank** (Rui, 10-11-2026). Unlike the reply email it does not prefill or fall back to the owner's own mobile: the owner's mobile is not the club's to publish.
4. **The family app** (*Perfil*, family home) shows *Contactar {clube}* with the phone (a `tel:` link), *Escrever pelo WhatsApp* (`wa.me`, no prefilled text) and the club's reply email (`mailto:`, POOLSE-209's address or the owner's). The card is left out when there is neither a phone nor an email.
5. **Every club email** ends with *"Telefone do clube: +351 212 345 678"* (in English, *"Club phone: …"*) in the club's language when a phone is published. This is added once, in `sendEmail`, for every email stamped with `clubEmail`. Poolse's own mail never carries it.
6. **The public pages** (water page, pre-registration form) show the phone as a `tel:` link beside the complaints book.
7. A change is audited as `organization.contact_phone_changed` with the number.

### Dev notes

- Migration `1794655000000_club-contact-phone.sql`: the column, the CHECK `organization_contact_phone_format` (`^\+[0-9]{8,15}$`), and `GRANT UPDATE (contact_phone)`. It adds one key, `contactPhone`, to `public_water_page` and `public_lead_form` **in place** (`pg_get_functiondef` + `replace`, failing loudly if the text moved). A first version restated both from their last full copies on disk and silently dropped the water page's module filter, which 1791799200000 had added in place; the modules test caught it. Never restate a definer function that a later migration edited in place.
- `@poolse/rules`: `normalizeClubPhone` and `formatClubPhone` in `whatsapp.ts`.
- API: `PUT /settings/contact-phone` (owner, admin); `contactPhone` on `POST /organizations`; `GET /app/club-contact` (instructor, guardian, student) returns `{ name, phone, email }` and nothing else. `TaxSettings.contactPhone`.
- Email: `withClubPhone(email, identity)` in `notifications/notifier.ts`; `clubIdentity` also reads `contact_phone` and `locale`.
- Web: `ContactPhonePanel` in `tax-panel.tsx`; the create form; the card on `app/perfil/page.tsx`; `PublicNotices` takes `phone`.
- The trap: both public functions have a test that lists exactly which keys leave (`public-link.integration.test.ts` 71, `packages/db/test/lead.sql` 1a). Adding the key is deliberate, and both were updated.

### QA

1. Given an admin, when they save `21 234 5678`, then the field reads `+351 212 345 678` after a reload.
2. Given an admin, when they save `ligue`, then the save is refused with a 400 and the field says to enter a phone number.
3. Given a guardian or a student, when they call `PUT /settings/contact-phone`, then the answer is 403. The same holds for an instructor and for maintenance.
4. Given maintenance, when they call `GET /app/club-contact`, then the answer is 403.
5. Given a guardian, when they read `GET /app/club-contact`, then exactly `name`, `phone` and `email` come back.
6. Given a club with a phone, when it sends any email, then the email ends with *Telefone do clube: …* in the club's language. With no phone, or for Poolse's own mail, nothing is added.
7. Given the database, when `contact_phone` is set to `912345678`, `+351 912 345 678`, `+12` or `ligue`, then the CHECK refuses it.
8. Given a club with a phone, when a family opens *Perfil* on a phone, in light and in dark mode, then *Contactar {clube}* shows the number, *Escrever pelo WhatsApp* and the email.
9. Given a club with no phone, when its public pages render, then they are unchanged apart from carrying `contactPhone: null`.
10. Given another club's phone, when this club's family reads, then that phone is never returned: the read is `withOrg` on the reader's own club.

### Acceptance criteria

- [x] `organization.contact_phone` with its CHECK and column grant; the migration reverses cleanly.
- [x] Owner and admin set it in *Dados do clube*; it is optional at creation and blank by default.
- [x] Family app *Perfil* shows the phone, WhatsApp and email.
- [x] Every club email ends with the phone when one is published.
- [x] Both public pages show it.
- [x] Role probe, notifier and rule tests; pt-PT and en strings; `docs/data-model.md`, `docs/features/messages.md` and the conventions updated.

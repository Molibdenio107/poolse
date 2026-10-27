# POOLSE-114 · Competição: results arrive by email, and the page explains how to get the file

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Competition · **Priority:** Medium (pilot) · **Depends on** [POOLSE-81](./POOLSE-81-competition-pathway-and-meet-results.md), [POOLSE-86](./POOLSE-86-email-delivery.md) (Resend), [POOLSE-87](./POOLSE-87-modules-per-club.md)

### PO — why this exists

Rui, 23-10-2026: *"I want the owner/admin to enter their FPN login in Poolse, Poolse fetches the file for them and converts it. Poolse as a middle man."*

**Checked the same evening:** fpnatacao.pt sits behind a Cloudflare "verify you are human" gate. A server (NestJS `fetch`, or Playwright on Railway) is exactly what that gate exists to stop, and nothing that gets around it will be built. So the server-side login is **ruled out**, not deferred. Rui, 23-10-2026: *"Never store the credentials."* — moot now, and still the rule.

What the idea was really after: the coach should not have to hunt for the file and upload it by hand. Two things get most of that without touching FPN at all:

1. **Results by email.** Each club gets an inbound address. The coach forwards the email that carries the LENEX file (from the organiser, from FPN, or a Splash export they mail themselves), and the file shows up on the Competitions page, ready to import. No credentials, no scraping.
2. **The page says how to get the file.** Today the import control assumes you know what a LENEX is and where it comes from. A short explanation next to it, with the FPN link and the club's inbound address, closes that gap — Rui, 23-10-2026: *"we need that brief explanation (tooltip or similar) on the Competitions page."*

**What exists.** `import-meet.tsx` (POOLSE-81): file dropped anywhere on the page or chosen → club → preview (matched, proposals, new, corrected, skipped, unmatched) → one press writes all or none. `FPN_RESULTS_URL` constant (POOLSE-111). `sendEmail` through Resend (`notifications/notifier.ts`). Tenant file storage (`files/storage.ts`, `upload-check.ts`). `parseLenex` + `LENEX_MAX_BYTES` in `apps/web/src/lib/lenex.ts`.

**Not in scope:** logging in to FPN from the server (ruled out above); importing without the preview step (a person always confirms); a browser extension that catches the download (ideas log, after the pilot); PDF export of a meet's results (separate ticket if Rui wants it); relays (POOLSE-81).

### BA — rules

1. **One inbound address per club.** `resultados-<token>@<INBOUND_DOMAIN>`, where the token is 20 random URL-safe characters stored on the tenant. Shown on the Competitions page with a copy button. Owner/Admin can **regenerate** it (old address stops working at once; audited).
2. **Who may send.** A message is accepted only when the sender address (case-insensitive, `From`, not `Reply-To`) matches an active Owner, Admin or Instructor of that tenant. Anything else is dropped and logged (tenant, sender, reason); **no reply** to unknown senders — no backscatter.
3. **What is taken from the message.** Every attachment whose name ends in `.lef` or `.lxf` and is ≤ `LENEX_MAX_BYTES`, and that `parseLenex` can read. A message may carry several. Other attachments and the body are ignored. If an accepted sender's message carries nothing usable, reply once in their language: *"Não encontrámos nenhum ficheiro LENEX (.lef/.lxf) nesta mensagem."*
4. **The inbox.** Each accepted file becomes a row: who sent it, when, filename, the meet's name and start date read from the file, status `pending` → `imported` (links the meet) or `discarded`. Shown on the Competitions page as **Recebidos por email**, newest first, with a count badge; the section is hidden when empty. Paginated at 15 (it grows with the club). A file already imported into a meet is marked, not hidden.
5. **Importing from the inbox.** *Importar* on a row opens the existing import dialog with the file preloaded — club, preview and confirm exactly as today. On success the row becomes `imported` and links the meet. *Rejeitar* (Owner/Admin) soft-deletes with reason optional, audited. A pending row older than 90 days shows a quiet "antigo" tag; nothing is deleted automatically.
6. **The explanation.** Next to the import control, an info icon opens a popover **Como obter os resultados** (also reachable from the empty inbox). Three short items, in this order:
   - *Descarregue o ficheiro LENEX (.lef/.lxf) na página de resultados da FPN e largue-o nesta página.* — link `FPN_RESULTS_URL`.
   - *Ou reencaminhe o email com o ficheiro para* `<address>` — copy button — *e ele aparece aqui para confirmar.*
   - *Só aceitamos emails enviados por Owner, Admin ou Instrutores do clube. O Poolse não acede ao site da FPN por si: a FPN exige verificação humana.*
   Plain words; no mention of Cloudflare by name.
7. **Module gate.** Everything here belongs to the Competition module (POOLSE-87): a club without it has no address, and inbound mail to a token of a club without the module is dropped as in rule 2.
8. **Notice.** When a file lands, the tenant's Owners/Admins and the sender get the in-app notification used for qualification alerts (no email — they just sent one).

### Dev notes

- **Provider:** Resend Inbound (Resend is settled, POOLSE-86). MX for `INBOUND_DOMAIN` + webhook `POST /inbound/resend` on the API: public, Svix-signature verified, rate-limited, body size capped, idempotent on the provider's message id. Document the DNS in `docs/deploy.md`.
- **Dev/staging:** `EMAIL_PROVIDER=console` already exists; add a dev-only `POST /inbound/dev` that accepts a multipart file + `from`, so the whole path is testable without a domain. `INBOUND_DOMAIN` is an env var — the product name is still provisional.
- **Migration** (write-migration skill): `tenants.inbound_token` (unique, nullable until the module is on) and `meet_inbox` (tenant key, `file_id`, `received_from`, `received_at`, `meet_name`, `meet_starts_on`, `status`, `meet_id` nullable, `discarded_at`/`discarded_by`, `provider_message_id` unique). RLS like every tenant table. Tenant lookup by token is the one query that runs before a tenant is known — it goes through a `SECURITY DEFINER` function that returns only the tenant id.
- **Storage:** reuse `files/storage.ts`; the inbox row points at the file. Parsing happens once at receipt (to reject junk and read name/date) and again in the dialog as today — the file is the source of truth, not the row.
- **Dialog:** `ImportMeet` gains an optional `preloaded: { inboxId, file }`; the drop/choose step is skipped when present. Everything after it is untouched.
- **Audit:** regenerate address, discard.
- `docs/decisions.md`: append *"23-10-2026 — FPN fetch from the server ruled out (Cloudflare human check). Results reach Poolse by email forward or manual upload; a person always confirms the import."*
- Both languages; keyboard; light and dark.

### QA — scenarios

1. **Given** an Owner forwards a message with one `.lxf` to the club's address, **when** the webhook runs, **then** an inbox row appears with meet name, date and sender; Owners/Admins and the sender get the in-app notice; the badge counts 1.
2. **Given** the same message from an address that is nobody in the club, **then** nothing is created, nothing is sent back, and the drop is logged with tenant and reason.
3. **Given** an accepted sender's message with only a PDF, **then** no row, and one reply in their language saying no LENEX was found.
4. **Given** a message with two LENEX files and one oversized `.lef`, **then** two rows, and the oversized one is logged as rejected.
5. **Given** the same provider message delivered twice, **then** one row.
6. **Given** a pending row, **when** I press *Importar*, **then** the dialog opens at the club step with the file loaded; after confirm the row reads `imported` and links the meet.
7. **Given** an Instructor, **then** *Rejeitar* is absent, and `DELETE /meet-inbox/:id` issued directly returns 403. Cross-tenant: a row id from another tenant returns 404.
8. **Given** Owner regenerates the address, **then** a message to the old one is dropped (rule 2 path, reason `unknown_token`), and the change is audited.
9. **Given** a club with the Competition module off, **then** no address is shown and mail to its old token is dropped.
10. The popover reads correctly in pt-PT and en, both themes, and the copy button copies the full address.

### Acceptance criteria

1. Email → inbox → existing dialog, with the sender rule and idempotency enforced in the API.
2. The explanation popover with FPN link, address and copy button.
3. Module-gated, audited, both languages, light and dark, and the dev endpoint so staging can be tested without DNS.

### Open questions

1. **How does the results file reach the pilot today?** (email from the organiser / FPN download / Splash export) — ask the club. It changes the wording of the popover's first item, nothing else.
2. Should Instructors be allowed senders, or Owner/Admin only? **Default: allowed** — the coach is the one who has the file.
3. `INBOUND_DOMAIN` — depends on the name decision; env var until then.

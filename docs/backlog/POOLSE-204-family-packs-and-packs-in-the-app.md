# POOLSE-204 · A family pack, the entries left in the app, and buying a pack from the phone

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Reception / Mobile app / Billing · **Priority:** Medium (pilot) · **Depends on** [POOLSE-68](./POOLSE-68-free-swim-passes-and-check-in.md), [POOLSE-203](./POOLSE-203-a-pass-price-per-category.md) · **Absorbs** the free-swim half of [POOLSE-121](./POOLSE-121-free-swim-and-enrolment-from-the-phone.md) (its open points answered here)

### As built (08-11-2026) — wins over what follows

- **A child may hold a pass** (Rui, 08-11-2026): `pass.student_id`, one holder by CHECK. A guardian buys a child their own personal pack, priced by the child's categories; at the desk it shows in the guardian's panel (*de Tomás*), where the child is checked in.
- **Owed phone packs** have their own block on *Pagamentos*, *Natação livre por pagar* (Rui, 08-11-2026), with the document number linking to *Extratos*; the fee lists are untouched.
- **A family pack sells at its base price**: `pass_price_for()` ignores categories for a shareable product, because a category-priced pass is personal (POOLSE-203). It is bought for oneself only (400 otherwise).
- **Schema** (migration `1794654500000_family-packs.sql`): `pass_product.shareable`, `sold_in_app`; `pass.student_id`, `shared`, `sold_via`, `purchase_key`; who swam on `pass_check_in` (backfilled to the holder); `pass_family()`; `pass_current.paid`; the check-in trigger's three additions; `pass_price_for` with an optional student.
- **API**: reception's check-in takes an optional `membershipId` / `studentId`; `GET /facilities/:id/reception/people/:id/passes` adds the holder, `shared`, `soldVia`, `paid` and `family`. `GET /app/passes` and `POST /app/passes` (`app/app-passes.repository.ts`), on the sale's own body (`sellPassIn`). Minor: 403. Unpaid: 409 naming the document. Same key: the same sale, `repeated: true`; another buyer's key: 409. A typed amount: 400.
- **Who may buy for a child**: any live guardian of that child, who then pays. Not only the payer of the child's fees.
- **The monthly free-swim figure on Receção counts a phone sale when it is sold**, unpaid or not, as it counts any document line. Proposal: count it once paid. Not built.
- **Security review** (08-11-2026, diff): no S1 to S3. Two probes added as tests (another buyer's key, an archived guardian link). Every new route has role-probe lines.
- **Tests**: `packages/db/test/family-packs.sql` (QA 1, 2, 5, isolation), `apps/api/src/app/app-passes.integration.test.ts` (QA 1, 3, 4, 6, 7, the child's own pack, the two probes). Walked in a browser: the phone purchase, the second purchase refused, the *Pagamentos* block, and the desk (the unpaid line, *Quem entra*, the refusal).

### Decided (Rui, 08-11-2026)

- **A family pack is used by the payer's family**: the payer, plus the children they are a live guardian of, worked out from `guardian_link`.
- **One check-in per person**, even when two come in on one pack.
- **Bought on the phone:** an invoice line that is **owed**, and the pack **works only once paid**. It stays owed until paid; nothing auto-cancels it.
- **One unpaid phone pack at a time.** A second purchase is refused, in words, until the first is paid.
- The app shows **entries left and valid until**.

### BA — rules

1. `pass_product.shareable boolean` (a *Pack família*). Only a shareable product sells a shared pass. Category-priced passes are personal (POOLSE-203).
2. **Who may check in on a pass**: its holder; and on a shared pass, also anyone in `pass_family(pass)`, which is one SQL function (the holder plus the children they guard today). Checked when the entry is made, in the check-in trigger.
3. `pass_check_in` gains **who swam** (`membership_id` or `student_id`, exactly one). Reception picks the person, or the QR says who (POOLSE-205). The entry count stays derived: `N − count(check-ins)`.
4. **Paid before use**, for phone sales: `pass.sold_via` = `reception` | `app`. An `app` pass with its line not fully paid is refused at check-in: *Este pack ainda não está pago.* A reception sale keeps today's behaviour.
5. **Phone purchase** (guardian or adult student): pick a product the club marks as *à venda na app* and who it's for (self, or a child for a personal pack). Poolse prices it with `pass_price_for` and issues the line through 2.2. The pack appears in *Pagamentos → Em dívida* with the club's IBAN / MB WAY (POOLSE-178) and in *Extratos* (POOLSE-201).
6. **Limit:** a reader with an unpaid `app` pass cannot buy another. 409 with words.
7. **In the app**, *Natação livre* on *Início* or *Perfil* lists each live pass: *7 de 10 entradas · válido até 31-12 · Pack família* or *Por pagar*. No list of other people's entries; a guardian sees their own and their children's.

### Security

- A purchase is a write from a family phone: server-side price only (never a price from the client), role check, idempotency key (no double tap, no two documents), throttled like the other family writes.
- `pass_family` reads guardian links at check-in time. A guardian whose link is archived loses the family pack's use for that child at once.
- A child's own login may see the passes they may use. It cannot buy (minors don't buy, same rule as the FPN form).

### QA

1. A shared pack of 10, with the parent and child checking in: two entries are used and 8 are left; each check-in names its person.
2. A personal pack: the child's check-in → refused.
3. An `app` pack unpaid → check-in refused; once paid → allowed.
4. A second phone purchase while one is unpaid → 409.
5. A guardian link archived → the shared pack refuses that child.
6. A double POST with the same idempotency key → one document.
7. A minor's own login → POST purchase 403.

### Acceptance criteria
- [ ] Migration: `shareable`, `sold_via`, who swam on `pass_check_in`, `pass_family`.
- [ ] Reception: pick the person at check-in; pack type on the product panel.
- [ ] App: passes with entries left; purchase flow; refusals in words.
- [ ] POOLSE-121's free-swim open points marked answered; QA 1–7.

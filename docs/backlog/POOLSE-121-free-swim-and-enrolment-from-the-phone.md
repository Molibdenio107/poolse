# POOLSE-121 · The app: buy a free-swim entry or join a class from the phone

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Reception / Students / Billing · **Priority:** Low (after the pilot's first month) · **Depends on** [POOLSE-68](./POOLSE-68-free-swim-passes-and-check-in.md), [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md), [POOLSE-94](./POOLSE-94-club-payment-details-iban-mbway.md), [POOLSE-120](./POOLSE-120-attention-circles.md) (the circles it raises)

### PO — why this exists

Rui, 28-10-2026, while asking for the attention circles: *"imagine that a student or a person enrols in a new class or gets into the free swim through the phone"*. Neither is possible today. Free swim is sold at reception, and a family asks for a class through the public pre-registration form. This ticket is the self-service half; POOLSE-120's circles tell the office when it happens.

**Not in scope** until the open points are answered: card or MB WAY payment taken in the app (Stripe for a club's own customers is a separate decision from Poolse's own subscription); refunds; a waiting list.

### BA — rules (to be decided)

1. A logged-in family member or adult student sees the club's free-swim products (POOLSE-68's `pass` products) and, for a child or themselves, turmas with free seats (`session_free_seats`, POOLSE-110's picker).
2. **Open:** is a purchase paid in the app, or recorded as owed and paid at reception? The default proposal is *owed*: an invoice line with no payment yet, shown in *Em dívida*, with the club's `payTo` details. It needs no payment provider, and the pass's entries count from the first check-in.
3. **Open:** does joining a class need the office's approval (a *pedido*), or does it enrol directly when there is a seat? The default proposal is *a pedido*, the same queue the public form fills, because a club checks levels.
4. Either way, the office's circle (POOLSE-120) counts it until it is handled.

### Dev notes

Answer the two open points first. If *owed* and *pedido*, the write paths exist: `invoice_line.pass_id` (POOLSE-68), and `submit_lead()` or a logged-in twin of it (POOLSE-69). What is new is the app screens and their role checks.

### Acceptance criteria

To be written once the two open points are answered.

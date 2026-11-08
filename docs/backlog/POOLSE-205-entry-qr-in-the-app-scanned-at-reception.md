# POOLSE-205 · An entry QR in the app that changes every 30 seconds, scanned at reception

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Reception / Security · **Priority:** Low (after the pilot's first month) · **Depends on** [POOLSE-204](./POOLSE-204-family-packs-and-packs-in-the-app.md) (who swam on a check-in)

### PO — why this exists

Rui, 08-11-2026: *"add to each student on the mobile app a bar code or QR code to access the pool gate, like many pools or gyms use today."* The pilot has **no gate**, so the first step is reception scanning the code (decided). A turnstile is a later ticket: a QR reader on the gate, wired by relay or Wiegand, plus a small bridge box on the club network. One club paid about 1,300 € for a single reader.

A fixed QR gets screenshotted and shared. Gym products use codes that rotate every 25–30 seconds. A PWA cannot block screenshots, so the rotating code is the protection.

### Decided (Rui, 08-11-2026)

- Reception scan first, no hardware beyond a tablet camera or a USB scanner.
- A child's code is on **both** the guardian's phone (switch child) and the child's own login.

### BA — rules

1. *Entrada* in the app: a full-screen QR for the chosen person, refreshed every **30 s** with a countdown, at full brightness, plus the person's name and photo for reception to compare. A guardian switches between children.
2. **The code carries no personal data**: a signed token `{tenant, person, issued_at, nonce}`, signed with HMAC under a per-tenant secret from the secrets store, valid 45 s (30 s plus clock slack).
3. **Reception scans** with the camera (in the browser) or a USB scanner typing into a focused field. The server checks the signature, expiry, tenant and nonce (single use, stored until expiry). It then shows the person and their usable passes, and the check-in goes through POOLSE-204's rules (paid, family, entries left, capacity 409).
4. A code from another club, an expired one or a reused one is refused in words. Each refusal is logged for the office, without the token.
5. No internet at reception: refuse the scan and fall back to search by name, which already exists. No offline validation in v1.

### Security

- Secret rotation: keep two keys (current and previous), so rotating doesn't break codes in flight.
- The scan endpoint is reception-role only and throttled. The QR endpoint is the reader's own people only (self, or children they guard, or self on a child's login).
- No token in URLs or logs; `Cache-Control: no-store`; `poolse-security-review` before go-live.

### QA

1. A fresh code → the person is found. The same code twice → the second is refused (*já usado*).
2. A code 60 s old → refused (*expirado*).
3. A code signed for club A, scanned at club B → refused.
4. A tampered payload → refused.
5. A guardian asks for another family's child's code → 404.
6. An instructor calls the scan endpoint → 403.

### Acceptance criteria
- [ ] Token signing and verification with a single-use nonce; key rotation.
- [ ] *Entrada* screen in the app; scan field and camera on reception.
- [ ] QA 1–6; security review.
- [ ] A follow-up ticket for the turnstile, written once the club chooses hardware.

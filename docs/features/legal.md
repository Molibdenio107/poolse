# Privacy policy and terms

Written 10-11-2026 for the pilot (go-live review). Rui's call: no lawyer for the pilot; a paying
club gets them reviewed first.

## Where

- `/privacidade` and `/termos` (pt-PT), `/en/privacy` and `/en/terms` (en). Static, public
  (listed in `middleware.ts`), drawn by `LegalPage` in `apps/web/src/marketing/legal.tsx`.
- Linked from the marketing footer, under the sign-up form ("Ao criar uma conta, aceita…"), and
  beside the consent box of a club's public registration form (`/inscricao/<slug>`).
- The words are `legal.*` in both catalogues. A body is paragraphs split by a blank line; a
  paragraph whose lines all start with `- ` is a list. The contact is `NEXT_PUBLIC_SUPPORT_EMAIL`.

## What it states, and where that comes from

A change to any of these is a change to the policy, in the same commit:

- **Roles**: the club is controller for its people; Poolse is processor (art. 28). The terms carry
  the processor commitments, so they double as the DPA for the pilot.
- **Retention**: `docs/features/retention.md` (1 y health, 5 y identity, invoices 10 y, leads 12
  months then 5 y), `docs/features/trial.md` (60 days after a club stops), backups 30 days.
- **Who sees what**: the role rules, instructors by sport (POOLSE-145), classmates (POOLSE-194),
  app views (POOLSE-188), support never reads health data or ID documents.
- **Processors and regions**: Clerk, Vercel, Railway (EU), Cloudflare R2 (EU), GitHub, Resend,
  Stripe, Sentry, Anthropic, Open-Meteo. Railway and R2 say EU: production must be created in an
  EU region / EU jurisdiction, or the policy is wrong.
- **Cookies**: necessary only (session, active club, locale, theme).

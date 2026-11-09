# Marketing pages

`/` (pt-PT) and `/en`, plus `/pricing` and `/en/pricing`. Static: no session, no cookies, prerendered.
Code in `apps/web/src/marketing/`; copy under `marketing.*` in both catalogues.

## The landing page (redesigned 09-11-2026, Rui)

Hero, who it is for, three pillars (lessons, fees, the pool), the phone apps, trust, *E ainda*,
*A caminho*, and a closing call to sign up.

- **Honest by rule.** No customer names, logos, counts or testimonials until they exist. What is not
  built is listed under *A caminho* (certified invoicing, paying in the app), and says what happens today.
- **Screenshots are real.** `apps/web/public/marketing/<name>-{light,dark}.webp`, captured from the
  running app with demonstration data; the club's name is shown as *Clube Exemplo* and the seed's
  `Ref ·` / `E2E ·` prefixes are removed. A line under the hero says the data is a demonstration.
  The dark copy shows in dark mode (`dark:` classes, one `<Image>` each).
- **Images are `unoptimized`**: the files are already WebP at display size, so the free tier never pays for resizing.
- **Re-taking them**: desk shots from Clube Medida (`pnpm --filter @poolse/db seed --size=club`, the e2e owner is
  its admin; set the `poolse_org` cookie), 1280×800 at 1.5×; the phone shot from the e2e instructor, 390 wide at 2×.
  Hide `nextjs-portal` before the capture.

# POOLSE-91 · Voltar always returns to where you came from

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug / UX rule · **Area:** Global / Navigation · **Priority:** High · **Depends on** `lib/back.ts` (`backTarget`, `withFrom`), `components/back-link.tsx`

### PO — why this exists

Rui's test pass, 22-10-2026: *"back button should always return to the previous context it was, anywhere when navigating on the app."*

`BackLink` mostly points at a fixed parent picked once per page. `lib/back.ts` already gives a link a way to say where it was followed from (`?from=`), but only 8 links use it. Anywhere else, Voltar lands on the page's default parent. That is often not where the person was.

Cases found in the test pass:

| # | Where | What happens | Expected |
|---|---|---|---|
| 1 | Dashboard → subscription link (`/dashboard/profile/subscription`) | No Voltar at all: the page renders `PageShell` without `back` | Voltar to the dashboard (or wherever it was opened from, e.g. Profile) |
| 2 | Dashboard → *Pedidos* widget (`/dashboard/students/pedidos`) → Voltar | Lands on the register (`back` is hard-coded to `/dashboard/students`) | Back to the dashboard |
| 3 | Site → *Manutenção* tab → a task → Voltar | Does not return to the tab the person was on | Back to `…/facilities/<id>?tab=maintenance` (and the same section, page or filter) |
| 4 | Staff → Qualificações → a person → Voltar | Lands on the person's default parent, not the qualifications list | Back to the qualifications list, same section and page |
| 5 | Staff (reached from the menu) | Shows a Voltar to the dashboard, which makes no sense for a top-level menu entry | No Voltar when the page was opened from the menu |

**The rule (Rui, 22-10-2026):** Voltar returns to the screen and context the person came from: the same tab, section, page and filters. When a page is opened from the main menu, it has no Voltar.

**Not in scope:**
- The browser's own back button, which keeps working as it does today.
- Breadcrumbs.

### BA — rules

1. **Every in-app link that opens a detail or another section carries its origin.** That covers list → detail, widget → page, tab → detail, and one section → another. "Origin" is the full path *with its query string*: `?tab=`, `?section=`, `?page=`, search and filters.
2. **A page opened with no origin falls back to its natural parent.** A page that is a menu destination (Dashboard, Alunos, Turmas, Instalações, Staff, Faturação, Calendário, Receção) shows **no** Voltar when it has no origin.
3. **Chains work:** dashboard → site → task → Voltar → site (with its tab) → Voltar → dashboard. Each hop keeps the origin it was given.
4. **After a form submit and redirect** (create, archive), Voltar on the landing page points to the list the form was opened from, never back to the form.
5. **Accessible name**: the existing `backLabelKey` table names the destination. New destinations get a label: `profile`, `subscription`, `students/pedidos`, `qualifications`, `tasks`, `incidents`.

### Dev notes

- Keep the `href` + `?from=` design. **Do not** switch to `history.back()`: `back-link.tsx` and `lib/back.ts` explain why (redirects, email links, open-redirect validation). This ticket finishes rolling that design out.
- Sweep: `grep -rn "href=" app/(app)/dashboard` for links into another page or a detail, and wrap them with `withFrom(target, currentPathWithQuery)`. Client components need the current path plus search params (`usePathname` + `useSearchParams`). Server pages build it from `searchParams`.
- Pages to change, from the test pass:
  - `profile/subscription/page.tsx`: add `back` via `backTarget(from, '/dashboard/profile')`.
  - `students/pedidos/page.tsx`: `backTarget(from, '/dashboard/students')`; the dashboard widget link (`widgets.tsx` ≈ l.774) gets `withFrom(…, '/dashboard')`.
  - Maintenance panel links to `/dashboard/facilities/tasks/<id>`: add `withFrom` with the site path and `?tab=maintenance`.
  - `staff/qualifications/page.tsx` row links (≈ l.112): add `withFrom` with the list path, section and page. The person page already reads `from`.
  - `staff/page.tsx`: `back` only when `readFrom(from) !== null`.
- `readFrom` already accepts query strings inside `/dashboard`. Extend `LABELS` / `SUBSECTIONS` in `lib/back.ts` and `back.test.ts` for the new destinations.
- Worth a small helper, `useCurrentHref()` in the client and `currentHref(path, searchParams)` on the server, so the sweep doesn't produce 40 hand-built strings.

### QA — scenarios

1. **Given** the dashboard, **when** I open the subscription link, **then** Voltar is shown and returns to the dashboard.
2. **Given** Profile, **when** I open subscription, **then** Voltar returns to Profile.
3. **Given** the dashboard, **when** I open Pedidos and click Voltar, **then** I am on the dashboard.
4. **Given** a site on the Manutenção tab, **when** I open a task and click Voltar, **then** I am on the same site, on the Manutenção tab.
5. **Given** Qualificações on section *Atenção*, page 2, **when** I open a person and click Voltar, **then** I am on *Atenção*, page 2.
6. **Given** I open Staff from the menu, **then** no Voltar is shown. **Given** I open Staff from a site's people count, **then** Voltar returns to that site.
7. **Given** I record a new incident (redirected to the list), **when** I open it and click Voltar, **then** I land on the list, not the form.
8. **Given** a hand-written `?from=https://evil.example`, **then** Voltar falls back to the parent (existing `readFrom` test still passes).
9. A Playwright spec walks cases 1–6 on desktop and phone.

### Acceptance criteria

1. The five cases in the table behave as "Expected".
2. Every cross-section or detail link under `/dashboard` carries `from`, and an audit grep finds none without it, or each exception has a written reason.
3. Menu-destination pages show no Voltar without an origin.
4. `back.test.ts` covers the new labels; both languages, light and dark.

### Open questions

- None blocking. The rule in BA-2 (no Voltar on menu pages) is inferred from the Staff remark. Confirm it applies to every menu page.

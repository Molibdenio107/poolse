# POOLSE-29 · Paginate lists at 15 per page

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Global · **Priority:** Medium

### PO — why this exists

Lists today render whatever the API returns, so a tenant with 200 alunos gets a 200-row page that is slow to paint and impossible to scan. Every role feels this — instructors scrolling a roster, admins working through Pessoas — and it gets worse for exactly the tenants we most want to keep. It sits at Medium rather than High because nothing is broken or wrong, only unbounded; but it is cheap now and expensive once each list has grown its own bespoke fetch.

**Not in scope:** a user-configurable page size, infinite scroll, virtualised tables, or cursor/keyset pagination — 15 is fixed, offset-based, and one shared component.

### BA — rules and data

- Default page size is 15 on every list surface in the app, without exception; there is no per-list override and no user setting.
- The API contract for every list endpoint gains `page` (1-based) and `limit`, and every list response returns `items`, `total`, `page`, `limit`. `total` is the count after filters and search, before pagination.
- Sorting and filtering are applied server-side across the whole result set; the page is a window onto the sorted, filtered set, never a client-side slice.
- Any change to a filter value, search term or sort key resets `page` to 1. A change to page alone leaves filters and sort untouched.
- The pagination control is suppressed entirely when `total <= limit` — one page means no control, not a disabled control.
- The range label reads "16–30 de 214" / "16–30 of 214"; the upper bound is `min(page × limit, total)`, so the last page reads "211–214 de 214".
- Current page lives in the URL query string, so a page is linkable and survives refresh and browser back. Page 1 may be represented by the absence of the param; the same convention applies everywhere.
- Edge cases with decided answers: `total = 0` renders the list's empty state and no control; a requested page beyond the last page returns an empty items array with the true `total` (the client then redirects to the last valid page rather than showing a blank list); `page < 1` or a non-numeric page is coerced to 1; deleting the last row on the last page leaves the user on a now-empty page and must fall back to the previous page.
- **Open:** whether the twelve-month Encerramentos calendar (POOLSE-31), the Férias calendar and the turma hover card (POOLSE-15) count as "lists" under AC 1. They render bounded sets that cannot be paginated meaningfully — a written exemption list is needed rather than a case-by-case judgement.
- Conflicts to resolve: POOLSE-15 AC 2 requires the hover card to show the **full** student list "with no truncation", which reads against "no list renders unbounded". POOLSE-08's "+X more after 8 names" is a display collapse, not pagination, and must not be reimplemented as a page.

### Dev — implementation notes

- No schema change. Migration impact is limited to indexes: every list's default sort column plus its tenant key needs a composite index, or `OFFSET` scans degrade as tenants grow.
- Add a shared `PaginationQueryDto` (page, limit with a server-enforced max) and a `Paginated<T>` response envelope in the NestJS API; every list controller adopts both. Reject `limit` above the cap rather than honouring it — this is the endpoint that gets used to dump a tenant's data.
- `COUNT(*)` on every request doubles the query load. Run count and page in one round trip (window function `count(*) OVER ()` on the same filtered query) so the filter predicate cannot drift between the two.
- Client side: one `usePagination` hook that owns the URL query param plus one shadcn/ui `<Pagination>` component. Page size is a single exported constant so 15 → 20 is a one-line change.
- Permission enforcement stays where it already is — the tenant scope and role filter are part of the same query, applied **before** limit/offset. Never paginate a set and then filter it, or page 2 will silently hold fewer rows than page 1.
- i18n: the range label and total need a plural- and number-formatted key per locale ("16–30 de 214" vs "16–30 of 214"); do not concatenate. Page numerals use locale number formatting.
- Theming: the control is shadcn/ui tokens only, no hardcoded greys; the current-page indicator must be distinguishable in dark mode without relying on a background tint alone (add a border or weight change).
- Most likely to be got wrong: resetting the page on filter change. Set the filter and the page in one URL update, otherwise the client fires a request for page 7 of the new filter, gets an empty set, and flashes an empty state before correcting itself.

### QA — test scenarios

Global change — coverage is sampled, not enumerated. Pick a representative list per shape: a plain list (Pessoas), a filtered + searched list (Alunos), a nested list inside a detail page (enrolments on a turma), a list behind a role restriction (audit log), and one list that also carries a sort control. Verify AC 1 across the rest by a static sweep — grep for every list endpoint and assert each one declares the pagination DTO, plus a route-level test that no list response exceeds `limit`.

- **29.1** Given a tenant with 214 alunos / When the list loads / Then 15 rows render and the label reads "1–15 de 214".
- **29.2** Given page 2 / When the user clicks "last" / Then page 15 loads showing rows 211–214 and next/last are disabled.
- **29.3** Given a list of 12 items / When it loads / Then no pagination control is rendered at all.
- **29.4** Given the user is on page 7 / When they type into the search box / Then the request is for page 1 and the URL shows page 1 — no intermediate empty-state flash.
- **29.5** Given a URL with `?page=4` / When it is opened in a fresh tab / Then page 4 renders directly, and browser back returns to the previous page.
- **29.6** Given `?page=999` on a 15-page list / When it loads / Then the client lands on the last valid page rather than rendering blank.
- **29.7** Given `?page=abc` or `?page=-3` / When it loads / Then page 1 renders and nothing throws.
- **29.8** Given an Instructor calling a list endpoint directly with `limit=10000` / When the request is made / Then the API rejects or clamps it — the response never exceeds the server cap, regardless of UI.
- **29.9** Given a sort by name descending across 214 rows / When page 2 is requested / Then rows 16–30 of the **whole** sorted set are returned, not the second 15 of an unsorted page.
- **29.10** Given locale pt-PT and then en / When the control renders / Then the range label reads "16–30 de 214" and "16–30 of 214" respectively, with locale number formatting and no concatenated fragments.
- **29.11** Given light and dark mode / When the control renders / Then the current page, disabled arrows and hover state are all distinguishable, contrast-checked, with the active page marked by more than a background tint.
- **29.12** Given the user is on the last page holding exactly one row / When that row is archived / Then the list falls back to the previous page rather than showing an empty page with a control that says page 15 of 14.
- **29.13** Given a second admin adds a record while the user sits on page 2 / When the user clicks next / Then no row is skipped or duplicated by more than the known offset drift, and the total updates — document the accepted behaviour rather than leaving it undefined.

### Acceptance criteria

1. Default page size is **15** on every list, everywhere — no list renders unbounded.
2. Pagination control shows current page, total pages and total result count ("16–30 de 214").
3. First/previous/next/last controls; the control is hidden entirely when there is only one page.
4. Pagination is **server-side** — the API takes page/limit and returns the total; the client never fetches everything and slices it.
5. Page resets to 1 whenever a filter, search term or sort changes.
6. Current page is reflected in the URL so a page can be linked and survives a browser refresh.
7. Sorting and filtering apply across the whole result set, not just the visible page.
8. One shared pagination component, so page size becomes a one-line change if 15 turns out to be wrong.

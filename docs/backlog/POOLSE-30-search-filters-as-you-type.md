# POOLSE-30 · Search filters as you type

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Global · **Priority:** Medium
**Depends on:** POOLSE-29 (search resets pagination to page 1)

### PO — why this exists

Search today needs a button press, so staff type a name, see nothing happen, and press Enter or click before the list responds — a dead half-second on the most-used control in the backoffice. Instructors looking up one student poolside on a tablet feel it most. Medium priority because the current behaviour works; it is simply slower than the product should feel, and the fix is one shared component rather than a per-page rewrite.

**Not in scope:** fuzzy or typo-tolerant matching, search ranking, cross-entity global search, and search-term history or suggestions.

### BA — rules and data

- Search fires on input change after a debounce of ~300 ms. Not per keystroke, not on Enter only. Enter bypasses the debounce and fires immediately.
- The "Pesquisar"/"Search" button is removed from every search box in the app; no surface keeps a submit affordance.
- A clear (×) control appears once the box is non-empty, empties the term, and restores the unfiltered list immediately with no debounce wait.
- Matching is case-insensitive **and** accent-insensitive in both directions: "jose" matches "José", "José" matches "jose", "maria" matches "MARIA". Substring match, anywhere in the field — typing a surname finds the person (POOLSE-32 AC 6).
- Responses are applied only if they correspond to the current term. A late response for an earlier term is discarded, never rendered, and never used to update the total count.
- While a request is in flight a subtle loading indicator shows, and the previously rendered results stay on screen. Results must not flicker to empty and back.
- Every search change resets pagination to page 1 (POOLSE-29 AC 5) and the search term lives in the URL alongside the page, so a searched view is linkable.
- Empty results show the term used verbatim ("Sem resultados para «josé»" / "No results for 'josé'") plus a clear affordance, distinct from the list's own "nothing here yet" empty state.
- Edge cases with decided answers: clearing the box while a request for the old term is in flight discards that response; a term of only whitespace is treated as empty; leading/trailing whitespace is trimmed before comparison but preserved in the input.
- **Open:** whether search is scoped per list (each list searches only its own fields) and what field set each list searches — the doc names accent- and case-insensitivity but never the searchable columns. Needs a decided per-entity field list before build.
- **Open:** minimum term length before a request fires. One character on a large tenant is an expensive full-table scan; the doc does not set a floor.

### Dev — implementation notes

- One `useDebouncedSearch` hook plus one shared `<SearchInput>`; per-page debounce implementations are how the 300 ms drifts to 250 in one place and 500 in another.
- Race control belongs in the request layer, not the component: tag each request with a monotonically increasing sequence number (or an `AbortController` per keystroke) and drop any response whose tag is not the latest. Aborting alone is not enough — an already-inflight response can still resolve after abort in some transports.
- Accent-insensitivity is a database concern, not a JS one. Use PostgreSQL `unaccent()` on both sides plus a case-insensitive comparison, backed by a functional index on `unaccent(lower(col))` — otherwise every keystroke is a sequential scan. `ILIKE '%term%'` cannot use a b-tree prefix index; consider `pg_trgm` with a GIN index for substring search at tenant scale.
- Search predicate is applied inside the same tenant-scoped query as the list filter and the pagination window — search must never widen the tenant scope, and must be applied before `LIMIT`.
- Permission enforcement point: the searched set is the set the caller may already see. A search on Pessoas by an Instructor returns only what the Pessoas list would return for that Instructor (POOLSE-35 AC 7) — verify at the API, not by hiding the box.
- i18n: placeholder, clear-button `aria-label`, loading announcement and the no-results message with the interpolated term all need keys; the term is interpolated, never concatenated, and must be escaped for display.
- Theming and a11y: the loading indicator must be visible in both modes and must not be the only signal — use `aria-busy` and an `aria-live="polite"` region announcing the result count, so the state is not conveyed by a spinner's colour alone.
- Most likely to be got wrong: the interaction between debounce and Enter. Pressing Enter must cancel the pending debounced call, not fire a second identical request alongside it — and the immediate request still participates in the sequence-number ordering.
- Performance: debounce reduces requests but does not bound them. Coalesce identical in-flight terms and keep a short-lived client cache keyed by term + page so backspacing one character does not re-hit the API.

### QA — test scenarios

Global change — coverage is sampled. Take one search box per shape: a large list (Alunos), a small list (Níveis), a list with an active filter alongside search, one behind a role scope (Pessoas), and one on a nested detail page. Then a static sweep asserting no "Pesquisar"/"Search" submit button remains anywhere and that every search box resolves to the shared component. Race and debounce scenarios below are run with an artificially throttled/staggered API, not against a fast local one — they cannot be observed otherwise.

- **30.1** Given an empty search box / When "maria" is typed at normal speed / Then exactly one request fires, ~300 ms after the last keystroke, and the list filters to matches.
- **30.2** Given the user types "mar" then immediately presses Enter / When the key is pressed / Then the search fires at once and the pending debounced call is cancelled — one request, not two.
- **30.3** Given the response for "ma" is delayed 2 s and the response for "maria" returns in 100 ms / When both resolve / Then the list shows results for "maria" and the late "ma" response is discarded, including its total count.
- **30.4** Given a search is in flight / When the user clears the box with × / Then the full list is restored immediately and the in-flight response never renders.
- **30.5** Given results are on screen / When a new term is typed / Then the old results remain visible with a loading indicator and never flash to an empty list in between.
- **30.6** Given a student named "José Faría" / When "jose faria" is typed unaccented and lowercase / Then the student is found; and given "JOSÉ" is typed / Then the same student is found.
- **30.7** Given the user is on page 4 of Alunos / When a search term is entered / Then the request is for page 1 and the URL reflects both the term and page 1.
- **30.8** Given a term with no matches / When the search settles / Then a message naming the term verbatim is shown with a clear affordance, distinct from the list's "no records yet" state — in pt-PT and in en.
- **30.9** Given an Instructor calling the Pessoas search endpoint directly with a student's name / When the request is made / Then no student or encarregado de educação is returned, regardless of what the UI would render.
- **30.10** Given light and dark mode / When a search is in flight and when it returns empty / Then the loading indicator, clear control and empty-state message are all legible and contrast-compliant in both.
- **30.11** Given a user types "maria", backspaces to "mar", then retypes "maria" within the debounce window / When it settles / Then one final render for "maria" occurs and no stale intermediate result is ever displayed.
- **30.12** Given a term containing `%`, `_`, a quote or an emoji / When it is searched / Then it is treated as a literal string, returns cleanly, and is echoed safely in the no-results message.
- **30.13** Given a screen reader / When results update after typing / Then the new result count is announced once via the live region, not once per keystroke.

### Acceptance criteria

1. Typing filters the list after a **debounce of ~300 ms** — not on every keystroke, not on Enter only.
2. The "Search"/"Pesquisar" button is removed from every search box in the app.
3. Enter still submits immediately, for people who type and hit Enter out of habit.
4. A clear (×) control empties the box and restores the full list.
5. A subtle loading indicator shows while a search is in flight; results never flicker between old and new sets.
6. Out-of-order responses are discarded — a slow response for "ma" must never overwrite results for "maria".
7. Search is case- and accent-insensitive: "jose" matches "José", "maria" matches "MARIA".
8. Empty results show a clear message with the term used, and a way to clear it.
9. Search resets pagination to page 1 (POOLSE-29).

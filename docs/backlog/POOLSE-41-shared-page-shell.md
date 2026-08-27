# POOLSE-41 · One page shell for every page

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Global / Layout · **Priority:** Medium

### PO — why this exists
Pages have drifted: different padding, different header heights, content starting at different
distances from the edge. Individually each looks fine; moving between them feels like moving between
two applications. One shell fixes it everywhere and stops it happening again.
**Not in scope:** redesigning any individual page's content, and changing the navigation structure (POOLSE-38).

### BA — rules and data
- Every page is **full width** with **identical padding**, header height and section spacing. No page defines its own outer padding.
- The shell provides: page title, optional subtitle, an actions slot (top right), an optional filter/search bar row, and the content area.
- Vertical rhythm is shared: the gap between the page header and the first content block is the same on every page.
- Wide content — tables, the calendar grid, the year view — scrolls **inside its own container**. The page body never scrolls horizontally.
- Breakpoints and padding values are defined once as tokens, not per page.
- Loading and empty states use the shell too, so a page does not shift when data arrives.
- Existing pages are migrated onto the shell as part of this ticket; a page left on its own layout is the failure mode, so the ticket includes an audit listing every page and its status.
- **Answered (27 Aug):** **full width plus internal scrolling**, no wide variant. The year grid and the skills table already own an `overflow-x-auto` wrapper, which AC5 requires regardless, so a second layout would be a thing to keep in step for no gain.

### Dev — implementation notes
- One `PageShell` component with named slots. Pages compose into it; they never set their own outer margin or padding.
- Put the padding, max-content-width and header-height values in the Tailwind theme as tokens so a future change is one edit.
- Migrate page by page, and add a lint rule or a quick grep check for outer padding classes applied at page root — that is how the drift returns.
- The shell owns the scroll container. Individual wide elements get `overflow-x: auto` on their own wrapper; the shell must not clip them.
- Check the shell against the densest pages first — the calendar and the biggest table — since those are what break a layout, not the simple forms.
- Most likely to be got wrong: a page that looks right in isolation but jumps when navigating from another, because its header height differs by a few pixels.

### QA — test scenarios
- **41.1** Given any two pages / When navigating between them / Then the page title sits at the same position and nothing shifts vertically.
- **41.2** Given every page in the app / When measured / Then outer padding and header height are identical.
- **41.3** Given a page with a wide table / When the viewport narrows / Then the table scrolls inside its container and the page body does not scroll sideways.
- **41.4** Given the calendar year grid / When the viewport narrows / Then the same holds.
- **41.5** Given a page in its loading state / When data arrives / Then the layout does not shift.
- **41.6** Given an empty-state page / When it renders / Then it uses the same shell and spacing as a populated one.
- **41.7** Given a page with header actions and one without / When both render / Then the header height is the same.
- **41.8** Given a mobile viewport / When each page renders / Then padding is consistent and no page overflows.
- **41.9** Given light and dark mode / When the shell renders / Then background, borders and the header separator are correct in both.
- **41.10** Given pt-PT and en / When a long translated page title renders / Then it wraps or truncates predictably without changing the header height.
- **41.11** Given a page migrated to the shell / When checked / Then it sets no outer padding of its own.

### Acceptance criteria

1. One shared page shell provides title, optional subtitle, actions slot, optional filter row and content area.
2. Every page is **full width with identical padding**, header height and section spacing.
3. No page sets its own outer padding or margin.
4. Padding, header height and breakpoints are defined once as theme tokens.
5. Wide content scrolls inside its own container; the page body never scrolls horizontally.
6. Loading and empty states use the shell, so nothing shifts when data arrives.
7. Every existing page is migrated onto the shell, with an audit list showing each page and its status.
8. The shell is verified on the densest pages — the calendar and the largest table — not only on simple forms.

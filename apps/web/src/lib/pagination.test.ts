import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPastEnd, lastPage, PAGE_SIZE, pageHref, pageRange, readPage } from './pagination.ts';

/**
 * Paging a list, on the client side — POOLSE-29.
 *
 * The test worth keeping is `pageHref`. Criterion 5 says a filter change resets
 * the page; its unstated pair is that a *page* change must not reset the filter,
 * and that is the one somebody breaks by building the link from scratch instead
 * of from the current query. The symptom is subtle: paging through search
 * results silently drops the search on page 2.
 *
 * `isPastEnd` is the other. It has to tell "page 4 of an empty list" apart from
 * "an empty list", because the first redirects and the second must render the
 * list's own empty state — and getting it backwards puts an empty register into
 * a redirect loop.
 *
 * Run: pnpm web:test
 */

test('a broken page parameter reads as page 1 — 29.7', () => {
  for (const bad of ['abc', '-3', '0', '', '   ', 'NaN']) {
    assert.equal(readPage(bad), 1, `"${bad}" should read as page 1`);
  }
  assert.equal(readPage(undefined), 1, 'no parameter is page 1');
  assert.equal(readPage('4'), 4);

  // Not clamped here: a page past the end has to survive long enough for the
  // page to notice and redirect somewhere real (29.6).
  assert.equal(readPage('999'), 999);
});

test('the range label counts rows, and the last page does not overclaim', () => {
  assert.deepEqual(pageRange(1, 15, 214), { from: 1, to: 15 });
  assert.deepEqual(pageRange(2, 15, 214), { from: 16, to: 30 }, '"16–30 de 214"');

  // 214 rows at 15 leaves 4 on page 15 — "211–214 de 214", not "211–225".
  assert.deepEqual(pageRange(15, 15, 214), { from: 211, to: 214 });

  // Nothing matched: no row numbers to quote. The control is hidden at this
  // total anyway, but a range of 1–0 would be wrong if it ever showed.
  assert.deepEqual(pageRange(1, 15, 0), { from: 0, to: 0 });
});

test('paging keeps the search and the filters', () => {
  const query = { search: 'silva', levelId: 'lvl-3', page: '1' };

  assert.equal(
    pageHref('/dashboard/students', query, 2),
    '/dashboard/students?search=silva&levelId=lvl-3&page=2',
    'page 2 of a filtered list is still filtered',
  );

  // Page 1 is the absence of the parameter — one convention everywhere, so
  // "the default view" has a single URL rather than two equivalent ones.
  assert.equal(
    pageHref('/dashboard/students', query, 1),
    '/dashboard/students?search=silva&levelId=lvl-3',
  );

  // The incoming `page` is replaced, never carried through and duplicated.
  assert.ok(!pageHref('/dashboard/students', query, 3).includes('page=1'));

  // Empty and whitespace-only filters are dropped rather than sent as blanks,
  // so a cleared search box does not leave `?search=` behind forever.
  assert.equal(
    pageHref('/dashboard/students', { search: '  ', levelId: undefined }, 2),
    '/dashboard/students?page=2',
  );

  assert.equal(pageHref('/dashboard/students', {}, 1), '/dashboard/students', 'no query at all');

  // A term with URL-significant characters survives the round trip encoded.
  assert.equal(
    pageHref('/dashboard/students', { search: 'a&b=c' }, 2),
    '/dashboard/students?search=a%26b%3Dc&page=2',
  );
});

test('lastPage never returns zero, so no control can read "page 1 of 0"', () => {
  assert.equal(lastPage(214), 22);
  assert.equal(lastPage(10), 1, 'exactly one full page is one page');
  assert.equal(lastPage(11), 2, 'one row over spills onto a second');
  assert.equal(lastPage(0), 1);
  assert.equal(lastPage(30, 10), 3, 'an explicit limit is honoured');
  assert.equal(PAGE_SIZE, 10, 'the default the API also uses');
});

test('a page past the end is detected; an empty list is not — 29.6 and 29.12', () => {
  // ?page=999 on a 15-page list.
  assert.equal(isPastEnd(999, 214, 15), true);

  // The last row on the last page was archived: 211–214 became 196–210, and
  // page 15 no longer exists.
  assert.equal(isPastEnd(15, 210, 15), true);
  assert.equal(isPastEnd(14, 210, 15), false, 'page 14 still holds rows');

  assert.equal(isPastEnd(1, 214, 15), false);
  assert.equal(isPastEnd(15, 214, 15), false, 'the last page is not past the end');

  /*
   * The distinction that matters: an empty list is *not* past its end.
   *
   * Page 1 of nothing must render "no students yet" rather than redirect to
   * page 1 — which is where it already is, so treating it as out of range would
   * be a redirect to itself.
   */
  assert.equal(isPastEnd(1, 0, 15), false, 'an empty list renders its empty state');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEBOUNCE_MS, MIN_SEARCH_LENGTH, searchHref, searchIntent } from './search.ts';

/**
 * Live search — POOLSE-30.
 *
 * The test that earns its place is the three-way `searchIntent`. Collapsing it
 * to a boolean is the obvious simplification and it breaks one case each way:
 * treat "below the floor" as a clear and the list flashes back to everything on
 * the first letter of every search; treat it as a search and you have sent the
 * one-character full scan the floor exists to prevent.
 *
 * `searchHref` is the other. A new term must reset to page 1, and it does it by
 * *deleting* the parameter rather than setting it — a deletion cannot leave a
 * stale page behind, which is why the ticket's named trap (a request for page 7
 * of a fresh search, then an empty-state flash) cannot occur on these pages.
 *
 * Run: pnpm web:test
 */

test('a term is a clear, a wait, or a search — and never the wrong one of the three', () => {
  // Emptied: give the list back at once, no debounce (AC4).
  assert.equal(searchIntent(''), 'clear');
  assert.equal(searchIntent('   '), 'clear', 'whitespace-only is empty, per the BA note');

  // One character: send nothing, and — just as important — reset nothing.
  assert.equal(searchIntent('m'), 'wait');
  assert.equal(searchIntent(' m '), 'wait', 'trimmed before it is measured');

  // At the floor and above: worth a request.
  assert.equal(searchIntent('ma'), 'search');
  assert.equal(searchIntent('maria'), 'search');
  assert.equal(searchIntent('  ma  '), 'search');

  assert.equal(MIN_SEARCH_LENGTH, 2, 'matches the API floor');
  assert.equal(DEBOUNCE_MS, 300, 'one timing for the whole app');
});

test('committing a term resets to page 1 by dropping the parameter', () => {
  assert.equal(
    searchHref('/dashboard/students', 'search=costa&page=7', 'search', 'silva'),
    '/dashboard/students?search=silva',
    'page 7 of the old term means nothing for the new one',
  );

  // Deleted rather than set to 1 — page 1 is the absence of the parameter, the
  // same convention pageHref uses.
  assert.ok(!searchHref('/x', 'page=7', 'search', 'silva').includes('page='));
});

test('a search inside a filter stays inside it', () => {
  assert.equal(
    searchHref('/dashboard/students', 'levelId=lvl-3&page=2', 'search', 'silva'),
    '/dashboard/students?levelId=lvl-3&search=silva',
    'the level filter survives; only page is dropped',
  );

  assert.equal(
    searchHref('/dashboard/facilities/staff', 'role=instructor', 'search', 'silva'),
    '/dashboard/facilities/staff?role=instructor&search=silva',
    '"the instructors called Silva" is a real question',
  );
});

test('clearing removes the term and leaves everything else', () => {
  assert.equal(
    searchHref('/dashboard/students', 'search=silva&levelId=lvl-3&page=4', 'search', ''),
    '/dashboard/students?levelId=lvl-3',
    'the level filter is not collateral damage of clearing the search',
  );

  // Nothing left at all: a bare path, not a trailing "?".
  assert.equal(searchHref('/dashboard/students', 'search=silva', 'search', ''), '/dashboard/students');
});

test('a term is carried literally into the URL — 30.12', () => {
  /*
   * These are the terms that break a search box built on LIKE. The API is where
   * they are made harmless (strpos has no pattern language); this asserts the
   * client at least round-trips them without mangling, so what the reader typed
   * is what the no-results message quotes back.
   */
  for (const term of ['100%', 'a_b', "O'Brien", 'a&b=c', '🏊']) {
    const href = searchHref('/x', '', 'search', term);
    const round = new URLSearchParams(href.split('?')[1]).get('search');
    assert.equal(round, term, `"${term}" must survive the round trip`);
  }
});

test('the term is trimmed for the URL, whatever the box shows', () => {
  // Leading and trailing whitespace is preserved in the input and trimmed before
  // comparison — the BA note. The URL carries the trimmed form so that "  ma"
  // and "ma " are one search, not three.
  assert.equal(searchHref('/x', '', 'search', '  maria  '), '/x?search=maria');
});

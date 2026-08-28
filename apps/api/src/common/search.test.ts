import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_SEARCH_LENGTH, readSearch, searchPredicate } from './search.js';

/**
 * List search — POOLSE-30.
 *
 * The test that matters is the last one. `searchPredicate` uses `strpos` rather
 * than `LIKE` because `LIKE '%' || $1 || '%'` reads `%` and `_` *in the term* as
 * wildcards — searching for "%" matched all fifty students in the seeded club,
 * and "_" matched them too. That is QA 30.12, and the fix is structural: a
 * predicate with no pattern language cannot be given a pattern.
 *
 * A regression here would be invisible in every ordinary search and wrong for
 * every punctuation mark, so it is asserted against the SQL text rather than
 * trusted to review.
 *
 * Run: pnpm api:test
 */

test('a term under the floor is no filter at all', () => {
  assert.equal(readSearch(undefined), null, 'no parameter');
  assert.equal(readSearch(''), null);
  assert.equal(readSearch('   '), null, 'whitespace-only has not started a search');
  assert.equal(readSearch('m'), null, 'one character does not scan the register');

  assert.equal(readSearch('ma'), 'ma', 'at the floor');
  assert.equal(readSearch('maria'), 'maria');
  assert.equal(MIN_SEARCH_LENGTH, 2);
});

test('a term is trimmed, so "ma " and " ma" are one search', () => {
  assert.equal(readSearch('  maria  '), 'maria');
  assert.equal(readSearch(' ma'), 'ma');

  // Trimmed *then* measured: " m " is one character, not three.
  assert.equal(readSearch(' m '), null);
});

test('the predicate is null-tolerant, so no filter means no clause', () => {
  const sql = searchPredicate('s.first_name', '$1');

  // The null branch has to come first and short-circuit: without it, every query
  // with no search term would compare against NULL and return nothing at all.
  assert.match(sql, /\$1::text IS NULL/);
  assert.match(sql, /\bOR\b/);
});

test('the predicate cannot be given a wildcard — 30.12', () => {
  const sql = searchPredicate('s.first_name', '$1');

  /*
   * `strpos`, and no LIKE anywhere. This is the whole guarantee: `strpos` takes a
   * literal needle, so `%`, `_`, a quote and an emoji are all just characters.
   * Reintroducing LIKE here would restore a bug that only shows up when somebody
   * types punctuation — a search box that returns the entire register for "%".
   */
  assert.match(sql, /strpos\(/);
  assert.doesNotMatch(sql, /\bLIKE\b/i, 'LIKE would make % and _ wildcards again');
  assert.doesNotMatch(sql, /'%'/, 'no pattern wrapping, in either direction');
});

test('the predicate folds case and accents on both sides — AC7', () => {
  const sql = searchPredicate('s.first_name', '$1');

  // Both the haystack and the needle, or the fold only works one way: "jose"
  // would find "José" while "JOSÉ" found nothing.
  assert.equal((sql.match(/strip_accents\(/g) ?? []).length, 2, 'accents folded on both sides');
  assert.equal((sql.match(/lower\(/g) ?? []).length, 2, 'case folded on both sides');
});

test('the haystack and the bind parameter are placed where the caller asks', () => {
  const sql = searchPredicate('m.phone', '$3');

  assert.match(sql, /m\.phone/);
  assert.match(sql, /\$3::text IS NULL/);

  // The parameter appears twice — once for the null check, once as the needle.
  assert.equal((sql.match(/\$3/g) ?? []).length, 2);
});

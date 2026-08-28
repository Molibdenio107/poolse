import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lastPage,
  MAX_PAGE_SIZE,
  PAGE_SIZE,
  paginated,
  readPageQuery,
  totalOf,
  windowed,
} from './pagination.js';

/**
 * Server-side pagination — POOLSE-29.
 *
 * Two tests here are the ones that matter. `readPageQuery` must never throw,
 * because every value it sees comes from a URL somebody may have typed or a
 * bookmark that has gone stale, and a 500 on `?page=abc` is a worse answer than
 * page 1. And the limit must be clamped, because a list endpoint with no ceiling
 * is the endpoint used to dump a tenant's register in one request — QA 29.8,
 * which is a permission test wearing a pagination costume.
 *
 * Run: pnpm api:test
 */

test('a broken page parameter is page 1, never an error — 29.7', () => {
  for (const bad of ['abc', '-3', '0', '', '  ', 'NaN', '1.5.2', '٣']) {
    const query = readPageQuery(bad);
    assert.equal(query.page, 1, `"${bad}" should read as page 1`);
    assert.equal(query.offset, 0, `"${bad}" should offset from the start`);
  }

  // Absent is the ordinary case, not an edge one: page 1 has no parameter.
  assert.equal(readPageQuery(undefined).page, 1);
});

test('a page number is honoured, and the offset follows from it', () => {
  const second = readPageQuery('2');
  assert.equal(second.page, 2);
  assert.equal(second.limit, PAGE_SIZE);
  assert.equal(second.offset, PAGE_SIZE, 'page 2 starts where page 1 ended');

  // A page past the end is *not* corrected here. The query returns an empty
  // window with a true total and the caller redirects — clamping it silently
  // would show somebody page 1 while the URL claimed page 999 (29.6).
  assert.equal(readPageQuery('999').page, 999);

  // '1.9' parses to 1 rather than being rejected: parseInt stops at the dot,
  // and a reader who typed it meant the first page.
  assert.equal(readPageQuery('1.9').page, 1);
});

test('limit is clamped to the server cap whatever the caller asks — 29.8', () => {
  assert.equal(readPageQuery('1', '10000').limit, MAX_PAGE_SIZE, 'a dump attempt is clamped');
  assert.equal(readPageQuery('1', '101').limit, MAX_PAGE_SIZE, 'one over the cap is clamped');
  assert.equal(readPageQuery('1', '100').limit, 100, 'exactly the cap is allowed');
  assert.equal(readPageQuery('1', '5').limit, 5, 'a smaller page is the caller’s business');

  // Nonsense falls back to the default rather than to "no limit", which is the
  // failure that matters: `limit=` must never mean "everything".
  for (const bad of ['abc', '-1', '0', '']) {
    assert.equal(readPageQuery('1', bad).limit, PAGE_SIZE, `"${bad}" falls back to the default`);
  }

  // The offset follows the clamped limit, not the requested one. Getting this
  // wrong would skip 9 985 rows of the tenant's register on page 2.
  assert.equal(readPageQuery('2', '10000').offset, MAX_PAGE_SIZE);
});

test('the total comes from the window function, and no rows means none matched', () => {
  assert.equal(totalOf([{ total_count: 214 }, { total_count: 214 }]), 214);

  /*
   * An empty result set has no window-function output to read. Zero is the right
   * answer for both cases that produce it — a filter that matched nothing, and a
   * page past the end — and the caller tells them apart by comparing the page it
   * asked for against the total.
   */
  assert.equal(totalOf([]), 0);
});

test('lastPage never returns zero', () => {
  assert.equal(lastPage(214, 15), 15, '214 rows is 15 pages, the last holding 4');
  assert.equal(lastPage(15, 15), 1, 'exactly one full page is one page');
  assert.equal(lastPage(16, 15), 2);

  // An empty list is page 1 of 1. A control reading "page 1 of 0" is how a
  // reader learns to distrust the numbers.
  assert.equal(lastPage(0, 15), 1);
});

test('the envelope reports the window that was actually used', () => {
  const query = readPageQuery('2', '10000');
  const page = paginated(['a', 'b'], 214, query);

  assert.deepEqual(page, { items: ['a', 'b'], total: 214, page: 2, limit: MAX_PAGE_SIZE });

  // The limit echoed back is the clamped one, so a client that trusted its own
  // request cannot compute a page count the server disagrees with.
  assert.equal(page.limit, MAX_PAGE_SIZE);
});

/**
 * `windowed` and the empty-page hole.
 *
 * Found by running the real query rather than by reading it: `count(*) OVER ()`
 * has nothing to attach to when the window is empty, so `?page=999` on a
 * register of fifty came back with a total of zero — which the client cannot
 * tell apart from "nothing matched". It rendered "no students yet" to a club
 * with fifty of them.
 */

/** A fake query: `total` rows exist, and the window is taken from them. */
const rowsFor = (total: number) => (limit: number, offset: number) =>
  Promise.resolve({
    rows: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
      total_count: total,
      id: offset + i,
    })),
  });

test('a full page reports its total from the rows, with one round trip', async () => {
  let calls = 0;
  const run = (limit: number, offset: number) => {
    calls += 1;
    return rowsFor(50)(limit, offset);
  };

  const page = await windowed(readPageQuery('2'), run, (row) => row.id);

  assert.equal(page.total, 50);
  assert.equal(page.items.length, 15);
  assert.deepEqual(page.items.slice(0, 2), [15, 16], 'page 2 starts at row 16');
  assert.equal(calls, 1, 'the common case must not pay for the fallback');
});

test('a page past the end still reports the true total — 29.6', async () => {
  let calls = 0;
  const run = (limit: number, offset: number) => {
    calls += 1;
    return rowsFor(50)(limit, offset);
  };

  const page = await windowed(readPageQuery('999'), run, (row) => row.id);

  assert.deepEqual(page.items, [], 'there is nothing on page 999');
  assert.equal(page.total, 50, 'but the client must learn there are 50 rows');
  assert.equal(calls, 2, 'one extra round trip, only here');

  // Which is what lets the client send the reader somewhere real instead of
  // showing a register of fifty as empty.
  assert.equal(lastPage(page.total, page.limit), 4);
});

test('an empty list stays empty, and costs nothing extra', async () => {
  let calls = 0;
  const run = (limit: number, offset: number) => {
    calls += 1;
    return rowsFor(0)(limit, offset);
  };

  const page = await windowed(readPageQuery('1'), run, (row) => row.id);

  assert.equal(page.total, 0, 'nothing matched');
  assert.equal(calls, 1, 'page 1 of an empty list must not re-query');

  // And the client must render the empty state rather than redirect: page 1 is
  // already where a redirect would send it.
  assert.equal(lastPage(page.total, page.limit), 1);
});

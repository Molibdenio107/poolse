import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withWeek } from './week-url.ts';

test('changes only the week, keeping the tab and the origin', () => {
  assert.equal(
    withWeek('http://localhost:3000/dashboard/students/abc?tab=week&from=%2Fdashboard%2Fclasses&week=2026-11-16', '2026-11-09'),
    '/dashboard/students/abc?tab=week&from=%2Fdashboard%2Fclasses&week=2026-11-09',
  );
});

test('adds the week when there was none, and keeps a hash', () => {
  assert.equal(withWeek('/dashboard/students/abc?tab=week#grid', '2026-11-16'), '/dashboard/students/abc?tab=week&week=2026-11-16#grid');
  assert.equal(withWeek('/dashboard/students/abc', '2026-11-16'), '/dashboard/students/abc?week=2026-11-16');
});

test('an origin carrying its own query survives the round trip', () => {
  const from = '/dashboard/classes?section=turmas&page=2';
  const href = `/dashboard/students/abc?tab=week&from=${encodeURIComponent(from)}`;
  const next = new URL(withWeek(href, '2026-11-09'), 'http://x');
  assert.equal(next.searchParams.get('from'), from);
  assert.equal(next.searchParams.get('tab'), 'week');
  assert.equal(next.searchParams.get('week'), '2026-11-09');
});

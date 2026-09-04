import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { BadInputFilter } from './bad-input.filter.js';

/**
 * A malformed id answers 404, a malformed body answers 400 — POOLSE-R3-01.
 *
 * `/dashboard/facilities/not-a-uuid` used to answer 500, which sent whoever saw
 * it looking at their network and their dev server. A truncated link is not a
 * server fault.
 *
 * Run: pnpm api:test
 */

/** Just enough of Nest's host for the filter, plus somewhere to record the reply. */
function hostFor(request: { method?: string; url?: string; params?: Record<string, string> }): {
  host: ArgumentsHost;
  sent: { status?: number; body?: unknown };
} {
  const sent: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', url: '/x', params: {}, ...request }),
    }),
  } as unknown as ArgumentsHost;

  return { host, sent };
}

/** Postgres's own error, as `pg` raises it. */
function badUuid(value: string): Error & { code: string } {
  return Object.assign(new Error(`invalid input syntax for type uuid: "${value}"`), {
    code: '22P02',
  });
}

test('a malformed id in the path is 404, not 500', () => {
  const { host, sent } = hostFor({
    url: '/facilities/not-a-uuid-at-all',
    params: { id: 'not-a-uuid-at-all' },
  });

  new BadInputFilter().catch(badUuid('not-a-uuid-at-all'), host);

  assert.equal(sent.status, 404);
});

test('the same error from a body value is 400, not a false 404', () => {
  /*
   * The reason the filter reads the offending value rather than mapping every
   * 22P02 to "not found": a genuinely bad request would otherwise be reported as
   * a missing record, which is undiagnosable.
   */
  const { host, sent } = hostFor({
    method: 'POST',
    url: '/class-groups',
    params: {},
  });

  new BadInputFilter().catch(badUuid('levelId-that-is-not-a-uuid'), host);

  assert.equal(sent.status, 400);
});

test('a path with one good id and one bad body value still answers 400', () => {
  // The trap in comparing loosely: the route has parameters, but not *this* value.
  const { host, sent } = hostFor({
    method: 'POST',
    url: '/class-groups/f2c43d44-de47-451f-9f28-8bff764422ce/enrollments',
    params: { id: 'f2c43d44-de47-451f-9f28-8bff764422ce' },
  });

  new BadInputFilter().catch(badUuid('studentId-nonsense'), host);

  assert.equal(sent.status, 400);
});

test('an exception that already knows its status keeps it', () => {
  const { host, sent } = hostFor({ url: '/facilities' });

  new BadInputFilter().catch(new ForbiddenException({ code: 'forbidden_role' }), host);

  assert.equal(sent.status, 403);
  assert.deepEqual(sent.body, { code: 'forbidden_role' });
});

test('a 404 raised by a controller is passed through untouched', () => {
  const { host, sent } = hostFor({ url: '/facilities/00000000-0000-0000-0000-000000000000' });

  new BadInputFilter().catch(new NotFoundException('No such facility'), host);

  assert.equal(sent.status, 404);
});

test('a genuine fault is still a 500 — outages must not look healthy', () => {
  const { host, sent } = hostFor({ url: '/facilities' });

  new BadInputFilter().catch(new Error('connection terminated unexpectedly'), host);

  assert.equal(sent.status, 500);
  assert.deepEqual(sent.body, { statusCode: 500, message: 'Internal server error' });
});

test('a 22P02 about something other than a uuid is handled too', () => {
  // `invalid input syntax for type integer: "abc"` — same class of mistake.
  const { host, sent } = hostFor({ url: '/x/abc', params: { page: 'abc' } });
  const error = Object.assign(new Error('invalid input syntax for type integer: "abc"'), {
    code: '22P02',
  });

  new BadInputFilter().catch(error, host);

  assert.equal(sent.status, 404);
});

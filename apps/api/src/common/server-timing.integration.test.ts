import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { withoutTenantScope } from '@poolse/db';
import { closeHarness } from '../test/harness.js';
import { serverTiming } from './server-timing.js';

/**
 * `Server-Timing` — POOLSE-171 QA 2: every response carries total, db and
 * queries, measured by the pool wrapper, and nothing identifying.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function serve(handler: () => Promise<void>): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    serverTiming(request, response, () => {
      void handler().then(() => {
        response.setHeader('content-type', 'application/json');
        response.end('{}');
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/students/3f0c7d0e-1111-4222-8333-944455556666`, server };
}

test('171 QA 2 — a response says its total, its database time and its query count, and nothing else', async () => {
  const { url, server } = await serve(async () => {
    await withoutTenantScope(async (tx) => {
      await tx.query('SELECT 1');
      await tx.query('SELECT 2');
    });
  });
  try {
    const header = (await fetch(url)).headers.get('server-timing') ?? '';
    const match = /^total;dur=([\d.]+), db;dur=([\d.]+), queries;desc="(\d+)"$/.exec(header);
    assert.ok(match, `the header is exactly three metrics: ${header}`);
    // BEGIN, the two SELECTs, COMMIT: every round trip is counted.
    assert.equal(Number(match[3]), 4);
    assert.ok(Number(match[2]) <= Number(match[1]), 'the database is part of the total');
    assert.equal(/[0-9a-f]{8}-/i.test(header), false, 'no id of any kind');
  } finally {
    server.close();
  }
});

test('171 — a request that touches no database still answers, with zero queries', async () => {
  const { url, server } = await serve(async () => undefined);
  try {
    const header = (await fetch(url)).headers.get('server-timing') ?? '';
    assert.match(header, /queries;desc="0"$/);
  } finally {
    server.close();
  }
});

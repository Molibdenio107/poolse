import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { listSessions } from './sessions.repository.js';
import { closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * The calendar's date window — POOLSE-172. `listSessions` picks days in the
 * site's own timezone and narrows by an indexed window first, so what this
 * pins is that the narrowing never loses a lesson at the edge of a day.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('a lesson belongs to its site’s day at both edges, whatever the instant says in UTC', async () => {
  await withScratchTenant(async (tenant) => {
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Janela') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
       VALUES ($1, $2, $3, 'Janela', $4) RETURNING id`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, pool!.id],
    );
    const at = async (instant: string, occursOn: string): Promise<string> => {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session
           (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on)
         VALUES ($1, $2, $3, $4::timestamptz, 45, $5::date) RETURNING id`,
        [tenant.organizationId, group!.id, pool!.id, instant, occursOn],
      );
      return row!.id;
    };

    // Lisbon in July is UTC+1, so 00:15 on the 6th is still the 5th in UTC…
    const first = await at('2027-07-05T23:15:00Z', '2027-07-06');
    // …and 23:30 on the 6th is 22:30 UTC, the last lesson of that day.
    const last = await at('2027-07-06T22:30:00Z', '2027-07-06');
    // A lesson either side of that day, a minute out, stays out.
    await at('2027-07-05T22:45:00Z', '2027-07-05');
    await at('2027-07-06T23:15:00Z', '2027-07-07');

    const sessions = await listSessions(tenant.organizationId, '2027-07-06', '2027-07-06');
    assert.deepEqual(sessions.map((session) => session.id), [first, last]);
  });
});

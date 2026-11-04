import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PeopleController } from './people.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Pessoas as a table — POOLSE-158, against the real database.
 *
 * The page filters by sport through `/people?sport=`, so the API does the
 * narrowing inside the paged statement; this proves it, the 400 for a sport the
 * club does not have, and the *Acesso* column's `lastSeenAt`. Support is left
 * out by `support.integration.test.ts` (QA 5), which reads the same list.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

/** The owner login, for the columns the app may not write here: the club's sports, a login's last visit. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

test('?sport= narrows the staff list on the server, and a sport the club lacks is a 400', async () => {
  await withScratchTenant(async (tenant) => {
    await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [tenant.organizationId]);
    const swimmer = await addMember(tenant, 'Nadia', 'Piscina', ['instructor']);
    const both = await addMember(tenant, 'Tiago', 'Ambos', ['instructor']);
    const coach = await addMember(tenant, 'Rita', 'Tenis', ['instructor']);
    await owner.query("UPDATE membership SET sports = '{pool,tennis}' WHERE id = $1", [both]);
    await owner.query("UPDATE membership SET sports = '{tennis}' WHERE id = $1", [coach]);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const people = new PeopleController();
      const ids = async (sport?: string): Promise<string[]> =>
        (await people.list('staff', undefined, undefined, undefined, undefined, sport)).members.items.map(
          (member) => member.membershipId,
        );

      const tennis = await ids('tennis');
      assert.ok(tennis.includes(both) && tennis.includes(coach), 'everybody holding tennis is listed');
      assert.equal(tennis.includes(swimmer), false, 'a pool-only instructor is not');

      const page = await people.list('staff', undefined, undefined, undefined, undefined, 'tennis');
      assert.equal(page.members.total, tennis.length, 'the total counts the filtered set, not the club');

      const all = await ids();
      for (const id of [swimmer, both, coach]) assert.ok(all.includes(id), 'no filter is everybody');

      await expectStatus(() => people.list('staff', undefined, undefined, undefined, undefined, 'golf'), 400);
    });
  });
});

test('the Acesso column reads when a login last used Poolse, and null without one', async () => {
  await withScratchTenant(async (tenant) => {
    const noLogin = await addMember(tenant, 'Sem', 'Conta', ['maintenance']);
    await owner.query(
      `UPDATE app_user SET last_seen_at = now() - interval '2 days'
        WHERE id = (SELECT app_user_id FROM membership WHERE id = $1)`,
      [tenant.ownerMembershipId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { members } = await new PeopleController().list('staff');
      const me = members.items.find((member) => member.membershipId === tenant.ownerMembershipId);
      assert.ok(me?.lastSeenAt, 'the owner has a last visit');
      assert.ok(Date.now() - new Date(me.lastSeenAt).getTime() > 24 * 3600 * 1000, 'the stored moment, not now');

      const other = members.items.find((member) => member.membershipId === noLogin);
      assert.equal(other?.appUserId, null);
      assert.equal(other?.lastSeenAt ?? null, null, 'no login, no visit');
    });
  });
});

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { MessagesController } from './messages.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * A message to every family in one sport — POOLSE-146 slice a, QA 1–3 and 6:
 * the preview and the send count that sport's families and only them (a student
 * in two sports once), the audience is the office's (Rui, 02-11-2026: an
 * instructor still writes to their own turmas only), a pool-only club is offered
 * no sport, and another club's sport audience reaches none of ours.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

test('POOLSE-146 a — a tennis message reaches the tennis families and nobody else', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const messages = new MessagesController();

    // QA 3: a pool-only club is offered no sport, and a sport audience is refused as not there.
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      assert.deepEqual((await messages.audiences()).sports, []);
      await expectStatus(() => messages.send({ audience: 'sport', targetId: 'tennis' }), 404);
    });

    await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [org]);
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
      [org, tenant.facilityId],
    );
    const [court] = await tenant.sql<{ id: string }>(
      `INSERT INTO playing_area (organization_id, facility_id, sport_id, name) VALUES ($1, $2, 'tennis', 'Campo 1') RETURNING id`,
      [org, tenant.facilityId],
    );
    const [swim] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, pool!.id],
    );
    const [tennis] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, playing_area_id)
       VALUES ($1, $2, $3, 'Ténis Iniciação', $4) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, court!.id],
    );
    const student = async (first: string, groups: string[]): Promise<string> => {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO student (organization_id, first_name, last_name, contact_email)
         VALUES ($1, $2, 'Teste', $3) RETURNING id`,
        [org, first, `${first.toLowerCase()}@familia.pt`],
      );
      for (const group of groups) {
        await tenant.sql(
          `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
          [org, group, row!.id],
        );
      }
      return row!.id;
    };
    await student('Ana', [swim!.id]);
    await student('Bruno', [tennis!.id]);
    await student('Carla', [swim!.id, tennis!.id]);

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      // The composer offers the club's sports once there is a second.
      assert.deepEqual((await messages.audiences()).sports, ['pool', 'tennis']);

      // QA 1: Bruno and Carla — Carla once, though she is in two sports.
      const preview = await messages.send({ audience: 'sport', targetId: 'tennis' });
      assert.equal(preview.studentCount, 2);
      assert.equal(preview.addressCount, 2);

      const sent = await messages.send({
        audience: 'sport',
        targetId: 'tennis',
        subject: 'Campos fechados',
        body: 'Os campos de ténis estão fechados no sábado.',
        commit: true,
      });
      assert.ok('id' in sent);
      const [row] = await tenant.sql<{ audience: string; sport_id: string }>(
        'SELECT audience::text, sport_id FROM message WHERE subject = $1',
        ['Campos fechados'],
      );
      assert.deepEqual(row, { audience: 'sport', sport_id: 'tennis' });
      const recipients = await tenant.sql<{ email: string }>(
        `SELECT r.email::text FROM message_recipient r JOIN message m ON m.id = r.message_id
          WHERE m.subject = 'Campos fechados' ORDER BY 1`,
      );
      assert.deepEqual(recipients.map((r) => r.email), ['bruno@familia.pt', 'carla@familia.pt']);

      // The history names the sport by its key, for the screen to translate.
      const listed = await messages.list();
      assert.equal(listed.items.find((m) => m.subject === 'Campos fechados')?.targetName, 'tennis');

      // A sport is a sport; a made-up one is refused.
      await expectStatus(() => messages.send({ audience: 'sport', targetId: 'curling' }), 400);
    });

    // QA 2, as decided: the sport audience is the office's, like a level or the club.
    const coach = await addMember(tenant, 'Teresa', 'Ténis', ['instructor']);
    await owner.query("UPDATE membership SET sports = '{tennis}' WHERE id = $1", [coach]);
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      await expectStatus(() => messages.send({ audience: 'sport', targetId: 'tennis' }), 403);
      assert.deepEqual((await messages.audiences()).sports, []);
    });
  });
});

test('POOLSE-146 a — another club\'s sport message reaches none of ours (QA 6)', async () => {
  await withScratchTenant(async (ours) => {
    await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [ours.organizationId]);
    await ours.sql(
      `INSERT INTO student (organization_id, first_name, last_name, contact_email) VALUES ($1, 'Nosso', 'Aluno', 'nosso@familia.pt')`,
      [ours.organizationId],
    );
    await withScratchTenant(async (theirs) => {
      await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [theirs.organizationId]);
      await actingAs(theirs, { roles: ['admin'] }, async () => {
        const preview = await new MessagesController().send({ audience: 'sport', targetId: 'pool' });
        assert.equal(preview.studentCount, 0);
      });
    });
  });
});

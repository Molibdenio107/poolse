import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionsCalendarController } from '../classes/sessions.controller.js';
import { MessagesController } from '../messages/messages.controller.js';
import { PushController } from '../push/push.controller.js';
import { resetPushConfig, usePushSenderForTests } from '../push/push.js';
import { actingAs, addMember, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * POOLSE-90 slice 4b — the other three pushed kinds, against the database:
 * a week moved within the next seven days tells its families (and one a month
 * ahead does not), a closure's warning is pushed to the people it reached, and
 * the stand-in is pushed on their assignment. The push service is never called:
 * every push goes through a recorded fake.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const SAVED = { ...process.env };
const pushed: { endpoint: string; title: string; url: string }[] = [];

afterEach(() => {
  for (const key of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key];
  }
  resetPushConfig();
  usePushSenderForTests(null);
  pushed.length = 0;
});

after(closeHarness);

function pushOn(): void {
  process.env['VAPID_PUBLIC_KEY'] =
    'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
  process.env['VAPID_PRIVATE_KEY'] = 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls';
  process.env['VAPID_SUBJECT'] = 'mailto:test@poolse.local';
  resetPushConfig();
  usePushSenderForTests(async (subscription, payload) => {
    const body = JSON.parse(payload) as { title: string; url: string };
    pushed.push({ endpoint: subscription.endpoint, title: body.title, url: body.url });
  });
}

/** Waits for the fire-and-forget pushes a request starts after it answers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20 && pushed.length === 0; i += 1) await new Promise((done) => setTimeout(done, 50));
  await new Promise((done) => setTimeout(done, 100));
}

test('POOLSE-90 4b — a near move is announced, a far one is not, a closure and a stand-in are pushed', async () => {
  await withScratchTenant(async (tenant) => {
    pushOn();
    const org = tenant.organizationId;
    const teacher = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const standIn = await addMember(tenant, 'Bruno', 'Lima', ['instructor']);
    const admin = await addMember(tenant, 'Carla', 'Admin', ['admin']);
    const mother = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
    await tenant.sql(`UPDATE membership SET email = 'marta@example.com' WHERE id = $1`, [mother]);
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, instructor_membership_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, teacher],
    );
    const [child] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Alice', 'Silva') RETURNING id`,
      [org],
    );
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Mãe', true)`,
      [org, child!.id, mother],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
       VALUES ($1, $2, $3, 'active', club_today() - 30)`,
      [org, group!.id, child!.id],
    );
    const lesson = async (days: number): Promise<{ id: string; day: string }> => {
      const [row] = await tenant.sql<{ id: string; day: string }>(
        `INSERT INTO class_session (organization_id, class_group_id, instructor_membership_id, occurs_on, starts_at, duration_minutes)
         SELECT $1, $2, $3, d, (d + TIME '18:00') AT TIME ZONE 'Europe/Lisbon', 45
           FROM (SELECT club_today() + $4::int AS d) x
         RETURNING id, to_char(occurs_on, 'YYYY-MM-DD') AS day`,
        [org, group!.id, teacher, days],
      );
      return row!;
    };

    // The family's phone and the stand-in's phone.
    await actingAs(tenant, { membershipId: mother, roles: ['guardian'] }, async () => {
      await new PushController().subscribe({ endpoint: 'https://push.example/marta', keys: { p256dh: 'p', auth: 'a' } });
    });
    await actingAs(tenant, { membershipId: standIn, roles: ['instructor'] }, async () => {
      await new PushController().subscribe({ endpoint: 'https://push.example/bruno', keys: { p256dh: 'p', auth: 'a' } });
    });

    const tomorrow = await lesson(1);
    const farAway = await lesson(30);
    const sessions = new SessionsCalendarController();
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await sessions.move(tomorrow.id, { date: tomorrow.day, startTime: '19:30' });
      await sessions.move(farAway.id, { date: farAway.day, startTime: '19:30' });
    });
    await settle();

    const [moved] = await tenant.sql<{ subject: string; body: string }>(
      `SELECT subject, body FROM message WHERE class_session_id = $1`,
      [tomorrow.id],
    );
    assert.match(moved!.subject, /^Aula mudou: Golfinhos, \d{2}-\d{2}-\d{4}$/);
    assert.match(moved!.body, /às 18:00, passa para .*, às 19:30, só nesta semana\./);
    const [far] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM message WHERE class_session_id = $1`,
      [farAway.id],
    );
    assert.equal(far!.n, 0, 'a move a month ahead is planning, and tells nobody');
    assert.deepEqual(
      pushed.map((one) => [one.endpoint, one.url]),
      [['https://push.example/marta', `/app/familia/aulas/${tomorrow.id}`]],
      "the move is pushed to the family's phone, and only theirs",
    );

    // A stand-in is pushed on their assignment, and nobody else is.
    pushed.length = 0;
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await sessions.standIn(tomorrow.id, { membershipId: standIn });
    });
    await settle();
    assert.deepEqual(
      pushed.map((one) => [one.endpoint, one.title]),
      [['https://push.example/bruno', 'É o professor substituto']],
    );

    // A closure's warning is pushed to the people it reached.
    pushed.length = 0;
    const [closure] = await tenant.sql<{ id: string }>(
      `INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason, source)
       VALUES ($1, $2, club_today() + 1, club_today() + 1, 'Obras', 'manual') RETURNING id`,
      [org, tenant.facilityId],
    );
    await tenant.sql(`UPDATE class_session SET status = 'cancelled', closure_id = $2 WHERE id = $1`, [
      tomorrow.id,
      closure!.id,
    ]);
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await new MessagesController().send({
        audience: 'closure',
        targetId: closure!.id,
        commit: true,
        subject: 'Piscina fechada amanhã',
        body: 'Obras no tanque.\nVoltamos na quinta.',
      });
    });
    await settle();
    assert.deepEqual(
      pushed.map((one) => [one.endpoint, one.title]),
      [['https://push.example/marta', 'Piscina fechada amanhã']],
    );
  });
});

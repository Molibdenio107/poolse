import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { SessionsCalendarController } from '../classes/sessions.controller.js';
import { PushController } from '../push/push.controller.js';
import { pushTo, resetPushConfig } from '../push/push.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * A cancelled lesson tells its families, and push is a second channel — POOLSE-90
 * slice 4, against the database. The push service itself is never called: the
 * sender is injected, so the test proves who is pushed to, what is revoked and
 * what is marked, and nothing leaves the machine.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

/** The owner login — to fill the day's message ceiling as a busy club would have. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
const SAVED = { ...process.env };

afterEach(() => {
  for (const key of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key];
  }
  resetPushConfig();
});

after(async () => {
  await owner.end();
  await closeHarness();
});

function pushOn(): void {
  process.env['VAPID_PUBLIC_KEY'] =
    'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
  process.env['VAPID_PRIVATE_KEY'] = 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls';
  process.env['VAPID_SUBJECT'] = 'mailto:test@poolse.local';
  resetPushConfig();
}

async function turmaWithFamily(tenant: ScratchTenant) {
  const org = tenant.organizationId;
  const teacher = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
  const admin = await addMember(tenant, 'Carla', 'Admin', ['admin']);
  const mother = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  await tenant.sql(`UPDATE membership SET email = 'marta@example.com' WHERE id = $1`, [mother]);
  const stranger = await addMember(tenant, 'Outra', 'Mae', ['guardian']);
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
  const lesson = async (days: number): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session (organization_id, class_group_id, instructor_membership_id, starts_at, duration_minutes)
       VALUES ($1, $2, $3, now() + make_interval(days => $4::int), 45) RETURNING id`,
      [org, group!.id, teacher, days],
    );
    return row!.id;
  };
  return { org, teacher, admin, mother, stranger, group: group!.id, lesson };
}

test('POOLSE-90 slice 4 — a cancelled lesson records a notice to its families, past a full ceiling, and Anular says it is on', async () => {
  await withScratchTenant(async (tenant) => {
    const { org, admin, mother, lesson } = await turmaWithFamily(tenant);
    const tuesday = await lesson(2);

    // A busy day: the club has already sent its twenty messages.
    await owner.query(
      `INSERT INTO message (organization_id, audience, subject, body, sent_by_membership_id, address_count)
       SELECT $1, 'organization', 'Aviso ' || n, 'Corpo', $2, 0 FROM generate_series(1, 20) n`,
      [org, admin],
    ).catch(async () => {
      // address_count must match recipient rows at commit; one recipient each, then.
      const client = await owner.connect();
      try {
        await client.query('BEGIN');
        for (let n = 1; n <= 20; n += 1) {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO message (organization_id, audience, subject, body, sent_by_membership_id, address_count)
             VALUES ($1, 'organization', $3, 'Corpo', $2, 1) RETURNING id`,
            [org, admin, `Aviso ${n}`],
          );
          await client.query(
            `INSERT INTO message_recipient (organization_id, message_id, student_name, name, email)
             VALUES ($1, $2, 'Alguém', 'Alguém', $3)`,
            [org, rows[0]!.id, `alguem${n}@example.com`],
          );
        }
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await new SessionsCalendarController().cancel(tuesday, { reason: 'Avaria na caldeira' });
    });
    const [notice] = await tenant.sql<{ id: string; subject: string; body: string; audience: string }>(
      `SELECT id, subject, body, audience::text FROM message WHERE class_session_id = $1`,
      [tuesday],
    );
    assert.equal(notice?.audience, 'session');
    assert.match(notice!.subject, /^Aula cancelada: Golfinhos, \d{2}-\d{2}-\d{4}$/);
    assert.match(notice!.body, /Motivo: Avaria na caldeira/);
    const recipients = await tenant.sql<{ guardian_membership_id: string | null; email: string | null }>(
      `SELECT guardian_membership_id, email::text AS email FROM message_recipient WHERE message_id = $1`,
      [notice!.id],
    );
    assert.deepEqual(
      recipients.map((one) => one.guardian_membership_id),
      [mother],
      "the turma's family, past the day's ceiling",
    );

    // Anular: the lesson is back, and the families are told so.
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await new SessionsCalendarController().restore(tuesday);
    });
    const notices = await tenant.sql<{ subject: string }>(
      `SELECT subject FROM message WHERE class_session_id = $1 ORDER BY sent_at, subject`,
      [tuesday],
    );
    assert.equal(notices.length, 2);
    assert.ok(notices.some((one) => one.subject.startsWith('A aula mantém-se: Golfinhos')));

    // A parceria has no families: nothing recorded.
    const [partnerSession] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session (organization_id, starts_at, duration_minutes) VALUES ($1, now() + interval '3 days', 45) RETURNING id`,
      [org],
    );
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await new SessionsCalendarController().cancel(partnerSession!.id, {});
    });
    const [none] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM message WHERE class_session_id = $1`,
      [partnerSession!.id],
    );
    assert.equal(none!.n, 0);
  });
});

test('POOLSE-90 slice 4 — push goes to the people who were told, a gone device is revoked, and push off does nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const { mother, stranger } = await turmaWithFamily(tenant);
    const push = new PushController();

    // Off: the switch is told so, and subscribing is refused.
    delete process.env['VAPID_PUBLIC_KEY'];
    resetPushConfig();
    await actingAs(tenant, { membershipId: mother, roles: ['guardian'] }, async () => {
      assert.deepEqual(push.config(), { available: false, publicKey: null });
      await expectStatus(() => push.subscribe({ endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } }), 404);
    });

    pushOn();
    await actingAs(tenant, { membershipId: mother, roles: ['guardian'] }, async () => {
      assert.equal(push.config().available, true);
      await push.subscribe({ endpoint: 'https://push.example/phone', keys: { p256dh: 'p1', auth: 'a1' }, label: 'iPhone' });
      await push.subscribe({ endpoint: 'https://push.example/old-tablet', keys: { p256dh: 'p2', auth: 'a2' } });
      // The same device again refreshes it rather than adding a row.
      await push.subscribe({ endpoint: 'https://push.example/phone', keys: { p256dh: 'p1b', auth: 'a1b' }, label: 'iPhone' });
      assert.equal((await push.mine()).subscriptions.length, 2);
      await expectStatus(() => push.subscribe({ endpoint: 'http://insecure', keys: { p256dh: 'p', auth: 'a' } }), 400);
    });
    await actingAs(tenant, { membershipId: stranger, roles: ['guardian'] }, async () => {
      await push.subscribe({ endpoint: 'https://push.example/stranger', keys: { p256dh: 'p3', auth: 'a3' } });
      // Another person's device is not theirs to turn off.
      assert.deepEqual(await push.revoke({ endpoint: 'https://push.example/phone' }), { revoked: false });
    });

    const sent: string[] = [];
    const delivered = await pushTo(
      tenant.organizationId,
      [mother],
      { title: 'Aula cancelada', body: 'Golfinhos', url: '/app/familia' },
      async (subscription) => {
        sent.push(subscription.endpoint);
        if (subscription.endpoint.endsWith('old-tablet')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      },
    );
    assert.equal(delivered, 1);
    assert.deepEqual(sent.sort(), ['https://push.example/old-tablet', 'https://push.example/phone']);
    const rows = await tenant.sql<{ endpoint: string; revoked: boolean; succeeded: boolean }>(
      `SELECT endpoint, revoked_at IS NOT NULL AS revoked, last_success_at IS NOT NULL AS succeeded
         FROM push_subscription WHERE membership_id = $1 ORDER BY endpoint`,
      [mother],
    );
    assert.deepEqual(
      rows.map((row) => [row.endpoint.split('/').pop(), row.revoked, row.succeeded]),
      [
        ['old-tablet', true, false],
        ['phone', false, true],
      ],
      'the 410 device is revoked; the delivered one is marked; the stranger was never pushed',
    );

    await actingAs(tenant, { membershipId: mother, roles: ['guardian'] }, async () => {
      assert.deepEqual(await push.revoke({ endpoint: 'https://push.example/phone' }), { revoked: true });
      assert.equal((await push.mine()).subscriptions.length, 0);
    });
  });
});

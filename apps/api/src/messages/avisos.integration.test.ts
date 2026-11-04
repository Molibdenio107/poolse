import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppAvisosController, AvisosController } from './avisos.controller.js';
import { MessagesController } from './messages.controller.js';
import { deliverMessage } from './delivery.js';
import { clubToday } from '../common/club-day.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * Avisos — POOLSE-166, against the real database.
 *
 * A notice shown in the app between two club days to the families and students
 * of its audience; never emailed, not counted by the daily ceiling, ended early
 * only by the office or the instructor who posted it.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

function inDays(days: number): string {
  const day = new Date(`${clubToday()}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

interface Club {
  t: string;
  u: string;
  /** Guardian of Ana, in T. */
  mother: string;
  /** Guardian of Bruno, in U. */
  father: string;
  teacher: string;
}

async function club(tenant: ScratchTenant): Promise<Club> {
  const org = tenant.organizationId;
  const turma = async (name: string): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name) VALUES ($1, $2, $3, $4) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, name],
    );
    return row!.id;
  };
  const t = await turma('Golfinhos');
  const u = await turma('Tubarões');
  const child = async (name: string, groupId: string, guardian: string): Promise<void> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, 'Teste') RETURNING id`,
      [org, name],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
      [org, groupId, row!.id],
    );
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship)
       VALUES ($1, $2, $3, 'mãe')`,
      [org, row!.id, guardian],
    );
  };
  const mother = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  const father = await addMember(tenant, 'Paulo', 'Reis', ['guardian']);
  await child('Ana', t, mother);
  await child('Bruno', u, father);
  const teacher = await addMember(tenant, 'Prof', 'Água', ['instructor']);
  await tenant.sql('UPDATE class_group SET instructor_membership_id = $1 WHERE id = $2', [teacher, t]);
  return { t, u, mother, father, teacher };
}

const aviso = (targetId: string, from = inDays(0), until = inDays(7)) => ({
  audience: 'class_group',
  targetId,
  subject: 'Piscina fechada sábado',
  body: 'A piscina fecha no sábado para manutenção.',
  shownFrom: from,
  shownUntil: until,
});

const appAvisos = (tenant: ScratchTenant, membershipId: string) =>
  actingAs(tenant, { membershipId, roles: ['guardian'] }, async () => (await new AppAvisosController().mine()).avisos);

test('166 QA 1–3 — a turma’s family sees a live aviso; another family and a closed window see nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const c = await club(tenant);
    const posted = await actingAs(tenant, { roles: ['owner'] }, () => new AvisosController().post(aviso(c.t)));
    assert.equal(posted.studentCount, 1);

    const seen = await appAvisos(tenant, c.mother);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0]!.studentNames, ['Ana']);
    assert.deepEqual(await appAvisos(tenant, c.father), [], 'not in T: nothing');

    // A window that has ended, or not begun, shows nothing (written directly: the API refuses a past one).
    await tenant.sql(`UPDATE message SET archived_at = now() WHERE id = $1`, [posted.id]);
    await tenant.sql(
      `INSERT INTO message (organization_id, audience, class_group_id, subject, body, sent_by_membership_id,
                            address_count, channel, shown_from, shown_until)
       VALUES ($1, 'class_group', $2, 'Antigo', 'x', $3, 0, 'app', $4, $5),
              ($1, 'class_group', $2, 'Futuro', 'x', $3, 0, 'app', $6, $7)`,
      [tenant.organizationId, c.t, tenant.ownerMembershipId, inDays(-10), inDays(-1), inDays(2), inDays(5)],
    );
    assert.deepEqual(await appAvisos(tenant, c.mother), [], 'ended, past and future: nothing');

    const listed = await actingAs(tenant, { roles: ['owner'] }, () => new AvisosController().list());
    assert.deepEqual(
      listed.avisos.map((one) => [one.subject, one.state]),
      [['Futuro', 'upcoming'], ['Antigo', 'past']],
      'the archived one is gone from the office list too',
    );
  });
});

test('166 QA 4 — an aviso is never mail: no address kept, nothing sent, not counted, not in Mensagens', async () => {
  await withScratchTenant(async (tenant) => {
    const c = await club(tenant);
    const { id } = await actingAs(tenant, { roles: ['owner'] }, () => new AvisosController().post(aviso(c.t)));

    const [row] = await tenant.sql<{ address_count: number; with_email: number }>(
      `SELECT m.address_count,
              (SELECT count(*)::int FROM message_recipient r WHERE r.message_id = m.id AND r.email IS NOT NULL) AS with_email
         FROM message m WHERE m.id = $1`,
      [id],
    );
    assert.equal(row!.address_count, 0);
    assert.equal(row!.with_email, 0);

    let sends = 0;
    const delivered = await deliverMessage(tenant.organizationId, id, async () => {
      sends += 1;
      return true;
    });
    assert.equal(delivered, 0);
    assert.equal(sends, 0, 'the sender itself passes an aviso by — the retry job calls the same function');

    const [today] = await tenant.sql<{ n: number }>(`SELECT email_addresses_today($1, now()) AS n`, [
      tenant.organizationId,
    ]);
    assert.equal(today!.n, 0);

    const mensagens = await actingAs(tenant, { roles: ['owner'] }, () => new MessagesController().list());
    assert.equal(mensagens.items.length, 0, 'Mensagens lists email only');
  });
});

test('166 QA 5 — an instructor posts to their own turma, not another; ends their own, never the office’s', async () => {
  await withScratchTenant(async (tenant) => {
    const c = await club(tenant);
    const office = await actingAs(tenant, { roles: ['owner'] }, () => new AvisosController().post(aviso(c.t)));
    await actingAs(tenant, { membershipId: c.teacher, roles: ['instructor'] }, async () => {
      const controller = new AvisosController();
      const own = await controller.post(aviso(c.t));
      await expectStatus(() => controller.post(aviso(c.u)), 403);
      await expectStatus(() => controller.post({ ...aviso(c.t), audience: 'organization' }), 403);
      await expectStatus(() => controller.archive(office.id), 403);
      const listed = await controller.list();
      assert.deepEqual(
        listed.avisos.map((one) => one.canArchive).sort(),
        [false, true],
        'the screen offers *Terminar* only where the API would allow it',
      );
      const ended = await controller.archive(own.id);
      assert.ok(ended.archiveEntryId);
    });
    // The office ends anybody's.
    await actingAs(tenant, { roles: ['admin'] }, () => new AvisosController().archive(office.id));
  });
});

test('166 QA 6 — a family cannot post; a window is two days in order; another club reads nothing', async () => {
  await withScratchTenant(async (other) => {
    const theirs = await club(other);
    await actingAs(other, { roles: ['owner'] }, () => new AvisosController().post(aviso(theirs.t)));

    await withScratchTenant(async (tenant) => {
      const c = await club(tenant);
      await actingAs(tenant, { membershipId: c.mother, roles: ['guardian'] }, async () => {
        await expectStatus(() => new AvisosController().post(aviso(c.t)), 403);
        await expectStatus(() => new AvisosController().list(), 403);
      });
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        const controller = new AvisosController();
        await expectStatus(() => controller.post(aviso(c.t, inDays(3), inDays(1))), 400);
        await expectStatus(() => controller.post(aviso(c.t, inDays(-5), inDays(-1))), 400);
        await expectStatus(() => controller.post({ ...aviso(c.t), shownFrom: '' }), 400);
        // Another club's turma is not found here.
        await expectStatus(() => controller.post(aviso(theirs.t)), 404);
        assert.deepEqual((await controller.list()).avisos, []);
      });
      assert.deepEqual(await appAvisos(tenant, c.mother), []);
    });
  });
});

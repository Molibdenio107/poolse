import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { MessagesController } from './messages.controller.js';
import { ClosuresController } from '../classes/sessions.controller.js';
import { deliverMessage } from './delivery.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Messages to families — POOLSE-67.
 *
 * Most of what can go wrong here is *who*: an unlinked parent still written to,
 * a sibling's mother twice, a child on the waiting list told their class is
 * cancelled, a child nobody can reach silently left out. The rest is the record
 * — that it is written whole, cannot be edited, and says honestly whether
 * anything left — and the daily ceiling, which has to hold under a race.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Fixture {
  groupId: string;
  levelId: string;
}

async function turma(tenant: ScratchTenant, name: string, levelId?: string): Promise<string> {
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, level_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, name, levelId ?? null],
  );
  return group!.id;
}

async function level(tenant: ScratchTenant, name: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, $2, 1) RETURNING id`,
    [tenant.organizationId, name],
  );
  return row!.id;
}

async function student(
  tenant: ScratchTenant,
  firstName: string,
  options: { groupId?: string; status?: 'active' | 'waiting' | 'ended'; email?: string } = {},
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, contact_email)
     VALUES ($1, $2, 'Teste', $3::citext) RETURNING id`,
    [tenant.organizationId, firstName, options.email ?? null],
  );
  if (options.groupId) {
    const status = options.status ?? 'active';
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, ended_on)
       VALUES ($1, $2, $3, $4::enrollment_status, $5)`,
      [
        tenant.organizationId,
        options.groupId,
        row!.id,
        status,
        status === 'ended' ? new Date().toISOString().slice(0, 10) : null,
      ],
    );
  }
  return row!.id;
}

async function link(tenant: ScratchTenant, studentId: string, guardianId: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship)
     VALUES ($1, $2, $3, 'mãe') RETURNING id`,
    [tenant.organizationId, studentId, guardianId],
  );
  return row!.id;
}

/** A turma of five: two siblings sharing a mother, an adult, one with two parents, one unreachable. */
async function cadetes(tenant: ScratchTenant): Promise<Fixture> {
  const levelId = await level(tenant, 'Nível 3');
  const groupId = await turma(tenant, 'Cadetes', levelId);

  const mother = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  const ana = await student(tenant, 'Ana', { groupId });
  const rita = await student(tenant, 'Rita', { groupId });
  await link(tenant, ana, mother);
  await link(tenant, rita, mother);

  // No guardian and an address: written to directly.
  await student(tenant, 'Jorge', { groupId, email: 'jorge@example.test' });

  const dad = await addMember(tenant, 'Paulo', 'Reis', ['guardian']);
  const mum = await addMember(tenant, 'Inês', 'Reis', ['guardian']);
  const tiago = await student(tenant, 'Tiago', { groupId });
  await link(tenant, tiago, dad);
  await link(tenant, tiago, mum);

  // Nobody to write to.
  await student(tenant, 'Zé', { groupId });

  return { groupId, levelId };
}

test('67 — siblings fold into one address, and the unreachable are named', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const preview = await new MessagesController().send({
        audience: 'class_group',
        targetId: groupId,
      });

      assert.equal(preview.studentCount, 5);
      // Marta once for two children, Jorge, Paulo and Inês.
      assert.equal(preview.addressCount, 4);
      assert.deepEqual(
        preview.unreachable.map((u) => u.name),
        ['Zé Teste'],
        'a child nobody can reach is named, never dropped',
      );
      assert.equal(preview.id, undefined, 'a preview writes nothing');
    });
  });
});

test('67 — an unlinked guardian is not written to', async () => {
  await withScratchTenant(async (tenant) => {
    const groupId = await turma(tenant, 'Golfinhos');
    const old = await addMember(tenant, 'Velho', 'Contacto', ['guardian']);
    const current = await addMember(tenant, 'Novo', 'Contacto', ['guardian']);
    const kid = await student(tenant, 'Kiko', { groupId });
    const gone = await link(tenant, kid, old);
    await link(tenant, kid, current);
    await tenant.sql('UPDATE guardian_link SET archived_at = now() WHERE id = $1', [gone]);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MessagesController();
      const { id } = await controller.send({
        audience: 'class_group',
        targetId: groupId,
        subject: 'Aula cancelada',
        body: 'A aula de amanhã não se realiza.',
        commit: true,
      });
      const message = await controller.one(id!);
      assert.deepEqual(
        message.recipients.map((r) => r.name),
        ['Novo Contacto'],
      );
    });
  });
});

test('67 — the waiting list and the ended are not in the turma', async () => {
  await withScratchTenant(async (tenant) => {
    const groupId = await turma(tenant, 'Golfinhos');
    await student(tenant, 'Activo', { groupId, email: 'a@example.test' });
    await student(tenant, 'Espera', { groupId, status: 'waiting', email: 'w@example.test' });
    await student(tenant, 'Saiu', { groupId, status: 'ended', email: 'e@example.test' });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const preview = await new MessagesController().send({
        audience: 'class_group',
        targetId: groupId,
      });
      assert.equal(preview.studentCount, 1);
      assert.equal(preview.addressCount, 1);
    });
  });
});

test("67 — a level is its turmas' students, not student.level_id", async () => {
  await withScratchTenant(async (tenant) => {
    const levelId = await level(tenant, 'Nível 3');
    const groupId = await turma(tenant, 'Cadetes', levelId);
    await student(tenant, 'Na turma', { groupId, email: 'in@example.test' });

    const [loose] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, contact_email, level_id)
       VALUES ($1, 'Só nível', 'Teste', 'loose@example.test', $2) RETURNING id`,
      [tenant.organizationId, levelId],
    );
    assert.ok(loose);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const preview = await new MessagesController().send({ audience: 'level', targetId: levelId });
      assert.equal(preview.studentCount, 1);
      assert.equal(preview.addressCount, 1);
    });
  });
});

test('67 — the record survives the guardian, and says nothing was sent', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MessagesController();
      const sent = await controller.send({
        audience: 'class_group',
        targetId: groupId,
        subject: 'Aula cancelada',
        body: 'Linha 1\n\nLinha 2',
        commit: true,
      });
      assert.ok(sent.id);
      assert.equal(sent.emailConfigured, false, 'no provider on a test machine');

      await tenant.sql(`UPDATE guardian_link SET archived_at = now() WHERE organization_id = $1`, [
        tenant.organizationId,
      ]);

      const message = await controller.one(sent.id);
      assert.equal(message.addressCount, 4);
      assert.equal(message.deliveredCount, 0);
      assert.equal(message.unreachableCount, 1);
      // Two rows for Marta (one per child), Jorge, Paulo, Inês, and Zé's null.
      assert.equal(message.recipients.length, 6);
      assert.ok(message.recipients.some((r) => r.name === 'Marta Silva'));
      assert.ok(message.recipients.every((r) => r.deliveredAt === null));
    });
  });
});

test('67 — delivery stamps every row of an address, and never sends twice', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MessagesController();
      const { id } = await controller.send({
        audience: 'class_group',
        targetId: groupId,
        subject: 'Aula cancelada',
        body: 'Amanhã não há aula.',
        commit: true,
      });

      const sentTo: string[] = [];
      // Paulo's provider refuses; everybody else goes.
      const send = async (email: { to: string }) => {
        sentTo.push(email.to);
        return !email.to.startsWith('paulo');
      };
      // The controller's own fire-and-forget may race this one; whichever runs
      // second finds nothing pending for what the first stamped.
      const first = await deliverMessage(tenant.organizationId, id!, send);
      assert.equal(first, 3);
      assert.equal(new Set(sentTo).size, sentTo.length, 'one email per address');

      const message = await controller.one(id!);
      const marta = message.recipients.filter((r) => r.name === 'Marta Silva');
      assert.equal(marta.length, 2);
      assert.ok(marta.every((r) => r.deliveredAt !== null), 'both siblings were reached');
      assert.equal(message.deliveredCount, 3);

      sentTo.length = 0;
      await deliverMessage(tenant.organizationId, id!, send);
      assert.deepEqual(
        sentTo.map((to) => to.split('.')[0]),
        ['paulo'],
        'only the refused address is retried',
      );
    });
  });
});

test('67 — a message to nobody is refused', async () => {
  await withScratchTenant(async (tenant) => {
    const groupId = await turma(tenant, 'Vazia');
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(
        () =>
          new MessagesController().send({
            audience: 'class_group',
            targetId: groupId,
            subject: 'x',
            body: 'x',
            commit: true,
          }),
        409,
      );
    });
  });
});

test('67 — subject and body are required, field by field', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      try {
        await new MessagesController().send({
          audience: 'class_group',
          targetId: groupId,
          subject: '  ',
          body: '',
          commit: true,
        });
        assert.fail('expected a 400');
      } catch (error) {
        const response = (error as { getResponse?: () => unknown }).getResponse?.() as {
          fields?: Record<string, string>;
        };
        assert.deepEqual(response.fields, {
          subject: 'messages.error.subjectRequired',
          body: 'messages.error.bodyRequired',
        });
      }
    });
  });
});

test('67 — an instructor writes to their own turma and nowhere else', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId, levelId } = await cadetes(tenant);
    const other = await turma(tenant, 'Outra');
    await student(tenant, 'Outro', { groupId: other, email: 'o@example.test' });

    const teacher = await addMember(tenant, 'Prof', 'Água', ['instructor']);
    await tenant.sql('UPDATE class_group SET instructor_membership_id = $1 WHERE id = $2', [
      teacher,
      groupId,
    ]);

    await actingAs(tenant, { membershipId: teacher, roles: ['instructor'] }, async () => {
      const controller = new MessagesController();
      const words = { subject: 'Aviso', body: 'Tragam touca.', commit: true };

      const { id } = await controller.send({ audience: 'class_group', targetId: groupId, ...words });
      assert.ok(id);

      await expectStatus(
        () => controller.send({ audience: 'class_group', targetId: other, ...words }),
        403,
      );
      await expectStatus(() => controller.send({ audience: 'level', targetId: levelId, ...words }), 403);
      await expectStatus(
        () => controller.send({ audience: 'facility', targetId: tenant.facilityId, ...words }),
        403,
      );
      await expectStatus(() => controller.send({ audience: 'organization', ...words }), 403);

      const options = await controller.audiences();
      assert.deepEqual(options.classGroups.map((g) => g.id), [groupId]);
      assert.equal(options.levels.length, 0);
      assert.equal(options.facilities.length, 0);
    });
  });
});

test('67 — an instructor reads the office’s messages to their turmas, and nothing else', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    const other = await turma(tenant, 'Outra');
    await student(tenant, 'Outro', { groupId: other, email: 'o@example.test' });
    const teacher = await addMember(tenant, 'Prof', 'Água', ['instructor']);
    await tenant.sql('UPDATE class_group SET instructor_membership_id = $1 WHERE id = $2', [
      teacher,
      groupId,
    ]);

    const words = { subject: 'Aviso', body: 'Piscina fechada.', commit: true };
    const ids = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const c = new MessagesController();
      const mine = await c.send({ audience: 'class_group', targetId: groupId, ...words });
      const theirs = await c.send({ audience: 'class_group', targetId: other, ...words });
      const club = await c.send({ audience: 'organization', ...words });
      return { mine: mine.id!, theirs: theirs.id!, club: club.id! };
    });

    await actingAs(tenant, { membershipId: teacher, roles: ['instructor'] }, async () => {
      const controller = new MessagesController();
      const list = await controller.list();
      assert.deepEqual(list.items.map((m) => m.id), [ids.mine]);
      assert.equal(list.total, 1);
      await expectStatus(() => controller.one(ids.theirs), 404);
      await expectStatus(() => controller.one(ids.club), 404);
      await expectStatus(() => controller.archive(ids.mine), 403);
    });
  });
});

test('67 — maintenance, students and guardians send nothing and read nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    for (const role of ['maintenance', 'student', 'guardian'] as const) {
      const who = await addMember(tenant, 'Sem', role, [role]);
      await actingAs(tenant, { membershipId: who, roles: [role] }, async () => {
        const controller = new MessagesController();
        await expectStatus(() => controller.send({ audience: 'class_group', targetId: groupId }), 403);
        await expectStatus(() => controller.list(), 403);
      });
    }
  });
});

test('67 — the daily ceiling counts messages, and the refusal carries its numbers', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    for (let i = 0; i < 20; i += 1) {
      await tenant.sql(
        `INSERT INTO message (organization_id, audience, subject, body, sent_by_membership_id,
                              address_count)
         VALUES ($1, 'organization', 'x', 'x', $2, 0)`,
        [tenant.organizationId, tenant.ownerMembershipId],
      );
    }

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      try {
        await new MessagesController().send({
          audience: 'class_group',
          targetId: groupId,
          subject: 'x',
          body: 'x',
          commit: true,
        });
        assert.fail('expected the ceiling');
      } catch (error) {
        assert.equal((error as { getStatus?: () => number }).getStatus?.(), 409);
        const response = (error as { getResponse: () => unknown }).getResponse() as {
          code: string;
          messageQuota: unknown;
        };
        assert.equal(response.code, 'message_quota');
        assert.deepEqual(response.messageQuota, {
          kind: 'messages',
          limit: 20,
          used: 20,
          requested: 1,
        });
      }
    });
  });
});

test('67 — the daily ceiling counts addresses too', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    const someone = await student(tenant, 'Massa');
    // 1,998 addresses already written to today, in one message.
    await tenant.sql(
      `WITH m AS (
         INSERT INTO message (organization_id, audience, subject, body, sent_by_membership_id,
                              address_count)
         VALUES ($1, 'organization', 'x', 'x', $2, 1998) RETURNING id
       )
       INSERT INTO message_recipient (organization_id, message_id, student_id, student_name,
                                      name, email)
       SELECT $1, m.id, $3, 'x', 'x', 'p' || i || '@example.test'
         FROM m CROSS JOIN generate_series(1, 1998) AS i`,
      [tenant.organizationId, tenant.ownerMembershipId, someone],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      try {
        await new MessagesController().send({
          audience: 'class_group',
          targetId: groupId,
          subject: 'x',
          body: 'x',
          commit: true,
        });
        assert.fail('expected the ceiling');
      } catch (error) {
        const response = (error as { getResponse: () => unknown }).getResponse() as {
          messageQuota: unknown;
        };
        assert.deepEqual(response.messageQuota, {
          kind: 'addresses',
          limit: 2000,
          used: 1998,
          requested: 4,
        });
      }
    });
  });
});

test("67 — yesterday's messages do not count against today", async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    for (let i = 0; i < 20; i += 1) {
      await tenant.sql(
        `INSERT INTO message (organization_id, audience, subject, body, sent_by_membership_id,
                              address_count, sent_at)
         VALUES ($1, 'organization', 'x', 'x', $2, 0,
                 message_day_start(now()) - interval '1 hour')`,
        [tenant.organizationId, tenant.ownerMembershipId],
      );
    }
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await new MessagesController().send({
        audience: 'class_group',
        targetId: groupId,
        subject: 'x',
        body: 'x',
        commit: true,
      });
      assert.ok(id);
    });
  });
});

test('67 — two sends racing for the last place: exactly one is written', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    for (let i = 0; i < 19; i += 1) {
      await tenant.sql(
        `INSERT INTO message (organization_id, audience, subject, body, sent_by_membership_id,
                              address_count)
         VALUES ($1, 'organization', 'x', 'x', $2, 0)`,
        [tenant.organizationId, tenant.ownerMembershipId],
      );
    }
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MessagesController();
      const body = { audience: 'class_group', targetId: groupId, subject: 'x', body: 'x', commit: true };
      const results = await Promise.allSettled([controller.send(body), controller.send(body)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
    });
    const [count] = await tenant.sql<{ n: number }>('SELECT count(*)::int AS n FROM message');
    assert.equal(count!.n, 20);
  });
});

test('67 — a message cannot be edited, and a recipient cannot be deleted', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    const id = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const sent = await new MessagesController().send({
        audience: 'class_group',
        targetId: groupId,
        subject: 'Original',
        body: 'x',
        commit: true,
      });
      return sent.id!;
    });

    await assert.rejects(
      () => tenant.sql(`UPDATE message SET subject = 'Reescrito' WHERE id = $1`, [id]),
      /permission denied/,
    );
    await assert.rejects(
      () => tenant.sql('DELETE FROM message_recipient WHERE message_id = $1', [id]),
      /permission denied/,
    );
    await assert.rejects(
      () => tenant.sql(`UPDATE message_recipient SET email = 'x@y.z' WHERE message_id = $1`, [id]),
      /permission denied/,
    );
  });
});

test('67 — archiving hides a message and keeps who it reached', async () => {
  await withScratchTenant(async (tenant) => {
    const { groupId } = await cadetes(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MessagesController();
      const { id } = await controller.send({
        audience: 'class_group',
        targetId: groupId,
        subject: 'x',
        body: 'x',
        commit: true,
      });
      await controller.archive(id!);
      assert.equal((await controller.list()).total, 0);
      await expectStatus(() => controller.one(id!), 404);
    });
    const [rows] = await tenant.sql<{ n: number }>(
      'SELECT count(*)::int AS n FROM message_recipient',
    );
    assert.equal(rows!.n, 6);
  });
});

test("67 — another club's turma and messages are out of reach", async () => {
  await withScratchTenant(async (a) => {
    await withScratchTenant(async (b) => {
      const { groupId: bGroup } = await cadetes(b);
      const bMessage = await actingAs(b, { roles: ['owner'] }, async () => {
        const sent = await new MessagesController().send({
          audience: 'class_group',
          targetId: bGroup,
          subject: 'x',
          body: 'x',
          commit: true,
        });
        return sent.id!;
      });

      await actingAs(a, { roles: ['owner'] }, async () => {
        const controller = new MessagesController();
        await expectStatus(
          () => controller.send({ audience: 'class_group', targetId: bGroup }),
          404,
        );
        await expectStatus(
          () => controller.send({ audience: 'facility', targetId: b.facilityId }),
          404,
        );
        await expectStatus(() => controller.one(bMessage), 404);
        await expectStatus(() => controller.archive(bMessage), 404);
        assert.equal((await controller.list()).total, 0);
      });
    });
  });
});

test('a closure writes to the families of the turmas it took a lesson from, and nobody else', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const tuesday = await turma(tenant, 'Terça');
      const saturday = await turma(tenant, 'Sábado');
      await student(tenant, 'Ana', { groupId: tuesday, email: 'ana.fecho@example.test' });
      await student(tenant, 'Rui', { groupId: saturday, email: 'rui.fecho@example.test' });

      // One lesson each, ten and thirteen days out; the closure covers only the first.
      for (const [group, days] of [[tuesday, 10], [saturday, 13]] as const) {
        await tenant.sql(
          `INSERT INTO class_session
             (organization_id, class_group_id, starts_at, duration_minutes, occurs_on)
           VALUES ($1, $2, (current_date + $3::int) + time '10:00', 45, current_date + $3::int)`,
          [tenant.organizationId, group, days],
        );
      }
      const [day] = await tenant.sql<{ d: string }>(
        `SELECT to_char(current_date + 10, 'YYYY-MM-DD') AS d`,
      );
      const { id: closureId } = await new ClosuresController().create({
        startsOn: day!.d,
        endsOn: day!.d,
        reason: 'Avaria na caldeira',
        facilityId: tenant.facilityId,
      });

      const messages = new MessagesController();
      const preview = await messages.send({ audience: 'closure', targetId: closureId });
      assert.equal(preview.studentCount, 1, 'only the turma whose lesson was cancelled');
      assert.equal(preview.addressCount, 1);

      const sent = await messages.send({
        audience: 'closure',
        targetId: closureId,
        subject: 'Piscina encerrada',
        body: 'A aula desta semana não se realiza.',
        commit: true,
      });
      const [row] = await tenant.sql<{ email: string }>(
        `SELECT email::text FROM message_recipient WHERE message_id = $1`,
        [sent.id],
      );
      assert.equal(row?.email, 'ana.fecho@example.test');
    });
  });
});

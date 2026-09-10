import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { MaintenanceController } from './maintenance.controller.js';
import { listTasks } from './maintenance.repository.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
} from '../test/harness.js';

/**
 * Planned maintenance — slice 4.3.
 *
 * The feature is one derived answer and a permission line, so this file is
 * mostly about the derivation. The branch order *is* the rule, and three of its
 * four branches are the kind that get "simplified" away:
 *
 * - a task nobody has ever done is **due**, not fine;
 * - a **paused** task is never due, whatever its interval;
 * - a **deleted** completion did not happen, so the task goes straight back.
 *
 * And the one that is unique to this table: a completion is stamped with when
 * the **work** happened, not when it was typed in, so a job done on Saturday and
 * recorded on Monday is not due again on Monday.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const DAY = 24 * 60 * 60 * 1000;

/** An instant `days` ago, as the API takes it. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

test('4.3 — a task nobody has ever done is due, not fine', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MaintenanceController();

      await controller.create(tenant.facilityId, {
        title: 'Contralavagem do filtro',
        intervalDays: 7,
      });

      const { tasks } = await controller.list(tenant.facilityId);
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]?.state, 'due', 'an absence of history is not evidence');
      assert.equal(tasks[0]?.lastDoneAt, null);
      assert.equal(tasks[0]?.nextDueAt, null, 'nothing to compute a next date from');
      assert.equal(tasks[0]?.daysOverdue, 0, 'and no lateness to report either');
    });
  });
});

test('4.3 — doing it schedules the next one, from when the work happened', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MaintenanceController();
      const { id } = await controller.create(tenant.facilityId, {
        title: 'Contralavagem',
        intervalDays: 7,
      });

      await controller.complete(id, {});

      const { task } = await controller.one(id);
      assert.equal(task.state, 'scheduled');
      assert.ok(task.lastDoneAt);
      assert.ok(task.nextDueAt);

      // Seven days after the work, give or take the second the test took.
      const gap = new Date(task.nextDueAt).getTime() - new Date(task.lastDoneAt).getTime();
      assert.ok(Math.abs(gap - 7 * DAY) < 60_000, `expected seven days, got ${gap}ms`);
    });
  });
});

test('4.3 — a backdated completion is dated by the work, not by the typing', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MaintenanceController();
      const { id } = await controller.create(tenant.facilityId, {
        title: 'Contralavagem',
        intervalDays: 7,
      });

      // Done ten days ago and only now written down. If the clock ran from the
      // typing, this task would look freshly done and the gap would be hidden —
      // which is the failure POOLSE-26 names for its own alert.
      await controller.complete(id, { performedAt: daysAgo(10) });

      const { task } = await controller.one(id);
      assert.equal(task.state, 'due', 'ten days ago against a seven-day interval');
      assert.equal(task.daysOverdue, 3);
    });
  });
});

test('4.3 — a paused task is never due, whatever its interval', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MaintenanceController();
      const { id } = await controller.create(tenant.facilityId, {
        title: 'Verificar dosagem',
        intervalDays: 1,
        active: false,
      });

      const { task } = await controller.one(id);
      assert.equal(task.state, 'paused');
      assert.equal(task.daysOverdue, 0);

      // A tank drained for works is not a maintenance failure, and a warning on
      // one is a warning an operator learns to ignore. Same as space.active.
      const { tasks } = await controller.list(tenant.facilityId);
      assert.equal(tasks[0]?.state, 'paused', 'still listed, never hidden');
    });
  });
});

test('4.3 — a deleted completion did not happen', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MaintenanceController();
      const { id } = await controller.create(tenant.facilityId, {
        title: 'Contralavagem',
        intervalDays: 7,
      });

      const { id: completionId } = await controller.complete(id, {});
      assert.equal((await controller.one(id)).task.state, 'scheduled');

      await controller.removeCompletion(completionId);

      // Straight back to due. The alternative leaves a job looking done because
      // somebody corrected a mistake.
      const { task } = await controller.one(id);
      assert.equal(task.state, 'due');
      assert.equal(task.lastDoneAt, null);
    });
  });
});

test('4.3 — the history says who and when, and drops the deleted entry', async () => {
  await withScratchTenant(async (tenant) => {
    const sandra = await addMember(tenant, 'Sandra', 'Maia', ['maintenance']);

    const taskId = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await new MaintenanceController().create(tenant.facilityId, {
        title: 'Contralavagem',
        intervalDays: 7,
      });
      return id;
    });

    // Recorded by the person who did it — and she has no login, which is the
    // ordinary case for club staff and the one an inner join would have dropped.
    await actingAs(tenant, { membershipId: sandra, roles: ['maintenance'] }, async () => {
      await new MaintenanceController().complete(taskId, {
        performedAt: daysAgo(1),
        note: 'Pressão normal',
      });
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const history = await new MaintenanceController().history(taskId);
      assert.equal(history.total, 1);
      assert.equal(history.items[0]?.performedByName, 'Sandra Maia');
      assert.equal(history.items[0]?.note, 'Pressão normal');

      const { task } = await new MaintenanceController().one(taskId);
      assert.equal(task.lastDoneByName, 'Sandra Maia');
    });
  });
});

test('4.3 — a task appears for the person it is for, and for nobody else', async () => {
  await withScratchTenant(async (tenant) => {
    const sandra = await addMember(tenant, 'Sandra', 'Maia', ['maintenance']);
    const paulo = await addMember(tenant, 'Paulo', 'Reis', ['maintenance']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MaintenanceController();

      await controller.create(tenant.facilityId, {
        title: 'Contralavagem',
        intervalDays: 7,
        assignedTo: sandra,
      });
      await controller.create(tenant.facilityId, {
        title: 'Luzes de emergência',
        intervalDays: 30,
        assignedTo: paulo,
      });
      // Nobody's yet. It still has to be visible to somebody, or a club that
      // assigns nothing sees an empty list and concludes this does not work.
      await controller.create(tenant.facilityId, {
        title: 'Limpar o pré-filtro',
        intervalDays: 14,
      });
      // Paused, and therefore not on anybody's list of things to do today.
      await controller.create(tenant.facilityId, {
        title: 'Aspirar o fundo',
        intervalDays: 2,
        assignedTo: sandra,
        active: false,
      });
    });

    await actingAs(tenant, { membershipId: sandra, roles: ['maintenance'] }, async () => {
      const { tasks } = await new MaintenanceController().mine();
      const titles = tasks.map((task) => task.title).sort();

      assert.deepEqual(titles, ['Contralavagem', 'Limpar o pré-filtro']);
      assert.equal(
        tasks.every((task) => task.state !== 'paused'),
        true,
        'a suspended job is not something to do today',
      );
    });

    await actingAs(tenant, { membershipId: paulo, roles: ['maintenance'] }, async () => {
      const { tasks } = await new MaintenanceController().mine();
      assert.deepEqual(tasks.map((task) => task.title).sort(), [
        'Limpar o pré-filtro',
        'Luzes de emergência',
      ]);
    });
  });
});

test('4.3 — the list is worst first', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MaintenanceController();

      const late = await controller.create(tenant.facilityId, {
        title: 'Muito atrasada',
        intervalDays: 1,
      });
      const slightly = await controller.create(tenant.facilityId, {
        title: 'Pouco atrasada',
        intervalDays: 1,
      });
      const fine = await controller.create(tenant.facilityId, {
        title: 'Em dia',
        intervalDays: 30,
      });
      await controller.create(tenant.facilityId, {
        title: 'Suspensa',
        intervalDays: 1,
        active: false,
      });

      await controller.complete(late.id, { performedAt: daysAgo(40) });
      await controller.complete(slightly.id, { performedAt: daysAgo(3) });
      await controller.complete(fine.id, { performedAt: daysAgo(1) });

      const { tasks } = await controller.list(tenant.facilityId);
      assert.deepEqual(
        tasks.map((task) => task.title),
        ['Muito atrasada', 'Pouco atrasada', 'Em dia', 'Suspensa'],
        'due by how late, then scheduled, then paused — listed, never hidden',
      );
    });
  });
});

test('4.3 — a task is about one thing, and that thing is at this site', async () => {
  await withScratchTenant(async (tenant) => {
    const [space] = await tenant.sql<{ id: string }>(
      `INSERT INTO space (organization_id, facility_id, name, type)
       VALUES ($1, $2, 'Balneário', 'changing_room') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind)
       VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MaintenanceController();

      // One target is fine, and the read names it.
      const { id } = await controller.create(tenant.facilityId, {
        title: 'Limpar o balneário a fundo',
        intervalDays: 30,
        spaceId: space!.id,
      });
      assert.equal((await controller.one(id)).task.spaceName, 'Balneário');

      // Two is a task nobody could describe, and every screen would have to
      // choose one arbitrarily.
      await expectStatus(
        () =>
          controller.create(tenant.facilityId, {
            title: 'Duas coisas',
            intervalDays: 30,
            spaceId: space!.id,
            poolId: pool!.id,
          }),
        400,
      );

      // None is legitimate — "test the emergency lighting" belongs to the site.
      const siteWide = await controller.create(tenant.facilityId, {
        title: 'Luzes de emergência',
        intervalDays: 30,
      });
      assert.equal((await controller.one(siteWide.id)).task.spaceName, null);
    });
  });
});

test('4.3 — a target at another site is refused as a sentence, not a 500', async () => {
  await withScratchTenant(async (tenant) => {
    // A second site in the same club, which the licence trigger allows once the
    // plan says so. The composite keys are what stop a task at site A naming a
    // room at site B, and this proves the refusal is legible.
    await tenant.sql(`UPDATE organization SET max_facilities = 5 WHERE id = $1`, [
      tenant.organizationId,
    ]);
    const [other] = await tenant.sql<{ id: string }>(
      `INSERT INTO facility (organization_id, name) VALUES ($1, 'Outro sítio') RETURNING id`,
      [tenant.organizationId],
    );
    const [elsewhere] = await tenant.sql<{ id: string }>(
      `INSERT INTO space (organization_id, facility_id, name, type)
       VALUES ($1, $2, 'Sala remota', 'technical') RETURNING id`,
      [tenant.organizationId, other!.id],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(
        () =>
          new MaintenanceController().create(tenant.facilityId, {
            title: 'Sala de outro sítio',
            intervalDays: 30,
            spaceId: elsewhere!.id,
          }),
        400,
      );
    });

    assert.deepEqual(await listTasks(tenant.organizationId, tenant.facilityId), []);
  });
});

test('4.3 — how often has to be a real cadence', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new MaintenanceController();

      for (const intervalDays of [0, -7, 400, 1.5]) {
        await expectStatus(
          () => controller.create(tenant.facilityId, { title: 'Qualquer', intervalDays }),
          400,
        );
      }

      // And a title is not optional: a task nobody can name is a task nobody
      // will do.
      await expectStatus(
        () => controller.create(tenant.facilityId, { title: '   ', intervalDays: 7 }),
        400,
      );
    });

    assert.deepEqual(await listTasks(tenant.organizationId, tenant.facilityId), []);
  });
});

test('4.3 — the plan is owner and admin; doing the work is everybody who is there', async () => {
  await withScratchTenant(async (tenant) => {
    const instructor = await addMember(tenant, 'Inês', 'Costa', ['instructor']);
    const maintenance = await addMember(tenant, 'Sandra', 'Maia', ['maintenance']);
    const student = await addMember(tenant, 'Rui', 'Aluno', ['student']);

    const taskId = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await new MaintenanceController().create(tenant.facilityId, {
        title: 'Contralavagem',
        intervalDays: 7,
      });
      return id;
    });

    // Deciding what the club maintains and how often is a decision about the
    // club. Neither of these may make one, or edit or remove one.
    for (const [membershipId, role] of [
      [instructor, 'instructor'],
      [maintenance, 'maintenance'],
    ] as const) {
      await actingAs(tenant, { membershipId, roles: [role] }, async () => {
        const controller = new MaintenanceController();

        await expectStatus(
          () => controller.create(tenant.facilityId, { title: 'Minha', intervalDays: 7 }),
          403,
        );
        await expectStatus(
          () => controller.update(taskId, { title: 'Outra', intervalDays: 30 }),
          403,
        );
        await expectStatus(() => controller.remove(taskId), 403);

        // But recording that the work was done is exactly what they are for. A
        // feature that made them find an admin to say so would not be used.
        await controller.complete(taskId, {});
      });
    }

    await actingAs(tenant, { membershipId: student, roles: ['student'] }, async () => {
      const controller = new MaintenanceController();
      await expectStatus(() => controller.complete(taskId, {}), 403);
      await expectStatus(() => controller.mine(), 403);
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const history = await new MaintenanceController().history(taskId);
      assert.equal(history.total, 2, 'both of them recorded their work');
    });
  });
});

test('4.3 — a task assigned to somebody who has left says so', async () => {
  await withScratchTenant(async (tenant) => {
    const leaver = await addMember(tenant, 'Antigo', 'Colega', ['maintenance']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new MaintenanceController().create(tenant.facilityId, {
        title: 'Contralavagem',
        intervalDays: 7,
        assignedTo: leaver,
      });
    });

    await tenant.sql(`UPDATE membership SET archived_at = now() WHERE id = $1`, [leaver]);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { tasks } = await new MaintenanceController().list(tenant.facilityId);

      // Not reassigned automatically — that would be Poolse deciding who does
      // the work — but the screen has to be able to say the job belongs to
      // nobody, or it silently does.
      assert.equal(tasks[0]?.assignedToName, 'Antigo Colega');
      assert.equal(tasks[0]?.assigneeArchived, true);
    });
  });
});

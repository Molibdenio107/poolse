import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { withOrg } from '@poolse/db';
import { ArchiveController } from './archive.controller.js';
import { RESTORABLE, type CascadeItem, type RestorableKindName } from './restorable.js';
import { archiveClassGroup } from '../classes/classes.repository.js';
import { archiveFacility, archivePool } from '../facilities/facilities.repository.js';
import { archivePartner } from '../facilities/partners.repository.js';
import { archiveStudent } from '../students/students.repository.js';
import { FeePeriodsController, FeePlansController } from '../billing/fees.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * The bin — POOLSE-78, QA 1–10, and the two things the ticket did not know.
 *
 * **Archiving a turma ends its enrolments and, through a trigger, their fee
 * lines.** A restore that only cleared `archived_at` would bring back a class
 * with nobody in it, so the turma test checks every one of those comes back as
 * it was — an active enrolment active, a waiting one waiting.
 *
 * **Entries written before this ticket carry no cascade.** They are restored by
 * the archive's own timestamp, and a test builds one by hand to prove it.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const bin = new ArchiveController();

async function addPool(tenant: ScratchTenant, name: string, facilityId = tenant.facilityId) {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.organizationId, facilityId, name],
  );
  return row!.id;
}

async function addStudent(tenant: ScratchTenant, firstName: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name)
     VALUES ($1, $2, 'Melo') RETURNING id`,
    [tenant.organizationId, firstName],
  );
  return row!.id;
}

/** The latest archive entry for a row: what the toast and the bin would send. */
async function entryFor(tenant: ScratchTenant, action: string, entityId: string) {
  const [row] = await tenant.sql<{ id: string; data: { cascade?: CascadeItem[] } }>(
    `SELECT id, data FROM audit_log
      WHERE action = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [action, entityId],
  );
  assert.ok(row, `no ${action} entry for ${entityId}`);
  return row;
}

async function archivedAt(tenant: ScratchTenant, table: string, id: string) {
  const [row] = await tenant.sql<{ archived: boolean }>(
    `SELECT archived_at IS NOT NULL AS archived FROM ${table} WHERE id = $1`,
    [id],
  );
  return row!.archived;
}

/** A 409, and the body it carried — the code and its figures. */
async function refusal(fn: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await fn();
  } catch (error) {
    const status = (error as { status?: number }).status;
    assert.equal(status, 409, `expected 409, got ${status}: ${String(error)}`);
    return (error as { getResponse: () => Record<string, unknown> }).getResponse();
  }
  throw new Error('expected a 409, but the call succeeded');
}

test('QA 1: a student archived and undone is live, with both entries in the log', async () => {
  await withScratchTenant(async (tenant) => {
    const studentId = await addStudent(tenant, 'Alice');

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      await archiveStudent(tenant.organizationId, studentId);
      const entry = await entryFor(tenant, 'student.archived', studentId);

      const restored = await bin.restore(entry.id);
      assert.equal(restored.kind, 'student');
      assert.equal(restored.name, 'Alice Melo');
    });

    assert.equal(await archivedAt(tenant, 'student', studentId), false);
    const actions = await tenant.sql<{ action: string; data: { archiveEntryId?: string } }>(
      `SELECT action, data FROM audit_log WHERE entity_id = $1 ORDER BY created_at`,
      [studentId],
    );
    assert.deepEqual(
      actions.map((row) => row.action),
      ['student.archived', 'student.restored'],
    );
    assert.ok(actions[1]!.data.archiveEntryId, 'the restore names the entry it undid');
  });
});

test('QA 2: a site comes back with the tanks archived with it, and not one archived alone', async () => {
  await withScratchTenant(async (tenant) => {
    const a = await addPool(tenant, 'Piscina A');
    const b = await addPool(tenant, 'Piscina B');
    const alone = await addPool(tenant, 'Piscina C');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await archivePool(tenant.organizationId, alone);
      await archiveFacility(tenant.organizationId, tenant.facilityId);

      const entry = await entryFor(tenant, 'facility.archived', tenant.facilityId);
      assert.deepEqual(
        entry.data.cascade?.map((item) => item.id).sort(),
        [a, b].sort(),
        'the entry lists exactly the tanks this action took',
      );

      const restored = await bin.restore(entry.id);
      assert.deepEqual(restored.children, { pool: 2 });
    });

    assert.equal(await archivedAt(tenant, 'facility', tenant.facilityId), false);
    assert.equal(await archivedAt(tenant, 'pool', a), false);
    assert.equal(await archivedAt(tenant, 'pool', b), false);
    assert.equal(await archivedAt(tenant, 'pool', alone), true, 'archived on its own, stays so');
  });
});

test('QA 3: a name taken since is a restore_conflict naming the field and the value', async () => {
  await withScratchTenant(async (tenant) => {
    const old = await addPool(tenant, 'Piscina 1');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await archivePool(tenant.organizationId, old);
      await addPool(tenant, 'Piscina 1');

      const entry = await entryFor(tenant, 'pool.archived', old);
      const body = await refusal(() => bin.restore(entry.id));
      assert.equal(body['code'], 'restore_conflict');
      assert.equal(body['entityType'], 'pool');
      assert.equal(body['field'], 'name');
      assert.equal(body['value'], 'Piscina 1');
    });

    assert.equal(await archivedAt(tenant, 'pool', old), true, 'nothing was written');
  });
});

test('QA 4: a tank whose site is archived is refused, naming the site and its entry', async () => {
  await withScratchTenant(async (tenant) => {
    const pool = await addPool(tenant, 'Piscina 1');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await archivePool(tenant.organizationId, pool);
      await archiveFacility(tenant.organizationId, tenant.facilityId);

      const poolEntry = await entryFor(tenant, 'pool.archived', pool);
      const siteEntry = await entryFor(tenant, 'facility.archived', tenant.facilityId);

      const body = await refusal(() => bin.restore(poolEntry.id));
      assert.equal(body['code'], 'parent_archived');
      assert.equal(body['parentKind'], 'facility');
      assert.equal(body['parentEntryId'], siteEntry.id, 'so the screen can offer the site');
      assert.equal(typeof body['parentName'], 'string');
    });

    assert.equal(await archivedAt(tenant, 'pool', pool), true);
  });
});

test('QA 5: a site restored over the licence is refused with its figures', async () => {
  await withScratchTenant(async (tenant) => {
    // The harness gives scratch tenants room for twenty; this one is a one-site plan.
    await tenant.sql('UPDATE organization SET max_facilities = 1 WHERE id = $1', [
      tenant.organizationId,
    ]);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await archiveFacility(tenant.organizationId, tenant.facilityId);
      // The licence is one site, and the club opened another in its place.
      await tenant.sql(`INSERT INTO facility (organization_id, name) VALUES ($1, 'Sede nova')`, [
        tenant.organizationId,
      ]);

      const entry = await entryFor(tenant, 'facility.archived', tenant.facilityId);
      const body = await refusal(() => bin.restore(entry.id));
      assert.equal(body['code'], 'licence_exceeded');
      assert.equal(body['current'], 1);
      assert.equal(body['allowed'], 1);
    });

    assert.equal(await archivedAt(tenant, 'facility', tenant.facilityId), true);
  });
});

test('QA 6: only an owner or an admin reaches the bin', async () => {
  await withScratchTenant(async (tenant) => {
    const studentId = await addStudent(tenant, 'Alice');
    let entryId = '';
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await archiveStudent(tenant.organizationId, studentId);
      entryId = (await entryFor(tenant, 'student.archived', studentId)).id;
    });

    for (const role of ['instructor', 'maintenance', 'guardian', 'student'] as const) {
      const membershipId = await addMember(tenant, 'Pessoa', role, [role]);
      await actingAs(tenant, { membershipId, roles: [role] }, async () => {
        await expectStatus(() => bin.list(), 403);
        await expectStatus(() => bin.actors(), 403);
        await expectStatus(() => bin.restore(entryId), 403);
      });
    }

    assert.equal(await archivedAt(tenant, 'student', studentId), true);

    // An admin may restore what the owner archived.
    const adminId = await addMember(tenant, 'Admin', 'Clube', ['admin']);
    await actingAs(tenant, { membershipId: adminId, roles: ['admin'] }, async () => {
      const page = await bin.list();
      assert.equal(page.total, 1);
      assert.equal(page.items[0]?.name, 'Alice Melo');
      assert.equal(page.items[0]?.archived, true);
      await bin.restore(entryId);
    });
  });
});

test("QA 7: another club's entry is a 404", async () => {
  await withScratchTenant(async (clubA) => {
    const studentId = await addStudent(clubA, 'Alice');
    let entryId = '';
    await actingAs(clubA, { roles: ['owner'] }, async () => {
      await archiveStudent(clubA.organizationId, studentId);
      entryId = (await entryFor(clubA, 'student.archived', studentId)).id;
    });

    await withScratchTenant(async (clubB) => {
      await actingAs(clubB, { roles: ['owner'] }, async () => {
        await expectStatus(() => bin.restore(entryId), 404);
        assert.equal((await bin.list()).total, 0);
      });
    });

    assert.equal(await archivedAt(clubA, 'student', studentId), true);
  });
});

test('QA 8: restoring twice is already_restored and writes nothing the second time', async () => {
  await withScratchTenant(async (tenant) => {
    const studentId = await addStudent(tenant, 'Alice');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await archiveStudent(tenant.organizationId, studentId);
      const entry = await entryFor(tenant, 'student.archived', studentId);
      await bin.restore(entry.id);

      const body = await refusal(() => bin.restore(entry.id));
      assert.equal(body['code'], 'already_restored');

      const page = await bin.list();
      assert.equal(page.items[0]?.archived, false, 'the bin shows it as back');
    });

    const [count] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'student.restored'`,
    );
    assert.equal(count!.n, 1);
  });
});

test('QA 9: an archive no person did is not in the bin and cannot be restored', async () => {
  await withScratchTenant(async (tenant) => {
    const studentId = await addStudent(tenant, 'Alice');

    // What a job writes: the change and its entry, with no membership behind it.
    const [entry] = await tenant.sql<{ id: string }>(
      `WITH archived AS (
         UPDATE student SET archived_at = now() WHERE id = $2 RETURNING id
       )
       INSERT INTO audit_log (organization_id, action, entity_type, entity_id)
       SELECT $1, 'student.archived', 'student', id FROM archived
       RETURNING id`,
      [tenant.organizationId, studentId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.equal((await bin.list()).total, 0);
      await expectStatus(() => bin.restore(entry!.id), 404);
    });
  });
});

test('QA 10: no invoice can reach the bin', () => {
  for (const kind of RESTORABLE) {
    assert.ok(!kind.table.startsWith('invoice'), `${kind.kind} restores ${kind.table}`);
  }
});

test('a turma comes back with its enrolments as they were, and their fee lines running', async () => {
  await withScratchTenant(async (tenant) => {
    const [level] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_level (organization_id, name, sort_order)
       VALUES ($1, 'Iniciação', 1) RETURNING id`,
      [tenant.organizationId],
    );
    const pool = await addPool(tenant, 'Piscina 1');
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id, level_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4, $5) RETURNING id`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, pool, level!.id],
    );
    const groupId = group!.id;
    const [schedule] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
       VALUES ($1, $2, 2, TIME '18:00', 45) RETURNING id`,
      [tenant.organizationId, groupId],
    );

    const active = await addStudent(tenant, 'Alice');
    const waiting = await addStudent(tenant, 'Bruno');
    const [enrolled] = await tenant.sql<{ id: string }>(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [tenant.organizationId, groupId, active],
    );
    const [queued] = await tenant.sql<{ id: string }>(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, waiting_position)
       VALUES ($1, $2, $3, 'waiting', 1) RETURNING id`,
      [tenant.organizationId, groupId, waiting],
    );

    const { plan, mensal } = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const mensal = (
        await new FeePeriodsController().create(tenant.facilityId, {
          name: 'Mensal',
          months: 1,
          isDefault: true,
        })
      ).id;
      const plan = (
        await new FeePlansController().create(tenant.facilityId, {
          kind: 'mensalidade',
          levelId: level!.id,
          lessonsPerWeek: 1,
          amountCents: 3000,
        })
      ).id;
      return { plan, mensal };
    });
    const [fee] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id,
                                enrollment_id, amount_cents, starts_on)
       VALUES ($1, $2, $3, $4, $5, 3000, current_date - 30) RETURNING id`,
      [tenant.organizationId, active, plan, mensal, enrolled!.id],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await archiveClassGroup(tenant.organizationId, groupId);

      const [closed] = await tenant.sql<{ ends_on: string | null }>(
        `SELECT ends_on::text FROM student_fee WHERE id = $1`,
        [fee!.id],
      );
      assert.notEqual(closed!.ends_on, null, 'ending the enrolment closed its fee line');

      const entry = await entryFor(tenant, 'class_group.archived', groupId);
      const restored = await bin.restore(entry.id);
      assert.deepEqual(restored.children, {
        class_schedule: 1,
        enrollment: 2,
        'student_fee.ends_on': 1,
      });
      assert.equal(restored.kept, 0);
    });

    assert.equal(await archivedAt(tenant, 'class_group', groupId), false);
    assert.equal(await archivedAt(tenant, 'class_schedule', schedule!.id), false);

    const enrolments = await tenant.sql<{ id: string; status: string; ended_on: string | null }>(
      `SELECT id, status::text, ended_on::text FROM enrollment WHERE class_group_id = $1`,
      [groupId],
    );
    const statusOf = (id: string) => enrolments.find((row) => row.id === id);
    assert.equal(statusOf(enrolled!.id)?.status, 'active');
    assert.equal(statusOf(queued!.id)?.status, 'waiting');
    assert.ok(enrolments.every((row) => row.ended_on === null));

    const [reopened] = await tenant.sql<{ ends_on: string | null }>(
      `SELECT ends_on::text FROM student_fee WHERE id = $1`,
      [fee!.id],
    );
    assert.equal(reopened!.ends_on, null, 'the fee line runs again');
  });
});

/**
 * AC 5: every kind that cascades records its children. A kind added to the
 * registry with a cascade and no archiver here fails by name.
 */
test('every cascading kind records its cascade on the entry it writes', async () => {
  const archivers: Partial<
    Record<RestorableKindName, (tenant: ScratchTenant) => Promise<{ action: string; id: string }>>
  > = {
    facility: async (tenant) => {
      await addPool(tenant, 'Piscina 1');
      await archiveFacility(tenant.organizationId, tenant.facilityId);
      return { action: 'facility.archived', id: tenant.facilityId };
    },
    partner: async (tenant) => {
      const [partner] = await tenant.sql<{ id: string }>(
        `INSERT INTO partner (organization_id, facility_id, name, type)
         VALUES ($1, $2, 'Escola EB1', 'escola') RETURNING id`,
        [tenant.organizationId, tenant.facilityId],
      );
      await tenant.sql(
        `INSERT INTO partner_contact (organization_id, partner_id, name, email)
         VALUES ($1, $2, 'Rita', 'rita@example.test')`,
        [tenant.organizationId, partner!.id],
      );
      await tenant.sql(
        `INSERT INTO partner_group (organization_id, partner_id, name) VALUES ($1, $2, '3.º ano')`,
        [tenant.organizationId, partner!.id],
      );
      await archivePartner(tenant.organizationId, partner!.id);
      return { action: 'partner.archived', id: partner!.id };
    },
    class_group: async (tenant) => {
      const [group] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group (organization_id, season_id, facility_id, name)
         VALUES ($1, $2, $3, 'Golfinhos') RETURNING id`,
        [tenant.organizationId, tenant.seasonId, tenant.facilityId],
      );
      await tenant.sql(
        `INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
         VALUES ($1, $2, 2, TIME '18:00', 45)`,
        [tenant.organizationId, group!.id],
      );
      await archiveClassGroup(tenant.organizationId, group!.id);
      return { action: 'class_group.archived', id: group!.id };
    },
  };

  for (const kind of RESTORABLE.filter((one) => one.cascades.length > 0)) {
    const archive = archivers[kind.kind];
    assert.ok(archive, `${kind.kind} cascades and has no archiver in this test`);

    await withScratchTenant(async (tenant) => {
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        const { action, id } = await archive(tenant);
        const entry = await entryFor(tenant, action, id);
        assert.ok(Array.isArray(entry.data.cascade), `${kind.kind} wrote no cascade`);
        assert.ok(entry.data.cascade.length > 0, `${kind.kind} wrote an empty cascade`);

        const restored = await bin.restore(entry.id);
        const back = Object.values(restored.children).reduce((sum, n) => sum + n, 0);
        assert.equal(back, entry.data.cascade.length, `${kind.kind} restored every child`);
      });
    });
  }
});

test('an entry from before the bin has no cascade, and its children are found by its timestamp', async () => {
  await withScratchTenant(async (tenant) => {
    const a = await addPool(tenant, 'Piscina A');
    const alone = await addPool(tenant, 'Piscina B');
    await tenant.sql(`UPDATE pool SET archived_at = now() - interval '1 day' WHERE id = $1`, [
      alone,
    ]);

    // What `archiveFacility` wrote before POOLSE-78: one transaction, no list.
    const entryId = await withOrg(tenant.organizationId, async (tx) => {
      await tx.query(`UPDATE facility SET archived_at = now() WHERE id = $1`, [tenant.facilityId]);
      await tx.query(
        `UPDATE pool SET archived_at = now() WHERE facility_id = $1 AND archived_at IS NULL`,
        [tenant.facilityId],
      );
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO audit_log (organization_id, actor_membership_id, action, entity_type, entity_id, data)
         VALUES ($1, $2, 'facility.archived', 'facility', $3, '{"name":"Sede"}')
         RETURNING id`,
        [tenant.organizationId, tenant.ownerMembershipId, tenant.facilityId],
      );
      return rows[0]!.id;
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const page = await bin.list();
      assert.deepEqual(page.items[0]?.children, { pool: 1 });

      const restored = await bin.restore(entryId);
      assert.deepEqual(restored.children, { pool: 1 });
    });

    assert.equal(await archivedAt(tenant, 'pool', a), false);
    assert.equal(await archivedAt(tenant, 'pool', alone), true);
  });
});

test('the list filters by kind, person and period', async () => {
  await withScratchTenant(async (tenant) => {
    const studentId = await addStudent(tenant, 'Alice');
    const pool = await addPool(tenant, 'Piscina 1');
    const adminId = await addMember(tenant, 'Admin', 'Clube', ['admin']);

    await actingAs(tenant, { roles: ['owner'] }, () =>
      archiveStudent(tenant.organizationId, studentId),
    );
    await actingAs(tenant, { membershipId: adminId, roles: ['admin'] }, () =>
      archivePool(tenant.organizationId, pool),
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.equal((await bin.list()).total, 2);
      assert.equal((await bin.list('pool')).items[0]?.name, 'Piscina 1');
      assert.equal((await bin.list(undefined, adminId)).items[0]?.kind, 'pool');
      assert.equal((await bin.list(undefined, undefined, '2000-01-01', '2000-12-31')).total, 0);
      assert.equal((await bin.actors()).length, 2);
      await expectStatus(() => bin.list('invoice'), 400);
      await expectStatus(() => bin.list(undefined, undefined, '13-09-2026'), 400);
    });
  });
});

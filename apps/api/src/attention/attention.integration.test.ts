import { after, test } from 'node:test';
import pg from 'pg';
import assert from 'node:assert/strict';
import { AttentionController } from './attention.controller.js';
import { actingAs, addMember, closeHarness, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * The circles — POOLSE-120. A warning travels from the pool to its site to the
 * menu with the same count; it clears when the thing is done; and only the
 * roles that can act are told.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

/** The owner login — only the platform writes `disabled_modules`, so the test sets it directly. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

async function reading(tenant: ScratchTenant, poolId: string, ph: number, minutesAgo: number): Promise<void> {
  const [analysis] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool_analysis (organization_id, pool_id, taken_at)
     VALUES ($1, $2, now() - make_interval(mins => $3)) RETURNING id`,
    [tenant.organizationId, poolId, minutesAgo],
  );
  await tenant.sql(
    `INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit) VALUES ($1, $2, 'ph', $3, 'pH')`,
    [tenant.organizationId, analysis!.id, ph],
  );
}

test('QA 1–2: a pool out of range lights the pool, its site and the menu — for who can act — and clears when back in range', async () => {
  await withScratchTenant(async (tenant) => {
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Piscina 2', 'indoor') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    await reading(tenant, pool!.id, 8.7, 60);
    const fixer = await addMember(tenant, 'Pedro', 'Nogueira', ['maintenance']);
    const coach = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
    const attention = new AttentionController();

    for (const who of [{ roles: ['owner'] as const }, { membershipId: fixer, roles: ['maintenance'] as const }]) {
      await actingAs(tenant, { ...who, roles: [...who.roles] }, async () => {
        const seen = await attention.read();
        assert.equal(seen.pools[pool!.id], 1);
        assert.equal(seen.facilities[tenant.facilityId], 1);
        assert.equal(seen.menu['facilities'], 1);
      });
    }
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      const seen = await attention.read();
      assert.deepEqual(seen.pools, {});
      assert.equal(seen.menu['facilities'], undefined);
    });

    // QA 2: a newer reading back in range clears every level.
    await reading(tenant, pool!.id, 7.3, 5);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const seen = await attention.read();
      assert.deepEqual(seen.pools, {});
      assert.deepEqual(seen.facilities, {});
      assert.equal(seen.menu['facilities'], undefined);
    });

    // Water quality switched off: no water circle anywhere.
    await reading(tenant, pool!.id, 8.9, 1);
    await owner.query(`UPDATE organization SET disabled_modules = '{water_quality}' WHERE id = $1`, [tenant.organizationId]);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual((await attention.read()).pools, {});
    });
  });
});

test('QA 3: two pre-registrations waiting show on Pedidos for the office; answering one leaves one', async () => {
  await withScratchTenant(async (tenant) => {
    const lead = async (name: string): Promise<string> =>
      (
        await tenant.sql<{ id: string }>(
          `INSERT INTO lead (organization_id, facility_id, swimmer_first_name, swimmer_last_name,
                             swimmer_birth_date, email, consent_text_version, consented_at)
           VALUES ($1, $2, $3, 'Nova', '2017-03-01', 'familia@example.test', 'v1', now()) RETURNING id`,
          [tenant.organizationId, tenant.facilityId, name],
        )
      )[0]!.id;
    const first = await lead('Rita');
    await lead('Tomás');
    const attention = new AttentionController();
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      assert.equal((await attention.read()).menu['leads'], 2);
    });
    await tenant.sql(`UPDATE lead SET status = 'dismissed', dismissed_reason = 'duplicado', decided_at = now() WHERE id = $1`, [first]);
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      assert.equal((await attention.read()).menu['leads'], 1);
    });
    const coach = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      assert.equal((await attention.read()).menu['leads'], undefined);
    });
  });
});

test("QA 4: a family's Não vou lights the calendar for that lesson's teacher, not another's; a guardian gets an empty map", async () => {
  await withScratchTenant(async (tenant) => {
    const sandra = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
    const nuno = await addMember(tenant, 'Nuno', 'Teixeira', ['instructor']);
    const parent = await addMember(tenant, 'Marta', 'Rocha', ['guardian']);
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, pool_id, name, instructor_membership_id)
       VALUES ($1, $2, $3, $4, 'Golfinhos', $5) RETURNING id`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, pool!.id, sandra],
    );
    const [session] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session (organization_id, class_group_id, pool_id, occurs_on, starts_at, duration_minutes, instructor_membership_id)
       VALUES ($1, $2, $3, ((now() + interval '1 day') AT TIME ZONE 'Europe/Lisbon')::date, now() + interval '1 day', 45, $4)
       RETURNING id`,
      [tenant.organizationId, group!.id, pool!.id, sandra],
    );
    const [child] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Inês', 'Rocha') RETURNING id`,
      [tenant.organizationId],
    );
    await tenant.sql(
      `INSERT INTO session_notice (organization_id, class_session_id, student_id, going, answered_by_membership_id)
       VALUES ($1, $2, $3, false, $4)`,
      [tenant.organizationId, session!.id, child!.id, parent],
    );

    const attention = new AttentionController();
    await actingAs(tenant, { membershipId: sandra, roles: ['instructor'] }, async () => {
      const seen = await attention.read();
      assert.equal(seen.menu['calendar'], 1);
      assert.equal(seen.sessions[session!.id], 1);
    });
    await actingAs(tenant, { membershipId: nuno, roles: ['instructor'] }, async () => {
      assert.equal((await attention.read()).menu['calendar'], undefined);
    });
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.equal((await attention.read()).menu['calendar'], 1);
    });
    await actingAs(tenant, { membershipId: parent, roles: ['guardian'] }, async () => {
      assert.deepEqual(await attention.read(), { menu: {}, facilities: {}, pools: {}, spaces: {}, sessions: {}, students: {}, classGroups: {} });
    });
  });
});

test('POOLSE-211: a turma nobody teaches lights itself and Turmas for the office only, and clears when a teacher is set', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const turma = async (name: string, instructor: string | null): Promise<string> =>
      (
        await tenant.sql<{ id: string }>(
          `INSERT INTO class_group (organization_id, season_id, facility_id, pool_id, name, instructor_membership_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [tenant.organizationId, tenant.seasonId, tenant.facilityId, pool!.id, name, instructor],
        )
      )[0]!.id;
    const nobody = await turma('Golfinhos', null);
    // An archived season's turma is not on the page, so it is never counted.
    const [old] = await tenant.sql<{ id: string }>(
      `INSERT INTO season (organization_id, name, starts_on, ends_on, status, archived_at)
       VALUES ($1, 'Antiga', '2020-09-01', '2021-07-31', 'draft', now()) RETURNING id`,
      [tenant.organizationId],
    );
    await tenant.sql(
      `INSERT INTO class_group (organization_id, season_id, facility_id, pool_id, name) VALUES ($1, $2, $3, $4, 'De outra época')`,
      [tenant.organizationId, old!.id, tenant.facilityId, pool!.id],
    );
    await turma('Tubarões', coach);
    const archived = await turma('Antiga', null);
    await tenant.sql(`UPDATE class_group SET archived_at = now() WHERE id = $1`, [archived]);

    const attention = new AttentionController();
    await actingAs(tenant, { membershipId: tenant.ownerMembershipId, roles: ['owner'] }, async () => {
      const seen = await attention.read();
      assert.deepEqual(seen.classGroups, { [nobody]: 1 }, 'only the live turma with nobody teaching it');
      assert.equal(seen.menu['classes'], 1);
      assert.equal(seen.menu['classes:pool'], 1, "its sport's copy counts it too");
    });
    // A teacher is not told about turmas they cannot staff.
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      const seen = await attention.read();
      assert.equal(seen.menu['classes'], undefined);
      assert.deepEqual(seen.classGroups ?? {}, {});
    });
    // Solved: a teacher assigned, and the dot and the count are gone.
    await tenant.sql(`UPDATE class_group SET instructor_membership_id = $2 WHERE id = $1`, [nobody, coach]);
    await actingAs(tenant, { membershipId: tenant.ownerMembershipId, roles: ['owner'] }, async () => {
      const seen = await attention.read();
      assert.equal(seen.menu['classes'], undefined);
      assert.deepEqual(seen.classGroups, {});
    });
  });
});

test('pending staff invitations light Pessoas for who could send them, and clear when answered (Rui, 10-11-2026)', async () => {
  await withScratchTenant(async (tenant) => {
    const invite = async (roles: string, email: string): Promise<string> => {
      const [placeholder] = await tenant.sql<{ id: string }>(
        `INSERT INTO membership (organization_id, status) VALUES ($1, 'invited') RETURNING id`,
        [tenant.organizationId],
      );
      return (
        await tenant.sql<{ id: string }>(
          `INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id, invited_by_membership_id)
           VALUES ($1, $2, $3::member_role[], $4, now() + interval '1 day', $5, $6) RETURNING id`,
          [tenant.organizationId, email, roles, `hash-${email}`, placeholder!.id, tenant.ownerMembershipId],
        )
      )[0]!.id;
    };
    const admin = await invite('{admin}', 'a@example.test');
    await invite('{instructor,maintenance}', 'b@example.test');
    // A family's invitation lives on the student, never on Pessoas.
    await invite('{guardian}', 'c@example.test');

    const coach = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
    const fixer = await addMember(tenant, 'Pedro', 'Nogueira', ['maintenance']);
    const attention = new AttentionController();

    for (const roles of [['owner'], ['admin']] as const) {
      await actingAs(tenant, { membershipId: tenant.ownerMembershipId, roles: [...roles] }, async () => {
        assert.equal((await attention.read()).menu['staff'], 2, `${roles[0]} sees both staff invitations`);
      });
    }
    // Nobody is told about invitations they could not have sent.
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      assert.equal((await attention.read()).menu['staff'], undefined);
    });
    await actingAs(tenant, { membershipId: fixer, roles: ['maintenance'] }, async () => {
      assert.equal((await attention.read()).menu['staff'], undefined);
    });
    // A support session invites nobody, so it is told nothing.
    await actingAs(tenant, { membershipId: tenant.ownerMembershipId, roles: ['admin'], support: true }, async () => {
      assert.equal((await attention.read()).menu['staff'], undefined);
    });
    // Answered or withdrawn, it clears.
    await tenant.sql(`UPDATE invitation SET revoked_at = now() WHERE id = $1`, [admin]);
    await actingAs(tenant, { membershipId: tenant.ownerMembershipId, roles: ['owner'] }, async () => {
      assert.equal((await attention.read()).menu['staff'], 1);
    });
  });
});

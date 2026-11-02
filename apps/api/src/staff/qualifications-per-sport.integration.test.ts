import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { QualificationsController } from './qualifications.controller.js';
import { raiseQualificationAlerts } from './qualification-alerts.js';
import { actingAs, addMember, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * A qualification type says which sport it is for — POOLSE-146 slice b, QA 4
 * and 5: a required type is *em falta* only for an instructor of its sport, the
 * alert job emails nobody about another sport's title, the assignment block
 * asks the turma's sport, a form that did not offer the sport keeps it, and in a
 * pool-only club every status is what it was (rule 6).
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

const inDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function typeId(tenant: ScratchTenant, name: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(`SELECT id FROM qualification_type WHERE name = $1`, [name]);
  return row!.id;
}

const TPTD = 'TPTD — Título Profissional de Treinador de Desporto';

test('POOLSE-146 b — rule 6: in a pool-only club the seeded types are swimming\'s and nothing changes', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Rui', 'Piscina', ['instructor']);
    const tptd = await typeId(tenant, TPTD);
    const [seeded] = await tenant.sql<{ sport_id: string | null }>('SELECT sport_id FROM qualification_type WHERE id = $1', [tptd]);
    assert.equal(seeded!.sport_id, 'pool', 'a new club seeds TPTD as swimming\'s');

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const standing = (await new QualificationsController().person(coach)).standings.find((s) => s.typeId === tptd);
      assert.equal(standing?.status, 'missing', 'a swimming instructor is still em falta, as before');
      const expiring = await new QualificationsController().expiring();
      assert.ok(expiring.items.some((row) => row.membershipId === coach && row.status === 'missing'));
    });
  });
});

test('POOLSE-146 b — a required type is judged for its sport\'s instructors only, in lists, alerts and the block', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [org]);
    const swimmer = await addMember(tenant, 'Pedro', 'Piscina', ['instructor']);
    const tennisCoach = await addMember(tenant, 'Teresa', 'Ténis', ['instructor']);
    await owner.query("UPDATE membership SET sports = '{tennis}' WHERE id = $1", [tennisCoach]);
    const tptd = await typeId(tenant, TPTD);
    const qualifications = new QualificationsController();

    // A tennis licence, required to teach tennis.
    const { id: tennisLicence } = await actingAs(tenant, { roles: ['admin'] }, () =>
      qualifications.createType({ name: 'Grau I Ténis', requiredToTeach: true, sportId: 'tennis' }),
    );

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      // QA 4: the tennis coach is not em falta for TPTD; the swimmer is not for the tennis licence.
      const tennisSide = (await qualifications.person(tennisCoach)).standings;
      assert.deepEqual(tennisSide.filter((s) => s.status === 'missing').map((s) => s.typeId), [tennisLicence]);
      const swimSide = (await qualifications.person(swimmer)).standings;
      assert.deepEqual(swimSide.filter((s) => s.status === 'missing').map((s) => s.typeId), [tptd]);

      const missing = (await qualifications.expiring()).items.filter((row) => row.status === 'missing');
      assert.deepEqual(
        missing.map((row) => `${row.membershipId}:${row.typeId}`).sort(),
        [`${tennisCoach}:${tennisLicence}`, `${swimmer}:${tptd}`].sort(),
      );

      // Editing a type from a form that does not offer the sport keeps it.
      await qualifications.updateType(tptd, { name: TPTD, requiredToTeach: true, defaultValidityMonths: 60 });
      assert.equal((await qualifications.types()).types.find((t) => t.id === tptd)?.sportId, 'pool');
    });

    // QA 5's alert: a TPTD running out is the swimmer's alert, never the tennis coach's.
    for (const member of [swimmer, tennisCoach]) {
      await tenant.sql(
        `INSERT INTO qualification (organization_id, membership_id, qualification_type_id, issued_on, expires_on)
         VALUES ($1, $2, $3, $4, $5)`,
        [org, member, tptd, inDays(-1700), inDays(20)],
      );
    }
    const raised = await raiseQualificationAlerts(org);
    const alerted = await tenant.sql<{ membership_id: string }>(
      `SELECT q.membership_id FROM qualification_alert a JOIN qualification q ON q.id = a.qualification_id`,
    );
    assert.ok(raised !== null);
    assert.deepEqual(alerted.map((row) => row.membership_id), [swimmer]);

    // The block asks the turma's sport: an expired swimming title blocks a swimming turma only.
    await owner.query('UPDATE qualification_type SET blocks_assignment = true WHERE id = $1', [tptd]);
    // A record is never edited by the app (archive and add again); the test moves the date on the owner login.
    await owner.query(
      `UPDATE qualification SET issued_on = $2, expires_on = $3 WHERE membership_id = $1`,
      [tennisCoach, inDays(-1900), inDays(-10)],
    );
    const [court] = await tenant.sql<{ id: string }>(
      `INSERT INTO playing_area (organization_id, facility_id, sport_id, name) VALUES ($1, $2, 'tennis', 'Campo') RETURNING id`,
      [org, tenant.facilityId],
    );
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
      [org, tenant.facilityId],
    );
    const [tennisGroup] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, playing_area_id)
       VALUES ($1, $2, $3, 'Ténis', $4) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, court!.id],
    );
    const [swimGroup] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, pool!.id],
    );
    await tenant.sql('UPDATE class_group SET instructor_membership_id = $2 WHERE id = $1', [tennisGroup!.id, tennisCoach]);
    await assert.rejects(
      () => tenant.sql('UPDATE class_group SET instructor_membership_id = $2 WHERE id = $1', [swimGroup!.id, tennisCoach]),
      (error: { detail?: string }) => (error.detail ?? '').startsWith('qualification_blocked|'),
    );
  });
});

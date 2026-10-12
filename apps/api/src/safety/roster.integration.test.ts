import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { LifeguardDutiesController, LifeguardRosterController } from './roster.controller.js';
import { FacilityIncidentsController, IncidentsController } from './incidents.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * The lifeguard roster — POOLSE-70 slice 2, QA 4 and 5.
 *
 * Both warnings are derived in SQL and **neither is a gate**: a lapsed licence
 * is said on the roster and on the incident, and the incident is still saved;
 * an hour with nobody is said, and nothing refuses anything over it. Anyone on
 * the staff can be rostered — a teacher too — and several at once.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A Monday four weeks out, so the week is in the future and the dates are fixed. */
function aMonday(): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + 28 + ((8 - day.getUTCDay()) % 7));
  return day.toISOString().slice(0, 10);
}

async function setUp(tenant: ScratchTenant): Promise<{ poolId: string; monday: string }> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque 25m') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  // Open on Mondays 09:00–13:00, so a whole day is a short, checkable window.
  await tenant.sql(
    `INSERT INTO facility_hours (organization_id, facility_id, weekday, available, opens_at, closes_at)
     VALUES ($1, $2, 1, true, '09:00', '13:00')
     ON CONFLICT (organization_id, facility_id, weekday)
     DO UPDATE SET available = true, opens_at = '09:00', closes_at = '13:00'`,
    [tenant.organizationId, tenant.facilityId],
  );
  return { poolId: pool!.id, monday: aMonday() };
}

async function isn(tenant: ScratchTenant, membershipId: string, expiresOn: string | null): Promise<void> {
  const [type] = await tenant.sql<{ id: string }>(
    `SELECT id FROM qualification_type WHERE counts_as_lifeguard AND archived_at IS NULL LIMIT 1`,
  );
  assert.ok(type, 'every club is seeded with a lifeguard qualification type');
  await tenant.sql(
    `INSERT INTO qualification (organization_id, membership_id, qualification_type_id, issued_on, expires_on)
     VALUES ($1, $2, $3, DATE '2020-01-01', $4::date)`,
    [tenant.organizationId, membershipId, type!.id, expiresOn],
  );
}

test('an open window with nobody is a gap, said exactly; a duty covering part of it leaves the rest', async () => {
  await withScratchTenant(async (tenant) => {
    const { poolId, monday } = await setUp(tenant);
    const teacher = await addMember(tenant, 'Rui', 'Professor', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const roster = new LifeguardRosterController();

      const empty = await roster.read(tenant.facilityId, monday, '1');
      assert.equal(empty.gaps.length, 1, 'the whole morning is uncovered');
      assert.equal(empty.gaps[0]?.poolId, poolId);

      // A teacher can be the lifeguard (Rui, 12 October 2026).
      await roster.add(tenant.facilityId, { poolId, membershipId: teacher, day: monday, from: '09:00', to: '11:00' });

      const half = await roster.read(tenant.facilityId, monday, '1');
      assert.equal(half.duties.length, 1);
      assert.equal(half.gaps.length, 1, 'what is left of the morning');
      const gap = half.gaps[0]!;
      assert.equal(new Date(gap.to).getTime() - new Date(gap.from).getTime(), 2 * 3_600_000, '11:00–13:00');
    });
  });
});

test('a lapsed licence is a warning on the roster and the incident, and the incident is still saved', async () => {
  await withScratchTenant(async (tenant) => {
    const { poolId } = await setUp(tenant);
    const lapsed = await addMember(tenant, 'Ana', 'Caducada', ['maintenance']);
    const valid = await addMember(tenant, 'Bruno', 'Valido', ['instructor']);

    const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await isn(tenant, lapsed, lastWeek);
    await isn(tenant, valid, null);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const roster = new LifeguardRosterController();
      // Several at once on one tank, which is allowed.
      await roster.add(tenant.facilityId, { poolId, membershipId: lapsed, day: yesterday, from: '09:00', to: '13:00' });
      await roster.add(tenant.facilityId, { poolId, membershipId: valid, day: yesterday, from: '09:00', to: '13:00' });

      const week = await roster.read(tenant.facilityId, yesterday, '1');
      const byPerson = new Map(week.duties.map((duty) => [duty.membershipId, duty.licensed]));
      assert.equal(byPerson.get(lapsed), false, 'lapsed last week: a warning');
      assert.equal(byPerson.get(valid), true);

      const on = await roster.onDuty(poolId, `${yesterday}T10:30`);
      assert.equal(on.onDuty.length, 2, 'the pre-fill offers both');

      const [student] = await tenant.sql<{ id: string }>(
        `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Rita', 'Cais') RETURNING id`,
        [tenant.organizationId],
      );
      const { id } = await new FacilityIncidentsController().record(tenant.facilityId, {
        occurredAt: `${yesterday}T10:30`,
        poolId,
        studentId: student!.id,
        lifeguardMembershipId: lapsed,
        whatHappened: 'Escorregou.',
      });
      const facts = await new IncidentsController().one(id);
      assert.equal(facts.lifeguardLicensed, false, 'said on the incident, which was saved');
    });
  });
});

test('the same person twice on one tank is refused; a non-staff person cannot be rostered', async () => {
  await withScratchTenant(async (tenant) => {
    const { poolId, monday } = await setUp(tenant);
    const teacher = await addMember(tenant, 'Rui', 'Duplo', ['instructor']);
    const parent = await addMember(tenant, 'Carla', 'Mae', ['guardian']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const roster = new LifeguardRosterController();
      const { id } = await roster.add(tenant.facilityId, { poolId, membershipId: teacher, day: monday, from: '09:00', to: '11:00' });
      await expectStatus(
        () => roster.add(tenant.facilityId, { poolId, membershipId: teacher, day: monday, from: '10:00', to: '12:00' }),
        409,
      );
      await expectStatus(
        () => roster.add(tenant.facilityId, { poolId, membershipId: parent, day: monday, from: '09:00', to: '10:00' }),
        400,
      );

      // Removed is archived: the gap comes back.
      await new LifeguardDutiesController().archive(id);
      const after = await roster.read(tenant.facilityId, monday, '1');
      assert.equal(after.duties.length, 0);
      assert.equal(after.gaps.length, 1);
    });
  });
});

test('staff read the roster; only the office writes it; a family reads none of it', async () => {
  await withScratchTenant(async (tenant) => {
    const { poolId, monday } = await setUp(tenant);
    const teacher = await addMember(tenant, 'Rui', 'Leitor', ['instructor']);
    const parent = await addMember(tenant, 'Carla', 'Familia', ['guardian']);

    await actingAs(tenant, { membershipId: teacher, roles: ['instructor'] }, async () => {
      const roster = new LifeguardRosterController();
      const read = await roster.read(tenant.facilityId, monday, '7');
      assert.equal(read.canManage, false);
      await expectStatus(
        () => roster.add(tenant.facilityId, { poolId, membershipId: teacher, day: monday, from: '09:00', to: '10:00' }),
        403,
      );
    });

    await actingAs(tenant, { membershipId: parent, roles: ['guardian'] }, async () => {
      await expectStatus(() => new LifeguardRosterController().read(tenant.facilityId, monday, '7'), 403);
      await expectStatus(() => new LifeguardRosterController().onDuty(poolId, `${monday}T10:00`), 403);
    });
  });
});

test('a day a closure shuts the site has no gap: a feriado is not "nobody on duty"', async () => {
  await withScratchTenant(async (tenant) => {
    const { monday } = await setUp(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await tenant.sql(
        `INSERT INTO closure (organization_id, facility_id, starts_on, ends_on, reason, source)
         VALUES ($1, $2, $3::date, $3::date, 'Feriado municipal', 'manual')`,
        [tenant.organizationId, tenant.facilityId, monday],
      );
      const roster = await new LifeguardRosterController().read(tenant.facilityId, monday, '1');
      assert.equal(roster.gaps.length, 0);
    });
  });
});

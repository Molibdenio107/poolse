import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';
import { DashboardController } from './dashboard.controller.js';
import type { Dashboard } from './compose.js';
import type { ChildAttendance, ChildNextClass, PoolTemperature } from './family.repository.js';
import type { ChildPlanWidget } from './resolvers.js';

/**
 * The personal band — POOLSE-66 slice 5, 15 October 2026.
 *
 * Guardians and students, about one child at a time, chosen by `?child=` from
 * the reader's own records. QA 3 (a student's payload carries no staff keys),
 * QA 5 (a cancelled week gives the following one), QA 7 (a moved week reads its
 * new hour), QA 8 (three dependents, one at another site), QA 9 (a senior who
 * is both), plus the refusal: a child who is not theirs is a 404, never their
 * cards.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const dashboard = new DashboardController();
const TZ = `'Europe/Lisbon'`;

/** A Lisbon wall-clock instant, `days` from today. */
function at(days: number, time: string): string {
  return `(((now() AT TIME ZONE ${TZ})::date + ${days}) + TIME '${time}') AT TIME ZONE ${TZ}`;
}

function card<T>(page: Dashboard, id: string): { state: string; data: T } | undefined {
  return page.bands
    .flatMap((band) => band.widgets)
    .find((one) => one.id === id) as { state: string; data: T } | undefined;
}

interface Turma {
  poolId: string;
  groupId: string;
}

async function turma(
  tenant: ScratchTenant,
  name: string,
  instructor: string,
  facilityId = tenant.facilityId,
): Promise<Turma> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.organizationId, facilityId, `Tanque ${name}`],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group
       (organization_id, season_id, facility_id, name, pool_id, instructor_membership_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, facilityId, name, pool!.id, instructor],
  );
  return { poolId: pool!.id, groupId: group!.id };
}

async function student(tenant: ScratchTenant, first: string, membershipId: string | null = null): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, membership_id)
     VALUES ($1, $2, 'Família', $3) RETURNING id`,
    [tenant.organizationId, first, membershipId],
  );
  return row!.id;
}

/** Enrolled since a month ago, so every lesson this month is theirs. */
async function enrol(tenant: ScratchTenant, studentId: string, groupId: string): Promise<void> {
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
     VALUES ($1, $2, $3, 'active', club_today() - 40)`,
    [tenant.organizationId, groupId, studentId],
  );
}

async function guardianOf(tenant: ScratchTenant, studentId: string, guardian: string): Promise<void> {
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship)
     VALUES ($1, $2, $3, 'mãe')`,
    [tenant.organizationId, studentId, guardian],
  );
}

async function session(
  tenant: ScratchTenant,
  t: Turma,
  startsAt: string,
  instructor: string,
  status: 'scheduled' | 'cancelled' = 'scheduled',
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session
       (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on,
        instructor_membership_id, status)
     VALUES ($1, $2, $3, ${startsAt}, 45, (${startsAt} AT TIME ZONE ${TZ})::date, $4, $5)
     RETURNING id`,
    [tenant.organizationId, t.groupId, t.poolId, instructor, status],
  );
  return row!.id;
}

function asMember(
  tenant: ScratchTenant,
  membershipId: string,
  roles: ('guardian' | 'student' | 'instructor')[],
  child?: string,
): Promise<Dashboard> {
  return actingAs(tenant, { membershipId, roles }, () => dashboard.read(undefined, child));
}

test('QA 3 — a student gets their own band and no staff key anywhere in the payload', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Instrutora', ['instructor']);
    const bruno = await addMember(tenant, 'Bruno', 'Aluno', ['student']);
    const me = await student(tenant, 'Bruno', bruno);
    const golfinhos = await turma(tenant, 'Golfinhos', ana);
    await enrol(tenant, me, golfinhos.groupId);
    await session(tenant, golfinhos, at(1, '18:00'), ana);

    const page = await asMember(tenant, bruno, ['student']);
    assert.deepEqual(page.bands.map((band) => band.id), ['personal']);
    const raw = JSON.stringify(page);
    assert.ok(!raw.includes('"mgmt.'), 'no management key');
    assert.ok(!raw.includes('"inst.'), 'no instructor key');
    assert.ok(!raw.includes('"maint.'), 'no maintenance key');

    assert.deepEqual(page.family, {
      children: [{ id: me, name: page.family!.children[0]!.name, self: true }],
      selectedId: me,
    });
    const next = card<ChildNextClass>(page, 'me.nextclass');
    assert.equal(next?.state, 'ok');
    assert.equal(next!.data.className, 'Golfinhos');
    assert.equal(next!.data.localTime, '18:00');
    assert.ok(next!.data.instructorName?.startsWith('Ana'), 'who teaches it');
  });
});

test('QA 5 and 7 — a cancelled week gives the following one, and a moved week reads its new hour', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Instrutora', ['instructor']);
    const marta = await addMember(tenant, 'Marta', 'Mãe', ['guardian']);
    const alice = await student(tenant, 'Alice');
    await guardianOf(tenant, alice, marta);
    const golfinhos = await turma(tenant, 'Golfinhos', ana);
    await enrol(tenant, alice, golfinhos.groupId);

    await session(tenant, golfinhos, at(1, '18:00'), ana, 'cancelled');
    const moved = await session(tenant, golfinhos, at(8, '18:00'), ana);
    // The week after was moved by hand to the morning.
    await tenant.sql(
      `UPDATE class_session SET starts_at = ${at(8, '10:00')}, moved_at = now() WHERE id = $1`,
      [moved],
    );

    const next = card<ChildNextClass>(await asMember(tenant, marta, ['guardian']), 'me.nextclass');
    assert.equal(next!.data.sessionId, moved, 'not the cancelled week');
    assert.equal(next!.data.localTime, '10:00', 'the hour it was moved to');
  });
});

test('QA 8 — three children, one at another site: each child resolves to their own pool', async () => {
  await withScratchTenant(async (tenant) => {
    await tenant.sql('UPDATE organization SET max_facilities = 2 WHERE id = $1', [tenant.organizationId]);
    const [second] = await tenant.sql<{ id: string }>(
      `INSERT INTO facility (organization_id, name) VALUES ($1, 'Piscina Norte') RETURNING id`,
      [tenant.organizationId],
    );

    const ana = await addMember(tenant, 'Ana', 'Instrutora', ['instructor']);
    const marta = await addMember(tenant, 'Marta', 'Mãe', ['guardian']);
    const here = await turma(tenant, 'Golfinhos', ana);
    const there = await turma(tenant, 'Tubarões', ana, second!.id);

    await session(tenant, here, at(2, '17:00'), ana);
    await session(tenant, there, at(2, '19:00'), ana);

    const kids: string[] = [];
    for (const [name, t] of [['Alice', here], ['Beatriz', here], ['Carlos', there]] as const) {
      const id = await student(tenant, name);
      await guardianOf(tenant, id, marta);
      await enrol(tenant, id, t.groupId);
      kids.push(id);
    }

    const first = await asMember(tenant, marta, ['guardian']);
    assert.equal(first.family!.children.length, 3);
    assert.equal(first.family!.selectedId, first.family!.children[0]!.id, 'the first by default');

    const carlos = await asMember(tenant, marta, ['guardian'], kids[2]);
    assert.equal(carlos.family!.selectedId, kids[2]);
    assert.equal(card<ChildNextClass>(carlos, 'me.nextclass')!.data.poolName, 'Tanque Tubarões');
    assert.equal(card<ChildNextClass>(first, 'me.nextclass')!.data.poolName, 'Tanque Golfinhos');
  });
});

test('QA 9 — a senior who is a student and a guardian sees themselves first, then the child', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Instrutora', ['instructor']);
    const avo = await addMember(tenant, 'Rosa', 'Avó', ['student', 'guardian']);
    const self = await student(tenant, 'Rosa', avo);
    const neta = await student(tenant, 'Inês');
    await guardianOf(tenant, neta, avo);
    const t = await turma(tenant, 'Hidroginástica', ana);
    await enrol(tenant, self, t.groupId);

    const page = await asMember(tenant, avo, ['student', 'guardian']);
    assert.deepEqual(
      page.family!.children.map((child) => [child.id, child.self]),
      [[self, true], [neta, false]],
    );
    assert.equal(page.family!.selectedId, self);

    // The granddaughter has no lessons: her cards say so rather than vanish.
    const ines = await asMember(tenant, avo, ['student', 'guardian'], neta);
    assert.equal(card(ines, 'me.nextclass')?.state, 'empty');
  });
});

test("a child who is not the reader's is a 404, and a guardian with nobody has no band", async () => {
  await withScratchTenant(async (tenant) => {
    const marta = await addMember(tenant, 'Marta', 'Mãe', ['guardian']);
    const zeca = await addMember(tenant, 'Zeca', 'Estranho', ['guardian']);
    const alice = await student(tenant, 'Alice');
    await guardianOf(tenant, alice, marta);

    await actingAs(tenant, { membershipId: zeca, roles: ['guardian'] }, async () => {
      await expectStatus(() => dashboard.read(undefined, alice), 404);
      const page = await dashboard.read();
      assert.equal(page.family, null);
      assert.deepEqual(page.bands, [], 'absent, not a row of empty cards');
    });

    // An instructor holds no family role: no band, and `?child=` is not theirs either.
    const ana = await addMember(tenant, 'Ana', 'Instrutora', ['instructor']);
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, async () => {
      await expectStatus(() => dashboard.read(undefined, alice), 404);
    });
  });
});

test("the plan, this month's register and the water are the child's own", async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Instrutora', ['instructor']);
    const marta = await addMember(tenant, 'Marta', 'Mãe', ['guardian']);
    const alice = await student(tenant, 'Alice');
    await guardianOf(tenant, alice, marta);
    const t = await turma(tenant, 'Golfinhos', ana);
    await enrol(tenant, alice, t.groupId);

    // Earlier today, held and over (five minutes long), and Alice was there.
    const [held] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session
         (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on,
          instructor_membership_id)
       VALUES ($1, $2, $3, now() - interval '7 minutes', 5, club_today(), $4) RETURNING id`,
      [tenant.organizationId, t.groupId, t.poolId, ana],
    );
    await tenant.sql(
      `INSERT INTO attendance (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
       VALUES ($1, $2, $3, 'present', $4)`,
      [tenant.organizationId, held!.id, alice, ana],
    );

    const next = await session(tenant, t, at(3, '18:00'), ana);
    await tenant.sql(
      `INSERT INTO lesson_plan (organization_id, class_group_id, on_date, body, updated_by)
       SELECT $1, $2, occurs_on, 'Crol: 4 × 25 m', $3 FROM class_session WHERE id = $4`,
      [tenant.organizationId, t.groupId, ana, next],
    );

    const [analysis] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool_analysis (organization_id, pool_id, taken_at)
       VALUES ($1, $2, now() - interval '1 hour') RETURNING id`,
      [tenant.organizationId, t.poolId],
    );
    await tenant.sql(
      `INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit)
       VALUES ($1, $2, 'temperature', 28.5, '°C')`,
      [tenant.organizationId, analysis!.id],
    );

    const page = await asMember(tenant, marta, ['guardian']);

    const attendance = card<ChildAttendance>(page, 'me.attendance');
    assert.equal(attendance?.state, 'ok');
    assert.equal(attendance!.data.present, 1);
    assert.equal(attendance!.data.unmarked, attendance!.data.held - 1);

    const plan = card<ChildPlanWidget>(page, 'me.trainingplan');
    assert.equal(plan?.state, 'ok');
    assert.equal(plan!.data.body, 'Crol: 4 × 25 m');
    assert.ok(!JSON.stringify(plan!.data).includes('updatedBy'), 'no author for a family');

    // No fee line is agreed. Four places in the band, and an empty card never
    // takes the place of one with something to say — so the fees card is the
    // one left out here, and the water is shown.
    assert.notEqual(card(page, 'me.fees')?.state, 'ok');
    const water = card<PoolTemperature>(page, 'me.water');
    assert.equal(water?.state, 'ok');
    assert.equal(Number(water!.data.celsius), 28.5);
  });
});

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { SearchController } from './search.controller.js';
import { readTerm } from './search.repository.js';

/**
 * Ctrl+K's data search — POOLSE-235, QA 1–8, against the real database: what
 * the office finds by name, NIF and phone; what an instructor finds (their own
 * turmas' students, by name only); who is refused; another club never answers;
 * and no result ever carries a NIF, phone or birth date.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const STUDENT_NIF = '234567899';
const GUARDIAN_NIF = '501964843';

interface Fixture {
  ines: string;
  joao: string;
  coach: string;
  parent: string;
  keeper: string;
  turma: string;
}

async function fixture(tenant: ScratchTenant): Promise<Fixture> {
  const [ines] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, tax_number, contact_phone, birth_date)
     VALUES ($1, 'Inês', 'Silva', $2, '+351 912 345 678', '2015-04-03') RETURNING id`,
    [tenant.organizationId, STUDENT_NIF],
  );
  const [joao] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'João', 'Costa') RETURNING id`,
    [tenant.organizationId],
  );
  const coach = await addMember(tenant, 'Carla', 'Treinadora', ['instructor']);
  const keeper = await addMember(tenant, 'Manuel', 'Manutencao', ['maintenance']);
  const parent = await addMember(tenant, 'Maria', 'Silva', ['guardian']);
  await tenant.sql(`UPDATE membership SET tax_number = $2, phone = '913 222 333' WHERE id = $1`, [parent, GUARDIAN_NIF]);
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'mãe', true)`,
    [tenant.organizationId, ines!.id, parent],
  );
  const [site] = await tenant.sql<{ id: string }>(
    'SELECT id FROM facility WHERE organization_id = $1 ORDER BY created_at LIMIT 1',
    [tenant.organizationId],
  );
  const [season] = await tenant.sql<{ id: string }>(
    'SELECT id FROM season WHERE organization_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1',
    [tenant.organizationId],
  );
  const [turma] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, name, season_id, facility_id, instructor_membership_id)
     VALUES ($1, 'Golfinhos', $2, $3, $4) RETURNING id`,
    [tenant.organizationId, season!.id, site!.id, coach],
  );
  await tenant.sql(
    `INSERT INTO class_group (organization_id, name, season_id, facility_id) VALUES ($1, 'Tubarões', $2, $3)`,
    [tenant.organizationId, season!.id, site!.id],
  );
  await tenant.sql(`INSERT INTO enrollment (organization_id, class_group_id, student_id) VALUES ($1, $2, $3)`, [
    tenant.organizationId,
    turma!.id,
    ines!.id,
  ]);
  return { ines: ines!.id, joao: joao!.id, coach, parent, keeper, turma: turma!.id };
}

const ids = (rows: { id: string }[]): string[] => rows.map((row) => row.id);

test('POOLSE-235 — the office finds by name (accents folded), exact NIF and the phone’s last nine', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await fixture(tenant);
    const search = new SearchController();
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(ids((await search.find('ines')).students), [f.ines]);
      assert.deepEqual(ids((await search.find('INÊS sil')).students), [f.ines]);
      assert.deepEqual(ids((await search.find(STUDENT_NIF)).students), [f.ines]);
      assert.deepEqual(ids((await search.find(STUDENT_NIF.slice(0, 5))).students), []);
      assert.deepEqual(ids((await search.find('912 345 678')).students), [f.ines]);
      assert.deepEqual(ids((await search.find('00351912345678')).students), [f.ines]);
      assert.deepEqual(ids((await search.find('2345')).students), []);

      // A guardian by NIF or phone opens their child, named in the context.
      const byNif = await search.find(GUARDIAN_NIF);
      assert.equal(byNif.guardians.length, 1);
      assert.equal(byNif.guardians[0]!.studentId, f.ines);
      assert.match(byNif.guardians[0]!.of, /Inês/);
      assert.equal((await search.find('913222333')).guardians.length, 1);

      // Staff and turmas by name, a turma also by its instructor.
      assert.ok(ids((await search.find('carla')).staff).includes(f.coach));
      assert.deepEqual(ids((await search.find('golfi')).turmas), [f.turma]);
      assert.ok(ids((await search.find('treinadora')).turmas).includes(f.turma));
    });
  });
});

test('POOLSE-235 — no result carries what it matched on', async () => {
  await withScratchTenant(async (tenant) => {
    await fixture(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const found = await new SearchController().find(STUDENT_NIF);
      const text = JSON.stringify(await new SearchController().find('silva')) + JSON.stringify(found);
      for (const secret of [STUDENT_NIF, GUARDIAN_NIF, '912 345 678', '913 222 333', '2015-04-03']) {
        assert.ok(!text.includes(secret), `a result leaked ${secret}`);
      }
      for (const row of found.students) assert.deepEqual(Object.keys(row).sort(), ['id', 'level', 'name']);
    });
  });
});

test('POOLSE-235 — an instructor finds their own turmas’ students, by name only', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await fixture(tenant);
    const search = new SearchController();
    await actingAs(tenant, { membershipId: f.coach, roles: ['instructor'] }, async () => {
      assert.deepEqual(ids((await search.find('ines')).students), [f.ines]);
      // Not in a turma they teach.
      assert.deepEqual(ids((await search.find('joao')).students), []);
      // Never by NIF or phone, and never a guardian.
      assert.deepEqual(ids((await search.find(STUDENT_NIF)).students), []);
      assert.deepEqual(ids((await search.find('912345678')).students), []);
      assert.deepEqual((await search.find('maria')).guardians, []);
      // Staff names, and only their own turmas.
      assert.ok(ids((await search.find('manuel')).staff).includes(f.keeper));
      assert.deepEqual(ids((await search.find('tubar')).turmas), []);
      assert.deepEqual(ids((await search.find('golfi')).turmas), [f.turma]);
    });
  });
});

test('POOLSE-235 — maintenance and families are refused; odd input is literal and bounded', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await fixture(tenant);
    const search = new SearchController();
    for (const [membershipId, role] of [
      [f.keeper, 'maintenance'],
      [f.parent, 'guardian'],
    ] as const) {
      await actingAs(tenant, { membershipId, roles: [role] }, async () => {
        await expectStatus(() => search.find('ines'), 403);
      });
    }
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      for (const odd of ['%', '%%', '__', "'; --", 'ç ã é']) {
        const found = await search.find(odd);
        assert.deepEqual(found.students, [], odd);
      }
      assert.deepEqual(await search.find('i'), { students: [], guardians: [], staff: [], turmas: [] });
      await expectStatus(() => search.find('x'.repeat(101)), 400);
    });
  });
});

test('POOLSE-235 — another club never answers', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      await fixture(theirs);
      await actingAs(mine, { roles: ['owner'] }, async () => {
        const found = await new SearchController().find('ines');
        assert.deepEqual(found.students, []);
        assert.deepEqual((await new SearchController().find(STUDENT_NIF)).students, []);
        assert.deepEqual((await new SearchController().find('golfi')).turmas, []);
      });
    });
  });
});

test('POOLSE-235 — what a term can mean', () => {
  assert.deepEqual(readTerm(' 234 567 899 '), { text: '234 567 899', nif: '234567899', phone: '234567899' });
  assert.deepEqual(readTerm('+351 912 345 678'), { text: '+351 912 345 678', nif: null, phone: '912345678' });
  assert.deepEqual(readTerm('Inês 12345'), { text: 'Inês 12345', nif: null, phone: null });
});

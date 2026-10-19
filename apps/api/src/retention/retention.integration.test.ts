import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutTenantScope } from '@poolse/db';
import { RetentionService } from './retention.service.js';
import { FeePeriodsController, FeePlansController } from '../billing/fees.controller.js';
import { actingAs, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * Retention — roadmap 7b.8, Rui 16-10-2026.
 *
 * A student who left a year ago loses their health data; one who left five
 * years ago loses their identity, and the people who existed only for them go
 * with it. A student still enrolled is never touched, and a guardian who still
 * has a child at the club keeps their name. A second night does nothing.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const CIPHER = 'v1.aaaa.bbbb.cccc';

async function student(tenant: ScratchTenant, name: string, archivedYearsAgo: number | null) {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, contact_phone, tax_number,
                          notes, emergency_contact_name, emergency_contact_phone, archived_at,
                          created_at)
     VALUES ($1, $2, 'Sousa', '912345678', NULL, 'nota da secretaria', 'Avó Rosa', '934000111',
             CASE WHEN $3::int IS NULL THEN NULL ELSE now() - make_interval(years => $3::int) END,
             now() - interval '7 years')
     RETURNING id`,
    [tenant.organizationId, name, archivedYearsAgo],
  );
  const id = row!.id;
  await tenant.sql(
    `INSERT INTO student_sensitive (organization_id, student_id, medical_notes_encrypted)
     VALUES ($1, $2, $3)`,
    [tenant.organizationId, id, CIPHER],
  );
  await tenant.sql(
    `INSERT INTO consent (organization_id, student_id, kind, granted, evidence_note)
     VALUES ($1, $2, 'medical_data', true, 'e-mail da mãe')`,
    [tenant.organizationId, id],
  );
  await tenant.sql(
    `INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
     VALUES ($1, 'student.updated', 'student', $2, jsonb_build_object('name', $3::text))`,
    [tenant.organizationId, id, `${name} Sousa`],
  );
  return id;
}

async function guardian(tenant: ScratchTenant, first: string, studentIds: string[]) {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO membership (organization_id, status, first_name, last_name, email, phone)
     VALUES ($1, 'active', $2, 'Sousa', $3::citext, '966000000') RETURNING id`,
    [tenant.organizationId, first, `${first.toLowerCase()}.${Date.now()}@example.test`],
  );
  await tenant.sql(
    `INSERT INTO membership_role (organization_id, membership_id, role) VALUES ($1, $2, 'guardian')`,
    [tenant.organizationId, row!.id],
  );
  for (const studentId of studentIds) {
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship)
       VALUES ($1, $2, $3, 'mãe')`,
      [tenant.organizationId, studentId, row!.id],
    );
  }
  return row!.id;
}

async function incident(tenant: ScratchTenant, studentId: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO incident (organization_id, facility_id, occurred_at, student_id, recorded_by)
     VALUES ($1, $2, now() - interval '6 years 6 months', $3, $4) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, studentId, tenant.ownerMembershipId],
  );
  await tenant.sql(
    `INSERT INTO incident_detail (organization_id, incident_id, what_happened_encrypted)
     VALUES ($1, $2, $3)`,
    [tenant.organizationId, row!.id, CIPHER],
  );
  return row!.id;
}

async function one<T extends object>(tenant: ScratchTenant, sql: string, values: unknown[]): Promise<T> {
  const [row] = await tenant.sql<T>(sql, values);
  return row!;
}

test('a year after leaving the health data goes, five years after the identity goes', async () => {
  await withScratchTenant(async (tenant) => {
    const longGone = await student(tenant, 'Rita', 6);
    const recent = await student(tenant, 'Tiago', 2);
    const fresh = await student(tenant, 'Maria', 0);
    const enrolled = await student(tenant, 'Joana', null);

    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, facility_id, season_id, name)
       VALUES ($1, $2, $3, 'Cadetes') RETURNING id`,
      [tenant.organizationId, tenant.facilityId, tenant.seasonId],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [tenant.organizationId, group!.id, enrolled],
    );

    const onlyMother = await guardian(tenant, 'Ana', [longGone]);
    const sharedFather = await guardian(tenant, 'Rui', [longGone, enrolled]);
    const accident = await incident(tenant, longGone);
    // POOLSE-81: the FPN licence is identity too.
    await tenant.sql(`UPDATE student SET federation_licence = 'FPN-123' WHERE id = $1`, [longGone]);

    const run = await new RetentionService().run(tenant.organizationId);
    assert.equal(run.healthErased, 2, 'Rita and Tiago left more than a year ago');
    assert.equal(run.anonymised, 1, 'only Rita left more than five years ago');

    // --- Rita: everything personal is gone, the record itself stays.
    const rita = await one<Record<string, unknown>>(
      tenant,
      `SELECT first_name, last_name, contact_phone, notes, emergency_contact_name,
              health_erased_at, anonymised_at, federation_licence
         FROM student WHERE id = $1`,
      [longGone],
    );
    assert.equal(rita['federation_licence'], null, 'the FPN licence goes with the identity');
    assert.equal(`${rita['first_name']} ${rita['last_name']}`, 'Aluno anonimizado');
    assert.equal(rita['contact_phone'], null);
    assert.equal(rita['notes'], null);
    assert.equal(rita['emergency_contact_name'], null);
    assert.ok(rita['health_erased_at'] !== null && rita['anonymised_at'] !== null);

    const left = await one<{ sensitive: number; consents: number; details: number; named: number }>(
      tenant,
      `SELECT (SELECT count(*)::int FROM student_sensitive WHERE student_id = $1) AS sensitive,
              (SELECT count(*)::int FROM consent WHERE student_id = $1) AS consents,
              (SELECT count(*)::int FROM incident_detail WHERE incident_id = $2) AS details,
              (SELECT count(*)::int FROM audit_log WHERE entity_id = $1 AND data ? 'name') AS named`,
      [longGone, accident],
    );
    assert.deepEqual(left, { sensitive: 0, consents: 0, details: 0, named: 0 });
    const facts = await one<{ n: number }>(
      tenant,
      'SELECT count(*)::int AS n FROM incident WHERE id = $1',
      [accident],
    );
    assert.equal(facts.n, 1, 'the incident’s facts stay; only its words go');

    // --- Her mother existed only for her; her father still has Joana here.
    const mother = await one<Record<string, unknown>>(
      tenant,
      'SELECT first_name, email, phone, archived_at FROM membership WHERE id = $1',
      [onlyMother],
    );
    assert.equal(mother['first_name'], 'Pessoa');
    assert.equal(mother['email'], null);
    assert.ok(mother['archived_at'] !== null);
    const father = await one<Record<string, unknown>>(
      tenant,
      'SELECT first_name, phone FROM membership WHERE id = $1',
      [sharedFather],
    );
    assert.equal(father['first_name'], 'Rui');
    assert.equal(father['phone'], '966000000');

    // --- Tiago: health gone, name kept.
    const tiago = await one<Record<string, unknown>>(
      tenant,
      `SELECT first_name, emergency_contact_name, anonymised_at,
              (SELECT count(*)::int FROM student_sensitive WHERE student_id = $1) AS sensitive
         FROM student WHERE id = $1`,
      [recent],
    );
    assert.equal(tiago['first_name'], 'Tiago');
    assert.equal(tiago['emergency_contact_name'], null);
    assert.equal(tiago['anonymised_at'], null);
    assert.equal(tiago['sensitive'], 0);

    // --- Maria left this week, Joana never left: both untouched.
    for (const id of [fresh, enrolled]) {
      const kept = await one<{ sensitive: number; contact: string | null }>(
        tenant,
        `SELECT (SELECT count(*)::int FROM student_sensitive WHERE student_id = $1) AS sensitive,
                emergency_contact_name AS contact
           FROM student WHERE id = $1`,
        [id],
      );
      assert.deepEqual(kept, { sensitive: 1, contact: 'Avó Rosa' });
    }

    // --- Recorded, and a second night does nothing.
    const recorded = await one<{ n: number }>(
      tenant,
      `SELECT count(*)::int AS n FROM audit_log
        WHERE organization_id = $1 AND action IN ('retention.health_erased', 'retention.anonymised')`,
      [tenant.organizationId],
    );
    assert.equal(recorded.n, 3);
    const again = await new RetentionService().run(tenant.organizationId);
    assert.deepEqual(
      { health: again.healthErased, identity: again.anonymised },
      { health: 0, identity: 0 },
    );
  });
});

test('the function refuses to run without a tenant context', async () => {
  // The app login with no club set: it must refuse rather than guess which club.
  await assert.rejects(
    () => withoutTenantScope((tx) => tx.query('SELECT * FROM apply_retention()')),
    /tenant context/,
  );
});

test('sweep 16-10 — a member still paying, a student never placed, and an emergency contact are kept', async () => {
  await withScratchTenant(async (tenant) => {
    // A sócio whose only turma ended years ago but who still pays a fee line.
    const socio = await student(tenant, 'Sara', null);
    const [level] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, 'Adultos', 1) RETURNING id`,
      [tenant.organizationId],
    );
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, facility_id, season_id, name, level_id)
       VALUES ($1, $2, $3, 'Adultos', $4) RETURNING id`,
      [tenant.organizationId, tenant.facilityId, tenant.seasonId, level!.id],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on, ended_on)
       VALUES ($1, $2, $3, 'ended', club_today() - 2500, club_today() - 2000)`,
      [tenant.organizationId, group!.id, socio],
    );
    const { plan, mensal } = await actingAs(tenant, { roles: ['owner'] }, async () => ({
      mensal: (
        await new FeePeriodsController().create(tenant.facilityId, { name: 'Mensal', months: 1, isDefault: true })
      ).id,
      plan: (
        await new FeePlansController().create(tenant.facilityId, {
          kind: 'mensalidade',
          levelId: level!.id,
          lessonsPerWeek: 1,
          amountCents: 3000,
        })
      ).id,
    }));
    await tenant.sql(
      `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id, amount_cents, starts_on)
       VALUES ($1, $2, $3, $4, 3000, club_today() - 2500)`,
      [tenant.organizationId, socio, plan, mensal],
    );

    // A student created years ago and never placed in a turma, not archived.
    const waiting = await student(tenant, 'Vera', null);

    // Rita left six years ago; her mother is also Joana's emergency contact.
    const gone = await student(tenant, 'Rita', 6);
    const joana = await student(tenant, 'Joana', null);
    const mother = await guardian(tenant, 'Ana', [gone]);
    await tenant.sql(
      `UPDATE student SET emergency_contact_name = NULL, emergency_contact_phone = NULL,
                          emergency_contact_relationship = NULL,
                          emergency_contact_membership_id = $2
        WHERE id = $1`,
      [joana, mother],
    );

    const run = await new RetentionService().run(tenant.organizationId);
    assert.equal(run.anonymised, 1, 'only Rita');
    assert.equal(run.healthErased, 1, 'only Rita');

    for (const id of [socio, waiting]) {
      const kept = await one<{ left: string | null; sensitive: number }>(
        tenant,
        `SELECT student_left_on($1)::text AS left,
                (SELECT count(*)::int FROM student_sensitive WHERE student_id = $1) AS sensitive`,
        [id],
      );
      assert.deepEqual(kept, { left: null, sensitive: 1 }, 'a member and a waiting student have not left');
    }

    const contact = await one<{ first_name: string; phone: string | null }>(
      tenant,
      'SELECT first_name, phone FROM membership WHERE id = $1',
      [mother],
    );
    assert.deepEqual(contact, { first_name: 'Ana', phone: '966000000' }, "Joana's emergency contact is untouched");
  });
});

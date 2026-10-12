import { after, test } from 'node:test';
import assert from 'node:assert/strict';
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
 * Bather incidents — POOLSE-70 slice 1, the QA scenarios of the ticket.
 *
 * The ones that matter most: the facts cannot be edited (the grant, not the
 * code), the database holds ciphertext and nothing else for the health detail,
 * and every decrypting read leaves a row in the audit log.
 *
 * Run: pnpm api:test   (needs pnpm db:up and SENSITIVE_DATA_KEY)
 */

after(closeHarness);

async function student(tenant: ScratchTenant): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Rita', 'Queda')
     RETURNING id`,
    [tenant.organizationId],
  );
  return row!.id;
}

function yesterdayAt(time: string): string {
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return `${day}T${time}`;
}

function incident(studentId: string): Record<string, unknown> {
  return {
    occurredAt: yesterdayAt('10:30'),
    studentId,
    emergencyCalled: false,
    whatHappened: 'Escorregou no cais junto à escada.',
    injury: 'Corte no joelho esquerdo',
    firstAid: 'Desinfetado e penso aplicado',
  };
}

test('an incident is written once: its facts cannot be updated, and a correction is an addendum', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await new FacilityIncidentsController().record(
        tenant.facilityId,
        incident(await student(tenant)),
      );

      // The grant refuses, whatever the code does.
      await assert.rejects(
        () =>
          tenant.sql(`UPDATE incident SET emergency_called = true WHERE id = $1`, [id]),
        /permission denied/,
      );
      await assert.rejects(
        () => tenant.sql(`UPDATE incident_detail SET injury_encrypted = NULL WHERE incident_id = $1`, [id]),
        /permission denied/,
      );

      const incidents = new IncidentsController();
      await incidents.addendum(id, { body: 'Afinal foi o joelho direito.' });
      await incidents.addendum(id, { body: 'Os pais foram avisados às 11:00.' });

      const facts = await incidents.one(id);
      assert.equal(facts.addenda.length, 2);
      const detail = await incidents.detail(id);
      assert.deepEqual(
        detail.addenda.map((a) => a.body),
        ['Afinal foi o joelho direito.', 'Os pais foram avisados às 11:00.'],
        'in the order they were written',
      );
    });
  });
});

test('the health detail is ciphertext in the database, and every read is logged', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await new FacilityIncidentsController().record(
        tenant.facilityId,
        incident(await student(tenant)),
      );

      const [row] = await tenant.sql<{ what: string; injury: string }>(
        `SELECT what_happened_encrypted AS what, injury_encrypted AS injury
           FROM incident_detail WHERE incident_id = $1`,
        [id],
      );
      assert.match(row!.what, /^v1\./);
      assert.doesNotMatch(row!.what, /cais/);
      assert.doesNotMatch(row!.injury, /joelho/);

      // And the database refuses prose outright.
      await assert.rejects(
        () =>
          tenant.sql(
            `INSERT INTO incident_addendum (organization_id, incident_id, body_encrypted, written_by)
             VALUES ($1, $2, 'texto às claras', $3)`,
            [tenant.organizationId, id, tenant.ownerMembershipId],
          ),
        /incident_addendum_ciphertext/,
      );

      const incidents = new IncidentsController();
      const detail = await incidents.detail(id);
      assert.equal(detail.injury, 'Corte no joelho esquerdo');
      await incidents.detail(id);

      const [log] = await tenant.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log
          WHERE action = 'incident_detail.read' AND entity_id = $1`,
        [id],
      );
      assert.equal(log?.n, 2, 'one audit row per read');
    });
  });
});

test('an instructor who did not write it sees the facts and is refused the detail; the author is not', async () => {
  await withScratchTenant(async (tenant) => {
    const rita = await student(tenant);
    const author = await addMember(tenant, 'Ana', 'Autora', ['instructor']);
    const other = await addMember(tenant, 'Bruno', 'Outro', ['instructor']);

    const id = await actingAs(tenant, { membershipId: author, roles: ['instructor'] }, async () => {
      const { id: created } = await new FacilityIncidentsController().record(
        tenant.facilityId,
        incident(rita),
      );
      const own = await new IncidentsController().detail(created);
      assert.equal(own.firstAid, 'Desinfetado e penso aplicado', 'the author reads back what they wrote');
      return created;
    });

    await actingAs(tenant, { membershipId: other, roles: ['instructor'] }, async () => {
      const incidents = new IncidentsController();
      const facts = await incidents.one(id);
      assert.equal(facts.canReadDetail, false);
      assert.equal(facts.personName, 'Rita Queda', 'the facts are any staff member’s');
      await expectStatus(() => incidents.detail(id), 403);
      await expectStatus(() => incidents.addendum(id, { body: 'Nota' }), 403);
      await expectStatus(() => incidents.archive(id), 403);
    });

    // A student or a guardian never reaches any of it.
    const guardian = await addMember(tenant, 'Carla', 'Mãe', ['guardian']);
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      await expectStatus(() => new FacilityIncidentsController().list(tenant.facilityId), 403);
      await expectStatus(() => new IncidentsController().one(id), 403);
    });
  });
});

test("another club's incident is not there", async () => {
  await withScratchTenant(async (clubA) => {
    await withScratchTenant(async (clubB) => {
      const idOfB = await actingAs(clubB, { roles: ['owner'] }, async () => {
        const { id } = await new FacilityIncidentsController().record(
          clubB.facilityId,
          incident(await student(clubB)),
        );
        return id;
      });

      await actingAs(clubA, { roles: ['owner'] }, async () => {
        const incidents = new IncidentsController();
        await expectStatus(() => incidents.one(idOfB), 404);
        await expectStatus(() => incidents.detail(idOfB), 404);
        await expectStatus(() => incidents.addendum(idOfB, { body: 'x' }), 404);
        const list = await new FacilityIncidentsController().list(clubA.facilityId);
        assert.equal(list.items.length, 0);
      });
    });
  });
});

test('an incident in the future, or with nobody named, is refused by field', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const facilities = new FacilityIncidentsController();
      const rita = await student(tenant);
      const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      await expectStatus(
        () => facilities.record(tenant.facilityId, { ...incident(rita), occurredAt: `${tomorrow}T10:00` }),
        400,
      );
      await expectStatus(
        () => facilities.record(tenant.facilityId, { ...incident(rita), studentId: undefined }),
        400,
      );
      await expectStatus(
        () =>
          facilities.record(tenant.facilityId, {
            ...incident(rita),
            visitorName: 'Visitante',
          }),
        400,
      );
    });
  });
});

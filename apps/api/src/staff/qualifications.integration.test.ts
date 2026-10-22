import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { QualificationsController } from './qualifications.controller.js';
import { AttachmentsController } from '../files/attachments.controller.js';
import {
  deliverQualificationAlerts,
  raiseQualificationAlerts,
} from './qualification-alerts.js';
import { qualificationRefusal } from './qualification-refusal.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Qualifications with expiry — POOLSE-27, 7b.2.
 *
 * The status boundaries are the rule, so they are pinned to the day: 90 days
 * out is âmbar, 91 is verde, yesterday is vermelho, no expiry is verde for ever.
 * Then the three things that would silently go wrong: a renewal must supersede
 * without deleting, the alert job must notify once per crossing, and the block
 * must be opt-in, on new assignments only, and only for an expired record.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** `YYYY-MM-DD`, `days` from today in Lisbon. */
async function inDays(tenant: ScratchTenant, days: number): Promise<string> {
  const [row] = await tenant.sql<{ d: string }>(
    `SELECT to_char(club_today() + $1::int, 'YYYY-MM-DD') AS d`,
    [days],
  );
  return row!.d;
}

async function typeNamed(tenant: ScratchTenant, prefix: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `SELECT id FROM qualification_type WHERE name LIKE $1 || '%' AND archived_at IS NULL`,
    [prefix],
  );
  return row!.id;
}

async function file(
  tenant: ScratchTenant,
  membershipId: string,
  typeId: string,
  expiresOn: string | null,
): Promise<string> {
  return actingAs(tenant, { roles: ['owner'] }, async () => {
    const { id } = await new QualificationsController().add(membershipId, {
      typeId,
      issuingBody: 'IPDJ',
      expiresOn,
    });
    return id;
  });
}

async function standing(tenant: ScratchTenant, membershipId: string, typeId: string) {
  return actingAs(tenant, { roles: ['owner'] }, async () => {
    const record = await new QualificationsController().person(membershipId);
    return record.standings.find((s) => s.typeId === typeId);
  });
}

test('27 — a business club starts with the Portuguese types', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { types, amberDays } = await new QualificationsController().types();
      const names = types.map((t) => t.name);
      assert.ok(names.some((n) => n.startsWith('TPTD')));
      assert.ok(names.includes('Nadador-salvador (ISN)'));
      assert.ok(names.some((n) => n.startsWith('SBV')));
      assert.equal(amberDays, 90);
      const tptd = types.find((t) => t.name.startsWith('TPTD'));
      assert.equal(tptd?.defaultValidityMonths, 60);
      assert.equal(tptd?.requiredToTeach, true);
      assert.equal(tptd?.blocksAssignment, false, 'a warning by default');
    });
  });
});

test('27.1–27.4 — the boundaries, to the day', async () => {
  await withScratchTenant(async (tenant) => {
    const sbv = await typeNamed(tenant, 'SBV');
    const cases: [number | null, string][] = [
      [200, 'green'],
      [91, 'green'],
      [90, 'amber'],
      [0, 'amber'],
      [-1, 'red'],
      [null, 'green'],
    ];
    for (const [days, expected] of cases) {
      const person = await addMember(tenant, 'Pessoa', `D${days}`, ['instructor']);
      await file(tenant, person, sbv, days === null ? null : await inDays(tenant, days));
      const s = await standing(tenant, person, sbv);
      assert.equal(s?.status, expected, `${days} days`);
    }
  });
});

test('27.9 — a renewal supersedes the old record and deletes nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const sbv = await typeNamed(tenant, 'SBV');
    const person = await addMember(tenant, 'Rita', 'Renova', ['instructor']);
    await file(tenant, person, sbv, await inDays(tenant, -10));
    await file(tenant, person, sbv, await inDays(tenant, 700));

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const record = await new QualificationsController().person(person);
      assert.equal(record.standings.find((s) => s.typeId === sbv)?.status, 'green');
      assert.equal(record.history.filter((h) => h.typeId === sbv).length, 2);
    });
  });
});

test('27 — an instructor missing a required type is "em falta"; an admin is not', async () => {
  await withScratchTenant(async (tenant) => {
    const tptd = await typeNamed(tenant, 'TPTD');
    const teacher = await addMember(tenant, 'Sem', 'Título', ['instructor']);
    const office = await addMember(tenant, 'Só', 'Escritório', ['admin']);
    assert.equal((await standing(tenant, teacher, tptd))?.status, 'missing');
    assert.equal(await standing(tenant, office, tptd), undefined);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const list = await new QualificationsController().expiring();
      assert.ok(list.items.some((r) => r.membershipId === teacher && r.status === 'missing'));
    });
  });
});

test('27.3 — the list is worst first: expired, then âmbar, then em falta', async () => {
  await withScratchTenant(async (tenant) => {
    const sbv = await typeNamed(tenant, 'SBV');
    const soon = await addMember(tenant, 'Breve', 'Âmbar', ['admin']);
    const gone = await addMember(tenant, 'Já', 'Expirou', ['admin']);
    await file(tenant, soon, sbv, await inDays(tenant, 30));
    await file(tenant, gone, sbv, await inDays(tenant, -1));
    await addMember(tenant, 'Sem', 'TPTD', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const list = await new QualificationsController().expiring();
      assert.deepEqual(
        list.items.map((r) => r.status),
        ['red', 'amber', 'missing'],
      );
    });
  });
});

/**
 * A certificate on file, without the object store: the stored row is what the
 * attach route checks (its purpose), and the list reads only the row.
 */
async function certificateFor(tenant: ScratchTenant, qualificationId: string, name: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
     VALUES ($1::uuid, 'qualification_document', $1::text || '/e2e/' || gen_random_uuid(), 'application/pdf', 10, $2, $3)
     RETURNING id`,
    [tenant.organizationId, name, tenant.ownerMembershipId],
  );
  await actingAs(tenant, { roles: ['owner'] }, () =>
    new AttachmentsController().qualificationDocument(qualificationId, { fileId: row!.id }),
  );
  return row!.id;
}

test('97b — every row says whether a certificate is on file, and em falta never has one', async () => {
  await withScratchTenant(async (tenant) => {
    const sbv = await typeNamed(tenant, 'SBV');
    const filed = await addMember(tenant, 'Com', 'Cartão', ['admin']);
    const bare = await addMember(tenant, 'Sem', 'Cartão', ['admin']);
    const withCard = await file(tenant, filed, sbv, await inDays(tenant, -3));
    await file(tenant, bare, sbv, await inDays(tenant, -2));
    await addMember(tenant, 'Falta', 'TPTD', ['instructor']);
    const card = await certificateFor(tenant, withCard, 'cartao-sbv.pdf');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const list = await new QualificationsController().expiring();
      const byPerson = new Map(list.items.map((row) => [row.membershipId, row]));
      assert.equal(byPerson.get(filed)?.documentFileId, card);
      assert.equal(byPerson.get(filed)?.documentName, 'cartao-sbv.pdf', 'the download keeps its own name');
      assert.equal(byPerson.get(bare)?.documentFileId, null);
      const missing = list.items.find((row) => row.status === 'missing');
      assert.equal(missing?.documentFileId, null, 'em falta has no record to carry one');
    });
  });
});

test('97b — Sem certificado narrows the list inside the page, so paging still adds up', async () => {
  await withScratchTenant(async (tenant) => {
    const sbv = await typeNamed(tenant, 'SBV');
    const filed = await addMember(tenant, 'Com', 'Cartão', ['admin']);
    const first = await addMember(tenant, 'Primeiro', 'Sem', ['admin']);
    const second = await addMember(tenant, 'Segundo', 'Sem', ['admin']);
    await certificateFor(tenant, await file(tenant, filed, sbv, await inDays(tenant, -5)), 'a.pdf');
    await file(tenant, first, sbv, await inDays(tenant, -4));
    await file(tenant, second, sbv, await inDays(tenant, -3));
    await addMember(tenant, 'Falta', 'TPTD', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new QualificationsController();
      const all = await controller.expiring(undefined, undefined, 'missing');
      assert.deepEqual(
        all.items.map((row) => row.membershipId),
        [first, second],
        'only records with no file — not the filed one, not em falta',
      );
      assert.equal(all.total, 2);

      // One a page: page 2 is the second of *that* list, and the total agrees.
      const one = await controller.expiring('1', '1', 'missing');
      const two = await controller.expiring('2', '1', 'missing');
      assert.deepEqual([one.items[0]?.membershipId, two.items[0]?.membershipId], [first, second]);
      assert.deepEqual([one.total, two.total], [2, 2]);

      // An unknown filter value is the whole list, never an empty one.
      assert.equal(
        (await controller.expiring(undefined, undefined, 'nonsense')).total,
        (await controller.expiring()).total,
      );
    });
  });
});

test('97 QA 4 — an instructor reads no list and attaches no certificate', async () => {
  await withScratchTenant(async (tenant) => {
    const sbv = await typeNamed(tenant, 'SBV');
    const coach = await addMember(tenant, 'Treinador', 'Piscina', ['instructor']);
    const record = await file(tenant, coach, sbv, await inDays(tenant, 400));
    const [stored] = await tenant.sql<{ id: string }>(
      `INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
       VALUES ($1::uuid, 'qualification_document', $1::text || '/e2e/' || gen_random_uuid(), 'application/pdf', 10, 'x.pdf', $2)
       RETURNING id`,
      [tenant.organizationId, tenant.ownerMembershipId],
    );

    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      await expectStatus(() => new QualificationsController().expiring(), 403);
      await expectStatus(
        () => new AttachmentsController().qualificationDocument(record, { fileId: stored!.id }),
        403,
      );
    });

    const [after] = await tenant.sql<{ document_file_id: string | null }>(
      `SELECT document_file_id FROM qualification WHERE id = $1`,
      [record],
    );
    assert.equal(after!.document_file_id, null, 'the refusal wrote nothing');
  });
});

test('27.7 — a person reads their own; an instructor may not read a colleague', async () => {
  await withScratchTenant(async (tenant) => {
    const me = await addMember(tenant, 'Eu', 'Mesmo', ['instructor']);
    const colleague = await addMember(tenant, 'Outro', 'Colega', ['instructor']);
    await actingAs(tenant, { membershipId: me, roles: ['instructor'] }, async () => {
      const controller = new QualificationsController();
      const mine = await controller.person(me);
      assert.equal(mine.canManage, false);
      await expectStatus(() => controller.person(colleague), 403);
      await expectStatus(() => controller.add(me, { typeId: '00000000-0000-0000-0000-000000000000' }), 403);
      await expectStatus(() => controller.types(), 403);
      await expectStatus(() => controller.expiring(), 403);
    });
  });
});

test('27 — a record is archived, never edited', async () => {
  await withScratchTenant(async (tenant) => {
    const sbv = await typeNamed(tenant, 'SBV');
    const person = await addMember(tenant, 'Ana', 'Arquivo', ['instructor']);
    const id = await file(tenant, person, sbv, await inDays(tenant, 10));

    await assert.rejects(
      () => tenant.sql(`UPDATE qualification SET expires_on = '2099-01-01' WHERE id = $1`, [id]),
      /permission denied/,
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new QualificationsController().archive(id);
      const record = await new QualificationsController().person(person);
      assert.equal(record.standings.find((s) => s.typeId === sbv), undefined);
      assert.equal(record.history[0]?.archived, true);
    });
  });
});

test('27.10–27.11 — alerts once per crossing, and a wider window reaches the newly inside', async () => {
  await withScratchTenant(async (tenant) => {
    const sbv = await typeNamed(tenant, 'SBV');
    const person = await addMember(tenant, 'Marta', 'Alerta', ['instructor']);
    await file(tenant, person, sbv, await inDays(tenant, 100));

    // Verde at 90 days: nothing.
    assert.equal((await raiseQualificationAlerts(tenant.organizationId))?.raised.length, 0);

    await actingAs(tenant, { roles: ['owner'] }, () =>
      new QualificationsController().window({ amberDays: 120 }),
    );
    const first = await raiseQualificationAlerts(tenant.organizationId);
    assert.equal(first?.raised.length, 1);
    assert.equal(first?.raised[0]?.threshold, 'amber');
    assert.ok(first?.raised[0]?.recipients.length, 'the person and the owner');

    const again = await raiseQualificationAlerts(tenant.organizationId);
    assert.equal(again?.raised.length, 0, 'never twice for one crossing');

    // Delivery stamps the alert once something went.
    const sent: string[] = [];
    const delivered = await deliverQualificationAlerts(tenant.organizationId, first!, async (email) => {
      sent.push(email.to);
      return true;
    });
    assert.equal(delivered, 1);
    assert.equal(new Set(sent).size, sent.length);
    const [row] = await tenant.sql<{ delivered_at: Date | null }>(
      'SELECT delivered_at FROM qualification_alert',
    );
    assert.ok(row?.delivered_at);
  });
});

test('27.5 — a blocking type refuses a new turma assignment, and only a new one', async () => {
  await withScratchTenant(async (tenant) => {
    const tptd = await typeNamed(tenant, 'TPTD');
    const lapsed = await addMember(tenant, 'Caducado', 'Prof', ['instructor']);
    await file(tenant, lapsed, tptd, await inDays(tenant, -3));

    // A warning by default: the assignment goes through.
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, instructor_membership_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4) RETURNING id`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, lapsed],
    );

    await tenant.sql('UPDATE qualification_type SET blocks_assignment = true WHERE id = $1', [tptd]);

    // Existing assignment untouched; saving the turma for another reason works.
    await tenant.sql(`UPDATE class_group SET name = 'Golfinhos A' WHERE id = $1`, [group!.id]);

    // A new one is refused, with the type and the date as structure.
    try {
      await tenant.sql(
        `INSERT INTO class_group (organization_id, season_id, facility_id, name, instructor_membership_id)
         VALUES ($1, $2, $3, 'Tubarões', $4)`,
        [tenant.organizationId, tenant.seasonId, tenant.facilityId, lapsed],
      );
      assert.fail('expected the block');
    } catch (error) {
      const refusal = qualificationRefusal(error);
      assert.ok(refusal, 'the refusal carries its DETAIL');
      const body = refusal.getResponse() as { qualificationBlocked: { type: string } };
      assert.ok(body.qualificationBlocked.type.startsWith('TPTD'));
    }

    // Missing never blocks, even with the switch on.
    const without = await addMember(tenant, 'Sem', 'Registo', ['instructor']);
    await tenant.sql(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, instructor_membership_id)
       VALUES ($1, $2, $3, 'Cadetes', $4)`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, without],
    );
  });
});

test('27 — a type that blocks must be required, and names are unique', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new QualificationsController();
      await expectStatus(
        () => controller.createType({ name: 'X', blocksAssignment: true, requiredToTeach: false }),
        400,
      );
      await expectStatus(() => controller.createType({ name: 'nadador-salvador (isn)' }), 409);
      await expectStatus(() => controller.window({ amberDays: 0 }), 400);
    });
  });
});

test("27 — another club's person and records are out of reach", async () => {
  await withScratchTenant(async (a) => {
    await withScratchTenant(async (b) => {
      const sbvB = await typeNamed(b, 'SBV');
      const personB = await addMember(b, 'Pessoa', 'B', ['instructor']);
      const recordB = await file(b, personB, sbvB, await inDays(b, 10));
      const sbvA = await typeNamed(a, 'SBV');

      await actingAs(a, { roles: ['owner'] }, async () => {
        const controller = new QualificationsController();
        await expectStatus(() => controller.person(personB), 404);
        await expectStatus(() => controller.add(personB, { typeId: sbvA }), 404);
        await expectStatus(() => controller.archive(recordB), 404);
        await expectStatus(() => controller.updateType(sbvB, { name: 'Roubado' }), 404);
        assert.equal((await controller.expiring()).items.some((r) => r.membershipId === personB), false);
      });
    });
  });
});

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { ClassesController } from './classes.controller.js';
import { ClosuresController, SessionsCalendarController } from './sessions.controller.js';
import { ReceptionController, PassProductsController } from '../reception/passes.controller.js';
import { FacilitiesController } from '../facilities/facilities.controller.js';
import { MessagesController } from '../messages/messages.controller.js';
import { clubToday } from '../common/club-day.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Closures by site or by tank — POOLSE-84, the API half.
 *
 * The database half (`packages/db/test/closures-by-site.sql`) proves what a
 * closure reaches. These prove what an operator can ask for, what they are
 * refused and in which words, and that the screens that show a tank — reception,
 * Instalações — and the warning to families read the same answer.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

function inDays(days: number): string {
  const day = new Date(`${clubToday()}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

async function refusal(
  fn: () => Promise<unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
  }
  assert.fail('expected a refusal');
}

/** A second site, and two tanks at the first. */
async function twoSites(tenant: ScratchTenant): Promise<{
  other: string;
  tank1: string;
  tank2: string;
  otherTank: string;
}> {
  await tenant.sql(`UPDATE organization SET max_facilities = 5 WHERE id = $1`, [
    tenant.organizationId,
  ]);
  const [other] = await tenant.sql<{ id: string }>(
    `INSERT INTO facility (organization_id, name, timezone)
     VALUES ($1, 'Polo Norte', 'Europe/Lisbon') RETURNING id`,
    [tenant.organizationId],
  );
  const tank = async (facilityId: string, name: string): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [tenant.organizationId, facilityId, name],
    );
    return row!.id;
  };
  return {
    other: other!.id,
    tank1: await tank(tenant.facilityId, 'Tanque 1'),
    tank2: await tank(tenant.facilityId, 'Tanque 2'),
    otherTank: await tank(other!.id, 'Norte'),
  };
}

let turmas = 0;

/** A turma's lesson on a tank at 10:00 on a day, on the site's clock. */
async function lesson(tenant: ScratchTenant, poolId: string, day: string, at = '10:00'): Promise<string> {
  const { id: groupId } = await actingAs(tenant, { roles: ['owner'] }, () =>
    new ClassesController().create({ name: `Turma ${(turmas += 1)}`, poolId, lane: 1 }),
  );
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session (organization_id, class_group_id, pool_id, starts_at,
                                duration_minutes, occurs_on)
     VALUES ($1, $2, $3, ($4::date + $5::time) AT TIME ZONE 'Europe/Lisbon', 45, $4::date)
     RETURNING id`,
    [tenant.organizationId, groupId, poolId, day, at],
  );
  return row!.id;
}

async function statusOf(tenant: ScratchTenant, sessionId: string): Promise<string> {
  const [row] = await tenant.sql<{ status: string }>(
    `SELECT status FROM class_session WHERE id = $1`,
    [sessionId],
  );
  return row!.status;
}

test('QA 12 — only owner and admin close; a closure names its site, and a tank of that site', async () => {
  await withScratchTenant(async (tenant) => {
    const { otherTank } = await twoSites(tenant);
    const closures = new ClosuresController();
    const body = { startsOn: inDays(10), endsOn: inDays(10), reason: 'Obras', facilityId: tenant.facilityId };

    for (const role of ['instructor', 'guardian', 'student', 'maintenance'] as const) {
      await actingAs(tenant, { roles: [role] }, async () => {
        await expectStatus(() => closures.create(body), 403);
        await expectStatus(() => closures.impact(inDays(10), inDays(10), tenant.facilityId), 403);
        await expectStatus(() => closures.update('00000000-0000-0000-0000-000000000000', body), 403);
      });
    }

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const noSite = await refusal(() =>
        closures.create({ startsOn: inDays(10), endsOn: inDays(10), reason: 'Em todo o lado' }),
      );
      assert.equal(noSite.status, 422);
      assert.equal(noSite.body['code'], 'closure_site_required');

      const elsewhere = await refusal(() => closures.create({ ...body, poolIds: [otherTank] }));
      assert.equal(elsewhere.status, 422);
      assert.equal(elsewhere.body['code'], 'closure_pool_elsewhere');
    });

    const [count] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM closure WHERE organization_id = $1 AND source = 'manual'`,
      [tenant.organizationId],
    );
    assert.equal(count!.n, 0, 'nothing refused was written');
  });
});

test('QA 1–3 — a site closure stays at its site; two tanks are two closures that reopen apart', async () => {
  await withScratchTenant(async (tenant) => {
    const { other, tank1, tank2, otherTank } = await twoSites(tenant);
    const day = inDays(14);
    const there = await lesson(tenant, otherTank, day);
    const one = await lesson(tenant, tank1, day);
    const two = await lesson(tenant, tank2, day);
    const closures = new ClosuresController();

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      // QA 1 — Polo Norte shut; the Sede teaches.
      await closures.create({ startsOn: day, endsOn: day, reason: 'Obras no Norte', facilityId: other });
      assert.equal(await statusOf(tenant, there), 'cancelled');
      assert.equal(await statusOf(tenant, one), 'scheduled', 'the bug: one site shut both');

      // QA 2 — two tanks ticked.
      const made = await closures.create({
        startsOn: day,
        endsOn: day,
        reason: 'Esvaziamento',
        facilityId: tenant.facilityId,
        poolIds: [tank1, tank2],
      });
      assert.equal(made.ids.length, 2, 'one closure per tank');
      assert.equal(await statusOf(tenant, one), 'cancelled');
      assert.equal(await statusOf(tenant, two), 'cancelled');

      const [batch] = await tenant.sql<{ n: number }>(
        `SELECT count(DISTINCT batch_id)::int AS n FROM closure WHERE id = ANY ($1::uuid[])`,
        [made.ids],
      );
      assert.equal(batch!.n, 1, 'made together, warned together');

      // QA 3 — Tanque 1 reopens now, not at the next generation.
      const [tank1Closure] = await tenant.sql<{ id: string }>(
        `SELECT id FROM closure WHERE id = ANY ($1::uuid[]) AND pool_id = $2`,
        [made.ids, tank1],
      );
      await closures.remove(tank1Closure!.id);
      assert.equal(await statusOf(tenant, one), 'scheduled', 'removing a closure gives its lessons back');
      assert.equal(await statusOf(tenant, two), 'cancelled', 'and only its own');
    });
  });
});

test('QA 4–7 — shortening restores; halves coexist; a whole day over them is a 409 naming it', async () => {
  await withScratchTenant(async (tenant) => {
    const { tank1 } = await twoSites(tenant);
    const closures = new ClosuresController();
    const late = await lesson(tenant, tank1, inDays(21));
    const morning = await lesson(tenant, tank1, inDays(30), '10:00');
    const afternoon = await lesson(tenant, tank1, inDays(30), '15:00');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // QA 4 — a fortnight, then two days shorter, through the edit endpoint.
      const { id } = await closures.create({
        startsOn: inDays(10),
        endsOn: inDays(21),
        reason: 'Reparação',
        facilityId: tenant.facilityId,
        poolIds: [tank1],
      });
      assert.equal(await statusOf(tenant, late), 'cancelled');
      await closures.update(id, {
        startsOn: inDays(10),
        endsOn: inDays(19),
        reason: 'Reparação',
        facilityId: tenant.facilityId,
        poolIds: [tank1],
      });
      assert.equal(await statusOf(tenant, late), 'scheduled', 'the days given back come back now');

      // QA 5 and 6 — a morning, then an afternoon, the same tank and day.
      const half = { startsOn: inDays(30), endsOn: inDays(30), facilityId: tenant.facilityId, poolIds: [tank1] };
      await closures.create({ ...half, reason: 'Análise', partOfDay: 'morning' });
      assert.equal(await statusOf(tenant, morning), 'cancelled');
      assert.equal(await statusOf(tenant, afternoon), 'scheduled', '15:00 is not a morning');
      await closures.create({ ...half, reason: 'Limpeza', partOfDay: 'afternoon' });
      assert.equal(await statusOf(tenant, afternoon), 'cancelled');

      const overlap = await refusal(() => closures.create({ ...half, reason: 'O dia todo' }));
      assert.equal(overlap.status, 409);
      assert.equal(overlap.body['code'], 'closure_overlap');
      assert.equal(overlap.body['existing'], 'Análise');
      assert.equal(overlap.body['pool'], 'Tanque 1');

      // QA 7 — a half day is one day.
      const across = await refusal(() =>
        closures.create({ ...half, endsOn: inDays(31), reason: 'Duas manhãs', partOfDay: 'morning' }),
      );
      assert.equal(across.status, 422);
      assert.equal(across.body['code'], 'closure_half_day_one_day');

      // The count before saving reads the same rule: the afternoon is already
      // gone, so a whole Tanque 1 on that day would take nothing more.
      const impact = await closures.impact(inDays(30), inDays(30), tenant.facilityId, tank1, 'afternoon');
      assert.equal(impact.sessions, 0);
    });
  });
});

test('QA 9–10 — a closed tank refuses a check-in in words, and says so on its card', async () => {
  await withScratchTenant(async (tenant) => {
    const { tank1, tank2 } = await twoSites(tenant);
    const today = clubToday();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id: product } = await new PassProductsController().create(tenant.facilityId, {
        kind: 'pack',
        name: 'Pack 10',
        entries: 10,
        amountCents: 3500,
        vatRate: 23,
      });
      const swimmer = await addMember(tenant, 'Joana', 'Livre', []);
      const reception = new ReceptionController();
      const sale = await reception.sell(tenant.facilityId, { productId: product, membershipId: swimmer });

      await new ClosuresController().create({
        startsOn: today,
        endsOn: inDays(3),
        reason: 'Avaria na bomba',
        facilityId: tenant.facilityId,
        poolIds: [tank1],
      });

      const refused = await refusal(() =>
        reception.checkIn(tenant.facilityId, { passId: sale.passId, poolId: tank1 }),
      );
      assert.equal(refused.status, 409);
      assert.equal(refused.body['code'], 'pool_closed');
      assert.deepEqual(refused.body['values'], { until: inDays(3), partOfDay: null });

      // The other tank of the same site takes the swimmer.
      await reception.checkIn(tenant.facilityId, { passId: sale.passId, poolId: tank2 });

      const read = await reception.read(tenant.facilityId);
      const closed = read.pools.find((pool) => pool.poolId === tank1);
      const open = read.pools.find((pool) => pool.poolId === tank2);
      assert.equal(closed?.closure?.until, inDays(3));
      assert.equal(closed?.closure?.reason, 'Avaria na bomba');
      assert.equal(open?.closure, null);

      const sites = await new FacilitiesController().list();
      const card = sites.facilities
        .flatMap((site) => site.pools)
        .find((pool) => pool.id === tank1);
      assert.equal(card?.closure?.until, inDays(3), 'Instalações says until when');
    });
  });
});

test('QA 8 — the warning reaches families, the partner by its contact, and a trial lead', async () => {
  await withScratchTenant(async (tenant) => {
    const { tank2 } = await twoSites(tenant);
    const day = inDays(9);
    const [season] = await tenant.sql<{ id: string }>(
      `SELECT id FROM season WHERE organization_id = $1 ORDER BY starts_on DESC LIMIT 1`,
      [tenant.organizationId],
    );
    await tenant.sql(
      `UPDATE facility_hours SET available = true, opens_at = '07:00', closes_at = '22:00'
        WHERE organization_id = $1`,
      [tenant.organizationId],
    );

    // A parceria on Tanque 2 with an address, and one whose contact has only a phone.
    const parceria = async (name: string, email: string | null, at: string): Promise<string> => {
      const [partner] = await tenant.sql<{ id: string }>(
        `INSERT INTO partner (organization_id, facility_id, name, type)
         VALUES ($1, $2, $3, 'escola') RETURNING id`,
        [tenant.organizationId, tenant.facilityId, name],
      );
      await tenant.sql(
        `INSERT INTO partner_contact (organization_id, partner_id, name, email, phone)
         VALUES ($1, $2, 'Contacto', $3, '912345678')`,
        [tenant.organizationId, partner!.id, email],
      );
      const [group] = await tenant.sql<{ id: string }>(
        `INSERT INTO partner_group (organization_id, partner_id, name, participant_count)
         VALUES ($1, $2, 'Turma A', 20) RETURNING id`,
        [tenant.organizationId, partner!.id],
      );
      const [schedule] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_schedule (organization_id, facility_id, weekday, start_time,
                                     duration_minutes, subject_type, partner_group_id, season_id)
         VALUES ($1, $2, extract(ISODOW FROM $3::date), $4::time, 45, 'parceria', $5, $6)
         RETURNING id`,
        [tenant.organizationId, tenant.facilityId, day, at, group!.id, season!.id],
      );
      const [session] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session (organization_id, schedule_id, starts_at, duration_minutes, occurs_on)
         VALUES ($1, $2, ($3::date + $4::time) AT TIME ZONE 'Europe/Lisbon', 45, $3::date)
         RETURNING id`,
        [tenant.organizationId, schedule!.id, day, at],
      );
      await tenant.sql(
        `INSERT INTO class_session_lane (organization_id, session_id, lane_id, starts_at, ends_at)
         SELECT $1, s.id, l.id, s.starts_at, s.ends_at
           FROM class_session s, lane l WHERE s.id = $2 AND l.pool_id = $3`,
        [tenant.organizationId, session!.id, tank2],
      );
      return session!.id;
    };
    const school = await parceria('Escola do Bairro', 'escola@example.test', '11:00');
    await parceria('Lar Sem Email', null, '12:00');

    // An aula experimental booked into a turma lesson on the same tank.
    const trial = await lesson(tenant, tank2, day, '17:00');
    const [lead] = await tenant.sql<{ id: string }>(
      `INSERT INTO lead (organization_id, facility_id, swimmer_first_name, swimmer_last_name,
                         swimmer_birth_date, guardian_name, email, consent_text_version,
                         consented_at, status, trial_session_id, decided_at)
       VALUES ($1, $2, 'Rita', 'Experimental', '2018-05-01', 'Mãe da Rita',
               'mae.rita@example.test', 'v1', now(), 'trial_booked', $3, now())
       RETURNING id`,
      [tenant.organizationId, tenant.facilityId, trial],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await new ClosuresController().create({
        startsOn: day,
        endsOn: day,
        reason: 'Avaria',
        facilityId: tenant.facilityId,
        poolIds: [tank2],
      });
      assert.equal(await statusOf(tenant, school), 'cancelled', 'a parceria on the tank stops');

      const messages = new MessagesController();
      const preview = await messages.send({ audience: 'closure', targetId: id });
      assert.equal(preview.partnerCount, 2);
      assert.equal(preview.leadCount, 1);
      assert.deepEqual(
        preview.unreachable.map((one) => [one.kind, one.name]),
        [['partner', 'Lar Sem Email']],
        'a partner with no address is counted, never skipped',
      );

      await messages.send({
        audience: 'closure',
        targetId: id,
        subject: 'Piscina fechada',
        body: 'O Tanque 2 está fechado.',
        commit: true,
      });
    });

    const recorded = await tenant.sql<{ partner_id: string | null; lead_id: string | null; email: string | null }>(
      `SELECT partner_id, lead_id, email::text AS email FROM message_recipient
        WHERE organization_id = $1 ORDER BY email NULLS LAST`,
      [tenant.organizationId],
    );
    assert.deepEqual(
      recorded.map((row) => [row.partner_id !== null, row.lead_id !== null, row.email]),
      [
        [true, false, 'escola@example.test'],
        [false, true, 'mae.rita@example.test'],
        [true, false, null],
      ],
    );

    // A lead anonymised by retention takes its copy on the warning with it —
    // through `apply_retention`, the only thing that anonymises one.
    await tenant.sql(
      `UPDATE lead SET archived_at = now() - interval '6 years' WHERE id = $1`,
      [lead!.id],
    );
    await tenant.sql(`SELECT * FROM apply_retention()`);
    const [scrubbed] = await tenant.sql<{ name: string; email: string }>(
      `SELECT name, email::text AS email FROM message_recipient WHERE lead_id = $1`,
      [lead!.id],
    );
    assert.equal(scrubbed?.name, 'Pessoa anonimizada');
    assert.equal(scrubbed?.email, 'anonimizado@anonimizado.invalid');
  });
});

test('19-10 sweep — a one-week move into a closed tank is refused by the server, naming it', async () => {
  await withScratchTenant(async (tenant) => {
    const { tank1, tank2 } = await twoSites(tenant);
    const day = inDays(12);
    const lessonId = await lesson(tenant, tank2, day, '10:00');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new ClosuresController().create({
        startsOn: day,
        endsOn: day,
        reason: 'Esvaziamento',
        facilityId: tenant.facilityId,
        poolIds: [tank1],
        partOfDay: 'morning',
      });

      // Into Tanque 1's lane that morning: refused, and the week left as it was.
      const [lane] = await tenant.sql<{ id: string }>(`SELECT id FROM lane WHERE pool_id = $1`, [tank1]);
      const refused = await refusal(() =>
        new SessionsCalendarController().move(lessonId, {
          date: day,
          startTime: '11:00',
          laneIds: [lane!.id],
        }),
      );
      assert.equal(refused.status, 409);
      assert.equal(refused.body['message'], 'occurrenceClosed');
      assert.equal(refused.body['reason'], 'Esvaziamento');
      const [after] = await tenant.sql<{ status: string; at: string }>(
        `SELECT status, to_char(starts_at AT TIME ZONE 'Europe/Lisbon', 'HH24:MI') AS at
           FROM class_session WHERE id = $1`,
        [lessonId],
      );
      assert.deepEqual(after, { status: 'scheduled', at: '10:00' }, 'a refused move moves nothing');

      // The same lane in the afternoon is open.
      await new SessionsCalendarController().move(lessonId, {
        date: day,
        startTime: '15:00',
        laneIds: [lane!.id],
      });
    });
  });
});

test('19-10 sweep — editing a closure keeps what the edit did not send', async () => {
  await withScratchTenant(async (tenant) => {
    const closures = new ClosuresController();
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await closures.create({
        startsOn: inDays(40),
        endsOn: inDays(41),
        reason: 'Nota',
        facilityId: tenant.facilityId,
        blocksGeneration: false,
        repeatsAnnually: true,
      });
      await closures.update(id, {
        startsOn: inDays(40),
        endsOn: inDays(41),
        reason: 'Nota corrigida',
        facilityId: tenant.facilityId,
      });
      const [row] = await tenant.sql<{ blocks: boolean; repeats: boolean; reason: string }>(
        `SELECT blocks_generation AS blocks, repeats_annually AS repeats, reason
           FROM closure WHERE id = $1`,
        [id],
      );
      assert.deepEqual(row, { blocks: false, repeats: true, reason: 'Nota corrigida' });
    });
  });
});

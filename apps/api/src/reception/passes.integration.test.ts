import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { PassProductsController, ReceptionController } from './passes.controller.js';
import { InvoicesController } from '../billing/invoices.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Free swim — POOLSE-68, the QA scenarios in the ticket's order.
 *
 * The ones worth most:
 *
 * **Occupancy composes.** Free swimmers and the people in a class running now
 * share one tank, counted by enrolments and not by a turma's ceiling, and the
 * refusal carries the three numbers out of the database (QA 3).
 *
 * **The last place goes to exactly one of two racing check-ins** (QA 8) — the
 * tank lock in `pass_check_in_allowed`, exactly as enrolments lock the pool.
 *
 * **A sale is a document**, so a credit note is what voids a pass (QA 5), and
 * an anonymous entry is a document with no payer.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** `days` from today, as an ISO date. Noon, so no zone can shift the day. */
function inDays(days: number): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

async function pool(tenant: ScratchTenant, capacity: number | null): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, max_capacity)
     VALUES ($1, $2, 'Tanque livre', $3) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, capacity],
  );
  return row!.id;
}

async function product(
  tenant: ScratchTenant,
  body: Record<string, unknown>,
): Promise<string> {
  const { id } = await new PassProductsController().create(tenant.facilityId, {
    amountCents: 400,
    vatRate: 23,
    ...body,
  });
  return id;
}

/** The structured body of a refusal: its code and its figures. */
async function refusal(
  fn: () => Promise<unknown>,
): Promise<{ status: number; code: string | undefined; values: Record<string, unknown> }> {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse() as { code?: string; values?: Record<string, unknown> };
    return { status: error.getStatus(), code: body.code, values: body.values ?? {} };
  }
  assert.fail('expected a refusal');
}

test('a pack of 10 counts down in SQL, and the 11th entry is refused with words', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const tank = await pool(tenant, null);
      const swimmer = await addMember(tenant, 'Joana', 'Livre', []);
      const pack = await product(tenant, { kind: 'pack', name: 'Pack 10', entries: 10, amountCents: 3500 });
      const reception = new ReceptionController();

      const sale = await reception.sell(tenant.facilityId, { productId: pack, membershipId: swimmer });

      for (let entry = 1; entry <= 10; entry += 1) {
        const { id } = await reception.checkIn(tenant.facilityId, { passId: sale.passId, poolId: tank });
        if (entry === 3) {
          const { passes } = await reception.passes(tenant.facilityId, swimmer);
          assert.equal(passes[0]?.entriesUsed, 3);
          assert.equal(passes[0]?.entriesLeft, 7, 'three of ten used leaves seven');
        }
        // Out again, so the next entry is not "already in the water".
        await reception.checkOut(tenant.facilityId, id);
      }

      const refused = await refusal(() =>
        reception.checkIn(tenant.facilityId, { passId: sale.passId, poolId: tank }),
      );
      assert.equal(refused.status, 409);
      assert.equal(refused.code, 'pass_used_up');
      assert.equal(refused.values['entries'], 10);
    });
  });
});

test('a monthly pass checked in the day after it ends is refused as expired', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const tank = await pool(tenant, null);
      const swimmer = await addMember(tenant, 'Rui', 'Mensal', []);
      const monthly = await product(tenant, { kind: 'period', name: 'Mensal', validityDays: 30 });
      const reception = new ReceptionController();

      // Thirty days from 31 days ago: the last good day was yesterday.
      const sale = await reception.sell(tenant.facilityId, {
        productId: monthly,
        membershipId: swimmer,
        validFrom: inDays(-30),
      });

      const refused = await refusal(() =>
        reception.checkIn(tenant.facilityId, { passId: sale.passId, poolId: tank }),
      );
      assert.equal(refused.code, 'pass_expired');
      assert.equal(refused.values['date'], inDays(-1));

      const { passes } = await reception.passes(tenant.facilityId, swimmer);
      assert.equal(passes[0]?.expired, true);
      assert.equal(passes[0]?.entriesLeft, null, 'a period pass has no count');
    });
  });
});

test('free swimmers and a class running now share the tank, and the refusal says so in numbers', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const tank = await pool(tenant, 5);

      // A turma of capacity 12 with two children enrolled, in the water now:
      // it fills the tank with two, never with twelve.
      const [group] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id, capacity)
         VALUES ($1, $2, $3, 'Golfinhos', $4, 12) RETURNING id`,
        [tenant.organizationId, tenant.seasonId, tenant.facilityId, tank],
      );
      for (const name of ['Rita', 'Tiago']) {
        const [student] = await tenant.sql<{ id: string }>(
          `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, 'Agora')
           RETURNING id`,
          [tenant.organizationId, name],
        );
        await tenant.sql(
          `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
           VALUES ($1, $2, $3, 'active')`,
          [tenant.organizationId, group!.id, student!.id],
        );
      }
      await tenant.sql(
        `INSERT INTO class_session
           (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on)
         VALUES ($1, $2, $3, now() - interval '10 minutes', 45,
                 (now() AT TIME ZONE 'Europe/Lisbon')::date)`,
        [tenant.organizationId, group!.id, tank],
      );

      const single = await product(tenant, { kind: 'single', name: 'Entrada' });
      const reception = new ReceptionController();

      // Anonymous single entries, sold and checked in in one act.
      for (let i = 0; i < 3; i += 1) {
        await reception.sell(tenant.facilityId, { productId: single, checkInPoolId: tank });
      }

      const now = await reception.read(tenant.facilityId);
      const row = now.pools.find((p) => p.poolId === tank);
      assert.equal(row?.swimmers, 3);
      assert.equal(row?.inClasses, 2);
      assert.equal(now.inWater.length, 3);
      assert.equal(now.inWater[0]?.personName, null, 'an anonymous entry has no name');

      const refused = await refusal(() =>
        reception.sell(tenant.facilityId, { productId: single, checkInPoolId: tank }),
      );
      assert.equal(refused.status, 409);
      assert.equal(refused.code, 'pool_full_now');
      assert.deepEqual(refused.values, { capacity: 5, occupied: 5, requested: 1 });

      // The refused sale sold nothing: no fourth document, no fourth pass.
      const [counted] = await tenant.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM pass`,
      );
      assert.equal(counted?.n, 3);
    });
  });
});

test('a tank with no ceiling never refuses an entry for capacity', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const tank = await pool(tenant, null);
      const single = await product(tenant, { kind: 'single', name: 'Entrada' });
      const reception = new ReceptionController();

      for (let i = 0; i < 6; i += 1) {
        await reception.sell(tenant.facilityId, { productId: single, checkInPoolId: tank });
      }
      const row = (await reception.read(tenant.facilityId)).pools.find((p) => p.poolId === tank);
      assert.equal(row?.capacity, null);
      assert.equal(row?.swimmers, 6);
    });
  });
});

test('crediting the sale voids the pass, and an anonymous sale is a document with no payer', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const tank = await pool(tenant, null);
      const swimmer = await addMember(tenant, 'Ana', 'Creditada', []);
      const pack = await product(tenant, { kind: 'pack', name: 'Pack 5', entries: 5, amountCents: 2000 });
      const reception = new ReceptionController();
      const invoices = new InvoicesController();

      const sale = await reception.sell(tenant.facilityId, { productId: pack, membershipId: swimmer });
      const document = await invoices.read(tenant.facilityId, sale.invoiceId);
      assert.equal(document.payerMembershipId, swimmer);
      assert.equal(document.lines?.[0]?.passId, sale.passId);
      assert.equal(document.lines?.[0]?.description, 'Pack 5');
      assert.equal(document.status, 'paid', 'the money is taken at the counter');

      await invoices.credit(tenant.facilityId, sale.invoiceId, { reason: 'Engano' });

      const { passes } = await reception.passes(tenant.facilityId, swimmer);
      assert.equal(passes[0]?.voided, true);

      const refused = await refusal(() =>
        reception.checkIn(tenant.facilityId, { passId: sale.passId, poolId: tank }),
      );
      assert.equal(refused.code, 'pass_void');

      const single = await product(tenant, { kind: 'single', name: 'Entrada' });
      const anonymous = await reception.sell(tenant.facilityId, { productId: single });
      const receipt = await invoices.read(tenant.facilityId, anonymous.invoiceId);
      assert.equal(receipt.payerName, null);
      assert.equal(receipt.payerMembershipId, null);

      // A pack is a person's: it is never sold to nobody.
      await expectStatus(() => reception.sell(tenant.facilityId, { productId: pack }), 400);
    });
  });
});

test('an instructor or a student may not sell, check in or read reception', async () => {
  await withScratchTenant(async (tenant) => {
    const tank = await pool(tenant, null);
    const single = await actingAs(tenant, { roles: ['owner'] }, () =>
      product(tenant, { kind: 'single', name: 'Entrada' }),
    );
    const sale = await actingAs(tenant, { roles: ['owner'] }, () =>
      new ReceptionController().sell(tenant.facilityId, { productId: single }),
    );

    for (const role of ['instructor', 'student'] as const) {
      const member = await addMember(tenant, 'Sem', `Acesso ${role}`, [role]);
      await actingAs(tenant, { membershipId: member, roles: [role] }, async () => {
        const reception = new ReceptionController();
        await expectStatus(() => reception.sell(tenant.facilityId, { productId: single }), 403);
        await expectStatus(
          () => reception.checkIn(tenant.facilityId, { passId: sale.passId, poolId: tank }),
          403,
        );
        await expectStatus(() => reception.read(tenant.facilityId), 403);
        await expectStatus(() => new PassProductsController().list(tenant.facilityId), 403);
      });
    }
  });
});

test("another club's pass cannot be checked in here", async () => {
  await withScratchTenant(async (clubA) => {
    await withScratchTenant(async (clubB) => {
      const passOfB = await actingAs(clubB, { roles: ['owner'] }, async () => {
        const single = await product(clubB, { kind: 'single', name: 'Entrada' });
        return (await new ReceptionController().sell(clubB.facilityId, { productId: single })).passId;
      });

      await actingAs(clubA, { roles: ['owner'] }, async () => {
        const tank = await pool(clubA, null);
        await expectStatus(
          () => new ReceptionController().checkIn(clubA.facilityId, { passId: passOfB, poolId: tank }),
          404,
        );
        await expectStatus(
          () => new ReceptionController().read(clubB.facilityId),
          404,
        );
      });
    });
  });
});

test('two check-ins racing for the last place: exactly one gets in', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const tank = await pool(tenant, 1);
      const single = await product(tenant, { kind: 'single', name: 'Entrada' });
      const reception = new ReceptionController();

      const first = await reception.sell(tenant.facilityId, { productId: single });
      const second = await reception.sell(tenant.facilityId, { productId: single });

      const results = await Promise.allSettled([
        reception.checkIn(tenant.facilityId, { passId: first.passId, poolId: tank }),
        reception.checkIn(tenant.facilityId, { passId: second.passId, poolId: tank }),
      ]);

      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      assert.ok(lost.reason instanceof HttpException);
      assert.equal((lost.reason.getResponse() as { code?: string }).code, 'pool_full_now');
    });
  });
});

test('a cancelled check-in gives the entry back and frees the place', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const tank = await pool(tenant, 1);
      const swimmer = await addMember(tenant, 'Eva', 'Engano', []);
      const pack = await product(tenant, { kind: 'pack', name: 'Pack 2', entries: 2 });
      const reception = new ReceptionController();

      const sale = await reception.sell(tenant.facilityId, {
        productId: pack,
        membershipId: swimmer,
        checkInPoolId: tank,
      });
      await reception.cancel(tenant.facilityId, sale.checkInId!);

      const { passes } = await reception.passes(tenant.facilityId, swimmer);
      assert.equal(passes[0]?.entriesLeft, 2);
      const row = (await reception.read(tenant.facilityId)).pools.find((p) => p.poolId === tank);
      assert.equal(row?.swimmers, 0);
    });
  });
});

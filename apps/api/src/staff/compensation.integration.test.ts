import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { CompensationController, SalariesController } from './compensation.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
} from '../test/harness.js';

/**
 * Staff salaries — POOLSE-58.
 *
 * Two things are worth more than the rest of this file put together, and they
 * are the two the ticket calls the core requirement:
 *
 * - **an Admin does not see the Owner's pay**, in the list, in the roll-up, in
 *   the history and on every write path; and
 * - **nobody else sees any of it**, whatever the menu offers.
 *
 * After that: the overlap constraint's date bound, which is invisible until two
 * rates overlap by exactly one day, and the null `weekly_hours` that must never
 * become a zero in a total.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const OTHER_ROLES = ['instructor', 'maintenance', 'student', 'guardian'] as const;

test('58 — every role but owner and admin is refused, on every endpoint', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Inês', 'Costa', ['instructor']);

    for (const role of OTHER_ROLES) {
      await actingAs(tenant, { membershipId: teacher, roles: [role] }, async () => {
        const salaries = new SalariesController();
        const comp = new CompensationController();

        await expectStatus(() => salaries.list(), 403);
        await expectStatus(() => salaries.summary(), 403);
        await expectStatus(() => comp.history(teacher), 403);
        await expectStatus(
          () =>
            comp.add(teacher, {
              kind: 'monthly',
              amountCents: 100_000,
              effectiveFrom: '2026-09-01',
            }),
          403,
        );
        await expectStatus(() => comp.update('00000000-0000-0000-0000-000000000000', {}), 403);
        await expectStatus(() => comp.archive('00000000-0000-0000-0000-000000000000'), 403);
      });
    }
  });
});

test('58 — an admin sees every staff member except the owner', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Sandra', 'Marques', ['admin']);
    const teacher = await addMember(tenant, 'Inês', 'Costa', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();
      await comp.add(tenant.ownerMembershipId, {
        kind: 'monthly',
        amountCents: 300_000,
        weeklyHours: 40,
        effectiveFrom: '2026-01-01',
      });
      await comp.add(teacher, {
        kind: 'hourly',
        amountCents: 715,
        weeklyHours: 20,
        effectiveFrom: '2026-01-01',
      });
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { salaries } = await new SalariesController().list();
      assert.equal(salaries.total, 3, 'the owner, the admin and the instructor');
      assert.ok(salaries.items.some((row) => row.membershipId === tenant.ownerMembershipId));
    });

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      const { salaries } = await new SalariesController().list();

      assert.equal(salaries.total, 2, 'the owner is absent, not blanked');
      assert.equal(
        salaries.items.some((row) => row.membershipId === tenant.ownerMembershipId),
        false,
      );

      const { summary } = await new SalariesController().summary();
      assert.equal(summary.ownerExcluded, true, 'and the card has to say so');
      // €7.15 × 20h × 52 ÷ 12 = €619.67. The owner's €3,000 is not in it.
      assert.equal(summary.thisMonthCents, 61_967);
      assert.equal(summary.noRateCount, 1, 'the admin themselves, with nothing set');
    });
  });
});

test('58 — an admin cannot read or write the owner’s rate, and the owner can do both', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Sandra', 'Marques', ['admin']);

    const rateId = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await new CompensationController().add(tenant.ownerMembershipId, {
        kind: 'monthly',
        amountCents: 300_000,
        weeklyHours: 40,
        effectiveFrom: '2026-01-01',
      });
      return id;
    });

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      const comp = new CompensationController();

      // 403, not an empty list: an empty history is a different lie.
      await expectStatus(() => comp.history(tenant.ownerMembershipId), 403);
      await expectStatus(
        () =>
          comp.add(tenant.ownerMembershipId, {
            kind: 'monthly',
            amountCents: 1,
            effectiveFrom: '2027-01-01',
          }),
        403,
      );
      await expectStatus(() => comp.update(rateId, { kind: 'monthly', amountCents: 1, effectiveFrom: '2026-01-01' }), 403);
      await expectStatus(() => comp.archive(rateId), 403);
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { history } = await new CompensationController().history(tenant.ownerMembershipId);
      assert.equal(history.length, 1);
      assert.equal(history[0]?.current, true);
    });
  });
});

test('58 — a new rate closes the one before it, the day before', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Inês', 'Costa', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();

      await comp.add(teacher, {
        kind: 'monthly',
        amountCents: 100_000,
        weeklyHours: 40,
        effectiveFrom: '2026-01-01',
      });
      await comp.add(teacher, {
        kind: 'monthly',
        amountCents: 110_000,
        weeklyHours: 40,
        effectiveFrom: '2026-10-01',
      });

      const { history } = await comp.history(teacher);
      assert.equal(history.length, 2, 'a raise is a new row; nothing was edited away');
      assert.equal(history[0]?.effectiveFrom, '2026-10-01');
      assert.equal(history[0]?.effectiveTo, null);
      assert.equal(history[1]?.effectiveFrom, '2026-01-01');
      assert.equal(history[1]?.effectiveTo, '2026-09-30', 'the day before, not the same day');
    });
  });
});

test('58 — a rate starting on the old one’s last day is refused, the day after is not', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Inês', 'Costa', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();

      const { id } = await comp.add(teacher, {
        kind: 'monthly',
        amountCents: 100_000,
        effectiveFrom: '2026-01-01',
      });
      await comp.update(id, {
        kind: 'monthly',
        amountCents: 100_000,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-10-31',
      });

      // Backdating behind a live rate is refused rather than silently reordered.
      await expectStatus(
        () => comp.add(teacher, { kind: 'monthly', amountCents: 120_000, effectiveFrom: '2025-06-01' }),
        409,
      );

      await expectStatus(
        () => comp.add(teacher, { kind: 'monthly', amountCents: 120_000, effectiveFrom: '2026-10-31' }),
        409,
      );

      await comp.add(teacher, {
        kind: 'monthly',
        amountCents: 120_000,
        effectiveFrom: '2026-11-01',
      });

      const { history } = await comp.history(teacher);
      assert.equal(history.length, 2);
    });
  });
});

test('58 — the refusal carries the dates as fields, not as a sentence', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Inês', 'Costa', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();
      await comp.add(teacher, {
        kind: 'monthly',
        amountCents: 100_000,
        effectiveFrom: '2026-05-01',
      });

      try {
        await comp.add(teacher, {
          kind: 'monthly',
          amountCents: 120_000,
          effectiveFrom: '2026-05-01',
        });
        assert.fail('expected a refusal');
      } catch (error) {
        const body = (error as { response?: Record<string, unknown> }).response ?? {};
        assert.equal(body['code'], 'compensation_overlap');
        assert.equal(body['from'], '2026-05-01');
        assert.equal(body['to'], null);
      }
    });
  });
});

test('58 — unknown hours are a dash and a count, never a zero in the total', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Inês', 'Costa', ['instructor']);
    const keeper = await addMember(tenant, 'Rui', 'Tavares', ['maintenance']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();

      await comp.add(teacher, { kind: 'hourly', amountCents: 715, effectiveFrom: '2020-01-01' });
      await comp.add(keeper, {
        kind: 'monthly',
        amountCents: 90_000,
        weeklyHours: 40,
        effectiveFrom: '2020-01-01',
      });

      const { salaries } = await new SalariesController().list();
      const row = salaries.items.find((r) => r.membershipId === teacher);
      assert.equal(row?.live?.monthlyCents, null, 'a dash, not a number');
      assert.equal(row?.live?.hourlyCents, 715, 'what the contract actually says');

      const { summary } = await new SalariesController().summary();
      assert.equal(summary.thisMonthCents, 90_000, 'the hourly contract adds nothing');
      assert.equal(summary.hoursUnknownCount, 1, 'and is counted where it can be seen');
      assert.equal(summary.hourlyContractCount, 1);
      assert.equal(summary.noRateCount, 1, 'the owner, with nothing set');
      assert.equal(summary.ownerExcluded, false);
    });
  });
});

test('58 — a rate that has not started yet is not the live one', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Inês', 'Costa', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();
      await comp.add(teacher, {
        kind: 'monthly',
        amountCents: 100_000,
        weeklyHours: 40,
        effectiveFrom: '2020-01-01',
      });
      await comp.add(teacher, {
        kind: 'monthly',
        amountCents: 200_000,
        weeklyHours: 40,
        effectiveFrom: '2099-01-01',
      });

      const { salaries } = await new SalariesController().list();
      const row = salaries.items.find((r) => r.membershipId === teacher);
      assert.equal(row?.live?.amountCents, 100_000, 'today’s rate, not next century’s');

      const { history } = await comp.history(teacher);
      assert.equal(history.filter((r) => r.current).length, 1);
    });
  });
});

test('58 — archiving the live rate leaves no live rate, and does not reopen the one before', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Inês', 'Costa', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();

      await comp.add(teacher, {
        kind: 'monthly',
        amountCents: 100_000,
        weeklyHours: 40,
        effectiveFrom: '2020-01-01',
      });
      const { id } = await comp.add(teacher, {
        kind: 'monthly',
        amountCents: 110_000,
        weeklyHours: 40,
        effectiveFrom: '2021-01-01',
      });

      await comp.archive(id);

      const { salaries } = await new SalariesController().list();
      const row = salaries.items.find((r) => r.membershipId === teacher);
      assert.equal(row?.live, null, 'sem valor definido — visibly nothing');

      const { history } = await comp.history(teacher);
      assert.equal(history.length, 2, 'the archived row is still what the club paid');
      assert.ok(history.find((r) => r.id === id)?.archivedAt);
      assert.equal(history.every((r) => !r.current), true);
    });
  });
});

test('58 — a person with no staff role has no salary page at all', async () => {
  await withScratchTenant(async (tenant) => {
    const pupil = await addMember(tenant, 'Miguel', 'Dias', ['student']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();
      await expectStatus(() => comp.history(pupil), 404);
      await expectStatus(
        () => comp.add(pupil, { kind: 'monthly', amountCents: 1000, effectiveFrom: '2026-01-01' }),
        404,
      );
    });
  });
});

test('58 — another tenant’s person is a 404, never a 403', async () => {
  await withScratchTenant(async (outsider) => {
    const theirs = await addMember(outsider, 'Alheia', 'Pessoa', ['instructor']);

    await withScratchTenant(async (tenant) => {
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        const comp = new CompensationController();
        await expectStatus(() => comp.history(theirs), 404);
        await expectStatus(
          () =>
            comp.add(theirs, { kind: 'monthly', amountCents: 1000, effectiveFrom: '2026-01-01' }),
          404,
        );
      });
    });
  });
});

test('58 — the roll-up counts every staff member, not the page', async () => {
  await withScratchTenant(async (tenant) => {
    // Twelve instructors, at a page size of ten.
    for (let i = 0; i < 12; i += 1) {
      const id = await addMember(tenant, `Prof${i}`, 'Silva', ['instructor']);
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        await new CompensationController().add(id, {
          kind: 'monthly',
          amountCents: 100_000,
          weeklyHours: 40,
          effectiveFrom: '2020-01-01',
        });
      });
    }

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { salaries } = await new SalariesController().list();
      assert.equal(salaries.items.length, 10, 'one page');
      assert.equal(salaries.total, 13, 'twelve plus the owner');

      const { summary } = await new SalariesController().summary();
      assert.equal(summary.thisMonthCents, 12 * 100_000, 'all twelve, not the ten on screen');
      assert.equal(summary.annualisedMonthlyCents, 12 * 116_667);
      assert.equal(summary.noRateCount, 1);
    });
  });
});

test('58 — an amount reaches the audit trail nowhere', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Inês', 'Costa', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();
      const { id } = await comp.add(teacher, {
        kind: 'monthly',
        amountCents: 123_456,
        weeklyHours: 40,
        effectiveFrom: '2026-01-01',
      });
      await comp.archive(id);
    });

    const entries = await tenant.sql<{ action: string; data: Record<string, unknown> }>(
      `SELECT action, data FROM audit_log
        WHERE organization_id = $1 AND entity_type = 'staff_compensation'
        ORDER BY created_at`,
      [tenant.organizationId],
    );

    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((e) => e.action),
      ['staff.compensation.created', 'staff.compensation.archived'],
    );
    for (const entry of entries) {
      assert.equal(
        JSON.stringify(entry.data).includes('123456'),
        false,
        'the trail records who touched it, never what they were paid',
      );
      assert.equal('amountCents' in entry.data, false);
    }
  });
});

test('58 — a bad body is a 400 with the field named, and nothing is written', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Inês', 'Costa', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();

      await expectStatus(
        () => comp.add(teacher, { kind: 'weekly', amountCents: 100, effectiveFrom: '2026-01-01' }),
        400,
      );
      await expectStatus(
        () => comp.add(teacher, { kind: 'monthly', amountCents: 0, effectiveFrom: '2026-01-01' }),
        400,
      );
      await expectStatus(
        () => comp.add(teacher, { kind: 'monthly', amountCents: -5, effectiveFrom: '2026-01-01' }),
        400,
      );
      await expectStatus(
        () =>
          comp.add(teacher, {
            kind: 'monthly',
            amountCents: 100_000,
            weeklyHours: 0,
            effectiveFrom: '2026-01-01',
          }),
        400,
      );
      await expectStatus(
        () =>
          comp.add(teacher, {
            kind: 'monthly',
            amountCents: 100_000,
            payPeriodsPerYear: 13,
            effectiveFrom: '2026-01-01',
          }),
        400,
      );
      await expectStatus(
        () => comp.add(teacher, { kind: 'monthly', amountCents: 100_000, effectiveFrom: '01-09-2026' }),
        400,
      );

      const { history } = await comp.history(teacher);
      assert.equal(history.length, 0);
    });
  });
});

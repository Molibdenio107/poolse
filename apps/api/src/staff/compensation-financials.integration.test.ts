import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { CompensationController, SalariesController } from './compensation.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
} from '../test/harness.js';

/**
 * Salaries under the financial rules — `docs/financials.md`.
 *
 * `staff_compensation` is the reference implementation for every money table
 * after it, so these are the assertions that will be copied: a provenance that
 * defaults to the honest value, a range that may be absent or half-present and
 * cannot be nonsense, and an aggregate that **reports its coverage instead of
 * pretending the missing rows are zero**.
 *
 * The adversarial half is the point. Several of these are not things that follow
 * from having just built the feature — they are attempts to get a wrong number
 * on screen: a range that inverts, a correction to a row somebody archived, a
 * period that ends before it starts, an amount large enough to be a typo.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const RATE = {
  kind: 'monthly' as const,
  amountCents: 100_000,
  weeklyHours: 40,
  effectiveFrom: '2026-01-01',
};

test('fin — a typed rate is contracted, and says so without being asked', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new CompensationController().add(teacher, RATE);

      const { history } = await new CompensationController().history(teacher);
      assert.equal(history[0]?.provenance, 'contracted');
      assert.equal(history[0]?.amountLowCents, null, 'a salary is not a guess');
      assert.equal(history[0]?.amountHighCents, null);
    });
  });
});

test('fin — a guess carries its range, and one bound alone is allowed', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();

      await comp.add(teacher, {
        ...RATE,
        provenance: 'assumed',
        amountLowCents: 90_000,
        amountHighCents: 110_000,
      });

      const { history } = await comp.history(teacher);
      assert.equal(history[0]?.provenance, 'assumed');
      assert.equal(history[0]?.amountLowCents, 90_000);
      assert.equal(history[0]?.amountHighCents, 110_000);

      // "At least €900" is a real thing to know about a figure nobody has
      // pinned down; requiring both bounds would make somebody invent one.
      const keeper = await addMember(tenant, 'Rui', 'Tavares', ['maintenance']);
      await comp.add(keeper, { ...RATE, provenance: 'estimated', amountLowCents: 90_000 });

      const second = await comp.history(keeper);
      assert.equal(second.history[0]?.amountLowCents, 90_000);
      assert.equal(second.history[0]?.amountHighCents, null);
    });
  });
});

test('fin — a range that inverts is refused before it reaches the database', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();

      // 400 rather than the 500 a bare constraint violation would produce: the
      // caller named a field wrongly and deserves to be told which.
      await expectStatus(
        () => comp.add(teacher, { ...RATE, provenance: 'assumed', amountLowCents: 120_000 }),
        400,
      );
      await expectStatus(
        () => comp.add(teacher, { ...RATE, provenance: 'assumed', amountHighCents: 90_000 }),
        400,
      );
      await expectStatus(
        () => comp.add(teacher, { ...RATE, provenance: 'assumed', amountLowCents: -1 }),
        400,
      );

      const { history } = await comp.history(teacher);
      assert.equal(history.length, 0, 'and nothing was written');
    });
  });
});

test('fin — a provenance nobody defined is refused', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(
        () => new CompensationController().add(teacher, { ...RATE, provenance: 'guessed' }),
        400,
      );
    });
  });
});

test('fin — the roll-up reports its coverage rather than treating nothing as zero', async () => {
  await withScratchTenant(async (tenant) => {
    const paid = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);
    const hourly = await addMember(tenant, 'Rui', 'Tavares', ['maintenance']);
    await addMember(tenant, 'Sem', 'Valor', ['instructor']);
    await addMember(tenant, 'Outro', 'Sem', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();
      await comp.add(paid, RATE);
      await comp.add(hourly, { ...RATE, kind: 'hourly', amountCents: 715, weeklyHours: 20 });

      const { summary } = await new SalariesController().summary();

      // Five staff — the owner included — and two of them priced.
      assert.equal(summary.coverage.total, 5);
      assert.equal(summary.coverage.withRate, 2);
      assert.equal(summary.noRateCount, 3);
      assert.equal(
        summary.complete,
        false,
        'a total over three fifths of a club is not a confident total',
      );
    });
  });
});

test('fin — a total is labelled with the weakest provenance it summed', async () => {
  await withScratchTenant(async (tenant) => {
    const paid = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);
    const guessed = await addMember(tenant, 'Rui', 'Tavares', ['maintenance']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();
      await comp.add(paid, RATE);

      const contracted = await new SalariesController().summary();
      assert.equal(contracted.summary.provenance, 'contracted');

      await comp.add(guessed, { ...RATE, provenance: 'assumed', amountCents: 80_000 });

      // Never one unlabelled figure across provenances — financials.md §2. The
      // breakdown travels with it so a screen can show either.
      const mixed = await new SalariesController().summary();
      assert.equal(mixed.summary.provenance, 'assumed', 'the weakest component names the total');
      assert.deepEqual(mixed.summary.byProvenance, {
        actual: 0,
        contracted: 100_000,
        estimated: 0,
        assumed: 80_000,
      });
    });
  });
});

test('fin — correcting a rate somebody archived is refused', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();
      const { id } = await comp.add(teacher, RATE);
      await comp.archive(id);

      // An archived row is history. Editing one would rewrite what the club was
      // paying in a period that has already been reported on.
      await expectStatus(() => comp.update(id, RATE), 409);
      await expectStatus(() => comp.archive(id), 409);
    });
  });
});

test('fin — a period that ends before it starts is a 400, not a 500', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();
      const { id } = await comp.add(teacher, RATE);

      await expectStatus(
        () => comp.update(id, { ...RATE, effectiveTo: '2025-06-01' }),
        400,
      );
    });
  });
});

test('fin — an amount large enough to be a typo is refused', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // €1,000,000 a month is the documented ceiling: high enough that no real
      // contract reaches it, low enough to catch a figure typed in cents.
      await expectStatus(
        () => new CompensationController().add(teacher, { ...RATE, amountCents: 100_000_001 }),
        400,
      );
    });
  });
});

test('fin — a rate for an id that is not a rate is a 404, in or out of the tenant', async () => {
  await withScratchTenant(async (outsider) => {
    const theirs = await addMember(outsider, 'Alheia', 'Pessoa', ['instructor']);
    const foreign = await actingAs(outsider, { roles: ['owner'] }, async () =>
      (await new CompensationController().add(theirs, RATE)).id,
    );

    await withScratchTenant(async (tenant) => {
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        const comp = new CompensationController();
        const invented = '00000000-0000-0000-0000-000000000000';

        // The two must not be told apart: a different answer for "exists
        // elsewhere" is a way to enumerate other clubs' rows.
        await expectStatus(() => comp.update(foreign, RATE), 404);
        await expectStatus(() => comp.update(invented, RATE), 404);
        await expectStatus(() => comp.archive(foreign), 404);
        await expectStatus(() => comp.archive(invented), 404);
      });
    });
  });
});

test('fin — no amount reaches a log line', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);

    const written: string[] = [];
    const levels = ['log', 'warn', 'debug', 'verbose', 'error'] as const;
    const originals = levels.map((level) => [level, Logger.prototype[level]] as const);
    for (const level of levels) {
      (Logger.prototype as unknown as Record<string, unknown>)[level] = (...args: unknown[]) => {
        written.push(args.map((arg) => String(arg)).join(' '));
      };
    }

    try {
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        const comp = new CompensationController();
        const { id } = await comp.add(teacher, { ...RATE, amountCents: 123_456 });
        await comp.update(id, { ...RATE, amountCents: 234_567 });
        await comp.archive(id);
        await new SalariesController().list();
        await new SalariesController().summary();
      });
    } finally {
      for (const [level, original] of originals) {
        (Logger.prototype as unknown as Record<string, unknown>)[level] = original;
      }
    }

    const all = written.join('\n');
    for (const amount of ['123456', '234567', '1234.56', '1.234,56']) {
      assert.equal(all.includes(amount), false, `${amount} reached a log line: ${all}`);
    }
  });
});

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { CompensationController, SalariesController } from './compensation.controller.js';
import type { SalaryExportRow } from './salary-import.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * The salaries round trip — POOLSE-59.
 *
 * The assertion that earns its place is the first one: **exporting a pay list
 * and importing it back changes nothing.** It fails on a dropped field, on a
 * value written in a shape the reader parses differently, and on the two sides
 * disagreeing about what one row is — which is three classes of bug for the
 * price of one test, and is how `partner-export.integration.test.ts` caught its
 * own.
 *
 * After that, the refusals: who the file may not name, and what it may not do.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/**
 * An exported row, as the Next server would hand it back.
 *
 * The amount becomes cents on the web, through `parseSheetCents` — tested in
 * `money.test.ts` against the messy shapes a real workbook carries. Here it is
 * the plain decimal the exporter writes, so this test is about the *row* making
 * the round trip rather than about the reader.
 */
function asImport(row: SalaryExportRow): Record<string, unknown> {
  return {
    ...row,
    amountCents: row.amount === '' ? null : Math.round(Number(row.amount) * 100),
  };
}

async function seedClub(tenant: ScratchTenant): Promise<{ teacher: string; keeper: string }> {
  const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);
  const keeper = await addMember(tenant, 'Pedro', 'Nogueira', ['maintenance']);

  await actingAs(tenant, { roles: ['owner'] }, async () => {
    const comp = new CompensationController();
    await comp.add(teacher, {
      kind: 'monthly',
      amountCents: 120_000,
      weeklyHours: 40,
      effectiveFrom: '2026-01-01',
    });
    await comp.add(keeper, {
      kind: 'hourly',
      amountCents: 715,
      weeklyHours: 12,
      payPeriodsPerYear: 12,
      effectiveFrom: '2026-01-01',
      note: 'Fins de semana',
    });
  });

  return { teacher, keeper };
}

test('59 — a round trip changes nothing', async () => {
  await withScratchTenant(async (tenant) => {
    await seedClub(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const salaries = new SalariesController();

      const { rows } = await salaries.export();
      assert.equal(rows.length, 3, 'two with rates, and the owner with none');

      const preview = await salaries.import({ rows: rows.map(asImport), commit: false });

      assert.equal(preview.summary.importable, 0, 'nothing to do');
      assert.equal(preview.summary.rejected, 0, 'and nothing wrong either');
      assert.equal(preview.summary.unchanged, 2);
      assert.equal(preview.summary.blank, 1, 'the owner, with no rate to export');
      assert.equal(preview.refusal, null);

      const committed = await salaries.import({ rows: rows.map(asImport), commit: true });
      assert.equal(committed.written, 0, 'a round trip writes no rows');

      // And the file it writes afterwards is the file it wrote before.
      const after = await salaries.export();
      assert.deepEqual(after.rows, rows);
    });
  });
});

test('59 — the year’s rise imports, and closes the rate it succeeds', async () => {
  await withScratchTenant(async (tenant) => {
    const { teacher } = await seedClub(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const salaries = new SalariesController();
      const { rows } = await salaries.export();

      const edited = rows.map((row) =>
        row.kind === 'monthly'
          ? { ...asImport(row), amount: '1300.00', amountCents: 130_000, effectiveFrom: '2026-09-01' }
          : asImport(row),
      );

      const preview = await salaries.import({ rows: edited, commit: false });
      assert.equal(preview.summary.importable, 1);

      const raised = preview.rows.find((row) => row.importable);
      assert.equal(raised?.current?.amountCents, 120_000, 'the preview shows old → new');
      assert.equal(raised?.amountCents, 130_000);

      const committed = await salaries.import({ rows: edited, commit: true });
      assert.equal(committed.written, 1);

      const { history } = await new CompensationController().history(teacher);
      assert.equal(history.length, 2, 'a raise is a new row; nothing was edited away');
      assert.equal(history[0]?.effectiveFrom, '2026-09-01');
      assert.equal(history[1]?.effectiveTo, '2026-08-31', 'closed the day before');
    });
  });
});

test('59 — a date a person typed as 01/09/2026 is the first of September', async () => {
  await withScratchTenant(async (tenant) => {
    const { teacher } = await seedClub(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const salaries = new SalariesController();
      const { rows } = await salaries.export();
      const mine = rows.find((row) => row.kind === 'monthly')!;

      const preview = await salaries.import({
        rows: [{ ...asImport(mine), amount: '1300,00', amountCents: 130_000, effectiveFrom: '01/09/2026' }],
        commit: false,
      });

      assert.equal(preview.rows[0]?.effectiveFrom, '2026-09-01', 'day first, as pt-PT writes it');
      assert.equal(preview.rows[0]?.importable, true);
    });

    void teacher;
  });
});

test('59 — an unknown person is a rejected row, never a silent create', async () => {
  await withScratchTenant(async (tenant) => {
    await seedClub(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const salaries = new SalariesController();
      const before = await salaries.list();

      const result = await salaries.import({
        rows: [
          { email: 'ninguem@exemplo.pt', kind: 'monthly', amount: '900.00', amountCents: 90_000, effectiveFrom: '2026-09-01' },
        ],
        commit: true,
      });

      assert.deepEqual(result.rows[0]?.problems, ['notFound']);
      assert.equal(result.rows[0]?.importable, false);
      assert.equal(result.written, 0);

      const after = await salaries.list();
      assert.equal(after.salaries.total, before.salaries.total, 'nobody was created');
    });
  });
});

test('59 — a student is refused with a reason of its own', async () => {
  await withScratchTenant(async (tenant) => {
    const pupil = await addMember(tenant, 'Miguel', 'Dias', ['student']);

    const [email] = await tenant.sql<{ email: string }>(
      'SELECT email::text AS email FROM membership WHERE id = $1',
      [pupil],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await new SalariesController().import({
        rows: [{ email: email!.email, kind: 'monthly', amount: '900.00', amountCents: 90_000, effectiveFrom: '2026-09-01' }],
        commit: true,
      });

      // Not `notFound`: the club knows exactly who this is, and sending somebody
      // hunting for a typo in a correct address is the wrong thing to say.
      assert.deepEqual(result.rows[0]?.problems, ['notStaff']);
      assert.equal(result.written, 0);
    });
  });
});

test('59 — an admin’s export omits the owner, and an admin’s file may not name them', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Sandra', 'Marques', ['admin']);
    const { teacher } = await seedClub(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new CompensationController().add(tenant.ownerMembershipId, {
        kind: 'monthly',
        amountCents: 300_000,
        weeklyHours: 40,
        effectiveFrom: '2026-01-01',
      });
    });

    const ownerEmail = await tenant.sql<{ email: string }>(
      'SELECT person_email($1)::text AS email',
      [tenant.ownerMembershipId],
    );

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      const salaries = new SalariesController();

      const { rows } = await salaries.export();
      assert.equal(
        rows.some((row) => row.email === ownerEmail[0]?.email?.toLowerCase()),
        false,
        'the owner is absent from an admin’s file',
      );

      const result = await salaries.import({
        rows: [
          {
            email: ownerEmail[0]!.email,
            kind: 'monthly',
            amount: '1.00',
            amountCents: 100,
            effectiveFrom: '2027-01-01',
          },
          { email: `ana.ferreira`, kind: 'monthly', amount: '1300.00', amountCents: 130_000, effectiveFrom: '2026-09-01' },
        ],
        commit: false,
      });

      assert.deepEqual(result.rows[0]?.problems, ['ownerRefused'], 'stated, never silently skipped');
      assert.equal(result.rows[0]?.importable, false);
    });

    void teacher;
  });
});

test('59 — one person twice refuses the whole file', async () => {
  await withScratchTenant(async (tenant) => {
    await seedClub(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const salaries = new SalariesController();
      const { rows } = await salaries.export();
      const mine = rows.find((row) => row.kind === 'monthly')!;

      const twice = [
        { ...asImport(mine), amount: '1300.00', amountCents: 130_000, effectiveFrom: '2026-09-01' },
        { ...asImport(mine), amount: '1400.00', amountCents: 140_000, effectiveFrom: '2026-10-01' },
      ];

      const preview = await salaries.import({ rows: twice, commit: false });
      assert.equal(preview.refusal, 'duplicatePerson');
      assert.equal(preview.rows[1]?.repeatOfLine, 2, 'and it points at the line that came first');

      // Which of the two is their pay is not something to guess, so a commit
      // writes nothing at all rather than picking one.
      const committed = await salaries.import({ rows: twice, commit: true });
      assert.equal(committed.committed, false);
      assert.equal(committed.written, 0);
    });
  });
});

test('59 — a NIF matches, and one that cannot exist matches nobody', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);
    // 123456789 is checksum-valid; 212345678 is not — `isValidNif` in
    // `@poolse/rules` is the one definition, and this file uses its answer
    // rather than a number that merely looks like one.
    await tenant.sql('UPDATE membership SET tax_number = $2 WHERE id = $1', [teacher, '123456789']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const salaries = new SalariesController();

      const good = await salaries.import({
        rows: [{ taxNumber: '123456789', kind: 'monthly', amount: '1000.00', amountCents: 100_000, effectiveFrom: '2026-09-01' }],
        commit: false,
      });
      assert.equal(good.rows[0]?.membershipId, teacher);
      assert.deepEqual(good.rows[0]?.problems, []);

      const bad = await salaries.import({
        rows: [{ taxNumber: '212345678', kind: 'monthly', amount: '1000.00', amountCents: 100_000, effectiveFrom: '2026-09-01' }],
        commit: false,
      });
      // Both, and in that order: the number cannot exist *and* it matched nobody.
      assert.deepEqual(bad.rows[0]?.problems, ['badNif', 'notFound']);
    });
  });
});

test('59 — a row with no key, no amount, or a bad cell says which', async () => {
  await withScratchTenant(async (tenant) => {
    const { teacher } = await seedClub(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const salaries = new SalariesController();
      const { rows } = await salaries.export();
      const mine = rows.find((row) => row.kind === 'monthly')!;

      const result = await salaries.import({
        rows: [
          { name: 'Sem chave', kind: 'monthly', amount: '900.00', amountCents: 90_000, effectiveFrom: '2026-09-01' },
          { ...asImport(mine), amount: '', amountCents: null },
          { ...asImport(mine), amount: '0', amountCents: 0, effectiveFrom: '2026-09-01' },
          { ...asImport(mine), amount: '900.00', amountCents: 90_000, weeklyHours: '200', effectiveFrom: '2026-09-01' },
          { ...asImport(mine), amount: '900.00', amountCents: 90_000, payPeriods: '13', effectiveFrom: '2026-09-01' },
          { ...asImport(mine), amount: '900.00', amountCents: 90_000, effectiveFrom: '' },
          { ...asImport(mine), amount: '900.00', amountCents: 90_000, effectiveFrom: 'quando calhar' },
        ],
        commit: false,
      });

      assert.deepEqual(result.rows[0]?.problems, ['noKey']);
      assert.equal(result.rows[1]?.blank, true, 'a blank amount is nothing to do, not an error');
      assert.deepEqual(result.rows[1]?.problems, []);
      assert.ok(result.rows[2]?.problems.includes('amountInvalid'));
      assert.ok(result.rows[3]?.problems.includes('hoursInvalid'));
      assert.ok(result.rows[4]?.problems.includes('periodsInvalid'));
      assert.ok(result.rows[5]?.problems.includes('dateMissing'));
      assert.ok(result.rows[6]?.problems.includes('dateInvalid'));

      assert.equal(result.summary.importable, 0);
    });

    void teacher;
  });
});

test('59 — a rate landing inside a closed period is refused before it is written', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();
      const { id } = await comp.add(teacher, {
        kind: 'monthly',
        amountCents: 120_000,
        effectiveFrom: '2026-01-01',
      });
      await comp.update(id, {
        kind: 'monthly',
        amountCents: 120_000,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      });

      const salaries = new SalariesController();
      const { rows } = await salaries.export();
      const mine = rows[0]!;

      const result = await salaries.import({
        rows: [{ ...asImport(mine), amount: '1300.00', amountCents: 130_000, effectiveFrom: '2026-06-01' }],
        commit: false,
      });

      assert.ok(result.rows[0]?.problems.includes('overlap'));
      assert.equal(result.rows[0]?.importable, false);
    });
  });
});

test('59 — only the ticked rows are written', async () => {
  await withScratchTenant(async (tenant) => {
    const { teacher, keeper } = await seedClub(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const salaries = new SalariesController();
      const { rows } = await salaries.export();

      const edited = rows.map((row) =>
        row.amount === ''
          ? asImport(row)
          : {
              ...asImport(row),
              amountCents: Math.round(Number(row.amount) * 100) + 5000,
              effectiveFrom: '2026-09-01',
            },
      );

      const preview = await salaries.import({ rows: edited, commit: false });
      assert.equal(preview.summary.importable, 2);

      const first = preview.rows.find((row) => row.importable)!;
      const committed = await salaries.import({ rows: edited, commit: true, include: [first.index] });

      assert.equal(committed.written, 1, 'one ticked, one written');

      const both = await new CompensationController();
      const teacherHistory = (await both.history(teacher)).history;
      const keeperHistory = (await both.history(keeper)).history;
      assert.equal(teacherHistory.length + keeperHistory.length, 3, 'one of them gained a row');
    });
  });
});

test('59 — an instructor cannot export or import, whatever the screen offers', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);

    for (const role of ['instructor', 'maintenance', 'student', 'guardian'] as const) {
      await actingAs(tenant, { membershipId: teacher, roles: [role] }, async () => {
        const salaries = new SalariesController();
        await expectStatus(() => salaries.export(), 403);
        await expectStatus(() => salaries.import({ rows: [], commit: false }), 403);
      });
    }
  });
});

test('59 — a file longer than any club is refused outright', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const rows = Array.from({ length: 501 }, () => ({ email: 'a@b.pt', amountCents: 1 }));
      await expectStatus(() => new SalariesController().import({ rows, commit: false }), 400);
    });
  });
});

test('59 — a preview writes nothing, however many rows it reports', async () => {
  await withScratchTenant(async (tenant) => {
    const { teacher } = await seedClub(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const salaries = new SalariesController();
      const { rows } = await salaries.export();

      const edited = rows.map((row) =>
        row.amount === ''
          ? asImport(row)
          : { ...asImport(row), amountCents: 999_00, effectiveFrom: '2026-09-01' },
      );

      const before = (await new CompensationController().history(teacher)).history.length;

      // Three times, to be sure a preview is not accumulating anything either.
      await salaries.import({ rows: edited, commit: false });
      await salaries.import({ rows: edited, commit: false });
      const preview = await salaries.import({ rows: edited, commit: false });

      assert.equal(preview.committed, false);
      assert.equal(preview.written, 0);
      assert.equal(
        (await new CompensationController().history(teacher)).history.length,
        before,
        'a dry run is a dry run',
      );
    });
  });
});

test('59 — a file the size of a real payroll commits in one piece', async () => {
  await withScratchTenant(async (tenant) => {
    // Fifty, not five hundred: the cap is 500 and the assertion is about the
    // commit being one transaction, which fifty rows prove in a tenth of the
    // time. The cap itself has its own test above.
    const people: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      people.push(await addMember(tenant, `Prof${i}`, 'Silva', ['instructor']));
    }

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const salaries = new SalariesController();
      const { rows } = await salaries.export();

      const priced = rows.map((row) => ({
        ...asImport(row),
        kind: 'monthly',
        amount: '1000.00',
        amountCents: 100_000,
        weeklyHours: '40',
        payPeriods: '14',
        effectiveFrom: '2026-09-01',
      }));

      const committed = await salaries.import({ rows: priced, commit: true });
      assert.equal(committed.written, 51, 'fifty instructors and the owner');

      const { summary } = await salaries.summary();
      assert.equal(summary.coverage.withRate, 51);
      assert.equal(summary.complete, true);
    });

    void people;
  });
});

test('59 — a row the database refuses at the last moment rolls the whole file back', async () => {
  await withScratchTenant(async (tenant) => {
    const first = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);
    const second = await addMember(tenant, 'Rui', 'Tavares', ['maintenance']);

    const emails = await tenant.sql<{ id: string; email: string }>(
      `SELECT id, email::text AS email FROM membership WHERE id = ANY($1::uuid[])`,
      [[first, second]],
    );
    const emailOf = (id: string): string => emails.find((row) => row.id === id)!.email;

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const comp = new CompensationController();
      const salaries = new SalariesController();

      // The second person already has a rate whose end somebody typed, so a new
      // one landing inside it is refused — by the constraint, at commit.
      const { id } = await comp.add(second, {
        kind: 'monthly',
        amountCents: 100_000,
        effectiveFrom: '2026-01-01',
      });
      await comp.update(id, {
        kind: 'monthly',
        amountCents: 100_000,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      });

      const rows = [
        {
          email: emailOf(first),
          kind: 'monthly',
          amount: '1200.00',
          amountCents: 120_000,
          effectiveFrom: '2026-09-01',
        },
        {
          email: emailOf(second),
          kind: 'monthly',
          amount: '1300.00',
          amountCents: 130_000,
          effectiveFrom: '2026-06-01',
        },
      ];

      // The preview says so first — this is the honest path, and the reason a
      // commit-time refusal is rare rather than routine.
      const seen = await salaries.import({ rows, commit: false });
      assert.ok(seen.rows[1]?.problems.includes('overlap'));
      assert.equal(seen.summary.importable, 1);

      /*
       * Now stage the race the whole-or-nothing rule exists for: somebody saves
       * a rate between the preview and the commit, so a row that *was* importable
       * is refused by the constraint on the way in.
       */
      const clean = [rows[0]!, { ...rows[1]!, effectiveFrom: '2027-06-01' }];
      const ready = await salaries.import({ rows: clean, commit: false });
      assert.equal(ready.summary.importable, 2, 'both rows are fine at preview');

      // *After* the row in the file, so it cannot be auto-closed: a new rate
      // may follow an open-ended one, and may not be slipped in before it.
      await comp.add(second, {
        kind: 'monthly',
        amountCents: 111_000,
        effectiveFrom: '2027-09-01',
      });

      await expectStatus(() => salaries.import({ rows: clean, commit: true }), 409);

      assert.equal(
        (await comp.history(first)).history.length,
        0,
        'a payroll file commits whole or not at all',
      );
    });
  });
});

test('59 — an estimate survives the round trip as an estimate', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const salaries = new SalariesController();
      await new CompensationController().add(teacher, {
        kind: 'monthly',
        amountCents: 100_000,
        weeklyHours: 40,
        effectiveFrom: '2026-01-01',
        provenance: 'assumed',
      });

      const { rows } = await salaries.export();
      const mine = rows.find((row) => row.amount !== '')!;
      assert.equal(mine.provenance, 'assumed', 'the enum spelling, so en exports import under pt');

      // Unchanged, and specifically *because* the provenance came back too: an
      // export that dropped the column would re-import a guess as a contract.
      const preview = await salaries.import({ rows: rows.map(asImport), commit: false });
      assert.equal(preview.summary.unchanged, 1);
      assert.equal(preview.summary.importable, 0);
    });
  });
});

test('59 — a provenance nobody recognises is a rejected row, not a silent contract', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Ana', 'Ferreira', ['instructor']);
    const [email] = await tenant.sql<{ email: string }>(
      'SELECT email::text AS email FROM membership WHERE id = $1',
      [teacher],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await new SalariesController().import({
        rows: [
          {
            email: email!.email,
            kind: 'monthly',
            amount: '1000.00',
            amountCents: 100_000,
            effectiveFrom: '2026-09-01',
            provenance: 'mais ou menos',
          },
        ],
        commit: true,
      });

      assert.deepEqual(result.rows[0]?.problems, ['provenanceInvalid']);
      assert.equal(result.written, 0);
    });
  });
});

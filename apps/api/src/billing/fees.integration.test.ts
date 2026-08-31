import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FacilityBillingController,
  FeePeriodsController,
  FeePlansController,
  StudentFeesController,
  StudentSocioController,
} from './fees.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * What a student pays — POOLSE-42, against a real database.
 *
 * The scenarios the ticket numbers, at the layer that decides them. Three are
 * worth more than the rest:
 *
 * **42.3** — the API's total and SQL's are the same integer, because they are
 * the same call. The moment somebody reimplements the arithmetic in TypeScript
 * "for the client", this is what fails.
 *
 * **42.4 / 42.5** — the snapshot. Raising a price must not re-price the families
 * who already agreed one, and updating a line must be a per-line decision.
 *
 * **42.10** — an instructor cannot read what a family pays, enforced on the
 * endpoint rather than by a screen not drawing the block.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/**
 * A price list: Mensal at 0 %, Trimestral at 5 %, and 35,00 € for one level at
 * two lessons a week.
 *
 * A mensalidade is a level and a frequency now — there is no name to give it,
 * which is the point of the second pass.
 */
async function priceList(tenant: ScratchTenant): Promise<{
  mensal: string;
  trimestral: string;
  plan: string;
  level: string;
}> {
  const periods = new FeePeriodsController();
  const plans = new FeePlansController();

  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order)
     VALUES ($1, 'Iniciação', 1) RETURNING id`,
    [tenant.organizationId],
  );

  return actingAs(tenant, { roles: ['owner'] }, async () => {
    const mensal = (
      await periods.create(tenant.facilityId, { name: 'Mensal', months: 1, isDefault: true })
    ).id;
    const trimestral = (
      await periods.create(tenant.facilityId, {
        name: 'Trimestral',
        months: 3,
        discountPercent: 5,
      })
    ).id;
    const plan = (
      await plans.create(tenant.facilityId, {
        kind: 'mensalidade',
        levelId: level!.id,
        lessonsPerWeek: 2,
        amountCents: 3500,
      })
    ).id;

    return { mensal, trimestral, plan, level: level!.id };
  });
}

async function addStudent(
  tenant: ScratchTenant,
  firstName: string,
  birthDate: string | null = null,
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, $2, 'Melo', $3::date) RETURNING id`,
    [tenant.organizationId, firstName, birthDate],
  );
  return row!.id;
}

test('42.1 — a facility holds its price list and its periodicities', async () => {
  await withScratchTenant(async (tenant) => {
    await priceList(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { periods } = await new FeePeriodsController().list(tenant.facilityId);
      const { plans } = await new FeePlansController().list(tenant.facilityId);

      assert.deepEqual(
        periods.map((period) => `${period.name}:${period.months}:${period.discountPercent}`),
        ['Mensal:1:0', 'Trimestral:3:5'],
      );
      assert.equal(periods.filter((period) => period.isDefault).length, 1);
      assert.equal(plans[0]?.amountCents, 3500);
      assert.equal(plans[0]?.levelName, 'Iniciação');
      assert.equal(plans[0]?.lessonsPerWeek, 2, 'a price is a level and a frequency');
    });
  });
});

test('42.2 and 42.3 — the total is 99,75 and it comes from SQL, not from here', async () => {
  await withScratchTenant(async (tenant) => {
    const { trimestral, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await fees.create(student, { feePlanId: plan, feePeriodId: trimestral });

      const { lines } = await fees.list(student);
      assert.equal(lines.length, 1);
      assert.equal(lines[0]?.periodTotalCents, 9975, '35,00 x 3 at 5% is 99,75');
      assert.equal(lines[0]?.payableCents, 9975, 'and nothing was negotiated off it');
    });

    // QA 42.3: the same inputs through the function itself. Identical integer,
    // because the endpoint calls it rather than reimplementing it.
    const [row] = await tenant.sql<{ total: number }>(
      'SELECT fee_total_cents(3500, 3::smallint, 5) AS total',
    );
    assert.equal(row?.total, 9975);
  });
});

test('42.4 and 42.5 — raising a price leaves agreements alone until asked, one at a time', async () => {
  await withScratchTenant(async (tenant) => {
    const { trimestral, plan, level } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const other = await addStudent(tenant, 'Inês');
    const fees = new StudentFeesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await fees.create(student, { feePlanId: plan, feePeriodId: trimestral });
      await fees.create(other, { feePlanId: plan, feePeriodId: trimestral });

      // The club puts its prices up.
      await new FeePlansController().update(tenant.facilityId, plan, {
        kind: 'mensalidade',
        levelId: level,
        lessonsPerWeek: 2,
        amountCents: 4000,
      });

      const before = await fees.list(student);
      assert.equal(before.lines[0]?.amountCents, 3500, 'the agreement is untouched');
      assert.equal(
        before.lines[0]?.planAmountCentsNow,
        4000,
        'and the line is marked as out of date — AC5',
      );

      await fees.reprice(student, before.lines[0]!.id);

      const after = await fees.list(student);
      assert.equal(after.lines[0]?.amountCents, 4000);
      assert.equal(after.lines[0]?.planAmountCentsNow, null, 'the marker clears');
      assert.equal(after.lines[0]?.periodTotalCents, 11400, '40,00 x 3 at 5% is 114,00');

      // 42.5: only that line changed.
      const untouched = await fees.list(other);
      assert.equal(untouched.lines[0]?.amountCents, 3500);
      assert.equal(untouched.lines[0]?.planAmountCentsNow, 4000);
    });
  });
});

test('42.6 and 42.8b — two lines, each with its own periodicity, and they do not move together', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, trimestral, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const quota = (
        await new FeePlansController().create(tenant.facilityId, {
          kind: 'quota',
          amountCents: 2500,
        })
      ).id;

      // The mensalidade monthly, the quota every three months. Ordinary, not an
      // edge case — and the two are independent.
      await fees.create(student, { feePlanId: plan, feePeriodId: mensal });
      await fees.create(student, { feePlanId: quota, feePeriodId: trimestral });

      const { lines } = await fees.list(student);
      assert.equal(lines.length, 2);

      const mensalidade = lines.find((line) => line.kind === 'mensalidade');
      const socioLine = lines.find((line) => line.kind === 'quota');

      assert.equal(mensalidade?.months, 1);
      assert.equal(mensalidade?.periodTotalCents, 3500);
      assert.equal(socioLine?.months, 3);
      assert.equal(socioLine?.periodTotalCents, 7125, '25,00 x 3 at 5% is 71,25');

      // Changing one leaves the other exactly where it was.
      await fees.update(student, socioLine!.id, { feePeriodId: mensal });

      const changed = await fees.list(student);
      assert.equal(
        changed.lines.find((line) => line.kind === 'mensalidade')?.months,
        1,
        'the mensalidade did not follow the quota',
      );
      assert.equal(changed.lines.find((line) => line.kind === 'quota')?.months, 1);
    });
  });
});

test('42.7 — ending an enrolment ends the line it was charging, as history', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();

    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, facility_id, season_id, name)
       VALUES ($1, $2, $3, 'Turma A') RETURNING id`,
      [tenant.organizationId, tenant.facilityId, tenant.seasonId],
    );
    const [enrolment] = await tenant.sql<{ id: string }>(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenant.organizationId, group!.id, student],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await fees.create(student, {
        feePlanId: plan,
        feePeriodId: mensal,
        enrollmentId: enrolment!.id,
      });
    });

    await tenant.sql(
      `UPDATE enrollment SET status = 'ended', ended_on = DATE '2027-03-31' WHERE id = $1`,
      [enrolment!.id],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { lines } = await fees.list(student);
      assert.equal(lines.length, 1, 'still visible as history');
      assert.equal(lines[0]?.endsOn, '2027-03-31');
    });
  });
});

test('42.8 — a sócio with no quota line is representable', async () => {
  await withScratchTenant(async (tenant) => {
    const student = await addStudent(tenant, 'Inês');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new StudentSocioController().update(student, {
        isSocio: true,
        socioNumber: 'S-0001',
        socioSince: '2026-01-15',
      });

      const { socio, lines } = await new StudentFeesController().list(student);
      assert.equal(socio.isSocio, true);
      assert.equal(socio.socioNumber, 'S-0001');
      assert.equal(socio.socioSince, '2026-01-15');
      assert.equal(lines.length, 0, 'a waived quota is a real case');
    });
  });
});

test('42.9 — a manual discount with no reason is refused, and names its field', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(
        () =>
          fees.create(student, {
            feePlanId: plan,
            feePeriodId: mensal,
            manualDiscountPercent: 10,
          }),
        400,
      );

      // And a discount cannot be both a percentage and an amount.
      await expectStatus(
        () =>
          fees.create(student, {
            feePlanId: plan,
            feePeriodId: mensal,
            manualDiscountPercent: 10,
            manualDiscountCents: 500,
            discountReason: 'irmãos',
          }),
        400,
      );

      // With a reason it is accepted, and it comes off the total.
      await fees.create(student, {
        feePlanId: plan,
        feePeriodId: mensal,
        manualDiscountPercent: 10,
        discountReason: 'irmãos',
      });

      const { lines } = await fees.list(student);
      assert.equal(lines[0]?.periodTotalCents, 3500);
      assert.equal(lines[0]?.payableCents, 3150, '35,00 less 10% is 31,50');
    });
  });
});

test('42.10 — an instructor cannot read what a family pays', async () => {
  await withScratchTenant(async (tenant) => {
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();

    const instructor = await addMember(tenant, 'Rita', 'Instrutora', ['instructor']);
    const guardian = await addMember(tenant, 'Sofia', 'Melo', ['guardian']);
    const pupil = await addMember(tenant, 'Ana', 'Aluna', ['student']);

    for (const [membershipId, role] of [
      [instructor, 'instructor'],
      [guardian, 'guardian'],
      [pupil, 'student'],
    ] as const) {
      await actingAs(tenant, { membershipId, roles: [role] }, async () => {
        await expectStatus(() => fees.list(student), 403);
        await expectStatus(() => new FeePlansController().list(tenant.facilityId), 403);
        await expectStatus(() => new FeePeriodsController().list(tenant.facilityId), 403);
      });
    }

    // An admin is admitted, which proves the refusals were about the role.
    const admin = await addMember(tenant, 'Paulo', 'Admin', ['admin']);
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      assert.equal((await fees.list(student)).lines.length, 0);
    });
  });
});

test('42.11 — another organization sees none of this club price list', async () => {
  await withScratchTenant(async (tenant) => {
    await priceList(tenant);

    // A second scratch tenant, asking for the first one's facility by id. Row
    // level security answers with nothing rather than with somebody else's
    // prices — the same shape as every other cross-tenant test here.
    await withScratchTenant(async (other) => {
      await actingAs(other, { roles: ['owner'] }, async () => {
        const { plans } = await new FeePlansController().list(tenant.facilityId);
        const { periods } = await new FeePeriodsController().list(tenant.facilityId);

        assert.deepEqual(plans, []);
        assert.deepEqual(periods, []);
      });
    });
  });
});

/**
 * Settling one occurrence — and the due date that makes "overdue" mean anything.
 *
 * The first pass put a boolean on the line, which could not say *which* month
 * was paid. A row per occurrence can, so it resets on its own and a due date has
 * something to be late against.
 */
test('a payment settles one occurrence, and unsettling removes it', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await fees.create(student, { feePlanId: plan, feePeriodId: mensal });
      const [line] = (await fees.list(student)).lines;

      assert.equal(line?.isPaid, false, 'nothing is paid until somebody says so');
      assert.ok(line?.currentPeriodStart !== null, 'a live line is asking for something');
      assert.ok(line?.dueOn !== null, 'and it has a date to be late against');

      await fees.paid(student, line!.id, {
        isPaid: true,
        periodStart: line!.currentPeriodStart,
        paidOn: '2026-09-05',
      });

      const marked = (await fees.list(student)).lines[0];
      assert.equal(marked?.isPaid, true);
      assert.equal(marked?.paidOn, '2026-09-05');
      assert.equal(marked?.isOverdue, false);

      await fees.paid(student, line!.id, {
        isPaid: false,
        periodStart: line!.currentPeriodStart,
      });
      assert.equal((await fees.list(student)).lines[0]?.isPaid, false);
    });
  });
});

test('settling the same occurrence twice keeps one payment, not two', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await fees.create(student, { feePlanId: plan, feePeriodId: mensal });
      const [line] = (await fees.list(student)).lines;

      await fees.paid(student, line!.id, { isPaid: true, periodStart: line!.currentPeriodStart });
      await fees.paid(student, line!.id, { isPaid: true, periodStart: line!.currentPeriodStart });
    });

    const [row] = await tenant.sql<{ count: string }>(
      'SELECT count(*)::text AS count FROM student_fee_payment',
    );
    assert.equal(row?.count, '1', 'a second settlement would double every total built from these');
  });
});

/**
 * Overdue, and the penalty it earns.
 *
 * The line starts in the past so its occurrence is genuinely behind the due day
 * rather than depending on which day this test happens to run.
 */
test('an unsettled occurrence past its due day is overdue, and earns one penalty', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();

    await tenant.sql(
      `UPDATE facility
          SET payment_due_day = 8, late_penalty_kind = 'amount', late_penalty_cents = 500`,
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await fees.create(student, {
        feePlanId: plan,
        feePeriodId: mensal,
        startsOn: '2026-01-05',
      });

      const before = await fees.list(student);
      assert.equal(before.lines[0]?.isOverdue, true);
      assert.equal(before.penaltyCents, 500, 'one penalty, whatever is late');
      assert.equal(before.penalties.mensalidadeCents, 500);
      assert.equal(before.penalties.quotaCents, 0, 'a quota nobody charges for costs nothing');

      await fees.paid(student, before.lines[0]!.id, {
        isPaid: true,
        periodStart: before.lines[0]!.currentPeriodStart,
      });

      const after = await fees.list(student);
      assert.equal(after.lines[0]?.isOverdue, false);
      assert.equal(after.penaltyCents, 0, 'and it goes away when the money arrives');
    });
  });
});

test('a quarterly line is asked for one payment a quarter, not one a month', async () => {
  await withScratchTenant(async (tenant) => {
    const { trimestral, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // Started in January, so by now several quarters have gone by. The
      // occurrence being asked for has to be the *current* quarter, not January
      // and not this calendar month.
      await fees.create(student, {
        feePlanId: plan,
        feePeriodId: trimestral,
        startsOn: '2026-01-05',
      });

      const [line] = (await fees.list(student)).lines;
      const start = line!.currentPeriodStart!;

      // The fifth of some month, and a whole number of quarters after January.
      assert.match(start, /^\d{4}-\d{2}-05$/);
      const months =
        (Number(start.slice(0, 4)) - 2026) * 12 + (Number(start.slice(5, 7)) - 1);
      assert.equal(months % 3, 0, `${start} is not a quarter boundary from January`);
    });
  });
});

/**
 * Sócio attaches the quota — the change from POOLSE-42's AC8, which offered it.
 *
 * AC6 is what makes automatic safe: the quota is an ordinary fee line, so a
 * waived one is the operator removing it while the membership stays. An honorary
 * member is still representable.
 */
test('becoming a sócio attaches the quota, once, and the total includes it', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();
    const socio = new StudentSocioController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new FeePlansController().create(tenant.facilityId, {
        kind: 'quota',
        amountCents: 2500,
      });
      await fees.create(student, { feePlanId: plan, feePeriodId: mensal });

      const first = await socio.update(student, { isSocio: true, socioNumber: 'S-1' });
      assert.equal(first.quotaAdded, true);
      assert.equal(first.quotaUnavailable, false);

      const { lines } = await fees.list(student);
      assert.equal(lines.length, 2);
      assert.equal(
        lines.reduce((sum, line) => sum + line.payableCents, 0),
        6000,
        '35,00 mensalidade plus 25,00 de quota',
      );

      // Saving the toggle again must not attach a second one.
      const again = await socio.update(student, { isSocio: true, socioNumber: 'S-1' });
      assert.equal(again.quotaAdded, false);
      assert.equal((await fees.list(student)).lines.length, 2);
    });
  });
});

test('a club with no quota plan is told, rather than the toggle doing nothing', async () => {
  await withScratchTenant(async (tenant) => {
    await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await new StudentSocioController().update(student, { isSocio: true });

      assert.equal(result.quotaAdded, false);
      assert.equal(result.quotaUnavailable, true, 'the screen says so');
      assert.equal((await new StudentFeesController().list(student)).socio.isSocio, true);
    });
  });
});

test('a waived quota stays representable — AC6 survives the automation', async () => {
  await withScratchTenant(async (tenant) => {
    await priceList(tenant);
    const student = await addStudent(tenant, 'Inês');
    const fees = new StudentFeesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new FeePlansController().create(tenant.facilityId, {
        kind: 'quota',
        amountCents: 2500,
      });

      await new StudentSocioController().update(student, { isSocio: true, socioNumber: 'S-2' });
      const [quota] = (await fees.list(student)).lines;

      // The honorary member: the line comes off, the membership stays.
      await fees.archive(student, quota!.id);

      const after = await fees.list(student);
      assert.equal(after.lines.length, 0);
      assert.equal(after.socio.isSocio, true);
      assert.equal(after.socio.socioNumber, 'S-2');
    });
  });
});

/**
 * The due day and the penalty — the settings the overdue rules read.
 *
 * Written because "nothing happens when I press Save" needed an answer that was
 * not a guess: either the endpoint does not persist, or the screen does not say
 * that it did. This settles the first half.
 */
test('the due day and the penalty save, and come back', async () => {
  await withScratchTenant(async (tenant) => {
    const billing = new FacilityBillingController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const before = await billing.read(tenant.facilityId);
      assert.equal(before.paymentDueDay, 8, 'the default a new site starts with');
      assert.equal(before.latePenaltyCents, 0);

      await billing.update(tenant.facilityId, { paymentDueDay: 15, latePenaltyCents: 500 });

      const after = await billing.read(tenant.facilityId);
      assert.equal(after.paymentDueDay, 15);
      assert.equal(after.latePenaltyCents, 500);
    });
  });
});

test('a due day outside the month is refused, naming the field', async () => {
  await withScratchTenant(async (tenant) => {
    const billing = new FacilityBillingController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(
        () => billing.update(tenant.facilityId, { paymentDueDay: 0, latePenaltyCents: 0 }),
        400,
      );
      await expectStatus(
        () => billing.update(tenant.facilityId, { paymentDueDay: 32, latePenaltyCents: 0 }),
        400,
      );
    });
  });
});

test('billing settings are owner and admin, like every other amount', async () => {
  await withScratchTenant(async (tenant) => {
    const billing = new FacilityBillingController();
    const instructor = await addMember(tenant, 'Rita', 'Instrutora', ['instructor']);

    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      await expectStatus(() => billing.read(tenant.facilityId), 403);
      await expectStatus(
        () => billing.update(tenant.facilityId, { paymentDueDay: 10, latePenaltyCents: 0 }),
        403,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Round 5 — two membership rates, and a penalty per kind of charge
// ---------------------------------------------------------------------------

/**
 * A percentage penalty is of the monthly mensalidade, by decision.
 *
 * The figure a family recognises as "what I pay a month" — and the only base
 * that stays the same sentence whether the mensalidade or the quota is late.
 */
test('a percentage penalty is worked out from the monthly mensalidade', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();

    await tenant.sql(
      `UPDATE facility
          SET payment_due_day = 8, late_penalty_kind = 'percent', late_penalty_percent = 10`,
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await fees.create(student, { feePlanId: plan, feePeriodId: mensal, startsOn: '2026-01-05' });

      const seen = await fees.list(student);
      // 35,00 € a month, ten per cent of it.
      assert.equal(seen.penalties.mensalidadeCents, 350);
      assert.equal(seen.penaltyCents, 350);
    });
  });
});

test('a late quota is a separate decision from a late mensalidade', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    const fees = new StudentFeesController();
    const plans = new FeePlansController();

    // The club fines a late quota and forgives a late mensalidade.
    await tenant.sql(
      `UPDATE facility
          SET payment_due_day = 8,
              late_penalty_kind = 'none', late_penalty_cents = 500,
              quota_penalty_kind = 'amount', quota_penalty_cents = 200`,
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const quota = (
        await plans.create(tenant.facilityId, { kind: 'quota', amountCents: 2500 })
      ).id;

      await fees.create(student, { feePlanId: plan, feePeriodId: mensal, startsOn: '2026-01-05' });
      await fees.create(student, { feePlanId: quota, feePeriodId: mensal, startsOn: '2026-01-05' });

      const seen = await fees.list(student);
      assert.equal(seen.penalties.mensalidadeCents, 0, 'switched off, however late it is');
      assert.equal(seen.penalties.quotaCents, 200);
      assert.equal(seen.penaltyCents, 200);
    });
  });
});

test('a club with two membership rates charges a child the child rate', async () => {
  await withScratchTenant(async (tenant) => {
    await priceList(tenant);
    const child = await addStudent(tenant, 'Rita', '2016-05-01');
    const adult = await addStudent(tenant, 'Sofia', '1994-05-01');
    const plans = new FeePlansController();
    const socio = new StudentSocioController();
    const fees = new StudentFeesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await plans.create(tenant.facilityId, {
        kind: 'quota',
        amountCents: 1200,
        ageBand: 'under_18',
      });
      await plans.create(tenant.facilityId, {
        kind: 'quota',
        amountCents: 2500,
        ageBand: 'adult',
      });

      await socio.update(child, { isSocio: true });
      await socio.update(adult, { isSocio: true });

      assert.equal((await fees.list(child)).lines[0]?.payableCents, 1200);
      assert.equal((await fees.list(adult)).lines[0]?.payableCents, 2500);
    });
  });
});

/**
 * The band is read from the age *today*, and a line already agreed keeps its
 * price — so adding a band to a list that already has one rate flags the members
 * it moves rather than silently re-pricing them.
 */
test('adding an age band flags the members it moves, and one click applies it', async () => {
  await withScratchTenant(async (tenant) => {
    await priceList(tenant);
    const adult = await addStudent(tenant, 'Sofia', '1994-05-01');
    const plans = new FeePlansController();
    const socio = new StudentSocioController();
    const fees = new StudentFeesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // One rate for everybody, and a member paying it.
      await plans.create(tenant.facilityId, { kind: 'quota', amountCents: 1200 });
      await socio.update(adult, { isSocio: true });

      const before = (await fees.list(adult)).lines[0]!;
      assert.equal(before.payableCents, 1200);
      assert.equal(before.bandChanged, false);

      // The club decides adults pay more.
      await plans.create(tenant.facilityId, {
        kind: 'quota',
        amountCents: 2500,
        ageBand: 'adult',
      });

      const flagged = (await fees.list(adult)).lines[0]!;
      assert.equal(flagged.payableCents, 1200, 'what was agreed does not move on its own');
      assert.equal(flagged.planAmountCentsNow, 2500, 'but the record says what applies now');
      assert.equal(flagged.bandChanged, true);

      await fees.reprice(adult, flagged.id);

      const after = (await fees.list(adult)).lines[0]!;
      assert.equal(after.payableCents, 2500);
      assert.equal(after.bandChanged, false, 'and the line is now on the right rate');
    });
  });
});

test('a membership number belongs to one student', async () => {
  await withScratchTenant(async (tenant) => {
    const first = await addStudent(tenant, 'Rita');
    const second = await addStudent(tenant, 'Sofia');
    const socio = new StudentSocioController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await socio.update(first, { isSocio: true, socioNumber: '1042' });

      // Named as a field error, so the form puts the sentence beside the box.
      let refusal: unknown;
      try {
        await socio.update(second, { isSocio: true, socioNumber: '1042' });
      } catch (error) {
        refusal = error;
      }
      assert.equal((refusal as { status?: number }).status, 400);
      assert.equal(
        ((refusal as { response?: { fields?: Record<string, string> } }).response?.fields ?? {})
          .socioNumber,
        'fees.socioNumberTaken',
      );
    });
  });
});

test('a price says which turmas it governs', async () => {
  await withScratchTenant(async (tenant) => {
    const { plan, level } = await priceList(tenant);
    const plans = new FeePlansController();

    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, facility_id, season_id, name, level_id)
       VALUES ($1, $2, $3, 'Turma A', $4) RETURNING id`,
      [tenant.organizationId, tenant.facilityId, tenant.seasonId, level],
    );
    // Two sessions a week, which is what the 2x/semana price is for.
    await tenant.sql(
      `INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time,
                                   duration_minutes)
       VALUES ($1, $2, 2, TIME '18:00', 45), ($1, $2, 4, TIME '18:00', 45)`,
      [tenant.organizationId, group!.id],
    );

    // And one that swims once a week, which the same price must not claim.
    const [once] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, facility_id, season_id, name, level_id)
       VALUES ($1, $2, $3, 'Turma B', $4) RETURNING id`,
      [tenant.organizationId, tenant.facilityId, tenant.seasonId, level],
    );
    await tenant.sql(
      `INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time,
                                   duration_minutes)
       VALUES ($1, $2, 3, TIME '18:00', 45)`,
      [tenant.organizationId, once!.id],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const listed = (await plans.list(tenant.facilityId)).plans.find((p) => p.id === plan);
      assert.deepEqual(
        listed?.classGroups.map((g) => g.name),
        ['Turma A'],
        'the price governs the turma that swims twice a week, and only that one',
      );
    });
  });
});

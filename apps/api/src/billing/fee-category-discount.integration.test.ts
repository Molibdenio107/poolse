import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FeeCategoriesController } from './categories.controller.js';
import {
  FeePeriodsController,
  FeePlansController,
  StudentFeesController,
} from './fees.controller.js';
import { ClassesController } from '../classes/classes.controller.js';
import {
  actingAs,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * A category authors the discount — round 19, against a real database.
 *
 * POOLSE-23 built the category as a label and nothing read it, so every
 * concession was typed by hand into a free-text reason: one decision, forty
 * authors. The category now carries the figure. Four claims are worth more than
 * the rest and each of them is a way this could be got wrong.
 *
 * **The figure is the category's, and the client never sends it.** A body
 * carrying its own number alongside a category would be a way to agree a
 * concession the club never offered — the same rule that keeps the plan's amount
 * out of the request.
 *
 * **It is snapshotted.** Correcting a percentage must reach every line agreed
 * afterwards and none agreed before. A line that re-read its category would
 * re-price a family the moment somebody fixed a typo — the failure
 * `amount_cents` is a snapshot to prevent, arriving by a second door.
 *
 * **One author, never two.** A category and a typed discount cannot both apply.
 * Refused rather than resolved by precedence, because a request carrying both is
 * a client that has lost track of what the operator chose.
 *
 * **An instructor sees the names and not the values.** The price list refuses
 * them outright (POOLSE-42 AC10); a concession has to give the same answer or it
 * becomes the way round it.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** Mensal at 0 %, and 35,00 € for one level at two lessons a week. */
async function priceList(tenant: ScratchTenant): Promise<{ mensal: string; plan: string }> {
  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order)
     VALUES ($1, 'Iniciação', 1) RETURNING id`,
    [tenant.organizationId],
  );

  return actingAs(tenant, { roles: ['owner'] }, async () => {
    const mensal = (
      await new FeePeriodsController().create(tenant.facilityId, {
        name: 'Mensal',
        months: 1,
        isDefault: true,
      })
    ).id;
    const plan = (
      await new FeePlansController().create(tenant.facilityId, {
        kind: 'mensalidade',
        levelId: level!.id,
        lessonsPerWeek: 2,
        amountCents: 3500,
      })
    ).id;
    return { mensal, plan };
  });
}

async function addStudent(tenant: ScratchTenant, firstName: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name)
     VALUES ($1, $2, 'Melo') RETURNING id`,
    [tenant.organizationId, firstName],
  );
  return row!.id;
}

/** A turma with this student in it, so the suggestion has something to read. */
async function enrol(
  tenant: ScratchTenant,
  studentId: string,
  name: string,
  categoryId: string | null,
): Promise<void> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3)
     RETURNING id`,
    [tenant.organizationId, tenant.facilityId, `Tanque ${name}`],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, name, pool!.id],
  );

  if (categoryId !== null) {
    // Through the turma's own update, the one write path there is for that
    // field — the same reasoning the precedence test uses.
    await new ClassesController().update(group!.id, {
      name,
      poolId: pool!.id,
      lane: '1',
      feeCategoryId: categoryId,
    });
  }

  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
     VALUES ($1, $2, $3, 'active')`,
    [tenant.organizationId, group!.id, studentId],
  );
}

test('a category authors the discount, and the client never sends the figure', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const senior = (
        await new FeeCategoriesController().create({ name: 'Sénior', discountPercent: 20 })
      ).id;

      const fees = new StudentFeesController();
      // No amount in the body. Only the name of the concession.
      await fees.create(student, { feePlanId: plan, feePeriodId: mensal, feeCategoryId: senior });

      const { lines } = await fees.list(student);
      assert.equal(lines[0]?.periodTotalCents, 3500, 'the price list is untouched');
      assert.equal(lines[0]?.payableCents, 2800, '35,00 less 20% is 28,00');
      assert.equal(lines[0]?.feeCategoryName, 'Sénior', 'and the line says which concession');
      assert.equal(
        lines[0]?.discountReason,
        null,
        'the category is the reason; a second sentence beside it would only drift',
      );
    });
  });
});

test('correcting what a category is worth leaves agreed lines where they are', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const before = await addStudent(tenant, 'Duarte');
    const after = await addStudent(tenant, 'Inês');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();
      const fees = new StudentFeesController();

      const senior = (await categories.create({ name: 'Sénior', discountPercent: 20 })).id;
      await fees.create(before, { feePlanId: plan, feePeriodId: mensal, feeCategoryId: senior });

      // The club decides the concession is 10 %, not 20 %.
      await categories.rename(senior, { name: 'Sénior', discountPercent: 10 });
      await fees.create(after, { feePlanId: plan, feePeriodId: mensal, feeCategoryId: senior });

      const first = await fees.list(before);
      const second = await fees.list(after);

      assert.equal(first.lines[0]?.payableCents, 2800, 'agreed at 20% and it stays agreed at 20%');
      assert.equal(second.lines[0]?.payableCents, 3150, 'and the next line gets the new figure');

      // Renaming still reaches everybody: the line holds the id, not the word.
      await categories.rename(senior, { name: 'Terceira idade', discountPercent: 10 });
      assert.equal((await fees.list(before)).lines[0]?.feeCategoryName, 'Terceira idade');
    });
  });
});

test('a fixed concession larger than the line floors at zero rather than paying a family', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // 50,00 € off a 35,00 € mensalidade. Not a case anybody meant — it is a
      // typo in the euros box — and the answer is zero, never a negative.
      const free = (
        await new FeeCategoriesController().create({ name: 'Isento', discountCents: 5000 })
      ).id;

      const fees = new StudentFeesController();
      await fees.create(student, { feePlanId: plan, feePeriodId: mensal, feeCategoryId: free });

      assert.equal((await fees.list(student)).lines[0]?.payableCents, 0);
    });
  });
});

test('a concession and a typed discount are never both applied', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const senior = (
        await new FeeCategoriesController().create({ name: 'Sénior', discountPercent: 20 })
      ).id;
      const fees = new StudentFeesController();

      // Refused, not silently resolved by precedence.
      await expectStatus(
        () =>
          fees.create(student, {
            feePlanId: plan,
            feePeriodId: mensal,
            feeCategoryId: senior,
            lineDiscountPercent: 50,
            discountReason: 'irmão mais novo',
          }),
        400,
      );

      // And a category nobody has is a refusal too, rather than a line quietly
      // charged in full under a concession that no longer exists.
      await expectStatus(
        () =>
          fees.create(student, {
            feePlanId: plan,
            feePeriodId: mensal,
            feeCategoryId: '00000000-0000-0000-0000-000000000000',
          }),
        400,
      );
    });
  });
});

test('a typed discount still needs a reason — the relaxed CHECK opened no hole', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fees = new StudentFeesController();
      await expectStatus(
        () =>
          fees.create(student, {
            feePlanId: plan,
            feePeriodId: mensal,
            lineDiscountPercent: 50,
          }),
        400,
      );
    });
  });
});

test('an edit moves a line onto a concession, and off it again', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const senior = (
        await new FeeCategoriesController().create({ name: 'Sénior', discountPercent: 20 })
      ).id;
      const fees = new StudentFeesController();

      await fees.create(student, { feePlanId: plan, feePeriodId: mensal });
      const id = (await fees.list(student)).lines[0]!.id;

      // Somebody is standing in front of the line saying "this family is on
      // Sénior now".
      await fees.update(student, id, { feePeriodId: mensal, feeCategoryId: senior });
      let line = (await fees.list(student)).lines[0];
      assert.equal(line?.payableCents, 2800);
      assert.equal(line?.feeCategoryName, 'Sénior');

      // And back off it, onto something negotiated. The category goes with it —
      // a line explaining itself twice, differently, is the shape to avoid.
      await fees.update(student, id, {
        feePeriodId: mensal,
        lineDiscountCents: 500,
        discountReason: 'irmão mais novo',
      });
      line = (await fees.list(student)).lines[0];
      assert.equal(line?.payableCents, 3000);
      assert.equal(line?.feeCategoryId, null);
      assert.equal(line?.discountReason, 'irmão mais novo');
    });
  });
});

test('the suggestion is the turmas’ answer, and nothing at all when they disagree', async () => {
  await withScratchTenant(async (tenant) => {
    await priceList(tenant);
    const agreed = await addStudent(tenant, 'Duarte');
    const split = await addStudent(tenant, 'Inês');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();
      const senior = (await categories.create({ name: 'Sénior', discountPercent: 20 })).id;
      const staff = (await categories.create({ name: 'Funcionário', discountPercent: 50 })).id;

      await enrol(tenant, agreed, 'Hidro A', senior);
      await enrol(tenant, agreed, 'Hidro B', senior);

      await enrol(tenant, split, 'Hidro C', senior);
      await enrol(tenant, split, 'Hidro D', staff);

      const fees = new StudentFeesController();
      assert.equal((await fees.list(agreed)).suggestedCategoryId, senior);
      assert.equal(
        (await fees.list(split)).suggestedCategoryId,
        null,
        'two answers is not an answer — a person chooses',
      );
    });
  });
});

test('an instructor reads the names of the concessions and none of the figures', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new FeeCategoriesController().create({ name: 'Sénior', discountPercent: 20 });
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const answer = await new FeeCategoriesController().list();

      assert.equal(answer.categories[0]?.name, 'Sénior', 'the label is printed beside a turma');
      assert.equal(answer.canSeeValues, false);
      assert.equal(answer.canManage, false);
      assert.equal(
        answer.categories[0]?.discountPercent,
        null,
        'what a family pays is not the instructor’s to read — AC10',
      );
    });
  });
});

test('what a concession costs is summed in SQL, over a coverage it states', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const billed = await addStudent(tenant, 'Duarte');
    const alsoBilled = await addStudent(tenant, 'Inês');
    const notYet = await addStudent(tenant, 'Rita');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();
      const senior = (await categories.create({ name: 'Sénior', discountPercent: 20 })).id;

      // Three people the concession reaches, two of them actually billed. The
      // third is the ordinary case coverage exists for: on a senior turma, no
      // fee line agreed yet.
      await enrol(tenant, billed, 'Hidro A', senior);
      await enrol(tenant, alsoBilled, 'Hidro B', senior);
      await enrol(tenant, notYet, 'Hidro C', senior);

      const fees = new StudentFeesController();
      await fees.create(billed, { feePlanId: plan, feePeriodId: mensal, feeCategoryId: senior });
      await fees.create(alsoBilled, {
        feePlanId: plan,
        feePeriodId: mensal,
        feeCategoryId: senior,
      });

      const [row] = (await categories.list()).categories;
      assert.equal(row?.students, 3, 'everybody the concession reaches');
      assert.equal(row?.chargedStudents, 2, 'and the two being billed under it');
      // 20% of 35,00 is 7,00 a month, twice.
      assert.equal(row?.forgoneMonthlyCents, 1400);
    });
  });
});

test('a concession nobody is charged under is a dash, not a zero', async () => {
  await withScratchTenant(async (tenant) => {
    const student = await addStudent(tenant, 'Duarte');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();
      const senior = (await categories.create({ name: 'Sénior', discountPercent: 20 })).id;
      await enrol(tenant, student, 'Hidro A', senior);

      const [row] = (await categories.list()).categories;
      assert.equal(row?.students, 1);
      assert.equal(row?.chargedStudents, 0);
      assert.equal(
        row?.forgoneMonthlyCents,
        null,
        'nothing charged is "not set" — a dash, never 0,00 EUR',
      );
    });
  });
});

test('a label costs zero, which is a different answer from not knowing', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();
      // A club keeping "Funcionário" to count them, worth nothing.
      const label = (await categories.create({ name: 'Funcionário' })).id;

      const fees = new StudentFeesController();
      await fees.create(student, { feePlanId: plan, feePeriodId: mensal, feeCategoryId: label });

      const [row] = (await categories.list()).categories;
      assert.equal(row?.chargedStudents, 1);
      assert.equal(row?.forgoneMonthlyCents, 0, 'a line exists and it takes nothing off');
    });
  });
});

test('the periodicity discount is not the concession, and a trimestral line is monthly-equivalent', async () => {
  await withScratchTenant(async (tenant) => {
    const student = await addStudent(tenant, 'Duarte');

    const [level] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_level (organization_id, name, sort_order)
       VALUES ($1, 'Iniciação', 1) RETURNING id`,
      [tenant.organizationId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // Trimestral at 5%: the club's own offer for paying ahead, and none of it
      // belongs to the concession.
      const trimestral = (
        await new FeePeriodsController().create(tenant.facilityId, {
          name: 'Trimestral',
          months: 3,
          discountPercent: 5,
        })
      ).id;
      const plan = (
        await new FeePlansController().create(tenant.facilityId, {
          kind: 'mensalidade',
          levelId: level!.id,
          lessonsPerWeek: 2,
          amountCents: 3500,
        })
      ).id;

      const categories = new FeeCategoriesController();
      const senior = (await categories.create({ name: 'Sénior', discountPercent: 20 })).id;

      const fees = new StudentFeesController();
      await fees.create(student, {
        feePlanId: plan,
        feePeriodId: trimestral,
        feeCategoryId: senior,
      });

      const line = (await fees.list(student)).lines[0];
      // 35,00 x 3 less 5% is 99,75; less 20% is 79,80.
      assert.equal(line?.periodTotalCents, 9975);
      assert.equal(line?.payableCents, 7980);

      /*
       * The concession accounts for 19,95 over the quarter — 6,65 a month — and
       * the club's 5,25 periodicity discount is nobody's concession. Folding the
       * two together would bill "Sénior" for the club's own offer.
       */
      const [row] = (await categories.list()).categories;
      assert.equal(row?.forgoneMonthlyCents, 665);
    });
  });
});

test('two periodicities are added as fractions and rounded once, at the end', async () => {
  await withScratchTenant(async (tenant) => {
    const monthly = await addStudent(tenant, 'Duarte');
    const quarterly = await addStudent(tenant, 'Inês');

    const [level] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_level (organization_id, name, sort_order)
       VALUES ($1, 'Iniciação', 1) RETURNING id`,
      [tenant.organizationId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const periods = new FeePeriodsController();
      const mensal = (
        await periods.create(tenant.facilityId, { name: 'Mensal', months: 1, isDefault: true })
      ).id;
      const trimestral = (
        await periods.create(tenant.facilityId, { name: 'Trimestral', months: 3 })
      ).id;

      /*
       * 33,33 € is chosen to make the division ugly.
       *
       * The quarterly line's concession is 19,99 over three months — 6,66333…
       * a month — and the monthly line's is 6,67 (round(3333 x 0.2) is 667).
       * Rounded per line first: 666 + 667 = 13,33. Added as fractions and
       * rounded once: 6,663333 + 6,666 = 13,3293… which is 1329.
       *
       * The two answers differ by a cent, and that cent is the telephone call
       * `fee_total_cents` is rounded-once to avoid. This pins the aggregate to
       * the same rule.
       */
      const plan = (
        await new FeePlansController().create(tenant.facilityId, {
          kind: 'mensalidade',
          levelId: level!.id,
          lessonsPerWeek: 2,
          amountCents: 3333,
        })
      ).id;

      const categories = new FeeCategoriesController();
      const senior = (await categories.create({ name: 'Sénior', discountPercent: 20 })).id;

      const fees = new StudentFeesController();
      await fees.create(monthly, { feePlanId: plan, feePeriodId: mensal, feeCategoryId: senior });
      await fees.create(quarterly, {
        feePlanId: plan,
        feePeriodId: trimestral,
        feeCategoryId: senior,
      });

      const lines = [
        (await fees.list(monthly)).lines[0],
        (await fees.list(quarterly)).lines[0],
      ];
      assert.equal(lines[0]?.periodTotalCents, 3333);
      assert.equal(lines[0]?.payableCents, 2666, '33,33 less 20% is 26,66');
      assert.equal(lines[1]?.periodTotalCents, 9999, '33,33 x 3, no periodicity discount');
      assert.equal(lines[1]?.payableCents, 7999, 'less 20% is 79,99');

      /*
       * (3333 - 2666) / 1 + (9999 - 7999) / 3 = 667 + 666.666… = 1333.666…,
       * which rounds to 1334. Rounding each line first would have given 1333.
       */
      const [row] = (await categories.list()).categories;
      assert.equal(row?.chargedStudents, 2);
      assert.equal(row?.forgoneMonthlyCents, 1334, 'summed as fractions, rounded once');
    });
  });
});

test('an ended line stops costing, and an instructor is told nothing about the cost', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');
    let senior = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();
      senior = (await categories.create({ name: 'Sénior', discountPercent: 20 })).id;

      const fees = new StudentFeesController();
      await fees.create(student, { feePlanId: plan, feePeriodId: mensal, feeCategoryId: senior });
      assert.equal((await categories.list()).categories[0]?.forgoneMonthlyCents, 700);

      /*
       * Ended: history, not a cost the club is still carrying.
       *
       * Today rather than a fixed past date — `student_fee_dates_ordered`
       * refuses an end before the start, and the line started today. Any
       * `ends_on` at all means ended here, which is the same definition the
       * student's own screen uses to split live lines from history.
       */
      const id = (await fees.list(student)).lines[0]!.id;
      await fees.update(student, id, {
        feePeriodId: mensal,
        feeCategoryId: senior,
        endsOn: new Date().toISOString().slice(0, 10),
      });

      const [row] = (await categories.list()).categories;
      assert.equal(row?.forgoneMonthlyCents, null, 'nothing live is charged under it any more');
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const [row] = (await new FeeCategoriesController().list()).categories;
      assert.equal(row?.name, 'Sénior');
      assert.equal(row?.forgoneMonthlyCents, null, 'what it costs is money — AC10');
      /*
       * Zero, and deliberately: this student was never in a turma, so once their
       * line ended nothing live reaches the concession. The reach is a fact
       * about today — a club that ran a senior programme two years ago is not
       * still running one, and a count that said otherwise would make every
       * retired concession look busy.
       */
      assert.equal(row?.students, 0, 'reach is live, not historical');
    });
  });
});

test('the order is dragged: a new category appends, and the list can be rewritten', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();

      /*
       * Created in one order and read back in it. The form sends no position —
       * appending is the only answer that needs no decision, and somebody who
       * wants a category third drags it there.
       */
      const senior = (await categories.create({ name: 'Sénior' })).id;
      const student = (await categories.create({ name: 'Estudante' })).id;
      const staff = (await categories.create({ name: 'Funcionário' })).id;

      const named = async (): Promise<string[]> =>
        (await categories.list()).categories.map((category) => category.name);

      assert.deepEqual(await named(), ['Sénior', 'Estudante', 'Funcionário']);

      // Dragged to the top, which is three positions at once — the reason this
      // is one call rather than a swap with a neighbour.
      await categories.reorder({ ids: [staff, senior, student] });
      assert.deepEqual(await named(), ['Funcionário', 'Sénior', 'Estudante']);

      /*
       * Editing a category does not put it back. A rename that also wrote the
       * position would undo a drag every time somebody corrected a spelling —
       * which is exactly what the typed Ordem box used to do.
       */
      await categories.rename(senior, { name: 'Terceira idade', discountPercent: 20 });
      assert.deepEqual(await named(), ['Funcionário', 'Terceira idade', 'Estudante']);

      // A category the caller left out keeps its place after the ones named,
      // rather than the whole list being refused over a stale copy.
      await categories.reorder({ ids: [student] });
      assert.equal((await named())[0], 'Estudante');
    });
  });
});

test('a stale or malformed order is refused rather than half applied', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const categories = new FeeCategoriesController();
      const senior = (await categories.create({ name: 'Sénior' })).id;

      await expectStatus(() => categories.reorder({ ids: 'senior' }), 400);
      await expectStatus(() => categories.reorder({ ids: [senior, senior] }), 400);
      await expectStatus(
        () => categories.reorder({ ids: ['00000000-0000-0000-0000-000000000000'] }),
        400,
      );
    });
  });
});

test('an instructor may read the order and not rewrite it', async () => {
  await withScratchTenant(async (tenant) => {
    let senior = '';
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      senior = (await new FeeCategoriesController().create({ name: 'Sénior' })).id;
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      // Which row is printed first says nothing about money, so reading is open.
      assert.equal((await new FeeCategoriesController().list()).categories.length, 1);
      await expectStatus(
        () => new FeeCategoriesController().reorder({ ids: [senior] }),
        403,
      );
    });
  });
});

test('a category may still be worth nothing, and that is not zero', async () => {
  await withScratchTenant(async (tenant) => {
    const { mensal, plan } = await priceList(tenant);
    const student = await addStudent(tenant, 'Duarte');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // A club keeping "Funcionário" to count them, with no concession attached.
      const label = (await new FeeCategoriesController().create({ name: 'Funcionário' })).id;

      const { categories } = await new FeeCategoriesController().list();
      assert.equal(categories[0]?.discountPercent, null);
      assert.equal(categories[0]?.discountCents, null);

      const fees = new StudentFeesController();
      await fees.create(student, { feePlanId: plan, feePeriodId: mensal, feeCategoryId: label });

      const line = (await fees.list(student)).lines[0];
      assert.equal(line?.payableCents, 3500, 'charged in full, because the label is worth nothing');
      assert.equal(line?.feeCategoryName, 'Funcionário', 'and the line still says which');
    });
  });
});

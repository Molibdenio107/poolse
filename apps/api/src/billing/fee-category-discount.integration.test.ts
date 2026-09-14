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
            manualDiscountPercent: 50,
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
            manualDiscountPercent: 50,
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
        manualDiscountCents: 500,
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

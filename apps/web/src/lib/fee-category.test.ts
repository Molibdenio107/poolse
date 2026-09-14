import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCost, isRefusal, parseCategoryDiscount } from './fee-category.ts';

/**
 * What a concession is worth, out of a typed box — round 19.
 *
 * The two columns are exclusive by CHECK and the API refuses a body that fills
 * both, so the shape this has to guarantee is that **exactly one of them is ever
 * non-null**. The rest is the pair of mistakes an operator actually makes: a
 * comma where a browser wanted a point, and a percentage typed as though it were
 * an amount.
 */

test('a label carries neither column, and neither is not zero', () => {
  assert.deepEqual(parseCategoryDiscount('none', ''), {
    discountPercent: null,
    discountCents: null,
  });

  // A value left in the box from before the kind was switched is ignored rather
  // than stored against a kind nobody chose.
  assert.deepEqual(parseCategoryDiscount('none', '20'), {
    discountPercent: null,
    discountCents: null,
  });
});

test('a percentage takes either decimal mark', () => {
  assert.deepEqual(parseCategoryDiscount('percent', '20'), {
    discountPercent: 20,
    discountCents: null,
  });
  assert.deepEqual(parseCategoryDiscount('percent', '7,5'), {
    discountPercent: 7.5,
    discountCents: null,
  });
  assert.deepEqual(parseCategoryDiscount('percent', '7.5'), {
    discountPercent: 7.5,
    discountCents: null,
  });
});

test('an empty percentage is refused rather than read as nought per cent', () => {
  // `Number('')` is 0, which would pass the range check and store a discount
  // nobody typed — on a screen it then reads identically to a label.
  const result = parseCategoryDiscount('percent', '');
  assert.ok(isRefusal(result));
  assert.equal(result.errorKey, 'categories.percentRange');
});

test('a percentage outside 0–100 is refused, and the CHECK says so too', () => {
  for (const typed of ['-5', '101', 'vinte']) {
    const result = parseCategoryDiscount('percent', typed);
    assert.ok(isRefusal(result), `${typed} should be refused`);
    assert.equal(result.errorKey, 'categories.percentRange');
  }

  // The bounds themselves are allowed. 100% is a waiver, which a club does give.
  assert.deepEqual(parseCategoryDiscount('percent', '0'), {
    discountPercent: 0,
    discountCents: null,
  });
  assert.deepEqual(parseCategoryDiscount('percent', '100'), {
    discountPercent: 100,
    discountCents: null,
  });
});

test('an amount is integer cents, through the same parser the price list uses', () => {
  assert.deepEqual(parseCategoryDiscount('amount', '7,50'), {
    discountPercent: null,
    discountCents: 750,
  });
  assert.deepEqual(parseCategoryDiscount('amount', '35'), {
    discountPercent: null,
    discountCents: 3500,
  });

  // The float trap `parseCents` exists to close: 35.35 * 100 is 3534.9999.
  assert.deepEqual(parseCategoryDiscount('amount', '35.35'), {
    discountPercent: null,
    discountCents: 3535,
  });
});

test('a euro sign is refused here exactly as it is in every other euro box', () => {
  // A field labelled in euros being strict about its own units. A cell out of
  // somebody's spreadsheet goes through `parseSheetCents` instead, which is the
  // whole reason the two are separate functions.
  for (const typed of ['35 €', '', '7,555', 'sete']) {
    const result = parseCategoryDiscount('amount', typed);
    assert.ok(isRefusal(result), `${typed} should be refused`);
    assert.equal(result.errorKey, 'categories.amountInvalid');
  }
});

test('exactly one column is ever filled', () => {
  for (const [kind, typed] of [
    ['none', ''],
    ['percent', '20'],
    ['amount', '7,50'],
  ] as const) {
    const result = parseCategoryDiscount(kind, typed);
    assert.ok(!isRefusal(result));
    assert.ok(
      result.discountPercent === null || result.discountCents === null,
      'both columns filled would be refused by fee_category_one_discount',
    );
  }
});

/**
 * What the row says about what a concession costs.
 *
 * Four answers and each is a different fact, which is exactly why this is not
 * left inside the component: "renders a dash where it should render nothing" is
 * invisible to a typecheck and there is no way to render a component here.
 */

/** A category with the shape `describeCost` reads, and nothing else. */
function category(over: Partial<Parameters<typeof describeCost>[0]> = {}) {
  return {
    students: 0,
    chargedStudents: 0,
    forgoneMonthlyCents: null,
    discountPercent: null,
    discountCents: null,
    ...over,
  };
}

test('a concession nothing reaches says nothing at all', () => {
  // Not "0 de 0": the counts beside the name already say it is unused, and a
  // retired concession must not look busy.
  assert.deepEqual(describeCost(category(), true), { kind: 'silent' });
});

test('a label is asked how many, never how much', () => {
  assert.deepEqual(describeCost(category({ students: 14, chargedStudents: 9 }), true), {
    kind: 'coverage',
    charged: 9,
    students: 14,
  });
});

test('a reader who may not see amounts gets the coverage and no figure', () => {
  // The same shape as a label, deliberately: a blank where an amount would be is
  // not a fact anybody should have to interpret.
  assert.deepEqual(
    describeCost(
      category({
        students: 14,
        chargedStudents: 9,
        discountPercent: 20,
        forgoneMonthlyCents: 1400,
      }),
      false,
    ),
    { kind: 'coverage', charged: 9, students: 14 },
  );
});

test('worth something and nobody charged yet is a dash, not a zero', () => {
  assert.deepEqual(
    describeCost(category({ students: 14, chargedStudents: 0, discountPercent: 20 }), true),
    { kind: 'unbilled', charged: 0, students: 14 },
  );
});

test('a real zero is a real answer and is not the dash', () => {
  /*
   * This is the case the two states exist to keep apart: a category worth 20%
   * that has charged nobody (unknown) against one whose lines happen to sum to
   * nothing. Only the first is "not set".
   */
  assert.deepEqual(
    describeCost(
      category({
        students: 3,
        chargedStudents: 3,
        discountPercent: 0,
        forgoneMonthlyCents: 0,
      }),
      true,
    ),
    { kind: 'cost', charged: 3, students: 3, cents: 0 },
  );
});

test('the figure never travels without the coverage it was computed over', () => {
  const cost = describeCost(
    category({
      students: 14,
      chargedStudents: 9,
      discountCents: 500,
      forgoneMonthlyCents: 4500,
    }),
    true,
  );

  assert.equal(cost.kind, 'cost');
  // financials.md section 6: an unqualified total over partial data is the same
  // shape as a complete one, and nothing on it says which.
  assert.deepEqual(cost, { kind: 'cost', charged: 9, students: 14, cents: 4500 });
});

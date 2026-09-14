import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRefusal, parseCategoryDiscount } from './fee-category.ts';

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

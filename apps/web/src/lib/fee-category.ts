import { parseCents } from './money.ts';

/**
 * What an operator typed into the concession box, as the two columns hold it.
 *
 * **One place a typed discount becomes a number**, the way `draftToBody` in
 * `lib/energy-invoice.ts` is the one place a printed "15,41 €" becomes cents.
 * The form and the API each have a rule about this — one kind or the other, a
 * percentage between 0 and 100, an amount in integer minor units — and a second
 * spelling of any of them agrees with the first until the day it does not.
 *
 * Pure, so it is tested rather than reasoned about: it lives here instead of in
 * the server action because a `'use server'` file cannot be imported by
 * `node --test` without dragging `next/cache` in with it.
 */

/** The three answers the form offers, in the order the select lists them. */
export type DiscountKind = 'none' | 'percent' | 'amount';

/** Either the two columns, or the field message to put beside the box. */
export type CategoryDiscount =
  | { discountPercent: number | null; discountCents: number | null }
  | { errorKey: 'categories.percentRange' | 'categories.amountInvalid' };

export function isRefusal(
  result: CategoryDiscount,
): result is { errorKey: 'categories.percentRange' | 'categories.amountInvalid' } {
  return 'errorKey' in result;
}

export function parseCategoryDiscount(kind: string, raw: string): CategoryDiscount {
  const text = raw.trim();

  /*
   * Neither column, which is a category that is purely a label.
   *
   * A legitimate thing to want — a club may keep "Funcionário" to count them —
   * and **not** zero: a category worth 0 % and a category worth nothing-yet read
   * identically on a screen, and only one of them is a decision somebody took.
   * Anything other than the two known kinds lands here rather than throwing: a
   * select cannot produce a third value, and if one ever arrives the safe answer
   * is the one that charges a family in full.
   */
  if (kind !== 'percent' && kind !== 'amount') {
    return { discountPercent: null, discountCents: null };
  }

  if (kind === 'percent') {
    /*
     * Either decimal mark, because a Portuguese keyboard writes 7,5 and a phone
     * writes 7.5 — the same normalisation `parseCents` does for an amount.
     *
     * `Number('')` is 0, which is why the empty string is refused *before* the
     * range check rather than being quietly accepted as a nought per cent
     * discount nobody typed.
     */
    if (text === '') return { errorKey: 'categories.percentRange' };

    const percent = Number(text.replace(',', '.'));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { errorKey: 'categories.percentRange' };
    }
    return { discountPercent: percent, discountCents: null };
  }

  /*
   * The amount goes through `parseCents`, which is what every other euro box in
   * the product uses — so "35 €" is refused here exactly as it is refused in the
   * price list. A cell out of somebody's spreadsheet has no such contract and
   * gets `parseSheetCents` instead; a field labelled in euros being strict about
   * its own units is the refusal that keeps the two apart.
   */
  const cents = parseCents(text);
  if (cents === null) return { errorKey: 'categories.amountInvalid' };
  return { discountPercent: null, discountCents: cents };
}

/**
 * What a category's row says about what it costs — the decision, without the JSX.
 *
 * Four answers, and each is a different fact. Separated from the component for
 * the reason `parseCategoryDiscount` above is: the branching is the part that can
 * be wrong, a component cannot be rendered by `node --test` in this repo, and
 * "renders a dash where it should render nothing" is not something a typecheck
 * will ever notice.
 *
 * - `silent` — nothing reaches the concession today. No sentence at all, rather
 *   than "0 de 0": the counts beside the name already say it is unused, and a
 *   retired concession should not look busy.
 * - `coverage` — how many people, and no money. A category that is only a label
 *   is not asked what it costs (printing 0,00 € beside "Sem desconto" says the
 *   same thing twice, in a way that reads as a measurement), and a reader who may
 *   not see amounts gets the same shape.
 * - `unbilled` — it is worth something and nobody has been charged under it yet.
 *   A dash, never a zero: `docs/financials.md` §9.
 * - `cost` — the figure, with the coverage it was computed over. §6 never lets
 *   the second half travel without the first.
 */
export type CategoryCost =
  | { kind: 'silent' }
  | { kind: 'coverage'; charged: number; students: number }
  | { kind: 'unbilled'; charged: number; students: number }
  | { kind: 'cost'; charged: number; students: number; cents: number };

export function describeCost(
  category: {
    students: number;
    chargedStudents: number;
    forgoneMonthlyCents: number | null;
    discountPercent: number | null;
    discountCents: number | null;
  },
  canSeeValues: boolean,
): CategoryCost {
  const { students, chargedStudents: charged } = category;

  if (students === 0 && charged === 0) return { kind: 'silent' };

  const valued = category.discountPercent !== null || category.discountCents !== null;
  if (!valued || !canSeeValues) return { kind: 'coverage', charged, students };

  // Null is "nothing charged under it", which the API says by returning no sum
  // rather than a zero. Zero itself is a real answer and falls through.
  if (category.forgoneMonthlyCents === null) return { kind: 'unbilled', charged, students };

  return { kind: 'cost', charged, students, cents: category.forgoneMonthlyCents };
}

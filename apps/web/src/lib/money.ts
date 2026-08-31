/**
 * Money on screen — POOLSE-42.
 *
 * Amounts are integer cents everywhere else in this product, for the reason
 * CLAUDE.md gives: a float cannot hold €0.10 and a register of them drifts. They
 * become a decimal exactly once, here, at the moment they are shown.
 *
 * **Formatted by the locale, never assembled.** pt-PT writes `35,00 €` and en
 * writes `€35.00` — a different separator, a different symbol, and the symbol on
 * a different side. Concatenating a symbol onto a number gets one of those right
 * and the other wrong, which is why the convention forbids it and why this takes
 * a locale rather than a currency symbol.
 */

/** The only currency Poolse deals in today. Named so the day it is not is one edit. */
export const CURRENCY = 'EUR';

export function formatCents(locale: string, cents: number): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: CURRENCY,
  }).format(cents / 100);
}

/**
 * What a period costs per month, for the line underneath the total.
 *
 * Shown alongside the period total rather than instead of it, because the two
 * answer different questions: "what will I be charged" and "is this cheaper than
 * paying monthly". Derived from the *total*, so it reflects the discount — a
 * monthly equivalent computed from the plan amount would silently omit the
 * saving that is the whole reason to offer the periodicity.
 *
 * Deliberately not rounded to a cent. It is a comparison, not a price anybody is
 * charged, and rounding it would invite somebody to multiply it back up and find
 * it does not reconcile.
 */
export function monthlyEquivalentCents(periodTotalCents: number, months: number): number {
  if (months <= 0) return periodTotalCents;
  return periodTotalCents / months;
}

/**
 * A decimal string of euros back into cents.
 *
 * For the price fields, where somebody types "35" or "35,50". Both separators
 * are accepted because a Portuguese keyboard produces the comma and a form that
 * refused it would be a form that argues with its own locale.
 *
 * Returns null for anything that is not a plain amount, so the caller can show a
 * field error rather than saving a NaN.
 */
export function parseCents(input: string): number | null {
  const text = input.trim().replace(/\s/g, '').replace(',', '.');
  if (text === '' || !/^\d+(\.\d{1,2})?$/.test(text)) return null;

  // Multiplied as a string-free decimal then rounded: 35.35 * 100 is 3534.9999
  // in binary floating point, and `Math.round` is what makes that 3535.
  return Math.round(Number(text) * 100);
}

/** Cents as a plain decimal for an input box — never for display. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

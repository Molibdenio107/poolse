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

/**
 * An amount out of a spreadsheet cell — POOLSE-59.
 *
 * **A normaliser, not a second parser.** The conversion to cents stays
 * `parseCents` above, which is what the typed forms use; this only resolves the
 * mess a spreadsheet arrives in first, so a club's own file and a typed box
 * cannot disagree about what €1.234,56 is worth.
 *
 * It is deliberately *not* folded into `parseCents`. A form field labelled in
 * euros refusing "35 €" is a form being strict about its own units, and that
 * refusal is pinned by a test; a cell in somebody else's workbook has no such
 * contract and arrives carrying whatever Excel put there.
 *
 * **The separator pair is resolved by position, not by locale.** Where both a
 * dot and a comma appear, the *last* one is the decimal mark and the other is a
 * thousands group — true of `1.234,56` and of `1,234.56` alike, which is what
 * makes a file exported under `en` importable under `pt-PT`. Where only one
 * appears and it is followed by exactly three digits, it is read as a thousands
 * group: `1.234` cannot be an amount in cents, so 1234 is the only reading that
 * is not an error.
 */
export function parseSheetCents(input: string): number | null {
  const stripped = input
    .replace(/eur/gi, '')
    .replace(/[€$£]/g, '')
    .replace(/\s/g, '')
    .trim();
  if (stripped === '') return null;

  const lastComma = stripped.lastIndexOf(',');
  const lastDot = stripped.lastIndexOf('.');

  let text = stripped;
  if (lastComma !== -1 && lastDot !== -1) {
    const thousands = lastComma > lastDot ? '.' : ',';
    text = stripped.split(thousands).join('');
  } else {
    const mark = lastComma !== -1 ? ',' : lastDot !== -1 ? '.' : null;
    if (mark !== null) {
      const parts = stripped.split(mark);
      const tail = parts[parts.length - 1] ?? '';
      // More than one of them can only be grouping; a lone one followed by three
      // digits is grouping too, because three decimals is not a price.
      if (parts.length > 2 || tail.length === 3) text = parts.join('');
    }
  }

  return parseCents(text);
}

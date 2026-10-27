/**
 * A staff member's identity document — POOLSE-100.
 *
 * The types a club records, and the one check worth making: a Portuguese
 * Cartão de Cidadão number's check digit. It lives here for the reason the NIF
 * check does — a form that accepts a number the API refuses is the failure this
 * package exists to prevent.
 */

export const ID_DOCUMENT_TYPES = ['cc', 'passport', 'residence_permit', 'other'] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

export function isIdDocumentType(value: unknown): value is IdDocumentType {
  return typeof value === 'string' && (ID_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * A CC number as it is stored and compared: no spaces or dashes, letters in
 * capitals — "12345678 9 ZZ1" and "123456789zz1" are the same card.
 */
export function normalizeCcNumber(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * The Cartão de Cidadão document number: the 8-digit civil identification
 * number, its check digit, two letters for the card's version and a final
 * check digit — 12 characters, "12345678 9 ZZ1".
 *
 * The final digit is the Luhn-style check the state publishes for the whole
 * number: reading right to left, every second value is doubled (and 9 taken off
 * when that passes 9), letters count A=10 … Z=35, and the sum is a multiple of
 * ten. Whitespace and dashes are tolerated because people copy the number the
 * way it is printed.
 */
export function isValidCcNumber(raw: string): boolean {
  const value = normalizeCcNumber(raw);
  if (!/^\d{9}[A-Z0-9]{2}\d$/.test(value)) return false;

  let sum = 0;
  let second = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const char = value[index]!;
    let digit = /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 55;
    if (second) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    second = !second;
  }
  return sum % 10 === 0;
}

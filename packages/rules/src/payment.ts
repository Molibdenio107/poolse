/**
 * Where a family pays the club — POOLSE-94.
 *
 * One definition, shared by the form and the API, for the same reason
 * `isValidNif` lives here: a form that accepts a number the API refuses is the
 * failure this package exists to prevent. The API also stores only what these
 * return, so a value is written one way.
 */

/**
 * A Portuguese IBAN, as it is stored: `PT50` and twenty-one digits, no spaces.
 *
 * Returns null for anything that is not that shape once spaces and case are put
 * aside — the caller says which of shape or checksum failed, because "this is
 * not a Portuguese IBAN" and "one digit is wrong" are different things to fix.
 */
export function normalizeIban(raw: string): string | null {
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  return /^PT50\d{21}$/.test(compact) ? compact : null;
}

/**
 * The ISO 13616 check: the first four characters moved to the end, letters as
 * 10–35, and the whole number mod 97 must be 1. Done in chunks, because the
 * number is far past what a JavaScript number holds exactly.
 */
export function ibanChecksumOk(iban: string): boolean {
  const moved = iban.slice(4) + iban.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (let index = 0; index < digits.length; index += 7) {
    remainder = Number(String(remainder) + digits.slice(index, index + 7)) % 97;
  }
  return remainder === 1;
}

/** An IBAN as a person reads it: groups of four. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * A Portuguese mobile for MB WAY, as it is stored: `+3519` and eight digits.
 *
 * Accepts it typed the ways people type it — nine digits, with `+351` or
 * `00351` in front, spaces anywhere — and returns null for anything that is not
 * a Portuguese mobile, which is the only kind MB WAY sends to.
 */
export function normalizeMbwayPhone(raw: string): string | null {
  const compact = raw.replace(/[\s.-]+/g, '');
  const national = compact.replace(/^(?:\+351|00351)/, '');
  return /^9\d{8}$/.test(national) ? `+351${national}` : null;
}

/** "+351 912 345 678" — the number as it is read aloud. */
export function formatMbwayPhone(phone: string): string {
  const national = phone.replace(/^\+351/, '');
  return `+351 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}

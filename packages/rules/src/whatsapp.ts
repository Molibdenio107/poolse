/**
 * The link that opens WhatsApp with a message ready — POOLSE-191. A person presses
 * send: Poolse has no WhatsApp account and sends nothing (Rui, 06-11-2026).
 *
 * A number with no country code is Portuguese, where every club is today: nine
 * digits, starting 2 or 9. Anything that cannot be a phone number is null, and the
 * screen says so rather than opening a conversation with nobody.
 */

/** What a link can carry reliably; the screen refuses a longer message. */
export const WHATSAPP_MAX_TEXT = 2000;

/** Digits only, country code first, or null. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (phone === null || phone === undefined) return null;
  const trimmed = phone.trim();
  if (!/^[+0-9][0-9\s().-]*$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  const international = trimmed.startsWith('+') || digits.startsWith('00');
  const number = digits.startsWith('00') ? digits.slice(2) : digits;
  if (international) return number.length >= 8 && number.length <= 15 ? number : null;
  return /^[29]\d{8}$/.test(number) ? `351${number}` : null;
}

/** The link, or null when the number is no number. */
export function whatsappUrl(phone: string | null | undefined, text: string): string | null {
  const number = whatsappNumber(phone);
  return number === null ? null : `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/**
 * The club's published phone, as it is stored — POOLSE-210: `+` and 8 to 15
 * digits, the database's CHECK. Typed the ways people type it (nine Portuguese
 * digits, `+351`, `00351`, spaces); null for anything that is not a number.
 * The same judgement as `whatsappNumber`, so a stored number always opens one.
 */
export function normalizeClubPhone(raw: string): string | null {
  const number = whatsappNumber(raw);
  return number === null ? null : `+${number}`;
}

/** "+351 212 345 678" for a Portuguese number; any other as stored. */
export function formatClubPhone(phone: string): string {
  const pt = /^\+351(\d{3})(\d{3})(\d{3})$/.exec(phone);
  return pt === null ? phone : `+351 ${pt[1]} ${pt[2]} ${pt[3]}`;
}

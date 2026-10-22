import { formatIban, formatMbwayPhone } from '@poolse/rules';
import type { PaymentDestinations } from '../billing/payment-destinations.js';

/**
 * Where to pay, as lines of plain text — POOLSE-94.
 *
 * The one rendering every email uses (the invoice reminder today), so the
 * structured methods are said one way: the transfer, then MB WAY, then the
 * reference to give, then the club's own words. The web's `PaymentDestinations`
 * component says the same things on screen, from the catalogue.
 */
const COPY = {
  'pt-PT': {
    transfer: (iban: string, holder: string) => `Transferência bancária: ${iban} (titular: ${holder})`,
    mbway: (phone: string) => `MB WAY: ${phone}`,
    reference: (reference: string) => `Indique como referência: ${reference}`,
  },
  en: {
    transfer: (iban: string, holder: string) => `Bank transfer: ${iban} (account holder: ${holder})`,
    mbway: (phone: string) => `MB WAY: ${phone}`,
    reference: (reference: string) => `Give as the reference: ${reference}`,
  },
} as const;

export function paymentMethodLines(
  destinations: PaymentDestinations,
  reference: string,
  locale: string,
): string[] {
  const copy = locale.startsWith('en') ? COPY.en : COPY['pt-PT'];
  const lines: string[] = [];
  if (destinations.iban !== null) {
    lines.push(copy.transfer(formatIban(destinations.iban), destinations.accountHolder ?? ''));
  }
  if (destinations.mbwayPhone !== null) lines.push(copy.mbway(formatMbwayPhone(destinations.mbwayPhone)));
  // A reference matters only when there is a transfer or MB WAY to give it with.
  if (lines.length > 0 && reference.trim() !== '') lines.push(copy.reference(reference));
  const words = destinations.instructions?.trim() ?? '';
  if (words !== '') lines.push(...words.split('\n'));
  return lines;
}

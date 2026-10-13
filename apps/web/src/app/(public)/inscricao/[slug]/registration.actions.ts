'use server';

import { headers } from 'next/headers';
import { postRegistration } from '@/lib/public-registration';

export interface RegistrationState {
  status: 'idle' | 'sent' | 'invalid' | 'failed';
  /** Field name to translation key, as the API named them. */
  fields?: Record<string, string>;
}

/**
 * Sends a public sign-up — POOLSE-69.
 *
 * `sent` is whatever the API accepted, which is everything shaped like a
 * sign-up: the page says "recebemos o seu pedido" whether the club exists, is
 * open, or this was the sixth send this minute, because the answer must not
 * depend on any of that. `invalid` is only ever about the boxes on this form.
 */
export async function submitRegistrationAction(
  _previous: RegistrationState,
  formData: FormData,
): Promise<RegistrationState> {
  const slug = String(formData.get('slug') ?? '');
  const text = (key: string): string => String(formData.get(key) ?? '').trim();

  const body: Record<string, unknown> = {
    swimmerFirstName: text('swimmerFirstName'),
    swimmerLastName: text('swimmerLastName'),
    swimmerBirthDate: text('swimmerBirthDate'),
    swimmerTaxNumber: text('swimmerTaxNumber'),
    guardianName: text('guardianName'),
    guardianRelationship: text('guardianRelationship'),
    guardianTaxNumber: text('guardianTaxNumber'),
    email: text('email'),
    phone: text('phone'),
    note: text('note'),
    facilityId: text('facilityId'),
    levelId: text('levelId'),
    preferredDays: formData.getAll('preferredDays').map((d) => Number(d)),
    consent: formData.get('consent') === 'on',
    locale: formData.get('locale') === 'en' ? 'en' : 'pt-PT',
    // The club's age of majority, as the form was given it: the API asks for a
    // guardian under it, so the form and conversion agree.
    majority: Number(formData.get('majority') ?? 18),
    stamp: text('stamp'),
    // The honeypot: a box no person can see, so anything in it was typed by a script.
    website: text('website'),
  };

  // The visitor's own address, first in the chain — the same reading signup makes.
  const forwarded = (await headers()).get('x-forwarded-for');
  const clientIp = forwarded?.split(',')[0]?.trim() ?? null;

  try {
    const result = await postRegistration(slug, body, clientIp);
    if (result.ok) return { status: 'sent' };
    if ('fields' in result) return { status: 'invalid', fields: result.fields };
    return { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

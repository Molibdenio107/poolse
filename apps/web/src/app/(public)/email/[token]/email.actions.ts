'use server';

import { redirect } from 'next/navigation';
import { saveEmailPreference } from '@/lib/public-email';

/**
 * The button on the opt-out page — POOLSE-86. A plain form, so it works with no
 * JavaScript from a phone's mail app; the page is then drawn again with what was
 * saved, in the same language.
 */
export async function setPreferenceAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const optedOut = formData.get('optedOut') === 'true';
  const asked = formData.get('lang');
  const lang = asked === 'en' || asked === 'pt' ? asked : null;
  let saved = false;
  try {
    saved = (await saveEmailPreference(token, optedOut)) !== null;
  } catch {
    saved = false;
  }
  const query = new URLSearchParams();
  if (lang !== null) query.set('lang', lang);
  query.set(saved ? 'saved' : 'failed', '1');
  redirect(`/email/${encodeURIComponent(token)}?${query.toString()}`);
}

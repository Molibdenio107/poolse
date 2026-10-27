'use server';

import { apiPost } from '@/lib/api';

/**
 * *Avisos neste telemóvel* — POOLSE-90 slice 4. The browser makes the
 * subscription; these hand it to the API for this person, or take it back.
 * Own device only: the API files it under the signed-in membership.
 */

export async function subscribePushAction(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  label: string;
}): Promise<{ ok: boolean }> {
  try {
    await apiPost('/push/subscriptions', subscription);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function unsubscribePushAction(endpoint: string): Promise<{ ok: boolean }> {
  try {
    await apiPost('/push/subscriptions/revoke', { endpoint });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

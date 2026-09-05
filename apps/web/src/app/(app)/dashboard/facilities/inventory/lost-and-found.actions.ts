'use server';

import { revalidatePath } from 'next/cache';
import { apiPost } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../actions';

/**
 * Lost property — round 5, ticket 6.1.
 *
 * Beside the store room's own actions rather than folded into them: an
 * inventory item is club property with a count, and a lost item is one specific
 * object belonging to somebody else. They share a screen and a vocabulary of
 * places, and nothing else.
 */

function refresh(): void {
  revalidatePath('/dashboard/facilities/inventory');
}

export async function recordFoundAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const description = String(formData.get('description') ?? '').trim();
  if (description === '') {
    return { ok: false, fields: { description: 'inventory.lostAndFound.descriptionRequired' } };
  }

  try {
    await apiPost('/inventory/lost-and-found', {
      facilityId: String(formData.get('facilityId') ?? ''),
      description,
      locationFound: String(formData.get('locationFound') ?? '').trim(),
      foundOn: String(formData.get('foundOn') ?? '').trim(),
      notes: String(formData.get('notes') ?? '').trim(),
      // Usually absent — a towel on a bench belongs to nobody until somebody
      // claims it. When present, the API stamps that the student was told.
      studentId: String(formData.get('studentId') ?? '').trim(),
    });
  } catch (error) {
    return describeFailure(error, 'inventory.lostAndFound.saveFailed');
  }

  refresh();
  return { ok: true };
}

export async function returnFoundAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const itemId = String(formData.get('itemId') ?? '');

  try {
    await apiPost(`/inventory/lost-and-found/${itemId}/return`, {});
  } catch (error) {
    return describeFailure(error, 'inventory.lostAndFound.returnFailed');
  }

  refresh();
  return { ok: true };
}

/**
 * Removing an item.
 *
 * Owner/admin, enforced by the API — G1. The control is hidden for everybody
 * else, and hiding it is never the permission.
 */
export async function removeFoundAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const itemId = String(formData.get('itemId') ?? '');

  try {
    await apiPost(`/inventory/lost-and-found/${itemId}/archive`, {});
  } catch (error) {
    return describeFailure(error, 'inventory.lostAndFound.removeFailed');
  }

  refresh();
  return { ok: true };
}

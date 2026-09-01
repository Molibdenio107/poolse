'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPatch, apiPost } from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * The store room, written to — round 6.
 *
 * Every action returns state rather than throwing, for the same reason as the
 * facility ones: "you already have a row for these" is something the person
 * fixes by correcting a count, not an error page.
 */

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    // A duplicate is its own instruction and not a generic one: the fix is to
    // correct the row that exists, not to think of another name.
    if (error.status === 409) return { ok: false, errorKey: 'inventory.duplicate' };
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

const SCOPES = new Set(['facility', 'pools', 'all_pools']);

/**
 * The scope and its pools, off the form.
 *
 * The checkboxes are only read for a `pools` scope. A form that has been
 * switched from "these tanks" to "the whole site" still has its ticks in the
 * DOM, and sending them would store a set of pools that nothing ever reads —
 * rows nobody can see, influencing nothing.
 */
function readScope(formData: FormData): { scope: string; poolIds: string[] } | null {
  const raw = String(formData.get('scope') ?? 'facility');
  const scope = SCOPES.has(raw) ? raw : 'facility';
  if (scope !== 'pools') return { scope, poolIds: [] };

  const poolIds = formData
    .getAll('poolIds')
    .map((value) => String(value))
    .filter((value) => value !== '');

  // Refused here as well as by the API, because the message the operator needs
  // is "tick a tank", not a 400.
  if (poolIds.length === 0) return null;
  return { scope, poolIds };
}

function readCount(formData: FormData): number | null {
  const quantity = Number(String(formData.get('quantity') ?? '0').trim() || '0');
  if (!Number.isInteger(quantity) || quantity < 0) return null;
  return quantity;
}

export async function addItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const facilityId = String(formData.get('facilityId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, errorKey: 'inventory.nameRequired' };

  const quantity = readCount(formData);
  if (quantity === null) return { ok: false, errorKey: 'inventory.quantityInvalid' };

  const scope = readScope(formData);
  if (scope === null) return { ok: false, errorKey: 'inventory.poolsRequired' };

  try {
    await apiPost(
      '/inventory',
      {
        facilityId,
        name,
        quantity,
        unit: String(formData.get('unit') ?? '').trim(),
        notes: String(formData.get('notes') ?? '').trim(),
        ...scope,
      },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'inventory.failed');
  }

  revalidatePath('/dashboard/facilities/inventory');
  return { ok: true };
}

/** Corrects an item — in practice its count, after somebody has been counting. */
export async function updateItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, errorKey: 'inventory.nameRequired' };

  const quantity = readCount(formData);
  if (quantity === null) return { ok: false, errorKey: 'inventory.quantityInvalid' };

  const scope = readScope(formData);
  if (scope === null) return { ok: false, errorKey: 'inventory.poolsRequired' };

  try {
    await apiPatch(
      `/inventory/${itemId}`,
      {
        name,
        quantity,
        unit: String(formData.get('unit') ?? '').trim(),
        notes: String(formData.get('notes') ?? '').trim(),
        ...scope,
      },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'inventory.failed');
  }

  revalidatePath('/dashboard/facilities/inventory');
  return { ok: true };
}

/** Archived, never deleted: the club had these once, and that is history. */
export async function archiveItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');

  try {
    await apiPost(`/inventory/${itemId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'inventory.failed');
  }

  revalidatePath('/dashboard/facilities/inventory');
  return { ok: true };
}

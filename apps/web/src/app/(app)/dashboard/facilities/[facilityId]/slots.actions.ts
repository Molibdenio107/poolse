'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiDelete, apiPatch, apiPost } from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * The slot grid, written to — POOLSE-44.
 *
 * Every action returns state rather than throwing, for the same reason as the
 * rest of this section: "that overlaps 09:30–10:15" is something the person
 * fixes by typing, not an error page.
 */

/**
 * The two refusals worth saying in words.
 *
 * The API sends machine keys and the values they concern; the sentence is
 * composed here, because the API has no locale and these have to read in the
 * operator's own language.
 */
function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.message === 'slotOverlap') {
      const details = (error.details ?? {}) as Record<string, unknown>;
      return {
        ok: false,
        errorKey: 'slots.overlap',
        detail: `${String(details['startTime'] ?? '')}–${String(details['endTime'] ?? '')}`,
      };
    }

    if (error.status === 409 && error.message === 'slotInUse') {
      const details = (error.details ?? {}) as Record<string, unknown>;
      const bookings = Array.isArray(details['bookings'])
        ? details['bookings'].filter((value): value is string => typeof value === 'string')
        : [];
      return { ok: false, errorKey: 'slots.inUse', detail: bookings.join(', ') };
    }

    // A 400 from the slot endpoints is already an instruction — "endTime cannot
    // be 00:00, write 24:00" — so it is shown rather than replaced.
    if (error.status === 400) return { ok: false, errorKey, detail: error.message };
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

function revalidate(facilityId: string): void {
  revalidatePath(`/dashboard/facilities/${facilityId}`);
  // The grid is what the schedule draws its rows from.
  revalidatePath('/dashboard/calendar');
}

/**
 * Adds one slot, or the whole of a generated grid.
 *
 * The rows arrive as JSON in a hidden field rather than as repeated form fields:
 * a generated grid is forty rows, and forty sets of three inputs is a form
 * nobody can read and a `FormData` shape that has to be reassembled by index.
 */
export async function addSlotsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const facilityId = String(formData.get('facilityId') ?? '');
  const raw = String(formData.get('slots') ?? '');

  let slots: unknown;
  try {
    slots = JSON.parse(raw);
  } catch {
    return { ok: false, errorKey: 'slots.failed' };
  }

  if (!Array.isArray(slots) || slots.length === 0) {
    return { ok: false, errorKey: 'slots.noneToAdd' };
  }

  try {
    await apiPost(`/facilities/${facilityId}/slots`, { slots }, { organizationId });
  } catch (error) {
    return failure(error, 'slots.failed');
  }

  revalidate(facilityId);
  return { ok: true };
}

export async function updateSlotAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const facilityId = String(formData.get('facilityId') ?? '');
  const slotId = String(formData.get('slotId') ?? '');

  try {
    await apiPatch(
      `/facilities/${facilityId}/slots/${slotId}`,
      {
        dayGroup: String(formData.get('dayGroup') ?? 'weekday'),
        startTime: String(formData.get('startTime') ?? '').trim(),
        endTime: String(formData.get('endTime') ?? '').trim(),
      },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'slots.failed');
  }

  revalidate(facilityId);
  return { ok: true };
}

/** Archived, never deleted: the hours come free again and the history stays. */
export async function removeSlotAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const facilityId = String(formData.get('facilityId') ?? '');
  const slotId = String(formData.get('slotId') ?? '');

  try {
    await apiDelete(`/facilities/${facilityId}/slots/${slotId}`, { organizationId });
  } catch (error) {
    return failure(error, 'slots.failed');
  }

  revalidate(facilityId);
  return { ok: true };
}

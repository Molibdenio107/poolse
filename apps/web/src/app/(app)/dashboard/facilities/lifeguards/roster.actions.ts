'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPost, type LifeguardRoster } from '@/lib/api';
import { outcome, type Outcome } from '@/lib/load-failure';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../actions';

/**
 * Nadadores-salvadores — POOLSE-70, slice 2.
 *
 * A week of one site's roster, a duty added to one day of it, and a duty taken
 * off. Nothing here judges a duty: whether the person held a valid lifeguard
 * qualification that day and whether an open hour has nobody are both answered
 * in SQL and arrive as fields, and neither refuses a save.
 */

const PAGE = '/dashboard/facilities/lifeguards';

export async function readRoster(
  facilityId: string,
  from: string,
): Promise<Outcome<LifeguardRoster>> {
  return outcome(
    apiFetch<LifeguardRoster>(
      `/facilities/${encodeURIComponent(facilityId)}/lifeguard-roster?from=${from}&days=7`,
    ),
  );
}

/**
 * One duty on one tank on one day. The tank and the day are the row the form
 * sits in, so they are bound rather than posted — a person cannot be rostered
 * on a day the form did not show them.
 */
export async function addDutyAction(
  facilityId: string,
  poolId: string,
  day: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await apiPost(`/facilities/${encodeURIComponent(facilityId)}/lifeguard-roster`, {
      poolId,
      day,
      membershipId: String(formData.get('membershipId') ?? ''),
      from: String(formData.get('from') ?? ''),
      to: String(formData.get('to') ?? ''),
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (error) {
    // The one 409 this endpoint has: the same person already on this tank at
    // an overlapping time. Said in its own words rather than as a generic clash.
    if (error instanceof ApiError && error.status === 409 && error.code === 'lifeguard_double') {
      return { ok: false, errorKey: 'roster.error.double' };
    }
    return describeFailure(error, 'roster.error.addFailed');
  }
}

/** Off the roster. Archived by the API, so last Saturday's answer survives. */
export async function removeDutyAction(dutyId: string): Promise<FormState> {
  try {
    await apiPost(`/lifeguard-duties/${encodeURIComponent(dutyId)}/archive`, {});
  } catch (error) {
    return describeFailure(error, 'roster.error.removeFailed');
  }
  revalidatePath(PAGE);
  return { ok: true };
}

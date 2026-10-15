'use server';

import { revalidatePath } from 'next/cache';
import {
  ApiError,
  apiFetch,
  apiPost,
  type Pass,
  type PersonSummary,
  type Reception,
} from '@/lib/api';
import { outcome, type Outcome } from '@/lib/load-failure';
import { formatDate } from '@/lib/date-format';
import type { FormState } from '../actions';

/**
 * Reception — POOLSE-68.
 *
 * Every refusal at the desk arrives from the database with its figures, and is
 * turned into a translation key and values here: "the tank holds 40 and 40 are
 * in the water", never "não foi possível". A refusal said in words is what the
 * ticket asks for in place of a disabled button.
 */

/** A form state that can also hand back the person it just created. */
export interface ReceptionState extends FormState {
  membershipId?: string;
}

const REFUSALS: Record<string, string> = {
  pool_full_now: 'reception.refused.poolFull',
  pass_used_up: 'reception.refused.usedUp',
  pass_expired: 'reception.refused.expired',
  pass_not_yet: 'reception.refused.notYet',
  pass_void: 'reception.refused.void',
  pass_in_water: 'reception.refused.inWater',
  pass_wrong_site: 'reception.refused.wrongSite',
  no_invoice_series: 'reception.refused.noSeries',
  person_exists: 'passes.personExists',
};

function failure(error: unknown, errorKey: string): ReceptionState {
  if (error instanceof ApiError) {
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    const known = error.code === null ? undefined : REFUSALS[error.code];
    if (known !== undefined) {
      const raw = (error.details as { values?: Record<string, unknown> } | null)?.values ?? {};
      const values: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(raw)) {
        // A date travels as a day; it is shown in the one shape every date has.
        if (key === 'date' && typeof value === 'string') values[key] = formatDate(value);
        else if (typeof value === 'number' || typeof value === 'string') values[key] = value;
      }
      return { ok: false, errorKey: known, values };
    }
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

function refresh(): void {
  revalidatePath('/dashboard/rececao');
}

export async function readReception(facilityId: string): Promise<Outcome<Reception>> {
  return outcome(apiFetch<Reception>(`/facilities/${facilityId}/reception`));
}

/**
 * Who matches what reception is typing. `null` means the search failed, which
 * the screen says — distinct from an empty list, which means nobody matched.
 */
export async function searchPeople(query: string): Promise<PersonSummary[] | null> {
  try {
    const result = await apiFetch<{ people: PersonSummary[] }>(
      `/people-search?q=${encodeURIComponent(query)}`,
    );
    return result.people;
  } catch {
    return null;
  }
}

/** One person's passes at this site. `null` means the load failed. */
export async function passesOf(facilityId: string, membershipId: string): Promise<Pass[] | null> {
  try {
    const result = await apiFetch<{ passes: Pass[] }>(
      `/facilities/${facilityId}/reception/people/${membershipId}/passes`,
    );
    return result.passes;
  } catch {
    return null;
  }
}

function field(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? '').trim();
  return value === '' ? null : value;
}

export async function sellAction(
  _previous: ReceptionState,
  formData: FormData,
): Promise<ReceptionState> {
  const facilityId = field(formData, 'facilityId') ?? '';
  const productId = field(formData, 'productId');
  if (productId === null) return { ok: false, fields: { productId: 'passes.productRequired' } };

  try {
    await apiPost(`/facilities/${facilityId}/reception/sales`, {
      productId,
      membershipId: field(formData, 'membershipId'),
      validFrom: field(formData, 'validFrom'),
      checkInPoolId: formData.get('checkIn') === 'on' ? field(formData, 'poolId') : null,
    });
  } catch (error) {
    return failure(error, 'reception.saleFailed');
  }
  refresh();
  return { ok: true };
}

export async function checkInAction(
  _previous: ReceptionState,
  formData: FormData,
): Promise<ReceptionState> {
  const facilityId = field(formData, 'facilityId') ?? '';
  const poolId = field(formData, 'poolId');
  if (poolId === null) return { ok: false, errorKey: 'passes.poolRequired' };

  try {
    await apiPost(`/facilities/${facilityId}/reception/check-ins`, {
      passId: field(formData, 'passId'),
      poolId,
    });
  } catch (error) {
    return failure(error, 'reception.checkInFailed');
  }
  refresh();
  return { ok: true };
}

export async function checkOutAction(
  _previous: ReceptionState,
  formData: FormData,
): Promise<ReceptionState> {
  const facilityId = field(formData, 'facilityId') ?? '';
  const checkInId = field(formData, 'checkInId') ?? '';
  try {
    await apiPost(`/facilities/${facilityId}/reception/check-ins/${checkInId}/check-out`, {});
  } catch (error) {
    return failure(error, 'reception.checkOutFailed');
  }
  refresh();
  return { ok: true };
}

export async function cancelCheckInAction(
  _previous: ReceptionState,
  formData: FormData,
): Promise<ReceptionState> {
  const facilityId = field(formData, 'facilityId') ?? '';
  const checkInId = field(formData, 'checkInId') ?? '';
  try {
    await apiPost(`/facilities/${facilityId}/reception/check-ins/${checkInId}/cancel`, {});
  } catch (error) {
    return failure(error, 'reception.cancelFailed');
  }
  refresh();
  return { ok: true };
}

export async function walkInAction(
  _previous: ReceptionState,
  formData: FormData,
): Promise<ReceptionState> {
  const facilityId = field(formData, 'facilityId') ?? '';
  try {
    const { membershipId } = await apiPost<{ membershipId: string }>(
      `/facilities/${facilityId}/reception/people`,
      {
        firstName: field(formData, 'firstName'),
        lastName: field(formData, 'lastName'),
        email: field(formData, 'email'),
        phone: field(formData, 'phone'),
        taxNumber: field(formData, 'taxNumber'),
      },
    );
    return { ok: true, membershipId };
  } catch (error) {
    return failure(error, 'reception.walkInFailed');
  }
}

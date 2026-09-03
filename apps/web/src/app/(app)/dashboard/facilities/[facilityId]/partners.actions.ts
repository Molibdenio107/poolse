'use server';

import { revalidatePath } from 'next/cache';
import {
  ApiError,
  apiDelete,
  apiFetch,
  apiPatch,
  apiPost,
  type PartnerList,
} from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * Parcerias — POOLSE-47.
 *
 * **The unit price crosses this boundary as a string.** Every other money path
 * in the product turns "35,50" into 3550 cents before it leaves the browser,
 * because an amount is cents. A per-hour lane price is not an amount — it is a
 * unit price, `numeric(12,6)`, and €14.375 is a real one. So the comma becomes a
 * point and nothing else happens to it: no `Number()`, no rounding, no cents.
 * The API validates the shape and hands the same string to Postgres.
 *
 * That asymmetry is the thing most likely to be "tidied up" by somebody
 * following the fee-plan pattern next door, which is why it is written here as
 * well as in the migration.
 */

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      const message = (error.details as { message?: string } | null)?.message;
      if (message === 'partnerInUse') return { ok: false, errorKey: 'partners.inUse' };
      return { ok: false, errorKey: 'partners.nameTaken' };
    }
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error.status < 500) return { ok: false, errorKey, detail: error.message };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

function refreshFacility(facilityId: string): void {
  revalidatePath(`/dashboard/facilities/${facilityId}`);
}

function refreshPartner(partnerId: string): void {
  revalidatePath(`/dashboard/facilities/partners/${partnerId}`);
}

/**
 * A facility's partners, one page.
 *
 * Null when the endpoint refuses, so the panel is simply absent rather than
 * rendered empty — the same shape `listPrices` uses next door, and for the same
 * reason: losing one block must not cost the whole site page.
 */
export async function listPartners(
  facilityId: string,
  page: number,
): Promise<PartnerList | null> {
  try {
    return await apiFetch<PartnerList>(
      `/facilities/${facilityId}/partners?page=${encodeURIComponent(String(page))}`,
    );
  } catch {
    return null;
  }
}

/** Empty means absent, which is what every optional text field on the API means. */
function text(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}

/**
 * A decimal as the form wrote it — comma or point — and nothing more.
 *
 * Portugal writes 14,375. The API wants 14.375. That is the whole conversion,
 * deliberately: turning it into a number here and back into a string later is
 * how a unit price acquires a rounding error on a round trip.
 */
function decimal(formData: FormData, field: string): string {
  return text(formData, field).replace(',', '.');
}

function partnerBody(formData: FormData): Record<string, unknown> {
  return {
    name: text(formData, 'name'),
    type: text(formData, 'type'),
    status: formData.get('status') === 'inativa' ? 'inativa' : 'ativa',
    color: text(formData, 'color') || '#67a6b6',
    nif: text(formData, 'nif') || null,
    address: text(formData, 'address') || null,
    notes: text(formData, 'notes') || null,
  };
}

export async function savePartnerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = text(formData, 'facilityId');
  const partnerId = text(formData, 'partnerId');
  const body = partnerBody(formData);

  if (body['name'] === '') return { ok: false, fields: { name: 'partners.nameRequired' } };

  try {
    if (partnerId === '') {
      await apiPost(`/facilities/${facilityId}/partners`, body);
    } else {
      await apiPatch(`/partners/${partnerId}`, body);
    }
  } catch (error) {
    return failure(error, 'partners.saveFailed');
  }

  refreshFacility(facilityId);
  if (partnerId !== '') refreshPartner(partnerId);
  return { ok: true };
}

/**
 * Archives a partner.
 *
 * Refused by the API while its groups are still booked, which comes back as
 * `partners.inUse` — a partner vanishing from the list while its cells stayed on
 * the grid would read as data loss rather than as a decision. Setting it to
 * `inativa` is the answer for a partnership that simply lapsed.
 */
export async function archivePartnerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = text(formData, 'facilityId');
  const partnerId = text(formData, 'partnerId');

  try {
    await apiDelete(`/partners/${partnerId}`);
  } catch (error) {
    return failure(error, 'partners.saveFailed');
  }

  refreshFacility(facilityId);
  return { ok: true };
}

export async function addContactAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const partnerId = text(formData, 'partnerId');

  const body = {
    name: text(formData, 'name'),
    role: text(formData, 'role') || null,
    email: text(formData, 'email') || null,
    phone: text(formData, 'phone') || null,
  };

  if (body.name === '') return { ok: false, fields: { name: 'partners.nameRequired' } };
  // Checked here as well as at the API, so the message arrives without a round
  // trip. The API still enforces it — this is convenience, never the control.
  if (body.email === null && body.phone === null) {
    return { ok: false, fields: { email: 'partners.contactReachable' } };
  }

  try {
    await apiPost(`/partners/${partnerId}/contacts`, body);
  } catch (error) {
    return failure(error, 'partners.saveFailed');
  }

  refreshPartner(partnerId);
  return { ok: true };
}

export async function removeContactAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const partnerId = text(formData, 'partnerId');
  const contactId = text(formData, 'contactId');

  try {
    await apiDelete(`/partners/contacts/${contactId}`);
  } catch (error) {
    return failure(error, 'partners.saveFailed');
  }

  refreshPartner(partnerId);
  return { ok: true };
}

/**
 * Records the agreement in force.
 *
 * A new agreement is a new row rather than an edit of the old one, so last
 * year's price survives to explain last year's invoices. The VAT box carries the
 * percentage a contract states (23); the API divides it into the fraction the
 * column holds. An empty box is **isento**, not zero — a different claim.
 */
export async function saveAgreementAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const partnerId = text(formData, 'partnerId');

  const startDate = text(formData, 'startDate');
  const unitPrice = decimal(formData, 'unitPrice');

  if (startDate === '') {
    return { ok: false, fields: { startDate: 'partners.startDateRequired' } };
  }
  if (unitPrice === '') {
    return { ok: false, fields: { unitPrice: 'partners.unitPriceRequired' } };
  }

  try {
    await apiPost(`/partners/${partnerId}/agreement`, {
      seasonId: text(formData, 'seasonId') || null,
      startDate,
      endDate: text(formData, 'endDate') || null,
      billingModel: text(formData, 'billingModel'),
      unitPrice,
      vatRate: decimal(formData, 'vatRate') || null,
      paymentPeriod: text(formData, 'paymentPeriod') || null,
      notes: text(formData, 'notes') || null,
    });
  } catch (error) {
    return failure(error, 'partners.saveFailed');
  }

  refreshPartner(partnerId);
  return { ok: true };
}

function groupBody(formData: FormData): Record<string, unknown> {
  const bringsOwnInstructor = formData.get('bringsOwnInstructor') === 'on';

  return {
    name: text(formData, 'name'),
    participantCount: Number(text(formData, 'participantCount') || '0'),
    levelId: text(formData, 'levelId') || null,
    bringsOwnInstructor,
    // Dropped rather than sent, when the flag is off: the CHECK forbids the pair
    // and the API clears it anyway, but sending it would be sending a value
    // nobody meant.
    ownInstructorName: bringsOwnInstructor ? text(formData, 'ownInstructorName') || null : null,
    tag: text(formData, 'tag') || null,
    notes: text(formData, 'notes') || null,
  };
}

export async function saveGroupAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const partnerId = text(formData, 'partnerId');
  const groupId = text(formData, 'groupId');
  const body = groupBody(formData);

  if (body['name'] === '') return { ok: false, fields: { name: 'partners.nameRequired' } };

  const count = body['participantCount'];
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    return { ok: false, fields: { participantCount: 'partners.countInvalid' } };
  }

  try {
    if (groupId === '') {
      await apiPost(`/partners/${partnerId}/groups`, body);
    } else {
      await apiPatch(`/partners/groups/${groupId}`, body);
    }
  } catch (error) {
    return failure(error, 'partners.saveFailed');
  }

  refreshPartner(partnerId);
  return { ok: true };
}

export async function archiveGroupAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const partnerId = text(formData, 'partnerId');
  const groupId = text(formData, 'groupId');

  try {
    await apiDelete(`/partners/groups/${groupId}`);
  } catch (error) {
    return failure(error, 'partners.saveFailed');
  }

  refreshPartner(partnerId);
  return { ok: true };
}

'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPatch, apiPost, type InsurancePolicy } from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * The apólices a facility holds.
 *
 * `costPerPersonCents` crosses this boundary as integer cents and nothing else,
 * like every other amount in the product: the form reads "8,50" from a box and
 * `parseCents` turns it into 850 before it gets here.
 */

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    // The field message first, whatever the status — a duplicate policy number
    // names the box that holds it, and a sentence about "saving" does not.
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    /*
     * The count travels as a value, not inside the sentence.
     *
     * "3 alunos estão cobertos por esta apólice" is one translation entry in
     * each language rather than a string built here — the same contract the
     * trigger refusals use, and the reason `FormState.values` exists.
     */
    if (error.status === 409 && error.code === 'insurance_policy_in_use') {
      const count = (error.details as { values?: { count?: number } } | null)?.values?.count;
      return {
        ok: false,
        errorKey: 'insurance.inUse',
        values: { count: typeof count === 'number' ? count : 0 },
      };
    }
    if (error.status < 500) return { ok: false, errorKey, detail: error.message };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

function refresh(facilityId: string): void {
  revalidatePath(`/dashboard/facilities/${facilityId}`);
}

export async function listPolicies(facilityId: string): Promise<InsurancePolicy[] | null> {
  try {
    const { policies } = await apiFetch<{ policies: InsurancePolicy[] }>(
      `/facilities/${facilityId}/insurance-policies`,
    );
    return policies;
  } catch {
    /*
     * Null rather than a thrown error, for the reason the price list gives: the
     * commonest cause is a 403 — an instructor opening a site they work at —
     * and what the club pays its insurer is not theirs to read. The section
     * simply is not there, and the page renders everything else.
     */
    return null;
  }
}

interface PolicyFields {
  insurer: string;
  policyNumber: string;
  validFrom: string;
  validTo: string;
  costPerPersonCents: number;
  notes: string;
}

function policyBody(formData: FormData): PolicyFields | null {
  const raw = String(formData.get('costPerPersonCents') ?? '').trim();
  const costPerPersonCents = Number(raw);
  if (!Number.isInteger(costPerPersonCents) || costPerPersonCents < 0) return null;

  return {
    insurer: String(formData.get('insurer') ?? '').trim(),
    policyNumber: String(formData.get('policyNumber') ?? '').trim(),
    validFrom: String(formData.get('validFrom') ?? '').trim(),
    validTo: String(formData.get('validTo') ?? '').trim(),
    costPerPersonCents,
    notes: String(formData.get('notes') ?? '').trim(),
  };
}

export async function savePolicyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const policyId = String(formData.get('policyId') ?? '');
  const body = policyBody(formData);

  // `parseCents` turns an unreadable amount into an empty hidden field rather
  // than a NaN, which arrives here as this.
  if (body === null) {
    return { ok: false, fields: { costPerPersonCents: 'fees.amountInvalid' } };
  }
  if (body.insurer === '') return { ok: false, fields: { insurer: 'insurance.insurerRequired' } };
  if (body.policyNumber === '') {
    return { ok: false, fields: { policyNumber: 'insurance.policyNumberRequired' } };
  }
  /*
   * The order of the dates is checked here as well as by the API and by the
   * table. Three places, and each is for a different reader: this one stops a
   * round trip, the API answers a caller that is not our screen, and the CHECK
   * is what holds when somebody writes a fourth caller.
   */
  if (body.validFrom === '') {
    return { ok: false, fields: { validFrom: 'insurance.validFromRequired' } };
  }
  if (body.validTo === '') return { ok: false, fields: { validTo: 'insurance.validToRequired' } };
  if (body.validTo < body.validFrom) {
    return { ok: false, fields: { validTo: 'insurance.datesOutOfOrder' } };
  }

  try {
    if (policyId === '') {
      await apiPost(`/facilities/${facilityId}/insurance-policies`, body);
    } else {
      await apiPatch(`/facilities/${facilityId}/insurance-policies/${policyId}`, body);
    }
  } catch (error) {
    return failure(error, 'insurance.saveFailed');
  }

  refresh(facilityId);
  return { ok: true };
}

export async function archivePolicyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const policyId = String(formData.get('policyId') ?? '');

  try {
    await apiPost(`/facilities/${facilityId}/insurance-policies/${policyId}/archive`, {});
  } catch (error) {
    return failure(error, 'insurance.saveFailed');
  }

  refresh(facilityId);
  return { ok: true };
}

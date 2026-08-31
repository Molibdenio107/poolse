'use server';

import { revalidatePath } from 'next/cache';
import {
  ApiError,
  apiFetch,
  apiPatch,
  apiPost,
  type FeePeriod,
  type FeePlan,
  type StudentFees,
} from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * What one student pays — POOLSE-42, the student half.
 *
 * Reading is a single call; the price list it is assigned from comes per
 * facility, because that is where prices live and a student enrolled at two
 * sites is choosing from two lists.
 */

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    // The API names the field for a manual discount without a reason — QA 42.9.
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error.status < 500) return { ok: false, errorKey, detail: error.message };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

function refresh(studentId: string): void {
  revalidatePath(`/dashboard/students/${studentId}`);
}

/**
 * The lines, and the price lists they can be chosen from.
 *
 * Null when the endpoint refuses — an instructor, or a family. AC10 makes that a
 * blank space on the page rather than an empty block, so the caller renders
 * nothing at all.
 */
export async function loadFees(
  studentId: string,
  facilityIds: string[],
): Promise<{
  fees: StudentFees;
  plans: Record<string, FeePlan[]>;
  periods: Record<string, FeePeriod[]>;
} | null> {
  let fees: StudentFees;
  try {
    fees = await apiFetch<StudentFees>(`/students/${studentId}/fees`);
  } catch {
    return null;
  }

  /*
   * Every site the student already has a line at, plus every site the club has.
   *
   * The union, because assigning a *new* fee needs a list the student has no
   * line at yet — and reading only the sites they already pay for would make the
   * first fee at a second pool impossible to add.
   */
  const sites = [...new Set([...facilityIds, ...fees.lines.map((line) => line.facilityId)])];

  const plans: Record<string, FeePlan[]> = {};
  const periods: Record<string, FeePeriod[]> = {};

  await Promise.all(
    sites.map(async (facilityId) => {
      try {
        const [plan, period] = await Promise.all([
          apiFetch<{ plans: FeePlan[] }>(`/facilities/${facilityId}/fee-plans`),
          apiFetch<{ periods: FeePeriod[] }>(`/facilities/${facilityId}/fee-periods`),
        ]);
        plans[facilityId] = plan.plans;
        periods[facilityId] = period.periods;
      } catch {
        // A site whose list cannot be read simply offers nothing to assign.
        plans[facilityId] = [];
        periods[facilityId] = [];
      }
    }),
  );

  return { fees, plans, periods };
}

function discountFields(formData: FormData): Record<string, unknown> {
  const kind = String(formData.get('discountKind') ?? 'none');
  const value = String(formData.get('discountValue') ?? '').trim();
  const reason = String(formData.get('discountReason') ?? '').trim();

  if (kind === 'percent' && value !== '') {
    return {
      manualDiscountPercent: Number(value.replace(',', '.')),
      discountReason: reason,
    };
  }
  if (kind === 'amount' && value !== '') {
    // Sent as cents, like every other amount crossing this boundary.
    return {
      manualDiscountCents: Math.round(Number(value.replace(',', '.')) * 100),
      discountReason: reason,
    };
  }
  return {};
}

export async function addFeeAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  const feePlanId = String(formData.get('feePlanId') ?? '');
  const feePeriodId = String(formData.get('feePeriodId') ?? '');

  if (feePlanId === '' || feePeriodId === '') {
    return { ok: false, errorKey: 'fees.planAndPeriodRequired' };
  }

  try {
    await apiPost(`/students/${studentId}/fees`, {
      feePlanId,
      feePeriodId,
      enrollmentId: String(formData.get('enrollmentId') ?? '').trim() || null,
      ...discountFields(formData),
    });
  } catch (error) {
    return failure(error, 'fees.saveFailed');
  }

  refresh(studentId);
  return { ok: true };
}

export async function updateFeeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  const feeId = String(formData.get('feeId') ?? '');
  const feePeriodId = String(formData.get('feePeriodId') ?? '');

  try {
    await apiPatch(`/students/${studentId}/fees/${feeId}`, {
      feePeriodId,
      endsOn: String(formData.get('endsOn') ?? '').trim() || null,
      ...discountFields(formData),
    });
  } catch (error) {
    return failure(error, 'fees.saveFailed');
  }

  refresh(studentId);
  return { ok: true };
}

/** AC5 — one line, by a person, never in bulk. */
export async function repriceFeeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  const feeId = String(formData.get('feeId') ?? '');

  try {
    await apiPost(`/students/${studentId}/fees/${feeId}/reprice`, {});
  } catch (error) {
    return failure(error, 'fees.saveFailed');
  }

  refresh(studentId);
  return { ok: true };
}

export async function archiveFeeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  const feeId = String(formData.get('feeId') ?? '');

  try {
    await apiPost(`/students/${studentId}/fees/${feeId}/archive`, {});
  } catch (error) {
    return failure(error, 'fees.saveFailed');
  }

  refresh(studentId);
  return { ok: true };
}

/**
 * Ticking "pago" — POOLSE-42, extended.
 *
 * Manual, and deliberately not derived from anything: there is no payment
 * provider here yet, and a flag somebody sets is honest about being a flag
 * somebody set. It says "settled", not "settled for this month" — a boolean on a
 * recurring line cannot carry a period, and the screen says so rather than
 * implying otherwise.
 */
export async function markPaidAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');
  const feeId = String(formData.get('feeId') ?? '');

  try {
    await apiPost(`/students/${studentId}/fees/${feeId}/paid`, {
      isPaid: formData.get('isPaid') === 'true',
      // Which occurrence. Without it the API cannot know whether this settles
      // September or March, which is the whole reason the flag moved off the line.
      periodStart: String(formData.get('periodStart') ?? '').trim() || null,
      paidOn: String(formData.get('paidOn') ?? '').trim() || null,
    });
  } catch (error) {
    return failure(error, 'fees.saveFailed');
  }

  refresh(studentId);
  return { ok: true };
}

export async function saveSocioAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const studentId = String(formData.get('studentId') ?? '');

  let result: { quotaAdded: boolean; quotaUnavailable: boolean };
  try {
    result = await apiPatch<{ quotaAdded: boolean; quotaUnavailable: boolean }>(
      `/students/${studentId}/socio`,
      {
        isSocio: formData.get('isSocio') === 'on',
        socioNumber: String(formData.get('socioNumber') ?? '').trim() || null,
        socioSince: String(formData.get('socioSince') ?? '').trim() || null,
      },
    );
  } catch (error) {
    return failure(error, 'fees.saveFailed');
  }

  refresh(studentId);

  /*
   * A club with no quota plan, or several sites and a student with no lines,
   * gets nothing attached. Saying so beats a toggle that appears to have done
   * something and did not.
   */
  if (result.quotaUnavailable) return { ok: true, errorKey: 'fees.quotaUnavailable' };
  return { ok: true };
}

'use server';

import { revalidatePath } from 'next/cache';
import {
  ApiError,
  apiFetch,
  apiPatch,
  apiPost,
  type BillingSettings,
  type FeeAgeBand,
  type FeePenaltyKind,
  type FeeKind,
  type FeePeriod,
  type FeePlan,
  type FeeRecurrence,
  type Season,
  type Seasons,
} from '@/lib/api';
import type { FormState } from '../../actions';

/**
 * The facility's price list — POOLSE-42.
 *
 * Amounts cross this boundary as integer cents and nothing else. The form reads
 * "35,50" from a box and `parseCents` turns it into 3550 before it gets here; a
 * decimal reaching the API would be a float in a money field, which is the one
 * thing CLAUDE.md forbids outright.
 */

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    /*
     * The field message first, whatever the status.
     *
     * A 409 used to become "esse nome já existe" before the fields were looked
     * at, which is right for a periodicity — its name is what collides — and
     * wrong for a price, where the API names the control that is taken: the
     * level, the age band or the season. With four kinds on the list there are
     * four such sentences, and all of them were arriving as the one about names.
     */
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
    if (error.status === 409) return { ok: false, errorKey: 'fees.nameTaken' };
    if (error.status < 500) return { ok: false, errorKey, detail: error.message };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

function refresh(facilityId: string): void {
  revalidatePath(`/dashboard/facilities/${facilityId}`);
}

export async function listPrices(facilityId: string): Promise<{
  plans: FeePlan[];
  periods: FeePeriod[];
  billing: BillingSettings;
  seasons: Season[];
} | null> {
  try {
    /*
     * The seasons come along because an inscrição and a seguro belong to one.
     *
     * From the club's own list rather than a facility-scoped copy: a season is
     * organization-wide and already has a screen that creates, publishes and
     * retires it. This panel picks from that list; it does not keep a second one.
     * An archived season is left out — a price list is for what the club is
     * selling, and a year that has ended cannot be priced afresh.
     */
    const [plans, periods, billing, seasons] = await Promise.all([
      apiFetch<{ plans: FeePlan[] }>(`/facilities/${facilityId}/fee-plans`),
      apiFetch<{ periods: FeePeriod[] }>(`/facilities/${facilityId}/fee-periods`),
      apiFetch<BillingSettings>(`/facilities/${facilityId}/billing`),
      apiFetch<Seasons>('/seasons'),
    ]);
    return {
      plans: plans.plans,
      periods: periods.periods,
      billing,
      seasons: seasons.seasons.filter((season) => season.status !== 'archived'),
    };
  } catch {
    /*
     * Null rather than a thrown error, because the commonest cause is a 403: an
     * instructor opening a site they work at. AC10 says they see no amounts at
     * all, so the block simply is not there for them — the endpoint refused, and
     * the page carries on rendering everything else.
     */
    return null;
  }
}

interface PeriodFields {
  name: string;
  months: number;
  discountPercent: number;
  isDefault: boolean;
  sortOrder: number;
}

function periodBody(formData: FormData): PeriodFields {
  return {
    name: String(formData.get('name') ?? '').trim(),
    months: Number(formData.get('months') ?? 0),
    discountPercent: Number(String(formData.get('discountPercent') ?? '0').replace(',', '.')),
    isDefault: formData.get('isDefault') === 'on',
    sortOrder: Number(formData.get('sortOrder') ?? 0),
  };
}

export async function savePeriodAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const periodId = String(formData.get('periodId') ?? '');
  const body = periodBody(formData);

  if (body.name === '') return { ok: false, errorKey: 'fees.nameRequired' };
  if (!Number.isInteger(body.months) || body.months < 1 || body.months > 24) {
    return { ok: false, fields: { months: 'fees.monthsRange' } };
  }

  try {
    if (periodId === '') {
      await apiPost(`/facilities/${facilityId}/fee-periods`, body);
    } else {
      await apiPatch(`/facilities/${facilityId}/fee-periods/${periodId}`, body);
    }
  } catch (error) {
    return failure(error, 'fees.saveFailed');
  }

  refresh(facilityId);
  return { ok: true };
}

export async function archivePeriodAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const periodId = String(formData.get('periodId') ?? '');

  try {
    await apiPost(`/facilities/${facilityId}/fee-periods/${periodId}/archive`, {});
  } catch (error) {
    return failure(error, 'fees.saveFailed');
  }

  refresh(facilityId);
  return { ok: true };
}

interface PlanFields {
  kind: FeeKind;
  recurrence: FeeRecurrence;
  levelId: string | null;
  lessonsPerWeek: number | null;
  amountCents: number;
  defaultFeePeriodId: string | null;
  ageBand: FeeAgeBand;
  vatRate: number;
  vatExempt: boolean;
  seasonId: string | null;
  isRenewal: boolean;
}

function planBody(formData: FormData): PlanFields | null {
  const raw = String(formData.get('amountCents') ?? '').trim();
  const amountCents = Number(raw);
  if (!Number.isInteger(amountCents) || amountCents < 0) return null;

  const level = String(formData.get('levelId') ?? '').trim();
  const period = String(formData.get('defaultFeePeriodId') ?? '').trim();
  const lessons = String(formData.get('lessonsPerWeek') ?? '').trim();

  const season = String(formData.get('seasonId') ?? '').trim();
  const rate = Number(String(formData.get('vatRate') ?? '0').replace(',', '.'));

  return {
    kind: readKind(formData.get('kind')),
    recurrence: readRecurrence(formData.get('recurrence')),
    levelId: level === '' ? null : level,
    lessonsPerWeek: lessons === '' ? null : Number(lessons),
    amountCents,
    defaultFeePeriodId: period === '' ? null : period,
    ageBand: readBand(formData.get('ageBand')),
    // The API drops the rate on an isento plan anyway. Sent as read so a club
    // that unticks isento gets the number it typed back rather than a zero.
    vatRate: Number.isFinite(rate) ? rate : 0,
    vatExempt: formData.get('vatExempt') === 'on',
    seasonId: season === '' ? null : season,
    isRenewal: formData.get('isRenewal') === 'on',
  };
}

/** Anything unexpected is a mensalidade, which is what a price list mostly is. */
function readKind(value: FormDataEntryValue | null): FeeKind {
  return value === 'quota' || value === 'inscricao' || value === 'seguro'
    ? value
    : 'mensalidade';
}

/**
 * Absent means "let the API decide from the kind".
 *
 * The default belongs there rather than here: it is one opinion — an inscrição
 * is one-off, a seguro annual — and a second copy of it in the browser is one
 * that drifts the first time somebody changes the other.
 */
function readRecurrence(value: FormDataEntryValue | null): FeeRecurrence {
  return value === 'annual' || value === 'one_off' || value === 'periodicity'
    ? value
    : 'periodicity';
}

/** Anything unexpected is the club's single rate, which is the safe reading. */
function readBand(value: FormDataEntryValue | null): FeeAgeBand {
  return value === 'under_18' || value === 'adult' ? value : 'any';
}

/** The same, for how a penalty is charged. */
function readPenaltyKind(value: FormDataEntryValue | null): FeePenaltyKind {
  return value === 'amount' || value === 'percent' ? value : 'none';
}

export async function savePlanAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const planId = String(formData.get('planId') ?? '');
  const body = planBody(formData);

  // `parseCents` on the client turns an unreadable amount into an empty hidden
  // field rather than a NaN, which arrives here as this.
  if (body === null) return { ok: false, fields: { amountCents: 'fees.amountInvalid' } };

  try {
    if (planId === '') {
      await apiPost(`/facilities/${facilityId}/fee-plans`, body);
    } else {
      await apiPatch(`/facilities/${facilityId}/fee-plans/${planId}`, body);
    }
  } catch (error) {
    return failure(error, 'fees.saveFailed');
  }

  refresh(facilityId);
  return { ok: true };
}

export async function archivePlanAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const planId = String(formData.get('planId') ?? '');

  try {
    await apiPost(`/facilities/${facilityId}/fee-plans/${planId}/archive`, {});
  } catch (error) {
    return failure(error, 'fees.saveFailed');
  }

  refresh(facilityId);
  return { ok: true };
}

/**
 * The due day and the penalty — POOLSE-42, second pass.
 *
 * Both live on the facility, so this is one small form rather than a screen of
 * its own. The penalty arrives as cents like every other amount.
 */
export async function saveBillingAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '');
  const day = Number(formData.get('paymentDueDay') ?? 0);
  const lateKind = readPenaltyKind(formData.get('latePenaltyKind'));
  const quotaKind = readPenaltyKind(formData.get('quotaPenaltyKind'));
  const raw = String(formData.get('latePenaltyCents') ?? '').trim();
  const quotaRaw = String(formData.get('quotaPenaltyCents') ?? '').trim();

  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return { ok: false, fields: { paymentDueDay: 'fees.dueDayRange' } };
  }
  /*
   * An unreadable amount arrives as an empty hidden field, per `parseCents` —
   * but only the kind actually chosen has to be readable. A club switching to a
   * percentage is not asked to fix the flat amount it stopped using.
   */
  if (lateKind === 'amount' && raw === '') {
    return { ok: false, fields: { latePenaltyCents: 'fees.amountInvalid' } };
  }
  if (quotaKind === 'amount' && quotaRaw === '') {
    return { ok: false, fields: { quotaPenaltyCents: 'fees.amountInvalid' } };
  }

  try {
    await apiPatch(`/facilities/${facilityId}/billing`, {
      paymentDueDay: day,
      latePenaltyKind: lateKind,
      latePenaltyCents: raw === '' ? 0 : Number(raw),
      latePenaltyPercent: percent(formData.get('latePenaltyPercent')),
      quotaPenaltyKind: quotaKind,
      quotaPenaltyCents: quotaRaw === '' ? 0 : Number(quotaRaw),
      quotaPenaltyPercent: percent(formData.get('quotaPenaltyPercent')),
    });
  } catch (error) {
    return failure(error, 'fees.saveFailed');
  }

  refresh(facilityId);
  return { ok: true };
}

/** A rate as the form wrote it — comma or point, empty meaning none. */
function percent(value: FormDataEntryValue | null): number {
  const parsed = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 0;
}

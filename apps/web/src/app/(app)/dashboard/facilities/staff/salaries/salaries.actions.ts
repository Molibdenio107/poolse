'use server';

import { revalidatePath } from 'next/cache';
import { getFormatter } from 'next-intl/server';
import { ApiError, apiDelete, apiFetch, apiPatch, apiPost, type StaffRateRecord } from '@/lib/api';
import { parseCents } from '@/lib/money';
import type { FormState } from '../../../actions';

/**
 * Salários — POOLSE-58.
 *
 * **No amount is ever put in a path or a query string.** Every figure travels in
 * a body, and the only thing that comes back on a refusal is a key and a pair of
 * dates. The API enforces the same rule from its side; this is the half that
 * decides what the browser's network tab shows.
 */

const PATH = '/dashboard/facilities/staff/salaries';

/**
 * The history of one person's pay, for the side sheet.
 *
 * Its own action rather than data pushed into every row of the list: a club with
 * forty staff would otherwise ship forty histories to draw one, and most of them
 * are never opened. The caller keeps `loaded` as its own state and shows what
 * went wrong — a fetch that answers `null` for both "not yet" and "it failed"
 * produces a control disabled with no explanation.
 */
export async function loadHistoryAction(
  organizationId: string,
  membershipId: string,
): Promise<
  { ok: true; history: StaffRateRecord[] } | { ok: false; errorKey: string }
> {
  try {
    const { history } = await apiFetch<{ history: StaffRateRecord[] }>(
      `/staff/${membershipId}/compensation`,
      { organizationId },
    );
    return { ok: true, history };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, errorKey: 'salaries.ownerOnly' };
    }
    return { ok: false, errorKey: 'salaries.historyFailed' };
  }
}

export async function addRateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '');

  const body = readRate(formData);
  if (!('kind' in body)) return body;

  try {
    await apiPost(`/staff/${membershipId}/compensation`, body, { organizationId });
  } catch (error) {
    return await refusal(error);
  }

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateRateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const rateId = String(formData.get('rateId') ?? '');

  const body = readRate(formData);
  if (!('kind' in body)) return body;

  const effectiveTo = String(formData.get('effectiveTo') ?? '').trim();
  if (effectiveTo !== '' && effectiveTo < body.effectiveFrom) {
    return { ok: false, fields: { effectiveTo: 'salaries.endBeforeStart' } };
  }

  try {
    await apiPatch(
      `/staff/compensation/${rateId}`,
      { ...body, effectiveTo: effectiveTo === '' ? null : effectiveTo },
      { organizationId },
    );
  } catch (error) {
    return await refusal(error);
  }

  revalidatePath(PATH);
  return { ok: true };
}

/** Archive. The word on the button is "remover"; the row is never destroyed. */
export async function archiveRateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const rateId = String(formData.get('rateId') ?? '');

  try {
    await apiDelete(`/staff/compensation/${rateId}`, { organizationId });
  } catch (error) {
    return await refusal(error);
  }

  revalidatePath(PATH);
  return { ok: true };
}

/** What the API takes. */
interface RateBody {
  kind: string;
  amountCents: number;
  weeklyHours: number | null;
  payPeriodsPerYear: number;
  effectiveFrom: string;
  note: string | null;
  provenance: string;
  amountLowCents: number | null;
  amountHighCents: number | null;
}

/**
 * What the form sends, or the fields it got wrong.
 *
 * Narrowed by `'kind' in body` at the call sites: a `FormState` has no `kind`,
 * and a body always does.
 */
function readRate(formData: FormData): RateBody | FormState {
  const kind = String(formData.get('kind') ?? 'monthly');
  if (kind !== 'monthly' && kind !== 'hourly') {
    return { ok: false, fields: { kind: 'salaries.kindRequired' } };
  }

  // The same parser the fee forms use, so "35", "35,50" and "35.50" all mean the
  // same thing. A second one here would accept a shape the price screens refuse.
  const amountCents = parseCents(String(formData.get('amount') ?? ''));
  if (amountCents === null || amountCents <= 0) {
    return { ok: false, fields: { amount: 'salaries.amountInvalid' } };
  }

  /*
   * Blank is "not measured" and is allowed — the derived figure becomes a dash.
   * Zero is refused: it is a divisor, and a contract at zero hours would make
   * somebody look free on the card.
   */
  const rawHours = String(formData.get('weeklyHours') ?? '').trim().replace(',', '.');
  let weeklyHours: number | null = null;
  if (rawHours !== '') {
    const parsed = Number.parseFloat(rawHours);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 80) {
      return { ok: false, fields: { weeklyHours: 'salaries.hoursInvalid' } };
    }
    weeklyHours = Math.round(parsed * 100) / 100;
  }

  const payPeriodsPerYear = Number(formData.get('payPeriodsPerYear') ?? 14);
  if (payPeriodsPerYear !== 12 && payPeriodsPerYear !== 14) {
    return { ok: false, fields: { payPeriodsPerYear: 'salaries.periodsInvalid' } };
  }

  const effectiveFrom = String(formData.get('effectiveFrom') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return { ok: false, fields: { effectiveFrom: 'salaries.dateRequired' } };
  }

  const note = String(formData.get('note') ?? '').trim();

  /*
   * Where the figure came from — docs/financials.md §2. Absent is `contracted`,
   * which is what a rate somebody typed into this form is.
   */
  const provenance = String(formData.get('provenance') ?? 'contracted');
  if (!['actual', 'contracted', 'estimated', 'assumed'].includes(provenance)) {
    return { ok: false, fields: { provenance: 'salaries.provenanceInvalid' } };
  }

  /*
   * The optional bounds, through the same parser as the amount itself so a form
   * and a spreadsheet cannot disagree about what €1.234,56 is worth.
   */
  const bounds: Record<string, number | null> = {};
  for (const [field, key] of [
    ['amountLow', 'amountLowCents'],
    ['amountHigh', 'amountHighCents'],
  ] as const) {
    const raw = String(formData.get(field) ?? '').trim();
    if (raw === '') {
      bounds[key] = null;
      continue;
    }
    const parsed = parseCents(raw);
    if (parsed === null) return { ok: false, fields: { [field]: 'salaries.amountInvalid' } };
    bounds[key] = parsed;
  }

  if (bounds['amountLowCents'] !== null && bounds['amountLowCents']! > amountCents) {
    return { ok: false, fields: { amountLow: 'salaries.rangeInverted' } };
  }
  if (bounds['amountHighCents'] !== null && bounds['amountHighCents']! < amountCents) {
    return { ok: false, fields: { amountHigh: 'salaries.rangeInverted' } };
  }

  return {
    kind,
    amountCents,
    weeklyHours,
    payPeriodsPerYear,
    effectiveFrom,
    note: note === '' ? null : note,
    provenance,
    amountLowCents: bounds['amountLowCents'] ?? null,
    amountHighCents: bounds['amountHighCents'] ?? null,
  };
}

/**
 * A refusal, in the form the toast and the field markers both understand.
 *
 * The overlap carries its dates as `detail` rather than inside the key, so the
 * sentence reads "Já existe um valor para estas datas — 01/09/2026 a
 * 31/10/2026" in either language. The figures come from the API, which got them
 * from the row that was in the way; nothing here re-derives them.
 */
async function refusal(error: unknown): Promise<FormState> {
  if (!(error instanceof ApiError)) return { ok: false, errorKey: 'salaries.saveFailed' };

  if (error.status === 403) {
    return {
      ok: false,
      errorKey:
        error.code === 'compensation_owner_only' ? 'salaries.ownerOnly' : 'salaries.notPermitted',
    };
  }

  if (error.status === 404) return { ok: false, errorKey: 'salaries.gone' };

  if (error.status === 409 && error.code === 'compensation_overlap') {
    const dates = error.details as { from?: string; to?: string | null } | null;
    return {
      ok: false,
      errorKey: 'salaries.overlap',
      ...(await range(dates?.from, dates?.to ?? null)),
    };
  }

  if (error.status === 400) {
    // The API names the field; the catalogue owns the sentence.
    const field = (error.details as { field?: string } | null)?.field;
    if (typeof field === 'string') {
      return { ok: false, fields: { [field === 'amountCents' ? 'amount' : field]: 'salaries.invalid' } };
    }
  }

  return { ok: false, errorKey: 'salaries.saveFailed' };
}

/** The blocking rate's dates, formatted for the reader. Omitted when unknown. */
async function range(from?: string, to?: string | null): Promise<{ detail?: string }> {
  if (from === undefined || from === '') return {};

  const format = await getFormatter();
  const day = (value: string): string => format.dateTime(new Date(`${value}T00:00:00`), 'short');

  return { detail: to === null || to === undefined ? `${day(from)} —` : `${day(from)} – ${day(to)}` };
}

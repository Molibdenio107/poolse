'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiPatch, apiPost, apiPut } from '../../../../lib/api';
import { POOL_METRICS } from '../../../../lib/pool-metrics';
import type { FormState } from '../actions';

/**
 * Every action here returns state rather than throwing, for the same reason as
 * the invitation ones: "a site with that name already exists" is something the
 * person fixes by typing, not an error page.
 */

/** Same policy as the invitation actions: see the note on `failure` there. */
function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    /*
     * The plan is full — a 402 rather than a refusal about permission.
     *
     * A subscription covers one facility; a club with two buildings buys a plan
     * with two. The message says which numbers are involved, because "you have
     * reached your limit" without saying what the limit is leaves somebody
     * counting their own sites to find out.
     */
    if (error.status === 402) {
      const details = (error.details ?? {}) as { current?: number; allowed?: number };
      return {
        ok: false,
        errorKey: 'facilities.limitReached',
        detail: `${details.current ?? 1}/${details.allowed ?? 1}`,
      };
    }
    if (error.status === 409) return { ok: false, errorKey: 'facilities.duplicate' };
    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

export async function createFacilityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, errorKey: 'facilities.nameRequired' };

  try {
    await apiPost(
      '/facilities',
      {
        name,
        address: String(formData.get('address') ?? '').trim(),
        // From PlaceField, so the weather panel works on the first page load
        // rather than after somebody remembers to set a city — round 5.
        city: String(formData.get('city') ?? '').trim(),
        countryCode: String(formData.get('countryCode') ?? '').trim(),
        latitude: String(formData.get('latitude') ?? '').trim(),
        longitude: String(formData.get('longitude') ?? '').trim(),
        timezone: String(formData.get('timezone') ?? ''),
      },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'facilities.createFailed');
  }

  revalidatePath('/dashboard/facilities');
  // Back to the list, not to a detail page: a site has no screen of its own —
  // its card in the list is where the pools and the photographs are, and adding
  // a pool is the next thing anyone does.
  redirect('/dashboard/facilities');
}

/**
 * Shrinking a pool past lanes that classes are on — POOLSE-43.
 *
 * The API refuses it and names both the lanes and the turmas. Rebuilt into a
 * sentence here rather than sent as prose from the API, because the API has no
 * locale and this message has to read in the operator's own language.
 */
function lanesInUse(error: unknown): FormState | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  if (error.message !== 'lanesInUse') return null;

  const details = error.details;
  if (details === null || typeof details !== 'object') return null;

  const named = (value: unknown): string =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').join(', ') : '';

  const record = details as Record<string, unknown>;
  return {
    ok: false,
    errorKey: 'facilities.lanesInUse',
    detail: [named(record['lanes']), named(record['groups'])].join(' — '),
  };
}
/** Every attribute, sent every time — see the note on updatePool in the API. */
function poolBody(formData: FormData): Record<string, string> {
  return {
    name: String(formData.get('name') ?? '').trim(),
    kind: String(formData.get('kind') ?? 'indoor'),
    // Empty means "not recorded". The API keeps it null rather than inventing a
    // zero, and the CHECK constraints refuse a zero anyway.
    volumeLitres: String(formData.get('volumeLitres') ?? '').trim(),
    laneCount: String(formData.get('laneCount') ?? '').trim(),
    // Empty is "no ceiling measured", and the API keeps it null — 4.2.
    maxCapacity: String(formData.get('maxCapacity') ?? '').trim(),
    lengthM: String(formData.get('lengthM') ?? '').trim(),
    widthM: String(formData.get('widthM') ?? '').trim(),
    minDepthM: String(formData.get('minDepthM') ?? '').trim(),
    maxDepthM: String(formData.get('maxDepthM') ?? '').trim(),
  };
}

export async function createPoolAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const facilityId = String(formData.get('facilityId') ?? '');
  const body = poolBody(formData);
  if (!body['name']) return { ok: false, errorKey: 'facilities.poolNameRequired' };

  let created: { id: string };
  try {
    created = await apiPost<{ id: string }>(`/facilities/${facilityId}/pools`, body, {
      organizationId,
    });
  } catch (error) {
    return lanesInUse(error) ?? failure(error, 'facilities.poolFailed');
  }

  revalidatePath('/dashboard/facilities');

  // Outside the try: redirect() signals by throwing, and catching it here would
  // turn a successful create into "could not create the pool".
  //
  // Straight to the new pool rather than back to the list, because the next
  // thing anyone wants after describing a pool is to put photographs on it.
  redirect(`/dashboard/facilities/pools/${created.id}`);
}

export async function updatePoolAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');
  const body = poolBody(formData);
  if (!body['name']) return { ok: false, errorKey: 'facilities.poolNameRequired' };

  try {
    await apiPatch(`/facilities/pools/${poolId}`, body, { organizationId });
  } catch (error) {
    return lanesInUse(error) ?? failure(error, 'facilities.poolFailed');
  }

  revalidatePath('/dashboard/facilities');
  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}

export async function archiveFacilityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const facilityId = String(formData.get('facilityId') ?? '');

  try {
    await apiPost(`/facilities/${facilityId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'facilities.archiveFailed');
  }

  revalidatePath('/dashboard/facilities');
  return { ok: true };
}

export async function archivePoolAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');

  try {
    await apiPost(`/facilities/pools/${poolId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'facilities.archiveFailed');
  }

  revalidatePath('/dashboard/facilities');
  return { ok: true };
}

/**
 * Record a water analysis — round 4.
 *
 * The values arrive as one form field per metric and are posted as an object,
 * blanks included: the API drops the empty ones, which keeps "the club only
 * tests three of these" a normal case rather than an error. Nothing here decides
 * a unit — the server looks that up from the metric, so a pH can never be stored
 * as ppm.
 */
export async function recordAnalysisAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');
  const takenAt = String(formData.get('takenAt') ?? '').trim();

  if (takenAt === '') return { ok: false, errorKey: 'facilities.analysisMomentRequired' };

  const values: Record<string, string> = {};
  for (const metric of POOL_METRICS) {
    values[metric] = String(formData.get(metric) ?? '').trim();
  }

  // Told here rather than by a 400, because "you filled in the date and nothing
  // else" is a form mistake and deserves a sentence beside the form.
  if (Object.values(values).every((value) => value === '')) {
    return { ok: false, errorKey: 'facilities.analysisEmpty' };
  }

  try {
    await apiPost(
      `/pools/${poolId}/analyses`,
      { takenAt, notes: String(formData.get('notes') ?? '').trim(), values },
      { organizationId },
    );
  } catch (error) {
    return failure(error, 'facilities.analysisFailed');
  }

  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}

/**
 * A pool's own safe ranges — slice 4.2, second half.
 *
 * **Three states per metric, and the form posts a mode rather than guessing from
 * empty boxes.** "Use the reference", "these numbers", and "do not judge this
 * metric here" are three different instructions, and two of them would look
 * identical as a pair of blank inputs. The mode is what tells them apart, and
 * an empty custom band is refused rather than quietly read as the third.
 *
 * A metric on the reference is simply left out of `ranges`, which is the API's
 * contract: what arrives is the complete set of exceptions this pool should have.
 *
 * **A decimal comma is a number**, as it is in every importer here. Somebody
 * typing 7,4 into a Portuguese interface means 7.4, and the field is a text
 * input precisely so the browser cannot refuse it silently first.
 */
export async function savePoolRangesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');

  const ranges: { metric: string; from: number | null; to: number | null }[] = [];
  const fields: Record<string, string> = {};

  for (const metric of POOL_METRICS) {
    const mode = String(formData.get(`mode-${metric}`) ?? 'reference');

    if (mode === 'reference') continue;

    if (mode === 'off') {
      ranges.push({ metric, from: null, to: null });
      continue;
    }

    const from = bound(formData.get(`min-${metric}`));
    const to = bound(formData.get(`max-${metric}`));

    // The one ambiguity the mode cannot resolve on its own: "own interval" with
    // nothing in it. Named on the minimum, because that is the first box.
    if (from === null && to === null) {
      fields[`min-${metric}`] = 'facilities.rangeNeedsABound';
      continue;
    }
    if (from === undefined) fields[`min-${metric}`] = 'facilities.rangeNotANumber';
    if (to === undefined) fields[`max-${metric}`] = 'facilities.rangeNotANumber';
    if (from === undefined || to === undefined) continue;

    // Checked here as well as by the API, so the sentence lands beside the box
    // rather than arriving as one message at the top of a nine-row form.
    if (from !== null && to !== null && to < from) {
      fields[`max-${metric}`] = 'facilities.rangeOutOfOrder';
      continue;
    }

    ranges.push({ metric, from, to });
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, errorKey: 'facilities.rangesFailed', fields };
  }

  try {
    await apiPut(`/pools/${poolId}/ranges`, { ranges }, { organizationId });
  } catch (error) {
    return failure(error, 'facilities.rangesFailed');
  }

  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}

/**
 * One end of a band: a number, null for "not judged", or undefined for "that is
 * not a number at all".
 *
 * Three outcomes rather than two, because a blank box and a typo are different
 * things to say to somebody.
 */
function bound(raw: FormDataEntryValue | null): number | null | undefined {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (text === '') return null;

  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;

  return parsed;
}

export async function archiveAnalysisAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const poolId = String(formData.get('poolId') ?? '');
  const analysisId = String(formData.get('analysisId') ?? '');

  try {
    await apiPost(`/analyses/${analysisId}/archive`, {}, { organizationId });
  } catch (error) {
    return failure(error, 'facilities.analysisFailed');
  }

  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true };
}


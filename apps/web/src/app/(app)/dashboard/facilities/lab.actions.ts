'use server';

import { revalidatePath } from 'next/cache';
import { apiPost } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import { ORGANISMS } from '@/lib/water';
import { POOL_METRICS } from '@/lib/pool-metrics';
import type { FormState } from '../actions';

const PARAMETERS = [...ORGANISMS, ...POOL_METRICS];

/**
 * Records one laboratory report — POOLSE-72. Blank boxes are parameters the lab
 * did not report and are left out: "not reported" is never sent as zero, which
 * would grade as the cleanest water on record.
 */
export async function recordLabResultAction(_p: FormState, formData: FormData): Promise<FormState> {
  const poolId = String(formData.get('poolId') ?? '');
  const sampledAt = String(formData.get('sampledAt') ?? '').trim();
  if (sampledAt === '') return { ok: false, fields: { sampledAt: 'labResults.sampledAtRequired' } };

  const values = PARAMETERS.flatMap((parameter) => {
    const raw = String(formData.get(`value-${parameter}`) ?? '').trim();
    return raw === '' ? [] : [{ parameter, value: raw.replace(',', '.') }];
  });
  if (values.length === 0) return { ok: false, errorKey: 'labResults.noValues' };

  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  try {
    await apiPost(`/facilities/pools/${poolId}/lab-results`, {
      // Sent as typed, exactly as an analysis's moment is — one parse, the API's.
      sampledAt,
      laboratory: text('laboratory'),
      reportReference: text('reportReference'),
      samplePoint: text('samplePoint'),
      sampleDepth: text('sampleDepth'),
      notes: text('notes'),
      values,
    });
  } catch (error) {
    return describeFailure(error, 'labResults.saveFailed');
  }
  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true, toastKey: 'labResults.saved' };
}

export async function archiveLabResultAction(_p: FormState, formData: FormData): Promise<FormState> {
  const poolId = String(formData.get('poolId') ?? '');
  const labResultId = String(formData.get('labResultId') ?? '');
  try {
    await apiPost(`/facilities/pools/${poolId}/lab-results/${labResultId}/archive`, {});
  } catch (error) {
    return describeFailure(error, 'labResults.archiveFailed');
  }
  revalidatePath(`/dashboard/facilities/pools/${poolId}`);
  return { ok: true, toastKey: 'labResults.archived' };
}

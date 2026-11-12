'use server';

import { revalidatePath } from 'next/cache';
import { apiPost } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../actions';

/**
 * Every energy delete from a list — Energia › Histórico and a meter's own
 * Leituras and Faturas (Rui, 12-11-2026).
 *
 * Three shapes, one action: what the filter shows (`batch`), one reading
 * (`reading`, by its moment — a reading has no id), one bill (`invoice`). The
 * API refuses anyone but Owner and Admin, and every one lands in Arquivados,
 * restorable.
 */
export async function archiveEnergyAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const what = String(formData.get('what') ?? '');
  const meterId = String(formData.get('meterId') ?? '');

  try {
    if (what === 'batch') {
      await apiPost('/energy/history/archive', {
        kind: String(formData.get('kind') ?? ''),
        meterId: meterId === '' ? null : meterId,
        month: String(formData.get('month') ?? '') || null,
      });
    } else if (what === 'reading') {
      await apiPost(`/energy/meters/${meterId}/readings/archive`, {
        takenAt: String(formData.get('takenAt') ?? ''),
      });
    } else if (what === 'invoice') {
      await apiPost(`/energy/invoices/${String(formData.get('invoiceId') ?? '')}/archive`, {});
    } else {
      return { ok: false, errorKey: 'energy.historyList.failed' };
    }
  } catch (error) {
    return describeFailure(error, 'energy.historyList.failed');
  }

  revalidatePath('/dashboard/energy');
  if (meterId !== '') revalidatePath(`/dashboard/facilities/energy/${meterId}`);
  return { ok: true };
}

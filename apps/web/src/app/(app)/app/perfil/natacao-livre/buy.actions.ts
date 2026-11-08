'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiPost } from '@/lib/api';
import { describeFailure, viewRefusal } from '@/lib/form-failure';
import type { FormState } from '@/app/(app)/dashboard/actions';

/**
 * Buy a pack on the phone — POOLSE-204. A product, who it is for and the form's
 * idempotency key; never a price. Every refusal comes back as a sentence.
 */
export async function buyPassAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const productId = String(formData.get('productId') ?? '');
  const person = String(formData.get('person') ?? 'self');
  const purchaseKey = String(formData.get('purchaseKey') ?? '');
  if (productId === '') return { ok: false, fields: { productId: 'app.passes.errors.productRequired' } };
  try {
    await apiPost('/app/passes', {
      productId,
      purchaseKey,
      ...(person === 'self' ? {} : { studentId: person }),
    });
  } catch (error) {
    const view = viewRefusal(error);
    if (view !== null) return view;
    if (error instanceof ApiError) {
      if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };
      if (error.code === 'app_pass_unpaid') {
        const values = (error.details as { values?: { documentNo?: string } } | null)?.values;
        return { ok: false, errorKey: 'app.passes.errors.unpaid', values: { documentNo: values?.documentNo ?? '' } };
      }
      if (error.code === 'minor_may_not_buy') return { ok: false, errorKey: 'app.passes.errors.minor' };
      if (error.status === 404) return { ok: false, errorKey: 'app.passes.errors.gone' };
    }
    return describeFailure(error, 'app.passes.errors.buyFailed');
  }
  revalidatePath('/app/perfil/natacao-livre');
  revalidatePath('/app/familia/pagamentos');
  return { ok: true, toastKey: 'app.passes.bought' };
}

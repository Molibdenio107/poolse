'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, apiPut, type TaxSettings } from '@/lib/api';
import { describeFailure } from '@/lib/form-failure';
import { outcome, type Outcome } from '@/lib/load-failure';
import type { FormState } from '../../actions';

/**
 * The club's own fiscal identity — POOLSE-62, second half.
 *
 * On the site's *Dados do clube* tab since 13 October 2026 (Rui's call): it is
 * defined for the club, so it sits with the club's other settings rather than
 * under Faturação. The number still belongs to the legal entity above every
 * site, which is why the tab says it applies to the whole club.
 */
export async function readTaxSettings(): Promise<Outcome<TaxSettings>> {
  return outcome(apiFetch<TaxSettings>('/settings/tax'));
}

/**
 * Save it, and with it the claim on the number.
 *
 * Blank clears it, which is a real answer — a club correcting a typo should not
 * have to write in. A number another club already holds comes back as a field
 * error saying so and nothing about whom: the same entity signing up twice and a
 * typo that happens to be somebody else's number look identical from here.
 */
export async function saveTaxNumberAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await apiPut('/settings/tax', { taxNumber: String(formData.get('taxNumber') ?? '') });
  } catch (error) {
    return describeFailure(error, 'settings.error.taxFailed');
  }

  // Every site's tab shows the same number.
  revalidatePath('/dashboard/facilities', 'layout');
  return { ok: true };
}

/** *Como pagar* — POOLSE-86. Blank clears it, and the reminder then says to contact the club. */
export async function savePaymentInstructionsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await apiPut('/settings/payment-instructions', {
      paymentInstructions: String(formData.get('paymentInstructions') ?? ''),
    });
  } catch (error) {
    return describeFailure(error, 'clubData.paymentFailed');
  }
  revalidatePath('/dashboard/facilities', 'layout');
  return { ok: true };
}

'use server';

import { revalidatePath } from 'next/cache';
import {
  ApiError,
  apiFetch,
  apiPatch,
  apiPost,
  type Invoice,
  type InvoiceRun,
  type InvoiceSeries,
  type ReminderPreview,
  type ReminderSent,
} from '@/lib/api';
import { parseCents } from '@/lib/money';
import type { FormState } from '../actions';
import { outcome, type Outcome } from '@/lib/load-failure';

/**
 * Invoicing — phase 2.2.
 *
 * **The preview and the commit are one endpoint with a flag**, so what an
 * operator was shown is what gets written. Two routes would be two queries and
 * eventually two answers, which is the failure every importer here is built to
 * avoid.
 */

const PATH = '/dashboard/faturacao';

function failure(error: unknown, errorKey: string): FormState {
  if (error instanceof ApiError) {
    if (Object.keys(error.fields).length > 0) return { ok: false, fields: error.fields };

    /*
     * The document number travels as a value, not inside the sentence — the
     * contract every refusal that needs figures uses here. "Outubro já está
     * faturado em FT A/17" is one catalogue entry per language rather than a
     * string assembled in TypeScript.
     */
    const values = (error.details as { values?: Record<string, string | number> } | null)?.values;

    if (error.status === 409 && error.code === 'invoice_already_charged') {
      return {
        ok: false,
        errorKey: 'invoices.alreadyCharged',
        values: { documentNo: values?.['documentNo'] ?? '' },
      };
    }
    if (error.status === 409 && error.code === 'invoice_already_credited') {
      return {
        ok: false,
        errorKey: 'invoices.alreadyCredited',
        values: { documentNo: values?.['documentNo'] ?? '' },
      };
    }
    if (error.status === 409 && error.code === 'invoice_series_in_use') {
      return {
        ok: false,
        errorKey: 'invoices.seriesInUse',
        values: { issued: values?.['issued'] ?? 0 },
      };
    }
    if (error.status === 409 && error.code === 'invoice_series_missing') {
      return { ok: false, errorKey: 'invoices.noSeries' };
    }
    if (error.status === 409 && error.code === 'invoice_not_payable') {
      return { ok: false, errorKey: 'invoices.notPayable' };
    }

    if (error.status < 500) return { ok: false, errorKey };
    return { ok: false, errorKey, detail: `${error.status} ${error.message}`.trim() };
  }
  return { ok: false, errorKey, detail: String(error) };
}

/** Any day in the month, or nothing. Kept as text: a `date` parsed is a day early. */
function readMonth(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return null;
}

/**
 * What a run would issue, without issuing it.
 *
 * Null for anybody the endpoint refuses — the same shape the price list uses, so
 * the page can say "this is not yours to read" rather than showing an empty
 * table that means something else entirely.
 */
export async function previewRun(
  facilityId: string,
  periodStart: string,
  studentIds?: string[],
): Promise<Outcome<InvoiceRun>> {
  return outcome(
    apiPost<InvoiceRun>(`/facilities/${facilityId}/invoices/preview`, {
      periodStart,
      ...(studentIds === undefined ? {} : { studentIds }),
    }),
  );
}

export async function listInvoices(
  facilityId: string,
  month?: string,
): Promise<Outcome<{ invoices: Invoice[] }>> {
  const query = month === undefined ? '' : `?month=${encodeURIComponent(month)}`;
  return outcome(apiFetch<{ invoices: Invoice[] }>(`/facilities/${facilityId}/invoices${query}`));
}

/**
 * Everything still owed, oldest debt first — the chase list.
 *
 * Deliberately "outstanding" and not "overdue": a club working through its
 * debtors wants the document due on Friday in front of it too, and a list that
 * appeared only once the date had passed is a list nobody can get ahead of.
 * Each row carries its own status to say which is which.
 */
export async function listOutstanding(
  facilityId: string,
): Promise<Outcome<{ invoices: Invoice[] }>> {
  return outcome(apiFetch<{ invoices: Invoice[] }>(`/facilities/${facilityId}/invoices?outstanding=1`));
}

export async function readInvoice(facilityId: string, id: string): Promise<Outcome<Invoice>> {
  return outcome(apiFetch<Invoice>(`/facilities/${facilityId}/invoices/${id}`));
}

/**
 * Issue the run.
 *
 * `payerKeys` is what an operator selected in the preview, so a club can bill
 * one family now and the rest on Friday. Absent means every draft the preview
 * showed.
 */
export async function issueRunAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '').trim();
  const periodStart = readMonth(formData.get('periodStart'));
  const payerKeys = formData.getAll('payerKeys').map(String).filter((key) => key !== '');

  if (periodStart === null) {
    return { ok: false, fields: { periodStart: 'invoices.monthRequired' } };
  }

  try {
    await apiPost(`/facilities/${facilityId}/invoices`, {
      periodStart,
      ...(payerKeys.length === 0 ? {} : { payerKeys }),
    });
  } catch (error) {
    return failure(error, 'invoices.issueFailed');
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Correct a document.
 *
 * The only correction there is: nothing edits or deletes an issued document,
 * and the application holds no privilege to do either. After this the periods it
 * covered are billable again, so a corrected invoice is issued by running the
 * month afresh.
 */
export async function creditInvoiceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '').trim();
  const id = String(formData.get('invoiceId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  try {
    await apiPost(`/facilities/${facilityId}/invoices/${id}/credit-note`, { reason });
  } catch (error) {
    return failure(error, 'invoices.creditFailed');
  }

  revalidatePath(PATH);
  revalidatePath(`${PATH}/${id}`);
  return { ok: true };
}

/**
 * Money arriving against a document.
 *
 * The amount is typed in euros and parsed to cents here, because that is where
 * the form is. `parseCents` is the one parser — a second one would accept a
 * comma in one box and refuse it in the next.
 */
export async function recordPaymentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '').trim();
  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  const amountCents = parseCents(String(formData.get('amount') ?? ''));

  if (amountCents === null || amountCents <= 0) {
    return { ok: false, fields: { amount: 'invoices.amountRequired' } };
  }

  try {
    await apiPost(`/facilities/${facilityId}/invoices/${invoiceId}/payments`, {
      amountCents,
      paidOn: String(formData.get('paidOn') ?? '').trim(),
      source: String(formData.get('source') ?? 'manual'),
      reference: String(formData.get('reference') ?? '').trim(),
      notes: String(formData.get('notes') ?? '').trim(),
    });
  } catch (error) {
    return failure(error, 'invoices.paymentFailed');
  }

  revalidatePath(`${PATH}/${invoiceId}`);
  revalidatePath(PATH);
  return { ok: true };
}

export async function archivePaymentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '').trim();
  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  const paymentId = String(formData.get('paymentId') ?? '').trim();

  try {
    await apiPost(
      `/facilities/${facilityId}/invoices/${invoiceId}/payments/${paymentId}/archive`,
      {},
    );
  } catch (error) {
    return failure(error, 'invoices.paymentFailed');
  }

  revalidatePath(`${PATH}/${invoiceId}`);
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * A record of the club having asked.
 *
 * Not a message Poolse sends — the notification subsystem is a later phase. This
 * records that a person telephoned, wrote or spoke to a family, which is what
 * makes a second chase a different conversation from the first.
 */
export async function recordChaseAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '').trim();
  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  const channel = String(formData.get('channel') ?? '').trim();

  if (channel === '') return { ok: false, fields: { channel: 'invoices.channelRequired' } };

  try {
    await apiPost(`/facilities/${facilityId}/invoices/${invoiceId}/chases`, {
      channel,
      chasedOn: String(formData.get('chasedOn') ?? '').trim(),
      note: String(formData.get('note') ?? '').trim(),
    });
  } catch (error) {
    return failure(error, 'invoices.chaseFailed');
  }

  revalidatePath(`${PATH}/${invoiceId}`);
  revalidatePath(PATH);
  return { ok: true };
}

export async function saveSeriesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '').trim();
  const id = String(formData.get('seriesId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const prefix = String(formData.get('prefix') ?? '')
    .trim()
    .toUpperCase();

  // Checked here as well, so an empty name does not cost a round trip to be
  // told the obvious.
  if (name === '') return { ok: false, fields: { name: 'invoices.nameRequired' } };
  if (!/^[A-Z0-9]{1,10}$/.test(prefix)) {
    return { ok: false, fields: { prefix: 'invoices.prefixInvalid' } };
  }

  try {
    await apiPatch(`/facilities/${facilityId}/invoice-series/${id}`, { name, prefix });
  } catch (error) {
    return failure(error, 'invoices.saveFailed');
  }

  revalidatePath(PATH);
  return { ok: true };
}

export async function listSeries(
  facilityId: string,
): Promise<Outcome<{ series: InvoiceSeries[] }>> {
  return outcome(apiFetch<{ series: InvoiceSeries[] }>(`/facilities/${facilityId}/invoice-series`));
}

// The club's NIPC and logo moved to the site's *Dados do clube* tab
// (facilities/[facilityId]/club.actions.ts) — Rui, 13 October 2026.

/**
 * Invoice reminders by email — POOLSE-86, 3.0b. The preview is asked for by the
 * dialog when it opens; the send is the dialog's form. One API path with a
 * `commit` flag, so what the person was shown and what was written agree.
 */
export async function previewRemindersAction(
  facilityId: string,
  invoiceIds: string[],
): Promise<{ ok: true; preview: ReminderPreview } | { ok: false; errorKey: string }> {
  try {
    const preview = await apiPost<ReminderPreview>(`/facilities/${facilityId}/invoices/reminders`, { invoiceIds });
    return { ok: true, preview };
  } catch {
    return { ok: false, errorKey: 'invoices.reminders.previewFailed' };
  }
}

export async function sendRemindersAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '').trim();
  const read = (field: string): string[] => {
    try {
      const value: unknown = JSON.parse(String(formData.get(field) ?? '[]'));
      return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
    } catch {
      return [];
    }
  };
  const payerKeys = read('payerKeys');
  if (payerKeys.length === 0) return { ok: false, errorKey: 'invoices.reminders.nobodyChosen' };

  let sent: ReminderSent;
  try {
    sent = await apiPost<ReminderSent>(`/facilities/${facilityId}/invoices/reminders`, {
      invoiceIds: read('invoiceIds'),
      payerKeys,
      commit: true,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'email_quota') {
      // The trigger's figures, carried as structure rather than prose.
      const raw = (error.details as { values?: Record<string, unknown> } | null)?.values ?? {};
      const values: Record<string, number> = {};
      for (const [name, value] of Object.entries(raw)) if (typeof value === 'number') values[name] = value;
      return { ok: false, errorKey: 'invoices.reminders.quota', values };
    }
    return failure(error, 'invoices.reminders.sendFailed');
  }

  // Nothing written — every chosen payer stopped being overdue, or has no address
  // (sweep 19-10b): a refusal, never "0 lembretes enviados".
  if (sent.reminderIds.length === 0) return { ok: false, errorKey: 'invoices.reminders.nothingSent' };

  revalidatePath(PATH);
  return {
    ok: true,
    // Said as what happened: written and on their way, or written and not sent.
    toastKey: sent.emailConfigured ? 'invoices.reminders.sentToast' : 'invoices.reminders.recordedToast',
    values: { count: sent.reminderIds.length },
  };
}

'use server';

import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, apiPost, type EnergyInvoiceCheck, type EnergyInvoiceDetail, type EnergyInvoiceList } from '@/lib/api';
import { draftToBody, reportMediaType, type InvoiceDraft } from '@/lib/energy-invoice';
import { energyInvoiceParser } from '@/lib/energy-invoice-agent';
import { describeFailure } from '@/lib/form-failure';
import type { FormState } from '../../actions';

/**
 * Faturas — slice 5.3. Two ways in, one pipeline.
 *
 * `readInvoiceFileAction` turns a PDF into a draft and nothing else: the draft
 * lands on the same form a person fills in. `previewInvoiceAction` and
 * `commitInvoiceAction` send that form to the one API route, with and without
 * the flag. Nothing here decides whether a bill is right — the API does, once,
 * for both.
 */

export interface InvoiceReadState {
  ok: boolean;
  draft?: InvoiceDraft;
  fileName?: string;
  errorKey?: string;
  /** The parser is off for this club — a sentence, not a failure. */
  disabled?: boolean;
  attempt: number;
}

export async function readInvoiceFileAction(
  previous: InvoiceReadState,
  formData: FormData,
): Promise<InvoiceReadState> {
  const attempt = previous.attempt + 1;
  const upload = formData.get('file');
  const file = upload instanceof File ? upload : null;
  const mediaType = file === null ? null : reportMediaType(file.name);

  if (file === null || mediaType === null) {
    return { ok: false, errorKey: 'energy.invoice.chooseAFile', attempt };
  }

  const parser = energyInvoiceParser();
  if (!parser.available()) return { ok: false, disabled: true, fileName: file.name, attempt };

  // The bytes go to the model call and no further: nothing is stored. File
  // storage is the deferred decision the photo controls also wait on.
  const result = await parser.parse({
    name: file.name,
    mediaType,
    bytes: Buffer.from(await file.arrayBuffer()),
  });

  if ('error' in result) {
    if (result.error === 'disabled') return { ok: false, disabled: true, fileName: file.name, attempt };
    return {
      ok: false,
      errorKey: result.error === 'nothingFound' ? 'energy.invoice.nothingFound' : 'energy.invoice.unreadable',
      fileName: file.name,
      attempt,
    };
  }

  return { ok: true, draft: result.draft, fileName: file.name, attempt };
}

export interface InvoicePreviewState extends FormState {
  check?: EnergyInvoiceCheck;
  /** Set once a commit succeeded, so the form can navigate. */
  invoiceId?: string;
  /** The meter the bill landed on — which the commit may have just created. */
  meterId?: string;
  attempt: number;
}

/** The draft, as the form posted it — one JSON field, because a bill is not flat. */
function draftOf(formData: FormData): InvoiceDraft | null {
  const raw = formData.get('draft');
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as InvoiceDraft;
  } catch {
    return null;
  }
}

async function send(
  previous: InvoicePreviewState,
  formData: FormData,
  commit: boolean,
): Promise<InvoicePreviewState> {
  const attempt = previous.attempt + 1;
  let meterId = String(formData.get('meterId') ?? '');
  const facilityId = String(formData.get('facilityId') ?? '');
  const newMeterFacilityId = String(formData.get('newMeterFacilityId') ?? '');
  const source = formData.get('source') === 'import' ? 'import' : 'manual';
  const sourceFileName = String(formData.get('sourceFileName') ?? '') || null;

  const draft = draftOf(formData);
  if (draft === null) return { ok: false, errorKey: 'energy.invoice.saveFailed', attempt };

  const { body, fields } = draftToBody(draft, { source, sourceFileName, commit });
  if (Object.keys(fields).length > 0) return { ok: false, fields, attempt };

  /*
   * The first bill of a new supply: no meter carries its CPE, so the bill
   * makes one — "Geral" at the chosen site, a dial, with the bill's CPE and
   * serial. Only on commit; a preview creates nothing. A name already taken at
   * that site falls back to the CPE's tail, because two supplies at one site
   * are both "the general meter" to the person typing.
   */
  if (commit && meterId === '' && newMeterFacilityId !== '') {
    const cpe = String(body['cpe'] ?? '');
    const meter = {
      kind: 'total',
      reads: 'cumulative_index',
      unit: 'kWh',
      cpe,
      serial: body['meterSerial'] ?? '',
    };
    try {
      meterId = (await apiPost<{ id: string }>(`/energy/facilities/${newMeterFacilityId}/meters`, { ...meter, name: 'Geral' })).id;
    } catch (error) {
      if (!(error instanceof ApiError && error.fields['name'] !== undefined)) {
        return { ...describeFailure(error, 'energy.invoice.saveFailed'), attempt };
      }
      try {
        meterId = (await apiPost<{ id: string }>(`/energy/facilities/${newMeterFacilityId}/meters`, {
          ...meter,
          name: `Geral ${cpe.slice(-6)}`,
        })).id;
      } catch (again) {
        return { ...describeFailure(again, 'energy.invoice.saveFailed'), attempt };
      }
    }
    revalidatePath('/dashboard/energy');
    revalidatePath(`/dashboard/facilities/${newMeterFacilityId}`);
  }
  if (meterId === '') return { ok: false, errorKey: 'energy.invoice.chooseMeterFirst', attempt };

  try {
    const response = await apiPost<EnergyInvoiceCheck | { id: string }>(`/energy/meters/${meterId}/invoices`, body);
    if ('id' in response) {
      revalidatePath('/dashboard/energy');
      revalidatePath(`/dashboard/facilities/${facilityId}`);
      revalidatePath(`/dashboard/facilities/energy/${meterId}`);
      revalidatePath('/dashboard');
      return { ok: true, invoiceId: response.id, meterId, attempt };
    }
    // A preview: not a save, so `ok` stays false and no toast is raised; the
    // check is what the form renders.
    return { ok: false, check: response, attempt };
  } catch (error) {
    // The commit's 422 carries the same field keys the preview would have.
    if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
      return { ok: false, fields: error.fields, attempt };
    }
    return { ...describeFailure(error, 'energy.invoice.saveFailed'), attempt };
  }
}

export async function previewInvoiceAction(previous: InvoicePreviewState, formData: FormData): Promise<InvoicePreviewState> {
  return send(previous, formData, false);
}

export async function commitInvoiceAction(previous: InvoicePreviewState, formData: FormData): Promise<InvoicePreviewState> {
  return send(previous, formData, true);
}

export async function listInvoices(meterId: string): Promise<EnergyInvoiceList | null> {
  return apiFetch<EnergyInvoiceList>(`/energy/meters/${meterId}/invoices`).catch(() => null);
}

export async function getInvoice(invoiceId: string): Promise<{ invoice: EnergyInvoiceDetail; canArchive: boolean } | null> {
  return apiFetch<{ invoice: EnergyInvoiceDetail; canArchive: boolean }>(`/energy/invoices/${invoiceId}`).catch(() => null);
}

export async function archiveInvoiceAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const invoiceId = String(formData.get('invoiceId') ?? '');
  const meterId = String(formData.get('meterId') ?? '');
  const facilityId = String(formData.get('facilityId') ?? '');
  try {
    await apiPost(`/energy/invoices/${invoiceId}/archive`, {});
  } catch (error) {
    return describeFailure(error, 'energy.invoice.saveFailed');
  }
  revalidatePath('/dashboard/energy');
  revalidatePath(`/dashboard/facilities/${facilityId}`);
  revalidatePath(`/dashboard/facilities/energy/${meterId}`);
  return { ok: true };
}

/** Whether the import control should be offered at all — read on the server, never in the browser. */
export async function invoiceImportAvailable(): Promise<boolean> {
  return energyInvoiceParser().available();
}

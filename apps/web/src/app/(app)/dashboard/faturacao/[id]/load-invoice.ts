import 'server-only';
import { apiFetch, type Facilities, type Invoice } from '@/lib/api';
import type { Outcome } from '@/lib/load-failure';
import { readInvoice } from '../invoices.actions';

/**
 * One document and the site it was read under — shared by the document's page
 * and its print page (12 October 2026), so the two cannot disagree about which
 * site a `?facilityId=` names or what a missing one falls back to.
 *
 * The site asked for if it is one of this tenant's, else the first. Null when
 * there is no site at all, which the callers say as "not found".
 */
export async function loadInvoice(
  id: string,
  requested: string,
): Promise<{ facilityId: string; loaded: Outcome<Invoice> | null }> {
  let sites: Facilities | null = null;
  try {
    sites = await apiFetch<Facilities>('/facilities');
  } catch {
    sites = null;
  }

  const facilityId =
    sites?.facilities.find((site) => site.id === requested.trim())?.id ??
    sites?.facilities[0]?.id ??
    '';

  const loaded = facilityId === '' ? null : await readInvoice(facilityId, id);
  return { facilityId, loaded };
}

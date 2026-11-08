import 'server-only';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, type AppInvoice } from '@/lib/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One document for its payer — POOLSE-201, shared by the screen and its paper.
 * Anything the API will not hand this reader is a 404, never a "not yours".
 * Other failures are rethrown for the page's error boundary.
 */
export async function loadPayerInvoice(id: string): Promise<AppInvoice> {
  if (!UUID.test(id)) notFound();
  try {
    return await apiFetch<AppInvoice>(`/app/invoices/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}

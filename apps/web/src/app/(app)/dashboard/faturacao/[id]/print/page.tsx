import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isMissing } from '@/lib/load-failure';
import { apiFetch } from '@/lib/api';
import { fileUrl } from '@/lib/files';
import { PageError } from '@/components/page-shell';
import { InvoicePaper } from '../../invoice-paper';
import { loadInvoice } from '../load-invoice';

/**
 * One document, on paper — 12 October 2026.
 *
 * **A print page, not a generated PDF**, the call the water report and the wall
 * timetable already made: "Guardar como PDF" from a page laid out for A4 beats a
 * second layout engine on fonts, accents and selectable text.
 *
 * **It says what the screen says, and nothing the screen does not.** The number,
 * the kind, the dates, the payer — "Consumidor final" when there is none — the
 * lines composed by the same `LineLabel`, the VAT, the totals, what is paid and
 * what is owed, and the notice that this is an internal record and not a legal
 * fatura. That notice is not optional on paper: a printout travels further than
 * the screen, and it is the one place nobody can see the rest of the app.
 *
 * **Monochrome and unthemed**, like the water report: dark mode's surface would
 * print as a black rectangle. `LineLabel` is shared with the screen and carries
 * the theme's muted grey, so the table overrides that one class to a black at
 * reduced opacity rather than forking the component.
 *
 * Loaded through `loadInvoice`, the page's own loader, so `?facilityId=` means
 * the same thing here as there. A refusal or a missing document is a 404; a
 * failure says it failed, rather than printing an empty document.
 */
/**
 * The club's logo at the head of the document (POOLSE-104 C), read as the app
 * bar reads it: a failure is no logo, never a document that did not print.
 */
async function clubLogo(): Promise<string | null> {
  try {
    return fileUrl((await apiFetch<{ fileId: string | null }>('/settings/logo')).fileId);
  } catch {
    return null;
  }
}

export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ facilityId?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;
  const { facilityId: requested = '' } = await searchParams;

  const [{ loaded }, logo] = await Promise.all([loadInvoice(id, requested), clubLogo()]);
  if (loaded === null || isMissing(loaded)) notFound();
  if (loaded.state !== 'ok') {
    return (
      <main className="p-6">
        <PageError message={t(loaded.state === 'failed' ? loaded.failure.key : 'invoices.notFound')} />
      </main>
    );
  }
  return <InvoicePaper invoice={loaded.data} logo={logo} />;
}

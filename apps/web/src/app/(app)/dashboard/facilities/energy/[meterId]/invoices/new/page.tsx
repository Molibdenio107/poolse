import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/page-shell';
import { backTarget } from '@/lib/back';
import { getMeter } from '../../../../energy.actions';
import { invoiceImportAvailable } from '../../../invoice.actions';
import { InvoiceForm } from '../invoice-form';

/**
 * Registar uma fatura — typed, or read off a PDF into the same form.
 *
 * Its own page rather than a dialog: a bill is forty fields and two tables,
 * and a dialog that tall is a page with a backdrop. Whether the import control
 * is offered is decided here, on the server, from the environment — the
 * browser never learns whether a key exists.
 */
export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ meterId: string }>;
  searchParams: Promise<{ from?: string }>;
}): Promise<React.ReactElement> {
  const { meterId } = await params;
  const { from } = await searchParams;
  const t = await getTranslations();

  const detail = await getMeter(meterId);
  if (detail === null || !detail.canRecord) notFound();
  const { meter } = detail;

  const back = backTarget(from, `/dashboard/facilities/energy/${meterId}`);
  const importAvailable = await invoiceImportAvailable();

  return (
    <PageShell
      title={t('energy.invoice.newTitle')}
      subtitle={meter.name}
      // Not `width="wide"`: the calendar is meant to stay that prop's only
      // caller. The lines table scrolls inside its own container instead.
      back={{ href: back.href, label: t(back.labelKey) }}
    >
      <section className="rounded border border-border bg-surface p-5">
        <InvoiceForm
          meterId={meter.id}
          facilityId={meter.facilityId}
          meterCpe={meter.cpe}
          importAvailable={importAvailable}
        />
      </section>
    </PageShell>
  );
}

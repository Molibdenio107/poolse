import { getTranslations } from 'next-intl/server';
import { apiFetch, type Facilities } from '@/lib/api';
import { PageError, PageShell } from '@/components/page-shell';
import { InvoiceFilters } from './invoice-filters';
import { InvoiceRunPanel } from './invoice-run-panel';
import { InvoiceList } from './invoice-list';
import { SeriesPanel } from './series-panel';
import { OutstandingList } from './outstanding-list';
import { ViewTabs } from './view-tabs';
import { listInvoices, listOutstanding, listSeries, previewRun } from './invoices.actions';

/**
 * Faturação — phase 2.2.
 *
 * Three things in the order a club does them: what is billable this month, what
 * has been issued, and the numbering books underneath.
 *
 * **The month is in the URL.** A run somebody is halfway through checking
 * survives a refresh and can be sent to a colleague, which is the same reason
 * the register's filters live there. It also means the preview is a server
 * render rather than a fetch behind a spinner.
 *
 * **A site at a time**, because a document is issued by a site and numbered in
 * that site's own book. Most clubs have one — a subscription covers one facility
 * unless the plan says otherwise — so the picker only appears when there is a
 * choice to make.
 */

/** The month a club is most likely to be billing: this one. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function InvoicingPage({
  searchParams,
}: {
  searchParams: Promise<{ facilityId?: string; month?: string; view?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { facilityId: requested = '', month: monthParam, view } = await searchParams;

  /*
   * Two views, one page, and the view is in the URL like every other filter
   * here. "This month" is what a club does on the 1st; "em dívida" is what it
   * does on the 20th, and neither is a sub-page worth its own route.
   */
  const owing = view === 'owing';

  const month = /^\d{4}-\d{2}$/.test(monthParam ?? '') ? monthParam! : thisMonth();
  const periodStart = `${month}-01`;

  let sites: Facilities | null = null;
  try {
    sites = await apiFetch<Facilities>('/facilities');
  } catch {
    sites = null;
  }

  if (sites === null || sites.facilities.length === 0) {
    /*
     * Two different failures, and only one of them is the operator's to fix.
     * A club with no site has nothing to bill from; somebody the endpoint
     * refuses is told so rather than shown an empty page that reads as "there
     * are no invoices".
     */
    return (
      <PageShell title={t('invoices.title')}>
        <PageError message={t('invoices.notPermitted')} />
      </PageShell>
    );
  }

  const chosen =
    sites.facilities.find((site) => site.id === requested.trim())?.id ?? sites.facilities[0]!.id;

  const [run, issued, outstanding, books] = await Promise.all([
    owing ? Promise.resolve(null) : previewRun(chosen, periodStart),
    owing ? Promise.resolve(null) : listInvoices(chosen, periodStart),
    owing ? listOutstanding(chosen) : Promise.resolve(null),
    listSeries(chosen),
  ]);

  if (run === null && issued === null && outstanding === null && books === null) {
    return (
      <PageShell title={t('invoices.title')}>
        <PageError message={t('invoices.notPermitted')} />
      </PageShell>
    );
  }

  return (
    <PageShell title={t('invoices.title')} subtitle={t('invoices.hint')}>
      <div className="flex flex-col gap-6">
        {/*
          What these documents are, said on the page rather than assumed.

          A club that believed Poolse was issuing legal faturas would find out at
          the worst possible moment — from its accountant, or from the AT. Two
          sentences here cost nothing and are the honest thing to do.
        */}
        <p className="rounded border border-border bg-surface-muted p-4 text-sm text-foreground-muted">
          {t('invoices.internalOnly')}
        </p>

        <ViewTabs owing={owing} />

        {owing ? (
          <OutstandingList facilityId={chosen} invoices={outstanding?.invoices ?? []} />
        ) : (
          <>
            <InvoiceFilters
              facilityId={chosen}
              facilities={sites.facilities.map((site) => ({ id: site.id, name: site.name }))}
              month={month}
            />

            <InvoiceRunPanel facilityId={chosen} month={month} run={run} />

            <InvoiceList facilityId={chosen} invoices={issued?.invoices ?? []} month={month} />
          </>
        )}

        <SeriesPanel facilityId={chosen} series={books?.series ?? []} />
      </div>
    </PageShell>
  );
}

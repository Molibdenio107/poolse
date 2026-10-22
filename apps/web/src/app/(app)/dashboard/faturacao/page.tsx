import { getTranslations } from 'next-intl/server';
import { apiFetch, type Facilities } from '@/lib/api';
import { outcome, type Outcome } from '@/lib/load-failure';
import { backProp, originBack } from '@/lib/back';
import { PageError, PageShell } from '@/components/page-shell';
import { InvoiceFilters } from './invoice-filters';
import { InvoiceRunPanel } from './invoice-run-panel';
import { InvoiceList } from './invoice-list';
import { SeriesPanel } from './series-panel';
import { OutstandingList } from './outstanding-list';
import { ViewTabs, type InvoiceView } from './view-tabs';
import { FromLink } from '@/components/from-link';
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
  searchParams: Promise<{ facilityId?: string; month?: string; view?: string; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { facilityId: requested = '', month: monthParam, view, from } = await searchParams;
  const back = originBack(from);

  /*
   * Three views, one page, and the view is in the URL like every other filter
   * here. "This month" is what a club does on the 1st; "em dívida" is what it
   * does on the 20th, and neither is a sub-page worth its own route. The third,
   * Configuração (12 October 2026), is the series and the NIPC — set once a
   * year, and no longer drawn under both lists where it pushed them down.
   */
  const asked: InvoiceView =
    view === 'owing' ? 'owing' : view === 'settings' ? 'settings' : 'month';
  const owing = asked === 'owing';

  const month = /^\d{4}-\d{2}$/.test(monthParam ?? '') ? monthParam! : thisMonth();
  const periodStart = `${month}-01`;

  /*
   * Three answers, three sentences — October 2026 sweep. A refusal is "not
   * yours", a failure is "did not load", and a club with no site yet has
   * nothing to bill from. All three used to read "Não tem permissão", which
   * told a new club's owner they were not allowed into their own billing.
   */
  const loadedSites = await outcome(apiFetch<Facilities>('/facilities'));
  if (loadedSites.state !== 'ok' || loadedSites.data.facilities.length === 0) {
    return (
      <PageShell title={t('invoices.title')}>
        <PageError
          message={t(
            loadedSites.state === 'refused'
              ? 'invoices.notPermitted'
              : loadedSites.state === 'failed'
                ? loadedSites.failure.key
                : 'invoices.noSites',
          )}
        />
      </PageShell>
    );
  }
  const sites = loadedSites.data;

  const chosen =
    sites.facilities.find((site) => site.id === requested.trim())?.id ?? sites.facilities[0]!.id;

  const skipped = Promise.resolve(null);
  const [runLoad, issuedLoad, outstandingLoad, booksLoad] = await Promise.all([
    asked === 'month' ? previewRun(chosen, periodStart) : skipped,
    asked === 'month' ? listInvoices(chosen, periodStart) : skipped,
    owing ? listOutstanding(chosen) : skipped,
    // Loads under every view: whether the Configuração pill is offered rests on
    // whether it would be refused.
    listSeries(chosen),
  ]);

  // "Not yours" only when every load that ran was refused; a failure is said
  // in its own place below, never as a permission.
  const ran: Outcome<unknown>[] = [];
  for (const one of [runLoad, issuedLoad, outstandingLoad, booksLoad]) {
    if (one !== null) ran.push(one as Outcome<unknown>);
  }
  if (ran.every((one) => one.state === 'refused')) {
    return (
      <PageShell title={t('invoices.title')}>
        <PageError message={t('invoices.notPermitted')} />
      </PageShell>
    );
  }

  const failedKey = (one: Outcome<unknown> | null): string =>
    one !== null && one.state === 'failed' ? one.failure.key : 'detailTabs.loadFailed';
  const run = runLoad?.state === 'ok' ? runLoad.data : null;
  const issued = issuedLoad?.state === 'ok' ? issuedLoad.data : null;
  const outstanding = outstandingLoad?.state === 'ok' ? outstandingLoad.data : null;
  const books = booksLoad.state === 'ok' ? booksLoad.data : null;

  const settingsOffered = booksLoad.state !== 'refused';
  // No fallback is needed for a bookmarked Configuração the reader may not
  // have: under that view the series is the only load that ran, so a refusal
  // of it is the "not yours" page above.
  // A view that is not offered falls back to the month rather than an empty page.
  const current: InvoiceView = asked === 'settings' && !settingsOffered ? 'month' : asked;

  return (
    <PageShell title={t('invoices.title')} subtitle={t('invoices.hint')} back={backProp(back, t)}>
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

        <ViewTabs view={current} settings={settingsOffered} />

        {/*
          Each list's own failure, said in its own place — October 2026 sweep.
          A null here used to become an empty list, and an empty chase list
          reads "nothing owed": the most reassuring sentence on the screen, on
          exactly the day it was not true.
        */}
        {current === 'owing' &&
          (outstanding === null ? (
            <PageError message={t(failedKey(outstandingLoad))} />
          ) : (
            <OutstandingList facilityId={chosen} invoices={outstanding.invoices} />
          ))}

        {current === 'month' && (
          <>
            <InvoiceFilters
              facilityId={chosen}
              facilities={sites.facilities.map((site) => ({ id: site.id, name: site.name }))}
              month={month}
            />

            <InvoiceRunPanel facilityId={chosen} month={month} run={run} />

            {runLoad?.state === 'failed' && <PageError message={t(runLoad.failure.key)} />}

            {issued === null ? (
              <PageError message={t(failedKey(issuedLoad))} />
            ) : (
              <InvoiceList facilityId={chosen} invoices={issued.invoices} month={month} />
            )}
          </>
        )}

        {current === 'settings' && (
          <>
            {books === null ? (
              booksLoad.state !== 'refused' && <PageError message={t(failedKey(booksLoad))} />
            ) : (
              <SeriesPanel facilityId={chosen} series={books.series} />
            )}

            {/*
              The club's NIPC and logo live with the club's settings now — Rui,
              13 October 2026. Said here, with the way there, because this is
              where somebody who has used Poolse before will look for them.
            */}
            <p className="text-sm text-foreground-muted">
              {t('invoices.clubDataMoved')}{' '}
              <FromLink
                href={`/dashboard/facilities/${chosen}?tab=club`}
                className="rounded text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('invoices.clubDataLink')}
              </FromLink>
            </p>
          </>
        )}
      </div>
    </PageShell>
  );
}

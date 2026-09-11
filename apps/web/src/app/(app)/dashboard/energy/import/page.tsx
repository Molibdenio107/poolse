import { getTranslations } from 'next-intl/server';
import { apiFetch, type Facilities } from '@/lib/api';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { PageError, PageShell } from '@/components/page-shell';
import { listMeters } from '../../facilities/energy.actions';
import { invoiceImportAvailable } from '../../facilities/energy/invoice.actions';
import { InvoiceForm, type MeterOption } from '../../facilities/energy/[meterId]/invoices/invoice-form';

/**
 * Importar uma fatura, from the Energia screen — Rui's ask.
 *
 * The meter page's form knows its meter; this one does not, and that is the
 * point: an operator with a stack of bills should not have to know which
 * meter each one is for before dropping it. The bill names its delivery point,
 * the meter carries the same CPE, and the form matches them — the picker is
 * there for a bill on a meter that has no CPE yet, and to overrule.
 *
 * Every meter across every site, because a municipality's bills arrive in one
 * envelope. The label carries the site so two "Geral" meters read apart.
 */
export default async function ImportInvoicePage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let sites: Facilities | null = null;
  let failure: LoadFailure | null = null;
  try {
    sites = await apiFetch<Facilities>('/facilities');
  } catch (error) {
    failure = describeLoad(error);
  }

  const meters: MeterOption[] = [];
  let canRecord = false;
  if (sites !== null) {
    const lists = await Promise.all(sites.facilities.map(async (site) => ({ site, list: await listMeters(site.id) })));
    const several = sites.facilities.length > 1;
    for (const { site, list } of lists) {
      if (list === null) continue;
      canRecord = canRecord || list.canRecord;
      for (const meter of list.meters) {
        meters.push({
          id: meter.id,
          facilityId: site.id,
          label: several ? `${site.name} · ${meter.name}` : meter.name,
          cpe: meter.cpe,
        });
      }
    }
  }

  const importAvailable = await invoiceImportAvailable();

  return (
    <PageShell
      title={t('energy.invoice.importPageTitle')}
      subtitle={t('energy.invoice.importPageSubtitle')}
      back={{ href: '/dashboard/energy', label: t('energy.backToEnergy') }}
    >
      {failure !== null && (
        <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />
      )}

      {sites !== null && meters.length === 0 && (
        <section className="rounded border border-border bg-surface p-5">
          <p className="text-sm text-foreground-muted">{t('energy.invoice.noMeters')}</p>
        </section>
      )}

      {meters.length > 0 && canRecord && (
        <section className="rounded border border-border bg-surface p-5">
          <InvoiceForm meters={meters} importAvailable={importAvailable} />
        </section>
      )}
    </PageShell>
  );
}

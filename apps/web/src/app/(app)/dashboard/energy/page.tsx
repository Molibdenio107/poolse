import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { apiFetch, type Facilities } from '@/lib/api';
import { withFrom } from '@/lib/back';
import { EntityIcon } from '@/components/entity-icon';
import { PageError, PageShell } from '@/components/page-shell';
import { EnergyPanel } from '../facilities/energy-panel';
import { listMeters } from '../facilities/energy.actions';
import { invoiceImportAvailable } from '../facilities/energy/invoice.actions';
import {
  InvoiceForm,
  type FacilityOption,
  type MeterOption,
} from '../facilities/energy/[meterId]/invoices/invoice-form';

/**
 * Energia — the module's own front door, at Rui's ask.
 *
 * An operator logging the month's readings is doing one job across every site,
 * and reaching the meters through Instalações puts a site page — spaces, tasks,
 * photographs — between them and the dial. So: every site, each with its
 * meters, on one screen. A club with one site (which is most of them, one
 * facility per licence) lands straight on its meters; a municipality with two
 * sees both, named, and picks by scrolling rather than by a step.
 *
 * **The bill comes first, at the top, and a PDF dropped anywhere on the page
 * is read** — Rui's ask again. An operator with a stack of bills should not
 * have to know which meter each one is for before dropping it: the bill names
 * its delivery point, the meter carries the same CPE, and the form matches
 * them. A CPE no meter carries yet makes a meter, so the very first bill of a
 * new club has somewhere to land. The panel on each site's page stays, for a
 * technician who is already looking at the site.
 */
export default async function EnergyPage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let sites: Facilities | null = null;
  let failure: LoadFailure | null = null;

  try {
    sites = await apiFetch<Facilities>('/facilities');
  } catch (error) {
    failure = describeLoad(error);
  }

  const panels =
    sites === null
      ? []
      : await Promise.all(
          sites.facilities.map(async (site) => ({ site, list: await listMeters(site.id) })),
        );

  // Everything a dropped bill may land on, across the club.
  const several = panels.length > 1;
  const meters: MeterOption[] = panels.flatMap(({ site, list }) =>
    (list?.meters ?? []).map((meter) => ({
      id: meter.id,
      facilityId: site.id,
      label: several ? `${site.name} · ${meter.name}` : meter.name,
      cpe: meter.cpe,
    })),
  );
  const facilities: FacilityOption[] = panels.map(({ site }) => ({ id: site.id, name: site.name }));
  const canRecord = panels.some(({ list }) => list !== null && list.canRecord);
  const importAvailable = await invoiceImportAvailable();

  return (
    <PageShell
      title={t('energy.title')}
      subtitle={t('energy.subtitle')}
      actions={<EntityIcon kind="energy" className="size-6 text-primary" />}
    >
      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {sites !== null && sites.facilities.length === 0 && (
        <section className="rounded border border-border bg-surface p-5">
          <p className="text-sm text-foreground-muted">{t('energy.noSites')}</p>
        </section>
      )}

      {canRecord && facilities.length > 0 && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('energy.invoice.importPageTitle')}
          </h2>
          <p className="text-sm text-foreground-muted">{t('energy.invoice.importPageSubtitle')}</p>
          <InvoiceForm meters={meters} facilities={facilities} importAvailable={importAvailable} collapsed />
        </section>
      )}

      {panels.map(({ site, list }) => (
        <section
          key={site.id}
          className="flex flex-col gap-4 rounded border border-border bg-surface p-5"
        >
          <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-foreground-muted">
            <EntityIcon kind="facility" />
            <Link
              href={withFrom(`/dashboard/facilities/${site.id}`, '/dashboard/energy')}
              className="hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {site.name}
            </Link>
          </h2>

          {/*
            Best-effort, but not silent: a site whose meters would not load says
            so, because a section with no rows is indistinguishable from a site
            with no meters.
          */}
          {list === null ? (
            <p className="text-sm text-foreground-muted">{t('energy.siteUnavailable')}</p>
          ) : (
            <EnergyPanel facilityId={site.id} list={list} backTo="/dashboard/energy" />
          )}
        </section>
      ))}
    </PageShell>
  );
}

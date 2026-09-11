import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { apiFetch, type Facilities } from '@/lib/api';
import { withFrom } from '@/lib/back';
import { EntityIcon } from '@/components/entity-icon';
import { PageError, PageShell } from '@/components/page-shell';
import { EnergyPanel } from '../facilities/energy-panel';
import { listMeters } from '../facilities/energy.actions';

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
 * The same `EnergyPanel` the site page mounts, with Voltar from a meter coming
 * back here rather than to the site — `withFrom`, as everywhere. The panel on
 * the site page stays: a technician looking at a site also wants its meters.
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

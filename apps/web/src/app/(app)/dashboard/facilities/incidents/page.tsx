import { FromLink } from '@/components/from-link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Siren } from 'lucide-react';
import { apiFetch, type Facilities } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { backProp, originBack } from '@/lib/back';
import { formatStamp } from '@/lib/date-format';
import { cn } from '@/lib/utils';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { listIncidents } from './incidents.actions';
import { SiteLinks } from './site-links';

/**
 * Ocorrências — POOLSE-70, slice 1.
 *
 * The incident book of one site, newest first. Under Instalações because an
 * incident happens at a site, in one of its tanks or spaces, and the person
 * reading the list is the one on that deck.
 *
 * One site at a time, picked by `?site=` like Receção: the tank and space a
 * form offers belong to one site, and the API refuses a place from another.
 *
 * The list shows the facts only. What happened and the injury are behind the
 * per-row rule on the incident's own page, where each read is logged — a list
 * that showed them would be a list nobody could open without writing to the
 * audit trail.
 */
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; page?: string; from?: string; new?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { site: requested = '', page: pageParam, from, new: recorded } = await searchParams;
  const back = originBack(from);
  const page = readPage(pageParam);

  const sites = await outcome(apiFetch<Facilities>('/facilities'));
  if (sites.state !== 'ok' || sites.data.facilities.length === 0) {
    return (
      <PageShell title={t('incidents.title')}>
        <PageError
          message={t(
            sites.state === 'refused'
              ? 'incidents.notPermitted'
              : sites.state === 'failed'
                ? sites.failure.key
                : 'incidents.noSites',
          )}
        />
      </PageShell>
    );
  }

  const list = sites.data.facilities;
  const chosen = list.find((site) => site.id === requested.trim()) ?? list[0]!;
  const incidents = await listIncidents(chosen.id, page);

  if (incidents.state === 'ok' && isPastEnd(page, incidents.data.total, incidents.data.limit)) {
    redirect(
      pageHref(
        '/dashboard/facilities/incidents',
        { site: chosen.id },
        lastPage(incidents.data.total, incidents.data.limit),
      ),
    );
  }

  const newHref = `/dashboard/facilities/incidents/new?site=${chosen.id}`;

  return (
    <PageShell
      back={backProp(back, t)}
      title={t('incidents.title')}
      subtitle={t('incidents.subtitle')}
      actions={
        incidents.state === 'ok' ? (
          <FromLink
            href={newHref}
            className="inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('incidents.new')}
          </FromLink>
        ) : null
      }
    >
      <div className="flex flex-col gap-6">
        <SiteLinks
          sites={list}
          chosenId={chosen.id}
          basePath="/dashboard/facilities/incidents"
          label={t('incidents.sites')}
        />

        {incidents.state === 'refused' && <PageError message={t('incidents.notPermitted')} />}
        {incidents.state === 'failed' && (
          <PageError
            message={t(incidents.failure.key)}
            {...(incidents.failure.detail === '' ? {} : { detail: incidents.failure.detail })}
          />
        )}

        {incidents.state === 'ok' && incidents.data.total === 0 && (
          <PageEmpty
            message={t('incidents.empty', { site: chosen.name })}
            hint={t('incidents.emptyHint')}
          />
        )}

        {incidents.state === 'ok' && incidents.data.total > 0 && (
          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            <ul className="flex flex-col divide-y divide-border">
              {incidents.data.items.map((incident) => (
                <li
                  key={incident.id}
                  className={cn(
                    'flex flex-col gap-1 py-4 first:pt-0 last:pb-0',
                    // The one just recorded, lit for a moment so it is seen to
                    // have landed (POOLSE-92 H). The toast says it in words.
                    incident.id === recorded && '-mx-2 rounded px-2 motion-safe:animate-flash-today',
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <FromLink
                      href={`/dashboard/facilities/incidents/${incident.id}`}
                      className="font-medium underline underline-offset-4 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {formatStamp(incident.occurredAt)}
                      {' · '}
                      {incident.placeName ?? t('incidents.elsewhere')}
                    </FromLink>
                    {/* Said in words with an icon; the colour only repeats it. */}
                    {incident.emergencyCalled ? (
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-danger">
                        <Siren aria-hidden className="size-4" />
                        {t('incidents.emergencyCalled')}
                      </span>
                    ) : (
                      <span className="text-sm text-foreground-muted">
                        {t('incidents.emergencyNotCalled')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm">
                    {incident.personName}
                    <span className="text-foreground-muted">
                      {' · '}
                      {t(`incidents.personKind.${incident.personKind}`)}
                    </span>
                  </p>
                  <p className="text-sm text-foreground-muted">
                    {[
                      incident.lifeguardName === null
                        ? t('incidents.noLifeguard')
                        : t('incidents.lifeguardIs', { name: incident.lifeguardName }),
                      incident.recordedByName === null
                        ? null
                        : t('incidents.recordedBy', { name: incident.recordedByName }),
                      t('incidents.addendaCount', { count: incident.addendaCount }),
                    ]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
            <Pagination
              page={incidents.data}
              basePath="/dashboard/facilities/incidents"
              query={{ site: chosen.id, from }}
            />
          </section>
        )}
      </div>
    </PageShell>
  );
}

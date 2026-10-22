import { getTranslations } from 'next-intl/server';
import { apiFetch, type Facilities } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { wallClockNow } from '@/lib/date-format';
import { backProp, backTarget } from '@/lib/back';
import { PageError, PageShell } from '@/components/page-shell';
import { listSpaces } from '../../spaces.actions';
import { IncidentForm } from '../incident-form';
import { SiteLinks } from '../site-links';

/**
 * Registar ocorrência — POOLSE-70, slice 1.
 *
 * The site comes from `?site=`, as on the list, because the tanks and spaces the
 * form offers are that site's and the API refuses a place from another. The
 * clock defaults to now *on the site's wall clock*, computed here from the
 * site's zone rather than in the browser.
 *
 * Spaces are best-effort: a reader refused them, or a failed load, still gets
 * the tanks and "elsewhere on the site" — an incident must never be the record
 * somebody could not write because a side list did not load.
 */
export default async function NewIncidentPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { site: requested = '', from } = await searchParams;

  const sites = await outcome(apiFetch<Facilities>('/facilities'));
  if (sites.state !== 'ok' || sites.data.facilities.length === 0) {
    return (
      <PageShell
        title={t('incidents.new')}
        back={backProp(backTarget(from, '/dashboard/facilities/incidents'), t)}
      >
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
  const spaces = await listSpaces(chosen.id);

  const places = [
    ...chosen.pools.map((pool) => ({ value: `pool:${pool.id}`, label: pool.name })),
    ...(spaces.state === 'ok'
      ? spaces.data.items.map((space) => ({ value: `space:${space.id}`, label: space.name }))
      : []),
  ];

  return (
    <PageShell
      title={t('incidents.new')}
      subtitle={t('incidents.newSubtitle', { site: chosen.name })}
      back={backProp(backTarget(from, `/dashboard/facilities/incidents?site=${chosen.id}`), t)}
    >
      <div className="flex flex-col gap-6">
        <SiteLinks
          sites={list}
          chosenId={chosen.id}
          basePath="/dashboard/facilities/incidents/new"
          label={t('incidents.sites')}
        />
        {/* Keyed by site: a place chosen at one site means nothing at the next. */}
        <IncidentForm
          key={chosen.id}
          facilityId={chosen.id}
          places={places}
          now={wallClockNow(chosen.timezone)}
        />
      </div>
    </PageShell>
  );
}

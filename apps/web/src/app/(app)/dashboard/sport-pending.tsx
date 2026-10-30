import { getTranslations } from 'next-intl/server';
import type { PoolseSport } from '@poolse/rules';
import { apiFetch, type Facilities, type FacilityDetail } from '@/lib/api';
import { dataOf, outcome } from '@/lib/load-failure';
import { FromLink } from '@/components/from-link';
import { PageShell } from '@/components/page-shell';
import { backProp, originBack } from '@/lib/back';

/**
 * Turmas or Calendário for a sport besides swimming — POOLSE-125's shell.
 *
 * The menu has a group per sport, but nothing yet makes a court's turma or
 * draws a court's week (the court grid is its own ticket). So the page says
 * that in words, and lists what does exist: the sport's recintos on each site
 * the reader may open, each linking to the site's Recintos tab where they are
 * added and archived. A blank calendar would read as "no bookings", which is a
 * different and wrong sentence.
 */
export async function SportPending({
  sport,
  page,
  from,
}: {
  sport: PoolseSport;
  page: 'classes' | 'calendar';
  from: string | undefined;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const sportName = t(`sport.name.${sport}`);
  const pageName = t(page === 'classes' ? 'classes.title' : 'calendar.title');

  const sites = dataOf(await outcome(apiFetch<Facilities>('/facilities')));
  const readable = sites?.canOpenSite === true ? sites.facilities : [];
  // One request per site: a club has two or three, and only owner, admin and
  // maintenance open a site's page at all.
  const details = await Promise.all(
    readable.map(async (site) => dataOf(await outcome(apiFetch<FacilityDetail>(`/facilities/${site.id}`)))),
  );
  const areas = details
    .filter((site): site is FacilityDetail => site !== null)
    .map((site) => ({
      site,
      courts: (site.playingAreas ?? []).filter((area) => area.sportId === sport),
    }));

  return (
    <PageShell
      title={t('sportPage.title', { page: pageName, sport: sportName })}
      back={backProp(originBack(from), t)}
    >
      <p className="max-w-prose text-sm text-foreground-muted">
        {t('sportPage.pending', { sport: sportName })}
      </p>

      {areas.length > 0 && (
        <section className="mt-6 flex flex-col gap-4">
          <h2 className="text-base font-semibold">{t('sportPage.recintos', { sport: sportName })}</h2>
          {areas.map(({ site, courts }) => (
            <div key={site.id} className="rounded border border-border bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">{site.name}</h3>
                {site.canManage && (
                  <FromLink
                    href={`/dashboard/facilities/${site.id}?tab=recintos`}
                    className="text-sm text-primary underline-offset-2 hover:underline coarse:-my-3 coarse:py-3"
                  >
                    {t('sportPage.manage')}
                  </FromLink>
                )}
              </div>
              {courts.length === 0 ? (
                <p className="mt-2 text-sm text-foreground-muted">{t('recintos.none')}</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {courts.map((court) => (
                    <li key={court.id}>{court.name}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}
    </PageShell>
  );
}

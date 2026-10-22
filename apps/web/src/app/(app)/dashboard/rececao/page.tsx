import { FromLink } from '@/components/from-link';
import { getTranslations } from 'next-intl/server';
import { apiFetch, type Facilities } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { backProp, originBack } from '@/lib/back';
import { PageError, PageShell } from '@/components/page-shell';
import { readReception } from './reception.actions';
import { ReceptionBoard } from './reception-board';

/**
 * Receção — POOLSE-68.
 *
 * The desk in one screen: how full each tank is now, who is in the water on a
 * pass, and the two things reception does all afternoon — sell somebody an
 * entry, and let somebody with a pass in.
 *
 * One site at a time, picked by `?site=`, like Faturação: a pass is sold by a
 * site and used at that site, so a screen mixing two would let reception check
 * a Norte pack into a Sul tank, which the database refuses anyway.
 */
export default async function ReceptionPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { site: requested = '', from } = await searchParams;
  const back = originBack(from);

  const sites = await outcome(apiFetch<Facilities>('/facilities'));
  if (sites.state !== 'ok' || sites.data.facilities.length === 0) {
    return (
      <PageShell title={t('reception.title')}>
        <PageError
          message={t(
            sites.state === 'refused'
              ? 'reception.notPermitted'
              : sites.state === 'failed'
                ? sites.failure.key
                : 'reception.noSites',
          )}
        />
      </PageShell>
    );
  }

  const list = sites.data.facilities;
  const chosen = list.find((site) => site.id === requested.trim()) ?? list[0]!;
  const reception = await readReception(chosen.id);

  return (
    <PageShell title={t('reception.title')} subtitle={t('reception.hint')} back={backProp(back, t)}>
      <div className="flex flex-col gap-6">
        {list.length > 1 && (
          <nav aria-label={t('reception.sites')} className="flex flex-wrap gap-2">
            {list.map((site) => (
              <FromLink
                key={site.id}
                href={`/dashboard/rececao?site=${site.id}`}
                aria-current={site.id === chosen.id ? 'page' : undefined}
                className={
                  site.id === chosen.id
                    ? 'inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control text-primary-foreground'
                    : 'inline-flex h-control items-center justify-center rounded border border-border px-4 text-control hover:bg-surface-muted'
                }
              >
                {site.name}
              </FromLink>
            ))}
          </nav>
        )}

        {reception.state === 'refused' && <PageError message={t('reception.notPermitted')} />}
        {reception.state === 'failed' && (
          <PageError
            message={t(reception.failure.key)}
            {...(reception.failure.detail === '' ? {} : { detail: reception.failure.detail })}
          />
        )}
        {reception.state === 'ok' && (
          // Keyed by site: switching sites must not carry the last site's tank,
          // which every check-in there would then refuse as the wrong site.
          <ReceptionBoard key={chosen.id} facilityId={chosen.id} reception={reception.data} />
        )}
      </div>
    </PageShell>
  );
}

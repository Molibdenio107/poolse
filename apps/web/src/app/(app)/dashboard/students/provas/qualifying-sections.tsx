import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { FederationAgeGroup, QualifyingOverview } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { cn } from '@/lib/utils';
import { ArchiveButton, CreateAgeGroupForm, CreateStandardForm, EditAgeGroupButton } from './qualifying-forms';

/**
 * The Mínimos and Escalões FPN sections of Provas — POOLSE-85. Server
 * components; the forms they hold are the client half in `qualifying-forms`.
 */

const LINK =
  'font-medium underline underline-offset-4 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Which season the two sections read — the published one unless another is chosen. */
export async function SeasonChooser({
  overview,
  path,
}: {
  overview: QualifyingOverview;
  /** The part being read — Mínimos or Escalões each has its own route. */
  path: string;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  if (overview.seasons.length < 2) return null;
  return (
    <nav aria-label={t('qualifying.season')} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-foreground-muted">{t('qualifying.season')}</span>
      {overview.seasons.map((season) =>
        season.id === overview.seasonId ? (
          <span key={season.id} aria-current="page" className="font-medium">
            {season.name}
          </span>
        ) : (
          <Link
            key={season.id}
            href={`${path}?season=${season.id}`}
            scroll={false}
            className="text-primary underline underline-offset-4"
          >
            {season.name}
          </Link>
        ),
      )}
    </nav>
  );
}

export async function StandardList({
  overview,
  seasonId,
}: {
  overview: QualifyingOverview;
  seasonId: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  return (
    <>
      <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
        <p className="text-sm text-foreground-muted">{t('qualifying.standardsExplain')}</p>
        {overview.standards.length === 0 ? (
          <p>{t('qualifying.noStandards')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {overview.standards.map((standard) => (
              <li key={standard.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <Link href={`/dashboard/students/provas/minimos/${standard.id}`} className={LINK}>
                  {standard.name}
                </Link>
                <p className="text-sm text-foreground-muted">
                  {[
                    t('qualifying.timeCount', { count: standard.timeCount }),
                    windowText(t, standard.windowFrom, standard.windowTo),
                  ].join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {overview.canEdit && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <h2 className="font-medium">{t('qualifying.addStandard')}</h2>
          {overview.ageGroups.length === 0 && (
            <p className="text-sm text-warning">{t('qualifying.noAgeGroupsYet')}</p>
          )}
          <CreateStandardForm organizationId={overview.organizationId} seasonId={seasonId} />
        </section>
      )}
    </>
  );
}

export function windowText(
  t: (key: string, values?: Record<string, string | number>) => string,
  from: string | null,
  to: string | null,
): string {
  if (from === null && to === null) return t('qualifying.windowSeason');
  return t('qualifying.windowRange', {
    from: from === null ? t('qualifying.seasonStart') : formatDate(from),
    to: to === null ? t('qualifying.seasonEnd') : formatDate(to),
  });
}

export function bandText(
  t: (key: string, values?: Record<string, string | number>) => string,
  group: FederationAgeGroup,
): string {
  const gender =
    group.gender === null
      ? t('qualifying.genderBoth')
      : t(group.gender === 'female' ? 'qualifying.genderFemale' : 'qualifying.genderMale');
  const years =
    group.bornFrom !== null && group.bornTo !== null
      ? group.bornFrom === group.bornTo
        ? t('qualifying.bornIn', { year: group.bornFrom })
        : t('qualifying.bornBetween', { from: group.bornFrom, to: group.bornTo })
      : group.bornFrom !== null
        ? t('qualifying.bornFromOn', { year: group.bornFrom })
        : group.bornTo !== null
          ? t('qualifying.bornUpTo', { year: group.bornTo })
          : t('qualifying.bornAny');
  return `${gender} · ${years}`;
}

export async function AgeGroupList({
  overview,
  seasonId,
}: {
  overview: QualifyingOverview;
  seasonId: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  return (
    <>
      <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
        <p className="text-sm text-foreground-muted">{t('qualifying.ageGroupsExplain')}</p>
        {overview.ageGroups.length === 0 ? (
          <p>{t('qualifying.noAgeGroups')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {overview.ageGroups.map((group) => (
              <li
                key={group.id}
                className={cn('flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0')}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{group.name}</span>
                  <span className="text-sm text-foreground-muted">{bandText(t, group)}</span>
                </div>
                {overview.canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <EditAgeGroupButton organizationId={overview.organizationId} group={group} />
                    {overview.canArchive && (
                      <ArchiveButton
                        organizationId={overview.organizationId}
                        id={group.id}
                        kind="ageGroup"
                        name={group.name}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {overview.canEdit && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <h2 className="font-medium">{t('qualifying.addAgeGroup')}</h2>
          <CreateAgeGroupForm organizationId={overview.organizationId} seasonId={seasonId} />
        </section>
      )}
    </>
  );
}

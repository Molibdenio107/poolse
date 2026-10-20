import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type MeetList, type QualifyingOverview } from '@/lib/api';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { formatDate } from '@/lib/date-format';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { PageError, PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { SectionPills } from '@/components/section-pills';
import { ImportMeet } from './import-meet';
import { AgeGroupList, SeasonChooser, StandardList } from './qualifying-sections';

/**
 * Competição — Provas (POOLSE-81), Mínimos and Escalões (POOLSE-85).
 *
 * Three parts, each its own route since 20-10-2026 (Rui) so the menu can name
 * them — Alunos → Competição → Provas, Mínimos, Escalões — and the pills stay
 * for a phone, where the menu is behind a button. The club's meets, newest
 * first and paginated; the qualifying standards; and the FPN's age groups,
 * which the club types for each season. Owner, admin and instructor; a family
 * reads its own child's results and gap in Progressão and nothing here.
 */

export const PATH = '/dashboard/students/provas';
export const SECTIONS = ['meets', 'minimos', 'escaloes'] as const;
export type Section = (typeof SECTIONS)[number];

/** Each part's own address. A meet is `PATH/<id>`, which the static routes outrank. */
export function sectionPath(section: Section): string {
  return section === 'meets' ? PATH : `${PATH}/${section}`;
}

/** A part's address, carrying the season the reader was looking at. */
function sectionLink(section: Section, season: string | undefined): string {
  return season === undefined ? sectionPath(section) : `${sectionPath(section)}?season=${encodeURIComponent(season)}`;
}

export async function CompetitionPage({
  section,
  params,
}: {
  section: Section;
  params: { page?: string; season?: string };
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const page = readPage(params.page);

  let meets: MeetList | null = null;
  let qualifying: QualifyingOverview | null = null;
  let failure: LoadFailure | null = null;
  let notPermitted = false;

  try {
    if (section === 'meets') {
      meets = await apiFetch<MeetList>(`/meets${page > 1 ? `?page=${page}` : ''}`);
    } else {
      const season = params.season === undefined ? '' : `?season=${encodeURIComponent(params.season)}`;
      qualifying = await apiFetch<QualifyingOverview>(`/qualifying${season}`);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = describeLoad(error);
  }

  if (meets !== null && isPastEnd(page, meets.total, meets.limit)) {
    redirect(pageHref(PATH, {}, lastPage(meets.total, meets.limit)));
  }

  return (
    <PageShell
      title={t('competition.title')}
      subtitle={t('competition.subtitle')}
      back={{ href: '/dashboard/students', label: t('students.backToRegister') }}
      actions={
        meets?.canImport ? (
          <ImportMeet organizationId={meets.organizationId} rememberedClubCode={meets.rememberedClubCode} />
        ) : null
      }
    >
      {!notPermitted && (
        <SectionPills
          label={t('qualifying.sections')}
          current={section}
          items={SECTIONS.map((key) => ({
            key,
            label: t(`qualifying.section.${key}`),
            href: sectionLink(key, params.season),
          }))}
        />
      )}

      {notPermitted && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('meets.notPermitted')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />
      )}

      {meets !== null && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          {meets.total === 0 ? (
            <div className="flex flex-col gap-1">
              <p>{t('meets.empty')}</p>
              <p className="text-sm text-foreground-muted">{t('meets.emptyHint')}</p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {meets.items.map((meet) => (
                <li key={meet.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <Link
                      href={`${PATH}/${meet.id}`}
                      className="font-medium underline underline-offset-4 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {meet.name}
                    </Link>
                    <span className="text-sm text-foreground-muted">
                      {meet.startsOn === meet.endsOn
                        ? formatDate(meet.startsOn)
                        : `${formatDate(meet.startsOn)} — ${formatDate(meet.endsOn)}`}
                    </span>
                  </div>
                  <p className="text-sm text-foreground-muted">
                    {[
                      meet.city,
                      meet.course === null ? null : t(`progress.course.${meet.course}`),
                      meet.official ? t('progress.official') : t('meets.friendly'),
                      t('meets.resultCount', { count: meet.resultCount }),
                      meet.imported ? t('meets.fromFile') : t('meets.typed'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Pagination page={meets} basePath={PATH} />
        </section>
      )}

      {qualifying !== null &&
        (qualifying.seasonId === null ? (
          <section className="rounded border border-border bg-surface p-5">
            <p>{t('qualifying.noSeason')}</p>
          </section>
        ) : (
          <>
            <SeasonChooser overview={qualifying} path={sectionPath(section)} />
            {section === 'minimos' ? (
              <StandardList overview={qualifying} seasonId={qualifying.seasonId} />
            ) : (
              <AgeGroupList overview={qualifying} seasonId={qualifying.seasonId} />
            )}
          </>
        ))}
    </PageShell>
  );
}

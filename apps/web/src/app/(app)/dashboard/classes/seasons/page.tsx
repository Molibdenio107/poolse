import { getLocale, getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { ApiError, apiFetch, type Seasons } from '../../../../../lib/api';
import { cn } from '@/lib/utils';
import { SeasonReset } from './season-reset';
import { SeasonDrafts } from './season-drafts';
import { PageError, PageShell } from '@/components/page-shell';
import { formatDate } from '@/lib/date-format';
import { SectionPills, pickSection, sectionHref } from '@/components/section-pills';

/**
 * Seasons — POOLSE-07.
 *
 * A club's year runs September to August, and the turmas of one year are not the
 * turmas of the next. Until now there was no such thing as a year: every turma
 * ever created sat in one list, so a school's second September would show it
 * alongside last year's.
 *
 * This screen is where a year ends and the next begins. It is deliberately dull
 * — a list and one button — because the button is the only irreversible thing in
 * the product and it should not be next to anything anybody presses often.
 */
export default async function SeasonsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { section } = await searchParams;
  const locale = await getLocale();

  let data: Seasons | null = null;
  let failure: LoadFailure | null = null;

  try {
    data = await apiFetch<Seasons>('/seasons');
  } catch (error) {
    failure = describeLoad(error);
  }

  /*
    One section at a time — 12 October 2026, Rui's standing preference that the
    reader scrolls as little as possible. Three things that are done at
    different times of the year: reading the seasons, planning the next one as
    a draft, and ending the current one. The last two are management's, so an
    instructor is offered neither and sees the list with no pills at all.

    Which also serves the rule above: the irreversible button now lives on a
    page of its own, reached by a pill that names it, and is not under the
    drafts form somebody uses all summer.
  */
  const sections = (
    [
      ['seasons', true],
      ['planning', data?.canManage === true],
      ['start', data?.canManage === true],
    ] as const
  )
    .filter(([, offered]) => offered)
    .map(([key]) => key);
  const current = pickSection(sections, section, 'seasons');
  const drafts = (data?.seasons ?? []).filter((season) => season.status === 'draft');

  return (
    <PageShell
      title={t('seasons.title')}
      subtitle={t('seasons.subtitle')}
      back={{ href: "/dashboard/classes", label: t('seasons.backToClasses') }}
    >


      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {data !== null && (
        <>
          <SectionPills
            label={t('seasons.section.nav')}
            current={current}
            items={sections.map((key) => ({
              key,
              label:
                key === 'seasons'
                  ? t('seasons.title')
                  : key === 'planning'
                    ? t('seasons.planning')
                    : t('seasons.startNew'),
              href: sectionHref('/dashboard/classes/seasons', {}, key),
              ...(key === 'seasons'
                ? { count: data.seasons.length }
                : key === 'planning'
                  ? { count: drafts.length }
                  : {}),
            }))}
          />

          {current === 'seasons' && (
            <>
              <section className="rounded border border-border bg-surface p-5">
                {data.seasons.length === 0 ? (
                  <p className="text-foreground-muted">{t('seasons.none')}</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {data.seasons.map((season) => (
                      <li
                        key={season.id}
                        className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0"
                      >
                        <div className="flex flex-col">
                          <span className="flex items-center gap-2 font-medium">
                            {season.name}
                            {/*
                              Three states since POOLSE-45. A draft is neither the
                              season the club is running nor a year that happened,
                              and calling it "past" would be a lie about a plan.
                            */}
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-xs font-normal',
                                season.status === 'published'
                                  ? 'bg-primary/15 text-primary'
                                  : 'bg-surface-muted text-foreground-muted',
                              )}
                            >
                              {t(`seasons.status.${season.status}`)}
                            </span>
                          </span>
                          <span className="text-sm text-foreground-muted">
                            {formatDate(season.startsOn)} — {formatDate(season.endsOn)}
                          </span>
                        </div>
                        <span className="text-sm text-foreground-muted">
                          {t('seasons.countClasses', { count: season.classGroups })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/*
                Past seasons are readable, not restorable. Said on the screen rather
                than left to be discovered, the same way the vacation carry-over rule
                is: an operator who thinks a reset can be pressed twice and undone
                once will press it.
              */}
              <p className="text-sm text-foreground-muted">{t('seasons.pastAreKept')}</p>

              {!data.canManage && (
                <p className="text-sm text-foreground-muted">{t('seasons.readOnly')}</p>
              )}
            </>
          )}

          {current === 'planning' && data.canManage && (
            <SeasonDrafts
              organizationId={data.organizationId}
              seasons={data.seasons}
              suggested={data.suggested}
            />
          )}

          {/* The note again where it bites: beside the button it is about. */}
          {current === 'start' && data.canManage && (
            <>
              <SeasonReset
                organizationId={data.organizationId}
                preview={data.preview}
                suggested={data.suggested}
              />
              <p className="text-sm text-foreground-muted">{t('seasons.pastAreKept')}</p>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}

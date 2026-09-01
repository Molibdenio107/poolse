import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Seasons } from '../../../../../lib/api';
import { mediumDate } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { SeasonReset } from './season-reset';
import { SeasonDrafts } from './season-drafts';
import { PageShell } from '@/components/page-shell';

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
export default async function SeasonsPage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();

  let data: Seasons | null = null;
  let failure: string | null = null;

  try {
    data = await apiFetch<Seasons>('/seasons');
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  return (
    <PageShell
      title={t('seasons.title')}
      subtitle={t('seasons.subtitle')}
      back={{ href: "/dashboard/classes", label: t('seasons.backToClasses') }}
    >


      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {data !== null && (
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
                        {mediumDate(season.startsOn, locale)} — {mediumDate(season.endsOn, locale)}
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

          {data.canManage && (
            <SeasonDrafts
              organizationId={data.organizationId}
              seasons={data.seasons}
              suggested={data.suggested}
            />
          )}

          {data.canManage ? (
            <SeasonReset
              organizationId={data.organizationId}
              preview={data.preview}
              suggested={data.suggested}
            />
          ) : (
            <p className="text-sm text-foreground-muted">{t('seasons.readOnly')}</p>
          )}
        </>
      )}
    </PageShell>
  );
}

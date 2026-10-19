import Link from 'next/link';
import { Download, Upload } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { formatSwimTime } from '@poolse/rules';
import { apiFetch, type QualifyingBoard, type QualifyingStandard } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { DetailPage } from '@/components/detail-page';
import { GapCell } from '@/components/gap-table';
import { PageError, PageShell } from '@/components/page-shell';
import { pickSection, SectionPills, sectionHref } from '@/components/section-pills';
import { ArchiveButton, EditStandardForm, EntryTimesGrid } from '../../qualifying-forms';
import { bandText, windowText } from '../../qualifying-sections';

/**
 * One qualifying standard — POOLSE-85.
 *
 * General (name, window, archive), Tempos (one age group's column of entry
 * times at a time) and Nadadores (the coach's board: who has qualified and who
 * is within a margin). Owner, admin and instructor.
 */

const MARGINS = [1000, 2000, 5000] as const;

export default async function StandardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[]; section?: string | string[]; margin?: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const { tab, section, margin } = await searchParams;
  const t = await getTranslations();
  const path = `/dashboard/students/provas/minimos/${id}`;

  const loaded = await outcome(apiFetch<QualifyingStandard>(`/qualifying/standards/${id}`));
  if (loaded.state === 'failed' && loaded.status !== 404) {
    return (
      <PageShell title={t('qualifying.section.minimos')}>
        <PageError message={t(loaded.failure.key)} />
      </PageShell>
    );
  }
  if (loaded.state !== 'ok') notFound();
  const standard = loaded.data;

  const marginMs = MARGINS.find((value) => String(value) === margin) ?? 2000;

  return (
    <DetailPage
      title={standard.name}
      subtitle={`${standard.seasonName} · ${windowText(t, standard.windowFrom, standard.windowTo)}`}
      back={{ href: '/dashboard/students/provas?section=minimos', label: t('qualifying.backToStandards') }}
      requested={tab}
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () => (
            <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
              <EditStandardForm organizationId={standard.organizationId} standard={standard} />
              {standard.canArchive && (
                <div className="border-t border-border pt-4">
                  <ArchiveButton
                    organizationId={standard.organizationId}
                    id={standard.id}
                    kind="standard"
                    name={standard.name}
                  />
                </div>
              )}
            </section>
          ),
        },
        {
          slug: 'times',
          labelKey: 'qualifying.tab.times',
          content: () => {
            if (standard.ageGroups.length === 0) {
              return (
                <section className="flex flex-col gap-2 rounded border border-border bg-surface p-5">
                  <p>{t('qualifying.noAgeGroupsYet')}</p>
                  <Link
                    href="/dashboard/students/provas?section=escaloes"
                    className="text-primary underline underline-offset-4"
                  >
                    {t('qualifying.goToAgeGroups')}
                  </Link>
                </section>
              );
            }
            const groupIds = standard.ageGroups.map((group) => group.id);
            const groupId = pickSection(groupIds, section, groupIds[0]!);
            const group = standard.ageGroups.find((entry) => entry.id === groupId)!;
            const count = (gid: string): number => standard.times.filter((time) => time.ageGroupId === gid).length;
            return (
              <>
                <TimesToolbar path={path} t={t} />
                <SectionPills
                  label={t('qualifying.ageGroupPills')}
                  current={groupId}
                  items={standard.ageGroups.map((entry) => ({
                    key: entry.id,
                    label:
                      entry.gender === null
                        ? entry.name
                        : `${entry.name} · ${t(entry.gender === 'female' ? 'qualifying.genderFemaleShort' : 'qualifying.genderMaleShort')}`,
                    href: sectionHref(path, { tab: 'times' }, entry.id),
                    count: count(entry.id),
                  }))}
                />
                <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
                  <div className="flex flex-col gap-0.5">
                    <h2 className="font-medium">{group.name}</h2>
                    <p className="text-sm text-foreground-muted">{bandText(t, group)}</p>
                  </div>
                  <EntryTimesGrid
                    key={group.id}
                    organizationId={standard.organizationId}
                    standardId={standard.id}
                    ageGroupId={group.id}
                    times={standard.times.filter((time) => time.ageGroupId === group.id)}
                  />
                </section>
              </>
            );
          },
        },
        {
          slug: 'swimmers',
          labelKey: 'qualifying.tab.swimmers',
          content: async () => {
            const board = await outcome(
              apiFetch<QualifyingBoard>(`/qualifying/standards/${id}/board?margin=${marginMs}`),
            );
            if (board.state !== 'ok') {
              return <PageError message={t(board.state === 'failed' ? board.failure.key : 'detailTabs.loadFailed')} />;
            }
            return <Board board={board.data} path={path} marginMs={marginMs} />;
          },
        },
      ]}
    />
  );
}

async function Board({
  board,
  path,
  marginMs,
}: {
  board: QualifyingBoard;
  path: string;
  marginMs: number;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const seconds = (ms: number): number => ms / 1000;
  const eventName = (row: QualifyingBoard['swimmers'][number]['qualified'][number]): string =>
    `${t('qualifying.eventName', { distance: row.distanceM, stroke: t(`progress.strokes.${row.stroke}`) })} · ${t(
      `qualifying.courseShort.${row.course}`,
    )}`;

  return (
    <>
      <nav aria-label={t('qualifying.margin')} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-foreground-muted">{t('qualifying.margin')}</span>
        {MARGINS.map((value) =>
          value === marginMs ? (
            <span key={value} aria-current="page" className="font-medium">
              {t('qualifying.marginSeconds', { seconds: seconds(value) })}
            </span>
          ) : (
            <Link
              key={value}
              href={`${path}?tab=swimmers&margin=${value}`}
              scroll={false}
              className="text-primary underline underline-offset-4"
            >
              {t('qualifying.marginSeconds', { seconds: seconds(value) })}
            </Link>
          ),
        )}
      </nav>

      <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
        <p className="text-sm text-foreground-muted">{t('qualifying.boardExplain')}</p>
        {board.swimmers.length === 0 ? (
          <p>{t('qualifying.boardEmpty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {board.swimmers.map((swimmer) => (
              <li key={`${swimmer.studentId}-${swimmer.ageGroup}`} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Link
                    href={`/dashboard/students/${swimmer.studentId}/progress`}
                    className="font-medium underline underline-offset-4 hover:text-primary"
                  >
                    {swimmer.name}
                  </Link>
                  <span className="text-sm text-foreground-muted">{swimmer.ageGroup}</span>
                </div>
                {[...swimmer.qualified, ...swimmer.close].length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm">
                    {[...swimmer.qualified, ...swimmer.close].map((row) => (
                      <li
                        key={`${row.stroke}-${row.distanceM}-${row.course}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-0.5"
                      >
                        <span>{eventName(row)}</span>
                        <span className="font-mono text-foreground-muted">
                          {row.bestMs === null ? '' : formatSwimTime(row.bestMs)} / {formatSwimTime(row.entryMs)}
                        </span>
                        <GapCell gapMs={row.gapMs} />
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-sm text-foreground-muted">
                  {[
                    swimmer.qualified.length === 0 && swimmer.close.length === 0
                      ? t('qualifying.nothingClose')
                      : null,
                    swimmer.further > 0 ? t('qualifying.further', { count: swimmer.further }) : null,
                    swimmer.noTime > 0 ? t('qualifying.noTimeCount', { count: swimmer.noTime }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {board.unplaced.length > 0 && (
        <section className="flex flex-col gap-2 rounded border border-border bg-surface p-5">
          <h2 className="font-medium">{t('qualifying.unplacedTitle')}</h2>
          <p className="text-sm text-foreground-muted">{t('qualifying.unplacedExplain')}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {board.unplaced.map((swimmer) => (
              <li key={swimmer.studentId}>
                <Link
                  href={`/dashboard/students/${swimmer.studentId}`}
                  className="underline underline-offset-4 hover:text-primary"
                >
                  {swimmer.name}
                </Link>{' '}
                <span className="text-foreground-muted">
                  — {t(swimmer.reason === 'birthDate' ? 'qualifying.noBirthDate' : 'qualifying.noBandFits')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Import and export of the whole table — slice 2. Links rather than buttons: the
 * import is its own page and the export is a download.
 */
function TimesToolbar({
  path,
  t,
}: {
  path: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}): React.ReactElement {
  const quiet =
    'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted';
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`${path}/importar`} className={quiet}>
        <Upload aria-hidden className="size-4" />
        {t('qualifying.import.open')}
      </Link>
      {(['lcm', 'scm'] as const).map((course) => (
        <a key={course} href={`${path}/export?course=${course}`} className={quiet} download>
          <Download aria-hidden className="size-4" />
          {t('qualifying.import.export', { course: t(`qualifying.courseShort.${course}`) })}
        </a>
      ))}
    </div>
  );
}

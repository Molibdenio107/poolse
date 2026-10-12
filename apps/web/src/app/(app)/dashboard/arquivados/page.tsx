import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CheckCircle2 } from 'lucide-react';
import type { ArchiveEntry, ArchiveKind } from '@/lib/api';
import { formatStamp } from '@/lib/date-format';
import { addDays, today } from '@/lib/dates';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { FilterSelect } from '@/components/filter-select';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { listArchive, listArchiveActors } from './archive.actions';
import { RestoreButton } from './restore-button';

/**
 * Arquivados — POOLSE-78, slice 2.
 *
 * What the club archived, one row per archive action, with *Restaurar* on each
 * row. Reached from the user menu, beside *O meu perfil*, and only offered to an
 * Owner or Admin. The API refuses everybody else whatever the menu shows.
 *
 * The first screen is the last 90 days, so it stays short. Older entries are
 * still listed and restorable under a wider period.
 */

const KINDS: ArchiveKind[] = [
  'student',
  'class_group',
  'student_fee',
  'facility',
  'pool',
  'space',
  'inventory_item',
  'maintenance_task',
  'partner',
];

/** Period filter: '' is the default 90 days. */
const PERIODS = { '': 90, year: 365, all: null } as const;
type Period = keyof typeof PERIODS;

/** A cascade's entity type to its catalogue key under `archive.children`. */
const CHILD_KEYS: Record<string, string> = {
  pool: 'pool',
  class_schedule: 'classSchedule',
  enrollment: 'enrollment',
  'student_fee.ends_on': 'feeLine',
  partner_contact: 'partnerContact',
  partner_group: 'partnerGroup',
};

const BASE = '/dashboard/arquivados';

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; actor?: string; period?: string; page?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const params = await searchParams;
  const page = readPage(params.page);

  const kind = KINDS.includes(params.kind as ArchiveKind) ? (params.kind as ArchiveKind) : null;
  const actor = params.actor?.trim() || null;
  const period: Period = params.period === 'year' || params.period === 'all' ? params.period : '';
  const days = PERIODS[period];
  const from = days === null ? null : addDays(today(), -days);

  const [entries, actors] = await Promise.all([
    listArchive({ kind, actor, from, page }),
    listArchiveActors(),
  ]);

  const query: Record<string, string> = {};
  if (kind !== null) query['kind'] = kind;
  if (actor !== null) query['actor'] = actor;
  if (period !== '') query['period'] = period;

  if (entries.state === 'ok' && isPastEnd(page, entries.data.total, entries.data.limit)) {
    redirect(pageHref(BASE, query, lastPage(entries.data.total, entries.data.limit)));
  }

  const filters =
    entries.state === 'ok' ? (
      <div className="flex flex-wrap items-end gap-4">
        <FilterSelect
          name="kind"
          label={t('archive.filter.kind')}
          value={kind ?? ''}
          anyLabel={t('archive.filter.anyKind')}
          options={KINDS.map((value) => ({ value, label: t(`archive.kind.${value}`) }))}
        />
        <FilterSelect
          name="actor"
          label={t('archive.filter.actor')}
          value={actor ?? ''}
          anyLabel={t('archive.filter.anyActor')}
          options={(actors.state === 'ok' ? actors.data : []).map((one) => ({
            value: one.membershipId,
            label: one.name,
          }))}
        />
        <FilterSelect
          name="period"
          label={t('archive.filter.period')}
          value={period}
          anyLabel={t('archive.filter.last90')}
          options={[
            { value: 'year', label: t('archive.filter.lastYear') },
            { value: 'all', label: t('archive.filter.all') },
          ]}
        />
      </div>
    ) : null;

  return (
    <PageShell title={t('archive.title')} subtitle={t('archive.subtitle')} filters={filters}>
      {entries.state === 'refused' && <PageError message={t('archive.notPermitted')} />}
      {entries.state === 'failed' && (
        <PageError
          message={t(entries.failure.key)}
          {...(entries.failure.detail === '' ? {} : { detail: entries.failure.detail })}
        />
      )}

      {entries.state === 'ok' && entries.data.total === 0 && (
        <PageEmpty
          message={t('archive.empty')}
          hint={period === 'all' ? t('archive.emptyHintAll') : t('archive.emptyHint')}
        />
      )}

      {entries.state === 'ok' && entries.data.total > 0 && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <ul className="flex flex-col divide-y divide-border">
            {entries.data.items.map((entry) => (
              <ArchiveRow key={entry.id} entry={entry} t={t} />
            ))}
          </ul>
          <Pagination page={entries.data} basePath={BASE} query={query} />
        </section>
      )}
    </PageShell>
  );
}

function ArchiveRow({
  entry,
  t,
}: {
  entry: ArchiveEntry;
  t: Awaited<ReturnType<typeof getTranslations>>;
}): React.ReactElement {
  const children = Object.entries(entry.children)
    .filter(([type, count]) => CHILD_KEYS[type] !== undefined && count > 0)
    .map(([type, count]) => t(`archive.children.${CHILD_KEYS[type]!}`, { count }));

  // A fee line has no name of its own: it is somebody's mensalidade.
  const detail = entry.detail === null ? null : t(`fees.kind.${entry.detail}` as never);

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">
          {detail === null ? entry.name : `${detail} · ${entry.name}`}
          <span className="font-normal text-foreground-muted">
            {' · '}
            {t(`archive.kind.${entry.kind}`)}
          </span>
        </p>
        <p className="text-sm text-foreground-muted">
          {t('archive.archivedBy', {
            name: entry.actor?.name || t('archive.someone'),
            at: formatStamp(entry.archivedAt),
          })}
          {children.length > 0 && ` · ${t('archive.withChildren', { list: children.join(', ') })}`}
        </p>
      </div>
      {entry.archived ? (
        <RestoreButton entryId={entry.id} name={entry.name} />
      ) : (
        // Said in words with an icon; nothing here rests on colour.
        <span className="inline-flex items-center gap-1.5 text-sm text-foreground-muted">
          <CheckCircle2 className="size-4" aria-hidden />
          {t('archive.alreadyBack')}
        </span>
      )}
    </li>
  );
}

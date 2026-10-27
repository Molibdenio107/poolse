import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, type Me, type MeetDetail, type MeetResult, type Stroke } from '@/lib/api';
import { describeLoad } from '@/lib/load-failure';
import { formatDate, formatStamp } from '@/lib/date-format';
import { fileUrl } from '@/lib/files';
import { formatTime } from '@/components/progress-chart';
import { FromLink } from '@/components/from-link';
import { PageError } from '@/components/page-shell';
import { PrintButton } from '@/components/print-button';
import { AutoPrint } from '@/components/auto-print';
import { roundKey } from '../../round-key';

/**
 * A meet's results on paper — POOLSE-115.
 *
 * **A print page, not a generated PDF**, the call the water report, the wall
 * timetable and the invoice already made (POOLSE-54): the browser's "Guardar
 * como PDF" from a page laid out for A4.
 *
 * **Its own components, not the meet page with a print patch.** The screen's
 * table carries links, chips and a warning colour; the sheet carries none of
 * them. Black on white whatever the theme, and every mark is a word — *RP*,
 * *Mín.* — so a greyscale copy says everything the screen says with colour.
 *
 * **Each group is its own table**, so `break-inside: avoid` keeps a swimmer
 * together when they fit on a page, and the group's name sits in the `thead`,
 * which the browser repeats on a page a long group continues onto.
 *
 * The options live in the address (`show`, `group`), so the tab reloads and is
 * shared as it is. `print=1` is set only by the meet page's button: arriving
 * from it is the asking, while changing an option is not.
 *
 * Reads `GET /meets/:id`, the meet page's own read, so who may print is who
 * may read the meet — and another club's id is the same 404.
 */

type Show = 'all' | 'pb' | 'min';
type Grouping = 'swimmer' | 'event';

const SHOWS: readonly Show[] = ['all', 'pb', 'min'];
const GROUPINGS: readonly Grouping[] = ['swimmer', 'event'];
/** The FPN's order, and the `swim_stroke` enum's. */
const STROKES: readonly Stroke[] = ['freestyle', 'backstroke', 'breaststroke', 'butterfly', 'medley'];

interface Group {
  key: string;
  title: string;
  rows: MeetResult[];
}

async function clubLogo(): Promise<string | null> {
  try {
    return fileUrl((await apiFetch<{ fileId: string | null }>('/settings/logo')).fileId);
  } catch {
    return null;
  }
}

/** `memberships[0]` is the club being acted in (POOLSE-79). A failure is no name, never no sheet. */
async function clubName(): Promise<string | null> {
  try {
    return (await apiFetch<Me>('/me')).memberships[0]?.organizationName ?? null;
  } catch {
    return null;
  }
}

export default async function MeetPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show?: string; group?: string; print?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;
  const query = await searchParams;
  const show: Show = SHOWS.find((value) => value === query.show) ?? 'all';
  const grouping: Grouping = GROUPINGS.find((value) => value === query.group) ?? 'swimmer';

  let meet: MeetDetail;
  try {
    meet = await apiFetch<MeetDetail>(`/meets/${id}`);
  } catch (error) {
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
    const failure = describeLoad(error);
    return (
      <main className="p-6">
        <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />
      </main>
    );
  }
  const [logo, club] = await Promise.all([clubLogo(), clubName()]);

  const event = (result: MeetResult): string =>
    `${result.distanceM} m ${t(`progress.strokes.${result.stroke}`)}`;
  const round = (result: MeetResult): string | null =>
    result.round === null || result.round === 'TIM' ? null : t(`meets.round.${roundKey(result.round)}`);
  const marks = (result: MeetResult): string[] => [
    ...(result.isPersonalBest ? [t('meets.print.pb')] : []),
    ...result.qualifies.map((name) => t('meets.print.min', { name })),
  ];

  const kept = meet.results.filter((result) =>
    show === 'pb' ? result.isPersonalBest : show === 'min' ? result.qualifies.length > 0 : true,
  );
  const groups = grouping === 'swimmer' ? bySwimmer(kept) : byEvent(kept, event);
  const showAgeGroups = kept.some((result) => result.ageGroups.length > 0);
  const swimmers = new Set(meet.results.map((result) => result.studentId)).size;
  const unmatched = meet.unmatched.reduce((sum, athlete) => sum + athlete.results, 0);

  const generated = t('meets.print.generated', { at: formatStamp(new Date()) });
  const href = (next: { show?: Show; group?: Grouping }): string => {
    const params = new URLSearchParams();
    const s = next.show ?? show;
    const g = next.group ?? grouping;
    if (s !== 'all') params.set('show', s);
    if (g !== 'swimmer') params.set('group', g);
    const search = params.toString();
    return `/dashboard/students/provas/${meet.id}/print${search === '' ? '' : `?${search}`}`;
  };

  const option = (label: string, active: boolean, to: string): React.ReactElement => (
    <FromLink
      key={label}
      href={to}
      aria-current={active ? 'true' : undefined}
      className={`inline-flex h-control items-center justify-center rounded border px-4 text-control ${
        active ? 'border-black bg-black text-white' : 'border-black/40 text-black hover:border-black'
      }`}
    >
      {label}
    </FromLink>
  );

  return (
    <main className="mx-auto max-w-[210mm] bg-white p-6 text-[10pt] leading-snug text-black print:max-w-none print:p-0">
      <style>{`
        @page {
          size: A4 portrait;
          margin: 14mm 14mm 18mm;
          @bottom-left { content: ${JSON.stringify(generated)}; font-size: 8pt; }
          @bottom-right { content: counter(page) " / " counter(pages); font-size: 8pt; }
        }
        @media print {
          thead { display: table-header-group; }
          .sheet-group { break-inside: avoid; page-break-inside: avoid; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      {query.print === '1' && <AutoPrint />}

      <div className="mb-6 flex flex-col gap-3 print:hidden">
        <div>
          <PrintButton label={t('export.pdf.printLabel')} />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('meets.print.showLabel')}>
          <span className="text-sm">{t('meets.print.showLabel')}</span>
          {SHOWS.map((value) => option(t(`meets.print.show.${value}`), value === show, href({ show: value })))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('meets.print.groupLabel')}>
          <span className="text-sm">{t('meets.print.groupLabel')}</span>
          {GROUPINGS.map((value) =>
            option(t(`meets.print.group.${value}`), value === grouping, href({ group: value })),
          )}
        </div>
      </div>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-4 border-b border-black/40 pb-3">
        <div>
          {club !== null && <p className="font-medium">{club}</p>}
          <h1 className="text-[16pt] font-bold">{meet.name}</h1>
          <p className="mt-0.5">
            {[
              meet.startsOn === meet.endsOn
                ? formatDate(meet.startsOn)
                : `${formatDate(meet.startsOn)} — ${formatDate(meet.endsOn)}`,
              meet.city,
              meet.course === null ? null : t(`progress.course.${meet.course}`),
              meet.official ? t('progress.official') : t('meets.friendly'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="mt-0.5">
            {t('meets.print.counts', { swimmers, results: meet.results.length })}
            {show !== 'all' && <> · {t(`meets.print.showing.${show}`)}</>}
          </p>
        </div>
        {logo !== null && (
          // eslint-disable-next-line @next/next/no-img-element -- streamed through /files/:id
          <img src={logo} alt={t('files.logoAlt')} className="h-14 w-auto max-w-40 object-contain" />
        )}
      </header>

      {meet.results.length === 0 ? (
        <p>{t('meets.print.empty')}</p>
      ) : groups.length === 0 ? (
        <p>{t(`meets.print.emptyFiltered.${show}`)}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <table key={group.key} className="sheet-group w-full table-fixed border-collapse text-left">
              {/* Fixed widths, so the columns line up from one group to the next. */}
              <colgroup>
                <col className={showAgeGroups ? 'w-[36%]' : 'w-[44%]'} />
                <col className="w-[13%]" />
                {showAgeGroups && <col className="w-[15%]" />}
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th colSpan={showAgeGroups ? 4 : 3} scope="colgroup" className="pb-1 text-[11pt] font-semibold">
                    {group.title}
                  </th>
                </tr>
                <tr className="border-b border-black/60 text-[9pt]">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {grouping === 'swimmer' ? t('meets.column.event') : t('meets.column.swimmer')}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t('meets.column.time')}</th>
                  {showAgeGroups && (
                    <th scope="col" className="py-1 pr-3 font-medium">{t('meets.print.ageGroup')}</th>
                  )}
                  <th scope="col" className="py-1 font-medium">{t('meets.print.obs')}</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((result) => {
                  const phase = round(result);
                  return (
                    <tr key={result.recordId} className="border-b border-black/20">
                      <td className="py-1 pr-3">
                        {grouping === 'swimmer' ? event(result) : result.studentName}
                        {phase !== null && <span className="text-black/70"> · {phase}</span>}
                      </td>
                      <td className="py-1 pr-3 font-mono tabular-nums">{formatTime(result.timeMs)}</td>
                      {showAgeGroups && <td className="py-1 pr-3">{result.ageGroups.join(', ')}</td>}
                      <td className="py-1">{marks(result).join(' · ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        </div>
      )}

      <footer className="mt-6 flex flex-col gap-1 border-t border-black/40 pt-2 text-[9pt]">
        {unmatched > 0 && <p>{t('meets.print.unmatched', { count: unmatched })}</p>}
        <p>{t('meets.print.legend')}</p>
        {/* On paper the page's margin carries this line; on screen it is here. */}
        <p className="print:hidden">{generated}</p>
      </footer>
    </main>
  );
}

const collator = new Intl.Collator('pt', { sensitivity: 'base' });

function eventOrder(a: MeetResult, b: MeetResult): number {
  return (
    STROKES.indexOf(a.stroke) - STROKES.indexOf(b.stroke) ||
    a.distanceM - b.distanceM ||
    (a.course ?? '').localeCompare(b.course ?? '') ||
    a.timeMs - b.timeMs
  );
}

/** Swimmers in alphabetical order of the name as the club writes it (POOLSE-32); events in FPN order. */
function bySwimmer(results: MeetResult[]): Group[] {
  const groups = new Map<string, Group>();
  for (const result of results) {
    const group = groups.get(result.studentId) ?? { key: result.studentId, title: result.studentName, rows: [] };
    group.rows.push(result);
    groups.set(result.studentId, group);
  }
  return [...groups.values()]
    .sort((a, b) => collator.compare(a.title, b.title))
    .map((group) => ({ ...group, rows: group.rows.sort(eventOrder) }));
}

/** Events in FPN order; swimmers by time within each. */
function byEvent(results: MeetResult[], title: (result: MeetResult) => string): Group[] {
  const groups = new Map<string, Group>();
  for (const result of [...results].sort(eventOrder)) {
    const key = `${result.stroke}|${result.distanceM}|${result.course ?? ''}`;
    const group = groups.get(key) ?? { key, title: title(result), rows: [] };
    group.rows.push(result);
    groups.set(key, group);
  }
  return [...groups.values()];
}

import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ApiError, apiFetch, type PoolDetail } from '@/lib/api';
import { POOL_METRICS, type PoolMetric } from '@/lib/pool-metrics';
import { PrintButton } from './print-button';

/**
 * The water-quality report — round 4.
 *
 * **A print page, not a generated PDF.** The obvious alternative is a PDF
 * library, and it was weighed and rejected: it means a dependency, a second
 * layout engine that knows nothing about the app's tokens or its two themes, and
 * a font-embedding problem the first time somebody's pool is called "Piscina
 * Municipal de Óbidos". Every browser already has a mature PDF writer behind
 * Ctrl+P, and "Save as PDF" from a page laid out for paper produces a better
 * document than a hand-built one — selectable text, real fonts, correct
 * accents, and the club's own page size.
 *
 * So this is an ordinary route with print styles. It opens in its own tab and
 * offers the print dialog on arrival.
 *
 * **It is deliberately monochrome and unstyled by the theme.** A report is
 * printed and filed or emailed to the câmara; dark mode's surface tokens would
 * render as a black rectangle on paper, and the primary teal costs colour toner
 * to say nothing. Explicit black on white, and the only rule about colour is
 * that there is none.
 *
 * No `PageShell`, no sidebar, no back link — the surrounding chrome is exactly
 * what nobody wants on the printout.
 */
export default async function AnalysisReportPage({
  params,
}: {
  params: Promise<{ poolId: string }>;
}): Promise<React.ReactElement> {
  const { poolId } = await params;
  const t = await getTranslations();
  const format = await getFormatter();

  let pool: PoolDetail & { organizationId: string; analyses: PoolAnalysisRow[] };
  try {
    pool = await apiFetch(`/pools/${poolId}`);
  } catch (error) {
    // A 404 is a pool that is not this tenant's, which is the same answer.
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const analyses = pool.analyses;

  // Only the columns this pool has readings for — nine columns of which six are
  // empty is a table nobody can read, and on paper it is a table nobody can fit.
  const columns = POOL_METRICS.filter((metric) =>
    analyses.some((analysis) => analysis.values.some((value) => value.metric === metric)),
  );

  const unitFor = (metric: PoolMetric): string =>
    analyses.flatMap((a) => a.values).find((value) => value.metric === metric)?.unit ?? '';

  return (
    <main className="mx-auto max-w-4xl bg-white p-8 text-black print:p-0">
      {/*
        `print:hidden` is the whole reason this control can exist on the page it
        prints: the button is on screen and absent from the paper.
      */}
      <div className="mb-6 print:hidden">
        <PrintButton label={t('facilities.printReport')} />
      </div>

      <header className="mb-6 border-b border-black/30 pb-4">
        <h1 className="text-2xl font-semibold">{t('facilities.reportTitle')}</h1>
        <p className="mt-1 text-sm">
          {pool.facilityName} — {pool.name}
        </p>
        <p className="mt-0.5 text-sm">
          {t('facilities.reportGenerated', {
            date: format.dateTime(new Date(), { dateStyle: 'long', timeStyle: 'short' }),
          })}
        </p>
      </header>

      {analyses.length === 0 ? (
        <p className="text-sm">{t('facilities.noAnalyses')}</p>
      ) : (
        <>
          {/*
            A real table, because that is what a report is. `overflow-x-auto`
            for the screen; on paper it simply fits or the browser scales it.
          */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t('facilities.reportTitle')}</caption>
              <thead>
                <tr>
                  <th className="border border-black/30 px-2 py-1 text-left">
                    {t('facilities.analysisTakenAt')}
                  </th>
                  {columns.map((metric) => (
                    <th key={metric} className="border border-black/30 px-2 py-1 text-left">
                      {t(`facilities.metric.${metric}`)}
                      <span className="block font-normal">({unitFor(metric)})</span>
                    </th>
                  ))}
                  <th className="border border-black/30 px-2 py-1 text-left">
                    {t('facilities.analysisNotes')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {analyses.map((analysis) => (
                  <tr key={analysis.id}>
                    <td className="whitespace-nowrap border border-black/30 px-2 py-1">
                      {format.dateTime(new Date(analysis.takenAt), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    {columns.map((metric) => {
                      const found = analysis.values.find((value) => value.metric === metric);
                      return (
                        <td key={metric} className="border border-black/30 px-2 py-1">
                          {/*
                            An em dash, not a blank and not a zero: "not measured
                            in this analysis" is a different fact from a reading
                            of nothing, and on a compliance report the difference
                            matters.
                          */}
                          {found === undefined ? '—' : found.value}
                        </td>
                      );
                    })}
                    <td className="border border-black/30 px-2 py-1">{analysis.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs">
            {t('facilities.reportCount', { count: analyses.length })}
          </p>
        </>
      )}
    </main>
  );
}

/** The shape this page reads. Declared locally so the report cannot silently
 *  start depending on more of the pool than it prints. */
interface PoolAnalysisRow {
  id: string;
  takenAt: string;
  notes: string | null;
  values: { metric: PoolMetric; value: number; unit: string }[];
}

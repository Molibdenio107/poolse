'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import type { PoolAnalysis } from '@/lib/api';
import type { Excursion } from '@/lib/water';
import { excursionText } from '@/lib/excursion-text';
import { toCsv } from '@/lib/csv';

/**
 * "This water is out of range — do you want to shut the pool?"
 *
 * **It offers, it never acts.** The readings say a band was crossed; only the
 * operator knows whether that means "dose it and retest in an hour" or "nobody
 * swims today".
 *
 * **It names the reading.** An operator about to close a pool needs to know it
 * was the combined chlorine at 0.9 ppm against a ceiling of 0.6, not that
 * something was wrong. That is also what ends up in the closure's reason, so the
 * calendar still explains itself in six months.
 *
 * **It sends them to Encerramentos rather than asking for a number of days —
 * round 6.** This used to be a "how many days?" box that made the closure from
 * here. Two things were wrong with it. An operator dosing a pool does not
 * actually think "three days" — they think "shut it Tuesday and Wednesday, we
 * have galas at the weekend", which is a calendar question and there is a
 * calendar for it. And the closure it made was invisible until you went and
 * looked, on the very screen this now opens.
 *
 * So the link carries the pool and the failed metrics, and the closures calendar
 * composes the same sentence and pre-fills the form once days are picked. It
 * carries `from` as well, so Voltar there comes back to this pool rather than to
 * the calendar's own parent.
 *
 * The closure that results is an ordinary one — the same endpoint, the same
 * table, removable like any other. Nothing here is a second kind of closure.
 */
export function UnsafeWaterNotice({
  poolId,
  excursions,
}: {
  poolId: string;
  excursions: Excursion[];
}): React.ReactElement | null {
  const t = useTranslations();

  if (excursions.length === 0) return null;

  /*
   * Machine keys in the query string, never the composed sentence.
   *
   * The reason is a translated string, and a translated string in a URL is wrong
   * the moment somebody switches locale mid-journey — `back.ts` makes the same
   * argument about back-link labels. The metrics travel as their own names and
   * the closures page builds the sentence in the reader's language.
   */
  const target =
    `/dashboard/calendar/closures` +
    `?poolId=${encodeURIComponent(poolId)}` +
    `&water=${encodeURIComponent(excursions.map((excursion) => excursion.metric).join(','))}` +
    `&from=${encodeURIComponent(`/dashboard/facilities/pools/${poolId}`)}`;

  return (
    <section className="flex flex-col gap-3 rounded border border-warning/50 bg-warning/10 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm font-medium">{t('facilities.waterOutOfRange')}</h3>

          {/*
            One line per failed reading, with the band it missed. Visible text
            rather than a colour on the chart: colour never carries meaning alone
            in this app, and "out of range" without the number is not actionable.
          */}
          <ul className="flex flex-col gap-0.5 text-sm">
            {excursions.map((excursion) => {
              // Whole range or crossed bound: `excursionText` chooses.
              const text = excursionText(excursion);
              return (
                <li key={excursion.metric}>
                  {t(`facilities.metric.${excursion.metric}`)}: {excursion.value}{' '}
                  {excursion.unit} — {t(text.key, text.values)}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <Link
        href={target}
        className="self-start rounded border border-warning/60 px-3 py-1.5 text-sm transition-colors hover:bg-warning/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('facilities.closePool')}
      </Link>

      {/*
        What the link is about to do, as visible text. "Fechar temporariamente"
        on its own reads as a button that shuts the pool now; this says it opens
        a calendar and that the days are still the operator's to pick.
      */}
      <p className="text-sm text-foreground-muted">{t('facilities.closePoolHint')}</p>
    </section>
  );
}


/**
 * The analyses as a spreadsheet, built in the browser from what is on the page.
 *
 * The PDF report is for sending to the câmara; this is for the person who wants
 * the numbers in Excel. Same CSV conventions as the inventory export — a BOM so
 * Excel reads UTF-8, semicolons because the decimal separator here is a comma.
 */
export function ExportAnalyses({
  analyses,
  poolName,
  metrics,
  headers,
}: {
  analyses: PoolAnalysis[];
  poolName: string;
  /** Only the metrics this pool actually measures, in display order. */
  metrics: { key: string; label: string; unit: string }[];
  headers: { takenAt: string; notes: string; export: string };
}): React.ReactElement {
  const download = (): void => {
    const rows: (string | number | null)[][] = [
      [
        headers.takenAt,
        ...metrics.map((metric) => `${metric.label} (${metric.unit})`),
        headers.notes,
      ],
      ...analyses.map((analysis) => [
        analysis.takenAt,
        ...metrics.map(
          (metric) =>
            analysis.values.find((value) => value.metric === metric.key)?.value ?? '',
        ),
        analysis.notes ?? '',
      ]),
    ];

    // `toCsv` carries the byte-order mark, the semicolons and the CRLF, and is
    // the only thing in the app allowed to write a CSV cell — see `lib/csv.ts`.
    const csv = toCsv(rows.map((row) => row.map((value) => String(value ?? ''))));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download =
      poolName.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() +
      '-' +
      new Date().toISOString().slice(0, 10) +
      '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <button
      type="button"
      onClick={download}
      className="rounded border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {headers.export}
    </button>
  );
}

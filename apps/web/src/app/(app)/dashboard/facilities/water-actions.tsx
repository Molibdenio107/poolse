'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import type { PoolAnalysis } from '@/lib/api';
import type { Excursion } from '@/lib/water';
import { CONTROL_LINE, FIELD_LABEL } from '@/components/ui/field';
import { EntityIcon } from '@/components/entity-icon';
import type { FormState } from '../actions';
import { closePoolForWaterAction } from './facilities.actions';

const INITIAL: FormState = { ok: false };

/**
 * "This water is out of range — do you want to shut the pool?"
 *
 * **It offers, it never acts.** The readings say a band was crossed; only the
 * operator knows whether that means "dose it and retest in an hour" or "nobody
 * swims today". So this is a warning with a button, and the number of days is
 * typed rather than assumed — a default of one would be a recommendation this
 * code has no business making.
 *
 * **It names the reading.** An operator about to close a pool for three days
 * needs to know it was the combined chlorine at 0.9 ppm against a ceiling of
 * 0.6, not that something was wrong. That is also what goes into the closure's
 * reason, so the calendar still explains itself in six months.
 *
 * The closure it creates is an ordinary one — the same endpoint, the same table,
 * visible on Encerramentos like any other, and removable there. Nothing here is
 * a second kind of closure.
 */
export function UnsafeWaterNotice({
  organizationId,
  poolId,
  poolName,
  excursions,
}: {
  organizationId: string;
  poolId: string;
  poolName: string;
  excursions: Excursion[];
}): React.ReactElement | null {
  const t = useTranslations();
  const [state, action, pending] = useActionState(closePoolForWaterAction, INITIAL);
  const [open, setOpen] = useState(false);

  if (excursions.length === 0) return null;

  // The reason, composed here so the calendar carries the same sentence the
  // operator was shown before they agreed to it.
  const reason = t('facilities.closureReason', {
    pool: poolName,
    metric: excursions
      .map((excursion) => t(`facilities.metric.${excursion.metric}`))
      .join(', '),
  });

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
            {excursions.map((excursion) => (
              <li key={excursion.metric}>
                {t(`facilities.metric.${excursion.metric}`)}: {excursion.value}{' '}
                {excursion.unit} —{' '}
                {t(
                  excursion.direction === 'high'
                    ? 'facilities.aboveRange'
                    : 'facilities.belowRange',
                  { from: excursion.from, to: excursion.to },
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="self-start rounded border border-warning/60 px-3 py-1.5 text-sm transition-colors hover:bg-warning/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('facilities.closePool')}
        </button>
      ) : (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="poolId" value={poolId} />
          <input type="hidden" name="reason" value={reason} />

          <div className="flex w-28 flex-col gap-1.5">
            <label htmlFor="closure-days" className={FIELD_LABEL}>
              {t('facilities.closureDays')}
            </label>
            {/*
              No default. A number already in the box is a recommendation, and
              nothing here knows how long this pool needs.
            */}
            <input
              id="closure-days"
              name="days"
              type="number"
              min={1}
              max={365}
              required
              className={CONTROL_LINE}
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
          >
            {pending ? t('common.working') : t('facilities.confirmClosePool')}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-border px-3 py-1.5 text-sm"
          >
            {t('common.cancel')}
          </button>

          <p className="w-full text-sm text-foreground-muted">
            {t('facilities.closureFromToday')}
          </p>

          {state.errorKey !== undefined && (
            <p className="w-full text-sm text-danger">{t(state.errorKey)}</p>
          )}
        </form>
      )}
    </section>
  );
}

/**
 * Importing a lab's analysis sheet — present, styled, and switched off.
 *
 * The same treatment the photo and logo controls get, for the same reason: a
 * button that opens a file picker and then discards the file is worse than one
 * that is plainly off and says why. Two things are missing rather than one, and
 * both are named — object storage to keep the file, and the parsing that would
 * read values out of a PDF a laboratory sends. An operator who knows that stops
 * looking for the feature and types the four numbers instead, which is what the
 * form beside it is for.
 */
export function ImportAnalysis(): React.ReactElement {
  const t = useTranslations();

  return (
    <div className="flex flex-col items-start gap-2 rounded border border-dashed border-border bg-surface-muted p-4">
      <button
        type="button"
        disabled
        className="inline-flex cursor-not-allowed items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-sm text-foreground-muted opacity-60"
      >
        <EntityIcon kind="photo" />
        {t('facilities.importAnalysis')}
      </button>

      {/*
        Both reasons, as visible text. "Not available" without the why reads as a
        bug; naming the two things it waits on makes it a roadmap item.
      */}
      <ul className="list-inside list-disc text-sm text-foreground-muted">
        <li>{t('facilities.importNoStorage')}</li>
        <li>{t('facilities.importNoParsing')}</li>
      </ul>

      <p className="text-sm text-foreground-muted">{t('facilities.importMeanwhile')}</p>
    </div>
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
    const cell = (value: string | number | null): string =>
      '"' + String(value ?? '').replace(/"/g, '""') + '"';

    const rows = [
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

    const csv = rows.map((row) => row.map(cell).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
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

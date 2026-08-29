'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { POOL_METRICS } from '@/lib/pool-metrics';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL, TextField } from '@/components/ui/field';
import type { FormState } from '../actions';
import { archiveAnalysisAction, recordAnalysisAction } from './facilities.actions';

const INITIAL: FormState = { ok: false };

/**
 * Recording an analysis — round 4.
 *
 * **All nine metrics, all optional, one form.** A club tests pH and free
 * chlorine weekly and sends a full panel to a lab twice a season, so the common
 * case is three boxes filled and six left blank. Asking which metrics were
 * measured before showing the fields would put a step in front of the frequent
 * case to tidy up the rare one; the server drops the blanks instead.
 *
 * **Units are labels, not inputs.** The unit for a metric is fixed and the
 * server looks it up — there is no control here that could put a pH in ppm.
 *
 * `TextField` for the moment and the notes, plain inputs for the nine numbers:
 * a nine-column grid of labelled `TextField`s would be nine max-width columns
 * and a very tall form, and these need to read as a panel of numbers.
 */
export function AnalysisForm({
  organizationId,
  poolId,
  poolName,
}: {
  organizationId: string;
  poolId: string;
  poolName: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(recordAnalysisAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4 rounded border border-border bg-surface-muted p-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="poolId" value={poolId} />

      <h3 className="text-sm font-medium">{t('facilities.recordAnalysis', { pool: poolName })}</h3>

      <div className="flex flex-wrap gap-4">
        {/*
          `datetime-local`, not a date: two analyses on either side of a chlorine
          dose on the same afternoon are exactly what the trend is for, and a
          date-only field would collide them on the unique index.
        */}
        <TextField
          name="takenAt"
          label={t('facilities.analysisTakenAt')}
          type="datetime-local"
          className="w-56"
        />
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm text-foreground-muted">
          {t('facilities.analysisMeasurements')}
        </legend>

        {POOL_METRICS.map((metric) => (
          <div key={metric} className={FIELD_COLUMN}>
            <label htmlFor={`metric-${metric}`} className={FIELD_LABEL}>
              {t(`facilities.metric.${metric}`)}{' '}
              <span className="text-foreground-muted">({t(`facilities.unit.${metric}`)})</span>
            </label>
            <input
              id={`metric-${metric}`}
              name={metric}
              type="number"
              step="0.001"
              min={0}
              {...(metric === 'ph' ? { max: 14 } : {})}
              className={CONTROL_LINE}
            />
          </div>
        ))}
      </fieldset>

      <TextField
        name="notes"
        label={t('facilities.analysisNotes')}
        maxLength={500}
        hint={t('facilities.analysisNotesHint')}
        className="max-w-form"
      />

      {state.errorKey !== undefined && (
        <p className="text-sm text-danger">{t(state.errorKey)}</p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('facilities.saveAnalysis')}
        </button>
      </div>
    </form>
  );
}

/** Soft delete — a mistyped analysis is archived, never destroyed. */
export function ArchiveAnalysisButton({
  organizationId,
  poolId,
  analysisId,
}: {
  organizationId: string;
  poolId: string;
  analysisId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useActionState(archiveAnalysisAction, INITIAL);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="poolId" value={poolId} />
      <input type="hidden" name="analysisId" value={analysisId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={t('facilities.archiveAnalysis')}
        title={t('facilities.archiveAnalysis')}
        className="rounded p-1 text-foreground-muted transition-colors hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
      >
        <Trash2 aria-hidden className="size-4" />
      </button>
    </form>
  );
}

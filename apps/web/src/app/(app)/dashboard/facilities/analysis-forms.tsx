'use client';

import { useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { POOL_METRICS, type PoolMetric } from '@/lib/pool-metrics';
import { HEALTHY, type BandOverride } from '@/lib/water';
import {
  CONTROL_LINE,
  FIELD_COLUMN,
  FIELD_LABEL,
  SelectField,
  TextField,
} from '@/components/ui/field';
import type { FormState } from '../actions';
import {
  archiveAnalysisAction,
  recordAnalysisAction,
  savePoolRangesAction,
} from './facilities.actions';

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
  const [state, action, pending] = useSavedAction(recordAnalysisAction, INITIAL);

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
  const [, action, pending] = useSavedAction(archiveAnalysisAction, INITIAL);

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

/**
 * What this tank's water is supposed to look like — slice 4.2, second half.
 *
 * The published bands are the ones a Portuguese municipal pool is inspected
 * against, and for most clubs they are simply right. They are wrong for a hotel
 * tank kept at 30 °C, which is outside the temperature band every day of its
 * life — before this form, that pool alerted every day until somebody stopped
 * reading the alerts.
 *
 * **Three states per metric, said out loud rather than inferred from empty
 * boxes.** "Use the reference", "these numbers" and "do not judge this here" are
 * three different instructions and two of them look identical as a pair of blank
 * inputs, so the mode is a control of its own. The action refuses an own
 * interval with nothing in it rather than quietly reading it as the third.
 *
 * **A metric with no published band gets two states, not three**, because
 * "reference" and "do not judge" would mean the same thing: nothing publishes a
 * band for cyanuric acid, so leaving it alone already judges nothing. A club that
 * does test it can still give it numbers, which is the case this form adds
 * beyond the overrides it was built for.
 *
 * `HEALTHY` is read here for a *label* — "(7.2–7.6)" beside the reference option
 * — and never to judge a reading. The judging map comes resolved from the API,
 * which is what keeps this screen and the alert email in agreement.
 *
 * Text inputs with `inputMode="decimal"`, not `type="number"`: a number input
 * refuses silently and the form then does nothing with no explanation, which is
 * POOLSE-QA-07. A decimal comma is accepted and turned into a number by the
 * action, as every importer here does.
 */
export function SafeRangesForm({
  organizationId,
  poolId,
  overrides,
}: {
  organizationId: string;
  poolId: string;
  overrides: BandOverride[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(savePoolRangesAction, INITIAL);

  /*
   * Re-seeded when the server's answer changes, and not otherwise.
   *
   * The same rule the field components follow: without it a save that succeeds
   * leaves the selects showing what they showed before it, and with a naive
   * `useState(initial)` a reverted metric would spring back to Personalizado.
   */
  const seed = overrides
    .map((one) => `${one.metric}:${one.from ?? ''}:${one.to ?? ''}`)
    .join('|');
  const [seeded, setSeeded] = useState(seed);
  const [modes, setModes] = useState(() => modesFrom(overrides));

  if (seed !== seeded) {
    setSeeded(seed);
    setModes(modesFrom(overrides));
  }

  const overrideFor = (metric: PoolMetric): BandOverride | undefined =>
    overrides.find((one) => one.metric === metric);

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded border border-border bg-surface-muted p-4"
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="poolId" value={poolId} />

      <p className="text-sm text-foreground-muted">{t('facilities.rangesHint')}</p>

      <ul className="flex flex-col divide-y divide-border">
        {POOL_METRICS.map((metric) => {
          const published = HEALTHY[metric];
          const mode = modes[metric] ?? 'reference';
          const override = overrideFor(metric);

          return (
            <li key={metric} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
              <span className="flex w-full max-w-52 flex-col">
                <span className="text-sm font-medium">{t(`facilities.metric.${metric}`)}</span>
                <span className="text-sm text-foreground-muted">
                  {t(`facilities.unit.${metric}`)}
                </span>
              </span>

              <SelectField
                name={`mode-${metric}`}
                label={t('facilities.rangeMode')}
                initial={mode}
                onValueChange={(value) => setModes({ ...modes, [metric]: value })}
                className="max-w-56"
                options={
                  published === undefined
                    ? [
                        { value: 'reference', label: t('facilities.rangeNone') },
                        { value: 'custom', label: t('facilities.rangeCustom') },
                      ]
                    : [
                        {
                          value: 'reference',
                          label: t('facilities.rangeReference', {
                            from: published.from,
                            to: published.to,
                          }),
                        },
                        { value: 'custom', label: t('facilities.rangeCustom') },
                        { value: 'off', label: t('facilities.rangeOff') },
                      ]
                }
              />

              {/*
                Rendered only for an own interval. Nine metrics × two boxes shown
                always would be eighteen number fields on a panel whose usual
                answer is "leave it alone".
              */}
              {mode === 'custom' && (
                <div className="flex flex-wrap gap-3">
                  <TextField
                    name={`min-${metric}`}
                    label={t('facilities.rangeMin')}
                    initial={override?.from === null || override?.from === undefined ? '' : String(override.from)}
                    inputMode="decimal"
                    error={
                      state.fields?.[`min-${metric}`] === undefined
                        ? undefined
                        : t(state.fields[`min-${metric}`] as string)
                    }
                    className="max-w-28"
                  />
                  <TextField
                    name={`max-${metric}`}
                    label={t('facilities.rangeMax')}
                    initial={override?.to === null || override?.to === undefined ? '' : String(override.to)}
                    inputMode="decimal"
                    error={
                      state.fields?.[`max-${metric}`] === undefined
                        ? undefined
                        : t(state.fields[`max-${metric}`] as string)
                    }
                    className="max-w-28"
                  />
                </div>
              )}

              {/*
                What the choice means, as visible text beside it. "Não avisar" on
                its own reads as a preference; this says what stops happening.
              */}
              {mode === 'off' && (
                <p className="text-sm text-foreground-muted sm:max-w-64">
                  {t('facilities.rangeOffHint')}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-control rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('facilities.saveRanges')}
        </button>
      </div>
    </form>
  );
}

/**
 * Which of the three states each metric is in, from the rows the API sent.
 *
 * A metric with no row is on the reference; a row with neither bound is switched
 * off; anything else is an own interval. Exactly the reading `resolveBands`
 * makes on the server, which is why the two must not disagree — this decides
 * what a form shows, that one decides what a reading is judged by.
 */
function modesFrom(overrides: BandOverride[]): Record<string, string> {
  const modes: Record<string, string> = {};

  for (const override of overrides) {
    modes[override.metric] =
      override.from === null && override.to === null ? 'off' : 'custom';
  }

  return modes;
}

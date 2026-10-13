'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { SelectField, TextAreaField, TextField, useFocusFirstError } from '@/components/ui/field';
import { POOL_METRICS } from '@/lib/pool-metrics';
import { ORGANISMS, ORGANISM_UNITS } from '@/lib/water';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../actions';
import { archiveLabResultAction, recordLabResultAction } from './lab.actions';

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center rounded border border-border px-4 text-control hover:bg-surface-muted disabled:opacity-60';

/**
 * Record a laboratory report — POOLSE-72.
 *
 * Controlled fields throughout (`TextField`), so a refused save keeps every
 * number typed: a lab sheet has sixteen of them. A blank box is a parameter the
 * lab did not report and is not sent — never as zero. Text inputs with a
 * decimal keyboard, not `type="number"`, which refuses silently.
 */
export function LabResultForm({ poolId }: { poolId: string }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(recordLabResultAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);
  const error = (field: string): string | undefined => {
    const key = state.fields?.[field];
    return key === undefined ? undefined : t(key, state.values ?? {});
  };

  return (
    <details className="group rounded border border-border">
      <summary className="cursor-pointer list-none p-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {t('labResults.record')}
      </summary>
      <form ref={formRef} action={dispatch} className="flex flex-col gap-5 border-t border-border p-4">
        <input type="hidden" name="poolId" value={poolId} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            name="sampledAt"
            type="datetime-local"
            label={t('labResults.sampledAtLabel')}
            required
            error={error('sampledAt')}
          />
          <TextField name="laboratory" label={t('labResults.laboratory')} maxLength={200} error={error('laboratory')} />
          <TextField
            name="reportReference"
            label={t('labResults.reportReference')}
            maxLength={100}
            error={error('reportReference')}
          />
          <TextField
            name="samplePoint"
            label={t('labResults.samplePoint')}
            hint={t('labResults.samplePointHint')}
            maxLength={100}
            error={error('samplePoint')}
          />
          <SelectField
            name="sampleDepth"
            label={t('labResults.sampleDepth')}
            options={[
              { value: '', label: t('labResults.depth.unknown') },
              { value: 'surface', label: t('labResults.depth.surface') },
              { value: 'subsurface', label: t('labResults.depth.subsurface') },
            ]}
          />
        </div>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium">{t('labResults.microbiology')}</legend>
          {ORGANISMS.map((organism) => (
            <TextField
              key={organism}
              name={`value-${organism}`}
              label={`${t(`labResults.parameter.${organism}`)} (${ORGANISM_UNITS[organism]})`}
              inputMode="decimal"
              error={error(organism)}
            />
          ))}
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <legend className="mb-1 text-sm font-medium">{t('labResults.chemistry')}</legend>
          {POOL_METRICS.map((metric) => (
            <TextField
              key={metric}
              name={`value-${metric}`}
              label={`${t(`facilities.metric.${metric}`)} (${t(`facilities.unit.${metric}`)})`}
              inputMode="decimal"
              error={error(metric)}
            />
          ))}
        </fieldset>
        {error('values') !== undefined && (
          <p role="alert" className="text-sm text-danger">{error('values')}</p>
        )}

        <TextAreaField name="notes" label={t('labResults.notes')} maxLength={2000} />

        <div>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-60"
          >
            {pending ? t('common.working') : t('labResults.save')}
          </button>
        </div>
      </form>
    </details>
  );
}

/** Archived, never deleted — a correction is a new report. Owner and admin. */
export function ArchiveLabResultButton({
  poolId,
  labResultId,
}: {
  poolId: string;
  labResultId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, dispatch, pending] = useSavedAction(archiveLabResultAction, INITIAL);
  return (
    <form action={dispatch}>
      <input type="hidden" name="poolId" value={poolId} />
      <input type="hidden" name="labResultId" value={labResultId} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {t('labResults.archive')}
      </button>
    </form>
  );
}

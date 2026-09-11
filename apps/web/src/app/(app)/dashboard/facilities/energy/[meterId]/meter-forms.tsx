'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import type { EnergyMeter } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import type { FormState } from '../../../actions';
import { METER_KINDS } from '../../energy-panel';
import { archiveMeter, recordReading, removeReading, updateMeter } from '../../energy.actions';

/**
 * The controls on a meter's own page — slice 5.2.
 *
 * Client components because they submit; the page around them is a server
 * component that renders what the API decided, including whether any of these
 * should appear at all.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center gap-1.5 rounded border border-border-strong px-3 text-sm ' +
  'transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

const PRIMARY =
  'h-control rounded bg-primary px-4 text-sm font-medium text-primary-foreground ' +
  'transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in the viewer's clock. */
function localNow(): string {
  const now = new Date();
  const pad = (n: number): string => `${n}`.padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * A figure off the dial.
 *
 * **The date is required and defaults to now**, because a meter is read on a
 * date the bill or the logbook names and the month it lands in is the whole
 * point of the figure. The value is a text field, per POOLSE-QA-07 — a number
 * input refuses silently — and the API names the field when it refuses.
 *
 * A refusal about a dial running backwards arrives with the neighbouring
 * reading in `values`, so the sentence can say "the reading before was 41 235"
 * rather than "invalid".
 */
export function ReadingForm({
  meter,
}: {
  meter: EnergyMeter;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(recordReading, INITIAL);

  const valueError = state.fields?.['value'];

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="facilityId" value={meter.facilityId} />
      <input type="hidden" name="meterId" value={meter.id} />

      <div className="flex flex-wrap gap-4">
        <TextField
          name="value"
          label={t(meter.reads === 'cumulative_index' ? 'energy.valueIndex' : 'energy.valueInterval', { unit: meter.unit })}
          hint={
            meter.reads === 'cumulative_index' && meter.latestValue !== null
              ? t('energy.lastWas', { value: meter.latestValue, unit: meter.unit })
              : undefined
          }
          inputMode="decimal"
          required
          className="w-48"
          {...(valueError === undefined ? {} : { error: t(valueError, state.values ?? {}) })}
        />
        <TextField
          name="takenAt"
          label={t('energy.takenAt')}
          type="datetime-local"
          initial={localNow()}
          required
          className="w-56"
          {...(state.fields?.['takenAt'] === undefined ? {} : { error: t('energy.takenAtInvalid') })}
        />
      </div>

      <TextAreaField name="note" label={t('energy.note')} rows={2} />

      {state.ok === false && state.errorKey !== undefined && (
        <p className="text-sm text-danger">{t(state.errorKey)}</p>
      )}

      <div>
        <button type="submit" disabled={pending} className={PRIMARY}>
          <Check className="mr-1.5 inline size-4" aria-hidden="true" />
          {t('energy.record')}
        </button>
      </div>
    </form>
  );
}

/**
 * Remove one reading from the record.
 *
 * There is no edit: a reading is a claim about a moment. A wrong figure is
 * removed and typed again on the same date, and the next figure is judged
 * against its new neighbours — the trigger reads only live rows.
 */
export function RemoveReading({
  meter,
  takenAt,
}: {
  meter: EnergyMeter;
  takenAt: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(removeReading, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="facilityId" value={meter.facilityId} />
      <input type="hidden" name="meterId" value={meter.id} />
      <input type="hidden" name="takenAt" value={takenAt} />
      <button
        type="submit"
        disabled={pending}
        aria-label={t('energy.removeReading')}
        title={t('energy.removeReading')}
        className="text-foreground-muted transition-colors hover:text-danger disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </form>
  );
}

/**
 * Editing the meter: its name, what it feeds, which tank, the starting index.
 *
 * **Not `reads`.** What a value means was decided when the meter was made, and
 * changing it under a year of readings would make every one of them wrong at
 * once. A meter set up wrong is archived and made again — the button below.
 */
export function MeterAdmin({
  meter,
  pools,
}: {
  meter: EnergyMeter;
  pools: { id: string; name: string }[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(updateMeter, INITIAL);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={meter.facilityId} />
        <input type="hidden" name="meterId" value={meter.id} />
        <input type="hidden" name="reads" value={meter.reads} />

        <TextField
          name="name"
          label={t('energy.name')}
          initial={meter.name}
          required
          {...(state.fields?.['name'] === undefined ? {} : { error: t(state.fields['name']) })}
        />

        <div className="flex flex-wrap gap-4">
          <SelectField
            name="kind"
            label={t('energy.kindLabel')}
            initial={meter.kind}
            options={METER_KINDS.map((kind) => ({ value: kind, label: t(`energy.kind.${kind}`) }))}
          />
          <TextField name="unit" label={t('energy.unit')} initial={meter.unit} className="w-28" />
        </div>

        <SelectField
          name="poolId"
          label={t('energy.pool')}
          initial={meter.poolId ?? ''}
          options={[
            { value: '', label: t('energy.wholeSite') },
            ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
          ]}
        />

        {meter.reads === 'cumulative_index' && (
          <TextField
            name="initialIndex"
            label={t('energy.initialIndex')}
            hint={t('energy.initialIndexHint')}
            initial={meter.initialIndex === null ? '' : String(meter.initialIndex)}
            inputMode="decimal"
            className="w-48"
            {...(state.fields?.['initialIndex'] === undefined ? {} : { error: t('energy.numberInvalid') })}
          />
        )}

        <TextAreaField name="notes" label={t('energy.notes')} initial={meter.notes ?? ''} rows={2} />

        {state.ok === false && state.errorKey !== undefined && (
          <p className="text-sm text-danger">{t(state.errorKey)}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={PRIMARY}>
            {t('common.save')}
          </button>
          <button type="button" onClick={() => setConfirming(true)} className={BUTTON}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t('energy.retire')}
          </button>
        </div>
      </form>

      <ConfirmRetire meter={meter} open={confirming} onClose={() => setConfirming(false)} />
    </div>
  );
}

/** "Are you sure" in the middle of the page — `components/ui/dialog.tsx`, never `window.confirm`. */
function ConfirmRetire({
  meter,
  open,
  onClose,
}: {
  meter: EnergyMeter;
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(archiveMeter, INITIAL);

  if (state.ok && open) onClose();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('energy.retire')}
      description={meter.name}
      closeLabel={t('common.close')}
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={meter.facilityId} />
        <input type="hidden" name="meterId" value={meter.id} />

        <p className="text-sm text-foreground-muted">{t('energy.retireHint')}</p>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            className="h-control rounded bg-danger px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('energy.retire')}
          </button>
          <button type="button" onClick={onClose} className={BUTTON}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

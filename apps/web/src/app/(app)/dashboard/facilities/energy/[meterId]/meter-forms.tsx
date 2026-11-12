'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Archive, Check } from 'lucide-react';
import { ARCHIVE_TRIGGER, ARCHIVE_ICON } from '@/lib/archive-trigger';
import { useSavedAction } from '@/lib/saved';
import type { EnergyMeter } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmButton } from '@/components/confirm-action';
import { SelectField, TextAreaField, TextField, useSuccessKey } from '@/components/ui/field';
import type { FormState } from '../../../actions';
import { METER_CARRIER_OPTIONS, METER_KINDS } from '../../energy-panel';
import { DIAL_DISPLAY_CODE, DIAL_SETS, DIALS_OF } from '@poolse/rules';
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
   'inline-flex h-control items-center justify-center px-4 text-control gap-1.5 rounded transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary bg-surface shadow-card';

const PRIMARY =
   'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

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
  // A fresh, empty form after every saved reading, its date back to now (Rui, 12-11-2026).
  const fresh = useSuccessKey(state);
  const dials = DIALS_OF[meter.dialSet];

  const valueError = state.fields?.['value'];

  return (
    <form key={fresh} action={action} className="flex flex-col gap-4">
      <input type="hidden" name="facilityId" value={meter.facilityId} />
      <input type="hidden" name="meterId" value={meter.id} />

      {/* Two equal columns on one line (Rui, 12-11-2026): the hint below both, so the inputs align. */}
      {/*
        A multi-rate meter is read dial by dial, each named with the code its
        display shows (12-11-2026); the API adds them into the total.
      */}
      {dials.length > 0 && (
        <fieldset className="flex max-w-xl flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('energy.dials.legend', { unit: meter.unit })}</legend>
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
            {dials.map((dial) => {
              const error = state.fields?.[`dial_${dial}`];
              const code = DIAL_DISPLAY_CODE[dial];
              return (
                <TextField
                  key={dial}
                  name={`dial_${dial}`}
                  label={code === null ? t(`energy.dials.name.${dial}`) : `${t(`energy.dials.name.${dial}`)} (${code})`}
                  inputMode="decimal"
                  required
                  {...(error === undefined ? {} : { error: t(error, state.values ?? {}) })}
                />
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="grid max-w-xl grid-cols-1 items-start gap-4 sm:grid-cols-2">
        {dials.length === 0 && (
        <TextField
          name="value"
          label={t(meter.reads === 'cumulative_index' ? 'energy.valueIndex' : 'energy.valueInterval', { unit: meter.unit })}
          inputMode="decimal"
          required
          {...(valueError === undefined ? {} : { error: t(valueError, state.values ?? {}) })}
        />
        )}
        <TextField
          name="takenAt"
          label={t('energy.takenAt')}
          type="datetime-local"
          initial={localNow()}
          required
          {...(state.fields?.['takenAt'] === undefined ? {} : { error: t('energy.takenAtInvalid') })}
        />
      </div>

      {meter.reads === 'cumulative_index' && meter.latestValue !== null && (
        <p className="-mt-2 text-sm text-foreground-muted">
          {dials.length > 0 && meter.latestDials !== null
            ? t('energy.dials.lastWas', {
                list: dials
                  .filter((dial) => meter.latestDials?.[dial] !== undefined)
                  .map((dial) => `${t(`energy.dials.name.${dial}`)} ${meter.latestDials?.[dial]}`)
                  .join(' · '),
                unit: meter.unit,
              })
            : t('energy.lastWas', { value: meter.latestValue, unit: meter.unit })}
        </p>
      )}

      <TextAreaField name="note" label={t('energy.note')} rows={2} className="max-w-xl" />

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
      {/* Asks first (Rui, 04-11-2026). */}
      <ConfirmButton
        title={t('confirm.instalacoes.readingRemoveTitle')}
        message={t('confirm.instalacoes.readingRemoveMessage')}
        confirmLabel={t('common.remove')}
        tone="danger"
        disabled={pending}
        ariaLabel={t('energy.removeReading')}
        className={`${ARCHIVE_TRIGGER} w-control`}
      >
        <Archive aria-hidden className={ARCHIVE_ICON} />
      </ConfirmButton>
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
          <SelectField
            name="carrier"
            label={t('energy.carrierLabel')}
            initial={meter.carrier}
            options={METER_CARRIER_OPTIONS.map((carrier) => ({ value: carrier, label: t(`energy.carrier.${carrier}`) }))}
          />
          <SelectField
            name="dialSet"
            label={t('energy.dials.setLabel')}
            initial={meter.dialSet}
            options={DIAL_SETS.map((set) => ({ value: set, label: t(`energy.dials.set.${set}`) }))}
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

        <div className="flex flex-wrap gap-4">
          <TextField
            name="cpe"
            label={t('energy.cpe')}
            hint={t('energy.cpeHint')}
            initial={meter.cpe ?? ''}
            className="w-64"
            {...(state.fields?.['cpe'] === undefined ? {} : { error: t(state.fields['cpe']) })}
          />
          <TextField name="serial" label={t('energy.serial')} initial={meter.serial ?? ''} className="w-48" />
        </div>

        <TextAreaField name="notes" label={t('energy.notes')} initial={meter.notes ?? ''} rows={2} />

        {state.ok === false && state.errorKey !== undefined && (
          <p className="text-sm text-danger">{t(state.errorKey)}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={PRIMARY}>
            {t('common.save')}
          </button>
          <button type="button" onClick={() => setConfirming(true)} className={ARCHIVE_TRIGGER}>
            <Archive aria-hidden className={ARCHIVE_ICON} />
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
            className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded-sm bg-destructive font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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

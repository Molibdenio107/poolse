'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { formatDate } from '@/lib/date-format';
import type { EnergyMeter, Tariff, TariffProvenance } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import type { FormState } from '../../../actions';
import { correctTariff, removeTariff, setTariff } from '../../energy.actions';

/**
 * The rate that turns this meter's kWh into euros — slice 5.3.
 *
 * It exists for the meter with **no fatura**: a billed meter's euros are a fact
 * from its bill, and a sub-meter behind the club's one ponto de entrega never
 * receives one. So the panel says, in visible text and not in a tooltip, that
 * what it produces is an estimate — `docs/financials.md` §9, and the same
 * honesty the chase list owes about what Poolse has and has not sent.
 *
 * **A new rate is a new row; correcting one is an edit.** The two are separate
 * controls with separate words, because collapsing them is how a price change
 * silently rewrites what last March cost.
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

const PROVENANCES: readonly TariffProvenance[] = ['contracted', 'estimated', 'assumed'];

/** `<input type="date">` wants `YYYY-MM-DD`, which is what the API sends. */
function today(): string {
  const now = new Date();
  const pad = (n: number): string => `${n}`.padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A rate, in the reader's locale, at the precision the club typed it.
 *
 * Six decimal places are stored and up to four are shown — a tariff is quoted
 * in fractions of a cent, so `Intl`'s default of two would render every rate in
 * this product as "0,15 €".
 */
function useRate(): (value: number) => string {
  const format = useFormatter();
  return (value: number): string =>
    format.number(value, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
}

export function TariffPanel({
  meter,
  tariffs,
  canPrice,
}: {
  meter: EnergyMeter;
  tariffs: Tariff[];
  canPrice: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const rate = useRate();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Tariff | null>(null);
  const [removing, setRemoving] = useState<Tariff | null>(null);

  const live = tariffs.find((tariff) => tariff.live) ?? null;

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('energy.tariff.section')}
        </h2>
        {canPrice && !meter.archived && (
          <button type="button" onClick={() => setAdding(true)} className={BUTTON}>
            <Plus className="size-4" aria-hidden="true" />
            {t('energy.tariff.add')}
          </button>
        )}
      </div>

      {/*
        What the panel is for, said once in visible text. Not a tooltip: a
        tooltip may clarify a control and may never be the only place a piece of
        information appears.
      */}
      <p className="text-sm text-foreground-muted">
        {live === null ? t('energy.tariff.noneHint') : t('energy.tariff.estimateHint')}
      </p>

      {live !== null && (
        <p className="text-sm">
          <span className="text-lg font-medium tabular-nums">{rate(live.unitPrice)}</span>{' '}
          <span className="text-foreground-muted">
            {t('energy.tariff.perUnit', { unit: meter.unit })}
            {' · '}
            {t(`energy.tariff.provenance.${live.provenance}`)}
          </span>
        </p>
      )}

      {tariffs.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded border border-border">
          {tariffs.map((tariff) => (
            <li
              key={tariff.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3 text-sm"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>
                  <span className="font-medium tabular-nums">{rate(tariff.unitPrice)}</span>{' '}
                  <span className="text-foreground-muted">/ {meter.unit}</span>
                  {tariff.live && (
                    <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-xs text-foreground-muted">
                      {t('energy.tariff.liveBadge')}
                    </span>
                  )}
                </span>
                <span className="text-xs text-foreground-muted">
                  {tariff.effectiveTo === null
                    ? t('energy.tariff.fromOn', {
                        from: formatDate(new Date(`${tariff.effectiveFrom}T00:00:00`)),
                      })
                    : t('energy.tariff.between', {
                        from: formatDate(new Date(`${tariff.effectiveFrom}T00:00:00`)),
                        to: formatDate(new Date(`${tariff.effectiveTo}T00:00:00`)),
                      })}
                  {' · '}
                  {t(`energy.tariff.provenance.${tariff.provenance}`)}
                  {tariff.unitPriceLow !== null || tariff.unitPriceHigh !== null ? (
                    <>
                      {' · '}
                      {t('energy.tariff.bounds', {
                        low: tariff.unitPriceLow === null ? '—' : rate(tariff.unitPriceLow),
                        high: tariff.unitPriceHigh === null ? '—' : rate(tariff.unitPriceHigh),
                      })}
                    </>
                  ) : null}
                  {tariff.createdByName !== null && ` · ${tariff.createdByName}`}
                  {tariff.note !== null && ` · ${tariff.note}`}
                </span>
              </span>

              {canPrice && !meter.archived && (
                <span className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditing(tariff)}
                    aria-label={t('energy.tariff.correct')}
                    title={t('energy.tariff.correct')}
                    className="text-foreground-muted transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoving(tariff)}
                    aria-label={t('energy.tariff.remove')}
                    title={t('energy.tariff.remove')}
                    className="text-foreground-muted transition-colors hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <TariffDialog
        meter={meter}
        tariff={null}
        open={adding}
        onClose={() => setAdding(false)}
      />
      <TariffDialog
        meter={meter}
        tariff={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <RemoveTariffDialog
        meter={meter}
        tariff={removing}
        open={removing !== null}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

/**
 * One form for both a new rate and a correction to an existing one.
 *
 * Fields are controlled and seeded from the rate being edited, never
 * `defaultValue` — React 19 resets a form when its action returns, including
 * when it returns a validation error, which is exactly when somebody is being
 * asked to fix what they typed (POOLSE-09, POOLSE-10).
 *
 * The dialog is keyed on the rate's id so switching from one row to another
 * remounts it and re-seeds every box, rather than showing the previous rate's
 * figures under the new one's heading.
 */
function TariffDialog({
  meter,
  tariff,
  open,
  onClose,
}: {
  meter: EnergyMeter;
  tariff: Tariff | null;
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(
    tariff === null ? setTariff : correctTariff,
    INITIAL,
  );

  const error = (field: string): { error: string } | Record<string, never> => {
    const key = state.fields?.[field];
    return key === undefined ? {} : { error: t(key, state.values ?? {}) };
  };

  return (
    <Dialog
      key={tariff?.id ?? 'new'}
      open={open}
      onClose={onClose}
      title={t(tariff === null ? 'energy.tariff.add' : 'energy.tariff.correct')}
      description={meter.name}
      closeLabel={t('common.close')}
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={meter.facilityId} />
        <input type="hidden" name="meterId" value={meter.id} />
        {tariff !== null && <input type="hidden" name="tariffId" value={tariff.id} />}

        <TextField
          name="unitPrice"
          label={t('energy.tariff.price', { unit: meter.unit })}
          hint={t('energy.tariff.priceHint')}
          initial={tariff === null ? '' : String(tariff.unitPrice)}
          inputMode="decimal"
          required
          className="w-48"
          {...error('unitPrice')}
        />

        <div className="flex flex-wrap gap-4">
          <TextField
            name="effectiveFrom"
            label={t('energy.tariff.from')}
            type="date"
            initial={tariff?.effectiveFrom ?? today()}
            required
            className="w-44"
            {...error('effectiveFrom')}
          />
          <TextField
            name="effectiveTo"
            label={t('energy.tariff.to')}
            hint={t('energy.tariff.toHint')}
            type="date"
            initial={tariff?.effectiveTo ?? ''}
            className="w-44"
            {...error('effectiveTo')}
          />
        </div>

        <SelectField
          name="provenance"
          label={t('energy.tariff.provenanceLabel')}
          hint={t('energy.tariff.provenanceHint')}
          initial={tariff?.provenance ?? 'contracted'}
          options={PROVENANCES.map((value) => ({
            value,
            label: t(`energy.tariff.provenance.${value}`),
          }))}
        />

        {/*
          The optimistic and pessimistic bounds of a rate that is a guess.
          Nothing reads them yet — they are stored from day one because they are
          the input any later scenario needs, and adding them afterwards means
          touching every money table (docs/financials.md §3).
        */}
        <div className="flex flex-wrap gap-4">
          <TextField
            name="unitPriceLow"
            label={t('energy.tariff.low')}
            initial={tariff?.unitPriceLow === null || tariff === null ? '' : String(tariff.unitPriceLow)}
            inputMode="decimal"
            className="w-40"
            {...error('unitPriceLow')}
          />
          <TextField
            name="unitPriceHigh"
            label={t('energy.tariff.high')}
            initial={tariff?.unitPriceHigh === null || tariff === null ? '' : String(tariff.unitPriceHigh)}
            inputMode="decimal"
            className="w-40"
            {...error('unitPriceHigh')}
          />
        </div>

        <TextAreaField
          name="note"
          label={t('energy.note')}
          rows={2}
          initial={tariff?.note ?? ''}
        />

        {state.ok === false && state.errorKey !== undefined && (
          <p className="text-sm text-danger">{t(state.errorKey)}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={PRIMARY}>
            <Check className="mr-1.5 inline size-4" aria-hidden="true" />
            {t('common.save')}
          </button>
          <button type="button" onClick={onClose} className={BUTTON}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * A rate that never applied.
 *
 * Said plainly, because it is not only the row that goes: every month that rate
 * priced returns to a dash. That is the honest outcome and it is the one an
 * operator will not expect, so the sentence names it.
 */
function RemoveTariffDialog({
  meter,
  tariff,
  open,
  onClose,
}: {
  meter: EnergyMeter;
  tariff: Tariff | null;
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(removeTariff, INITIAL);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('energy.tariff.remove')}
      description={meter.name}
      closeLabel={t('common.close')}
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={meter.facilityId} />
        <input type="hidden" name="meterId" value={meter.id} />
        <input type="hidden" name="tariffId" value={tariff?.id ?? ''} />

        <p className="text-sm text-foreground-muted">{t('energy.tariff.removeHint')}</p>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            className="h-control rounded bg-danger px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('energy.tariff.remove')}
          </button>
          <button type="button" onClick={onClose} className={BUTTON}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

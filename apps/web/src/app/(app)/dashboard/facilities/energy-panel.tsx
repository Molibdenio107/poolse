'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Gauge, Plus } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { timeAgo } from '@/lib/relative-time';
import { withFrom } from '@/lib/back';
import type { EnergyMeter, MeterList } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import type { FormState } from '../actions';
import { createMeter } from './energy.actions';

/**
 * Energy — slices 5.1 and 5.2, on the site's page.
 *
 * The meters at this site, each with its last figure and when it was read.
 * Consumption, the chart and the record live on the meter's own page — a site
 * with four meters and twelve months each is forty-eight bars, which is a page
 * and not a panel.
 *
 * **The row says what the value means.** "41 235 kWh" on a dial and "412 kWh"
 * on a monthly bill look the same and are not; the second line names the kind
 * of meter, so nobody reads an index as a consumption.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center gap-1.5 rounded border border-border-strong px-3 text-sm ' +
  'transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

export const METER_KINDS = ['total', 'pump', 'heating', 'lighting', 'other'] as const;

export function EnergyPanel({
  facilityId,
  list,
  backTo,
}: {
  facilityId: string;
  list: MeterList;
  /** Where a meter's Voltar lands: the site page by default, or Energia. */
  backTo?: string;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormatter();
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground-muted">
          {list.meters.length === 0
            ? t('energy.hint')
            : t('energy.summary', { count: list.meters.length })}
        </p>

        {list.canPlan && (
          <button type="button" onClick={() => setAdding(true)} className={BUTTON}>
            <Plus className="size-4" aria-hidden="true" />
            {t('energy.add')}
          </button>
        )}
      </div>

      {list.meters.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded border border-border">
          {list.meters.map((meter) => (
            <MeterRow
              key={meter.id}
              meter={meter}
              backTo={backTo ?? `/dashboard/facilities/${facilityId}`}
              locale={locale}
              format={format}
            />
          ))}
        </ul>
      )}

      {list.canPlan && (
        <MeterDialog
          facilityId={facilityId}
          pools={list.pools}
          open={adding}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function MeterRow({
  meter,
  backTo,
  locale,
  format,
}: {
  meter: EnergyMeter;
  backTo: string;
  locale: string;
  format: ReturnType<typeof useFormatter>;
}): React.ReactElement {
  const t = useTranslations();
  const ago = timeAgo(meter.latestAt, locale);

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <Gauge className="size-4 shrink-0 text-foreground-muted" aria-hidden="true" />
          <Link
            href={withFrom(`/dashboard/facilities/energy/${meter.id}`, backTo)}
            className="text-sm font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {meter.name}
          </Link>
          <span className="text-xs text-foreground-muted">
            {t(`energy.kind.${meter.kind}`)}
            {meter.poolName !== null && ` · ${meter.poolName}`}
          </span>
        </span>
        <span className="text-xs text-foreground-muted">{t(`energy.reads.${meter.reads}`)}</span>
      </div>

      <span className="flex flex-col items-end gap-0.5 text-sm">
        {meter.latestValue === null || ago === null ? (
          <span className="text-foreground-muted">{t('energy.noReadings')}</span>
        ) : (
          <>
            <span className="font-medium">
              {format.number(meter.latestValue, { maximumFractionDigits: 3 })}{' '}
              <span className="font-normal text-foreground-muted">{meter.unit}</span>
            </span>
            <span className="text-xs text-foreground-muted">{t('energy.readAgo', { ago })}</span>
          </>
        )}
      </span>
    </li>
  );
}

/**
 * A new meter.
 *
 * **`reads` is asked here and only here.** What a value means is decided once,
 * before the first figure exists; changing it under a year of readings would
 * make every one of them wrong at once, so the meter's own page does not offer
 * it. The hint under the select says what each answer does to the arithmetic,
 * because it is the one question on this form a person can get wrong without
 * noticing.
 */
function MeterDialog({
  facilityId,
  pools,
  open,
  onClose,
}: {
  facilityId: string;
  pools: { id: string; name: string }[];
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(createMeter, INITIAL);
  const [reads, setReads] = useState<'cumulative_index' | 'interval_consumption'>('cumulative_index');

  if (state.ok && open) onClose();

  return (
    <Dialog open={open} onClose={onClose} title={t('energy.add')} closeLabel={t('common.close')}>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />

        <TextField
          name="name"
          label={t('energy.name')}
          hint={t('energy.nameHint')}
          required
          {...(state.fields?.['name'] === undefined ? {} : { error: t(state.fields['name']) })}
        />

        <div className="flex flex-wrap gap-4">
          <SelectField
            name="kind"
            label={t('energy.kindLabel')}
            initial="total"
            options={METER_KINDS.map((kind) => ({ value: kind, label: t(`energy.kind.${kind}`) }))}
          />
          <TextField name="unit" label={t('energy.unit')} initial="kWh" className="w-28" />
        </div>

        <SelectField
          name="poolId"
          label={t('energy.pool')}
          hint={t('energy.poolHint')}
          options={[
            { value: '', label: t('energy.wholeSite') },
            ...pools.map((pool) => ({ value: pool.id, label: pool.name })),
          ]}
        />
        <SelectField
          name="reads"
          label={t('energy.readsLabel')}
          hint={t(`energy.readsHint.${reads}`)}
          initial="cumulative_index"
          onValueChange={(value) => setReads(value as typeof reads)}
          options={[
            { value: 'cumulative_index', label: t('energy.reads.cumulative_index') },
            { value: 'interval_consumption', label: t('energy.reads.interval_consumption') },
          ]}
        />

        {reads === 'cumulative_index' && (
          <TextField
            name="initialIndex"
            label={t('energy.initialIndex')}
            hint={t('energy.initialIndexHint')}
            inputMode="decimal"
            className="w-48"
            {...(state.fields?.['initialIndex'] === undefined
              ? {}
              : { error: t('energy.numberInvalid') })}
          />
        )}

        <TextAreaField name="notes" label={t('energy.notes')} rows={2} />

        {state.ok === false && state.errorKey !== undefined && (
          <p className="text-sm text-danger">{t(state.errorKey)}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            className="h-control rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
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

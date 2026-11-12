'use client';

import { useTranslations, useFormatter } from 'next-intl';
import { Archive, Check } from 'lucide-react';
import { ConfirmButton } from '@/components/confirm-action';
import { TextField, useSuccessKey } from '@/components/ui/field';
import { ARCHIVE_ICON, ARCHIVE_TRIGGER } from '@/lib/archive-trigger';
import { formatDate } from '@/lib/date-format';
import { useSavedAction } from '@/lib/saved';
import type { EnergyMeter, GasFactor } from '@/lib/api';
import type { FormState } from '../../../actions';
import { removeGasFactor, setGasFactor } from '../../energy.actions';

const INITIAL: FormState = { ok: false };
const PRIMARY =
  'inline-flex h-control items-center justify-center gap-1.5 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * A gas meter's conversion factor — kWh per m³ as each gas bill prints it,
 * from a date until the next (Rui, 12-11-2026). The factor live on a reading's
 * day turns its m³ into kWh on Leituras. Everyone reads it; Owner and Admin set
 * and remove one, as they do a tariff.
 */
export function GasFactorPanel({
  meter,
  factors,
  canPlan,
}: {
  meter: EnergyMeter;
  factors: GasFactor[];
  canPlan: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const format = useFormatter();
  const [state, action, pending] = useSavedAction(setGasFactor, INITIAL);
  const fresh = useSuccessKey(state);
  const field = (name: string): { error: string } | Record<string, never> =>
    state.fields?.[name] === undefined ? {} : { error: t(state.fields[name]!) };

  return (
    <section className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">{t('energy.gas.title')}</h2>
        <p className="text-sm text-foreground-muted">{t('energy.gas.hint')}</p>
      </div>

      {factors.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('energy.gas.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded border border-border">
          {factors.map((factor) => (
            <li key={factor.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span>
                <span className="font-medium tabular-nums">
                  {t('energy.gas.value', { value: format.number(factor.kwhPerUnit, { maximumFractionDigits: 4 }) })}
                </span>{' '}
                <span className="text-foreground-muted">{t('energy.gas.from', { date: formatDate(factor.effectiveFrom) })}</span>
                {factor.note !== null && <span className="text-foreground-muted"> · {factor.note}</span>}
              </span>
              {canPlan && (
                <RemoveFactor meterId={meter.id} facilityId={meter.facilityId} factorId={factor.id} />
              )}
            </li>
          ))}
        </ul>
      )}

      {canPlan && !meter.archived && (
        <form key={fresh} action={action} className="flex flex-col gap-3">
          <input type="hidden" name="meterId" value={meter.id} />
          <input type="hidden" name="facilityId" value={meter.facilityId} />
          <div className="grid max-w-xl grid-cols-1 items-start gap-4 sm:grid-cols-2">
            <TextField name="kwhPerUnit" label={t('energy.gas.factorLabel')} inputMode="decimal" required {...field('kwhPerUnit')} />
            <TextField name="effectiveFrom" type="date" label={t('energy.gas.fromLabel')} required {...field('effectiveFrom')} />
          </div>
          <TextField name="note" label={t('energy.note')} className="max-w-xl" />
          {state.ok === false && state.errorKey !== undefined && <p className="text-sm text-danger">{t(state.errorKey)}</p>}
          <div>
            <button type="submit" disabled={pending} className={PRIMARY}>
              <Check aria-hidden className="size-4" />
              {t('energy.gas.save')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function RemoveFactor({ meterId, facilityId, factorId }: { meterId: string; facilityId: string; factorId: string }): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(removeGasFactor, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="meterId" value={meterId} />
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="factorId" value={factorId} />
      <ConfirmButton
        title={t('energy.gas.removeTitle')}
        message={t('energy.gas.removeMessage')}
        confirmLabel={t('common.remove')}
        tone="danger"
        disabled={pending}
        ariaLabel={t('energy.gas.removeTitle')}
        className={`${ARCHIVE_TRIGGER} w-control`}
      >
        <Archive aria-hidden className={ARCHIVE_ICON} />
      </ConfirmButton>
    </form>
  );
}

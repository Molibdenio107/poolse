'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { ConfirmButton } from '@/components/confirm-action';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/ui/field';
import type { CostEntry } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { formatCents } from '@/lib/money';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { archiveCostAction, recordCostAction } from './cost.actions';

const INITIAL: FormState = { ok: false };
const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * *Registar custo* — POOLSE-189. Water, a fixed cost, a service or anything else
 * the club pays, once or on a schedule. It closes on a save; a refusal keeps it
 * open with the sentence under its field.
 */
export function RecordCost(): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [repeat, setRepeat] = useState('none');
  const [state, action, pending] = useSavedAction(
    async (previous: FormState, data: FormData) => {
      const answer = await recordCostAction(previous, data);
      if (answer.ok) setOpen(false);
      return answer;
    },
    INITIAL,
  );
  const error = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };

  return (
    <>
      <button type="button" className={BUTTON} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {t('costs.record.open')}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('costs.record.open')} closeLabel={t('common.close')}>
        <form action={action} className="flex flex-col gap-3">
          <SelectField
            name="kind"
            label={t('costs.record.kind')}
            initial="water"
            required
            options={[
              { value: 'water', label: t('costs.kind.water') },
              { value: 'fixed', label: t('costs.record.kindFixed') },
              { value: 'maintenance_service', label: t('costs.kind.maintenance_service') },
              { value: 'other', label: t('costs.record.kindOther') },
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="amount" label={t('costs.record.amount')} inputMode="decimal" required error={error('amount')} />
            <TextField name="vat" label={t('costs.record.vat')} inputMode="decimal" error={error('vat')} />
          </div>
          <SelectField
            name="recurrence"
            label={t('costs.record.recurrence')}
            initial="none"
            onValueChange={setRepeat}
            options={[
              { value: 'none', label: t('costs.record.once') },
              { value: 'monthly', label: t('costs.record.monthly') },
              { value: 'yearly', label: t('costs.record.yearly') },
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="from" type="date" label={t('costs.record.from')} required error={error('from')} />
            <TextField
              name="to"
              type="date"
              label={t('costs.record.to')}
              required={repeat === 'none'}
              hint={repeat === 'none' ? undefined : t('costs.record.toOptional')}
              error={error('to')}
            />
          </div>
          <TextField name="supplier" label={t('costs.record.supplier')} maxLength={200} />
          <TextField name="documentNumber" label={t('costs.record.documentNumber')} maxLength={100} />
          <TextField name="note" label={t('costs.record.note')} maxLength={500} />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-control items-center justify-center self-start rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60"
          >
            {pending ? t('common.working') : t('costs.record.save')}
          </button>
        </form>
      </Dialog>
    </>
  );
}

function EntryRow({ entry }: { entry: CostEntry }): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [, action, pending] = useSavedAction(archiveCostAction, INITIAL);
  const recurring = entry.recurrence !== 'none';
  const name = entry.supplier ?? t(`costs.kind.${entry.kind === 'other' ? 'fixed' : entry.kind}`);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{name}</span>
        <span className="text-sm text-foreground-muted">
          {recurring
            ? t(entry.recurrence === 'monthly' ? 'costs.record.everyMonthFrom' : 'costs.record.everyYearFrom', {
                date: formatDate(entry.startsOn),
              })
            : `${formatDate(entry.startsOn)} – ${formatDate(entry.endsOn ?? entry.startsOn)}`}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <span className="tabular-nums">{formatCents(locale, entry.amountCents)}</span>
        <form action={action}>
          <input type="hidden" name="id" value={entry.id} />
          <ConfirmButton
            title={t(recurring ? 'costs.record.stopTitle' : 'costs.record.removeTitle', { name })}
            message={t(recurring ? 'costs.record.stopMessage' : 'costs.record.removeMessage')}
            confirmLabel={t(recurring ? 'costs.record.stop' : 'costs.record.remove')}
            tone="danger"
            disabled={pending}
            className="text-sm text-danger hover:underline"
          >
            {t(recurring ? 'costs.record.stop' : 'costs.record.remove')}
          </ConfirmButton>
        </form>
      </span>
    </li>
  );
}

/** What was typed here, newest first: each one can be stopped or removed. */
export function RecordedCosts({ entries }: { entries: CostEntry[] }): React.ReactElement | null {
  const t = useTranslations();
  if (entries.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded bg-surface p-5 shadow-card">
      <h2 className="font-medium">{t('costs.record.listTitle')}</h2>
      <ul className="flex flex-col divide-y divide-border">
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

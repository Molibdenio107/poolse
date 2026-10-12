'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarRange, Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { TextField, useFocusFirstError } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/date-format';
import type { LifeguardPeriod } from '@/lib/api';
import { PersonPicker } from '../incidents/person-picker';
import { searchStaffAction } from '../incidents/incidents.actions';
import { addPeriodAction, endPeriodAction, type PeriodState } from './roster.actions';

const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Vigilance periods — 12 October 2026.
 *
 * "Ana, 25m and learner pool, Mon/Wed/Fri, October to June, opening hours" is
 * one form, not ninety. Saving it writes the days at once and the toast says
 * how many, and how many that person already held. Ending a period removes its
 * days from a date on — the days before stay as the record — and a single day
 * is still removed from the week view, as before.
 */
export function PeriodsPanel({
  facilityId,
  pools,
  periods,
  canManage,
  defaultPoolId,
  today,
}: {
  facilityId: string;
  pools: { id: string; name: string }[];
  periods: LifeguardPeriod[];
  canManage: boolean;
  defaultPoolId: string;
  /** The club's today, `YYYY-MM-DD`: the earliest a period may be ended from. */
  today: string;
}): React.ReactElement {
  const t = useTranslations();
  const [adding, setAdding] = useState(false);

  const days = (weekdays: number[]): string =>
    weekdays.map((day) => t(`week.${day}` as never)).join(', ');

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <p className="text-sm text-foreground-muted">{t('roster.period.hint')}</p>

      {periods.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('roster.period.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {periods.map((period) => (
            <li key={period.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="font-medium">{period.name ?? t('roster.unknownPerson')}</span>
                <span>
                  {t('roster.period.dates', { from: formatDate(period.startsOn), to: formatDate(period.endsOn) })}
                  {' · '}
                  {days(period.weekdays)}
                </span>
                <span className="text-foreground-muted">
                  {period.from === null || period.to === null
                    ? t('roster.period.openingHours')
                    : t('roster.dutyTimes', { from: period.from, to: period.to })}
                  {' · '}
                  {period.pools.length === 0
                    ? t('roster.period.noDaysLeft')
                    : period.pools.map((pool) => pool.name).join(', ')}
                </span>
              </div>
              {canManage && <EndPeriod period={period} today={today} />}
            </li>
          ))}
        </ul>
      )}

      {canManage &&
        (adding ? (
          <NewPeriod
            facilityId={facilityId}
            pools={pools}
            defaultPoolId={defaultPoolId}
            today={today}
            onDone={() => setAdding(false)}
          />
        ) : (
          <div>
            <button type="button" onClick={() => setAdding(true)} className={QUIET}>
              <Plus aria-hidden className="size-4" />
              {t('roster.period.new')}
            </button>
          </div>
        ))}
    </section>
  );
}

function NewPeriod({
  facilityId,
  pools,
  defaultPoolId,
  today,
  onDone,
}: {
  facilityId: string;
  pools: { id: string; name: string }[];
  defaultPoolId: string;
  today: string;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<PeriodState>({ ok: false });
  const [pending, startTransition] = useTransition();
  const [hours, setHours] = useState<'opening' | 'fixed'>('opening');
  const [chosenPools, setChosenPools] = useState<string[]>([defaultPoolId]);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);

  useFocusFirstError(form, state.fields, state);
  const fieldError = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };

  const toggle = (list: string[] | number[], value: string | number): never[] =>
    ((list as (string | number)[]).includes(value)
      ? (list as (string | number)[]).filter((item) => item !== value)
      : [...list, value]) as never[];

  function submit(data: FormData): void {
    startTransition(async () => {
      const result = await addPeriodAction(facilityId, data);
      setState(result);
      if (result.ok) {
        toast.show(
          'success',
          t('roster.period.saved', { written: result.written ?? 0, clashes: result.clashes ?? 0 }),
        );
        router.refresh();
        onDone();
      } else if (result.fields === undefined) {
        toast.show('danger', t((result.errorKey ?? 'roster.error.periodFailed') as never));
      }
    });
  }

  return (
    <form ref={form} action={submit} className="flex flex-col gap-4 rounded border border-border p-4">
      <h2 className="flex items-center gap-2 font-medium">
        <CalendarRange aria-hidden className="size-4 text-primary" />
        {t('roster.period.new')}
      </h2>

      <PersonPicker
        name="membershipId"
        label={t('roster.field.person')}
        hint={t('roster.field.personHint')}
        search={searchStaffAction}
        error={fieldError('membershipId')}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm">{t('roster.period.pools')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {pools.map((pool) => (
            <label key={pool.id} className="inline-flex items-center gap-2 text-control">
              <input
                type="checkbox"
                name="poolIds"
                value={pool.id}
                checked={chosenPools.includes(pool.id)}
                onChange={() => setChosenPools(toggle(chosenPools, pool.id))}
                className="size-4 accent-primary"
              />
              {pool.name}
            </label>
          ))}
        </div>
        {fieldError('poolIds') !== undefined && (
          <p className="text-sm text-danger">{fieldError('poolIds')}</p>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <TextField
          name="startsOn"
          type="date"
          label={t('roster.period.startsOn')}
          initial={today}
          required
          error={fieldError('startsOn')}
          className="max-w-48"
        />
        <TextField
          name="endsOn"
          type="date"
          label={t('roster.period.endsOn')}
          hint={t('roster.period.endsOnHint')}
          required
          error={fieldError('endsOn')}
          className="max-w-48"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm">{t('roster.period.weekdays')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {WEEKDAYS.map((day) => (
            <label key={day} className="inline-flex items-center gap-2 text-control">
              <input
                type="checkbox"
                name="weekdays"
                value={day}
                checked={weekdays.includes(day)}
                onChange={() => setWeekdays(toggle(weekdays, day))}
                className="size-4 accent-primary"
              />
              {t(`week.${day}` as never)}
            </label>
          ))}
        </div>
        {fieldError('weekdays') !== undefined && (
          <p className="text-sm text-danger">{fieldError('weekdays')}</p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm">{t('roster.period.hours')}</legend>
        <label className="inline-flex items-center gap-2 text-control">
          <input
            type="radio"
            name="hours"
            value="opening"
            checked={hours === 'opening'}
            onChange={() => setHours('opening')}
            className="size-4 accent-primary"
          />
          {t('roster.period.openingHours')}
        </label>
        <label className="inline-flex items-center gap-2 text-control">
          <input
            type="radio"
            name="hours"
            value="fixed"
            checked={hours === 'fixed'}
            onChange={() => setHours('fixed')}
            className="size-4 accent-primary"
          />
          {t('roster.period.fixedHours')}
        </label>
        {hours === 'fixed' && (
          <div className="flex flex-wrap gap-4 pl-6">
            <TextField
              name="from"
              type="time"
              label={t('roster.field.from')}
              required
              error={fieldError('from')}
              className="max-w-40"
            />
            <TextField
              name="to"
              type="time"
              label={t('roster.field.to')}
              hint={t('roster.field.toHint')}
              required
              error={fieldError('to')}
              className="max-w-40"
            />
          </div>
        )}
      </fieldset>

      <p className="text-sm text-foreground-muted">{t('roster.period.skipsNote')}</p>

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t('roster.period.saving') : t('roster.period.save')}
        </button>
        <button type="button" onClick={onDone} className={QUIET}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/** "Terminar a partir de…" — a date in a dialog, today at the earliest. */
function EndPeriod({ period, today }: { period: LifeguardPeriod; today: string }): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(period.startsOn > today ? period.startsOn : today);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={QUIET}>
        {t('roster.period.end')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('roster.period.endTitle')}
        description={t('roster.period.endHint', { name: period.name ?? t('roster.unknownPerson') })}
        closeLabel={t('common.close')}
      >
        <div className="flex flex-col gap-4">
          <TextField
            name="from"
            type="date"
            label={t('roster.period.endFrom')}
            initial={from}
            onValueChange={setFrom}
            error={error}
            className="max-w-48"
          />
          <div className="flex flex-wrap justify-end gap-2 text-sm">
            <button type="button" onClick={() => setOpen(false)} className={QUIET}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await endPeriodAction(period.id, from);
                  if (result.ok) {
                    setOpen(false);
                    toast.show('success', t('roster.period.ended', { removed: result.written ?? 0 }));
                    router.refresh();
                    return;
                  }
                  const key = result.fields?.['from'];
                  if (key !== undefined) {
                    setError(t(key as never));
                    return;
                  }
                  setOpen(false);
                  toast.show('danger', t((result.errorKey ?? 'roster.error.endFailed') as never));
                })
              }
              className={PRIMARY}
            >
              {t('roster.period.end')}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

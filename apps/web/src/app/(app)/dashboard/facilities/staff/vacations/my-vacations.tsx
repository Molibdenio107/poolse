'use client';

import { today } from '@/lib/dates';
import { useMemo, useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useLocale, useTranslations } from 'next-intl';
import type { MyVacations, VacationRequest } from '@/lib/api';
import { YearGrid, type DayState } from '@/components/year-grid';
import { requestVacationAction, withdrawVacationAction } from './vacations.actions';
import type { FormState } from '../../../actions';

const INITIAL: FormState = { ok: false };

/**
 * "As minhas férias" — backlog round 3, story 6.
 *
 * The selection lives here rather than in the URL because it is a draft: a
 * half-chosen fortnight is not a thing worth a shareable link, and putting it in
 * the query string would make every click a navigation.
 */
export function MyVacations({ data }: { data: MyVacations }): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, submit, pending] = useSavedAction(requestVacationAction, INITIAL);

  /** Holiday name by day, so a hover can say *which* holiday. */
  const holidays = useMemo(
    () => new Map(data.holidays.map((holiday) => [holiday.day, holiday])),
    [data.holidays],
  );

  /**
   * Day → the request that holds it.
   *
   * Built once per render rather than searched per cell: 366 cells each scanning
   * every request is the kind of quadratic nobody notices until a season with
   * forty requests in it.
   */
  const booked = useMemo(() => {
    const map = new Map<string, VacationRequest>();
    for (const request of data.requests) {
      if (request.status === 'rejected' || request.status === 'withdrawn') continue;
      for (const day of request.days) map.set(day, request);
    }
    return map;
  }, [data.requests]);

  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
          new Date(Date.UTC(data.year, index, 1)),
        ),
      ),
    [locale, data.year],
  );

  const weekdayInitials = useMemo(
    () =>
      // 2024-01-01 was a Monday, so this walks Monday → Sunday in the reader's
      // own language rather than hard-coding "S T Q Q S S D".
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
          new Date(Date.UTC(2024, 0, 1 + index)),
        ),
      ),
    [locale],
  );

  function labelFor(day: string): string {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`));
  }

  function stateFor(day: string): DayState {
    const holiday = holidays.get(day);
    if (holiday !== undefined) {
      return {
        disabled: true,
        description: holiday.name,
        marker: '•',
        className: 'bg-warning/10 text-warning',
      };
    }

    // Sunday. `getUTCDay` on a date built at midnight UTC is the weekday of the
    // calendar day itself, with no timezone to shift it.
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) return { disabled: true };

    const existing = booked.get(day);
    if (existing !== undefined) {
      // Outlined for pending, filled for approved — story 6's own distinction,
      // and never colour alone: the marker carries it too.
      return existing.status === 'approved'
        ? {
            className: 'bg-primary text-primary-foreground',
            description: t('vacations.approved'),
            marker: '✓',
          }
        : {
            className: 'border border-dashed border-primary text-primary',
            description: t('vacations.pending'),
            marker: '?',
          };
    }

    if (selected.has(day)) {
      return {
        className: 'bg-complementary/60 font-medium',
        description: t('vacations.selected'),
        marker: '+',
      };
    }

    return {};
  }

  function toggle(day: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  const chosen = [...selected].sort();

  return (
    <div className="flex flex-col gap-6">
      {/*
        The balance, and the sentence about carry-over. Saying it out loud is a
        deliberate choice: Portuguese practice allows unused days to be carried
        into the following year until the 30th of April, this version does not
        track that, and an operator who knows will keep their own note while one
        who assumes gets a wrong number in March.
      */}
      <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('vacations.balance')}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-4">
          <Figure label={t('vacations.entitlement')} value={data.balance.entitlement} />
          <Figure label={t('vacations.taken')} value={data.balance.taken} />
          <Figure label={t('vacations.awaiting')} value={data.balance.requested} />
          <Figure label={t('vacations.remaining')} value={data.balance.remaining} strong />
        </dl>
        <p className="text-sm text-foreground-muted">{t('vacations.noCarryOver')}</p>
      </section>

      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="organizationId" value={data.organizationId} />
        <input type="hidden" name="days" value={chosen.join(',')} />

        <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface p-4">
          <span className="text-sm">
            {t('vacations.chosen', { count: chosen.length })}
          </span>
          <button
            type="submit"
            disabled={pending || chosen.length === 0}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {pending ? t('common.working') : t('vacations.submit')}
          </button>
          {chosen.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded text-sm text-foreground-muted hover:text-foreground"
            >
              {t('vacations.clearSelection')}
            </button>
          )}
          {state.ok && <span className="text-sm text-success">{t('vacations.requested')}</span>}
          {state.errorKey !== undefined && (
            <span className="text-sm text-danger">{t(state.errorKey)}</span>
          )}
        </div>

        <p className="text-sm text-foreground-muted">{t('vacations.gridHint')}</p>

        <YearGrid
          year={data.year}
          monthNames={monthNames}
          weekdayInitials={weekdayInitials}
          stateFor={stateFor}
          onPick={toggle}
          labelFor={labelFor}
          // Férias are requested forward. Last March is not on offer.
          pastBefore={today()}
        />
      </form>

      <RequestList data={data} />
    </div>
  );
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col rounded border border-border p-3">
      <dt className="text-sm text-foreground-muted">{label}</dt>
      <dd className={strong === true ? 'text-2xl font-semibold text-primary' : 'text-2xl'}>
        {value}
      </dd>
    </div>
  );
}

/** The requests themselves, because a grid cannot show a rejection's reason. */
function RequestList({ data }: { data: MyVacations }): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [state, withdraw, pending] = useSavedAction(withdrawVacationAction, INITIAL);

  if (data.requests.length === 0) {
    return (
      <section className="rounded border border-border bg-surface p-5">
        <p className="text-sm text-foreground-muted">{t('vacations.noRequests')}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('vacations.myRequests')}
      </h2>

      <ul className="flex flex-col divide-y divide-border">
        {data.requests.map((request) => (
          <li key={request.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={request.status} />
              <span className="text-sm">
                {t('vacations.dayCount', { count: request.days.length })}
              </span>
              <span className="text-sm text-foreground-muted">
                {request.days
                  .map((day) =>
                    new Intl.DateTimeFormat(locale, {
                      day: 'numeric',
                      month: 'short',
                      timeZone: 'UTC',
                    }).format(new Date(`${day}T00:00:00Z`)),
                  )
                  .join(', ')}
              </span>
            </div>

            {/*
              A refusal without its reason is the thing story 7 requires a note
              for. Showing it here is the other half of that requirement — a
              reason recorded and never displayed helps nobody.
            */}
            {request.decisionNote !== null && (
              <p className="text-sm">
                <span className="text-foreground-muted">{t('vacations.reason')}: </span>
                {request.decisionNote}
              </p>
            )}

            {request.status === 'pending' && (
              <form action={withdraw} className="flex items-center gap-3">
                <input type="hidden" name="organizationId" value={data.organizationId} />
                <input type="hidden" name="requestId" value={request.id} />
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded text-sm text-danger hover:underline disabled:opacity-60"
                >
                  {t('vacations.withdraw')}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {state.errorKey !== undefined && (
        <p className="text-sm text-danger">{t(state.errorKey)}</p>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: VacationRequest['status'] }): React.ReactElement {
  const t = useTranslations();

  // Never colour alone — each badge carries its own word, which is what makes
  // this readable to somebody who cannot tell the green from the amber.
  const tone =
    status === 'approved'
      ? 'bg-success/15 text-success'
      : status === 'pending'
        ? 'bg-warning/15 text-warning'
        : 'bg-surface-muted text-foreground-muted';

  return (
    <span className={`rounded px-2 py-0.5 text-sm ${tone}`}>{t(`vacations.${status}`)}</span>
  );
}

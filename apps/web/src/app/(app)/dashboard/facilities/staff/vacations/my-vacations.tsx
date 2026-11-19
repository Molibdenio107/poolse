'use client';

import { Badge } from '@/components/ui/badge';
import { today } from '@/lib/dates';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useLocale, useTranslations } from 'next-intl';
import type { MyVacations, VacationRequest } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { ConfirmButton } from '@/components/confirm-action';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CalendarCheck } from 'lucide-react';
import { YearGrid, type DayState } from '@/components/year-grid';
import { useSeeded, useSuccessKey } from '@/components/ui/field';
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

  /*
   * Holiday by default, because it is what most requests are and what this
   * screen meant before the other two existed.
   */
  const [kind, setKind] = useState('vacation');
  // The reason is typed afresh for each request, so it clears once one is sent.
  const sent = useSuccessKey(state);
  const [reason, setReason] = useSeeded<string>('', sent);

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

  // dd-MM-yyyy, like every date in Poolse (CLAUDE.md); the twin in team-map
  // already said so, and this one still spoke "13 de setembro" — 16-10-2026.
  function labelFor(day: string): string {
    return formatDate(day);
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

  /*
   * POOLSE-234 (Rui, 19-11-2026): the request is confirmed in a dialog that
   * lists the days, opened from a button that follows the scroll. Nothing is
   * sent before the dialog's *Pedir estes dias*, which submits this same form
   * (through `form=`, the dialog being portalled out of it) to the same action.
   */
  const formId = useId();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Focus goes back here when the dialog closes: Safari never focuses a tapped
  // button, so the dialog's own return-to-what-was-focused finds nothing.
  const floatRef = useRef<HTMLButtonElement>(null);
  // A request that went through closes the dialog and clears the draft.
  useEffect(() => {
    if (state.ok) {
      setConfirming(false);
      setSelected(new Set());
    }
  }, [state]);

  // The chosen days by month, in the year's order: "Março: 3, 4, 5". Days are
  // dates, not instants, so no time zone can move one.
  const byMonth = useMemo(() => {
    const groups = new Map<number, number[]>();
    for (const day of chosen) {
      const month = Number(day.slice(5, 7)) - 1;
      groups.set(month, [...(groups.get(month) ?? []), Number(day.slice(8, 10))]);
    }
    return [...groups.entries()];
    // `chosen` is derived from `selected` on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div className="flex flex-col gap-6">
      {/*
        The balance, and the sentence about carry-over. Saying it out loud is a
        deliberate choice: Portuguese practice allows unused days to be carried
        into the following year until the 30th of April, this version does not
        track that, and an operator who knows will keep their own note while one
        who assumes gets a wrong number in March.
      */}
      <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('vacations.balance')}
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Figure label={t('vacations.entitlement')} value={data.balance.entitlement} />
          <Figure label={t('vacations.taken')} value={data.balance.taken} />
          <Figure label={t('vacations.awaiting')} value={data.balance.requested} />
          <Figure label={t('vacations.remaining')} value={data.balance.remaining} strong />
        </dl>
        <p className="text-sm text-foreground-muted">{t('vacations.noCarryOver')}</p>
      </section>

      <form id={formId} action={submit} className={chosen.length > 0 ? 'flex flex-col gap-4 pb-24' : 'flex flex-col gap-4'}>
        <input type="hidden" name="organizationId" value={data.organizationId} />
        <input type="hidden" name="days" value={chosen.join(',')} />

        <div className="flex flex-wrap items-center gap-3 rounded bg-surface p-4 shadow-card">
          <span className="text-sm">
            {t('vacations.chosen', { count: chosen.length })}
          </span>

          {/*
            What kind of leave — round 6.

            All three go through this one queue, so a manager sees "who is away
            in August" in one place and the calendar has one source to ask. Only
            a holiday is counted against the year's entitlement: a week of flu is
            not a week of holiday, and a club that counted it that way would be
            docking somebody for being ill.
          */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-foreground-muted">{t('vacations.kind')}</span>
            <select
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              className="h-control rounded border border-border-strong bg-background px-2 text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <option value="vacation">{t('vacations.kinds.vacation')}</option>
              <option value="medical">{t('vacations.kinds.medical')}</option>
              <option value="personal">{t('vacations.kinds.personal')}</option>
            </select>
          </label>

          {/* Only where it would mean something. A holiday needs no excuse. */}
          {kind !== 'vacation' && (
            <input
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
              placeholder={t('vacations.leaveReasonPlaceholder')}
              aria-label={t('vacations.reason')}
              className="h-control min-w-48 flex-1 rounded-sm border border-border-strong bg-background px-2.5 text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
          )}
          {chosen.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded text-sm text-foreground-muted hover:text-foreground"
            >
              {t('vacations.clearSelection')}
            </button>
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

      {/*
        The floating bar: it follows the scroll, so October's last pick is never
        a long way from its button. A bottom bar, so it adds the safe area to its
        own padding and the form above makes room for it (`pb-24`).
      */}
      {chosen.length > 0 && (
        <div
          data-bottom-bar
          className="vacation-float fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[calc(1rem+var(--safe-bottom))] md:justify-end md:px-8 print:hidden"
        >
          <div className="flex items-center gap-3 rounded bg-surface p-2 pl-4 shadow-card">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="min-h-control text-sm text-foreground-muted hover:text-foreground"
            >
              {t('vacations.clearSelection')}
            </button>
            <Button ref={floatRef} icon={CalendarCheck} onClick={() => setConfirming(true)}>
              {t('vacations.floating', { count: chosen.length })}
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          requestAnimationFrame(() => floatRef.current?.focus());
        }}
        title={t('vacations.confirmTitle', { count: chosen.length })}
        description={t('vacations.confirmHint')}
        closeLabel={t('common.close')}
        placement="sheet"
        initialFocus={confirmRef}
      >
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2">
            {byMonth.map(([month, days]) => (
              <li key={month} className="flex flex-wrap gap-x-2 text-sm">
                <span className="font-semibold capitalize">{monthNames[month]}:</span>
                <span>{days.join(', ')}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-foreground-muted">
            {t('vacations.chosen', { count: chosen.length })} · {t(`vacations.kinds.${kind}` as never)}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setSelected(new Set());
                setConfirming(false);
              }}
              className="mr-auto min-h-control text-sm text-foreground-muted hover:text-foreground"
            >
              {t('vacations.clearSelection')}
            </button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('vacations.chooseMore')}
            </Button>
            <Button ref={confirmRef} type="submit" form={formId} disabled={pending || chosen.length === 0}>
              {pending ? t('common.working') : t('vacations.submit')}
            </Button>
          </div>
        </div>
      </Dialog>

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
  const [state, withdraw, pending] = useSavedAction(withdrawVacationAction, INITIAL);

  if (data.requests.length === 0) {
    return (
      <section className="rounded bg-surface p-5 shadow-card">
        <p className="text-sm text-foreground-muted">{t('vacations.noRequests')}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card">
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
              {/* `formatDate`, like every other date: this said "13 set." */}
              <span className="text-sm text-foreground-muted">
                {request.days.map((day) => formatDate(day)).join(', ')}
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
                {/* Asks first (Rui, 04-11-2026). */}
                <ConfirmButton
                  title={t('confirm.equipa.withdrawVacationTitle', { count: request.days.length })}
                  message={t('confirm.equipa.withdrawVacationMessage')}
                  confirmLabel={t('confirm.equipa.withdraw')}
                  tone="danger"
                  disabled={pending}
                  className="rounded text-sm text-danger hover:underline disabled:opacity-60"
                >
                  {t('vacations.withdraw')}
                </ConfirmButton>
              </form>
            )}
          </li>
        ))}
      </ul>

    </section>
  );
}

function StatusBadge({ status }: { status: VacationRequest['status'] }): React.ReactElement {
  const t = useTranslations();

  // Never colour alone — each badge carries its own word, which is what makes
  // this readable to somebody who cannot tell the green from the amber.
  // Waiting on somebody's decision is the pending tone (Slice 5's shared badge).
  const tone = status === 'approved' ? 'ok' : status === 'pending' ? 'pending' : 'muted';
  return <Badge tone={tone}>{t(`vacations.${status}`)}</Badge>;
}

'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { RedemptionOption, ReposicaoCredit } from '@/lib/api';
import { bookCreditAction, cancelBookingAction, optionsForCreditAction } from './credits.actions';

/**
 * Booking a reposição — POOLSE-21, criteria 3 and 6.
 *
 * **The options are fetched when somebody asks, not with the page.** A student
 * with four credits would otherwise cost four eligibility queries on every load
 * of a record most people open to read a phone number. It is also the honest
 * shape: the list is only true for a moment — the last place on Tuesday can go
 * while somebody reads — so fetching it late narrows the window, and the API
 * re-checks inside the booking transaction anyway.
 *
 * That re-check is why this can be relaxed about staleness. A 409 here means the
 * place went, not that the family did something wrong, and it says so.
 */
export function CreditBooking({
  organizationId,
  studentId,
  credit,
}: {
  organizationId: string;
  studentId: string;
  credit: ReposicaoCredit;
}): React.ReactElement {
  const t = useTranslations();
  const [options, setOptions] = useState<RedemptionOption[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load(): void {
    setFailure(null);
    start(async () => {
      const result = await optionsForCreditAction(organizationId, credit.id);
      setOptions(result);
    });
  }

  function book(sessionId: string): void {
    setFailure(null);
    start(async () => {
      const result = await bookCreditAction(organizationId, studentId, credit.id, sessionId);
      if (result.ok) {
        setOptions(null);
        return;
      }
      // The place went while they were choosing. Re-load rather than leaving a
      // list on screen that is now wrong.
      setFailure(result.errorKey);
      const refreshed = await optionsForCreditAction(organizationId, credit.id);
      setOptions(refreshed);
    });
  }

  if (credit.status === 'booked' && credit.bookingId !== null) {
    return (
      <form
        action={async () => {
          await cancelBookingAction(organizationId, studentId, credit.bookingId!);
        }}
      >
        <button
          type="submit"
          className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('reposicao.cancelBooking')}
        </button>
      </form>
    );
  }

  if (credit.status !== 'available') return <></>;

  return (
    <div className="flex flex-col items-start gap-2">
      {options === null ? (
        <button
          type="button"
          onClick={load}
          disabled={pending}
          aria-busy={pending}
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('reposicao.findClass')}
        </button>
      ) : options.length === 0 ? (
        /*
          Said plainly, with the reasons. "No classes available" on its own sends
          somebody to ring the office; the filters that produced the empty list
          are the answer they would have been given.
        */
        <div className="flex flex-col gap-1">
          <p className="text-sm">{t('reposicao.noOptions')}</p>
          <p className="text-sm text-foreground-muted">{t('reposicao.noOptionsHint')}</p>
        </div>
      ) : (
        <ul className="flex w-full flex-col divide-y divide-border rounded border border-border">
          {options.map((option) => (
            <li
              key={option.sessionId}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium">
                  {option.localDate} · {option.startTime}
                </span>
                <span className="text-sm text-foreground-muted">
                  {[option.className, option.poolName].filter(Boolean).join(' · ')}
                </span>
              </span>

              <span className="flex items-center gap-2">
                {/*
                  The number of places, in words as well as a number: a family
                  choosing between two dates wants to know which one is nearly
                  full. Null means the turma has no limit.
                */}
                {option.freeSeats !== null && (
                  <span className="text-sm text-foreground-muted">
                    {t('reposicao.freeSeats', { seats: option.freeSeats })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => book(option.sessionId)}
                  disabled={pending}
                  className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
                >
                  {t('reposicao.book')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {failure !== null && <p className="text-sm text-danger">{t(failure)}</p>}
    </div>
  );
}

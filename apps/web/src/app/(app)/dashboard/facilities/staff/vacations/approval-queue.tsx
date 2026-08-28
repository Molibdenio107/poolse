'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PendingVacations } from '@/lib/api';
import { decideVacationAction } from './vacations.actions';
import type { FormState } from '../../../actions';

const INITIAL: FormState = { ok: false };

/**
 * The approval queue — backlog round 3, story 7.
 *
 * The whole reason approval exists is in the "who else is off" line: nothing
 * else stops three instructors booking the same week in August and the club
 * finding out in July. It is shown *before* the decision, on the same card,
 * because a warning a manager has to go and look for is a warning nobody sees.
 */
export function ApprovalQueue({ data }: { data: PendingVacations }): React.ReactElement {
  const t = useTranslations();

  if (data.requests.total === 0) {
    return (
      <section className="rounded border border-border bg-surface p-5">
        <p className="text-sm text-foreground-muted">{t('vacations.queueEmpty')}</p>
      </section>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {data.requests.items.map((request) => (
        <li key={request.id}>
          <RequestCard organizationId={data.organizationId} request={request} />
        </li>
      ))}
    </ul>
  );
}

function RequestCard({
  organizationId,
  request,
}: {
  organizationId: string;
  // Derived from the envelope's items, so the card follows the payload shape
  // rather than restating it — POOLSE-29 changed the wrapper, not the row.
  request: PendingVacations['requests']['items'][number];
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [state, decide, pending] = useActionState(decideVacationAction, INITIAL);
  const [rejecting, setRejecting] = useState(false);

  const day = (value: string): string =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00Z`));

  return (
    <form action={decide} className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="requestId" value={request.id} />

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-medium">{request.personName ?? t('account.noName')}</h3>
        <span className="text-sm text-foreground-muted">
          {t('vacations.dayCount', { count: request.days.length })}
        </span>
      </div>

      <p className="text-sm">{request.days.map(day).join(', ')}</p>

      {/*
        Cover, before the decision. Not a refusal — two people may well be off
        the same week and only the manager can judge whether that works — but it
        is the fact the decision turns on, so it is visible rather than
        discoverable.
      */}
      {request.othersOff.length > 0 && (
        <p className="rounded bg-warning/10 px-3 py-2 text-sm text-warning">
          {t('vacations.othersOff', {
            people: [
              ...new Set(request.othersOff.map((other) => other.name ?? t('account.noName'))),
            ].join(', '),
          })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {t('vacations.approve')}
        </button>

        {!rejecting ? (
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="rounded text-sm text-danger hover:underline"
          >
            {t('vacations.reject')}
          </button>
        ) : (
          <span className="text-sm text-foreground-muted">{t('vacations.rejectHint')}</span>
        )}

        {state.errorKey !== undefined && (
          <span className="text-sm text-danger">{t(state.errorKey)}</span>
        )}
      </div>

      {/*
        The note appears only once rejection is chosen, and rejecting cannot be
        submitted without it — story 7 is explicit, and "no" with no reason
        generates the conversation anyway. Approving may carry one and does not
        need one.
      */}
      {rejecting && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`note-${request.id}`} className="text-sm text-foreground-muted">
            {t('vacations.reason')}
          </label>
          <input
            id={`note-${request.id}`}
            name="note"
            required
            maxLength={500}
            placeholder={t('vacations.reasonPlaceholder')}
            className="rounded border border-border-strong bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              name="decision"
              value="reject"
              disabled={pending}
              className="rounded bg-danger px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
            >
              {t('vacations.confirmReject')}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded text-sm text-foreground-muted hover:text-foreground"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

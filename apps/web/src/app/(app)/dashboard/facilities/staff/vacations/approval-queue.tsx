'use client';

import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL, useSeeded } from '@/components/ui/field';
import type { PendingVacations } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { decideVacationAction } from './vacations.actions';
import { ConfirmAction } from '@/components/confirm-action';
import type { FormState } from '../../../actions';

const INITIAL: FormState = { ok: false };

/**
 * The approval queue — backlog round 3, story 7.
 *
 * The whole reason approval exists is in the "who else is off" line: nothing
 * else stops three instructors booking the same week in August and the club
 * finding out in July. It is shown *before* the decision, on the same card,
 * because a warning a manager has to go and look for is a warning nobody sees.
 *
 * Every worker reads it since POOLSE-157 — names and dates, the API withholding
 * the kind and the words — and only the office (`canDecide`) gets the buttons.
 */
export function ApprovalQueue({ data }: { data: PendingVacations }): React.ReactElement {
  const t = useTranslations();

  if (data.requests.total === 0) {
    return (
      <section className="rounded bg-surface p-5 shadow-card">
        <p className="text-sm text-foreground-muted">{t('vacations.queueEmpty')}</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!data.canDecide && <p className="text-sm text-foreground-muted">{t('vacations.queueReadOnly')}</p>}
      <ul className="flex flex-col gap-4">
        {data.requests.items.map((request) => (
          <li key={request.id}>
            {data.canDecide ? (
              <RequestCard organizationId={data.organizationId} request={request} />
            ) : (
              <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
                <RequestSummary request={request} />
              </section>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

type QueueRow = PendingVacations['requests']['items'][number];

/** Who, how many days, which days, and who else is off — the part everybody reads. */
function RequestSummary({ request }: { request: QueueRow }): React.ReactElement {
  const t = useTranslations();
  // `formatDate`, like every other date in the product. This rendered "13 set."
  // in the reader's locale, which the 13-09-2026 decision replaced everywhere
  // that went through next-intl and missed everywhere that did not.
  const day = (value: string): string => formatDate(value);

  return (
    <>
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
    </>
  );
}

function RequestCard({
  organizationId,
  request,
}: {
  organizationId: string;
  // Derived from the envelope's items, so the card follows the payload shape
  // rather than restating it — POOLSE-29 changed the wrapper, not the row.
  request: QueueRow;
}): React.ReactElement {
  const t = useTranslations();
  const [, decide, pending] = useSavedAction(decideVacationAction, INITIAL);
  const [note, setNote] = useSeeded<string>('');
  const who = request.personName ?? t('account.noName');
  const fields = { organizationId, requestId: request.id };

  /*
    Both decisions ask first (Rui, 04-11-2026), in the shared question. A refusal
    still needs its reason — story 7: "no" with no reason generates the
    conversation anyway — so the reason box is inside the refusal's question.
  */
  return (
    <div className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
      <RequestSummary request={request} />

      <div className="flex flex-wrap items-center gap-3">
        <ConfirmAction
          action={decide}
          pending={pending}
          fields={{ ...fields, decision: 'approve' }}
          title={t('vacations.approveTitle', { name: who })}
          message={t('vacations.approveConfirm', { count: request.days.length })}
          confirmLabel={t('vacations.approve')}
          trigger={t('vacations.approve')}
          triggerClassName="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded-sm bg-primary text-primary-foreground disabled:opacity-60 font-semibold"
        />
        <ConfirmAction
          action={decide}
          pending={pending}
          fields={{ ...fields, decision: 'reject' }}
          title={t('vacations.rejectTitle', { name: who })}
          message={t('vacations.rejectConfirm')}
          confirmLabel={t('vacations.confirmReject')}
          tone="danger"
          trigger={t('vacations.reject')}
          triggerClassName="inline-flex h-control items-center justify-center rounded-sm px-4 text-control text-danger hover:underline"
        >
          <div className={FIELD_COLUMN}>
            <label htmlFor={`note-${request.id}`} className={FIELD_LABEL}>
              {t('vacations.reason')}
            </label>
            <input
              id={`note-${request.id}`}
              name="note"
              required
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder={t('vacations.reasonPlaceholder')}
              className={CONTROL_LINE}
            />
          </div>
        </ConfirmAction>
      </div>
    </div>
  );
}

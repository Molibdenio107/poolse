'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Ban, ChevronRight, UserRoundX } from 'lucide-react';
import { ConfirmButton } from '@/components/confirm-action';
import { TextAreaField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { cancelLessonAction, requestCoverAction, withdrawCoverAction } from './lesson.actions';

const INITIAL: FormState = { ok: false };

const SECONDARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control font-medium shadow-card hover:text-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const PRIMARY =
  'inline-flex h-control items-center justify-center self-start rounded-sm bg-primary px-4 text-control font-medium text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const DANGER =
  'inline-flex h-control items-center justify-center self-start rounded-sm bg-surface px-4 text-control font-medium text-danger shadow-card disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger';

/** One entry under *Mais opções*: a row that opens to a sentence, a text box and a button. */
function Option({
  icon,
  label,
  tone,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: 'danger';
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <details className="group/option">
      <summary
        className={`flex min-h-[48px] cursor-pointer list-none items-center gap-3 py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          tone === 'danger' ? 'text-danger' : ''
        }`}
      >
        {icon}
        <span className="flex-1">{label}</span>
        <ChevronRight className="size-4 text-foreground-muted transition-transform group-open/option:rotate-90" aria-hidden />
      </summary>
      <div className="flex flex-col gap-3 pb-3">{children}</div>
    </details>
  );
}

/**
 * Not being able to come — POOLSE-198. *Pedir substituição* and *Cancelar esta
 * aula* are two matching entries under *Mais opções* (Rui, 07-11-2026): each opens
 * to what happens, a text box and a button that asks before it acts. A request
 * already sent shows at the top, because it is news the teacher is waiting on.
 */
export function LessonActions({
  sessionId,
  request,
  canRequest,
  canCancel,
  part,
}: {
  sessionId: string;
  /** The open request on this lesson, if any. */
  request: { note: string | null } | null;
  canRequest: boolean;
  canCancel: boolean;
  /** The waiting request sits under the title; the options at the foot, after the whole roll. */
  part: 'cover' | 'cancel';
}): React.ReactElement | null {
  const t = useTranslations();
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [, ask, askPending] = useSavedAction(requestCoverAction, INITIAL);
  const [, withdraw, withdrawPending] = useSavedAction(withdrawCoverAction, INITIAL);
  const [cancelState, cancel, cancelPending] = useSavedAction(cancelLessonAction, INITIAL);
  const reasonError = cancelState.fields?.['reason'];

  const offerCover = canRequest && request === null;
  if (part === 'cover') {
    if (request === null) return null;
    return (
      <section className="flex flex-col gap-2 rounded bg-surface p-4 shadow-card">
        <p className="font-medium">{t('app.teaching.coverWaiting')}</p>
        {request.note !== null && <p className="text-sm text-foreground-muted">{request.note}</p>}
        <form action={withdraw}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <button type="submit" disabled={withdrawPending} className={SECONDARY}>
            {t('app.teaching.coverWithdraw')}
          </button>
        </form>
      </section>
    );
  }

  if (!canCancel && !offerCover) return null;
  return (
    <details className="rounded bg-surface px-4 py-2 shadow-card">
      <summary className="cursor-pointer py-2 text-sm font-medium text-foreground-muted">
        {t('app.teaching.moreOptions')}
      </summary>
      <div className="flex flex-col divide-y divide-border">
        {offerCover && (
          <Option icon={<UserRoundX className="size-5 text-primary" aria-hidden />} label={t('app.teaching.coverRequest')}>
            <p className="text-sm text-foreground-muted">{t('app.teaching.coverExplain')}</p>
            <form action={ask} className="flex flex-col gap-3">
              <input type="hidden" name="sessionId" value={sessionId} />
              <TextAreaField
                name="note"
                label={t('app.teaching.coverNote')}
                initial={note}
                rows={2}
                maxLength={500}
                onValueChange={setNote}
              />
              <ConfirmButton
                title={t('app.teaching.coverConfirmTitle')}
                message={t('app.teaching.coverExplain')}
                confirmLabel={t('app.teaching.coverSend')}
                disabled={askPending}
                className={PRIMARY}
              >
                {t('app.teaching.coverSend')}
              </ConfirmButton>
            </form>
          </Option>
        )}
        {canCancel && (
          <Option icon={<Ban className="size-5" aria-hidden />} label={t('app.teaching.cancelButton')} tone="danger">
            <p className="text-sm text-foreground-muted">{t('app.teaching.cancelMessage')}</p>
            <form action={cancel} className="flex flex-col gap-3">
              <input type="hidden" name="sessionId" value={sessionId} />
              <TextAreaField
                name="reason"
                label={t('app.teaching.cancelReason')}
                initial={reason}
                rows={2}
                maxLength={200}
                required
                onValueChange={setReason}
                {...(reasonError === undefined ? {} : { error: t(reasonError) })}
              />
              <ConfirmButton
                title={t('app.teaching.cancelTitle')}
                message={t('app.teaching.cancelMessage')}
                confirmLabel={t('app.teaching.cancelConfirm')}
                tone="danger"
                disabled={cancelPending}
                className={DANGER}
              >
                {t('app.teaching.cancelConfirm')}
              </ConfirmButton>
            </form>
          </Option>
        )}
      </div>
    </details>
  );
}

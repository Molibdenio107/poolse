'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { UserRoundX } from 'lucide-react';
import { ConfirmButton } from '@/components/confirm-action';
import { Dialog } from '@/components/ui/dialog';
import { TextAreaField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { cancelLessonAction, requestCoverAction, withdrawCoverAction } from './lesson.actions';

const INITIAL: FormState = { ok: false };

const SECONDARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control font-medium shadow-card hover:text-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const DANGER =
  'inline-flex h-control items-center justify-center self-start rounded-sm bg-surface px-4 text-control font-medium text-danger shadow-card disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger';

/**
 * Not being able to come — POOLSE-198. *Pedir substituição* is a button, because
 * it is the usual answer and the office decides who covers. *Cancelar aula* is
 * folded under *Mais opções* with a required reason and a question that says the
 * families will be told (Rui, 07-11-2026): available at any time, never on the way
 * to something else.
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
  /** Asking sits under the title; cancelling at the foot, after the whole roll. */
  part: 'cover' | 'cancel';
}): React.ReactElement | null {
  const t = useTranslations();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [, ask, askPending] = useSavedAction(requestCoverAction, INITIAL);
  const [, withdraw, withdrawPending] = useSavedAction(withdrawCoverAction, INITIAL);
  const [cancelState, cancel, cancelPending] = useSavedAction(cancelLessonAction, INITIAL);
  const reasonError = cancelState.fields?.['reason'];

  if (part === 'cancel' ? !canCancel : !canRequest && request === null) return null;

  return (
    <section className="flex flex-col gap-3">
      {part === 'cancel' ? null : request !== null ? (
        <div className="flex flex-col gap-2 rounded bg-surface p-4 shadow-card">
          <p className="font-medium">{t('app.teaching.coverWaiting')}</p>
          {request.note !== null && <p className="text-sm text-foreground-muted">{request.note}</p>}
          <form action={withdraw}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <button type="submit" disabled={withdrawPending} className={SECONDARY}>
              {t('app.teaching.coverWithdraw')}
            </button>
          </form>
        </div>
      ) : (
        canRequest && (
          <button type="button" onClick={() => setAsking(true)} className={`${SECONDARY} self-start`}>
            <UserRoundX className="size-4" aria-hidden />
            {t('app.teaching.coverRequest')}
          </button>
        )
      )}

      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={t('app.teaching.coverRequest')}
        description={t('app.teaching.coverExplain')}
        closeLabel={t('common.close')}
      >
        <form
          action={(data) => {
            ask(data);
            setAsking(false);
          }}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="sessionId" value={sessionId} />
          <TextAreaField
            name="note"
            label={t('app.teaching.coverNote')}
            initial={note}
            rows={2}
            maxLength={500}
            onValueChange={setNote}
          />
          <button type="submit" disabled={askPending} className={`${SECONDARY} self-start`}>
            {t('app.teaching.coverSend')}
          </button>
        </form>
      </Dialog>

      {part === 'cancel' && (
        <details className="rounded bg-surface p-4 shadow-card">
          <summary className="cursor-pointer text-sm font-medium text-foreground-muted">
            {t('app.teaching.moreOptions')}
          </summary>
          <form action={cancel} className="mt-3 flex flex-col gap-3">
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
              {t('app.teaching.cancelButton')}
            </ConfirmButton>
          </form>
        </details>
      )}
    </section>
  );
}

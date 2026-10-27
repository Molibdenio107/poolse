'use client';

import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import { cn } from '@/lib/utils';
import type { FormState } from '../../dashboard/actions';
import { saveNoticeAction } from './notice.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Vou / Não vou* — POOLSE-90 slice 2. Two buttons, the chosen one pressed
 * (`aria-pressed`) and said in words beside an icon. Each is its own submit, so
 * one tap answers; tapping the other changes the answer. Nothing here marks
 * attendance — the register is still the instructor's.
 */
export function NoticeToggle({
  sessionId,
  studentId,
  going,
}: {
  sessionId: string;
  studentId: string;
  going: boolean | null;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(saveNoticeAction, INITIAL);

  const button = (value: boolean): React.ReactElement => {
    const chosen = going === value;
    const Icon = value ? Check : X;
    return (
      <form action={action} className="flex-1">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="studentId" value={studentId} />
        <input type="hidden" name="going" value={String(value)} />
        <button
          type="submit"
          disabled={pending}
          aria-pressed={chosen}
          className={cn(
            'inline-flex h-control w-full items-center justify-center gap-2 rounded border px-4 text-control font-medium disabled:opacity-60',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            chosen ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface text-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden />
          {value ? t('app.notice.going') : t('app.notice.notGoing')}
        </button>
      </form>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2" role="group" aria-label={t('app.notice.question')}>
        {button(true)}
        {button(false)}
      </div>
      <p className="text-sm text-foreground-muted">
        {going === null ? t('app.notice.unanswered') : going ? t('app.notice.saidGoing') : t('app.notice.saidNotGoing')}
      </p>
    </div>
  );
}

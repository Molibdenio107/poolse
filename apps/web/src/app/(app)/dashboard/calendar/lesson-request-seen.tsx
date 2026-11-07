'use client';

import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../actions';
import { lessonRequestSeenAction } from './calendar.actions';

const INITIAL: FormState = { ok: false };

/** *Visto*: the office has read that a teacher cancelled a lesson (POOLSE-198). */
export function LessonRequestSeen({ id }: { id: string }): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(lessonRequestSeenAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm text-primary underline-offset-2 hover:underline disabled:opacity-60"
      >
        {t('calendar.requests.seen')}
      </button>
    </form>
  );
}

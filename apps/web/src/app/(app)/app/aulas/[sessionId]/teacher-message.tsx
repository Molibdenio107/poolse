'use client';

import { useTranslations } from 'next-intl';
import { TextAreaField, TextField, useSuccessKey } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { sendClassMessageAction } from './lesson.actions';

const INITIAL: FormState = { ok: false };

/**
 * A word to the class — POOLSE-199. One box: it becomes an aviso in the app and an
 * email to the same people (Rui, 07-11-2026). The API refuses a turma that is not
 * the teacher's own, whatever this form sends.
 */
export function TeacherMessage({ classGroupId }: { classGroupId: string }): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(sendClassMessageAction, INITIAL);
  const sent = useSuccessKey(state);
  const error = (field: string): { error?: string } =>
    state.fields?.[field] === undefined ? {} : { error: t(state.fields[field]) };

  return (
    <form key={sent} action={action} className="flex flex-col gap-3">
      <input type="hidden" name="classGroupId" value={classGroupId} />
      <p className="text-sm text-foreground-muted">{t('app.teaching.messageHint')}</p>
      <TextField name="subject" label={t('app.teaching.messageSubject')} required maxLength={200} {...error('subject')} />
      <TextAreaField name="body" label={t('app.teaching.messageBody')} rows={4} required {...error('body')} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center self-start rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {pending ? t('common.working') : t('app.teaching.messageSend')}
      </button>
    </form>
  );
}

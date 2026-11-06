'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import { useSeeded, useSuccessKey } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../../dashboard/actions';
import { sendDocumentAction } from './send.actions';

const INITIAL: FormState = { ok: false };

/** What a phone may offer; the API judges the bytes, whatever this says. */
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

/**
 * Sending one paper — POOLSE-179 slice 2. A file (a photo from the camera
 * roll, a PDF, an iPhone's HEIC) and, for the exam, the date on it. The office
 * reads the result; the family never types it.
 */
export function SendDocument({ child, kind }: { child: string; kind: string }): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(sendDocumentAction, INITIAL);
  const fileId = useId();
  const dateId = useId();
  const [examinedOn, setExaminedOn] = useSeeded<string>('', useSuccessKey(state));
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="child" value={child} />
      <input type="hidden" name="kind" value={kind} />
      {kind === 'medical_exam' && (
        <label htmlFor={dateId} className="flex flex-col gap-1 text-sm">
          {t('app.documents.send.examDate')}
          <input
            id={dateId}
            name="examinedOn"
            type="date"
            required
            value={examinedOn}
            onChange={(event) => setExaminedOn(event.target.value)}
            className="h-control rounded-sm border border-border-strong bg-background px-3 text-control"
          />
        </label>
      )}
      <label htmlFor={fileId} className="sr-only">
        {t('app.documents.send.file', { kind: t(`app.documents.kind.${kind}`) })}
      </label>
      <input
        id={fileId}
        name="file"
        type="file"
        required
        accept={ACCEPT}
        className="text-sm file:mr-3 file:h-control file:rounded-sm file:border-0 file:bg-surface-muted file:px-3"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center gap-2 self-start rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60"
      >
        <Upload aria-hidden className="size-4" />
        {pending ? t('common.working') : t('app.documents.send.submit')}
      </button>
      {state.errorKey !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {t(state.errorKey as never)}
        </p>
      )}
      <p className="text-sm text-foreground-muted">{t('app.documents.send.hint')}</p>
    </form>
  );
}

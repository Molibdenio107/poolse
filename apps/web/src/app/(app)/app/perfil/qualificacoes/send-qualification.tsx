'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import { SelectField, TextField, useSuccessKey } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { sendOwnQualificationAction } from './qualification.actions';

const INITIAL: FormState = { ok: false };

/**
 * A teacher sends a qualification from the phone (Rui, 07-11-2026): which one,
 * who issued it, the dates and a photo or PDF of the certificate. It arrives as
 * *Por confirmar* and counts once the office confirms it.
 */
export function SendQualification({ types }: { types: { id: string; name: string }[] }): React.ReactElement {
  const t = useTranslations();
  const [state, send, sending] = useSavedAction(sendOwnQualificationAction, INITIAL);
  const sent = useSuccessKey(state);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const error = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-control items-center justify-center gap-2 self-start rounded-sm bg-primary px-4 text-control font-medium text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Upload className="size-4" aria-hidden />
        {t('app.teaching.qualificationSend')}
      </button>
    );
  }

  return (
    <form key={sent} action={send} className="flex flex-col gap-4 rounded bg-surface p-4 shadow-card">
      <h2 className="font-medium">{t('app.teaching.qualificationSend')}</h2>
      <p className="text-sm text-foreground-muted">{t('app.teaching.qualificationSendHint')}</p>
      <SelectField
        name="typeId"
        label={t('qualifications.field.type')}
        initial={types[0]?.id ?? ''}
        options={types.map((type) => ({ value: type.id, label: type.name }))}
        error={error('typeId')}
      />
      <TextField
        name="issuingBody"
        label={t('qualifications.field.issuingBody')}
        initial=""
        maxLength={200}
        error={error('issuingBody')}
      />
      <TextField name="issuedOn" type="date" label={t('qualifications.field.issuedOn')} initial="" error={error('issuedOn')} />
      <TextField
        name="expiresOn"
        type="date"
        label={t('qualifications.field.expiresOn')}
        initial=""
        hint={t('qualifications.field.expiresHint')}
        error={error('expiresOn')}
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('app.teaching.qualificationFile')}</span>
        <span className="inline-flex h-control cursor-pointer items-center gap-2 self-start rounded-sm bg-surface px-4 text-control font-medium shadow-card focus-within:outline focus-within:outline-2 focus-within:outline-primary">
          <Upload className="size-4" aria-hidden />
          {fileName === '' ? t('app.teaching.qualificationChoose') : fileName}
          <input
            type="file"
            name="file"
            accept="image/*,application/pdf"
            className="sr-only"
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')}
          />
        </span>
      </label>
      <button
        type="submit"
        disabled={sending}
        className="inline-flex h-control items-center justify-center self-start rounded-sm bg-primary px-4 text-control font-medium text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {sending ? t('common.working') : t('app.teaching.qualificationSubmit')}
      </button>
    </form>
  );
}

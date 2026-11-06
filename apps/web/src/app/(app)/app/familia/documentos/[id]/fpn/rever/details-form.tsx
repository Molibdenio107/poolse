'use client';

import { useTranslations } from 'next-intl';
import { TextField, useSeeded } from '@/components/ui/field';
import type { AppFpnReview } from '@/lib/api';
import { FPN_DISCIPLINES } from '@/lib/fpn-forms';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../../../../../dashboard/actions';
import { saveFpnDetailsAction } from './details.actions';

const INITIAL: FormState = { ok: false };
const INPUT = 'h-control rounded-sm border border-border-strong bg-background px-3 text-control';
const ID_TYPES = ['cc', 'bi', 'passport', 'other'] as const;

/**
 * The person corrects what the FPN form prints — POOLSE-193 (Rui, 06-11-2026).
 * Saved straight onto the record: the signed form is what the office reviews, and
 * the log names each change. Open when something of theirs is missing.
 */
export function FpnDetailsForm({
  child,
  review,
  open,
}: {
  child: string;
  review: AppFpnReview;
  open: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(saveFpnDetailsAction, INITIAL);
  const [type, setType] = useSeeded<string>(review.idDocumentType ?? '');
  const [issuedOn, setIssuedOn] = useSeeded<string>(review.issuedOn ?? '');
  const [validUntil, setValidUntil] = useSeeded<string>(review.validUntil ?? '');
  const label = (key: string): string => t(`app.documents.review.field.${key}` as never);
  const error = (name: string): string | null =>
    state.fields?.[name] === undefined ? null : t(state.fields[name] as never);
  const shown = (name: string): { error: string } | Record<string, never> => {
    const message = error(name);
    return message === null ? {} : { error: message };
  };
  return (
    <details open={open} className="rounded bg-surface p-4 shadow-card">
      <summary className="cursor-pointer font-medium text-primary">{t('app.documents.review.edit')}</summary>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="child" value={child} />
        <TextField name="addressLine" label={label('addressLine')} initial={review.addressLine ?? ''} maxLength={200} {...shown('addressLine')} />
        <TextField name="locality" label={label('locality')} initial={review.locality ?? ''} maxLength={100} {...shown('locality')} />
        <TextField name="postalCode" label={label('postalCode')} initial={review.postalCode ?? ''} inputMode="numeric" {...shown('postalCode')} />
        <label className="flex flex-col gap-1 text-sm">
          {label('idDocumentType')}
          <select name="idDocumentType" value={type} onChange={(event) => setType(event.target.value)} className={INPUT}>
            <option value="">{t('app.documents.review.none')}</option>
            {ID_TYPES.map((one) => (
              <option key={one} value={one}>
                {t(`documents.idDocument.types.${one}`)}
              </option>
            ))}
          </select>
          {error('idDocumentType') !== null && <span className="text-danger">{error('idDocumentType')}</span>}
        </label>
        <TextField
          name="idDocumentNumber"
          label={label('idDocumentNumber')}
          initial={review.idDocumentNumber ?? ''}
          hint={t('app.documents.review.numberHint')}
          {...shown('idDocumentNumber')}
        />
        <label className="flex flex-col gap-1 text-sm">
          {label('issuedOn')}
          <input type="date" name="idDocumentIssuedOn" value={issuedOn} onChange={(event) => setIssuedOn(event.target.value)} className={INPUT} />
          {error('idDocumentIssuedOn') !== null && <span className="text-danger">{error('idDocumentIssuedOn')}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {label('idDocumentValidUntil')}
          <input type="date" name="idDocumentValidUntil" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className={INPUT} />
          {error('idDocumentValidUntil') !== null && <span className="text-danger">{error('idDocumentValidUntil')}</span>}
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm">{label('disciplines')}</legend>
          {FPN_DISCIPLINES.map((one) => (
            <Discipline key={one} name={one} initial={review.disciplines.includes(one)} />
          ))}
        </fieldset>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60"
        >
          {t('app.documents.review.save')}
        </button>
        {state.errorKey !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {t(state.errorKey as never)}
          </p>
        )}
      </form>
    </details>
  );
}

function Discipline({ name, initial }: { name: string; initial: boolean }): React.ReactElement {
  const t = useTranslations();
  const [on, setOn] = useSeeded<boolean>(initial);
  return (
    <label className="flex min-h-control items-center gap-2 text-sm">
      <input
        type="checkbox"
        name="disciplines"
        value={name}
        checked={on}
        onChange={(event) => setOn(event.target.checked)}
        className="size-5"
      />
      {t(`documents.discipline.${name}` as never)}
    </label>
  );
}

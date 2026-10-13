'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SelectField, TextAreaField, TextField, useFocusFirstError } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { publishRegulationAction, saveComplaintsAction, withdrawRegulationAction } from './regulation.actions';

const INITIAL: FormState = { ok: false };

const PRIMARY =
  'inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-60';
const BUTTON =
  'inline-flex h-control items-center justify-center rounded border border-border px-4 text-control hover:bg-surface-muted disabled:opacity-60';

/**
 * Publish a new version — POOLSE-73. Seeded with the version in force, because
 * a new version is nearly always the last one with a paragraph changed; the
 * one in force is never edited. Controlled fields, so a refusal keeps the text.
 */
export function PublishRegulationForm({
  facilityId,
  currentBody,
  today,
}: {
  facilityId: string;
  currentBody: string;
  today: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(publishRegulationAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);
  const error = (field: string): string | undefined => {
    const key = state.fields?.[field];
    return key === undefined ? undefined : t(key);
  };
  return (
    <details className="rounded border border-border">
      <summary className="cursor-pointer list-none p-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {t('regulation.publishNew')}
      </summary>
      <form ref={formRef} action={dispatch} className="flex flex-col gap-4 border-t border-border p-4">
        <input type="hidden" name="facilityId" value={facilityId} />
        <p className="text-sm text-foreground-muted">{t('regulation.publishHint')}</p>
        <TextField
          name="effectiveFrom"
          type="date"
          label={t('regulation.effectiveFrom')}
          hint={t('regulation.effectiveFromHint')}
          initial={today}
          required
          error={error('effectiveFrom')}
        />
        <TextAreaField
          name="body"
          label={t('regulation.body')}
          initial={currentBody}
          maxLength={50000}
          error={error('body')}
          className="max-w-none"
        />
        <div>
          <button type="submit" disabled={pending} className={PRIMARY}>
            {pending ? t('common.working') : t('regulation.publish')}
          </button>
        </div>
      </form>
    </details>
  );
}

export function WithdrawRegulationButton({
  facilityId,
  regulationId,
}: {
  facilityId: string;
  regulationId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, dispatch, pending] = useSavedAction(withdrawRegulationAction, INITIAL);
  return (
    <form action={dispatch}>
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="regulationId" value={regulationId} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {t('regulation.withdraw')}
      </button>
    </form>
  );
}

/**
 * Where a complaint goes — the whole club's setting, shown on each site's tab
 * because that is where the public page it changes is managed.
 */
export function ComplaintsForm({
  facilityId,
  regime,
  url,
  officialUrl,
}: {
  facilityId: string;
  regime: 'private' | 'public_service';
  url: string | null;
  officialUrl: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(saveComplaintsAction, INITIAL);
  const [chosen, setChosen] = useState<string>(regime);
  const urlKey = state.fields?.['url'];
  return (
    <form action={dispatch} className="flex flex-col gap-4">
      <input type="hidden" name="facilityId" value={facilityId} />
      <SelectField
        name="regime"
        label={t('publicNotices.regime')}
        initial={regime}
        onValueChange={setChosen}
        options={[
          { value: 'private', label: t('publicNotices.regimePrivate') },
          { value: 'public_service', label: t('publicNotices.regimePublic') },
        ]}
      />
      {chosen === 'public_service' ? (
        <TextField
          name="url"
          type="url"
          label={t('publicNotices.url')}
          hint={t('publicNotices.urlHint')}
          initial={url ?? ''}
          maxLength={300}
          error={urlKey === undefined ? undefined : t(urlKey)}
        />
      ) : (
        <p className="text-sm text-foreground-muted">
          {t('publicNotices.privateHint')}{' '}
          <a href={officialUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {officialUrl}
          </a>
        </p>
      )}
      <div>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t('common.working') : t('common.save')}
        </button>
      </div>
    </form>
  );
}

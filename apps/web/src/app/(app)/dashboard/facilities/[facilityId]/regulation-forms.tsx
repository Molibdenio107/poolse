'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SelectField, TextAreaField, TextField, useFocusFirstError } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
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
 *
 * A primary button beside the tab's header that opens the form in a side
 * sheet — POOLSE-92 G. The version history stays the body of the tab; the form
 * used to sit under it as a disclosure that read as part of the history.
 */
export function PublishRegulation({
  facilityId,
  currentBody,
  today,
}: {
  facilityId: string;
  currentBody: string;
  today: string;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, dispatch, pending] = useSavedAction(publishRegulationAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);
  // A version that published closes the sheet; a refusal keeps it, and the text.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);
  const error = (field: string): string | undefined => {
    const key = state.fields?.[field];
    return key === undefined ? undefined : t(key);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(PRIMARY, 'shrink-0 gap-2')}>
        <Plus aria-hidden className="size-4" />
        {t('regulation.publishNew')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        placement="side"
        title={t('regulation.publishNew')}
        description={t('regulation.publishHint')}
        closeLabel={t('common.close')}
      >
        <form ref={formRef} action={dispatch} className="flex flex-col gap-4">
          <input type="hidden" name="facilityId" value={facilityId} />
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
            // Ten lines and it scrolls inside itself, so Publicar stays on a
            // phone's screen however long the regulation is.
            rows={10}
            maxLength={50000}
            error={error('body')}
            className="max-w-none"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={BUTTON}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={pending} className={PRIMARY}>
              {pending ? t('common.working') : t('regulation.publish')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/**
 * Withdrawing takes a version off every public page at once, so it asks first
 * and names the version — 13-10-2026 sweep. One click used to do it, from a
 * list of identical "Retirar" buttons a screen reader could not tell apart.
 */
export function WithdrawRegulationButton({
  facilityId,
  regulationId,
  versionDate,
}: {
  facilityId: string;
  regulationId: string;
  /** The day it takes effect, already formatted — what tells the versions apart. */
  versionDate: string;
}): React.ReactElement {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, dispatch, pending] = useSavedAction(withdrawRegulationAction, INITIAL);
  useEffect(() => {
    if (state.ok) setConfirming(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={t('regulation.withdrawLabel', { date: versionDate })}
        className={BUTTON}
      >
        {t('regulation.withdraw')}
      </button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('regulation.withdrawTitle', { date: versionDate })}
        closeLabel={t('common.close')}
      >
        <form action={dispatch} className="flex flex-col gap-4">
          <input type="hidden" name="facilityId" value={facilityId} />
          <input type="hidden" name="regulationId" value={regulationId} />
          <p className="text-sm">{t('regulation.withdrawConfirm')}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} className={BUTTON}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-control items-center justify-center gap-2 rounded border border-danger/50 px-4 text-control text-danger hover:bg-danger/10 disabled:opacity-60"
            >
              {pending ? t('common.working') : t('regulation.withdraw')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
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

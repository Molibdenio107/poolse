'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TextField, useFocusFirstError } from '@/components/ui/field';
import type { RegistrationSettings } from '@/lib/api';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { saveRegistrationSettingsAction } from './leads.actions';

const INITIAL: FormState = { ok: false };

/**
 * The public form's switch and address — POOLSE-69.
 *
 * The Owner edits; an Admin reads the link to share it. The address is the
 * club's existing slug, so changing it moves the link every poster and website
 * already prints — the hint says so before anybody presses Guardar.
 */
export function RegistrationSettingsForm({
  settings,
  origin,
  canEdit,
}: {
  settings: RegistrationSettings;
  origin: string;
  canEdit: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(saveRegistrationSettingsAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);
  const [open, setOpen] = useState(settings.open);

  const link = `${origin}/inscricao/${settings.slug}`;
  const slugError = state.fields?.['slug'];

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2 rounded border border-border bg-surface p-5">
        <p className="font-medium">
          {settings.open ? t('leads.settings.isOpen') : t('leads.settings.isClosed')}
        </p>
        <p className="break-all text-sm">
          <a href={link} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {link}
          </a>
        </p>
        <p className="text-sm text-foreground-muted">
          {settings.open ? t('leads.settings.openHint') : t('leads.settings.closedHint')}
        </p>
      </section>

      {canEdit ? (
        <form ref={formRef} action={dispatch} className="flex flex-col gap-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="open"
              checked={open}
              onChange={(event) => setOpen(event.target.checked)}
              className="mt-1 size-4 shrink-0 accent-primary"
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium">{t('leads.settings.open')}</span>
              <span className="text-sm text-foreground-muted">{t('leads.settings.openToggleHint')}</span>
            </span>
          </label>
          <TextField
            name="slug"
            label={t('leads.settings.slug')}
            hint={t('leads.settings.slugHint')}
            initial={settings.slug}
            maxLength={60}
            error={slugError === undefined ? undefined : t(slugError)}
          />
          <div>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-60"
            >
              {t('common.save')}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-foreground-muted">{t('leads.settings.ownerOnly')}</p>
      )}
    </div>
  );
}

'use client';

import { useActionState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { ReposicaoSettings } from '@/lib/api';
import { SelectField, TextField, useFocusFirstError } from '@/components/ui/field';
import type { FormState } from '../../actions';
import { saveReposicaoSettingsAction } from './reposicoes.actions';

const INITIAL: FormState = { ok: false };

/**
 * The club's reposição rules — POOLSE-21, criteria 1, 4, 6 and 9.
 *
 * Controlled fields throughout, per the standing rule: React 19 resets a form as
 * soon as a function action returns, *including* on a validation error, so an
 * uncontrolled input wipes what somebody typed at the exact moment they are
 * being asked to correct it.
 *
 * The two settings that redemption reads — backfill-only and the approval mode —
 * are here even though nothing books yet. They are one screen rather than two,
 * and a club turning the feature on wants to answer the whole question in one
 * sitting rather than being asked again next month.
 */
export function ReposicaoSettingsForm({
  organizationId,
  settings,
}: {
  organizationId: string;
  settings: ReposicaoSettings;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(saveReposicaoSettingsAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);

  const error = (field: string): string | undefined => {
    const key = state.fields?.[field];
    return key === undefined ? undefined : t(key);
  };

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-5">
      <input type="hidden" name="organizationId" value={organizationId} />

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={settings.enabled}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span className="flex flex-col gap-1">
          <span className="font-medium">{t('reposicao.enabled')}</span>
          <span className="text-sm text-foreground-muted">{t('reposicao.enabledHint')}</span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="windowDays"
          label={t('reposicao.windowDays')}
          hint={t('reposicao.windowDaysHint')}
          initial={String(settings.windowDays)}
          error={error('windowDays')}
        />

        <TextField
          name="capPerSeason"
          label={t('reposicao.cap')}
          hint={t('reposicao.capHint')}
          initial={settings.capPerSeason === null ? '' : String(settings.capPerSeason)}
          error={error('capPerSeason')}
        />
      </div>

      <SelectField
        name="mode"
        label={t('reposicao.mode')}
        hint={t('reposicao.modeHint')}
        initial={settings.mode}
        options={[
          { value: 'request', label: t('reposicao.modeRequest') },
          { value: 'self_service', label: t('reposicao.modeSelfService') },
        ]}
      />

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="backfillOnly"
          defaultChecked={settings.backfillOnly}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <span className="flex flex-col gap-1">
          <span className="font-medium">{t('reposicao.backfillOnly')}</span>
          <span className="text-sm text-foreground-muted">{t('reposicao.backfillOnlyHint')}</span>
        </span>
      </label>

      {/*
        Said out loud rather than left to be discovered. A setting whose blast
        radius is unclear is a setting nobody dares touch, and the answer here is
        reassuring: the rule is copied onto each credit when it is minted, so
        changing it never rewrites what a family has already been promised.
      */}
      <p className="rounded border border-border bg-surface-muted px-3 py-2 text-sm text-foreground-muted">
        {t('reposicao.notRetroactive')}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('common.save')}
        </button>

        {state.ok && <span className="text-sm text-foreground-muted">{t('reposicao.saved')}</span>}
        {state.errorKey !== undefined && (
          <span className="text-sm text-danger">{t(state.errorKey)}</span>
        )}
      </div>
    </form>
  );
}

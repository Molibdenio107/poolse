'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SelectField, TextAreaField, TextField, useSuccessKey } from '@/components/ui/field';
import { ConfirmButton } from '@/components/confirm-action';
import { useSavedAction } from '@/lib/saved';
import type { AudienceOptions, MessageAudience } from '@/lib/api';
import { sportNameKey } from '@/components/sport-icon';
import type { FormState } from '../../actions';
import { endAvisoAction, postAvisoAction } from './avisos.actions';

const INITIAL: FormState = { ok: false };

/**
 * Composing an aviso — POOLSE-166: the Mensagens composer's audience, title and
 * text, with a window of two days in place of the send. Nothing is emailed, so
 * there is no review of addresses: the toast says how many students it reached.
 */
export function AvisoComposer({
  options,
  canAddressClub,
  today,
}: {
  options: AudienceOptions;
  /** Owner and admin. An instructor posts to their own turmas only. */
  canAddressClub: boolean;
  today: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, post, posting] = useSavedAction(postAvisoAction, INITIAL);
  // Cleared after a post that worked, never after one that failed.
  const fresh = useSuccessKey(state);

  const audiences: MessageAudience[] = [
    ...(options.classGroups.length > 0 ? (['class_group'] as const) : []),
    ...(options.levels.length > 0 ? (['level'] as const) : []),
    ...(options.facilities.length > 1 ? (['facility'] as const) : []),
    ...((options.sports ?? []).length > 1 ? (['sport'] as const) : []),
    ...(canAddressClub ? (['organization'] as const) : []),
  ];
  const [audience, setAudience] = useState<MessageAudience>(audiences[0] ?? 'class_group');
  const targets =
    audience === 'class_group'
      ? options.classGroups
      : audience === 'level'
        ? options.levels
        : audience === 'facility'
          ? options.facilities
          : audience === 'sport'
            ? (options.sports ?? []).map((sport) => ({ id: sport, name: t(sportNameKey(sport)), detail: null }))
            : [];

  const error = (name: string): string | undefined => {
    const key = state.ok ? undefined : state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };

  if (audiences.length === 0) {
    return <p className="text-sm text-foreground-muted">{t('messages.compose.nothingToAddressHint')}</p>;
  }

  return (
    <form key={fresh} action={post} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <SelectField
          name="audience"
          label={t('messages.field.audience')}
          initial={audiences[0] ?? ''}
          options={audiences.map((value) => ({ value, label: t(`messages.audience.${value}`) }))}
          onValueChange={(value) => setAudience(value as MessageAudience)}
          error={error('audience')}
          required
        />
        {audience !== 'organization' && (
          <SelectField
            key={audience}
            name="targetId"
            label={t(`messages.field.target.${audience}`)}
            initial={targets[0]?.id ?? ''}
            options={targets.map((option) => ({
              value: option.id,
              label: option.detail === null ? option.name : `${option.name} · ${option.detail}`,
            }))}
            error={error('targetId')}
            required
          />
        )}
        <TextField
          name="shownFrom"
          type="date"
          label={t('avisos.field.shownFrom')}
          initial={today}
          error={error('shownFrom')}
          required
        />
        <TextField
          name="shownUntil"
          type="date"
          label={t('avisos.field.shownUntil')}
          initial={today}
          error={error('shownUntil')}
          required
        />
      </div>
      <TextField
        name="subject"
        label={t('avisos.field.subject')}
        maxLength={200}
        error={error('subject')}
        required
        className="max-w-form"
      />
      <TextAreaField name="body" label={t('avisos.field.body')} rows={5} maxLength={10_000} error={error('body')} required />
      <div>
        <button
          type="submit"
          disabled={posting}
          className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60"
        >
          {posting ? t('avisos.posting') : t('avisos.post')}
        </button>
      </div>
    </form>
  );
}

/** *Terminar* — asks first; the toast offers *Anular* through the bin. */
export function EndAvisoButton({ avisoId, subject }: { avisoId: string; subject: string }): React.ReactElement {
  const t = useTranslations();
  const [, end, ending] = useSavedAction(endAvisoAction, INITIAL);
  return (
    <form action={end}>
      <input type="hidden" name="avisoId" value={avisoId} />
      <ConfirmButton
        title={t('avisos.endTitle', { subject })}
        message={t('avisos.endMessage')}
        confirmLabel={t('avisos.end')}
        tone="danger"
        disabled={ending}
        className="inline-flex h-control items-center justify-center rounded-sm bg-surface px-4 text-control text-foreground-muted shadow-card hover:text-danger"
      >
        {t('avisos.end')}
      </ConfirmButton>
    </form>
  );
}

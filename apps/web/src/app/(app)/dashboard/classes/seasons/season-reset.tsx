'use client';

import { useActionState, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import type { ResetPreview } from '@/lib/api';
import { TextField, useFocusFirstError } from '@/components/ui/field';
import type { FormState } from '../../actions';
import { resetSeasonAction } from './seasons.actions';

const INITIAL: FormState = { ok: false };

/** The word somebody has to type. Not translated — see `ConfirmField`. */
const CONFIRM_WORD = 'RESET';

/**
 * Starting a new season — POOLSE-07.
 *
 * Behind a disclosure and a typed confirmation, because it retires a year of a
 * club's work in one press and there is no undo button on the screen after it.
 * The data is all still there — nothing is deleted — but putting it back would
 * be a job for somebody with database access, which is not a recovery path an
 * operator has at eight in the evening.
 */
export function SeasonReset({
  organizationId,
  preview,
  suggested,
}: {
  organizationId: string;
  preview: ResetPreview | undefined;
  suggested: { name: string; startsOn: string; endsOn: string };
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(resetSeasonAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  // `state` is the attempt token: the action builds a fresh object every time,
  // so mistyping the confirmation twice focuses the box twice.
  useFocusFirstError(formRef, state.fields, state);
  const field = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key);
  };

  if (!open) {
    return (
      <div className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('seasons.startNew')}
        </h2>
        <p className="text-sm text-foreground-muted">{t('seasons.startNewHint')}</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="self-start rounded border border-border px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('seasons.startNew')}
        </button>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="flex flex-col gap-4 rounded border border-danger/40 bg-danger/5 p-5"
    >
      <input type="hidden" name="organizationId" value={organizationId} />

      <h2 className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 text-danger" aria-hidden />
        {t('seasons.startNew')}
      </h2>

      {/*
        Real numbers, not "your data will be archived". Somebody about to type a
        confirmation word is entitled to know whether it is nineteen turmas or an
        empty season they set up by mistake.
      */}
      {preview !== undefined && (
        <div className="flex flex-col gap-2 text-sm">
          <p>{t('seasons.willRetire', { season: preview.seasonName })}</p>
          <ul className="flex flex-col gap-1 text-foreground-muted">
            <li>{t('seasons.countClasses', { count: preview.classGroups })}</li>
            <li>{t('seasons.countEnrollments', { count: preview.enrollments })}</li>
            <li>{t('seasons.countSessions', { count: preview.sessions })}</li>
            <li>{t('seasons.countAttendance', { count: preview.attendance })}</li>
          </ul>
          <p className="text-foreground-muted">{t('seasons.nothingDeleted')}</p>
          <p className="text-foreground-muted">{t('seasons.keptData')}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <TextField
          name="name"
          label={t('seasons.newName')}
          initial={suggested.name}
          required
          maxLength={60}
          error={field('name')}
          className="min-w-40 flex-1"
        />
        <TextField
          name="startsOn"
          type="date"
          label={t('seasons.startsOn')}
          initial={suggested.startsOn}
          required
          error={field('startsOn')}
        />
        <TextField
          name="endsOn"
          type="date"
          label={t('seasons.endsOn')}
          initial={suggested.endsOn}
          required
          error={field('endsOn')}
        />
      </div>

      <ConfirmField error={field('confirm')} />

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-danger px-4 py-2 text-white disabled:opacity-60"
        >
          {pending ? t('common.working') : t('seasons.confirmButton')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-border px-4 py-2"
        >
          {t('common.cancel')}
        </button>
      </div>

      {state.errorKey !== undefined && <p className="text-sm text-danger">{t(state.errorKey)}</p>}
      {state.detail !== undefined && (
        <p className="font-mono text-sm text-foreground-muted">{state.detail}</p>
      )}
    </form>
  );
}

/**
 * The typed confirmation.
 *
 * The word stays `RESET` in both locales, and that is deliberate rather than an
 * untranslated string slipping through. Its job is to make the hand stop, and a
 * word the interface *shows you* and asks you to copy does that regardless of
 * language — while a translated one would mean the same organization behaves
 * differently depending on who is logged in. The label and the instruction
 * around it are translated; the token is not, and it is quoted in the label so
 * nobody has to guess at its case.
 */
function ConfirmField({ error }: { error: string | undefined }): React.ReactElement {
  const t = useTranslations();

  return (
    <TextField
      name="confirm"
      label={t('seasons.confirmLabel', { word: CONFIRM_WORD })}
      hint={t('seasons.confirmHint')}
      required
      autoComplete="off"
      maxLength={20}
      error={error}
      className="max-w-64"
    />
  );
}

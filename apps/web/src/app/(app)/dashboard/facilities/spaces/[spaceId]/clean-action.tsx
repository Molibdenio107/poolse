'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { TextAreaField } from '@/components/ui/field';
import type { FormState } from '../../../actions';
import { logCleaning } from '../../spaces.actions';

/**
 * "Marcar como limpo" — one tap, and nothing else.
 *
 * This is the whole errand for most visits to this screen, and the design point
 * is that it costs one press. Somebody has a mop in one hand and a phone in the
 * other; a form asking who they are and when they did it would be filled in
 * wrongly or not at all — and the server knows both answers already, correctly.
 *
 * The note is a *secondary* control, collapsed by default. It exists for "falta
 * lixívia" and is used on perhaps one visit in twenty; making it visible would
 * turn a button into a form for the nineteen.
 *
 * It stays a real form post, so it works before the JavaScript arrives.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center gap-1.5 rounded border border-border-strong px-3 text-sm ' +
  'transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

export function CleanAction({
  spaceId,
  facilityId,
}: {
  spaceId: string;
  facilityId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [noting, setNoting] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const [state, dispatch, pending] = useSavedAction<FormState, FormData>(
    logCleaning.bind(null, spaceId, facilityId),
    INITIAL,
  );

  // A saved note folds itself away again; leaving the box open with its text
  // still in it invites a second, identical entry.
  if (state.ok && noting) setNoting(false);

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <form ref={form} action={dispatch} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-control items-center gap-2 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
          >
            <Check className="size-4" aria-hidden="true" />
            {pending ? t('common.working') : t('spaces.markClean')}
          </button>

          <button
            type="button"
            onClick={() => setNoting((open) => !open)}
            aria-expanded={noting}
            className={BUTTON}
          >
            {noting ? t('spaces.hideNote') : t('spaces.addNote')}
          </button>
        </div>

        {noting && (
          <TextAreaField
            name="note"
            label={t('spaces.note')}
            rows={2}
            hint={t('spaces.noteHint')}
          />
        )}

        {state.errorKey !== undefined && (
          <p className="text-sm text-danger">{t(state.errorKey)}</p>
        )}
      </form>
    </section>
  );
}

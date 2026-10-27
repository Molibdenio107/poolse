'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TextAreaField, useSeeded } from '@/components/ui/field';
import { MOODS, MOOD_ICONS } from '@/components/mood';
import { useSavedAction } from '@/lib/saved';
import { cn } from '@/lib/utils';
import type { FormState } from '../../dashboard/actions';
import { saveFeedbackAction } from './feedback.actions';

const INITIAL: FormState = { ok: false };
const MAX_COMMENT = 500;

/**
 * Como correu a aula? — POOLSE-116. Five faces as radio buttons, each labelled
 * with its word so a screen reader says *Bem* and not *4*, a box for a few
 * words, and the sentence that says who reads it. Controlled throughout, and
 * the radios survive React's reset after a refusal through `FormResetGuard`.
 */
export function FeedbackForm({
  sessionId,
  studentId,
  mood: savedMood,
  comment: savedComment,
}: {
  sessionId: string;
  studentId: string;
  mood: number | null;
  comment: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(saveFeedbackAction, INITIAL);
  const [mood, setMood] = useSeeded(savedMood === null ? '' : String(savedMood));
  const [length, setLength] = useState((savedComment ?? '').length);
  // The box re-seeds to what was saved (trimmed by the API) without telling
  // `onValueChange`, so the counter follows the saved text too (sweep 27-10).
  useEffect(() => setLength((savedComment ?? '').length), [savedComment]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="studentId" value={studentId} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium">{t('app.feedback.prompt')}</legend>
        {/*
          One row of five on the narrowest phone: the faces alone, each 44 px
          under a finger, with its word for a screen reader — and the chosen
          mood said in words beside the row, so colour never carries it.
        */}
        <div className="grid max-w-sm grid-cols-5 gap-2">
          {MOODS.map((value) => {
            const Icon = MOOD_ICONS[value];
            const chosen = mood === String(value);
            return (
              <label
                key={value}
                className={cn(
                  'flex min-h-control min-w-[var(--control-h)] cursor-pointer items-center justify-center rounded-lg border py-1',
                  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary',
                  chosen ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface text-foreground',
                )}
              >
                <input
                  type="radio"
                  name="mood"
                  value={value}
                  checked={chosen}
                  onChange={() => setMood(String(value))}
                  className="sr-only"
                />
                <Icon className="size-7" aria-hidden />
                <span className="sr-only">{t(`feedback.mood.${value}`)}</span>
              </label>
            );
          })}
        </div>
        <p className="min-h-5 text-sm font-medium text-primary" aria-hidden>
          {mood === '' ? '' : t(`feedback.mood.${mood as '1' | '2' | '3' | '4' | '5'}`)}
        </p>
        {state.fields?.['mood'] !== undefined && (
          <p className="text-sm text-danger" role="alert">
            {t(state.fields['mood'])}
          </p>
        )}
      </fieldset>

      <TextAreaField
        name="comment"
        label={t('app.feedback.commentLabel')}
        initial={savedComment ?? ''}
        rows={3}
        maxLength={MAX_COMMENT}
        onValueChange={(value) => setLength(value.length)}
        hint={t('app.feedback.commentHint', { used: length, max: MAX_COMMENT })}
        {...(state.fields?.['comment'] === undefined ? {} : { error: t(state.fields['comment']) })}
      />

      <p className="text-sm text-foreground-muted">{t('app.feedback.notAnonymous')}</p>

      <div data-bottom-bar className="sticky bottom-0 -mx-3 border-t border-border bg-surface px-3 py-2 pb-[calc(0.5rem+var(--safe-bottom))] md:static md:mx-0 md:border-0 md:p-0">
        <button
          type="submit"
          disabled={pending || mood === ''}
          className="inline-flex h-control w-full items-center justify-center rounded bg-primary px-4 text-control font-medium text-primary-foreground disabled:opacity-60 md:w-auto"
        >
          {savedMood === null ? t('app.feedback.send') : t('app.feedback.update')}
        </button>
      </div>
    </form>
  );
}

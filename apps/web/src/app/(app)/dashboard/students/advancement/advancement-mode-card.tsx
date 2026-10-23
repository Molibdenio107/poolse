'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AdvancementMode } from '@/lib/api';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { setAdvancementModeAction } from '../students.actions';

const INITIAL: FormState = { ok: false };

/**
 * How the club handles an age proposal at the season change — POOLSE-112 BA 2.
 *
 * Two answers, said in full: *Propor* queues for a person, *Aplicar
 * automaticamente* moves the level on the season's first day and leaves the
 * turma. The radios are controlled and re-seeded from the server's value, as
 * every form control here is, so a refused save does not show a choice that
 * was not kept.
 */
export function AdvancementModeCard({
  organizationId,
  mode,
  canManage,
}: {
  organizationId: string;
  mode: AdvancementMode;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [chosen, setChosen] = useState<AdvancementMode>(mode);
  useEffect(() => setChosen(mode), [mode]);
  const [, action, pending] = useSavedAction(setAdvancementModeAction, INITIAL);

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('advancement.mode.title')}
      </h2>
      <p className="text-sm text-foreground-muted">{t('advancement.mode.hint')}</p>

      {canManage ? (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{t('advancement.mode.title')}</legend>
            {(['propose', 'apply'] as const).map((option) => (
              <label key={option} className="flex items-start gap-2 text-control">
                <input
                  type="radio"
                  name="mode"
                  value={option}
                  checked={chosen === option}
                  onChange={() => setChosen(option)}
                  className="mt-1 size-4 accent-primary"
                />
                <span className="flex flex-col">
                  <span>{t(`advancement.mode.${option}`)}</span>
                  <span className="text-sm text-foreground-muted">
                    {t(`advancement.mode.${option}Hint`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div>
            <button
              type="submit"
              disabled={pending || chosen === mode}
              className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60"
            >
              {t('common.save')}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-control">
          {t(`advancement.mode.${mode}`)}
          <span className="block text-sm text-foreground-muted">{t(`advancement.mode.${mode}Hint`)}</span>
        </p>
      )}
    </section>
  );
}

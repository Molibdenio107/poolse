'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../actions';
import { moveStepAction } from './setup.actions';
import type { SetupStep } from './steps';

const INITIAL: FormState = { ok: false };

const PRIMARY =
  'inline-flex h-control items-center justify-center rounded-sm bg-primary px-6 text-control font-semibold text-primary-foreground disabled:opacity-60';
const SECONDARY =
  'inline-flex h-control items-center justify-center rounded-sm bg-surface px-4 text-control shadow-card disabled:opacity-60';

/**
 * A step's way on — POOLSE-228. *Seguinte* (or the last step's own word) moves
 * on, *Voltar* reopens the one before, and *Terminar mais tarde* leaves for
 * Início with the pointer where it is. *Configurar mais tarde* is gone (Rui,
 * 19-11-2026): two ways to leave a step for later was one too many, and what a
 * step left blank still shows on *Vamos começar*, ticked by the club's data.
 * Each is one tap: moving through a guide is not a decision to ask about.
 */
export function StepControls({
  step,
  previous,
  nextLabelKey = 'setup.next',
}: {
  step: SetupStep;
  previous: SetupStep | null;
  nextLabelKey?: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(moveStepAction, INITIAL);

  return (
    <div className="flex flex-col gap-3 rounded bg-surface p-4 shadow-card sm:flex-row sm:flex-wrap sm:items-center">
      <form action={action} className="contents">
        <input type="hidden" name="step" value={step} />
        <button type="submit" name="outcome" value="done" disabled={pending} className={PRIMARY}>
          {t(nextLabelKey as never)}
        </button>
      </form>
      {previous !== null && (
        <form action={action} className="contents">
          <input type="hidden" name="step" value={previous} />
          <button type="submit" name="outcome" value="open" disabled={pending} className={SECONDARY}>
            {t('common.back')}
          </button>
        </form>
      )}
      <Link
        href="/dashboard/welcome"
        className="inline-flex min-h-control items-center text-sm text-foreground-muted hover:text-foreground sm:ml-auto"
      >
        {t('setup.finishLater')}
        <LinkBusy />
      </Link>
    </div>
  );
}

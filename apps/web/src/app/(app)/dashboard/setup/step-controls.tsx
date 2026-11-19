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
    // Along the setup card's bottom edge: Voltar on the left, Seguinte on the right (Rui, 19-11-2026).
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-8">
      {previous !== null ? (
        <form action={action}>
          <input type="hidden" name="step" value={previous} />
          <button type="submit" name="outcome" value="open" disabled={pending} className={SECONDARY}>
            {t('common.back')}
          </button>
        </form>
      ) : (
        <span aria-hidden />
      )}
      <form action={action}>
        <input type="hidden" name="step" value={step} />
        <button type="submit" name="outcome" value="done" disabled={pending} className={PRIMARY}>
          {t(nextLabelKey as never)}
        </button>
      </form>
    </div>
  );
}

/** Leaving for later, the quiet way out: under the card, centred, smaller. */
export function FinishLater(): React.ReactElement {
  const t = useTranslations();
  return (
    <div className="flex justify-center">
      <Link
        href="/dashboard/welcome"
        className="inline-flex min-h-control items-center text-xs text-foreground-muted hover:text-foreground"
      >
        {t('setup.finishLater')}
        <LinkBusy />
      </Link>
    </div>
  );
}

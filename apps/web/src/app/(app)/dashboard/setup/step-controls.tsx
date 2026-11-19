'use client';

import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../actions';
import { moveStepAction } from './setup.actions';
import { SETUP_STEPS, type SetupStep } from './steps';

const INITIAL: FormState = { ok: false };

const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-6 text-control font-semibold text-primary-foreground disabled:opacity-60';
const SECONDARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card disabled:opacity-60';

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
  reviewing = false,
}: {
  step: SetupStep;
  previous: SetupStep | null;
  nextLabelKey?: string;
  /** A finished setup opened again: the buttons only move between the steps. */
  reviewing?: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(moveStepAction, INITIAL);

  if (reviewing) {
    const at = SETUP_STEPS.indexOf(step);
    const next = SETUP_STEPS[at + 1];
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-8">
        {previous !== null ? (
          <Link href={`/dashboard/setup?step=${previous}`} className={SECONDARY}>
            <ArrowLeft className="size-4" aria-hidden />
            {t('common.back')}
            <LinkBusy />
          </Link>
        ) : (
          <span aria-hidden />
        )}
        <Link href={next === undefined ? '/dashboard/welcome' : `/dashboard/setup?step=${next}`} className={PRIMARY}>
          {next === undefined ? t('setup.toStart') : t('setup.next')}
          <ArrowRight className="size-4" aria-hidden />
          <LinkBusy />
        </Link>
      </div>
    );
  }

  return (
    // Along the setup card's bottom edge: Voltar on the left, Seguinte on the right (Rui, 19-11-2026).
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-8">
      {previous !== null ? (
        <form action={action}>
          <input type="hidden" name="step" value={previous} />
          <button type="submit" name="outcome" value="open" disabled={pending} className={SECONDARY}>
            <ArrowLeft className="size-4" aria-hidden />
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
          <ArrowRight className="size-4" aria-hidden />
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

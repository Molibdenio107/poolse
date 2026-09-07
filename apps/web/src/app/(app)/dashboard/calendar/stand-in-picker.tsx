'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { UserRound } from 'lucide-react';
import type { StandInOptions } from '@/lib/api';
import { CONTROL_LINE } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { setStandInAction, standInOptionsAction } from './lesson-plan.actions';

/**
 * Who is teaching this one lesson — round 6.
 *
 * **A stand-in, never a reassignment.** Ana is ill on Tuesday and Bruno takes
 * her class; next Tuesday is Ana's again, without anybody undoing anything. The
 * turma's own instructor is untouched, which is the difference between this and
 * the picker on the turma's own screen.
 *
 * **Loaded when it is opened, not with the week.** Answering "who is free" needs
 * the leave calendar and every instructor's other lessons that day; doing it for
 * eighty-four blocks to render a week would be paying for the one somebody asks
 * about.
 *
 * **Away is shown, greyed, and refused.** An instructor on approved leave stays
 * in the list with the reason against their name — a list that omitted them
 * would answer "where is Ana?" with silence, and "on holiday" and "left the
 * club" are different things. They cannot be chosen, and the endpoint refuses
 * them again, because hiding a control is never the control.
 */
export function StandInPicker({
  sessionId,
  compact = false,
}: {
  sessionId: string;
  /** The hover card is small; the plan sheet has room for the label. */
  compact?: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [options, setOptions] = useState<StandInOptions | null>(null);
  /*
   * Loaded, as a fact of its own — and this is the bug that made the picker
   * unusable rather than merely slow.
   *
   * `standInOptionsAction` answers `null` for *every* failure, so "has not
   * arrived yet" and "the server refused" arrived as the same value. The
   * control read that one value as "still loading" and stayed disabled for
   * ever, saying nothing — which is what a broken query on the endpoint looked
   * like from the pool deck: a greyed dropdown with no explanation.
   *
   * Two states, so the third can be said out loud.
   */
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, save] = useTransition();

  useEffect(() => {
    let live = true;
    setLoaded(false);
    void standInOptionsAction(sessionId).then((found) => {
      if (!live) return;
      setOptions(found);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [sessionId, attempt]);

  /*
   * While the options load, the control is the control — disabled, with the
   * name it will have.
   *
   * It used to render the word "A processar…" on its own, which in the hover
   * card's narrow column clipped to a fragment of itself: a card that says
   * "ocessar" is worse than one that says nothing. A disabled select also keeps
   * the card's height steady, so the thing under the pointer does not jump the
   * moment the answer arrives.
   */
  const loading = !loaded;
  const failed = loaded && options === null;

  function choose(value: string): void {
    setError(null);
    save(async () => {
      const result = await setStandInAction(sessionId, value === '' ? null : value);
      if (!result.ok) {
        setError(result.errorKey ?? 'calendar.standIn.failed');
        return;
      }
      // Re-read rather than assume: the answer changes who is now busy at that
      // hour, and the next person to open this picker should see that.
      setOptions(await standInOptionsAction(sessionId));
    });
  }

  return (
    <div className={cn('flex flex-col gap-1.5', compact ? '' : 'max-w-form')}>
      <label
        htmlFor={`stand-in-${sessionId}`}
        className={cn(
          'flex items-center gap-1.5 text-sm text-foreground-muted',
          compact && 'sr-only',
        )}
      >
        <UserRound className="size-3.5" aria-hidden="true" />
        {t('calendar.standIn.label')}
      </label>

      <select
        id={`stand-in-${sessionId}`}
        value={options?.currentId ?? ''}
        // Failed as well as loading: with nothing in the list there is nothing to
        // choose, and the sentence underneath is what says why.
        disabled={saving || loading || failed}
        onChange={(event) => choose(event.target.value)}
        className={cn(CONTROL_LINE, compact && 'h-8 text-sm', (loading || failed) && 'opacity-60')}
      >
        {/* Clearing puts the turma's own instructor back, because they were
            never replaced. */}
        <option value="">{t('calendar.standIn.none')}</option>

        {(options?.candidates ?? []).map((candidate) => {
          /*
           * The reason travels in the label, not only in the disabled state.
           * A `<select>` gives no other way to say *why* an option is out, and
           * "Ana Ribeiro" sitting greyed with nothing beside it is a screen
           * refusing to explain itself.
           */
          const why =
            candidate.awayReason !== null
              ? t(`calendar.standIn.away.${candidate.awayReason}`)
              : candidate.busy
                ? t('calendar.standIn.busy')
                : null;

          return (
            <option
              key={candidate.membershipId}
              value={candidate.membershipId}
              disabled={candidate.awayReason !== null}
            >
              {candidate.name ?? t('spaces.someone')}
              {why === null ? '' : ` · ${why}`}
            </option>
          );
        })}
      </select>

      {/*
        The load itself failed — a sentence and a way back, not a dead control.

        `retry` bumps `attempt`, which is the effect's other dependency, so the
        same fetch runs again without the card having to be closed and reopened.
      */}
      {failed && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-danger">
          {t('calendar.standIn.loadFailed')}
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="rounded underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            {t('calendar.standIn.retry')}
          </button>
        </p>
      )}

      {error !== null && <p className="text-sm text-danger">{t(error)}</p>}
    </div>
  );
}

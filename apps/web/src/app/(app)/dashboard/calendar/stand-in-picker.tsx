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
  const [error, setError] = useState<string | null>(null);
  const [saving, save] = useTransition();

  useEffect(() => {
    let live = true;
    void standInOptionsAction(sessionId).then((found) => {
      if (live) setOptions(found);
    });
    return () => {
      live = false;
    };
  }, [sessionId]);

  if (options === null) {
    return <p className="text-sm text-foreground-muted">{t('common.working')}</p>;
  }

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
        value={options.currentId ?? ''}
        disabled={saving}
        onChange={(event) => choose(event.target.value)}
        className={cn(CONTROL_LINE, compact && 'h-8 text-sm')}
      >
        {/* Clearing puts the turma's own instructor back, because they were
            never replaced. */}
        <option value="">{t('calendar.standIn.none')}</option>

        {options.candidates.map((candidate) => {
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

      {error !== null && <p className="text-sm text-danger">{t(error)}</p>}
    </div>
  );
}

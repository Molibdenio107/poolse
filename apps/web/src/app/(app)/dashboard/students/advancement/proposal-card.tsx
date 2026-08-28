'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { TransferProposal } from '@/lib/api';
import { confirmAdvancementAction, dismissAdvancementAction } from './advancement.actions';

/**
 * One student who has finished their level — POOLSE-19, criteria 3, 5 and 6.
 *
 * **The ranking explains itself.** The ticket asks for same-day-and-time first,
 * then same instructor, then anything with a seat, and an admin who cannot see
 * *why* a turma is top will re-derive the ranking by hand — which is the work
 * this screen exists to remove. So each candidate carries its reason as words.
 */
export function ProposalCard({
  organizationId,
  proposal,
}: {
  organizationId: string;
  proposal: TransferProposal;
}): React.ReactElement {
  const t = useTranslations();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Today, in the club's terms. The effective date is a decision — a transfer
  // usually starts at the next class — but defaulting to today makes the common
  // case one click rather than a date picker every time.
  const [effectiveOn, setEffectiveOn] = useState(() => new Date().toISOString().slice(0, 10));

  function confirm(classGroupId: string): void {
    setFailure(null);
    start(async () => {
      const result = await confirmAdvancementAction(
        organizationId,
        proposal.id,
        classGroupId,
        effectiveOn,
      );
      if (!result.ok) setFailure(result.errorKey ?? 'advancement.confirmFailed');
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link
          href={`/dashboard/students/${proposal.studentId}`}
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {proposal.studentName}
        </Link>
        <span className="text-sm text-foreground-muted">
          {t('advancement.fromTo', {
            from: proposal.fromLevelName,
            to: proposal.toLevelName,
          })}
        </span>
      </div>

      {proposal.candidates.length === 0 ? (
        /*
          Criterion 6. Not a failure and not a task: the student is ready and the
          club has nowhere to put them, which is an argument for another turma
          next season. It clears itself when a seat appears, so there is
          deliberately nothing to click.
        */
        <p className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {t('advancement.noSeat')}
        </p>
      ) : (
        <>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-foreground-muted">{t('advancement.effectiveOn')}</span>
            <input
              type="date"
              value={effectiveOn}
              onChange={(event) => setEffectiveOn(event.target.value)}
              className="rounded border border-border-strong bg-background px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
          </label>

          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {proposal.candidates.map((candidate) => (
              <li
                key={candidate.classGroupId}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{candidate.className}</span>
                  {/*
                    The reason, in words. Never a colour or a position alone —
                    "first in the list" is not an explanation.
                  */}
                  <span className="text-sm text-foreground-muted">
                    {t(`advancement.reason.${candidate.rankReason}`)}
                    {candidate.freeSeats !== null &&
                      ` · ${t('advancement.freeSeats', { seats: candidate.freeSeats })}`}
                  </span>
                </span>

                <button
                  type="button"
                  onClick={() => confirm(candidate.classGroupId)}
                  disabled={pending}
                  className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
                >
                  {t('advancement.confirm')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <form
          action={async () => {
            await dismissAdvancementAction(organizationId, proposal.id);
          }}
        >
          <button
            type="submit"
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('advancement.dismiss')}
          </button>
        </form>

        {failure !== null && <span className="text-sm text-danger">{t(failure)}</span>}
      </div>
    </li>
  );
}

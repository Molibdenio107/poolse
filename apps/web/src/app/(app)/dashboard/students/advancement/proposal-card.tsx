'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { FromLink } from '@/components/from-link';
import type { TransferCandidate, TransferProposal } from '@/lib/api';
import { TurmaPicker, type TurmaOption } from '@/components/turma-picker';
import { confirmAdvancementAction, dismissAdvancementAction } from './advancement.actions';
import { useToast } from '@/components/ui/toast';
import { CONTROL_LINE } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { today } from '@/lib/dates';
import { formatDate } from '@/lib/date-format';

/**
 * One student who has finished their level — POOLSE-19, criteria 3, 5 and 6.
 *
 * **The ranking explains itself.** The ticket asks for same-day-and-time first,
 * then same instructor, then anything with a seat, and an admin who cannot see
 * *why* a turma is top will re-derive the ranking by hand — which is the work
 * this screen exists to remove. So each candidate carries its reason as words.
 *
 * **One picker, one Confirmar** (POOLSE-113): the candidates go into
 * `TurmaPicker` grouped by that reason, in rank order — never by level, since
 * every candidate is at the level being advanced to and a level heading would
 * be one group with the ranking gone. A September of age proposals is a dozen
 * cards, and a dozen buttons per card stopped being readable.
 */

/** The rank reasons, in rank order — `transfer_candidates()`'s 1, 2, 3. */
const RANK: TransferCandidate['rankReason'][] = ['same_slot', 'same_instructor', 'available'];
export function ProposalCard({
  organizationId,
  proposal,
}: {
  organizationId: string;
  proposal: TransferProposal;
}): React.ReactElement {
  const t = useTranslations();
  const toast = useToast();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Today, in the club's terms. The effective date is a decision — a transfer
  // usually starts at the next class — but defaulting to today makes the common
  // case one click rather than a date picker every time.
  const [effectiveOn, setEffectiveOn] = useState(() => today());

  const turmas: TurmaOption[] = proposal.candidates.map((candidate) => ({
    id: candidate.classGroupId,
    name: candidate.className,
    levelName: candidate.levelName,
    levelOrder: null,
    capacity: candidate.capacity,
    active: candidate.active,
    slots: candidate.slots,
    instructorName: candidate.instructorName,
    group: {
      key: candidate.rankReason,
      label: t(`advancement.reason.${candidate.rankReason}`),
      order: RANK.indexOf(candidate.rankReason),
    },
  }));

  function confirm(classGroupId: string): void {
    setFailure(null);
    if (classGroupId === '') {
      setFailure('advancement.pickTurma');
      return;
    }
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
        <FromLink
          href={`/dashboard/students/${proposal.studentId}`}
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {proposal.studentName}
        </FromLink>
        <span className="text-sm text-foreground-muted">
          {t('advancement.fromTo', {
            from: proposal.fromLevelName,
            to: proposal.toLevelName,
          })}
        </span>
      </div>

      {/*
        Why the child is here — POOLSE-112. Said in words, because a queue that
        mixes "finished every skill" with "turned nine" without saying which
        makes the coach re-derive it from the record.
      */}
      <p className="text-sm text-foreground-muted">
        {proposal.reason === 'age'
          ? t('advancement.byAge', { season: proposal.seasonName ?? '' })
          : t('advancement.bySkills')}
        {proposal.appliedAt !== null &&
          ` · ${t('advancement.applied', { date: formatDate(proposal.appliedAt) })}`}
      </p>

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
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            // The picker posts the chosen id as a named field, as in Pedidos.
            confirm(String(new FormData(event.currentTarget).get('classGroupId') ?? ''));
          }}
        >
          {/*
            The reason is each group's heading, in words and in rank order —
            never a colour or a position alone. A full turma is not offered:
            the seat is re-checked when confirming anyway (seatGone).
          */}
          <TurmaPicker
            name="classGroupId"
            label={t('advancement.chooseTurma')}
            turmas={turmas}
            requestedLevelName={null}
            allowFull={false}
          />

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-foreground-muted">{t('advancement.effectiveOn')}</span>
              <input
                type="date"
                value={effectiveOn}
                onChange={(event) => setEffectiveOn(event.target.value)}
                // The one control size — CLAUDE.md — sized to its date, not the row.
                className={cn(CONTROL_LINE, 'w-auto')}
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {pending ? t('common.working') : t('advancement.confirm')}
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <form
          action={async () => {
            const result = await dismissAdvancementAction(organizationId, proposal.id);
            if (!result.ok) toast.show('danger', t('common.notSaved'));
          }}
        >
          <button
            type="submit"
            className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('advancement.dismiss')}
          </button>
        </form>

        {failure !== null && <span className="text-sm text-danger">{t(failure)}</span>}
      </div>
    </li>
  );
}

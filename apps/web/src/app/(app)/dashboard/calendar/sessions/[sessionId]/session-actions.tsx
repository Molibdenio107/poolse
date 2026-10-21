'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Ban, NotebookPen } from 'lucide-react';
import { CancelSessionDialog, type CancelTarget } from '../../calendar-forms';
import { LessonPlanPanel } from '../../lesson-plan-panel';
import { StandInPicker } from '../../stand-in-picker';

/**
 * The lesson's own controls on its own page — POOLSE-88 slice 2.
 *
 * On a desk these live on the calendar's hover card and its plan sheet. On a
 * phone the calendar is tier 3 — a seven-day lane grid nobody works one-handed —
 * so the session page, already the screen an instructor reaches from the
 * dashboard to take the register, carries the rest of what they do with one
 * lesson: the plan, who is teaching it, and calling it off. The same three
 * components the calendar mounts, never copies of them.
 *
 * Mounted whatever the lesson's status, because the cancel dialog owns the
 * toast that offers Desfazer, and a cancelled lesson redraws this page: an
 * unmounted dialog would take the undo with it half a second after offering it.
 */
export function SessionActions({
  organizationId,
  sessionId,
  className,
  when,
  date,
  classGroupId,
  cancelled,
  canCancel,
  management,
  messagesOn,
  openPlan,
}: {
  organizationId: string;
  sessionId: string;
  className: string;
  /** Date and time, already formatted — the confirmation names them. */
  when: string;
  /** The day alone, formatted, for the families' message subject. */
  date: string;
  classGroupId: string | null;
  cancelled: boolean;
  canCancel: boolean;
  /** Owner or admin: may end the series and put a cancelled lesson back. */
  management: boolean;
  messagesOn: boolean;
  /** `?plan=open` — the dashboard's plan card lands with the sheet open. */
  openPlan: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [planning, setPlanning] = useState(openPlan);
  const [cancelling, setCancelling] = useState<CancelTarget | null>(null);

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* A cancelled lesson keeps its plan and says so (calendar.md), so this stays. */}
        <button
          type="button"
          onClick={() => setPlanning(true)}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-1.5 rounded border border-primary/40 font-medium text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          <NotebookPen className="size-4" aria-hidden="true" />
          {t('calendar.plan.title')}
        </button>

        {canCancel && !cancelled && (
          <button
            type="button"
            onClick={() => setCancelling({ sessionId, className, when, classGroupId, date })}
            className="inline-flex h-control items-center justify-center px-4 text-control gap-1.5 rounded border border-border-strong hover:border-danger hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            <Ban className="size-4" aria-hidden="true" />
            {t('calendar.cancel')}
          </button>
        )}
      </div>

      {/* Who is teaching it. The picker loads its own options and says its own refusals. */}
      {!cancelled && <StandInPicker sessionId={sessionId} />}

      {planning && (
        <LessonPlanPanel sessionId={sessionId} onClose={() => setPlanning(false)} className={className} />
      )}

      <CancelSessionDialog
        organizationId={organizationId}
        target={cancelling}
        onClose={() => setCancelling(null)}
        messagesOn={messagesOn}
        management={management}
      />
    </section>
  );
}

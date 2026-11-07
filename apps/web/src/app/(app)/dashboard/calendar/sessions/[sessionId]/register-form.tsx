'use client';

import { useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CalendarCheck, CalendarX } from 'lucide-react';
import type { Register } from '@/lib/api';
import {
  ATTENDANCE_STATES,
  AttendanceIcon,
  AttendanceLegend,
  selectedTone,
} from '@/components/attendance-state';
import { cn } from '@/lib/utils';
import { Dialog } from '@/components/ui/dialog';
import { PersonAvatar } from '@/components/person-avatar';
import { photoUrlFor } from '@/lib/photo';
import type { FormState } from '../../../actions';
import { recordAttendanceAction } from './attendance.actions';

const INITIAL: FormState = { ok: false };

/*
 * The three states, their order and their colours all come from
 * `attendance-state.tsx` — POOLSE-13 asks for the colours to be tokens reused
 * everywhere rather than re-declared per component, and this is the component
 * that would otherwise have re-declared them.
 *
 * `present` first because it is nine marks in ten, and the whole slice is
 * measured in how fast a class can be marked.
 */

/**
 * The register — slice 1.8.
 *
 * "An instructor marks a class in under a minute." Everything here serves that:
 * one screen, one save, and the two controls that do the actual work at the top
 * — mark everyone present, then correct the handful who were not.
 *
 * Radios rather than a dropdown per student. A dropdown is two taps and a
 * scroll on a phone held over a wet poolside; four visible options are one tap.
 */
export function RegisterForm({
  register,
  compact = false,
}: {
  register: Register & { organizationId: string };
  /**
   * POOLSE-180: opened from app mode. Below `md` each row is the name and one
   * control, and the seguro / exame chips become one line above the roll. From
   * `md` up nothing changes — every compact class is `max-md:` or undone at `md:`.
   */
  compact?: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(recordAttendanceAction, INITIAL);
  // Vou / Não vou by student, and how many said they are not coming.
  const notices = new Map((register.notices ?? []).map((one) => [one.studentId, one.going]));
  const notComing = [...notices.values()].filter((going) => !going).length;

  /*
   * Seeded from what is already stored, so reopening a marked class shows what
   * was marked. Held here rather than left to the DOM because "mark everyone
   * present" has to move every row at once.
   */
  const [marks, setMarks] = useState<Record<string, string>>(() =>
    Object.fromEntries(register.entries.map((entry) => [entry.studentId, entry.status ?? ''])),
  );

  // The notes, the same way — a refused save keeps what was typed beside each name.
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(register.entries.map((entry) => [entry.studentId, entry.note ?? ''])),
  );

  const marked = Object.values(marks).filter((value) => value !== '').length;

  /*
   * POOLSE-180 rule 3: the warnings as a count. The office needs them per row;
   * the instructor on the deck needs to know they exist, and who, on a tap.
   */
  const uninsured = register.entries.filter((entry) => !entry.insured).length;
  const examMissing = register.entries.filter(
    (entry) => entry.examState !== undefined && entry.examState !== 'valid',
  ).length;
  const warned = register.entries.filter(
    (entry) => !entry.insured || (entry.examState !== undefined && entry.examState !== 'valid'),
  );
  const [warningsOpen, setWarningsOpen] = useState(false);

  function setAll(status: string): void {
    setMarks(Object.fromEntries(register.entries.map((entry) => [entry.studentId, status])));
  }

  if (register.entries.length === 0) {
    return (
      <section className="rounded bg-surface p-5 shadow-card">
        <p className="text-sm text-foreground-muted">{t('attendance.nobodyEnrolled')}</p>
      </section>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={register.organizationId} />
      <input type="hidden" name="sessionId" value={register.sessionId} />

      {/*
        One toolbar on a desk, two pieces on a phone — POOLSE-88.

        From `md` up this wrapper is the toolbar row it always was. Below `md` it
        is `contents`, so its two children become items of the form itself: the
        quick marks stay above the list, and the count and Save are pushed after
        it (`order-last`) and stick to the bottom of the screen, where a thumb
        reaches them and where the count stays in sight as the list scrolls.
        Rendered once and moved by CSS, never rendered twice and hidden — a
        second Save is a second submit button a test or a screen reader finds.
      */}
      <div className="contents md:flex md:flex-wrap md:items-center md:gap-3 md:rounded md:border md:border-border md:bg-surface md:p-4">
        <div className="flex flex-wrap items-center gap-3 rounded bg-surface p-4 md:contents shadow-card">
          {/*
            The one-tap start. Marking a class is mostly "everybody came except
            two", and making an instructor tap fifteen times to say so is how a
            register stops getting filled in.
          */}
          <button
            type="button"
            onClick={() => setAll('present')}
            className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded-sm transition-colors hover:border-primary/50 hover:text-primary bg-surface shadow-card"
          >
            {t('attendance.allPresent')}
          </button>
          <button
            type="button"
            onClick={() => setAll('')}
            className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded-sm text-foreground-muted hover:text-foreground"
          >
            {t('attendance.clearAll')}
          </button>

          {/* Several states on one screen, so the ticket asks for a legend. */}
          <AttendanceLegend className="w-full sm:w-auto" />
        </div>

        {/*
          The home bar is added to the bar's own padding, because a bar stuck to
          the bottom of the screen sits over it — the shell's `pb-safe-bottom`
          only clears the end of the page.
        */}
        <div
          data-register-actions
          data-bottom-bar
          className="sticky bottom-0 z-10 order-last -mx-page flex items-center gap-3 border-t border-border bg-background px-page pt-3 pb-[calc(0.75rem+var(--safe-bottom))] md:static md:order-none md:mx-0 md:ml-auto md:border-0 md:bg-transparent md:p-0"
        >
          <span className="text-sm text-foreground-muted" aria-live="polite">
            {t('attendance.markedOf', { marked, total: register.entries.length })}
          </span>

          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-control items-center justify-center px-4 text-control gap-2 ml-auto rounded-sm bg-primary text-primary-foreground disabled:opacity-60 max-md:flex-1 font-semibold"
          >
            {pending ? t('common.working') : t('attendance.save')}
          </button>
        </div>
      </div>

      {/*
        Vou / Não vou — POOLSE-90 slice 2. What families said before the class,
        counted above the roll and named beside each child. A notice, never a
        mark: nothing below is pre-set by it.
      */}
      {notComing > 0 && (
        <p className="flex items-center gap-1.5 text-sm font-medium" aria-live="polite">
          <CalendarX aria-hidden className="size-4" />
          {t('attendance.notComingCount', { count: notComing })}
        </p>
      )}

      {/*
        POOLSE-180: one muted line instead of a chip per row, on a phone in app
        mode only. A lesson with nothing to warn shows nothing. A button, because
        it opens the names; the words carry it, the icon is a hint.
      */}
      {compact && warned.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setWarningsOpen(true)}
            className="flex min-h-control items-center gap-1.5 self-start text-left text-sm text-foreground-muted underline-offset-2 hover:underline md:hidden"
          >
            <AlertTriangle aria-hidden className="size-4 shrink-0" />
            {[
              uninsured > 0 ? t('attendance.warnings.noInsurance', { count: uninsured }) : null,
              examMissing > 0 ? t('attendance.warnings.exam', { count: examMissing }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </button>
          <Dialog
            open={warningsOpen}
            onClose={() => setWarningsOpen(false)}
            title={t('attendance.warnings.title')}
            closeLabel={t('common.close')}
            placement="sheet"
          >
            <ul className="flex flex-col divide-y divide-border">
              {warned.map((entry) => (
                <li key={entry.studentId} className="flex flex-col gap-0.5 py-2">
                  <span className="font-medium">{entry.shortName}</span>
                  <span className="text-sm text-foreground-muted">
                    {[
                      entry.insured ? null : t('attendance.noInsurance'),
                      entry.examState === undefined || entry.examState === 'valid'
                        ? null
                        : entry.examState === 'expired'
                          ? t('attendance.examExpired')
                          : t('attendance.examNone'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </Dialog>
        </>
      )}

      <ul className="flex flex-col divide-y divide-border rounded border border-border bg-surface">
        {register.entries.map((entry) => (
          <li key={entry.studentId} className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span
                className={cn('flex flex-wrap items-center gap-2 font-medium', compact && 'max-md:font-bold')}
                title={entry.displayName}
              >
                {/* POOLSE-180 rule 2: initials only — a photo needs its consent check, and this has none. */}
                {compact && <PersonAvatar id={entry.studentId} name={entry.shortName} photoUrl={photoUrlFor(entry.photoFileId ?? null)} size="sm" className="md:hidden" />}
                {entry.shortName}
                {/*
                  Why somebody unexpected is on the list — POOLSE-21 criterion 8.

                  A reposição guest says so specifically; anybody else off the
                  roster (a trial, a sibling brought along) keeps the general
                  label. An instructor needs to know which, because a guest is
                  owed this class and a trial is not.

                  A word, never a colour on its own — and deliberately a token
                  that is not in the attendance palette, so "here on a make-up"
                  cannot be misread as a mark.
                */}
                {entry.isGuest ? (
                  <span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-sm font-normal text-primary">
                    {t('attendance.guest')}
                  </span>
                ) : (
                  !entry.enrolled && (
                    <span className="rounded bg-surface-muted px-2 py-0.5 text-sm font-normal text-foreground-muted">
                      {t('attendance.notEnrolled')}
                    </span>
                  )
                )}
                {/*
                  No valid insurance on the day of this class — round 9.

                  **It changes nothing about the register.** Every mark still
                  works, the row is not disabled, and no state on this screen
                  depends on it: an instructor at the poolside cannot fix a
                  seguro, and a register that would not open over a piece of
                  paperwork is a register somebody keeps on paper instead. It is
                  here because this is the one screen where every swimmer is
                  looked at every week.

                  Judged against the class's own day rather than today, so a
                  register marked late still says what was true when they swam.
                  Words and an icon, not a colour: the warning tone is a hint and
                  never the message.
                */}
                {notices.has(entry.studentId) && (
                  <span className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-sm font-normal">
                    {notices.get(entry.studentId) ? (
                      <CalendarCheck aria-hidden className="size-3.5" />
                    ) : (
                      <CalendarX aria-hidden className="size-3.5" />
                    )}
                    {notices.get(entry.studentId) ? t('attendance.noticeGoing') : t('attendance.noticeNotGoing')}
                  </span>
                )}
                {!entry.insured && (
                  <span
                    className={cn(
                      'flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-sm font-normal text-warning',
                      compact && 'max-md:hidden',
                    )}
                  >
                    <AlertTriangle aria-hidden className="attention size-3.5" />
                    {t('attendance.noInsurance')}
                  </span>
                )}
                {/* POOLSE-133: the exame médico, the seguro's way. */}
                {entry.examState !== undefined && entry.examState !== 'valid' && (
                  <span
                    className={cn(
                      'flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-sm font-normal text-warning',
                      compact && 'max-md:hidden',
                    )}
                  >
                    <AlertTriangle aria-hidden className="attention size-3.5" />
                    {entry.examState === 'expired' ? t('attendance.examExpired') : t('attendance.examNone')}
                  </span>
                )}
              </span>

              {/*
                On a phone the three states are one full-width row of equal
                thirds — about 96px each at 360px. In the backoffice, "Falta
                justificada" fills that only by wrapping and dropping its icon;
                the word carries the state there.

                From app mode (POOLSE-180) it is the other way round, and on
                purpose: one 44px cell per state with the glyph on top and the
                word beneath at 11px, which fits both at 96px. The word stays, so
                colour and glyph are never alone; it reads as a label, not a
                sentence. Radios stay radios: arrow keys move between the three.
                Every compact class is undone at `md`, so a laptop is unchanged.
              */}
              <fieldset
                className={
                  compact
                    ? 'grid w-full grid-cols-3 gap-1 md:flex md:w-auto md:flex-wrap'
                    : 'grid w-full grid-cols-3 gap-1 sm:flex sm:w-auto sm:flex-wrap'
                }
              >
                <legend className="sr-only">
                  {t('attendance.statusFor', { name: entry.displayName })}
                </legend>
                {ATTENDANCE_STATES.map((status) => (
                  <label
                    key={status}
                    className={cn(
                      compact
                        ? 'inline-flex min-h-control flex-col items-center justify-center gap-0.5 px-1 text-center text-[11px] leading-tight cursor-pointer rounded-sm border transition-colors md:h-control md:flex-row md:gap-1.5 md:px-4 md:text-control'
                        : 'inline-flex min-h-control items-center justify-center px-1.5 text-center text-control leading-tight cursor-pointer gap-1.5 rounded-sm border transition-colors sm:h-control sm:px-4',
                      // The label and the glyph render whether or not the state
                      // is chosen, so colour is never the only thing carrying it.
                      marks[entry.studentId] === status
                        ? selectedTone(status)
                        : 'border-border hover:border-primary/50',
                    )}
                  >
                    <input
                      type="radio"
                      name={`status-${entry.studentId}`}
                      value={status}
                      checked={marks[entry.studentId] === status}
                      onChange={() =>
                        setMarks((current) => ({ ...current, [entry.studentId]: status }))
                      }
                      className="sr-only"
                    />
                    <span className={compact ? 'inline-flex' : 'inline-flex max-sm:hidden'}>
                      <AttendanceIcon status={status} />
                    </span>
                    {t(`attendance.${status}`)}
                  </label>
                ))}
              </fieldset>
            </div>

            {/*
              Only once somebody is marked, because a note on an unmarked student
              has nothing to hang on — the API drops it. The hint says what the
              box is for: this is ordinary context, and medical information has
              its own screen, its own access rules and its own audit trail.
            */}
            {marks[entry.studentId] !== '' && (
              <input
                name={`note-${entry.studentId}`}
                value={notes[entry.studentId] ?? ''}
                onChange={(event) =>
                  setNotes((all) => ({ ...all, [entry.studentId]: event.target.value }))
                }
                maxLength={200}
                placeholder={t('attendance.notePlaceholder')}
                aria-label={t('attendance.noteFor', { name: entry.displayName })}
                className="h-control rounded-sm border border-border-strong bg-background px-3 text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
            )}

            {entry.recordedByName !== null && (
              <span className="text-sm text-foreground-muted">
                {t('attendance.recordedBy', { name: entry.recordedByName })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </form>
  );
}

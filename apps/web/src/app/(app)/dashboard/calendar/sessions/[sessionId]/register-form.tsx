'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Register } from '@/lib/api';
import type { FormState } from '../../../actions';
import { recordAttendanceAction } from './attendance.actions';

const INITIAL: FormState = { ok: false };

/**
 * Four statuses, in the order an instructor uses them.
 *
 * `present` first because it is nine marks in ten, and the whole slice is
 * measured in how fast a class can be marked. Alphabetical order would have put
 * "absent" under the thumb.
 */
const STATUSES = ['present', 'late', 'excused', 'absent'] as const;

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
export function RegisterForm({ register }: { register: Register & { organizationId: string } }): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(recordAttendanceAction, INITIAL);

  /*
   * Seeded from what is already stored, so reopening a marked class shows what
   * was marked. Held here rather than left to the DOM because "mark everyone
   * present" has to move every row at once.
   */
  const [marks, setMarks] = useState<Record<string, string>>(() =>
    Object.fromEntries(register.entries.map((entry) => [entry.studentId, entry.status ?? ''])),
  );

  const marked = Object.values(marks).filter((value) => value !== '').length;

  function setAll(status: string): void {
    setMarks(Object.fromEntries(register.entries.map((entry) => [entry.studentId, status])));
  }

  if (register.entries.length === 0) {
    return (
      <section className="rounded border border-border bg-surface p-5">
        <p className="text-sm text-foreground-muted">{t('attendance.nobodyEnrolled')}</p>
      </section>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={register.organizationId} />
      <input type="hidden" name="sessionId" value={register.sessionId} />

      <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface p-4">
        {/*
          The one-tap start. Marking a class is mostly "everybody came except
          two", and making an instructor tap fifteen times to say so is how a
          register stops getting filled in.
        */}
        <button
          type="button"
          onClick={() => setAll('present')}
          className="rounded border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary"
        >
          {t('attendance.allPresent')}
        </button>
        <button
          type="button"
          onClick={() => setAll('')}
          className="rounded px-2 py-1.5 text-sm text-foreground-muted hover:text-foreground"
        >
          {t('attendance.clearAll')}
        </button>

        <span className="text-sm text-foreground-muted">
          {t('attendance.markedOf', { marked, total: register.entries.length })}
        </span>

        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('attendance.save')}
        </button>

        {state.ok && <span className="text-sm text-success">{t('attendance.saved')}</span>}
        {state.errorKey !== undefined && (
          <span className="text-sm text-danger">{t(state.errorKey)}</span>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-border rounded border border-border bg-surface">
        {register.entries.map((entry) => (
          <li key={entry.studentId} className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {entry.firstName} {entry.lastName}
                {/*
                  A trial, a make-up, a sibling brought along. Named rather than
                  hidden: an instructor needs to know why somebody unexpected is
                  on the list, and the alternative is them being left unmarked.
                */}
                {!entry.enrolled && (
                  <span className="rounded bg-surface-muted px-2 py-0.5 text-sm font-normal text-foreground-muted">
                    {t('attendance.notEnrolled')}
                  </span>
                )}
              </span>

              <fieldset className="flex flex-wrap gap-1">
                <legend className="sr-only">
                  {t('attendance.statusFor', { name: `${entry.firstName} ${entry.lastName}` })}
                </legend>
                {STATUSES.map((status) => (
                  <label
                    key={status}
                    className={`cursor-pointer rounded border px-3 py-1.5 text-sm transition-colors ${
                      marks[entry.studentId] === status
                        ? 'border-primary bg-primary/15 font-medium text-primary'
                        : 'border-border hover:border-primary/50'
                    }`}
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
                defaultValue={entry.note ?? ''}
                maxLength={200}
                placeholder={t('attendance.notePlaceholder')}
                aria-label={t('attendance.noteFor', {
                  name: `${entry.firstName} ${entry.lastName}`,
                })}
                className="rounded border border-border bg-background px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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

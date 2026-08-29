'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Guardian, StudentLevel } from '../../../../lib/api';
import { CONTROL_BLOCK, CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { GuardianBlock } from './guardian-block';
import { fitsLevel } from '@/lib/ages';
import type { FormState } from '../actions';
import { archiveStudentAction, createStudentAction, updateStudentAction } from './students.actions';

const INITIAL: FormState = { ok: false };

function Problem({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.errorKey === undefined) return null;
  return (
    <p className="text-sm text-danger">
      {t(state.errorKey)}
      {state.detail !== undefined && (
        <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
      )}
    </p>
  );
}

export interface StudentFormValues {
  id?: string;
  guardians?: Guardian[];
  firstName?: string;
  lastName?: string;
  birthDate?: string | null;
  levelId?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
}

/**
 * One form for both creating and editing, because they take the same fields and
 * two near-identical forms drift apart the first time one gains a field.
 *
 * The notes box is labelled and hinted deliberately. It is ordinary notes —
 * "prefers the shallow end", "sibling of Ana" — and a free-text box on a child's
 * record is exactly where somebody types an allergy if nothing tells them not
 * to. Medical information is special-category data under GDPR and gets its own
 * table, its own access rules and its own audit trail in slice 1.3.
 */
export function StudentForm({
  organizationId,
  levels,
  student,
  mode,
  ageOfMajority,
}: {
  organizationId: string;
  levels: StudentLevel[];
  student?: StudentFormValues;
  mode: 'create' | 'edit';
  /** The club's maioridade — POOLSE-22. Comes from the API, never a literal. */
  ageOfMajority: number;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(
    mode === 'create' ? createStudentAction : updateStudentAction,
    INITIAL,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      {student?.id !== undefined && <input type="hidden" name="studentId" value={student.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className={FIELD_COLUMN}>
          <label htmlFor="student-first" className={FIELD_LABEL}>
            {t('students.firstName')}
          </label>
          <input
            id="student-first"
            name="firstName"
            required
            maxLength={120}
            defaultValue={student?.firstName ?? ''}
            className={CONTROL_LINE}
          />
        </div>

        <div className={FIELD_COLUMN}>
          <label htmlFor="student-last" className={FIELD_LABEL}>
            {t('students.lastName')}
          </label>
          <input
            id="student-last"
            name="lastName"
            required
            maxLength={120}
            defaultValue={student?.lastName ?? ''}
            className={CONTROL_LINE}
          />
        </div>

        <div className={FIELD_COLUMN}>
          <label htmlFor="student-birth" className={FIELD_LABEL}>
            {t('students.birthDate')}
          </label>
          <input
            id="student-birth"
            name="birthDate"
            type="date"
            defaultValue={student?.birthDate ?? ''}
            className={CONTROL_LINE}
          />
        </div>

        <LevelPicker levels={levels} student={student} />

        <div className={FIELD_COLUMN}>
          <label htmlFor="student-email" className={FIELD_LABEL}>
            {t('students.contactEmail')}
          </label>
          <input
            id="student-email"
            name="contactEmail"
            type="email"
            defaultValue={student?.contactEmail ?? ''}
            className={CONTROL_LINE}
          />
        </div>

        <div className={FIELD_COLUMN}>
          <label htmlFor="student-phone" className={FIELD_LABEL}>
            {t('students.contactPhone')}
          </label>
          <input
            id="student-phone"
            name="contactPhone"
            defaultValue={student?.contactPhone ?? ''}
            className={CONTROL_LINE}
          />
        </div>
      </div>

      {/* Prose, so it takes the wider cap rather than the single-control one. */}
      <div className={cn(FIELD_COLUMN, 'max-w-form')}>
        <label htmlFor="student-notes" className={FIELD_LABEL}>
          {t('students.notes')}
        </label>
        {/* CONTROL_BLOCK, not CONTROL_LINE: the fixed height would fight `rows`. */}
        <textarea
          id="student-notes"
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={student?.notes ?? ''}
          className={CONTROL_BLOCK}
        />
        <p className="text-sm text-warning">{t('students.notesWarning')}</p>
      </div>

      {/*
        POOLSE-04. Its own section, appearing and disappearing with the date of
        birth without ever throwing away what has been typed into it.
      */}
      <GuardianBlock
        ageOfMajority={ageOfMajority}
        guardians={student?.guardians}
        birthDateInputId="student-birth"
        errors={state.fields}
      />

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending
            ? t('common.working')
            : mode === 'create'
              ? t('students.add')
              : t('common.save')}
        </button>
      </div>

      {state.ok && mode === 'edit' && (
        <p className="text-sm text-success">{t('students.saved')}</p>
      )}
      <Problem state={state} />
    </form>
  );
}

/**
 * Two steps, and the confirmation names the person.
 *
 * Archiving keeps the record — enrollment, attendance and invoices will point at
 * it — but it removes a child from every list the operator works from, and the
 * generic "are you sure?" is the question people learn to click through.
 */
export function ArchiveStudentButton({
  organizationId,
  studentId,
  name,
}: {
  organizationId: string;
  studentId: string;
  name: string;
}): React.ReactElement {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(archiveStudentAction, INITIAL);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger"
      >
        {t('students.archive')}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />
      <span className="text-sm text-foreground-muted">
        {t('students.confirmArchive', { name })}
      </span>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-danger/50 px-2 py-1 text-sm text-danger hover:bg-danger/10 disabled:opacity-60"
      >
        {pending ? t('common.working') : t('facilities.confirmArchive')}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:bg-surface-muted"
      >
        {t('common.cancel')}
      </button>
      {state.errorKey !== undefined && (
        <span className="text-sm text-danger">{t(state.errorKey)}</span>
      )}
    </form>
  );
}


/**
 * The level picker, with an age warning — backlog round 4, ticket 3.
 *
 * **A warning, not a block.** Real clubs have the four-year-old who swims with
 * the six-year-olds because that is where their sibling is, and the adult
 * beginner in a teenagers' class. A rule that cannot be overridden gets worked
 * around by typing a fake birth date, and then the data is worse than if the
 * check had never existed. So the mismatched level stays selectable, and
 * choosing it asks for confirmation once.
 *
 * **A missing birth date is never in anybody's way.** Most students will have
 * none — the spreadsheets waiting to be imported have a half-empty column — and
 * that is silence, not a warning.
 *
 * The birth date is read from the live form rather than from the saved student,
 * so typing a date and then picking a level warns on what was just typed.
 */
function LevelPicker({
  levels,
  student,
}: {
  levels: StudentLevel[];
  student: StudentFormValues | undefined;
}): React.ReactElement {
  const t = useTranslations();
  const [levelId, setLevelId] = useState(student?.levelId ?? '');
  const [birthDate, setBirthDate] = useState(student?.birthDate ?? '');

  // The date input is elsewhere in the same form, so its changes are heard here
  // rather than lifted into shared state — one listener beats threading a value
  // through every field between them.
  useEffect(() => {
    const input = document.getElementById('student-birth');
    if (!(input instanceof HTMLInputElement)) return;

    const read = (): void => setBirthDate(input.value);
    read();
    input.addEventListener('change', read);
    input.addEventListener('input', read);
    return () => {
      input.removeEventListener('change', read);
      input.removeEventListener('input', read);
    };
  }, []);

  const dob = birthDate === '' ? null : birthDate;
  const chosen = levels.find((level) => level.id === levelId) ?? null;
  const fit = chosen === null ? 'fits' : fitsLevel(chosen, dob);

  return (
    <div className={FIELD_COLUMN}>
      <label htmlFor="student-level" className={FIELD_LABEL}>
        {t('students.level')}
      </label>
      <select
        id="student-level"
        name="levelId"
        value={levelId}
        onChange={(event) => setLevelId(event.target.value)}
        aria-describedby={fit === 'tooYoung' || fit === 'tooOld' ? 'student-level-warning' : undefined}
        className={CONTROL_LINE}
      >
        <option value="">{t('students.noLevel')}</option>
        {levels.map((level) => {
          const levelFit = fitsLevel(level, dob);
          // Marked in the option text itself, because a `disabled` option would
          // be the hard block this story argues against, and colour alone does
          // not survive a native select on any platform.
          const mark =
            levelFit === 'tooYoung'
              ? ` — ${t('students.tooYoungFor')}`
              : levelFit === 'tooOld'
                ? ` — ${t('students.tooOldFor')}`
                : '';
          return (
            <option key={level.id} value={level.id}>
              {level.name}
              {mark}
            </option>
          );
        })}
      </select>

      {(fit === 'tooYoung' || fit === 'tooOld') && chosen !== null && (
        <div
          id="student-level-warning"
          className="flex flex-col gap-2 rounded bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          <p>
            {t(fit === 'tooYoung' ? 'students.ageWarnYoung' : 'students.ageWarnOld', {
              level: chosen.name,
            })}
          </p>
          {/*
            Required, so the form cannot be submitted with the mismatch
            unacknowledged — but it is a tick, not a wall. One deliberate click,
            and the club's judgement wins.
          */}
          <label className="flex items-center gap-2">
            <input type="checkbox" required className="size-4 accent-primary" />
            {t('students.ageConfirm')}
          </label>
        </div>
      )}
    </div>
  );
}

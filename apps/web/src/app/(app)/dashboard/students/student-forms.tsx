'use client';

import { useEffect, useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import type { Guardian, StudentLevel } from '../../../../lib/api';
import {
  CONTROL_LINE,
  FIELD_COLUMN,
  FIELD_LABEL,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/ui/field';
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
  gender?: 'male' | 'female' | null;
  levelId?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  taxNumber?: string | null;
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
  const [state, action, pending] = useSavedAction(
    mode === 'create' ? createStudentAction : updateStudentAction,
    INITIAL,
  );

  /*
   * The date of birth, lifted — F-09.
   *
   * The guardian block branches on it and used to read this input out of the DOM
   * by id. A controlled field generates its own id, and holding the value here
   * is what that listener was standing in for.
   */
  const [birthDate, setBirthDate] = useState(student?.birthDate ?? '');

  /**
   * The server's error for one field, ready to spread onto its component.
   *
   * Spread rather than passed as `error={undefined}` because these props are
   * `exactOptionalPropertyTypes`: an explicit undefined is not the same as
   * absent.
   */
  const fieldError = (name: string): { error?: string } =>
    state.fields?.[name] === undefined ? {} : { error: t(state.fields[name]!) };

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      {student?.id !== undefined && <input type="hidden" name="studentId" value={student.id} />}

      {/*
        Every field controlled — F-09, and the tidy-up the NIF field's comment
        used to defer.

        React 19 resets a form as soon as a function action returns, *including*
        when it returns a validation error. So a future date of birth cleared the
        name, the level, the contact details and the guardian somebody had just
        typed, at the exact moment they were being asked to correct one field.
        POOLSE-09 and POOLSE-10 were the same bug twice; this was the third.

        These components also carry their own label, hint and field-level error,
        which is what lets each server rejection land under the box it is about
        rather than as a sentence at the top of the page.
      */}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="firstName"
          label={t('students.firstName')}
          initial={student?.firstName ?? ''}
          maxLength={120}
          required
          className="max-w-none"
          {...fieldError('firstName')}
        />

        <TextField
          name="lastName"
          label={t('students.lastName')}
          initial={student?.lastName ?? ''}
          maxLength={120}
          required
          className="max-w-none"
          {...fieldError('lastName')}
        />

        {/*
          Held in state rather than read out of the DOM by id.

          The guardian block needs to know the date to decide whether to show
          itself, and it used to listen to this input through
          `document.getElementById`. A controlled field has no stable id — the
          component generates its own — and lifting the value is what that hack
          was standing in for anyway.
        */}
        <TextField
          name="birthDate"
          type="date"
          label={t('students.birthDate')}
          initial={student?.birthDate ?? ''}
          onValueChange={setBirthDate}
          className="max-w-none"
          {...fieldError('birthDate')}
        />

        {/*
          Masculino or feminino — round 5, and optional.

          Beside the date of birth because they are the same kind of fact and
          because both are what an escalão is chosen against. Blank stays a real
          answer: most imported rows have nothing here, and a required field
          would be filled in by guessing from a first name.
        */}
        <SelectField
          name="gender"
          label={t('students.gender')}
          initial={student?.gender ?? ''}
          options={[
            { value: '', label: t('students.genderUnknown') },
            { value: 'male', label: t('students.genderMale') },
            { value: 'female', label: t('students.genderFemale') },
          ]}
          className="max-w-none"
          {...fieldError('gender')}
        />

        <LevelPicker levels={levels} student={student} />

        <TextField
          name="contactEmail"
          type="email"
          label={t('students.contactEmail')}
          initial={student?.contactEmail ?? ''}
          maxLength={254}
          className="max-w-none"
          {...fieldError('contactEmail')}
        />

        <TextField
          name="contactPhone"
          label={t('students.contactPhone')}
          initial={student?.contactPhone ?? ''}
          maxLength={40}
          className="max-w-none"
          {...fieldError('contactPhone')}
        />

        <TextField
          name="taxNumber"
          label={t('students.taxNumber')}
          initial={student?.taxNumber ?? ''}
          maxLength={40}
          hint={t('students.taxNumberHint')}
          className="max-w-none"
          {...fieldError('taxNumber')}
        />
      </div>

      {/* Prose, so it takes the wider cap rather than the single-control one. */}
      <div className="max-w-form">
        <TextAreaField
          name="notes"
          label={t('students.notes')}
          initial={student?.notes ?? ''}
          rows={3}
          maxLength={2000}
          className="max-w-none"
          {...fieldError('notes')}
        />
        <p className="mt-1.5 text-sm text-warning">{t('students.notesWarning')}</p>
      </div>

      {/*
        POOLSE-04. Its own section, appearing and disappearing with the date of
        birth without ever throwing away what has been typed into it.
      */}
      <GuardianBlock
        ageOfMajority={ageOfMajority}
        guardians={student?.guardians}
        birthDate={birthDate}
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
  const [state, action, pending] = useSavedAction(archiveStudentAction, INITIAL);

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

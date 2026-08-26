'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { StudentLevel } from '../../../../lib/api';
import type { FormState } from '../actions';
import { archiveStudentAction, createStudentAction, updateStudentAction } from './students.actions';

const INITIAL: FormState = { ok: false };

const field =
  'rounded border border-border bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

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
}: {
  organizationId: string;
  levels: StudentLevel[];
  student?: StudentFormValues;
  mode: 'create' | 'edit';
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
        <div className="flex flex-col gap-2">
          <label htmlFor="student-first" className="text-sm text-foreground-muted">
            {t('students.firstName')}
          </label>
          <input
            id="student-first"
            name="firstName"
            required
            maxLength={120}
            defaultValue={student?.firstName ?? ''}
            className={field}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="student-last" className="text-sm text-foreground-muted">
            {t('students.lastName')}
          </label>
          <input
            id="student-last"
            name="lastName"
            required
            maxLength={120}
            defaultValue={student?.lastName ?? ''}
            className={field}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="student-birth" className="text-sm text-foreground-muted">
            {t('students.birthDate')}
          </label>
          <input
            id="student-birth"
            name="birthDate"
            type="date"
            defaultValue={student?.birthDate ?? ''}
            className={field}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="student-level" className="text-sm text-foreground-muted">
            {t('students.level')}
          </label>
          <select
            id="student-level"
            name="levelId"
            defaultValue={student?.levelId ?? ''}
            className={field}
          >
            <option value="">{t('students.noLevel')}</option>
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="student-email" className="text-sm text-foreground-muted">
            {t('students.contactEmail')}
          </label>
          <input
            id="student-email"
            name="contactEmail"
            type="email"
            defaultValue={student?.contactEmail ?? ''}
            className={field}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="student-phone" className="text-sm text-foreground-muted">
            {t('students.contactPhone')}
          </label>
          <input
            id="student-phone"
            name="contactPhone"
            defaultValue={student?.contactPhone ?? ''}
            className={field}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="student-notes" className="text-sm text-foreground-muted">
          {t('students.notes')}
        </label>
        <textarea
          id="student-notes"
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={student?.notes ?? ''}
          className={field}
        />
        <p className="text-sm text-warning">{t('students.notesWarning')}</p>
      </div>

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

'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ClassGroup, ClassOptions } from '@/lib/api';
import type { FormState } from '../actions';
import {
  addSlotAction,
  archiveClassAction,
  createClassAction,
  endEnrollmentAction,
  enrolAction,
  removeSlotAction,
  updateClassAction,
} from './classes.actions';

const INITIAL: FormState = { ok: false };

const field =
  'rounded border border-border-strong bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

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

/** Shared by creating and editing, so the two cannot drift apart. */
export function ClassForm({
  organizationId,
  options,
  group,
  mode,
}: {
  organizationId: string;
  options: ClassOptions;
  group?: ClassGroup;
  mode: 'create' | 'edit';
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(
    mode === 'create' ? createClassAction : updateClassAction,
    INITIAL,
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      {group !== undefined && <input type="hidden" name="groupId" value={group.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <label htmlFor="class-name" className="text-sm text-foreground-muted">
            {t('classes.nameLabel')}
          </label>
          <input
            id="class-name"
            name="name"
            required
            maxLength={120}
            defaultValue={group?.name ?? ''}
            placeholder={t('classes.namePlaceholder')}
            className={field}
          />
        </div>

        <Choose
          id="class-level"
          name="levelId"
          label={t('classes.level')}
          none={t('classes.noLevel')}
          choices={options.levels}
          value={group?.levelId ?? ''}
        />
        <Choose
          id="class-instructor"
          name="instructorMembershipId"
          label={t('classes.instructor')}
          none={t('classes.noInstructor')}
          choices={options.instructors}
          value={group?.instructorMembershipId ?? ''}
        />
        <Choose
          id="class-pool"
          name="poolId"
          label={t('classes.pool')}
          none={t('classes.noPool')}
          choices={options.pools}
          value={group?.poolId ?? ''}
        />

        <div className="flex flex-col gap-2">
          <label htmlFor="class-lane" className="text-sm text-foreground-muted">
            {t('classes.lane')}
          </label>
          <input
            id="class-lane"
            name="lane"
            type="number"
            min={1}
            defaultValue={group?.lane ?? ''}
            className={field}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="class-capacity" className="text-sm text-foreground-muted">
            {t('classes.capacity')}
          </label>
          <input
            id="class-capacity"
            name="capacity"
            type="number"
            min={1}
            defaultValue={group?.capacity ?? ''}
            className={field}
          />
          <p className="text-sm text-foreground-muted">{t('classes.capacityHint')}</p>
        </div>
      </div>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : mode === 'create' ? t('classes.create') : t('common.save')}
        </button>
      </div>

      {state.ok && mode === 'edit' && <p className="text-sm text-success">{t('classes.saved')}</p>}
      <Problem state={state} />
    </form>
  );
}

function Choose({
  id,
  name,
  label,
  none,
  choices,
  value,
}: {
  id: string;
  name: string;
  label: string;
  none: string;
  choices: { id: string; name: string }[];
  value: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-foreground-muted">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value} className={field}>
        <option value="">{none}</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Adding a day to the weekly pattern.
 *
 * The time is a plain `time` input and stays wall-clock all the way down: six
 * o'clock means six o'clock on the pool's own clock, in July and in January.
 */
export function AddSlotForm({
  organizationId,
  groupId,
  dayNames,
}: {
  organizationId: string;
  groupId: string;
  dayNames: Record<number, string>;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(addSlotAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="groupId" value={groupId} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="slot-day" className="text-sm text-foreground-muted">
            {t('classes.day')}
          </label>
          <select id="slot-day" name="weekday" defaultValue="2" className={field}>
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <option key={day} value={day}>
                {dayNames[day]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="slot-time" className="text-sm text-foreground-muted">
            {t('classes.startTime')}
          </label>
          <input
            id="slot-time"
            name="startTime"
            type="time"
            required
            defaultValue="18:00"
            className={field}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="slot-duration" className="text-sm text-foreground-muted">
            {t('classes.duration')}
          </label>
          <input
            id="slot-duration"
            name="durationMinutes"
            type="number"
            min={5}
            max={480}
            defaultValue={45}
            className={`${field} w-28`}
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('classes.addSlot')}
        </button>
      </div>

      <Problem state={state} />
    </form>
  );
}

export function RemoveSlotButton({
  organizationId,
  groupId,
  scheduleId,
}: {
  organizationId: string;
  groupId: string;
  scheduleId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useActionState(removeSlotAction, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="scheduleId" value={scheduleId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger disabled:opacity-60"
      >
        {pending ? t('common.working') : t('classes.removeSlot')}
      </button>
    </form>
  );
}

/**
 * Putting a student in the turma.
 *
 * Two buttons rather than a checkbox: "enrol" and "add to the waiting list" are
 * different intentions, and when the turma is full the API says so and the
 * second button is the answer.
 */
export function EnrolForm({
  organizationId,
  groupId,
  students,
}: {
  organizationId: string;
  groupId: string;
  students: { id: string; name: string }[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(enrolAction, INITIAL);

  if (students.length === 0) {
    return <p className="text-sm text-foreground-muted">{t('classes.everyoneEnrolled')}</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="groupId" value={groupId} />

      <div className="flex flex-wrap items-end gap-2">
        <select
          name="studentId"
          required
          aria-label={t('classes.student')}
          className={`${field} min-w-56 flex-1`}
        >
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.name}
            </option>
          ))}
        </select>

        <button
          type="submit"
          name="waiting"
          value="false"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('classes.enrol')}
        </button>
        <button
          type="submit"
          name="waiting"
          value="true"
          disabled={pending}
          className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted disabled:opacity-60"
        >
          {t('classes.addToWaiting')}
        </button>
      </div>

      <Problem state={state} />
    </form>
  );
}

export function EndEnrollmentButton({
  organizationId,
  groupId,
  enrollmentId,
}: {
  organizationId: string;
  groupId: string;
  enrollmentId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useActionState(endEnrollmentAction, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger disabled:opacity-60"
      >
        {pending ? t('common.working') : t('classes.remove')}
      </button>
    </form>
  );
}

/** Two steps, and the confirmation counts who it will unenrol. */
export function ArchiveClassButton({
  organizationId,
  groupId,
  enrolled,
}: {
  organizationId: string;
  groupId: string;
  enrolled: number;
}): React.ReactElement {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(archiveClassAction, INITIAL);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded border border-border px-3 py-1.5 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger"
      >
        {t('classes.archive')}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="groupId" value={groupId} />
      <span className="text-sm text-foreground-muted">
        {enrolled > 0 ? t('classes.confirmArchive', { count: enrolled }) : t('classes.confirmArchiveEmpty')}
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
      <Problem state={state} />
    </form>
  );
}

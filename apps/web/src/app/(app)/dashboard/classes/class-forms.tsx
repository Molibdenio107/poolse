'use client';

import { useState, useTransition } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import {
  CONTROL_LINE,
  FIELD_COLUMN,
  FIELD_LABEL,
  SelectField,
  TextField,
} from '@/components/ui/field';
import { fitsLevel, type AgeFit } from '@/lib/ages';
import { cn } from '@/lib/utils';
import type { ClassGroup, ClassOptions } from '@/lib/api';
import { createLevelInline } from '../students/students.actions';
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
  const [state, action, pending] = useSavedAction(
    mode === 'create' ? createClassAction : updateClassAction,
    INITIAL,
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      {group !== undefined && <input type="hidden" name="groupId" value={group.id} />}

      {/*
        `items-start` and a wider row gap — round 4 follow-up.

        The cells were stretching to the tallest in the row, so the level picker
        (which carries a button and, while open, a whole panel) dragged the
        instructor select beside it to the same height and left a band of empty
        space under its label. Aligning to the top lets each field be as tall as
        it is, and `gap-y-5` keeps the rows apart now that they are no longer
        padded out by the stretch.
      */}
      <div className="grid items-start gap-x-4 gap-y-5 sm:grid-cols-2">
        <TextField
          name="name"
          label={t('classes.nameLabel')}
          initial={group?.name ?? ''}
          required
          maxLength={120}
          placeholder={t('classes.namePlaceholder')}
          className="sm:col-span-2"
          {...(state.fields?.['name'] === undefined
            ? {}
            : { error: t(state.fields['name']) })}
        />

        <LevelChoice
          organizationId={organizationId}
          levels={options.levels}
          value={group?.levelId ?? ''}
          mode={mode}
        />
        <SelectField
          name="instructorMembershipId"
          label={t('classes.instructor')}
          initial={group?.instructorMembershipId ?? ''}
          options={[
            { value: '', label: t('classes.noInstructor') },
            ...options.instructors.map((one) => ({ value: one.id, label: one.name })),
          ]}
        />
        <SelectField
          name="poolId"
          label={t('classes.pool')}
          initial={group?.poolId ?? ''}
          options={[
            { value: '', label: t('classes.noPool') },
            ...options.pools.map((one) => ({ value: one.id, label: one.name })),
          ]}
        />

        {/*
          Lane and lotação are text, not `type="number"` with `min` — POOLSE-QA-07.

          The browser was the only thing rejecting a negative lotação, and its
          bubble never showed: the button did nothing and was indistinguishable
          from a broken one. The rule now lives in the API, which a crafted
          request meets too, and comes back naming the field so it lands here.
        */}
        <TextField
          name="lane"
          label={t('classes.lane')}
          initial={group?.lane === null || group?.lane === undefined ? '' : String(group.lane)}
          inputMode="numeric"
          {...(state.fields?.['lane'] === undefined
            ? {}
            : { error: t(state.fields['lane']) })}
        />

        <TextField
          name="capacity"
          label={t('classes.capacity')}
          initial={
            group?.capacity === null || group?.capacity === undefined
              ? ''
              : String(group.capacity)
          }
          inputMode="numeric"
          hint={t('classes.capacityHint')}
          {...(state.fields?.['capacity'] === undefined
            ? {}
            : { error: t(state.fields['capacity']) })}
        />
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
  const [state, action, pending] = useSavedAction(addSlotAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="groupId" value={groupId} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="slot-day" className={FIELD_LABEL}>
            {t('classes.day')}
          </label>
          {/*
            Nothing pre-selected — round 5.

            The day defaulted to Tuesday and the time to 18:00, which is a
            suggestion dressed as an answer: a turma with no timetable at all
            showed a form that already looked filled in, and pressing Add created
            a Tuesday evening class nobody had chosen. An empty first option
            makes the form say what it is — a blank to fill in — and `required`
            means it cannot be submitted half-answered.
          */}
          <select id="slot-day" name="weekday" required defaultValue="" className={CONTROL_LINE}>
            <option value="" disabled>
              {t('classes.chooseDay')}
            </option>
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <option key={day} value={day}>
                {dayNames[day]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="slot-time" className={FIELD_LABEL}>
            {t('classes.startTime')}
          </label>
          <input
            id="slot-time"
            name="startTime"
            type="time"
            required
            className={CONTROL_LINE}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="slot-duration" className={FIELD_LABEL}>
            {t('classes.duration')}
          </label>
          <input
            id="slot-duration"
            name="durationMinutes"
            type="number"
            min={5}
            max={480}
            defaultValue={45}
            className={cn(CONTROL_LINE, 'w-28')}
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
  const [, action, pending] = useSavedAction(removeSlotAction, INITIAL);

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
  level,
}: {
  organizationId: string;
  groupId: string;
  students: { id: string; name: string; birthDate: string | null }[];
  /**
   * The turma's level, when it has one — round 5.
   *
   * Its age bounds decide who the picker offers first. Null when the turma has
   * no level, or the level has no ages, and then nothing is filtered: a bound
   * that does not exist cannot be a rule.
   */
  level: { minAgeMonths: number | null; maxAgeMonths: number | null } | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(enrolAction, INITIAL);

  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  /*
   * Filtered by the level's ages — but never a block.
   *
   * The settled rule in this repo is that age warns and does not refuse: the
   * student form says so, and `classes.sql` test 13 asserts a 67-year-old can be
   * put in Bebés because a club sometimes has a reason. Round 5 asked for the
   * enrol picker to respect the level's range, and this is the shape that does
   * both — the sensible list by default, every student one checkbox away, and a
   * mark on the ones outside the range so choosing one is deliberate rather than
   * accidental.
   *
   * A student with no birth date is `unknown` and is always offered: an import
   * without dates must not make a whole club unenrollable.
   */
  const fitFor = (student: { birthDate: string | null }): AgeFit =>
    level === null ? 'fits' : fitsLevel(level, student.birthDate);

  const matching = students.filter((student) => {
    if (query.trim() !== '' && !matches(student.name, query)) return false;
    if (showAll) return true;
    const fit = fitFor(student);
    return fit === 'fits' || fit === 'unknown';
  });

  // How many the age filter is holding back — said as a number, because "some
  // students are hidden" is a sentence people ignore.
  const hidden = level === null
    ? 0
    : students.filter((student) => {
        const fit = fitFor(student);
        return fit === 'tooYoung' || fit === 'tooOld';
      }).length;

  if (students.length === 0) {
    return <p className="text-sm text-foreground-muted">{t('classes.everyoneEnrolled')}</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="groupId" value={groupId} />

      {/*
        Type to narrow, then choose — round 5. A club with three hundred students
        had a select three hundred long, which is the same scrolling problem the
        age picker had on the levels page.

        One strip of four controls, each sized to its content — round 6. Search
        was a `max-w-form` block on its own line and the picker below it was
        `flex-1`, so both stretched the full width of the Enrolled card: a name
        is rarely twenty characters, and a box that wide reads as a field wanting
        a sentence. Fixed widths put search, picker and both buttons on one line
        and leave the card's width to the list of enrolled students, which is the
        part that actually needs it. The picker keeps `max-w-full` so the strip
        wraps rather than overflows on a narrow window, and a name longer than
        the box is clipped in the closed control only — the open dropdown is the
        browser's own and sizes itself to the names.
      */}
      <div className="flex flex-wrap items-end gap-2">
        <div className={cn(FIELD_COLUMN, 'w-48 max-w-full')}>
          <label htmlFor="enrol-search" className={FIELD_LABEL}>
            {t('classes.searchStudents')}
          </label>
          <input
            id="enrol-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('classes.searchStudentsPlaceholder')}
            className={CONTROL_LINE}
            autoComplete="off"
          />
        </div>

        <div className={cn(FIELD_COLUMN, 'w-64 max-w-full')}>
          {/*
            A visible label, not the `aria-label` this had: the picker now sits
            beside a labelled search box, and an unlabelled control next to a
            labelled one reads as part of it.
          */}
          <label htmlFor="enrol-student" className={FIELD_LABEL}>
            {t('classes.student')}
          </label>
          <select id="enrol-student" name="studentId" required className={CONTROL_LINE}>
            {matching.length === 0 && (
              <option value="" disabled>
                {t('classes.noStudentsMatch')}
              </option>
            )}
            {matching.map((student) => {
              const fit = fitFor(student);
              return (
                <option key={student.id} value={student.id}>
                  {student.name}
                  {/*
                    The mark is text in the option, not a colour: a `<select>`
                    cannot carry a badge, and "outside the ages" has to be legible
                    to somebody listening to the page as much as looking at it.
                  */}
                  {fit === 'tooYoung' || fit === 'tooOld'
                    ? ` — ${t('classes.outsideAges')}`
                    : ''}
                </option>
              );
            })}
          </select>
        </div>

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

      {hidden > 0 && (
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
            className="size-4"
          />
          {t('classes.showOutsideAges', { count: hidden })}
        </label>
      )}

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
  const [, action, pending] = useSavedAction(endEnrollmentAction, INITIAL);

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
  const [state, action, pending] = useSavedAction(archiveClassAction, INITIAL);

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

/**
 * The level picker, with a way to create one without leaving the page - round 4.
 *
 * Setting up a season goes turma, turma, turma, and the third one needs a level
 * that does not exist yet. Before this, that meant abandoning a half-filled form,
 * navigating to Niveis, creating the level, coming back and starting again - and
 * React 19 clears a form on the way out, so "coming back" meant retyping it.
 *
 * **It is not a nested form, because that is not legal HTML.** A form inside a
 * form is invalid, and browsers resolve it by ignoring the inner one, so the
 * inner submit posts the outer form - here, that would create a half-filled
 * turma every time somebody added a level. The panel is therefore plain inputs
 * and a type="button", calling the server action directly through a transition.
 * The age bounds use the same number-and-unit pair as Niveis rather than a
 * second way of saying the same thing.
 *
 * **What it deliberately does not do** is offer everything the levels page does:
 * no reordering, no skills, no archiving. This is the shortcut for "I need
 * Iniciacao 3 to exist right now"; the page remains where a progression is
 * designed.
 */
function LevelChoice({
  organizationId,
  levels,
  value,
  mode,
}: {
  organizationId: string;
  levels: { id: string; name: string }[];
  value: string;
  /**
   * Creating only — round 4 follow-up.
   *
   * Editing a turma is a correction: you are changing which level this group
   * sits at, and the levels already exist. Offering to invent a new one there
   * puts a schema change in front of somebody who came to fix a typo. Setting a
   * season up is the opposite — the levels are being decided as the turmas are —
   * which is where the shortcut earns its place.
   */
  mode: 'create' | 'edit';
}): React.ReactElement {
  const t = useTranslations();

  // Seeded from the server list and appended to locally, so a level created here
  // is selectable immediately rather than after a round trip.
  const [choices, setChoices] = useState(levels);
  const [selected, setSelected] = useState(value);
  const [open, setOpen] = useState(false);

  const [name, setName] = useState('');
  const [fromValue, setFromValue] = useState('');
  const [fromUnit, setFromUnit] = useState('years');
  const [toValue, setToValue] = useState('');
  const [toUnit, setToUnit] = useState('years');

  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const months = (raw: string, unit: string): string => {
    const parsed = Number(raw.trim().replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(parsed) || parsed < 0) return '';
    return String(unit === 'months' ? Math.round(parsed) : Math.round(parsed * 12));
  };

  const create = (): void => {
    setError(null);
    startSaving(async () => {
      const result = await createLevelInline(
        organizationId,
        name,
        months(fromValue, fromUnit),
        months(toValue, toUnit),
      );

      if (!result.ok) {
        setError(result.errorKey);
        return;
      }

      setChoices((current) => [...current, { id: result.id, name: result.name }]);
      // Selecting it is the reason this exists - creating a level and then
      // having to find it in the list would be most of the interruption back.
      setSelected(result.id);
      setName('');
      setFromValue('');
      setToValue('');
      setOpen(false);
    });
  };

  const bounds = [
    {
      id: 'new-level-from',
      label: t('students.ageFrom'),
      value: fromValue,
      setValue: setFromValue,
      unit: fromUnit,
      setUnit: setFromUnit,
    },
    {
      id: 'new-level-to',
      label: t('students.ageTo'),
      value: toValue,
      setValue: setToValue,
      unit: toUnit,
      setUnit: setToUnit,
    },
  ];

  return (
    <div className={FIELD_COLUMN}>
      <label htmlFor="class-level" className={FIELD_LABEL}>
        {t('classes.level')}
      </label>
      <select
        id="class-level"
        name="levelId"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        className={CONTROL_LINE}
      >
        <option value="">{t('classes.noLevel')}</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>

      {/*
        A button, not a link — round 4 follow-up. Underlined text beneath a
        select reads as a footnote about the field; this creates something, and a
        control that creates something should look like a control. The `+` is the
        second cue, so it is not the colour alone saying "this adds".
      */}
      {mode === 'create' && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex w-fit items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('classes.newLevel')}
          <span aria-hidden>+</span>
        </button>
      )}

      {mode === 'create' && open && (
        <div className="flex flex-col gap-3 rounded border border-border bg-surface-muted p-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-level-name" className={FIELD_LABEL}>
              {t('students.levelName')}
            </label>
            <input
              id="new-level-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              className={CONTROL_LINE}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            {bounds.map((bound) => (
              <div key={bound.id} className="flex items-end gap-2">
                <div className="flex w-20 flex-col gap-1.5">
                  <label htmlFor={bound.id} className={FIELD_LABEL}>
                    {bound.label}
                  </label>
                  <input
                    id={bound.id}
                    type="number"
                    min={0}
                    value={bound.value}
                    onChange={(event) => bound.setValue(event.target.value)}
                    className={CONTROL_LINE}
                  />
                </div>
                <select
                  aria-label={t('students.ageUnit')}
                  value={bound.unit}
                  onChange={(event) => bound.setUnit(event.target.value)}
                  className={CONTROL_LINE + ' w-28'}
                >
                  <option value="years">{t('students.ageUnitYears')}</option>
                  <option value="months">{t('students.ageUnitMonths')}</option>
                </select>
              </div>
            ))}
          </div>

          {error !== null && <p className="text-sm text-danger">{t(error)}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={create}
              disabled={saving || name.trim() === ''}
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
            >
              {saving ? t('common.working') : t('students.createLevel')}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="rounded border border-border px-3 py-1.5 text-sm"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * Accent- and case-insensitive substring match.
 *
 * "joao" finds "João", which is what somebody typing quickly on a Portuguese
 * keyboard expects. `NFD` splits the accent off the letter so it can be
 * stripped; the database does the same thing with `strip_accents` on its side.
 */
function matches(name: string, query: string): boolean {
  const flatten = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  return flatten(name).includes(flatten(query.trim()));
}

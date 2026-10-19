'use client';

import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import { CONTROL_LINE, FIELD_LABEL, SelectField, useSeeded, useSuccessKey } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { Course, MeetChoice, Stroke } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import type { FormState } from '../../../actions';
import {
  addRecordAction,
  archiveRecordAction,
  setFavouriteStrokeAction,
} from './progress.actions';

const INITIAL: FormState = { ok: false };

/** The distances a pool actually races. Free entry stays possible via the number input. */
const COMMON_DISTANCES = [25, 50, 100, 200, 400, 800, 1500];

/**
 * Recording a swim.
 *
 * The time is three separate numbers — minutes, seconds, hundredths — rather
 * than one text box, and that is the most important decision on this screen.
 * People write times as "1:23.45", "83.45" and "1.23.45", and any parser that
 * guesses between them will one day read a time wrong, store it as a personal
 * best, and nobody will notice because the number looks plausible. Three inputs
 * cannot be misread.
 */
export function AddRecordForm({
  organizationId,
  studentId,
  strokes,
  courses,
  defaultCourse,
  meets,
  today,
}: {
  organizationId: string;
  studentId: string;
  strokes: Stroke[];
  courses: Course[];
  /** The turma's pool length, when it is 25 or 50 m — POOLSE-81. */
  defaultCourse: Course | null;
  meets: MeetChoice[];
  /** Today, resolved on the server so the default does not depend on the client clock. */
  today: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(addRecordAction, INITIAL);
  // A form typed into again after each save: its fields clear when one works.
  const added = useSuccessKey(state);
  const [distanceMField, setDistanceMField] = useSeeded<string>('50', added);
  const [swumOnField, setSwumOnField] = useSeeded<string>(String(today), added);
  const [strokeField, setStrokeField] = useSeeded<string>(strokes[0] ?? '', added);
  const [minutesField, setMinutesField] = useSeeded<string>('', added);
  const [secondsField, setSecondsField] = useSeeded<string>('', added);
  const [hundredthsField, setHundredthsField] = useSeeded<string>('', added);
  const [noteField, setNoteField] = useSeeded<string>('', added);
  // The pool and the meet — POOLSE-81. Empty course is "não indicada", said
  // rather than guessed; a meet is optional, and a new one can be named here and
  // marked official (Rui, 19-10-2026).
  const [courseField, setCourseField] = useSeeded<string>(defaultCourse ?? '', added);
  const [meetField, setMeetField] = useSeeded<string>('', added);
  const [meetNameField, setMeetNameField] = useSeeded<string>('', added);
  const [meetOfficial, setMeetOfficial] = useSeeded<boolean>(false, added);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="record-stroke" className={FIELD_LABEL}>
            {t('progress.stroke')}
          </label>
          <select
            id="record-stroke"
            name="stroke"
            value={strokeField}
            onChange={(event) => setStrokeField(event.target.value)}
            className={CONTROL_LINE}
          >
            {strokes.map((stroke) => (
              <option key={stroke} value={stroke}>
                {t(`progress.strokes.${stroke}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="record-distance" className={FIELD_LABEL}>
            {t('progress.distance')}
          </label>
          <input
            id="record-distance"
            name="distanceM"
            type="number"
            min={1}
            max={10000}
            value={distanceMField}
            onChange={(event) => setDistanceMField(event.target.value)}
            list="common-distances"
            className={cn(CONTROL_LINE, 'w-28')}
          />
          <datalist id="common-distances">
            {COMMON_DISTANCES.map((distance) => (
              <option key={distance} value={distance} />
            ))}
          </datalist>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className={FIELD_LABEL}>{t('progress.time')}</legend>
          <div className="flex items-center gap-1">
            <input
              name="minutes"
              type="number"
              value={minutesField}
              onChange={(event) => setMinutesField(event.target.value)}
              min={0}
              max={600}
              placeholder={t('progress.minutes')}
              aria-label={t('progress.minutes')}
              className={cn(CONTROL_LINE, 'w-20')}
            />
            <span aria-hidden className="text-foreground-muted">
              :
            </span>
            <input
              name="seconds"
              type="number"
              value={secondsField}
              onChange={(event) => setSecondsField(event.target.value)}
              min={0}
              max={59}
              placeholder={t('progress.seconds')}
              aria-label={t('progress.seconds')}
              className={cn(CONTROL_LINE, 'w-20')}
            />
            <span aria-hidden className="text-foreground-muted">
              .
            </span>
            <input
              name="hundredths"
              type="number"
              value={hundredthsField}
              onChange={(event) => setHundredthsField(event.target.value)}
              min={0}
              max={99}
              placeholder={t('progress.hundredths')}
              aria-label={t('progress.hundredths')}
              className={cn(CONTROL_LINE, 'w-20')}
            />
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor="record-course" className={FIELD_LABEL}>
            {t('progress.courseLabel')}
          </label>
          <select
            id="record-course"
            name="course"
            value={courseField}
            onChange={(event) => setCourseField(event.target.value)}
            className={CONTROL_LINE}
          >
            <option value="">{t('progress.course.none')}</option>
            {courses.map((course) => (
              <option key={course} value={course}>
                {t(`progress.course.${course}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="record-date" className={FIELD_LABEL}>
            {t('progress.swumOn')}
          </label>
          <input
            id="record-date"
            name="swumOn"
            type="date"
            required
            value={swumOnField}
            onChange={(event) => setSwumOnField(event.target.value)}
            max={today}
            className={CONTROL_LINE}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="record-meet" className={FIELD_LABEL}>
            {t('progress.meet')}
          </label>
          <select
            id="record-meet"
            name="meetId"
            value={meetField}
            onChange={(event) => setMeetField(event.target.value)}
            className={cn(CONTROL_LINE, 'max-w-80')}
          >
            <option value="">{t('progress.meetNone')}</option>
            {meets.map((meet) => (
              <option key={meet.id} value={meet.id}>
                {meet.name} · {formatDate(meet.startsOn)}
                {meet.official ? ` · ${t('progress.official')}` : ''}
              </option>
            ))}
            <option value="new">{t('progress.meetNew')}</option>
          </select>
        </div>
        {meetField === 'new' && (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor="record-meet-name" className={FIELD_LABEL}>
                {t('progress.meetName')}
              </label>
              <input
                id="record-meet-name"
                name="meetName"
                value={meetNameField}
                onChange={(event) => setMeetNameField(event.target.value)}
                maxLength={200}
                required
                className={cn(CONTROL_LINE, 'min-w-56')}
              />
            </div>
            <label className="flex h-control items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="meetOfficial"
                value="true"
                checked={meetOfficial}
                onChange={(event) => setMeetOfficial(event.target.checked)}
                className="size-4"
              />
              {t('progress.meetOfficial')}
            </label>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          name="note"
          value={noteField}
          onChange={(event) => setNoteField(event.target.value)}
          maxLength={500}
          aria-label={t('progress.note')}
          placeholder={t('progress.notePlaceholder')}
          className={cn(CONTROL_LINE, 'min-w-48 flex-1')}
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('progress.add')}
        </button>
      </div>

      {state.errorKey !== undefined && (
        <p className="text-sm text-danger">
          {t(state.errorKey)}
          {state.detail !== undefined && (
            <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
          )}
        </p>
      )}
    </form>
  );
}

/**
 * Declared, never calculated — which is the whole contrast the story draws.
 *
 * A swimmer's favourite stroke is a fact about them that no amount of timing
 * data contains. Plenty of people love the butterfly they are slowest at.
 */
export function FavouriteStrokeForm({
  organizationId,
  studentId,
  strokes,
  current,
}: {
  organizationId: string;
  studentId: string;
  strokes: Stroke[];
  current: Stroke | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(setFavouriteStrokeAction, INITIAL);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />

      {/*
        POOLSE-10. This was an uncontrolled `<select defaultValue>`, and React 19
        resets a form once its action returns — so a save that had worked left
        the widget showing the value from before it, contradicting the success
        message beside it. The stroke was always stored correctly; only the
        control lied. `SelectField` is controlled and re-seeds when the server's
        answer actually changes.
      */}
      <SelectField
        name="stroke"
        label={t('progress.favourite')}
        initial={current ?? ''}
        options={[
          { value: '', label: t('progress.noFavourite') },
          ...strokes.map((stroke) => ({
            value: stroke,
            label: t(`progress.strokes.${stroke}`),
          })),
        ]}
      />

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border hover:bg-surface-muted disabled:opacity-60"
      >
        {pending ? t('common.working') : t('common.save')}
      </button>

    </form>
  );
}

export function ArchiveRecordButton({
  organizationId,
  studentId,
  recordId,
}: {
  organizationId: string;
  studentId: string;
  recordId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(archiveRecordAction, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="recordId" value={recordId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border text-foreground-muted hover:border-danger/50 hover:text-danger disabled:opacity-60"
      >
        {pending ? t('common.working') : t('progress.remove')}
      </button>
    </form>
  );
}

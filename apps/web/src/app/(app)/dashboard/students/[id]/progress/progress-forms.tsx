'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { SelectField } from '@/components/ui/field';
import type { Stroke } from '@/lib/api';
import type { FormState } from '../../../actions';
import {
  addRecordAction,
  archiveRecordAction,
  setFavouriteStrokeAction,
} from './progress.actions';

const INITIAL: FormState = { ok: false };

const field =
  'rounded border border-border-strong bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

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
  today,
}: {
  organizationId: string;
  studentId: string;
  strokes: Stroke[];
  /** Today, resolved on the server so the default does not depend on the client clock. */
  today: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(addRecordAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="record-stroke" className="text-sm text-foreground-muted">
            {t('progress.stroke')}
          </label>
          <select id="record-stroke" name="stroke" className={field}>
            {strokes.map((stroke) => (
              <option key={stroke} value={stroke}>
                {t(`progress.strokes.${stroke}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="record-distance" className="text-sm text-foreground-muted">
            {t('progress.distance')}
          </label>
          <input
            id="record-distance"
            name="distanceM"
            type="number"
            min={1}
            max={10000}
            defaultValue={50}
            list="common-distances"
            className={`${field} w-28`}
          />
          <datalist id="common-distances">
            {COMMON_DISTANCES.map((distance) => (
              <option key={distance} value={distance} />
            ))}
          </datalist>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm text-foreground-muted">{t('progress.time')}</legend>
          <div className="flex items-center gap-1">
            <input
              name="minutes"
              type="number"
              min={0}
              max={600}
              placeholder={t('progress.minutes')}
              aria-label={t('progress.minutes')}
              className={`${field} w-20`}
            />
            <span aria-hidden className="text-foreground-muted">
              :
            </span>
            <input
              name="seconds"
              type="number"
              min={0}
              max={59}
              placeholder={t('progress.seconds')}
              aria-label={t('progress.seconds')}
              className={`${field} w-20`}
            />
            <span aria-hidden className="text-foreground-muted">
              .
            </span>
            <input
              name="hundredths"
              type="number"
              min={0}
              max={99}
              placeholder={t('progress.hundredths')}
              aria-label={t('progress.hundredths')}
              className={`${field} w-20`}
            />
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor="record-date" className="text-sm text-foreground-muted">
            {t('progress.swumOn')}
          </label>
          <input
            id="record-date"
            name="swumOn"
            type="date"
            required
            defaultValue={today}
            max={today}
            className={field}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          name="note"
          maxLength={500}
          aria-label={t('progress.note')}
          placeholder={t('progress.notePlaceholder')}
          className={`${field} min-w-48 flex-1`}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('progress.add')}
        </button>
      </div>

      {state.ok && <p className="text-sm text-success">{t('progress.added')}</p>}
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
  const [state, action, pending] = useActionState(setFavouriteStrokeAction, INITIAL);

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
        className="rounded border border-border px-3 py-2 text-sm hover:bg-surface-muted disabled:opacity-60"
      >
        {pending ? t('common.working') : t('common.save')}
      </button>

      {state.errorKey !== undefined && (
        <span className="text-sm text-danger">{t(state.errorKey)}</span>
      )}
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
  const [, action, pending] = useActionState(archiveRecordAction, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="recordId" value={recordId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger disabled:opacity-60"
      >
        {pending ? t('common.working') : t('progress.remove')}
      </button>
    </form>
  );
}

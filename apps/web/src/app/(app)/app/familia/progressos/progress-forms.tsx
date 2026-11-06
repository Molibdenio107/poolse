'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { ConfirmButton } from '@/components/confirm-action';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/ui/field';
import type { ProgressLesson, ProgressPool } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../../dashboard/actions';
import { addTimeAction, removeTimeAction, setFavouriteAction } from './progress.actions';

const INITIAL: FormState = { ok: false };
const OPEN =
  'inline-flex h-control w-full items-center justify-center gap-1.5 rounded-sm bg-surface px-3 text-control font-medium shadow-card';
const SAVE =
  'inline-flex h-control items-center justify-center self-start rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60';

export function AddTime({
  studentId,
  strokes,
  pools,
  lessons,
}: {
  studentId: string;
  strokes: string[];
  pools: ProgressPool[];
  lessons: ProgressLesson[];
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [lesson, setLesson] = useState('');
  const [state, submit, pending] = useSavedAction(async (previous: FormState, data: FormData) => {
    const answer = await addTimeAction(previous, data);
    if (answer.ok) setOpen(false);
    return answer;
  }, INITIAL);
  const error = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };
  const poolLabel = (pool: ProgressPool): string => {
    const named = `${pool.facilityName} · ${pool.name}`;
    return pool.lengthM === null ? named : `${named} · ${pool.lengthM} m`;
  };
  return (
    <>
      <button type="button" className={OPEN} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {t('app.records.addTime')}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('app.records.addTime')} closeLabel={t('common.close')} placement="sheet">
        <form action={submit} className="flex flex-col gap-3">
          <input type="hidden" name="studentId" value={studentId} />
          <SelectField
            name="sessionId"
            label={t('app.records.lesson')}
            initial=""
            onValueChange={setLesson}
            options={[
              { value: '', label: t('app.records.noLesson') },
              ...lessons.map((one) => ({
                value: one.id,
                label: `${formatDate(one.day)} · ${one.time} · ${one.className}`,
              })),
            ]}
          />
          <SelectField
            name="stroke"
            label={t('app.records.stroke')}
            initial={strokes[0] ?? ''}
            options={strokes.map((stroke) => ({ value: stroke, label: t(`progress.strokes.${stroke}`) }))}
          />
          <TextField name="distanceM" label={t('app.records.distance')} inputMode="numeric" required error={error('distanceM')} />
          <SelectField
            name="poolId"
            label={t('app.records.pool')}
            initial=""
            options={[
              { value: '', label: t('app.records.noPool') },
              ...pools.map((pool) => ({ value: pool.id, label: poolLabel(pool) })),
            ]}
          />
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm">{t('app.records.time')}</legend>
            <div className="grid grid-cols-4 gap-2">
              <TextField name="hours" label={t('app.records.hours')} inputMode="numeric" maxLength={2} />
              <TextField name="minutes" label={t('app.records.minutes')} inputMode="numeric" maxLength={2} />
              <TextField name="seconds" label={t('app.records.seconds')} inputMode="numeric" maxLength={2} />
              <TextField name="hundredths" label={t('app.records.hundredths')} inputMode="numeric" maxLength={2} />
            </div>
            {error('time') !== undefined && <p className="text-sm text-danger">{error('time')}</p>}
          </fieldset>
          {/* A lesson brings its own day. */}
          {lesson === '' && (
            <TextField name="swumOn" type="date" label={t('app.records.date')} required error={error('swumOn')} />
          )}
          <button type="submit" disabled={pending} className={SAVE}>
            {pending ? t('common.working') : t('app.records.save')}
          </button>
        </form>
      </Dialog>
    </>
  );
}

/** Informative for the teacher: the same field the office sees. It saves on change. */
export function FavouriteStroke({
  studentId,
  strokes,
  favourite,
}: {
  studentId: string;
  strokes: string[];
  favourite: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const [, action] = useSavedAction(setFavouriteAction, INITIAL);
  const [, startSaving] = useTransition();
  const save = (stroke: string): void => {
    const data = new FormData();
    data.set('studentId', studentId);
    data.set('stroke', stroke);
    startSaving(() => action(data));
  };
  return (
    <SelectField
      name="favourite"
      label={t('app.records.favourite')}
      initial={favourite ?? ''}
      onValueChange={save}
      options={[
        { value: '', label: t('app.records.noFavourite') },
        ...strokes.map((stroke) => ({ value: stroke, label: t(`progress.strokes.${stroke}`) })),
      ]}
    />
  );
}

export function RemoveTime({ studentId, entry, name }: { studentId: string; entry: string; name: string }): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(removeTimeAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="entry" value={entry} />
      <ConfirmButton
        title={t('app.records.removeTitle', { name })}
        message={t('app.records.removeMessage')}
        confirmLabel={t('app.records.remove')}
        tone="danger"
        disabled={pending}
        ariaLabel={t('app.records.removeTitle', { name })}
        className="inline-flex h-control w-control items-center justify-center text-foreground-muted"
      >
        <X className="size-4" aria-hidden />
      </ConfirmButton>
    </form>
  );
}

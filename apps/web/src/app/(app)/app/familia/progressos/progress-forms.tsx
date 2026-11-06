'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { ConfirmButton } from '@/components/confirm-action';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../../dashboard/actions';
import { addMeasureAction, addTimeAction, removeEntryAction } from './progress.actions';

const INITIAL: FormState = { ok: false };
const OPEN =
  'inline-flex h-control flex-1 items-center justify-center gap-1.5 rounded-sm bg-surface px-3 text-control font-medium shadow-card';
const SAVE =
  'inline-flex h-control items-center justify-center self-start rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60';

type Action = (previous: FormState, data: FormData) => Promise<FormState>;

function Sheet({
  label,
  action,
  children,
}: {
  label: string;
  action: Action;
  children: (error: (name: string) => string | undefined) => React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useSavedAction(async (previous: FormState, data: FormData) => {
    const answer = await action(previous, data);
    if (answer.ok) setOpen(false);
    return answer;
  }, INITIAL);
  const error = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };
  return (
    <>
      <button type="button" className={OPEN} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {label}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label} closeLabel={t('common.close')} placement="sheet">
        <form action={submit} className="flex flex-col gap-3">
          {children(error)}
          <button type="submit" disabled={pending} className={SAVE}>
            {pending ? t('common.working') : t('app.records.save')}
          </button>
        </form>
      </Dialog>
    </>
  );
}

export function AddTime({ studentId, strokes }: { studentId: string; strokes: string[] }): React.ReactElement {
  const t = useTranslations();
  return (
    <Sheet label={t('app.records.addTime')} action={addTimeAction}>
      {(error) => (
        <>
          <input type="hidden" name="studentId" value={studentId} />
          <SelectField
            name="stroke"
            label={t('app.records.stroke')}
            initial={strokes[0] ?? ''}
            options={strokes.map((stroke) => ({ value: stroke, label: t(`progress.strokes.${stroke}`) }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField name="distanceM" label={t('app.records.distance')} inputMode="numeric" required error={error('distanceM')} />
            <SelectField
              name="course"
              label={t('app.records.pool')}
              initial=""
              options={[
                { value: '', label: t('progress.course.none') },
                { value: 'scm', label: t('progress.course.scm') },
                { value: 'lcm', label: t('progress.course.lcm') },
              ]}
            />
          </div>
          <TextField name="time" label={t('app.records.time')} hint={t('app.records.timeHint')} required error={error('time')} />
          <TextField name="swumOn" type="date" label={t('app.records.date')} required error={error('swumOn')} />
        </>
      )}
    </Sheet>
  );
}

export function AddMeasure({ studentId }: { studentId: string }): React.ReactElement {
  const t = useTranslations();
  return (
    <Sheet label={t('app.records.addMeasure')} action={addMeasureAction}>
      {(error) => (
        <>
          <input type="hidden" name="studentId" value={studentId} />
          <SelectField
            name="kind"
            label={t('app.records.measure')}
            initial="weight"
            options={['weight', 'height', 'distance_swum'].map((kind) => ({
              value: kind,
              label: t(`app.records.kind.${kind}`),
            }))}
          />
          <TextField name="value" label={t('app.records.value')} inputMode="decimal" required error={error('value')} />
          <TextField name="measuredOn" type="date" label={t('app.records.date')} required error={error('measuredOn')} />
        </>
      )}
    </Sheet>
  );
}

export function RemoveEntry({
  studentId,
  entry,
  what,
  name,
}: {
  studentId: string;
  entry: string;
  what: 'times' | 'measures';
  name: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(removeEntryAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="entry" value={entry} />
      <input type="hidden" name="what" value={what} />
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

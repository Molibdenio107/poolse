'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TextAreaField, TextField, useFocusFirstError, useSuccessKey } from '@/components/ui/field';
import { TurmaPicker, type TurmaOption } from '@/components/turma-picker';
import type { AppJoinOptions } from '@/lib/api';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../../dashboard/actions';
import { requestJoinAction } from './join.actions';

const INITIAL: FormState = { ok: false };
const NEW = 'new';

/**
 * The request: who, which turma, a word for the office, and the consent the
 * public form asks for — POOLSE-121. A new child adds their name, birth date and
 * what they are to the reader. The child's own level is the picker's first group.
 * After a request that worked, the fields are remounted clean.
 */
export function JoinForm({ options, consent }: { options: AppJoinOptions; consent: string }): React.ReactElement {
  const [state, dispatch, pending] = useSavedAction(requestJoinAction, INITIAL);
  const key = useSuccessKey(state);
  return (
    <Fields key={key} options={options} consent={consent} state={state} dispatch={dispatch} pending={pending} />
  );
}

function Fields({
  options,
  consent,
  state,
  dispatch,
  pending,
}: {
  options: AppJoinOptions;
  consent: string;
  state: FormState;
  dispatch: (formData: FormData) => void;
  pending: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);
  const error = (field: string): string | undefined => {
    const k = state.fields?.[field];
    return k === undefined ? undefined : t(k, state.values ?? {});
  };

  const [who, setWho] = useState(options.people.length === 1 ? options.people[0]!.id : '');
  const [agreed, setAgreed] = useState(false);
  const [picked, setPicked] = useState('');

  const levelNames = useMemo(
    () => new Map(options.classes.filter((c) => c.levelId !== null).map((c) => [c.levelId!, c.levelName])),
    [options.classes],
  );
  const person = options.people.find((one) => one.id === who);
  const requestedLevelName = person?.levelId ? (levelNames.get(person.levelId) ?? null) : null;
  const turmas: TurmaOption[] = options.classes.map((c) => ({
    id: c.id,
    name: `${c.name} · ${c.facilityName}`,
    levelName: c.levelName,
    levelOrder: c.levelOrder,
    capacity: c.capacity,
    active: c.active,
    slots: c.slots,
    instructorName: c.instructorName,
  }));
  const choices = [
    ...options.people.map((one) => ({
      id: one.id,
      label: one.self ? t('app.join.me', { name: one.name }) : one.name,
    })),
    { id: NEW, label: t('app.join.newChild') },
  ];

  return (
    <form ref={formRef} action={dispatch} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('app.join.who')}</legend>
        {choices.map((one) => (
          <label
            key={one.id}
            className="flex min-h-control items-center gap-3 rounded-lg border border-border bg-surface px-3"
          >
            <input
              type="radio"
              name="studentId"
              value={one.id}
              checked={who === one.id}
              onChange={() => setWho(one.id)}
              className="size-4 shrink-0 accent-primary"
            />
            <span className="text-control">{one.label}</span>
          </label>
        ))}
        {error('studentId') !== undefined && <span className="text-sm text-danger">{error('studentId')}</span>}
      </fieldset>

      {who === NEW && (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
          <legend className="px-1 text-sm font-medium">{t('app.join.newChildTitle')}</legend>
          <TextField name="firstName" label={t('app.join.firstName')} maxLength={100} required error={error('firstName')} />
          <TextField name="lastName" label={t('app.join.lastName')} maxLength={100} required error={error('lastName')} />
          <TextField name="birthDate" type="date" label={t('app.join.birthDate')} required error={error('birthDate')} />
          <TextField
            name="relationship"
            label={t('app.join.relationship')}
            hint={t('app.join.relationshipHint')}
            maxLength={80}
            required
            error={error('relationship')}
          />
        </fieldset>
      )}

      {options.classes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-foreground-muted">
          {t('app.join.noClasses')}
        </p>
      ) : (
        <TurmaPicker
          name="classGroupId"
          label={t('app.join.class')}
          turmas={turmas}
          requestedLevelName={requestedLevelName}
          allowFull={false}
          onChange={setPicked}
          error={error('classGroupId')}
        />
      )}

      <TextAreaField
        name="note"
        label={t('app.join.note')}
        hint={t('app.join.noteHint')}
        maxLength={2000}
        error={error('note')}
      />

      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="consent"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
            aria-invalid={error('consent') !== undefined}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
          <span className="text-sm">{consent}</span>
        </label>
        {error('consent') !== undefined && <span className="text-sm text-danger">{error('consent')}</span>}
      </div>

      <button
        type="submit"
        disabled={pending || who === '' || picked === ''}
        className="inline-flex min-h-control items-center justify-center rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-60"
      >
        {t('app.join.submit')}
      </button>
    </form>
  );
}

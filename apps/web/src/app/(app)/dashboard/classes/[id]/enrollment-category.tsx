'use client';

import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import { CONTROL_LINE, useSeeded } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { FormState } from '../../actions';
import { setEnrollmentCategoryAction } from './enrollment-category.actions';

/**
 * One person's own fee category, against their turma's — POOLSE-23 AC4.
 *
 * **The empty option is "from the turma", not "none".** Clearing somebody's own
 * category returns them to whatever their turma is on, which is a different
 * thing from taking them off every category and is the one an operator means:
 * the override exists for the single member of a senior turma who is also staff,
 * and undoing it should put them back with everybody else.
 *
 * Saves on change rather than behind a button. It is one field with three or
 * four possible values, and a Save beside it would be a second click for a
 * decision already made — the same reasoning as the calendar's teacher picker.
 */
export function EnrollmentCategoryPicker({
  enrollmentId,
  categories,
  own,
  effective,
}: {
  enrollmentId: string;
  categories: { id: string; name: string }[];
  /** Their own, or null when they simply follow their turma. */
  own: string | null;
  /** What actually applies — theirs, else the turma's. Null when neither. */
  effective: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(setEnrollmentCategoryAction, INITIAL);
  // Controlled: after a save the form resets, and an uncontrolled select would
  // spring back to the category it had before the change it just saved.
  const [chosen, setChosen] = useSeeded<string>(own ?? '');

  return (
    <form action={submit}>
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <label className="sr-only" htmlFor={`cat-${enrollmentId}`}>
        {t('categories.onEnrollment')}
      </label>
      <select
        id={`cat-${enrollmentId}`}
        name="categoryId"
        value={chosen}
        disabled={pending}
        onChange={(event) => {
          setChosen(event.target.value);
          event.currentTarget.form?.requestSubmit();
        }}
        className={cn(CONTROL_LINE, 'w-auto')}
      >
        {/*
          The empty answer names the turma's category where there is one, so the
          operator can see what "from the turma" will actually give them without
          choosing it first.
        */}
        <option value="">
          {own === null && effective !== null
            ? t('categories.fromGroupIs', { name: effective })
            : t('categories.fromGroup')}
        </option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>

      {state.errorKey !== undefined && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {t(state.errorKey, state.values ?? {})}
        </p>
      )}
    </form>
  );
}

const INITIAL: FormState = { ok: false };

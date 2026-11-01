'use client';

import { useTranslations } from 'next-intl';
import { SelectField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import { setSportLevelAction } from '../students.actions';
import type { FormState } from '../../actions';

const INITIAL: FormState = { ok: false };

/**
 * A student's level in one sport — POOLSE-148. One select of that sport's ladder
 * and a save, on the sport's card; the level is independent of every other
 * sport's. Owner and admin, as the API says.
 */
export function SportLevelForm({
  organizationId,
  studentId,
  sport,
  levelId,
  levels,
}: {
  organizationId: string;
  studentId: string;
  sport: string;
  levelId: string | null;
  levels: { id: string; name: string }[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(setSportLevelAction, INITIAL);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="sport" value={sport} />
      <SelectField
        name="levelId"
        label={t('students.level')}
        initial={levelId ?? ''}
        options={[{ value: '', label: t('students.noLevel') }, ...levels.map((level) => ({ value: level.id, label: level.name }))]}
        {...(state.fields?.['levelId'] === undefined ? {} : { error: t(state.fields['levelId']) })}
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded-sm bg-surface shadow-card hover:bg-surface-muted disabled:opacity-60"
      >
        {pending ? t('common.working') : t('common.save')}
      </button>
    </form>
  );
}

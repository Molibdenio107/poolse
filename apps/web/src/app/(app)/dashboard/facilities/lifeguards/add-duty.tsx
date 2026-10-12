'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { TextField, useFocusFirstError } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import { PersonPicker } from '../incidents/person-picker';
import { searchStaffAction } from '../incidents/incidents.actions';
import { addDutyAction } from './roster.actions';
import type { FormState } from '../../actions';

const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Acrescentar — one duty on one day of one tank. Owner and admin.
 *
 * Closed until asked for: seven open forms a week is a page of boxes nobody is
 * filling in. The day and the tank are the row's, bound into the action, so the
 * form asks only who and from when to when. A duty that runs past midnight is
 * a `to` earlier than its `from`, which the API reads as the next day.
 *
 * The outcome is `useSavedAction`'s toast, the double-booking refusal included;
 * a field the API named is said beside that field.
 */
export function AddDuty({
  facilityId,
  poolId,
  day,
}: {
  facilityId: string;
  poolId: string;
  day: string;
}): React.ReactElement {
  const t = useTranslations();
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useSavedAction<FormState, FormData>(
    addDutyAction.bind(null, facilityId, poolId, day),
    { ok: false },
  );

  useFocusFirstError(form, state.fields, state);

  const fieldError = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };
  // The tank and the day are not boxes on this form, so a refusal of either is
  // said beneath it rather than beside a field that is not there.
  const rowError = fieldError('poolId') ?? fieldError('day');

  if (!open) {
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)} className={QUIET}>
          <Plus aria-hidden className="size-4" />
          {t('roster.add')}
        </button>
      </div>
    );
  }

  return (
    <form
      ref={form}
      action={submit}
      className="flex flex-col gap-3 rounded border border-border p-4"
    >
      <PersonPicker
        name="membershipId"
        label={t('roster.field.person')}
        hint={t('roster.field.personHint')}
        search={searchStaffAction}
        error={fieldError('membershipId')}
      />
      <div className="flex flex-wrap gap-4">
        <TextField
          name="from"
          type="time"
          label={t('roster.field.from')}
          required
          error={fieldError('from')}
          className="max-w-40"
        />
        <TextField
          name="to"
          type="time"
          label={t('roster.field.to')}
          hint={t('roster.field.toHint')}
          required
          error={fieldError('to')}
          className="max-w-40"
        />
      </div>
      {rowError !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {rowError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t('roster.adding') : t('roster.add')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={QUIET}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

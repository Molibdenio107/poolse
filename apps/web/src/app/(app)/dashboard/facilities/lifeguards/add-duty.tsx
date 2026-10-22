'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
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
 * Opened from the week's grid (POOLSE-96) in a dialog, already holding the day
 * and the hour that was clicked — or a gap's window, so covering it is one
 * name away. The day and the tank are bound into the action, so the form asks
 * only who and from when to when. A duty that runs past midnight is a `to`
 * earlier than its `from`, which the API reads as the next day.
 *
 * The outcome is `useSavedAction`'s toast, the double-booking refusal included;
 * a field the API named is said beside that field. A saved duty closes the
 * dialog; a refused one keeps it, and what was typed.
 */
export function AddDutyForm({
  facilityId,
  poolId,
  day,
  initialFrom,
  initialTo,
  onClose,
}: {
  facilityId: string;
  poolId: string;
  day: string;
  /** `HH:mm`, the hour clicked or the gap's start. */
  initialFrom: string;
  initialTo: string;
  onClose: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const form = useRef<HTMLFormElement>(null);
  const action = useMemo(
    () => addDutyAction.bind(null, facilityId, poolId, day),
    [facilityId, poolId, day],
  );
  const [state, submit, pending] = useSavedAction<FormState, FormData>(action, { ok: false });

  useFocusFirstError(form, state.fields, state);

  // A duty that saved closes the dialog; its block is on the grid behind it.
  useEffect(() => {
    if (state.ok) onClose();
  }, [state, onClose]);

  const fieldError = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };
  // The tank and the day are not boxes on this form, so a refusal of either is
  // said beneath it rather than beside a field that is not there.
  const rowError = fieldError('poolId') ?? fieldError('day');

  return (
    <form ref={form} action={submit} className="flex flex-col gap-3">
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
          initial={initialFrom}
          required
          error={fieldError('from')}
          className="max-w-40"
        />
        <TextField
          name="to"
          type="time"
          label={t('roster.field.to')}
          hint={t('roster.field.toHint')}
          initial={initialTo}
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
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={QUIET}>
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t('roster.adding') : t('roster.add')}
        </button>
      </div>
    </form>
  );
}

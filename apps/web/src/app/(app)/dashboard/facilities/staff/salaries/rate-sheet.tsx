'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import { centsToInput, formatCents } from '@/lib/money';
import type { SalaryRow, StaffRateRecord } from '@/lib/api';
import {
  addRateAction,
  archiveRateAction,
  loadHistoryAction,
  updateRateAction,
} from './salaries.actions';
import type { FormState } from '../../../actions';

/**
 * One person's pay, past and present — POOLSE-58.
 *
 * A sheet rather than a page: the list behind it is what the reader was scanning,
 * and taking twenty rows off the screen to add one date would be the wrong
 * trade. The same `Dialog` as every other question in this app, in its `side`
 * placement — one portal, one Escape key, one focus round trip.
 *
 * **`loaded` is its own state.** A fetch that answers `null` for both "not yet"
 * and "it failed" produces a panel that is empty with no explanation; this one
 * says which, and offers the retry.
 *
 * **A raise is a new rate, a correction is an edit.** Both are here and they are
 * deliberately different buttons: the first leaves history intact and closes the
 * old row the day before, the second rewrites a row that was wrong. Nothing is
 * ever deleted — *Remover* archives, and the row stays legible with its date.
 */

const EMPTY: FormState = { ok: false };

const BUTTON =
  'inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium ' +
  'text-primary-foreground hover:bg-primary/90 disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const QUIET =
  'inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm ' +
  'hover:border-primary/50 hover:text-primary ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; history: StaffRateRecord[] }
  | { state: 'error'; errorKey: string };

export function RateSheet({
  organizationId,
  person,
  canEdit,
  locale,
  onClose,
}: {
  organizationId: string;
  person: SalaryRow;
  canEdit: boolean;
  locale: string;
  onClose: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const format = useFormatter();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoaded({ state: 'loading' });
    const result = await loadHistoryAction(organizationId, person.membershipId);
    setLoaded(
      result.ok
        ? { state: 'ready', history: result.history }
        : { state: 'error', errorKey: result.errorKey },
    );
  }, [organizationId, person.membershipId]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (cents: number): string => formatCents(locale, cents);
  // `short` is a named format in `i18n.ts`, passed to both the server config and
  // the client provider. Asking for one that was never configured is a
  // MISSING_FORMAT throw at render time, on whichever screen draws it first.
  const day = (value: string): string =>
    format.dateTime(new Date(`${value}T00:00:00`), 'short');

  return (
    <Dialog
      open
      onClose={onClose}
      placement="side"
      // A flex column so the history scrolls and the buttons stay where they
      // are. `min-h-0` on the growable half is the part that is easy to miss:
      // without it a flex item refuses to shrink below its content and the whole
      // sheet scrolls instead, which is how a Save nobody can see gets reported
      // as a save that does not work.
      className="flex max-w-xl flex-col"
      title={
        person.displayName === null || person.displayName.trim() === ''
          ? t('salaries.unnamed')
          : person.displayName
      }
      description={t('salaries.historyTitle')}
      closeLabel={t('common.close')}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {loaded.state === 'loading' && (
          <p className="text-sm text-foreground-muted">{t('common.working')}</p>
        )}

        {loaded.state === 'error' && (
          <div className="rounded border border-danger/40 bg-danger/10 p-3 text-sm">
            <p className="text-danger">{t(loaded.errorKey)}</p>
            <button type="button" onClick={() => void load()} className={`${QUIET} mt-2`}>
              {t('salaries.retry')}
            </button>
          </div>
        )}

        {loaded.state === 'ready' && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loaded.history.length === 0 ? (
                <p className="text-sm text-foreground-muted">{t('salaries.noHistory')}</p>
              ) : (
                <ol className="space-y-3">
                  {loaded.history.map((rate) => (
                    <li
                      key={rate.id}
                      className={`rounded border p-3 ${
                        rate.current ? 'border-primary/50 bg-primary/5' : 'border-border'
                      }`}
                    >
                      {editing === rate.id ? (
                        <RateForm
                          organizationId={organizationId}
                          rate={rate}
                          onDone={() => {
                            setEditing(null);
                            void load();
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="font-medium tabular-nums">
                              {money(rate.amountCents)}{' '}
                              <span className="text-sm font-normal text-foreground-muted">
                                {t(`salaries.kind.${rate.kind}`)}
                              </span>
                            </p>
                            <p className="text-sm tabular-nums text-foreground-muted">
                              {rate.effectiveTo === null
                                ? t('salaries.since', { date: day(rate.effectiveFrom) })
                                : `${day(rate.effectiveFrom)} – ${day(rate.effectiveTo)}`}
                            </p>
                          </div>

                          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-foreground-muted">
                            <div className="flex gap-1.5">
                              <dt>{t('salaries.field.weeklyHours')}:</dt>
                              <dd className="text-foreground">
                                {rate.weeklyHours === null
                                  ? t('salaries.hoursNotRecorded')
                                  : t('salaries.hoursValue', { hours: rate.weeklyHours })}
                              </dd>
                            </div>
                            <div className="flex gap-1.5">
                              <dt>{t('salaries.field.payPeriods')}:</dt>
                              <dd className="text-foreground">{rate.payPeriodsPerYear}</dd>
                            </div>
                          </dl>

                          {rate.note !== null && <p className="mt-2 text-sm">{rate.note}</p>}

                          <p className="mt-2 text-xs text-foreground-muted">
                            {rate.createdByName === null
                              ? t('salaries.recordedAt', { date: day(rate.createdAt.slice(0, 10)) })
                              : t('salaries.recordedBy', {
                                  name: rate.createdByName,
                                  date: day(rate.createdAt.slice(0, 10)),
                                })}
                          </p>

                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {rate.current && (
                              <span className="rounded bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                                {t('salaries.currentRate')}
                              </span>
                            )}
                            {rate.archivedAt !== null && (
                              <span className="rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground-muted">
                                {t('salaries.archived')}
                              </span>
                            )}

                            {canEdit && rate.archivedAt === null && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setEditing(rate.id)}
                                  className="rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                >
                                  {t('common.edit')}
                                </button>
                                <ArchiveButton
                                  organizationId={organizationId}
                                  rateId={rate.id}
                                  onDone={() => void load()}
                                />
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {canEdit && (
              <div className="border-t border-border pt-4">
                {adding ? (
                  <RateForm
                    organizationId={organizationId}
                    membershipId={person.membershipId}
                    onDone={() => {
                      setAdding(false);
                      void load();
                    }}
                    onCancel={() => setAdding(false)}
                  />
                ) : (
                  <button type="button" onClick={() => setAdding(true)} className={BUTTON}>
                    {t('salaries.addRate')}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Add or correct, one form.
 *
 * Controlled fields throughout: React 19 resets a form as soon as a function
 * `action` returns — *including when it returns a validation error* — so an
 * uncontrolled input would wipe what somebody typed at the moment they are being
 * asked to correct it. `TextField` and `SelectField` re-seed only when the
 * server's value actually changes.
 */
function RateForm({
  organizationId,
  membershipId,
  rate,
  onDone,
  onCancel,
}: {
  organizationId: string;
  membershipId?: string;
  rate?: StaffRateRecord;
  onDone: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const editing = rate !== undefined;

  const [state, dispatch, pending] = useSavedAction(
    editing ? updateRateAction : addRateAction,
    EMPTY,
  );

  // The list behind the sheet is revalidated by the action; the sheet's own
  // history is a separate fetch, so it reloads when the save comes back.
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  const fieldError = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key);
  };

  return (
    <form action={dispatch} className="space-y-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      {editing ? (
        <input type="hidden" name="rateId" value={rate.id} />
      ) : (
        <input type="hidden" name="membershipId" value={membershipId ?? ''} />
      )}

      <SelectField
        name="kind"
        label={t('salaries.field.kind')}
        initial={rate?.kind ?? 'monthly'}
        error={fieldError('kind')}
        options={[
          { value: 'monthly', label: t('salaries.kind.monthly') },
          { value: 'hourly', label: t('salaries.kind.hourly') },
        ]}
      />

      <TextField
        name="amount"
        label={t('salaries.field.amount')}
        hint={t('salaries.amountHint')}
        inputMode="decimal"
        initial={rate === undefined ? '' : centsToInput(rate.amountCents)}
        error={fieldError('amount')}
        required
      />

      <TextField
        name="weeklyHours"
        label={t('salaries.field.weeklyHours')}
        hint={t('salaries.hoursHint')}
        inputMode="decimal"
        initial={rate?.weeklyHours == null ? '' : String(rate.weeklyHours)}
        error={fieldError('weeklyHours')}
      />

      <SelectField
        name="payPeriodsPerYear"
        label={t('salaries.field.payPeriods')}
        hint={t('salaries.periodsHint')}
        initial={String(rate?.payPeriodsPerYear ?? 14)}
        error={fieldError('payPeriodsPerYear')}
        options={[
          { value: '14', label: t('salaries.periods14') },
          { value: '12', label: t('salaries.periods12') },
        ]}
      />

      <TextField
        name="effectiveFrom"
        label={t('salaries.field.effectiveFrom')}
        type="date"
        initial={rate?.effectiveFrom ?? ''}
        error={fieldError('effectiveFrom')}
        required
      />

      {/*
        * An end date only when correcting. A new rate is open-ended and the one
        * before it closes the day before — offering an end here would let
        * somebody create a gap in the record they never see.
        */}
      {editing && (
        <TextField
          name="effectiveTo"
          label={t('salaries.field.effectiveTo')}
          hint={t('salaries.endHint')}
          type="date"
          initial={rate.effectiveTo ?? ''}
          error={fieldError('effectiveTo')}
        />
      )}

      <TextAreaField
        name="note"
        label={t('salaries.field.note')}
        initial={rate?.note ?? ''}
        error={fieldError('note')}
        rows={2}
      />

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? t('common.working') : t('common.save')}
        </button>
        <button type="button" onClick={onCancel} className={QUIET}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/**
 * Remove a rate — archived, never deleted.
 *
 * Two presses rather than a second `Dialog`: this one is already a dialog, and
 * nesting two focus traps to ask one question is how the two stop agreeing about
 * which of them Escape belongs to. The second press is labelled with what it
 * does, so nothing is confirmed by a button that says the same as the first.
 */
function ArchiveButton({
  organizationId,
  rateId,
  onDone,
}: {
  organizationId: string;
  rateId: string;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [armed, setArmed] = useState(false);
  const [state, dispatch, pending] = useSavedAction(archiveRateAction, EMPTY);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="rounded text-sm text-danger hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('common.remove')}
      </button>
    );
  }

  return (
    <form action={dispatch} className="flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="rateId" value={rateId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-danger/40 bg-danger/10 px-2 py-0.5 text-sm text-danger hover:border-danger disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('salaries.confirmRemove')}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="rounded text-sm text-foreground-muted hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('common.cancel')}
      </button>
    </form>
  );
}

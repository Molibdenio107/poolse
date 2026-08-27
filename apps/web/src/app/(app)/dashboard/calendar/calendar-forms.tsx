'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Closure } from '@/lib/api';
import type { FormState } from '../actions';
import {
  cancelSessionAction,
  createClosureAction,
  generateSeasonAction,
  removeClosureAction,
  type GenerateState,
} from './calendar.actions';

const INITIAL: FormState = { ok: false };
const INITIAL_GENERATE: GenerateState = { ok: false };

const field =
  'rounded border border-border bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function Problem({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.errorKey === undefined) return null;
  return (
    <p className="text-sm text-danger">
      {t(state.errorKey)}
      {state.detail !== undefined && (
        <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
      )}
    </p>
  );
}

/**
 * Builds the season.
 *
 * Reports what it did rather than saying "done", because the numbers are the
 * only way to tell a run that worked from a run that found nothing to do —
 * "0 created" on a fresh organization means the turmas have no weekly pattern
 * yet, and that is a different problem from a failure.
 */
export function GenerateSeason({
  organizationId,
  from,
  to,
}: {
  organizationId: string;
  from: string;
  to: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(generateSeasonAction, INITIAL_GENERATE);

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
      >
        {pending ? t('calendar.generating') : t('calendar.generate')}
      </button>

      <Problem state={state} />
      {state.ok && state.result !== undefined && (
        <p className="text-sm text-foreground-muted">
          {t('calendar.generated', {
            created: state.result.created,
            cancelled: state.result.cancelled,
            restored: state.result.restored,
            holidays: state.result.holidaysAdded,
          })}
        </p>
      )}

      {/*
        The clashes, named — backlog round 4, ticket 1. Nothing was generated,
        and the operator is told which two turmas to fix rather than that a year
        of rows failed against a constraint.
      */}
      {state.clashes !== undefined && state.clashes.length > 0 && (
        <div className="flex flex-col gap-2 rounded border border-danger/40 bg-danger/10 p-4">
          <p className="font-medium text-danger">{t('calendar.clashTitle')}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {state.clashes.map((clash) => (
              <li key={`${clash.firstClass}-${clash.secondClass}-${clash.firstTime}`}>
                {t('calendar.clashRow', {
                  first: clash.firstClass,
                  second: clash.secondClass,
                  time: `${t(`week.${clash.weekday}`)} ${clash.firstTime}–${clash.secondTime}`,
                })}
              </li>
            ))}
          </ul>
          <p className="text-sm text-foreground-muted">{t('calendar.clashHint')}</p>
        </div>
      )}
    </form>
  );
}

export function ClosureForm({
  organizationId,
  pools,
}: {
  organizationId: string;
  pools: { id: string; name: string }[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createClosureAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="closure-start" className="text-sm text-foreground-muted">
            {t('calendar.startsOn')}
          </label>
          <input id="closure-start" name="startsOn" type="date" required className={field} />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="closure-end" className="text-sm text-foreground-muted">
            {t('calendar.endsOn')}
          </label>
          <input id="closure-end" name="endsOn" type="date" className={field} />
          <span className="text-xs text-foreground-muted">{t('calendar.endsOnHint')}</span>
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <label htmlFor="closure-reason" className="text-sm text-foreground-muted">
            {t('calendar.reason')}
          </label>
          <input
            id="closure-reason"
            name="reason"
            required
            maxLength={200}
            placeholder={t('calendar.reasonPlaceholder')}
            className={field}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="closure-pool" className="text-sm text-foreground-muted">
            {t('calendar.scope')}
          </label>
          <select id="closure-pool" name="poolId" defaultValue="" className={field}>
            <option value="">{t('calendar.wholeOrganization')}</option>
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="closure-effect" className="text-sm text-foreground-muted">
            {t('calendar.effect')}
          </label>
          <select
            id="closure-effect"
            name="blocksGeneration"
            defaultValue="closed"
            className={field}
          >
            <option value="closed">{t('calendar.effectClosed')}</option>
            <option value="note">{t('calendar.effectNote')}</option>
          </select>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="repeatsAnnually" className="mt-0.5" />
        <span>
          {t('calendar.repeats')}
          <span className="block text-xs text-foreground-muted">{t('calendar.repeatsHint')}</span>
        </span>
      </label>

      <Problem state={state} />

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
      >
        {pending ? t('calendar.adding') : t('calendar.addClosure')}
      </button>
    </form>
  );
}

export function RemoveClosure({
  organizationId,
  closure,
}: {
  organizationId: string;
  closure: Closure;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(removeClosureAction, INITIAL);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="closureId" value={closure.id} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm text-danger hover:underline disabled:opacity-60"
      >
        {t('calendar.remove')}
      </button>
      {state.errorKey !== undefined && (
        <span className="text-xs text-danger">{t(state.errorKey)}</span>
      )}
    </form>
  );
}

/**
 * Calls off one class. It does not put it back — backlog round 3, story 5.
 *
 * The restore control is gone, deliberately and on the operator's instruction.
 * What is *not* gone is the row: a cancelled session keeps `status = 'cancelled'`
 * rather than being deleted, because attendance history, invoicing and any later
 * "was there a class that Tuesday?" all rest on it. Nothing here offers to bring
 * it back; the record simply survives underneath.
 *
 * A class the *closure* took down is a different thing and still says so. That
 * one is undone by removing the closure, which is a real action on a real
 * screen, so the label points there rather than pretending nothing can be done.
 *
 * The label stays "Cancelar aula" rather than "Remover": a class that does not
 * happen has been cancelled, and calling it removal would suggest the evening is
 * erased from the record, which is exactly what does not happen.
 */
export function CancelSession({
  organizationId,
  sessionId,
  className,
  when,
  cancelled,
  byClosure,
}: {
  organizationId: string;
  sessionId: string;
  /** The turma's name, for the confirmation. */
  className: string;
  /** Date and time, already formatted in the reader's locale. */
  when: string;
  cancelled: boolean;
  byClosure: boolean;
}): React.ReactElement | null {
  const t = useTranslations();
  const [state, action, pending] = useActionState(cancelSessionAction, INITIAL);
  const [open, setOpen] = useState(false);

  if (byClosure) {
    return <span className="text-xs text-foreground-muted">{t('calendar.byClosure')}</span>;
  }

  // Cancelled by a person: there is nothing to offer. The slot is already struck
  // through and carries the reason, so an empty action area says everything a
  // control would have, minus the one it is no longer allowed to say.
  if (cancelled) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded text-sm text-danger hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('calendar.cancel')}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="sessionId" value={sessionId} />

      {/*
        Named, because the story asks and because it is the difference between a
        confirmation and a speed bump. Seven columns of small cards are easy to
        mis-click, and "are you sure?" cannot tell you that you are about to call
        off Thursday's class instead of Tuesday's.
      */}
      <p className="text-sm font-medium">
        {t('calendar.confirmQuestion', { name: className, when })}
      </p>

      <input
        name="reason"
        maxLength={200}
        placeholder={t('calendar.cancelReason')}
        className={`${field} text-sm`}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-danger px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
        >
          {t('calendar.confirmCancel')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-foreground-muted hover:underline"
        >
          {t('calendar.keep')}
        </button>
      </div>
      <Problem state={state} />
    </form>
  );
}

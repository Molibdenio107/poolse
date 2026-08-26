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
 * Calls off one class, or puts it back.
 *
 * A class cancelled here is cancelled by a person, and stays cancelled through
 * every regeneration — unlike one a closure took down, which comes back if the
 * closure goes. The two are told apart in the database by whether a closure id
 * is attached; nothing in this form has to know that, but the labels do differ:
 * a closure's cancellation is undone by removing the closure, not from here.
 */
export function CancelSession({
  organizationId,
  sessionId,
  cancelled,
  byClosure,
}: {
  organizationId: string;
  sessionId: string;
  cancelled: boolean;
  byClosure: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(cancelSessionAction, INITIAL);
  const [open, setOpen] = useState(false);

  if (byClosure) {
    return <span className="text-xs text-foreground-muted">{t('calendar.byClosure')}</span>;
  }

  if (cancelled) {
    return (
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="restore" value="true" />
        <button
          type="submit"
          disabled={pending}
          className="text-sm text-primary hover:underline disabled:opacity-60"
        >
          {t('calendar.restore')}
        </button>
        {state.errorKey !== undefined && (
          <span className="text-xs text-danger">{t(state.errorKey)}</span>
        )}
      </form>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-danger hover:underline"
      >
        {t('calendar.cancel')}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="sessionId" value={sessionId} />
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

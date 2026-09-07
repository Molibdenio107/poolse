'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { Feedback, type FeedbackMessage } from '@/components/feedback';
import { Dialog } from '@/components/ui/dialog';
import type { Closure } from '@/lib/api';
import type { FormState } from '../actions';
import {
  cancelSessionAction,
  restoreSessionAction,
  createClosureAction,
  generateSeasonAction,
  removeClosureAction,
  type GenerateState,
} from './calendar.actions';

const INITIAL: FormState = { ok: false };
const INITIAL_GENERATE: GenerateState = { ok: false };

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
  const [state, action, pending] = useSavedAction(generateSeasonAction, INITIAL_GENERATE);

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
  const [state, action, pending] = useSavedAction(createClosureAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className={FIELD_COLUMN}>
          <label htmlFor="closure-start" className={FIELD_LABEL}>
            {t('calendar.startsOn')}
          </label>
          <input id="closure-start" name="startsOn" type="date" required className={CONTROL_LINE} />
        </div>

        <div className={FIELD_COLUMN}>
          <label htmlFor="closure-end" className={FIELD_LABEL}>
            {t('calendar.endsOn')}
          </label>
          <input id="closure-end" name="endsOn" type="date" className={CONTROL_LINE} />
          <span className="text-xs text-foreground-muted">{t('calendar.endsOnHint')}</span>
        </div>

        <div className={`${FIELD_COLUMN} sm:col-span-2`}>
          <label htmlFor="closure-reason" className={FIELD_LABEL}>
            {t('calendar.reason')}
          </label>
          <input
            id="closure-reason"
            name="reason"
            required
            maxLength={200}
            placeholder={t('calendar.reasonPlaceholder')}
            className={CONTROL_LINE}
          />
        </div>

        <div className={FIELD_COLUMN}>
          <label htmlFor="closure-pool" className={FIELD_LABEL}>
            {t('calendar.scope')}
          </label>
          <select id="closure-pool" name="poolId" defaultValue="" className={CONTROL_LINE}>
            <option value="">{t('calendar.wholeOrganization')}</option>
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
          </select>
        </div>

        <div className={FIELD_COLUMN}>
          <label htmlFor="closure-effect" className={FIELD_LABEL}>
            {t('calendar.effect')}
          </label>
          <select
            id="closure-effect"
            name="blocksGeneration"
            defaultValue="closed"
            className={CONTROL_LINE}
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
  const [state, action, pending] = useSavedAction(removeClosureAction, INITIAL);

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
    </form>
  );
}

/**
 * What the confirmation has to be able to say — round 6, ticket 4.1.
 *
 * Data, not a rendered control. Round 5 had the page build one `CancelSession`
 * per session and hand it to the grid as a node, which is why the confirmation
 * ended up rendered inside a grid cell: the form replaced its own trigger, and
 * the trigger lived in a box a seventh of a column wide with `overflow-hidden`
 * on it.
 *
 * Now the page passes the two strings it is uniquely able to produce — the
 * turma's name and the date formatted in the reader's locale — and the board
 * owns one dialog for whichever class is being called off.
 */
export interface CancelTarget {
  sessionId: string;
  className: string;
  /** Date and time, already formatted in the reader's locale. */
  when: string;
}

/**
 * Calls off one class, and offers to put it back — round 5, ticket 9.6.
 *
 * A cancelled session keeps `status = 'cancelled'` rather than being deleted,
 * because attendance history, invoicing and any later "was there a class that
 * Tuesday?" all rest on it. The Undo in the toast restores that row; a class the
 * *closure* took down is refused, because that one is undone by removing the
 * closure, which is a real action on a real screen.
 *
 * The label stays "Cancelar aula" rather than "Remover": a class that does not
 * happen has been cancelled, and calling it removal would suggest the evening is
 * erased from the record, which is exactly what does not happen.
 *
 * **One instance, mounted by the board, not one per class** — round 6, ticket
 * 4.1. Two things follow from that and both were bugs before it. The dialog is
 * centred over the page through `Dialog`, which portals to the body, so no
 * cell's overflow or stacking context can clip it. And the toast outlives the
 * class it is about: round 5 had to keep a control rendering after its row had
 * already re-rendered as cancelled, or the Undo vanished half a second after
 * being offered.
 */
export function CancelSessionDialog({
  organizationId,
  target,
  onClose,
}: {
  organizationId: string;
  /** The class being called off, or null when nothing is being asked. */
  target: CancelTarget | null;
  onClose: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(cancelSessionAction, INITIAL);
  const [restoreState, restore] = useActionState(restoreSessionAction, INITIAL);

  const [toast, setToast] = useState<FeedbackMessage | null>(null);
  const attempt = useRef(0);
  const settled = useRef<string | null>(null);

  const sessionId = target?.sessionId ?? null;

  useEffect(() => {
    // Only on the transition into success, and only once per submission: this
    // effect re-runs on every render the action causes.
    if (!state.ok || state.errorKey !== undefined) return;
    if (sessionId === null || settled.current === sessionId) return;

    settled.current = sessionId;
    onClose();
    attempt.current += 1;

    setToast({
      kind: 'success',
      text: t('calendar.cancelled'),
      attempt: attempt.current,
      action: {
        label: t('common.undo'),
        onAct: () => {
          const form = new FormData();
          form.set('organizationId', organizationId);
          form.set('sessionId', sessionId);
          startTransition(() => restore(form));
        },
      },
    });
  }, [state, sessionId, organizationId, restore, onClose, t]);

  // A refused undo is worth saying — the commonest reason is a closure, which
  // the operator can act on by removing the closure.
  useEffect(() => {
    if (restoreState.ok || restoreState.errorKey === undefined) return;
    attempt.current += 1;
    setToast({
      kind: 'error',
      text: t(restoreState.errorKey),
      attempt: attempt.current,
    });
  }, [restoreState, t]);

  return (
    <>
      <Feedback message={toast} onDismiss={() => setToast(null)} dismissLabel={t('common.close')} />

      <Dialog
        open={target !== null}
        onClose={onClose}
        title={t('calendar.cancel')}
        closeLabel={t('common.close')}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="sessionId" value={target?.sessionId ?? ''} />

          {/*
            Named, because it is the difference between a confirmation and a
            speed bump. Seven columns of small cards are easy to mis-click, and
            "are you sure?" cannot tell you that you are about to call off
            Thursday's class instead of Tuesday's.
          */}
          <p className="text-sm font-medium">
            {t('calendar.confirmQuestion', {
              name: target?.className ?? '',
              when: target?.when ?? '',
            })}
          </p>

          {/*
            The scope — POOLSE-14.

            Radios rather than two buttons, and "this occurrence" selected: the
            narrow, recoverable choice is the default, and removing a whole term
            is something somebody has to reach for. The past is never affected
            either way, which the hint says out loud because it is the question
            an operator would otherwise have to guess at.
          */}
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">{t('calendar.removeScope')}</legend>
            {(['occurrence', 'future'] as const).map((option) => (
              <label key={option} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="scope"
                  value={option}
                  defaultChecked={option === 'occurrence'}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>{t(`calendar.removalScope.${option}`)}</span>
              </label>
            ))}
            <p className="mt-1 text-sm text-foreground-muted">{t('calendar.scopeHint')}</p>
          </fieldset>

          <input
            name="reason"
            maxLength={200}
            placeholder={t('calendar.cancelReason')}
            className={CONTROL_LINE}
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
              onClick={onClose}
              className="text-sm text-foreground-muted hover:underline"
            >
              {t('calendar.keep')}
            </button>
          </div>
          <Problem state={state} />
        </form>
      </Dialog>
    </>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField, useFocusFirstError } from '@/components/ui/field';
import { TurmaPicker, type TurmaOption } from '@/components/turma-picker';
import { formatStamp } from '@/lib/date-format';
import type { Lead, TrialOption } from '@/lib/api';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import {
  bookTrialAction,
  convertLeadAction,
  dismissLeadAction,
  trialOptionsAction,
  waitlistLeadAction,
} from './leads.actions';

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center rounded border border-border px-4 text-control hover:bg-surface-muted';
const PRIMARY =
  'inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-60';

/**
 * The four answers to one request — POOLSE-69. Each opens a question in a
 * dialog and is one call; the API does the rest in one transaction.
 *
 * The turma is chosen in `TurmaPicker` (POOLSE-110): grouped by level with the
 * requested level first, searchable, each row its slots, instructor and fill.
 * A full turma is pickable for the waiting list only.
 */
export function LeadActions({
  lead,
  turmas,
}: {
  lead: Lead;
  turmas: TurmaOption[];
}): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-2">
      <PlaceDialog lead={lead} turmas={turmas} kind="convert" />
      <PlaceDialog lead={lead} turmas={turmas} kind="waitlist" />
      <TrialDialog lead={lead} turmas={turmas} />
      <DismissDialog lead={lead} />
    </div>
  );
}

/**
 * A button and the dialog it opens — 13-10-2026 sweep.
 *
 * The form, and the `useSavedAction` state behind it, live in a child that is
 * mounted only while the dialog is open. Before, the state outlived the
 * dialog: `open={open && !state.ok}` stayed false after one success, so a
 * trial that had been booked could never be moved without a reload, and a
 * reopened dialog showed the last attempt's errors and the last turma's dates.
 * Now every opening is a fresh question, and success closes it.
 */
function Question({
  label,
  primary = false,
  title,
  description,
  children,
}: {
  label: string;
  primary?: boolean;
  title: string;
  description: string;
  children: (done: () => void) => React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primary ? PRIMARY : BUTTON}>
        {label}
      </button>
      <Dialog
        open={open}
        onClose={close}
        title={title}
        description={description}
        closeLabel={t('common.close')}
      >
        {open && children(close)}
      </Dialog>
    </>
  );
}

/** Closes the question once its save has worked. */
function useCloseOnSuccess(state: FormState, done: () => void): void {
  useEffect(() => {
    if (state.ok) done();
  }, [state, done]);
}

function Buttons({
  onCancel,
  pending,
  submitLabel,
  disabled = false,
}: {
  onCancel: () => void;
  pending: boolean;
  submitLabel: string;
  disabled?: boolean;
}): React.ReactElement {
  const t = useTranslations();
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancel} className={BUTTON}>
        {t('common.cancel')}
      </button>
      <button type="submit" disabled={pending || disabled} className={PRIMARY}>
        {submitLabel}
      </button>
    </div>
  );
}

function PlaceDialog({
  lead,
  turmas,
  kind,
}: {
  lead: Lead;
  turmas: TurmaOption[];
  kind: 'convert' | 'waitlist';
}): React.ReactElement {
  const t = useTranslations();
  const name = `${lead.swimmerFirstName} ${lead.swimmerLastName}`;
  const verb = t(kind === 'convert' ? 'leads.convert' : 'leads.waitlist');
  return (
    <Question
      label={verb}
      primary={kind === 'convert'}
      title={t(kind === 'convert' ? 'leads.convertTitle' : 'leads.waitlistTitle', { name })}
      description={t(kind === 'convert' ? 'leads.convertHint' : 'leads.waitlistHint')}
    >
      {(done) => <PlaceForm lead={lead} turmas={turmas} kind={kind} verb={verb} done={done} />}
    </Question>
  );
}

function PlaceForm({
  lead,
  turmas,
  kind,
  verb,
  done,
}: {
  lead: Lead;
  turmas: TurmaOption[];
  kind: 'convert' | 'waitlist';
  verb: string;
  done: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(
    kind === 'convert' ? convertLeadAction : waitlistLeadAction,
    INITIAL,
  );
  useCloseOnSuccess(state, done);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);
  const turmaKey = state.fields?.['classGroupId'];
  // The turma the family asked for from the app, when it is still on offer (POOLSE-121).
  const requested =
    lead.requestedClassGroupId !== null && turmas.some((turma) => turma.id === lead.requestedClassGroupId)
      ? lead.requestedClassGroupId
      : '';
  const [picked, setPicked] = useState(requested);

  return (
    <form ref={formRef} action={dispatch} className="flex flex-col gap-4">
      <input type="hidden" name="leadId" value={lead.id} />
      <TurmaPicker
        name="classGroupId"
        label={t('leads.turma')}
        turmas={turmas}
        requestedLevelName={lead.levelName}
        // A full turma is a waiting list's answer and nobody else's.
        allowFull={kind === 'waitlist'}
        onChange={setPicked}
        initialValue={requested === '' ? undefined : requested}
        error={turmaKey === undefined ? undefined : t(turmaKey, state.values ?? {})}
      />
      {/*
        The student form's own refusals — a minor with no reachable guardian,
        a NIF shared with the parent. They name fields this dialog does not
        have, so they are said here in full; the fix is on the request.
      */}
      {Object.entries(state.fields ?? {})
        .filter(([field]) => field !== 'classGroupId')
        .map(([field, key]) => (
          <p key={field} role="alert" className="text-sm text-danger">
            {t(key, state.values ?? {})}
          </p>
        ))}
      <Buttons onCancel={done} pending={pending} submitLabel={verb} disabled={picked === ''} />
    </form>
  );
}

function TrialDialog({
  lead,
  turmas,
}: {
  lead: Lead;
  turmas: TurmaOption[];
}): React.ReactElement {
  const t = useTranslations();
  const name = `${lead.swimmerFirstName} ${lead.swimmerLastName}`;
  return (
    <Question
      label={t(lead.status === 'trial_booked' ? 'leads.trialMove' : 'leads.trial')}
      title={t('leads.trialTitle', { name })}
      description={t('leads.trialHint')}
    >
      {(done) => <TrialForm lead={lead} turmas={turmas} done={done} />}
    </Question>
  );
}

type Sessions =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'loaded'; options: TrialOption[] };

function TrialForm({
  lead,
  turmas,
  done,
}: {
  lead: Lead;
  turmas: TurmaOption[];
  done: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(bookTrialAction, INITIAL);
  useCloseOnSuccess(state, done);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);

  const [groupId, setGroupId] = useState('');
  // `loaded` is its own state: "not chosen yet", "loading" and "failed" are three
  // different sentences, and a null that meant all three is a grey dropdown.
  const [sessions, setSessions] = useState<Sessions>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (groupId === '') {
      setSessions({ state: 'idle' });
      return;
    }
    let live = true;
    setSessions({ state: 'loading' });
    void trialOptionsAction(groupId).then((result) => {
      if (!live) return;
      setSessions(result === null ? { state: 'failed' } : { state: 'loaded', options: result });
    });
    return () => {
      live = false;
    };
  }, [groupId, attempt]);

  const sessionKey = state.fields?.['sessionId'];

  return (
    <form ref={formRef} action={dispatch} className="flex flex-col gap-4">
      <input type="hidden" name="leadId" value={lead.id} />
      <TurmaPicker
        name="classGroupId"
        label={t('leads.turma')}
        turmas={turmas}
        requestedLevelName={lead.levelName}
        allowFull={false}
        onChange={setGroupId}
      />
      {sessions.state === 'idle' && (
        <p className="text-sm text-foreground-muted">{t('leads.trialPickTurmaFirst')}</p>
      )}
      {sessions.state === 'loading' && (
        <p className="text-sm text-foreground-muted">{t('leads.trialLoading')}</p>
      )}
      {sessions.state === 'failed' && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-danger">
          {t('leads.trialLoadFailed')}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={BUTTON}>
            {t('leads.retry')}
          </button>
        </p>
      )}
      {sessions.state === 'loaded' && sessions.options.length === 0 && (
        <p className="text-sm text-foreground-muted">{t('leads.trialNone')}</p>
      )}
      {sessions.state === 'loaded' && sessions.options.length > 0 && (
        <SelectField
          name="sessionId"
          label={t('leads.trialDate')}
          error={sessionKey === undefined ? undefined : t(sessionKey, state.values ?? {})}
          options={[
            { value: '', label: t('leads.trialPickDate') },
            ...sessions.options.map((o) => ({
              value: o.sessionId,
              label: `${formatStamp(o.startsAt)} · ${
                o.freeSeats === null
                  ? t('leads.trialUncapped')
                  : o.freeSeats === 0
                    ? t('leads.trialFullOption')
                    : t('leads.trialSeats', { count: o.freeSeats })
              }`,
            })),
          ]}
        />
      )}
      <Buttons
        onCancel={done}
        pending={pending}
        submitLabel={t('leads.trialBook')}
        disabled={sessions.state !== 'loaded' || sessions.options.length === 0}
      />
    </form>
  );
}

function DismissDialog({ lead }: { lead: Lead }): React.ReactElement {
  const t = useTranslations();
  const name = `${lead.swimmerFirstName} ${lead.swimmerLastName}`;
  return (
    <Question
      label={t('leads.dismiss')}
      title={t('leads.dismissTitle', { name })}
      description={t('leads.dismissHint')}
    >
      {(done) => <DismissForm lead={lead} done={done} />}
    </Question>
  );
}

function DismissForm({ lead, done }: { lead: Lead; done: () => void }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(dismissLeadAction, INITIAL);
  useCloseOnSuccess(state, done);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);
  const key = state.fields?.['reason'];

  return (
    <form ref={formRef} action={dispatch} className="flex flex-col gap-4">
      <input type="hidden" name="leadId" value={lead.id} />
      <TextAreaField
        name="reason"
        label={t('leads.reason')}
        maxLength={500}
        error={key === undefined ? undefined : t(key)}
      />
      <Buttons onCancel={done} pending={pending} submitLabel={t('leads.dismiss')} />
    </form>
  );
}

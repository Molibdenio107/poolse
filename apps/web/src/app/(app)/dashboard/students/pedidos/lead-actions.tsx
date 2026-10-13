'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField, useFocusFirstError } from '@/components/ui/field';
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

export interface TurmaChoice {
  id: string;
  name: string;
  levelName: string | null;
  capacity: number | null;
  active: number;
}

const BUTTON =
  'inline-flex h-control items-center justify-center rounded border border-border px-4 text-control hover:bg-surface-muted';
const PRIMARY =
  'inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-60';

/**
 * The four answers to one request — POOLSE-69. Each opens a question in a
 * dialog and is one call; the API does the rest in one transaction.
 *
 * The turma list puts the requested level's turmas first, because that is the
 * answer reception is usually about to give, and says how full each is in
 * words so "why not this one" is on the screen.
 */
export function LeadActions({
  lead,
  turmas,
}: {
  lead: Lead;
  turmas: TurmaChoice[];
}): React.ReactElement {
  const t = useTranslations();
  const ordered = [...turmas].sort((a, b) => {
    const wantA = lead.levelName !== null && a.levelName === lead.levelName ? 0 : 1;
    const wantB = lead.levelName !== null && b.levelName === lead.levelName ? 0 : 1;
    return wantA - wantB || a.name.localeCompare(b.name);
  });
  const options = [
    { value: '', label: t('leads.pickTurma') },
    ...ordered.map((g) => ({
      value: g.id,
      label: [
        g.name,
        g.levelName,
        g.capacity === null
          ? t('leads.turmaUncapped', { active: g.active })
          : t('leads.turmaFill', { active: g.active, capacity: g.capacity }),
      ]
        .filter(Boolean)
        .join(' · '),
    })),
  ];

  return (
    <div className="flex flex-wrap gap-2">
      <PlaceDialog lead={lead} options={options} kind="convert" />
      <PlaceDialog lead={lead} options={options} kind="waitlist" />
      <TrialDialog lead={lead} options={options} />
      <DismissDialog lead={lead} />
    </div>
  );
}

function PlaceDialog({
  lead,
  options,
  kind,
}: {
  lead: Lead;
  options: { value: string; label: string }[];
  kind: 'convert' | 'waitlist';
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, dispatch, pending] = useSavedAction(
    kind === 'convert' ? convertLeadAction : waitlistLeadAction,
    INITIAL,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);
  const fieldError = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key, state.values ?? {});
  };
  const name = `${lead.swimmerFirstName} ${lead.swimmerLastName}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={kind === 'convert' ? PRIMARY : BUTTON}>
        {t(kind === 'convert' ? 'leads.convert' : 'leads.waitlist')}
      </button>
      <Dialog
        open={open && !state.ok}
        onClose={() => setOpen(false)}
        title={t(kind === 'convert' ? 'leads.convertTitle' : 'leads.waitlistTitle', { name })}
        description={t(kind === 'convert' ? 'leads.convertHint' : 'leads.waitlistHint')}
        closeLabel={t('common.close')}
      >
        <form ref={formRef} action={dispatch} className="flex flex-col gap-4">
          <input type="hidden" name="leadId" value={lead.id} />
          <SelectField
            name="classGroupId"
            label={t('leads.turma')}
            options={options}
            error={fieldError('classGroupId')}
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
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={BUTTON}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={pending} className={PRIMARY}>
              {t(kind === 'convert' ? 'leads.convert' : 'leads.waitlist')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function TrialDialog({
  lead,
  options,
}: {
  lead: Lead;
  options: { value: string; label: string }[];
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, dispatch, pending] = useSavedAction(bookTrialAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);

  const [groupId, setGroupId] = useState('');
  // `loaded` is its own state: "not chosen yet", "loading" and "failed" are three
  // different sentences, and a null that meant all three is a grey dropdown.
  const [sessions, setSessions] = useState<
    { state: 'idle' } | { state: 'loading' } | { state: 'failed' } | { state: 'loaded'; options: TrialOption[] }
  >({ state: 'idle' });
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

  const fieldError = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key, state.values ?? {});
  };
  const name = `${lead.swimmerFirstName} ${lead.swimmerLastName}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON}>
        {t(lead.status === 'trial_booked' ? 'leads.trialMove' : 'leads.trial')}
      </button>
      <Dialog
        open={open && !state.ok}
        onClose={() => setOpen(false)}
        title={t('leads.trialTitle', { name })}
        description={t('leads.trialHint')}
        closeLabel={t('common.close')}
      >
        <form ref={formRef} action={dispatch} className="flex flex-col gap-4">
          <input type="hidden" name="leadId" value={lead.id} />
          <SelectField
            name="classGroupId"
            label={t('leads.turma')}
            options={options}
            onValueChange={setGroupId}
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
              error={fieldError('sessionId')}
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
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={BUTTON}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending || sessions.state !== 'loaded' || sessions.options.length === 0}
              className={PRIMARY}
            >
              {t('leads.trialBook')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function DismissDialog({ lead }: { lead: Lead }): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, dispatch, pending] = useSavedAction(dismissLeadAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state.fields, state);
  const key = state.fields?.['reason'];
  const name = `${lead.swimmerFirstName} ${lead.swimmerLastName}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON}>
        {t('leads.dismiss')}
      </button>
      <Dialog
        open={open && !state.ok}
        onClose={() => setOpen(false)}
        title={t('leads.dismissTitle', { name })}
        description={t('leads.dismissHint')}
        closeLabel={t('common.close')}
      >
        <form ref={formRef} action={dispatch} className="flex flex-col gap-4">
          <input type="hidden" name="leadId" value={lead.id} />
          <TextAreaField
            name="reason"
            label={t('leads.reason')}
            maxLength={500}
            error={key === undefined ? undefined : t(key)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={BUTTON}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={pending} className={PRIMARY}>
              {t('leads.dismiss')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

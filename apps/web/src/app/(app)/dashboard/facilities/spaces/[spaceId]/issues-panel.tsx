'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertCircle, Check, Plus, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import type { Issue } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { SelectField, TextAreaField } from '@/components/ui/field';
import type { FormState } from '../../../actions';
import { archiveIssue, reportIssue, resolveIssue } from '../../[facilityId]/spaces.actions';

/**
 * What is broken here, and what was.
 *
 * **Open first, resolved collapsed below.** A space with three open faults and
 * ninety resolved ones must not make somebody scroll past the ninety; and the
 * ninety must still be there, because "was this fixed before?" is the second
 * question anybody asks.
 *
 * **Reporting and resolving are different permissions.** Any management login
 * may report — the instructor who finds the shower cold is the person who knows
 * — and only owner, admin or maintenance may close one. Reporting is noticing;
 * resolving is a judgement that the work was done. The buttons follow what the
 * API sent, and the API checks again regardless.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center gap-1.5 rounded border border-border-strong px-3 text-sm ' +
  'transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

const ICON_BUTTON =
  'inline-flex items-center gap-1 rounded p-1 text-foreground-muted transition-colors ' +
  'hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-primary';

function IssueRow({
  issue,
  spaceId,
  facilityId,
  canResolve,
  canManage,
}: {
  issue: Issue;
  spaceId: string;
  facilityId: string;
  canResolve: boolean;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const format = useFormatter();
  const [resolving, setResolving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [working, setWorking] = useState(false);

  const [state, dispatch, pending] = useSavedAction<FormState, FormData>(
    resolveIssue.bind(null, spaceId, facilityId, issue.id),
    INITIAL,
  );

  if (state.ok && resolving) setResolving(false);

  const reportedAt = new Date(issue.reportedAt);

  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/*
            The type as a word, with the icon only on an open one. A chip that
            said "Avaria" in red on a resolved issue would keep a fixed pump
            looking like a live problem.
          */}
          <span className="inline-flex items-center gap-1 text-sm font-medium">
            {issue.status === 'open' && (
              <AlertCircle className="size-4 text-danger" aria-hidden="true" />
            )}
            {t(`spaces.issueType.${issue.type}`)}
          </span>

          <span className="rounded bg-foreground/5 px-1.5 py-0.5 text-xs text-foreground-muted">
            {t(`spaces.status.${issue.status}`)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {issue.status === 'open' && canResolve && (
            <button type="button" onClick={() => setResolving(true)} className={BUTTON}>
              <Check className="size-4" aria-hidden="true" />
              {t('spaces.resolve')}
            </button>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => setRemoving(true)}
              className={ICON_BUTTON}
              aria-label={t('spaces.deleteIssue')}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <p className="text-sm">{issue.description}</p>

      <p className="text-sm text-foreground-muted">
        {t('spaces.reportedBy', {
          name: issue.reportedBy ?? t('spaces.someone'),
          date: format.dateTime(reportedAt, { day: 'numeric', month: 'long', year: 'numeric' }),
        })}
      </p>

      {issue.status === 'resolved' && issue.resolvedAt !== null && (
        <p className="text-sm text-foreground-muted">
          {t('spaces.resolvedBy', {
            name: issue.resolvedBy ?? t('spaces.someone'),
            date: format.dateTime(new Date(issue.resolvedAt), {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })}
          {issue.resolutionNote === null ? '' : ` — ${issue.resolutionNote}`}
        </p>
      )}

      <Dialog
        open={resolving}
        onClose={() => setResolving(false)}
        title={t('spaces.resolve')}
        description={issue.description}
        closeLabel={t('common.close')}
      >
        <form action={dispatch} className="flex flex-col gap-4">
          <TextAreaField
            name="note"
            label={t('spaces.resolutionNote')}
            rows={2}
            hint={t('spaces.resolutionNoteHint')}
          />

          {state.errorKey !== undefined && (
            <p className="text-sm text-danger">{t(state.errorKey)}</p>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className={BUTTON}>
              {pending ? t('common.working') : t('spaces.resolve')}
            </button>
            <button type="button" onClick={() => setResolving(false)} className={BUTTON}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={removing}
        onClose={() => setRemoving(false)}
        title={t('spaces.deleteIssue')}
        description={issue.description}
        closeLabel={t('common.close')}
      >
        <p className="text-sm">{t('spaces.confirmDeleteIssue')}</p>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={working}
            onClick={() => {
              setWorking(true);
              void archiveIssue(spaceId, facilityId, issue.id).then(() => {
                setWorking(false);
                setRemoving(false);
              });
            }}
            className={BUTTON}
          >
            {working ? t('common.working') : t('common.remove')}
          </button>
          <button type="button" onClick={() => setRemoving(false)} className={BUTTON}>
            {t('common.cancel')}
          </button>
        </div>
      </Dialog>
    </li>
  );
}

export function IssuesPanel({
  spaceId,
  facilityId,
  issues,
  canLog,
  canResolve,
  canManage,
}: {
  spaceId: string;
  facilityId: string;
  issues: Issue[];
  canLog: boolean;
  canResolve: boolean;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [reporting, setReporting] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const [state, dispatch, pending] = useSavedAction<FormState, FormData>(
    reportIssue.bind(null, spaceId, facilityId),
    INITIAL,
  );

  if (state.ok && reporting) setReporting(false);

  const open = issues.filter((issue) => issue.status === 'open');
  const resolved = issues.filter((issue) => issue.status === 'resolved');

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('spaces.issues')}
        </h2>

        {canLog && (
          <button type="button" onClick={() => setReporting(true)} className={BUTTON}>
            <Plus className="size-4" aria-hidden="true" />
            {t('spaces.report')}
          </button>
        )}
      </div>

      {open.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('spaces.noOpenIssues')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {open.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              spaceId={spaceId}
              facilityId={facilityId}
              canResolve={canResolve}
              canManage={canManage}
            />
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setShowResolved((shown) => !shown)}
            aria-expanded={showResolved}
            className="self-start rounded text-sm text-foreground-muted underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {showResolved
              ? t('spaces.hideResolved')
              : t('spaces.showResolved', { count: resolved.length })}
          </button>

          {showResolved && (
            <ul className="flex flex-col divide-y divide-border">
              {resolved.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  spaceId={spaceId}
                  facilityId={facilityId}
                  canResolve={canResolve}
                  canManage={canManage}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog
        open={reporting}
        onClose={() => setReporting(false)}
        title={t('spaces.report')}
        closeLabel={t('common.close')}
      >
        <form action={dispatch} className="flex flex-col gap-4">
          <SelectField
            name="type"
            label={t('spaces.issueTypeLabel')}
            initial="fault"
            options={[
              { value: 'fault', label: t('spaces.issueType.fault') },
              { value: 'restock', label: t('spaces.issueType.restock') },
            ]}
            {...(state.fields?.type === undefined ? {} : { error: t(state.fields.type) })}
          />

          <TextAreaField
            name="description"
            label={t('spaces.issueDescription')}
            rows={3}
            required
            {...(state.fields?.description === undefined
              ? {}
              : { error: t(state.fields.description) })}
          />

          {state.errorKey !== undefined && (
            <p className="text-sm text-danger">{t(state.errorKey)}</p>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className={BUTTON}>
              {pending ? t('common.working') : t('spaces.report')}
            </button>
            <button type="button" onClick={() => setReporting(false)} className={BUTTON}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

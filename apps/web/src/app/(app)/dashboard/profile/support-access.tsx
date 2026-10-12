'use client';

import { useTranslations } from 'next-intl';
import { Headset } from 'lucide-react';
import { SelectField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import { formatDate, formatStamp, formatTime } from '@/lib/date-format';
import type { SupportActivity, SupportGrant, SupportRequest } from '@/lib/api';
import type { FormState } from '../actions';
import {
  answerSupportRequestAction,
  openSupportWindowAction,
  revokeSupportWindowAction,
} from '../support.actions';

const INITIAL: FormState = { ok: false };

const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const SECONDARY =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border bg-surface px-4 text-control font-medium hover:border-primary/50 hover:text-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Acesso de suporte — POOLSE-79, under *O meu perfil*. Owner only: the club's
 * decision about its own data. The API refuses everybody else, and this tab is
 * not offered to them.
 *
 * Four things on one card, in the order somebody needs them: what Poolse has
 * asked, whether a window is open, what support did, and every window there
 * has been.
 */
export function SupportAccess({
  grants,
  requests,
  activity,
}: {
  grants: SupportGrant[];
  requests: SupportRequest[];
  activity: SupportActivity[];
}): React.ReactElement {
  const t = useTranslations();
  const live = grants.find((grant) => grant.state === 'live') ?? null;
  const durations = [
    { value: '24', label: t('support.hours24') },
    { value: '72', label: t('support.hours72') },
    { value: '168', label: t('support.hours168') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
        <div className="flex items-start gap-2">
          <Headset aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
          <div>
            <h2 className="text-sm font-medium">{t('support.title')}</h2>
            <p className="text-sm text-foreground-muted">{t('support.explain')}</p>
          </div>
        </div>

        {requests.map((request) => (
          <RequestAnswer key={request.id} request={request} durations={durations} />
        ))}

        {live !== null ? <LiveWindow grant={live} /> : <OpenWindow durations={durations} />}
      </section>

      <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">{t('support.activityTitle')}</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('support.activityEmpty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {activity.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="text-foreground-muted">{formatStamp(entry.at)}</span>
                <span>{entry.byName}</span>
                {/* The log's own machine key — data, not interface text. */}
                <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{entry.action}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">{t('support.historyTitle')}</h2>
        {grants.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('support.historyEmpty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {grants.map((grant) => (
              <li key={grant.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <p className="font-medium">
                  {t(`support.source.${grant.source}`)}
                  <span className="font-normal text-foreground-muted">
                    {' · '}
                    {t(`support.state.${grant.state}`)}
                  </span>
                </p>
                <p className="text-foreground-muted">
                  {t('support.window', {
                    from: formatStamp(grant.startsAt),
                    to: formatStamp(grant.endedAt ?? grant.expiresAt),
                  })}
                  {grant.grantedByName !== null &&
                    ` · ${t('support.grantedBy', { name: grant.grantedByName })}`}
                </p>
                {grant.reason !== null && <p>{t('support.reason', { reason: grant.reason })}</p>}
                {grant.notice !== null && (
                  <p className="text-foreground-muted">
                    {grant.notice.delivered ? t('support.noticeSent') : t('support.noticeRecorded')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OpenWindow({ durations }: { durations: { value: string; label: string }[] }) {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(openSupportWindowAction, INITIAL);
  return (
    <form action={dispatch} className="flex flex-wrap items-end gap-3">
      <SelectField
        name="hours"
        label={t('support.duration')}
        initial="24"
        options={durations}
        error={state.fields?.['hours']}
      />
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t('common.working') : t('support.open')}
      </button>
    </form>
  );
}

function LiveWindow({ grant }: { grant: SupportGrant }) {
  const t = useTranslations();
  const [, dispatch, pending] = useSavedAction(
    revokeSupportWindowAction.bind(null, grant.id),
    INITIAL,
  );
  return (
    <form action={dispatch} className="flex flex-wrap items-center gap-3">
      <p className="min-w-0 flex-1 text-sm">
        {t('support.liveUntil', { time: formatTime(grant.expiresAt), date: formatDate(grant.expiresAt) })}
      </p>
      <button type="submit" disabled={pending} className={SECONDARY}>
        {pending ? t('common.working') : t('support.revoke')}
      </button>
    </form>
  );
}

function RequestAnswer({
  request,
  durations,
}: {
  request: SupportRequest;
  durations: { value: string; label: string }[];
}) {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(
    answerSupportRequestAction.bind(null, request.id),
    INITIAL,
  );
  return (
    <form
      action={dispatch}
      className="flex flex-col gap-3 rounded border border-primary/40 p-4"
    >
      <p className="text-sm font-medium">
        {t('support.askedOn', { date: formatStamp(request.requestedAt) })}
      </p>
      <p className="text-sm">{t('support.reason', { reason: request.reason })}</p>
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          name="hours"
          label={t('support.duration')}
          initial="24"
          options={durations}
          error={state.fields?.['hours']}
        />
        <button type="submit" name="answer" value="approve" disabled={pending} className={PRIMARY}>
          {t('support.approve')}
        </button>
        <button type="submit" name="answer" value="decline" disabled={pending} className={SECONDARY}>
          {t('support.decline')}
        </button>
      </div>
    </form>
  );
}

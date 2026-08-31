'use client';

import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import type { ActiveSession } from '@/lib/api';
import { revokeSessionAction, type FormState } from './actions';

const INITIAL: FormState = { ok: false };

/**
 * "End this session" — one form per row, so revoking one does not grey out the
 * others while it runs.
 */
function EndSession({ sessionId }: { sessionId: string }): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(revokeSessionAction, INITIAL);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger disabled:opacity-60"
      >
        {pending ? t('common.working') : t('sessions.end')}
      </button>
      {state.errorKey !== undefined && (
        <span className="text-sm text-danger">{t(state.errorKey)}</span>
      )}
    </form>
  );
}

/**
 * Where this account is signed in.
 *
 * Clerk exposes no device, browser or IP for a session — only when it started
 * and when it was last used. So this says exactly that and no more. A row
 * labelled "Chrome on Windows" would be an invention, and the whole point of the
 * screen is that somebody can trust what it tells them about their own account.
 *
 * The current session is marked and cannot be ended from here: a button that
 * signs you out while you are reading the page is a trap, and the sign-out
 * control in the corner already does that deliberately.
 */
export function Sessions({
  sessions,
  formatted,
}: {
  sessions: ActiveSession[];
  /** Dates rendered on the server, so the list does not depend on the client clock. */
  formatted: { id: string; started: string; lastActive: string }[];
}): React.ReactElement {
  const t = useTranslations();
  const dates = new Map(formatted.map((entry) => [entry.id, entry]));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground-muted">{t('sessions.explain')}</p>

      <ul className="flex flex-col divide-y divide-border">
        {sessions.map((session) => {
          const when = dates.get(session.id);
          return (
            <li
              key={session.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-col">
                <span>
                  {session.isCurrent ? t('sessions.thisDevice') : t('sessions.otherDevice')}
                </span>
                <span className="text-sm text-foreground-muted">
                  {t('sessions.timing', {
                    started: when?.started ?? '—',
                    lastActive: when?.lastActive ?? '—',
                  })}
                </span>
              </div>
              {session.isCurrent ? (
                <span className="rounded bg-primary/15 px-2 py-0.5 text-sm text-primary">
                  {t('sessions.current')}
                </span>
              ) : (
                <EndSession sessionId={session.id} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

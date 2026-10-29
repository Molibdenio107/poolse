'use client';

import { useSavedAction } from '@/lib/saved';
import Link from 'next/link';
import { SignOutButton } from '@clerk/nextjs';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { acceptAction, type FormState } from '../dashboard/actions';
import type { AcceptResult } from '../../../lib/api';

type AcceptFormState = FormState & { result?: AcceptResult };

const INITIAL: AcceptFormState = { ok: false };

/** Where Clerk sends the person once they have an account: back to this invitation. */
function accountHref(kind: 'sign-up' | 'sign-in', token: string, invitedEmail: string | null): string {
  const query = new URLSearchParams({ redirect_url: `/join?token=${encodeURIComponent(token)}` });
  if (kind === 'sign-up' && invitedEmail !== null) query.set('email', invitedEmail);
  return `/${kind}?${query.toString()}`;
}

/**
 * The one button in the whole flow that changes what someone can see.
 *
 * The outcome is rendered from the status the API returns, not from whether the
 * request threw — "this link has already been used" and "this link expired" are
 * ordinary answers, and each needs its own sentence in the reader's language.
 *
 * Signed out, the button is two links: make an account, or sign in, both of
 * which return here with the token — the page is public since 29-10-2026 and
 * this is where the account becomes necessary. After accepting, the way in is
 * `/app`, which routes by role, so a student lands on the family agenda and an
 * owner on the backoffice; `/dashboard` would refuse a family-only reader.
 */
export function AcceptForm({
  token,
  organizationName,
  signedIn,
  invitedEmail,
  signedInAs = null,
}: {
  token: string;
  organizationName: string;
  signedIn: boolean;
  invitedEmail: string | null;
  /** The signed-in account's address, to notice an invitation meant for somebody else. */
  signedInAs?: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(acceptAction, INITIAL);

  if (state.result?.status === 'accepted') {
    return (
      <div className="flex flex-col gap-3 rounded border border-success/40 bg-success/10 p-5">
        <p className="font-medium text-success">
          {t('join.accepted', { organization: state.result.organizationName ?? organizationName })}
        </p>
        <Link href="/app" className="text-primary hover:underline">
          {t('join.enter')}
        </Link>
      </div>
    );
  }

  if (!signedIn) {
    const button =
      'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded';
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground-muted">{t('join.accountNeeded')}</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={accountHref('sign-up', token, invitedEmail)}
            className={`${button} bg-primary text-primary-foreground`}
          >
            {t('auth.signUp')}
          </Link>
          <Link
            href={accountHref('sign-in', token, invitedEmail)}
            className={`${button} border border-border bg-surface text-foreground`}
          >
            {t('auth.signIn')}
          </Link>
        </div>
      </div>
    );
  }

  /*
   * Signed in as somebody else (Rui, 29-10-2026): accepting would add the roles
   * to *this* account — an owner opening a student's link on their own phone
   * became a student. The usual answer is to sign out and come back to the same
   * link, so that is the main button; joining with this account stays possible,
   * for a parent who wants their own login to hold the child's invitation.
   */
  const mismatch =
    invitedEmail !== null && signedInAs !== null && invitedEmail.toLowerCase() !== signedInAs.toLowerCase();
  const BUTTON = 'inline-flex min-h-control items-center justify-center px-4 text-control gap-2 rounded';

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {mismatch ? (
        <div className="flex flex-col gap-3 rounded border border-warning/50 bg-warning/10 p-4">
          <p className="flex items-start gap-2 text-sm">
            <AlertTriangle aria-hidden className="attention mt-0.5 size-4 shrink-0 text-warning" />
            <span>{t('join.mismatch', { invited: invitedEmail, current: signedInAs })}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <SignOutButton redirectUrl={`/join?token=${encodeURIComponent(token)}`}>
              <button type="button" className={`${BUTTON} bg-primary text-primary-foreground`}>
                {t('join.signOutAndContinue')}
              </button>
            </SignOutButton>
            <button
              type="submit"
              disabled={pending}
              className={`${BUTTON} border border-border bg-surface text-foreground disabled:opacity-60`}
            >
              {pending ? t('common.working') : t('join.acceptAnyway', { current: signedInAs })}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="submit"
            disabled={pending}
            className={`${BUTTON} bg-primary text-primary-foreground disabled:opacity-60`}
          >
            {pending ? t('common.working') : t('join.accept')}
          </button>
        </div>
      )}

      {/* Narrowed by the early return above: anything left here is a refusal. */}
      {state.result !== undefined && (
        <p className="text-sm text-danger">{t(`join.status.${state.result.status}`)}</p>
      )}

      {state.errorKey !== undefined && (
        <p className="text-sm text-danger">
          {t(state.errorKey)}
          {state.detail !== undefined && (
            <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
          )}
        </p>
      )}
    </form>
  );
}

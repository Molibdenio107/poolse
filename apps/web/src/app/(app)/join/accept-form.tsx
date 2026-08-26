'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { acceptAction, type FormState } from '../dashboard/actions';
import type { AcceptResult } from '../../../lib/api';

type AcceptFormState = FormState & { result?: AcceptResult };

const INITIAL: AcceptFormState = { ok: false };

/**
 * The one button in the whole flow that changes what someone can see.
 *
 * The outcome is rendered from the status the API returns, not from whether the
 * request threw — "this link has already been used" and "this link expired" are
 * ordinary answers, and each needs its own sentence in the reader's language.
 */
export function AcceptForm({
  token,
  organizationName,
}: {
  token: string;
  organizationName: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(acceptAction, INITIAL);

  if (state.result?.status === 'accepted') {
    return (
      <div className="flex flex-col gap-3 rounded border border-success/40 bg-success/10 p-5">
        <p className="font-medium text-success">
          {t('join.accepted', { organization: state.result.organizationName ?? organizationName })}
        </p>
        <Link href="/dashboard" className="text-primary hover:underline">
          {t('auth.dashboard')}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
        >
          {pending ? t('common.working') : t('join.accept')}
        </button>
      </div>

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

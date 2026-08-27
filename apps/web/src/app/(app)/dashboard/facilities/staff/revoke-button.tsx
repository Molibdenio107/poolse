'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { revokeAction, type FormState } from '../../actions';

const INITIAL: FormState = { ok: false };

/**
 * One form per pending invitation, so each row has its own pending state and
 * revoking one does not grey out the rest.
 */
export function RevokeButton({
  organizationId,
  invitationId,
}: {
  organizationId: string;
  invitationId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(revokeAction, INITIAL);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:border-danger/50 hover:text-danger disabled:opacity-60"
      >
        {pending ? t('common.working') : t('invite.revoke')}
      </button>
      {state.errorKey !== undefined && (
        <span className="text-sm text-danger">{t(state.errorKey)}</span>
      )}
    </form>
  );
}

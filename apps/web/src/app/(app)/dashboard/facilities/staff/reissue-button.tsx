'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { reissueAction, type InviteState } from '../../actions';
import { InvitationLink } from './invitation-link';

const INITIAL: InviteState = { ok: false };

/**
 * The way out of the dead end.
 *
 * An invitation link is shown once and only its hash is stored, so somebody who
 * closed the tab before copying had no route forward that the interface
 * mentioned — they had to work out for themselves that revoking and re-inviting
 * produced the same result. This is that, in one click, and it withdraws the old
 * token on the server so a link someone mislaid stops working.
 */
export function ReissueButton({
  organizationId,
  invitationId,
}: {
  organizationId: string;
  invitationId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useActionState(reissueAction, INITIAL);

  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="invitationId" value={invitationId} />
        <button
          type="submit"
          disabled={pending}
          title={t('invite.reissueHint')}
          className="rounded border border-border px-2 py-1 text-sm text-foreground-muted hover:border-primary/50 hover:text-primary disabled:opacity-60"
        >
          {pending ? t('common.working') : t('invite.reissue')}
        </button>
        {state.errorKey !== undefined && (
          <span className="text-sm text-danger">{t(state.errorKey)}</span>
        )}
      </form>

      {state.invitation !== undefined && (
        <InvitationLink invitation={state.invitation} tone="neutral" />
      )}
    </div>
  );
}

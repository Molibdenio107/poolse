'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import type { CreatedInvitation } from '@/lib/api';
import { ConfirmButton } from '@/components/confirm-action';
import { reissueAction, type InviteState } from '../../actions';
import { InvitationLink } from './invitation-link';

const INITIAL: InviteState = { ok: false };

/*
 * Where a reissued link is shown (Rui, 10-11-2026). A reissue replaces the
 * invitation with a new row, so the list redraws without the old one, and the
 * button that held the link went with it: Reenviar looked like it did nothing.
 * The link now lives above the list, in a dialog that outlasts the redraw.
 */
const ShowLink = createContext<(invitation: CreatedInvitation) => void>(() => undefined);

export function ReissuedLinks({ children }: { children: React.ReactNode }): React.ReactElement {
  const t = useTranslations();
  const [shown, setShown] = useState<CreatedInvitation | null>(null);
  return (
    <ShowLink.Provider value={setShown}>
      {children}
      <Dialog
        open={shown !== null}
        onClose={() => setShown(null)}
        title={t('invite.reissuedTitle')}
        closeLabel={t('common.close')}
        className="max-w-lg"
      >
        {shown !== null && <InvitationLink invitation={shown} tone="neutral" />}
      </Dialog>
    </ShowLink.Provider>
  );
}

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
  const [state, action, pending] = useSavedAction(reissueAction, INITIAL);
  const showLink = useContext(ShowLink);
  useEffect(() => {
    if (state.invitation !== undefined) showLink(state.invitation);
  }, [state.invitation, showLink]);

  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="invitationId" value={invitationId} />
        {/* Asks first (Rui, 04-11-2026); the question says what the hint did. */}
        <ConfirmButton
          title={t('confirm.equipa.reissueTitle')}
          message={t('confirm.equipa.reissueMessage')}
          confirmLabel={t('invite.reissue')}
          disabled={pending}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded-sm text-foreground-muted hover:border-primary/50 hover:text-primary disabled:opacity-60 bg-surface shadow-card"
        >
          {pending ? t('common.working') : t('invite.reissue')}
        </ConfirmButton>
      </form>
    </div>
  );
}

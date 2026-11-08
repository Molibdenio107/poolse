'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { QrCode } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { InviteToClub, type ClubInvite } from '@/components/invite-to-club';

/**
 * Somebody at the pool asks how to join (Rui, 07-11-2026): a small icon beside
 * *Alunos* opens the club's pre-registration page as a QR, to show, share or
 * send. The person sends the request from their own phone to the secretaria's
 * queue; the teacher creates nobody.
 */
export function JoinQr({ invite }: { invite: ClubInvite }): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('app.teaching.joinTitle')}
        className="inline-flex size-10 items-center justify-center rounded-sm bg-surface text-primary shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <QrCode className="size-5" aria-hidden />
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('app.teaching.joinTitle')}
        closeLabel={t('common.close')}
        placement="sheet"
      >
        <InviteToClub invite={invite} />
      </Dialog>
    </>
  );
}

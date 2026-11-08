import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { LinkBusy } from '@/components/link-busy';
import { InviteToClub } from '@/components/invite-to-club';
import { clubInvite } from '@/lib/club-invite';

/**
 * *Convidar amigos* (Rui, 07-11-2026): a student or a family invites a friend to
 * the club, not to Poolse. The club's pre-registration page as a QR, to share or
 * send; whatever the friend sends reaches the secretaria. Only while the club has
 * pre-registration open; otherwise back to *Perfil*.
 */
export default async function InviteFriends(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const invite = await clubInvite((club) => t('invite.friendMessage', { club }));
  if (invite === null) redirect('/app/perfil?home=family');

  return (
    <>
      <Link
        href="/app/perfil?home=family"
        aria-label={t('app.profile.backTo')}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
        <LinkBusy />
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{t('invite.friendsTitle')}</h1>
      <InviteToClub invite={invite} />
    </>
  );
}

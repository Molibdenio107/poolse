import 'server-only';
import QRCode from 'qrcode';
import { apiFetch, type Me } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { appOrigin } from '@/lib/public-water-link';
import type { ClubInvite } from '@/components/invite-to-club';

/**
 * The club's pre-registration page as an invitation (Rui, 07-11-2026): the address,
 * its QR drawn here so the browser carries no encoder, and the words to send with
 * it. Null while the club has pre-registration closed, and then nothing is offered.
 */
export async function clubInvite(
  message: (club: string) => string,
): Promise<ClubInvite | null> {
  const [link, me] = await Promise.all([
    outcome(apiFetch<{ slug: string | null }>('/app/join-link')),
    outcome(apiFetch<Me>('/me')),
  ]);
  if (link.state !== 'ok' || link.data.slug === null) return null;
  const club = me.state === 'ok' ? (me.data.memberships[0]?.organizationName ?? '') : '';
  const url = `${await appOrigin()}/inscricao/${link.data.slug}`;
  const png = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 512 });
  return { url, png, message: message(club) };
}

import { redirect } from 'next/navigation';
import { apiFetch, type Me } from '@/lib/api';
import { hatsOf } from '@/lib/app-hats';
import { readShell } from '@/lib/shell';
import { SuspendedNotice } from '../dashboard/suspended-notice';
import { AppFrame } from './app-frame';

/**
 * App mode's shell — POOLSE-90; its frame since POOLSE-136 (`app-frame.tsx`).
 *
 * The people who come to the pool rather than run it get a home built around
 * one question each, and this is its frame: no sidebar and no backoffice menu,
 * the club's name, the switcher between the reader's homes, and — for staff who
 * are also parents — a way back to the backoffice. It is the same Next.js app
 * and the same installed PWA; `data-surface="app"` points the shared tokens at
 * the mobile palette (globals.css), so nothing below is restyled by hand.
 *
 * Width-responsive: a guardian on a laptop sees the same app, centred.
 */
export default async function AppModeLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  let me: Me;
  try {
    me = await apiFetch<Me>('/me');
  } catch {
    // Signed out or the API is away: the backoffice shell knows how to say both.
    redirect('/dashboard');
  }
  const membership = me.memberships[0];
  if (membership === undefined) redirect('/dashboard');

  if (membership.suspendedAt !== null) {
    return (
      <SuspendedNotice
        organizationName={membership.organizationName}
        reason={membership.suspensionReason}
        suspendedAt={membership.suspendedAt}
      />
    );
  }

  const hats = hatsOf(membership.roles);

  return (
    <AppFrame
      organizationName={membership.organizationName}
      logoFileId={(await readShell()).logoFileId}
      homes={hats.homes}
    >
      {children}
    </AppFrame>
  );
}

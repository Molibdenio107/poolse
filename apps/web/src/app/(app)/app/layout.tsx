import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch, type Me } from '@/lib/api';
import { hatsOf } from '@/lib/app-hats';
import { PreferenceControls } from '../preference-controls';
import { UserMenu } from '../user-menu';
import { SuspendedNotice } from '../dashboard/suspended-notice';
import { AppSwitcher } from './app-switcher';

/**
 * App mode's shell — POOLSE-90.
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
  const t = await getTranslations();

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
    <div data-surface="app" className="flex min-h-dvh flex-col bg-background pl-safe-left pr-safe-right">
      <header className="sticky top-0 z-20 border-b border-border bg-surface pt-safe-top">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4">
          <span className="min-w-0 truncate text-sm font-semibold">{membership.organizationName}</span>
          <div className="flex items-center gap-3">
            <PreferenceControls />
            <UserMenu />
          </div>
        </div>
        {(hats.homes.length > 1 || hats.staff) && (
          <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 px-4 pb-2">
            <AppSwitcher homes={hats.homes} />
            {hats.staff && (
              <Link
                href="/dashboard"
                className="ml-auto inline-flex h-control items-center justify-center rounded px-3 text-control text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('app.openBackoffice')}
                <LinkBusy />
              </Link>
            )}
          </div>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pb-[calc(1.5rem+var(--safe-bottom))] pt-4">
        {children}
      </main>
    </div>
  );
}

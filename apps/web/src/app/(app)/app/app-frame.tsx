'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LinkBusy } from '@/components/link-busy';
import { TabGlyph } from '@/components/app-tab-glyphs';
import { PersonAvatar } from '@/components/person-avatar';
import { TABS, tabFor, type AppHat } from '@/lib/app-hats';
import { cn } from '@/lib/utils';
import { AppSwitcher } from './app-switcher';

/**
 * App mode's frame — POOLSE-136. Three shapes, decided by the address:
 *
 * - **A tab screen** (a home's own tabs): a header with only the club's name, the
 *   bottom tab bar below `md` and the same tabs as a row under the header from
 *   `md` up. Layout follows width, never the pointer (CLAUDE.md, POOLSE-88).
 *   `data-shell="tabs"` turns on the phone type scale (globals.css).
 * - **A screen deeper in** (a lesson, a form): the same header, no tabs — it has
 *   its own *Voltar*, and no bar can sit over its Save bar.
 * - **The maintenance home**: the header it had (rule 10) — preferences, the
 *   avatar, the switcher and *Abrir o backoffice* — until its own phone view.
 *
 * Preferences, the avatar, the switcher, push and *Abrir o backoffice* live on
 * *Perfil* for the tabbed homes (rule 4), so the header has nothing to hide.
 */
export function AppFrame({
  organizationName,
  user,
  homes,
  staff,
  chrome,
  children,
}: {
  organizationName: string;
  /** For the photo in the header's corner, which opens *O meu perfil*. */
  user: { name: string; avatarUrl: string | null };
  homes: AppHat[];
  staff: boolean;
  /** The language, theme and avatar controls — server components, rendered by the layout. */
  chrome: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const classic = pathname.startsWith('/app/manutencao') || homes.every((hat) => hat === 'maintenance');
  // The tab screens' paths; the query only says which tab, which the bar reads itself.
  const tabbed =
    !classic &&
    ['/app/familia', '/app/familia/aulas', '/app/familia/pagamentos', '/app/aulas', '/app/perfil'].includes(
      pathname.replace(/\/$/, ''),
    );

  return (
    <div
      data-surface="app"
      data-shell={classic ? 'classic' : tabbed ? 'tabs' : 'detail'}
      className="flex min-h-dvh flex-col bg-background pl-safe-left pr-safe-right"
    >
      <header className="sticky top-0 z-20 bg-surface pt-safe-top shadow-hairline-b">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4">
          <span className="min-w-0 truncate text-sm font-semibold">{organizationName}</span>
          {classic ? (
            <div className="flex items-center gap-3">{chrome}</div>
          ) : (
            <ProfileCorner user={user} />
          )}
        </div>
        {classic && (homes.length > 1 || staff) && (
          <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 px-4 pb-2">
            <AppSwitcher homes={homes} />
            {staff && (
              <Link
                href="/dashboard"
                className="ml-auto inline-flex h-control items-center justify-center rounded-sm px-3 text-control text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('app.openBackoffice')}
                <LinkBusy />
              </Link>
            )}
          </div>
        )}
        {tabbed && (
          <Suspense fallback={null}>
            <TabBar homes={homes} placement="top" />
          </Suspense>
        )}
      </header>

      <main
        className={cn(
          'mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-4',
          // Clear of the bottom bar below `md`, and of the home bar always.
          tabbed
            ? 'pb-[calc(5.5rem+var(--safe-bottom))] md:pb-[calc(1.5rem+var(--safe-bottom))]'
            : 'pb-[calc(1.5rem+var(--safe-bottom))]',
        )}
      >
        {children}
      </main>

      {tabbed && (
        <Suspense fallback={null}>
          <TabBar homes={homes} placement="bottom" />
        </Suspense>
      )}
    </div>
  );
}

/**
 * Your photograph in the header's top-right corner — Rui, 31-10-2026: one tap
 * opens *O meu perfil*, the same page as the *Perfil* tab, with the tab bar of
 * the home it was opened from.
 */
function ProfileCorner({ user }: { user: { name: string; avatarUrl: string | null } }): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const here = pathname.replace(/\/$/, '') === '/app/perfil';
  // The home it is opened from, so *Perfil*'s tab bar is that home's.
  const home = pathname.startsWith('/app/aulas') ? 'teaching' : pathname.startsWith('/app/familia') ? 'family' : null;
  return (
    <Link
      href={home === null ? '/app/perfil' : `/app/perfil?home=${home}`}
      aria-label={t('profile.title')}
      aria-current={here ? 'page' : undefined}
      className="-m-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <PersonAvatar id={user.name} name={user.name} photoUrl={user.avatarUrl} className="size-9 text-sm" />
      <LinkBusy />
    </Link>
  );
}

/**
 * The tabs themselves. Links, so they work before hydration and the back button
 * means what it says; the current one carries `aria-current="page"` and a filled
 * shape, never colour alone. The child a guardian chose (`?child=`) travels with
 * the tabs that show one child at a time.
 */
function TabBar({ homes, placement }: { homes: AppHat[]; placement: 'top' | 'bottom' }): React.ReactElement | null {
  const t = useTranslations();
  const pathname = usePathname();
  const search = useSearchParams();
  const at = tabFor(pathname, search, homes);
  if (at === null) return null;
  const child = search.get('child');

  const tabs = TABS[at.hat].map((tab, index) => {
    const keepsChild = child !== null && (tab.href === '/app/familia' || tab.href === '/app/familia/aulas');
    const href = keepsChild ? `${tab.href}?child=${encodeURIComponent(child)}` : tab.href;
    const current = index === at.index;
    return (
      <Link
        key={tab.href}
        href={href}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'flex min-h-[44px] flex-1 items-center justify-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          placement === 'bottom'
            ? 'flex-col py-1.5 text-[11px]'
            : 'h-control rounded-sm px-3 text-control',
          current
            ? placement === 'bottom'
              ? 'font-bold text-foreground [&_svg]:text-primary'
              : 'bg-surface font-semibold text-foreground shadow-card [&_svg]:text-primary'
            : 'text-foreground-muted hover:text-foreground',
        )}
      >
        <TabGlyph glyph={tab.glyph} active={current} />
        <span>{t(tab.labelKey)}</span>
        <LinkBusy />
      </Link>
    );
  });

  if (placement === 'top') {
    return (
      <nav aria-label={t('app.tabs.label')} className="mx-auto hidden w-full max-w-2xl px-4 pb-2 md:block">
        <div className="flex gap-1 rounded-sm bg-surface-muted p-1">{tabs}</div>
      </nav>
    );
  }
  return (
    <nav
      aria-label={t('app.tabs.label')}
      className="fixed inset-x-0 bottom-0 z-30 px-2 pb-[calc(0.5rem+var(--safe-bottom))] pl-[calc(0.5rem+var(--safe-left))] pr-[calc(0.5rem+var(--safe-right))] md:hidden"
      data-bottom-bar
    >
      <div className="flex rounded bg-surface shadow-card">{tabs}</div>
    </nav>
  );
}

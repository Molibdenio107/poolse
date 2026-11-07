'use client';

import { ClubLogo } from './club-logo';
import Link from 'next/link';
import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LinkBusy } from '@/components/link-busy';
import { TabGlyph } from '@/components/app-tab-glyphs';
import { TABS, tabFor, type AppHat } from '@/lib/app-hats';
import { cn } from '@/lib/utils';

/**
 * App mode's frame — POOLSE-136. Two shapes, decided by the address:
 *
 * - **A tab screen** (a home's own tabs): a header with only the club's name, the
 *   bottom tab bar below `md` and the same tabs as a row under the header from
 *   `md` up. Layout follows width, never the pointer (CLAUDE.md, POOLSE-88).
 *   `data-shell="tabs"` turns on the phone type scale (globals.css).
 * - **A screen deeper in** (a lesson, a form): the same header and the same tabs
 *   (Rui, 06-11-2026, reversing POOLSE-136), with its own *Voltar* as well. A Save
 *   bar sits on `--app-bar-clear`, so it stays above them.
 *
 * The maintenance home kept its pre-shell header until POOLSE-181 gave it its
 * own tabs. Preferences, the switcher, push and *Abrir o backoffice* live on
 * *Perfil* for every home (rule 4), so the header has nothing to hide.
 */
export function AppFrame({
  organizationName,
  logoFileId,
  homes,
  banner = null,
  search = null,
  children,
}: {
  organizationName: string;
  /** For the photo in the header's corner, which opens *O meu perfil*. */
  /** The club's logo, for the corner; null draws its initials (POOLSE-176). */
  logoFileId: string | null;
  homes: AppHat[];
  /** POOLSE-188: whose app this is, in the sticky header so it never scrolls away. */
  banner?: React.ReactNode;
  /** The search bar, role-filtered by the layout (Rui, 07-11-2026). */
  search?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  // The tab screens' paths; the query only says which tab, which the bar reads itself.
  const tabbed = [
    '/app/familia',
    '/app/familia/aulas',
    '/app/familia/progressos',
    '/app/aulas',
    '/app/aulas/calendario',
    '/app/manutencao',
    '/app/manutencao/registar',
    '/app/perfil',
  ].includes(pathname.replace(/\/$/, ''));

  return (
    <div
      data-surface="app"
      data-shell={tabbed ? 'tabs' : 'detail'}
      className="flex min-h-dvh flex-col bg-background pl-safe-left pr-safe-right"
    >
      <header className="sticky top-0 z-20 bg-surface pt-safe-top shadow-hairline-b print:hidden">
        {banner}
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4">
          <span className="min-w-0 truncate text-sm font-semibold">{organizationName}</span>
          <div className="flex shrink-0 items-center gap-2">
            <Suspense fallback={null}>{search}</Suspense>
            <ClubCorner name={organizationName} logoFileId={logoFileId} />
          </div>
        </div>
        <Suspense fallback={null}>
          <TabBar homes={homes} placement="top" />
        </Suspense>
      </header>

      <main
        className={cn(
          'mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-4',
          // Clear of the bottom bar below `md`, and of the home bar always.
          'pb-[calc(5.5rem+var(--safe-bottom))] md:pb-[calc(1.5rem+var(--safe-bottom))]',
        )}
      >
        {children}
      </main>

      <Suspense fallback={null}>
        <TabBar homes={homes} placement="bottom" />
      </Suspense>
    </div>
  );
}

/**
 * The header's corner is the club — POOLSE-176 (Rui, 05-11-2026, reversing the
 * photo of 31-10-2026): its logo, or its initials on the app's fill. Not a link:
 * the diamond tab is the one way to *Perfil*. Through `/files/<id>`, as every
 * file is read, never a storage key or a pre-signed address.
 */
function ClubCorner({ name, logoFileId }: { name: string; logoFileId: string | null }): React.ReactElement {
  if (logoFileId !== null) {
    return <ClubLogo name={name} fileId={logoFileId} />;
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
  return (
    <span
      role="img"
      aria-label={name}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
    >
      {initials}
    </span>
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
      <nav aria-label={t('app.tabs.label')} className="mx-auto hidden w-full max-w-2xl px-4 pb-2 md:block print:hidden">
        <div className="flex gap-1 rounded-sm bg-surface-muted p-1">{tabs}</div>
      </nav>
    );
  }
  return (
    <nav
      aria-label={t('app.tabs.label')}
      className="fixed inset-x-0 bottom-0 z-30 print:hidden px-2 pb-[calc(0.5rem+var(--safe-bottom))] pl-[calc(0.5rem+var(--safe-left))] pr-[calc(0.5rem+var(--safe-right))] md:hidden"
      data-bottom-bar
    >
      <div className="flex rounded bg-surface shadow-card">{tabs}</div>
    </nav>
  );
}

'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EntityIcon, type EntityKind } from '@/components/entity-icon';
import { cn } from '@/lib/utils';

/**
 * The app's navigation, down the left.
 *
 * It replaces a row of links that sat inside every page and had to be told where
 * it was — `<AppNav current="/dashboard/students" />`, on fifteen pages, each one
 * a chance to pass the wrong string. This reads the URL instead, which is the
 * one source that cannot disagree with reality. That is also why it is a client
 * component: `usePathname` is the whole reason, and nothing else here needs to be.
 *
 * Sections may have children. They appear only when their section is the one you
 * are in — a sidebar that shows every sub-page of every section at all times is a
 * sitemap, and you have to read it to use it. The children here are real
 * destinations, not actions: "add a student" is a button on the register, because
 * it does something, while "levels" is a place.
 *
 * Below `md` it lays out as a scrolling strip across the top. Poolse's backoffice
 * is a desktop product — the phone-shaped version of this is the mobile app in
 * phase 3, not a hamburger menu bolted onto a table.
 */
interface Section {
  href: string;
  key: string;
  icon: EntityKind;
  children?: { href: string; key: string }[];
}

const SECTIONS: Section[] = [
  { href: '/dashboard', key: 'nav.dashboard', icon: 'dashboard' },
  { href: '/dashboard/facilities', key: 'facilities.title', icon: 'facility' },
  { href: '/dashboard/classes', key: 'classes.title', icon: 'class' },
  {
    href: '/dashboard/calendar',
    key: 'calendar.title',
    icon: 'calendar',
    children: [{ href: '/dashboard/calendar/closures', key: 'calendar.closures' }],
  },
  {
    href: '/dashboard/students',
    key: 'students.title',
    icon: 'student',
    children: [{ href: '/dashboard/students/levels', key: 'students.levels' }],
  },
  { href: '/dashboard/people', key: 'people.title', icon: 'people' },
];

/**
 * `/dashboard` matches only itself; everything else matches its whole subtree.
 *
 * Without the special case the dashboard would be highlighted on every screen in
 * the app, since every path starts with it.
 */
function isInSection(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

const LINK = 'flex items-center gap-2 rounded px-3 py-2 text-sm whitespace-nowrap transition-colors';
const ACTIVE = 'bg-primary/15 font-medium text-primary';
const IDLE = 'text-foreground-muted hover:bg-surface-muted hover:text-foreground';

export function AppSidebar({ children }: { children: React.ReactNode }): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <aside className="border-b border-border bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
      <div className="flex h-full flex-row items-center gap-3 p-3 md:flex-col md:items-stretch md:gap-6 md:p-5">
        <Link
          href="/dashboard"
          className="hidden px-3 text-lg font-semibold tracking-tight text-primary md:block"
        >
          {t('app.name')}
        </Link>

        <nav
          aria-label={t('nav.label')}
          className="flex flex-1 flex-row gap-1 overflow-x-auto md:flex-col md:overflow-x-visible"
        >
          {SECTIONS.map((section) => {
            const active = isInSection(pathname, section.href);

            return (
              <Fragment key={section.href}>
                <Link
                  href={section.href}
                  aria-current={pathname === section.href ? 'page' : undefined}
                  className={cn(LINK, active ? ACTIVE : IDLE)}
                >
                  <EntityIcon kind={section.icon} />
                  {t(section.key)}
                </Link>

                {active &&
                  section.children?.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      aria-current={pathname === child.href ? 'page' : undefined}
                      className={cn(
                        LINK,
                        'md:ml-6 md:py-1.5',
                        pathname === child.href ? ACTIVE : IDLE,
                      )}
                    >
                      {t(child.key)}
                    </Link>
                  ))}
              </Fragment>
            );
          })}
        </nav>

        {/*
          Language, theme and the account menu. Passed in from the layout rather
          than imported: they are server components, and this one has to be a
          client component for `usePathname`.
        */}
        <div className="flex shrink-0 items-center gap-3 md:border-t md:border-border md:pt-4">
          {children}
        </div>
      </div>
    </aside>
  );
}

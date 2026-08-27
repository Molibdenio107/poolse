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
 *
 * Some sections are role-restricted. Hiding one is a courtesy, not a control:
 * every restricted section's API refuses the request as well, and that refusal is
 * the thing that actually protects it. A menu that is merely absent is a URL
 * somebody can still type.
 */
/**
 * One navigation item, at any depth — POOLSE-38 AC7.
 *
 * Structure, label and permission predicate live together, because a nested item
 * inheriting its parent's audience by accident is the failure the ticket names:
 * Instalações and Staff have different audiences, and Staff must disappear for
 * somebody who may see the facility but not its people.
 */
interface Item {
  href: string;
  key: string;
  /** Only the top level carries an icon; children are indented text. */
  icon?: EntityKind;
  children?: Item[];
  /** Absent means everybody. Present means only these roles. */
  roles?: readonly string[];
}

/** Whether this person may see an item — never inherited from a parent. */
function visible(item: Item, roles: readonly string[]): boolean {
  return item.roles === undefined || item.roles.some((role) => roles.includes(role));
}

/** The item and its permitted descendants, or null if the item itself is hidden. */
function prune(item: Item, roles: readonly string[]): Item | null {
  if (!visible(item, roles)) return null;

  const children = (item.children ?? [])
    .map((child) => prune(child, roles))
    .filter((child): child is Item => child !== null);

  return children.length > 0 ? { ...item, children } : { ...item, children: [] };
}

/**
 * The main navigation — POOLSE-38.
 *
 * Defined once, here, rather than per layout: the mobile and collapsed views
 * read the same array, so structure, labels and permissions cannot drift between
 * them. POOLSE-36 is superseded — Staff is no longer a main-menu item, so there
 * is nothing left to reorder.
 */
const SECTIONS: Item[] = [
  { href: '/dashboard', key: 'nav.dashboard', icon: 'dashboard' },
  {
    href: '/dashboard/facilities',
    key: 'facilities.title',
    icon: 'facility',
    /*
     * Staff nests here — POOLSE-38. Staff are an attribute of a facility, not a
     * peer of it, and "People" was never the right word once the section became
     * staff-only.
     *
     * Instalações stays a real page with its own content, not a bare section
     * header: POOLSE-37 makes it where an Owner or Admin lands, so it has to
     * render something.
     *
     * The `roles` here is Staff's own, not inherited. Somebody who may see the
     * facility but not its people sees Instalações without this child, and the
     * API refuses the route besides.
     */
    children: [
      {
        href: '/dashboard/facilities/staff',
        key: 'staff.title',
        roles: ['owner', 'admin'],
        // Férias is staff leave, so it belongs to Staff — POOLSE-34 as amended.
        // The chain is Instalações → Staff → Férias.
        children: [
          { href: '/dashboard/facilities/staff/vacations', key: 'vacations.title' },
        ],
      },
    ],
  },
  {
    href: '/dashboard/classes',
    key: 'classes.title',
    icon: 'class',
    // Épocas sits under Turmas because that is what a season contains. Visible to
    // everyone — knowing which year is running is not privileged — while the
    // reset itself is owner and admin only, refused by the API rather than
    // merely hidden here.
    children: [{ href: '/dashboard/classes/seasons', key: 'seasons.title' }],
  },
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
    children: [
      { href: '/dashboard/students/levels', key: 'students.levels' },
      // Encarregados de educação belong with the families, not with the staff —
      // POOLSE-35.
      { href: '/dashboard/students/guardians', key: 'students.guardiansTitle' },
    ],
  },
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

export function AppSidebar({ roles }: { roles: readonly string[] }): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();

  /*
   * Pruned by role, at every depth — POOLSE-38 AC5.
   *
   * A hidden parent takes its children with it; a hidden child leaves its parent
   * standing. Never inherited: Instalações and Staff have different audiences.
   */
  const sections = SECTIONS.map((section) => prune(section, roles)).filter(
    (section): section is Item => section !== null,
  );

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
          {sections.map((section) => (
            <NavItem key={section.href} item={section} pathname={pathname} depth={0} />
          ))}
        </nav>

      </div>
    </aside>
  );
}

/**
 * One navigation item and its children, at any depth — POOLSE-38.
 *
 * Recursive rather than two hardcoded levels, because the chain is now three
 * deep (Instalações → Staff → Férias) and a third hardcoded level would be the
 * moment somebody adds a fourth.
 *
 * **A parent is active when any descendant is** (AC6). `isInSection` matches the
 * whole subtree, so Instalações highlights while you are on Férias — which is
 * what tells you where you are once the item you clicked is two levels down.
 *
 * Children render only while their branch is active, which keeps a sidebar of
 * three top-level sections from becoming a list of twelve.
 */
function NavItem({
  item,
  pathname,
  depth,
}: {
  item: Item;
  pathname: string;
  depth: number;
}): React.ReactElement {
  const t = useTranslations();
  const active = isInSection(pathname, item.href);

  return (
    <Fragment key={item.href}>
      <Link
        href={item.href}
        aria-current={pathname === item.href ? 'page' : undefined}
        className={cn(
          LINK,
          // Each level steps in a little further. Only the top level has an icon,
          // so the indent is what carries the hierarchy below it.
          depth === 1 && 'md:ml-4 md:py-1.5',
          depth >= 2 && 'md:ml-8 md:py-1.5',
          active ? ACTIVE : IDLE,
        )}
      >
        {item.icon !== undefined && <EntityIcon kind={item.icon} />}
        {t(item.key)}
      </Link>

      {active &&
        item.children?.map((child) => (
          <NavItem key={child.href} item={child} pathname={pathname} depth={depth + 1} />
        ))}
    </Fragment>
  );
}

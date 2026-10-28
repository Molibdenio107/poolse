'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EntityIcon, type EntityKind } from '@/components/entity-icon';
import type { PoolseModule } from '@poolse/rules';
import type { OrganizationKind } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  visibleSections,
  type Badges,
  type Item,
} from '@/lib/nav-entries';

export type { BadgeKey, Badges } from '@/lib/nav-entries';

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

export function AppSidebar({
  roles,
  kind,
  modules,
  badges = {},
}: {
  roles: readonly string[];
  kind: OrganizationKind;
  modules: readonly PoolseModule[];
  badges?: Badges;
}): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();

  /*
   * Pruned by role and by kind of tenant, at every depth — POOLSE-38 AC5, 4.5.
   *
   * A hidden parent takes its children with it; a hidden child leaves its parent
   * standing. Never inherited: Instalações and Staff have different audiences.
   */
  const sections = visibleSections({ roles, kind, modules });

  /*
   * From `md` up only — POOLSE-88. Below it the same list lives in a sheet
   * behind the app bar's menu button (`MobileMenu`), because a strip of links
   * scrolling sideways across the top of a phone is a menu nobody can read.
   */
  return (
    <aside className="hidden border-r border-border bg-surface md:sticky md:top-0 md:block md:h-dvh md:w-60 md:shrink-0">
      <div className="flex h-full flex-col gap-6 p-5">
        <Link href="/dashboard" className="px-3 text-lg font-semibold tracking-tight text-primary">
          {t('app.name')}
          <LinkBusy />
        </Link>

        <SidebarNav sections={sections} pathname={pathname} badges={badges} />
      </div>
    </aside>
  );
}


/** The one list both the sidebar and the phone's sheet draw, so they cannot drift. */
function SidebarNav({
  sections,
  pathname,
  badges,
  onNavigate,
}: {
  sections: Item[];
  pathname: string;
  badges: Badges;
  /** The phone's sheet closes on any tap of a link, the page it is on included. */
  onNavigate?: () => void;
}): React.ReactElement {
  const t = useTranslations();
  return (
    <nav aria-label={t('nav.label')} className="flex flex-1 flex-col gap-1">
      {sections.map((section) => (
        <NavItem
          key={section.href}
          item={section}
          pathname={pathname}
          depth={0}
          badges={badges}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

/**
 * The phone's menu — POOLSE-88. A button at the start of the app bar, below
 * `md` only, opening the same navigation in a sheet from the left.
 *
 * The sheet is `Dialog` (`placement="start"`), so Escape, the backdrop, the
 * focus trap and the scroll lock are the ones every dialog has. It closes on
 * its own when the route changes: a tap on a link is the end of the errand.
 */
export function MobileMenu({
  roles,
  kind,
  modules,
  badges = {},
}: {
  roles: readonly string[];
  kind: OrganizationKind;
  modules: readonly PoolseModule[];
  badges?: Badges;
}): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('nav.openMenu')}
        aria-expanded={open}
        className="inline-flex h-control w-control shrink-0 items-center justify-center rounded border border-border bg-surface text-foreground hover:bg-surface-muted md:hidden"
      >
        <Menu aria-hidden className="size-5" />
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('app.name')}
        closeLabel={t('common.close')}
        placement="start"
      >
        <SidebarNav
          sections={visibleSections({ roles, kind, modules })}
          pathname={pathname}
          badges={badges}
          onNavigate={() => setOpen(false)}
        />
      </Dialog>
    </>
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
/** What the entries under a section carry, so a closed section can say so. */
function childCount(item: Item, badges: Badges): number {
  return (item.children ?? []).reduce(
    (sum, child) =>
      sum + (child.badge === undefined ? 0 : (badges[child.badge] ?? 0)) + childCount(child, badges),
    0,
  );
}

function NavItem({
  item,
  pathname,
  depth,
  badges,
  onNavigate,
  siblings,
}: {
  item: Item;
  pathname: string;
  depth: number;
  badges: Badges;
  onNavigate?: (() => void) | undefined;
  /** The other entries at this depth, for "the most specific match wins". */
  siblings?: Item[] | undefined;
}): React.ReactElement {
  const t = useTranslations();
  /*
   * Among siblings the most specific match wins: Competição's first child
   * shares its parent's address, and `/provas/minimos` is inside `/provas`, so
   * without this Provas would light up while Mínimos is being read.
   */
  const active =
    isInSection(pathname, item.href) &&
    !(siblings ?? []).some(
      (other) => other.href.length > item.href.length && isInSection(pathname, other.href),
    );
  // The page is named once: by the child that shares its parent's address.
  const current =
    pathname === item.href && !(item.children ?? []).some((child) => child.href === item.href);
  const count = item.badge === undefined ? 0 : (badges[item.badge] ?? 0);
  // A closed section says something inside it needs doing (POOLSE-120).
  const inside = count === 0 && !active ? childCount(item, badges) : 0;

  return (
    <Fragment key={item.href}>
      <Link
        href={item.href}
        aria-current={current ? 'page' : undefined}
        {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
        className={cn(
          LINK,
          // Each level steps in a little further. Only the top level has an icon,
          // so the indent is what carries the hierarchy below it.
          depth === 1 && 'ml-4 py-1.5',
          depth >= 2 && 'ml-8 py-1.5',
          active ? ACTIVE : IDLE,
        )}
      >
        {item.icon !== undefined && <EntityIcon kind={item.icon} />}
        {t(item.key)}
        {/*
          A small circle, never a number — Rui, 28-10-2026: discreet, and it
          pulses as it appears. The count is still said to a screen reader.
        */}
        {count > 0 && (
          <span className="attention ml-auto size-2 shrink-0 rounded-full bg-warning">
            <span className="sr-only">
              {item.badge === 'meetInbox'
                ? t('meetInbox.menuBadge', { count })
                : t('attention.menuBadge', { count })}
            </span>
          </span>
        )}
        {inside > 0 && (
          <span className="attention ml-auto size-2 shrink-0 rounded-full bg-warning">
            <span className="sr-only">{t('attention.menuBadge', { count: inside })}</span>
          </span>
        )}
        <LinkBusy />
      </Link>

      {active &&
        item.children?.map((child) => (
          <NavItem
            key={`${child.href}:${child.key}`}
            item={child}
            pathname={pathname}
            depth={depth + 1}
            badges={badges}
            onNavigate={onNavigate}
            siblings={item.children}
          />
        ))}
    </Fragment>
  );
}

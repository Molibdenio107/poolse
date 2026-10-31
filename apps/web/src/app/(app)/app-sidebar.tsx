'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { usePathname, useSearchParams } from 'next/navigation';
import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EntityIcon, type EntityKind } from '@/components/entity-icon';
import { BASE_SPORT, type PoolseModule, type PoolseSport } from '@poolse/rules';
import type { OrganizationKind } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { SiteIcon, SportIcon } from '@/components/sport-icon';
import { cn } from '@/lib/utils';
import {
  pathOf,
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

/*
 * The handoff's rows — POOLSE-139: 38 px, 2 px corners, 13 px text, a 19 px
 * icon, and the current page on the muted fill at 600. Under a finger the row
 * is still 44 px (`coarse:`), which wins over the handoff's 38.
 */
const LINK = 'flex min-h-[38px] items-center gap-2.5 rounded-sm px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors coarse:min-h-control';
const ACTIVE = 'bg-surface-muted font-semibold text-foreground';
const IDLE = 'text-foreground-muted hover:bg-surface-muted hover:text-foreground';

export function AppSidebar({
  roles,
  kind,
  modules,
  sports = [BASE_SPORT],
  badges = {},
}: {
  roles: readonly string[];
  kind: OrganizationKind;
  modules: readonly PoolseModule[];
  sports?: readonly PoolseSport[];
  badges?: Badges;
}): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const sport = useCurrentSport(sports);

  /*
   * Pruned by role and by kind of tenant, at every depth — POOLSE-38 AC5, 4.5.
   *
   * A hidden parent takes its children with it; a hidden child leaves its parent
   * standing. Never inherited: Instalações and Staff have different audiences.
   */
  const sections = visibleSections({ roles, kind, modules, sports });
  const section = sectionOf(sections, pathname, sport);

  /*
   * From `md` up only — POOLSE-88. Below it the same list lives in a sheet
   * behind the app bar's menu button (`MobileMenu`), because a strip of links
   * scrolling sideways across the top of a phone is a menu nobody can read.
   */
  return (
    // Under the full-width top bar since POOLSE-139, which now carries the
    // Poolse mark; a hairline rather than a border on the right.
    <aside className="hidden bg-surface shadow-hairline-r md:sticky md:top-app-bar md:block md:h-[calc(100dvh-3.5rem-var(--safe-top))] md:w-60 md:shrink-0">
      <div className="flex h-full flex-col overflow-y-auto px-2.5 py-4">
        <SectionFade section={section}>
          {section !== null && section !== 'site' && <SportHeader sport={section} />}
          <SidebarNav sections={itemsOf(sections, section)} pathname={pathname} badges={badges} sport={sport} />
        </SectionFade>
      </div>
    </aside>
  );
}


/*
 * Sections — POOLSE-141, the handoff's top bar. With two or more sports the
 * menu is *Instalação* (every shared page) and one section per sport (its
 * Turmas and Calendário, POOLSE-125's groups). Which one is current is derived
 * from the address and never stored: a sport's own page is that sport's
 * section (`?sport=`, else the first, as POOLSE-125 reads it), every other page
 * is *Instalação*. With one sport there are no sections and nothing changes.
 */
export type NavSection = 'site' | PoolseSport;

/** The sport groups POOLSE-125 built — present only with two or more sports. */
function groupsOf(sections: Item[]): Item[] {
  const groups = sections.filter((section) => section.sport !== undefined && section.children !== undefined);
  return groups.length >= 2 ? groups : [];
}

function sectionOf(sections: Item[], pathname: string, sport: PoolseSport): NavSection | null {
  const groups = groupsOf(sections);
  if (groups.length === 0) return null;
  const inSport = groups.some((group) =>
    (group.children ?? []).some((child) => {
      const path = pathOf(child.href);
      return pathname === path || pathname.startsWith(`${path}/`);
    }),
  );
  return inSport ? sport : 'site';
}

/** What the sidebar lists for a section: the shared pages, or one sport's entries. */
function itemsOf(sections: Item[], section: NavSection | null): Item[] {
  if (section === null) return sections;
  if (section === 'site') return sections.filter((item) => item.sport === undefined);
  return groupsOf(sections).find((group) => group.sport === section)?.children ?? [];
}

/** The handoff's sport header at the top of a sport's sidebar: its colour, icon and name. */
function SportHeader({ sport }: { sport: PoolseSport }): React.ReactElement {
  const t = useTranslations();
  return (
    <div
      data-sport={sport}
      className="mb-2 flex min-h-11 items-center gap-2.5 rounded-sm border-l-4 border-l-[rgb(var(--sport-wash))] bg-[rgb(var(--sport-wash)/var(--wash-a))] px-3 font-heading text-sm font-semibold"
    >
      <SportIcon sport={sport} />
      {t(`sport.name.${sport}`)}
    </div>
  );
}

/** The club, as the first section shows it: its logo if it has one, and its name. */
export interface ClubBrand {
  name: string | null;
  logoFileId: string | null;
}

/** The club's logo and name — the brand slot's own content (POOLSE-139). */
function ClubIdentity({ club }: { club: ClubBrand }): React.ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {club.logoFileId !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- streamed through /files/:id
        <img src={`/files/${club.logoFileId}`} alt="" className="h-8 w-auto max-w-32 object-contain" />
      )}
      {club.name !== null && <span className="truncate text-sm font-medium">{club.name}</span>}
    </span>
  );
}

/**
 * The section tabs: in the top bar on a desk (`placement="bar"`), and as a row
 * at the top of the phone's menu sheet (`placement="menu"`). Links, so they
 * work before hydration. The first section is the club itself — its logo and
 * its name (Rui, 31-10-2026), then a tab per sport with its icon and name.
 *
 * The current one carries `aria-current`. In the bar its 3 px underline is one
 * element that slides to the tab you chose and takes its colour — the primary
 * under the club, the sport's own under a sport — and a sport's tab fades into
 * its wash (Rui, 31-10-2026: "the transitions should be smooth"). The bar lives
 * in the layout, which stays mounted between pages, so the line moves from the
 * old tab rather than appearing under the new one. Reduced motion: it jumps.
 *
 * A section that is not current carries the attention dot when something inside
 * it needs doing (POOLSE-120).
 */
function SectionLinks({
  sections,
  section,
  badges,
  placement,
  club,
}: {
  sections: Item[];
  section: NavSection | null;
  badges: Badges;
  placement: 'bar' | 'menu';
  club: ClubBrand;
}): React.ReactElement | null {
  const t = useTranslations();
  const groups = groupsOf(sections);
  const row = useRef<HTMLElement>(null);
  const [line, setLine] = useState<{ left: number; width: number; animate: boolean } | null>(null);
  // The tab just clicked, so the line leaves at the click rather than when the
  // next page has arrived; forgotten once the address says which section it is.
  const [chosen, setChosen] = useState<NavSection | null>(null);
  useEffect(() => setChosen(null), [section]);
  const target = chosen ?? section;

  // Measure the target tab whenever it changes; animate every move but the
  // first, so a page load draws the line in place.
  useLayoutEffect(() => {
    if (placement !== 'bar' || row.current === null || target === null) return;
    const tab = row.current.querySelector<HTMLElement>(`[data-section='${target}']`);
    if (tab === null) return;
    setLine((before) => ({ left: tab.offsetLeft, width: tab.offsetWidth, animate: before !== null }));
  }, [target, placement, club.name]);

  if (section === null || groups.length === 0) return null;
  const site = sections.filter((item) => item.sport === undefined);
  const waiting = (items: Item[]): number =>
    items.reduce(
      (sum, item) => sum + (item.badge === undefined ? 0 : (badges[item.badge] ?? 0)) + childCount(item, badges),
      0,
    );
  const lineSport = target === 'site' || target === null ? null : target;

  const tab = (
    key: string,
    href: string,
    label: string,
    icon: React.ReactNode,
    current: boolean,
    sport: PoolseSport | null,
    dot: number,
  ): React.ReactElement => (
    <Link
      key={key}
      href={href}
      data-section={key}
      onClick={() => setChosen(key as NavSection)}
      aria-current={current ? 'page' : undefined}
      {...(sport === null ? {} : { 'data-sport': sport })}
      className={cn(
        'relative inline-flex min-w-0 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-[13px]',
        'transition-[background-color,color] duration-300 ease-out motion-reduce:transition-none',
        'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        placement === 'menu' ? 'min-h-11 rounded-sm' : 'h-full',
        current ? 'font-semibold text-foreground' : 'font-medium text-foreground-muted hover:text-foreground',
        current && sport !== null && 'bg-[rgb(var(--sport-wash)/var(--wash-a))]',
        // The phone's row keeps a bar under each current tab; the desk's slides (below).
        placement === 'menu' &&
          current &&
          (sport === null
            ? 'after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-primary'
            : 'after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-[rgb(var(--sport-wash))]'),
      )}
    >
      {icon}
      <span className={cn(sport === null && 'max-w-[14rem] truncate')}>{label}</span>
      {!current && dot > 0 && (
        <span className="attention-dot">
          <span className="sr-only">{t('attention.menuBadge', { count: dot })}</span>
        </span>
      )}
      <LinkBusy />
    </Link>
  );

  const clubIcon =
    club.logoFileId !== null ? (
      // eslint-disable-next-line @next/next/no-img-element -- streamed through /files/:id
      <img src={`/files/${club.logoFileId}`} alt="" className="size-5 shrink-0 rounded-sm object-contain" />
    ) : (
      <SiteIcon />
    );

  return (
    <nav
      ref={row}
      aria-label={t('nav.sections')}
      data-scroll-row
      className={cn(
        'relative flex items-stretch',
        placement === 'bar' ? 'h-full min-w-0 overflow-x-auto' : 'mb-3 flex-wrap gap-1 border-b border-border pb-2',
      )}
    >
      {tab(
        'site',
        '/dashboard',
        club.name ?? t('nav.site'),
        clubIcon,
        section === 'site',
        null,
        section === 'site' ? 0 : waiting(site),
      )}
      <span aria-hidden className={cn('w-px shrink-0 self-center bg-foreground/10', placement === 'bar' ? 'mx-1 h-5' : 'hidden')} />
      {groups.map((group) =>
        tab(
          group.sport!,
          group.href,
          t(`sport.name.${group.sport!}`),
          <SportIcon sport={group.sport!} />,
          section === group.sport,
          group.sport!,
          section === group.sport ? 0 : waiting(group.children ?? []),
        ),
      )}
      {placement === 'bar' && line !== null && (
        <span
          aria-hidden
          {...(lineSport === null ? {} : { 'data-sport': lineSport })}
          className={cn(
            'pointer-events-none absolute bottom-0 h-[3px]',
            lineSport === null ? 'bg-primary' : 'bg-[rgb(var(--sport-wash))]',
            line.animate && 'transition-[left,width,background-color] duration-300 ease-out motion-reduce:transition-none',
          )}
          style={{ left: line.left, width: line.width }}
        />
      )}
    </nav>
  );
}

/**
 * The top bar's left half after Poolse's mark — POOLSE-141 (Rui, 31-10-2026).
 * With two or more sports, on a desk: the sections, the club being the first
 * of them. Otherwise — one sport, or a phone, whose sections are in the menu
 * sheet — the club's logo and name, as POOLSE-139 put them.
 */
export function ClubBrandOrSections({
  roles,
  kind,
  modules,
  sports = [BASE_SPORT],
  badges = {},
  club,
}: {
  roles: readonly string[];
  kind: OrganizationKind;
  modules: readonly PoolseModule[];
  sports?: readonly PoolseSport[];
  badges?: Badges;
  club: ClubBrand;
}): React.ReactElement {
  const pathname = usePathname();
  const sport = useCurrentSport(sports);
  const sections = visibleSections({ roles, kind, modules, sports });
  const section = sectionOf(sections, pathname, sport);
  if (section === null) return <ClubIdentity club={club} />;
  return (
    <>
      <span className="contents md:hidden">
        <ClubIdentity club={club} />
      </span>
      <div className="hidden min-w-0 self-stretch md:ml-4 md:flex">
        <SectionLinks sections={sections} section={section} badges={badges} placement="bar" club={club} />
      </div>
    </>
  );
}

/**
 * A sport section's content wears its wash — POOLSE-141, the handoff's
 * `.sport-shell`. Shared pages never do; with one sport, nothing does.
 */
export function SportShell({
  roles,
  kind,
  modules,
  sports = [BASE_SPORT],
  className,
  children,
}: {
  roles: readonly string[];
  kind: OrganizationKind;
  modules: readonly PoolseModule[];
  sports?: readonly PoolseSport[];
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const sport = useCurrentSport(sports);
  const section = sectionOf(visibleSections({ roles, kind, modules, sports }), pathname, sport);
  const washed = section !== null && section !== 'site';
  return (
    <div {...(washed ? { 'data-sport': section } : {})} className={cn(className, washed && 'sport-shell')}>
      {children}
    </div>
  );
}

/**
 * The sidebar's list for a section, faded in when the section changes and only
 * then (Rui, 31-10-2026): a page load or a move inside one section draws it
 * still, because a list that animates on every click is a list that flickers.
 */
function SectionFade({ section, children }: { section: NavSection | null; children: React.ReactNode }): React.ReactElement {
  // Once the section has changed, every later remount (the key below) fades in,
  // the way back to the first section included.
  const seen = useRef<{ last: NavSection | null; moved: boolean }>({ last: section, moved: false });
  if (seen.current.last !== section) seen.current = { last: section, moved: true };
  const moved = seen.current.moved;
  return (
    <div
      key={section ?? 'all'}
      className={cn(
        'flex flex-1 flex-col',
        moved && 'duration-300 ease-out animate-in fade-in slide-in-from-left-1 motion-reduce:animate-none',
      )}
    >
      {children}
    </div>
  );
}

/** `?sport=` when it names one of the club's sports, else the first — POOLSE-125 rule 3. */
function useCurrentSport(sports: readonly PoolseSport[]): PoolseSport {
  const asked = useSearchParams().get('sport');
  return sports.find((sport) => sport === asked) ?? sports[0] ?? BASE_SPORT;
}

/** The one list both the sidebar and the phone's sheet draw, so they cannot drift. */
function SidebarNav({
  sections,
  pathname,
  badges,
  sport,
  onNavigate,
}: {
  sections: Item[];
  pathname: string;
  badges: Badges;
  /** The sport being read — POOLSE-125: `?sport=` when it is one of the club's, else the first. */
  sport: PoolseSport;
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
          sport={sport}
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
  sports = [BASE_SPORT],
  badges = {},
  club = { name: null, logoFileId: null },
}: {
  roles: readonly string[];
  kind: OrganizationKind;
  modules: readonly PoolseModule[];
  sports?: readonly PoolseSport[];
  badges?: Badges;
  club?: ClubBrand;
}): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const sport = useCurrentSport(sports);
  const [open, setOpen] = useState(false);
  const sections = visibleSections({ roles, kind, modules, sports });
  const section = sectionOf(sections, pathname, sport);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('nav.openMenu')}
        aria-expanded={open}
        className="inline-flex h-control w-control shrink-0 items-center justify-center rounded-sm bg-surface text-foreground hover:bg-surface-muted md:hidden shadow-card"
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
        {/* POOLSE-141: with two sports, the sections first, then the current one's entries. */}
        <SectionLinks sections={sections} section={section} badges={badges} placement="menu" club={club} />
        {section !== null && section !== 'site' && <SportHeader sport={section} />}
        <SidebarNav
          sections={itemsOf(sections, section)}
          pathname={pathname}
          badges={badges}
          sport={sport}
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
  sport,
  onNavigate,
  siblings,
}: {
  item: Item;
  pathname: string;
  depth: number;
  badges: Badges;
  sport: PoolseSport;
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
  /*
   * An entry of one sport's group (POOLSE-125) answers only while that sport is
   * being read, and a group is open while any of its entries is — Turmas and
   * Calendário sit at two different addresses under one heading.
   */
  const ofSport = (entry: Item): boolean => entry.sport === undefined || entry.sport === sport;
  const here = (entry: Item): boolean => isInSection(pathname, pathOf(entry.href)) && ofSport(entry);
  const reaches = (entry: Item): boolean => here(entry) || (entry.children ?? []).some(reaches);
  const path = pathOf(item.href);
  const active =
    reaches(item) &&
    !(siblings ?? []).some(
      (other) => pathOf(other.href).length > path.length && here(other),
    );
  // The page is named once: by the child that shares its parent's address.
  const current =
    pathname === path && ofSport(item) && !(item.children ?? []).some((child) => child.href === item.href);
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
        {item.icon !== undefined && <EntityIcon kind={item.icon} className="size-[19px]" />}
        {t(item.key)}
        {/*
          A small soft dot, never a number — Rui, 28-10-2026: discreet, in the
          palette's colour, blinking gently (`.attention-dot`). The count is
          still said to a screen reader.
        */}
        {count > 0 && (
          <span className="attention-dot ml-auto">
            <span className="sr-only">
              {item.badge === 'meetInbox'
                ? t('meetInbox.menuBadge', { count })
                : t('attention.menuBadge', { count })}
            </span>
          </span>
        )}
        {inside > 0 && (
          <span className="attention-dot ml-auto">
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
            sport={sport}
            onNavigate={onNavigate}
            siblings={item.children}
          />
        ))}
    </Fragment>
  );
}

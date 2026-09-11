'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EntityIcon, type EntityKind } from '@/components/entity-icon';
import type { OrganizationKind } from '@/lib/api';
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
  /**
   * Absent means every kind of tenant. Present means only these — slice 4.5.
   *
   * A personal tenant is one person and one pool: no turmas, no calendar of
   * them, no students, no invoices, no staff. Those sections are not hidden as
   * a permission — the owner of a personal tenant is an owner, and the API
   * would answer — they are absent because they are about things that do not
   * exist there. A section for the one pool is Instalações, which already holds
   * the tank, its readings, its kit and its tasks.
   */
  kinds?: readonly OrganizationKind[];
}

/** Who is looking: their roles, and what kind of tenant they are in. */
interface Viewer {
  roles: readonly string[];
  kind: OrganizationKind;
}

/** Whether this person may see an item — never inherited from a parent. */
function visible(item: Item, viewer: Viewer): boolean {
  const byRole = item.roles === undefined || item.roles.some((role) => viewer.roles.includes(role));
  const byKind = item.kinds === undefined || item.kinds.includes(viewer.kind);
  return byRole && byKind;
}

/** The item and its permitted descendants, or null if the item itself is hidden. */
function prune(item: Item, viewer: Viewer): Item | null {
  if (!visible(item, viewer)) return null;

  const children = (item.children ?? [])
    .map((child) => prune(child, viewer))
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
 *
 * **Dashboard is first, and Instalações sits below it — round 5, ticket 1.**
 * This reverses the order POOLSE-37 and POOLSE-38 argued for, deliberately
 * rather than by drift, so the reasoning is worth keeping straight. The old
 * argument was that the first item is read as the place you are meant to be, and
 * that the dashboard was about *you* — your account, your roles, your sessions —
 * rather than about the pool. That was true when it was written and stopped
 * being true in round 4, which moved every account question to "O meu perfil"
 * and put occupancy on the dashboard instead. A page that answers "how much of
 * the water is sold" *is* about the operation, so it is now the front door, and
 * the logo and the post-sign-in redirect both land on it.
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
      /*
       * Inventário nests here — round 6. An item belongs to a facility and says
       * which tanks it serves, so the kit list is an attribute of the site, not
       * of any one pool. It was a block on the pool page and had to be found
       * through a tank to be read at all.
       *
       * Visible to everybody: knowing whether there are enough pranchas for a
       * class is not privileged, and the write endpoints are owner/admin whether
       * or not this link is shown.
       */
      { href: '/dashboard/facilities/inventory', key: 'inventory.title' },
      {
        href: '/dashboard/facilities/staff',
        key: 'staff.title',
        roles: ['owner', 'admin'],
        kinds: ['business'],
        // Férias is staff leave, so it belongs to Staff — POOLSE-34 as amended.
        // The chain is Instalações → Staff → Férias.
        children: [
          { href: '/dashboard/facilities/staff/vacations', key: 'vacations.title' },
        ],
      },
    ],
  },
  /*
   * Energia — phase 5, directly under Instalações because it is about the
   * building rather than the people in it. Its own section at Rui's ask: an
   * operator logging the month's meter readings is doing one job across every
   * site, and starting from Instalações puts a site page — spaces, tasks,
   * photographs — between them and the dial. The panel on each site's page
   * stays, because a technician looking at a site also wants its meters there.
   *
   * Owner, admin and maintenance: what running the site costs is not an
   * instructor's question, and the API refuses the routes to everybody else
   * besides. Both kinds of tenant, since a garden pool has a pump.
   */
  {
    href: '/dashboard/energy',
    key: 'energy.section',
    icon: 'energy',
    roles: ['owner', 'admin', 'maintenance'],
  },
  {
    href: '/dashboard/classes',
    key: 'classes.title',
    icon: 'class',
    kinds: ['business'],
    // Épocas sits under Turmas because that is what a season contains. Visible to
    // everyone — knowing which year is running is not privileged — while the
    // reset itself is owner and admin only, refused by the API rather than
    // merely hidden here.
    children: [
      { href: '/dashboard/classes/seasons', key: 'seasons.title' },
      // Reposições sit under Turmas because that is what they are about: a class
      // missed and a class made up. There is no general settings area, and
      // inventing one for a single feature would put the rule two clicks further
      // from the thing it governs — POOLSE-21.
    ],
  },
  {
    href: '/dashboard/calendar',
    key: 'calendar.title',
    icon: 'calendar',
    kinds: ['business'],
    children: [{ href: '/dashboard/calendar/closures', key: 'calendar.closures' }],
  },
  /*
   * Faturação — phase 2.2.
   *
   * Its own section rather than a child of Alunos: a document belongs to a
   * payer, and a payer is often a guardian with two children on one invoice, so
   * filing it under the register would put it under the wrong noun. Owner and
   * admin only, and the endpoints refuse everybody else besides — a menu that is
   * merely absent is a URL somebody can still type.
   */
  {
    href: '/dashboard/faturacao',
    key: 'invoices.title',
    icon: 'invoice',
    roles: ['owner', 'admin'],
    kinds: ['business'],
  },
  {
    href: '/dashboard/students',
    key: 'students.title',
    icon: 'student',
    kinds: ['business'],
    // Ordered by how close each one sits to a student — round 6. Encarregados
    // first, directly under Alunos, because a guardian is a person attached to a
    // student and the two lists are read together; Níveis next, being what a
    // student is in; Reposições last, because a make-up class is an exception
    // somebody goes looking for deliberately, not a list they browse.
    children: [
      // Encarregados de educação belong with the families, not with the staff —
      // POOLSE-35.
      { href: '/dashboard/students/guardians', key: 'students.guardiansTitle' },
      { href: '/dashboard/students/levels', key: 'students.levels' },
      // Categorias next to Níveis: both are lists a club sets up once and then
      // rarely touches, and a category is a fact about a person's price in the
      // same way a level is a fact about their swimming.
      { href: '/dashboard/students/categories', key: 'categories.title' },
      // Reposicoes moved here in round 5: a make-up class is something a
      // student is owed, and the person looking for one is looking at a student.
      { href: '/dashboard/classes/reposicoes', key: 'reposicao.title' },
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

export function AppSidebar({
  roles,
  kind,
}: {
  roles: readonly string[];
  kind: OrganizationKind;
}): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();

  /*
   * Pruned by role and by kind of tenant, at every depth — POOLSE-38 AC5, 4.5.
   *
   * A hidden parent takes its children with it; a hidden child leaves its parent
   * standing. Never inherited: Instalações and Staff have different audiences.
   */
  const viewer: Viewer = { roles, kind };
  const sections = SECTIONS.map((section) => prune(section, viewer)).filter(
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

import type { PoolseModule } from '@poolse/rules';
import type { EntityKind } from '@/components/entity-icon';
import type { OrganizationKind } from '@/lib/api';

/**
 * The app's destinations and who may open each — POOLSE-38, moved here by
 * POOLSE-118 so the sidebar, the phone's menu and the command palette read one
 * list through one filter. A page the reader may not open is offered by none
 * of them, because there is no second list to forget.
 */
/**
 * One navigation item, at any depth — POOLSE-38 AC7.
 *
 * Structure, label and permission predicate live together, because a nested item
 * inheriting its parent's audience by accident is the failure the ticket names:
 * Instalações and Staff have different audiences, and Staff must disappear for
 * somebody who may see the facility but not its people.
 */
export interface Item {
  href: string;
  key: string;
  /** Only the top level carries an icon; children are indented text. */
  icon?: EntityKind;
  children?: Item[];
  /** Absent means everybody. Present means only these roles. */
  roles?: readonly string[];
  /**
   * Hidden from anybody holding one of these, whatever `roles` says. For an
   * entry that is a shortcut to something a senior role already reaches by
   * another way — the staff's own Férias, which owners and admins open under
   * Staff.
   */
  unlessRoles?: readonly string[];
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
  /**
   * The module this entry belongs to — POOLSE-87. Absent means core. Checked on
   * every item, children included, so Salários disappears from under Staff
   * while Staff stays.
   */
  module?: PoolseModule;
  /**
   * A count the entry carries — POOLSE-114's files waiting in *Recebidos por
   * email*. Read by the layout and passed in; absent or zero draws nothing.
   */
  badge?: BadgeKey;
}

/** The counts a menu entry may carry. */
/**
 * `meetInbox` is POOLSE-114's count; the rest are POOLSE-120's circles — what
 * needs doing, from `GET /attention`, cleared when it is done.
 */
export type BadgeKey = 'meetInbox' | 'leads' | 'facilities' | 'calendar';
export type Badges = Partial<Record<BadgeKey, number>>;

/*
 * Who an entry is for, matched to its endpoint — 15 October 2026 (Rui): a menu
 * never offers a screen that would refuse its reader. A new entry takes the
 * roles of the API route its page loads, and the role probe proves that route.
 */
export const STAFF = ['owner', 'admin', 'instructor', 'maintenance'] as const;
export const TEACHING = ['owner', 'admin', 'instructor'] as const;
export const OFFICE = ['owner', 'admin'] as const;

/** Who is looking: their roles, and what kind of tenant they are in. */
export interface Viewer {
  roles: readonly string[];
  kind: OrganizationKind;
  /** The modules this club has on. */
  modules: readonly PoolseModule[];
}

/** Whether this person may see an item — never inherited from a parent. */
function visible(item: Item, viewer: Viewer): boolean {
  const byRole = item.roles === undefined || item.roles.some((role) => viewer.roles.includes(role));
  const byKind = item.kinds === undefined || item.kinds.includes(viewer.kind);
  const notExcluded =
    item.unlessRoles === undefined || !item.unlessRoles.some((role) => viewer.roles.includes(role));
  const byModule = item.module === undefined || viewer.modules.includes(item.module);
  return byRole && byKind && notExcluded && byModule;
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
export const SECTIONS: Item[] = [
  { href: '/dashboard', key: 'nav.dashboard', icon: 'dashboard' },
  {
    href: '/dashboard/facilities',
    key: 'facilities.title',
    icon: 'facility',
    badge: 'facilities',
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
       * Staff only, as the endpoint is: knowing whether there are enough
       * pranchas for a class is not privileged, but it is not a family's
       * question. Owner, admin and maintenance write; the API says so.
       */
      { href: '/dashboard/facilities/inventory', key: 'inventory.title', roles: STAFF, module: 'maintenance' },
      /*
       * Ocorrências — POOLSE-70. The staff on the deck when something happens;
       * students and guardians are refused by the API, so they are not offered
       * the link. A club's book, not a personal pool's.
       */
      {
        href: '/dashboard/facilities/incidents',
        key: 'incidents.title',
        roles: ['owner', 'admin', 'instructor', 'maintenance'],
        kinds: ['business'],
        module: 'incidents',
      },
      /*
       * Nadadores-salvadores — POOLSE-70 slice 2. Who is on which tank this
       * week. Every member of staff reads it, because the person on the deck is
       * the one who needs to know; owner and admin write it, and the API says
       * so whether or not the buttons are drawn.
       */
      {
        href: '/dashboard/facilities/lifeguards',
        key: 'roster.title',
        roles: ['owner', 'admin', 'instructor', 'maintenance'],
        kinds: ['business'],
        module: 'incidents',
      },
      /*
       * The staff's own leave — 15 October 2026 (Rui). Instructors and
       * maintenance request it and see their balance; approving is owner and
       * admin, who reach the same page under Staff and so are not shown this.
       */
      {
        href: '/dashboard/facilities/staff/vacations',
        key: 'vacations.mine',
        roles: ['instructor', 'maintenance'],
        unlessRoles: OFFICE,
        kinds: ['business'],
        module: 'vacations',
      },
      {
        href: '/dashboard/facilities/staff',
        key: 'staff.title',
        roles: OFFICE,
        kinds: ['business'],
        // Férias is staff leave, so it belongs to Staff — POOLSE-34 as amended.
        // The chain is Instalações → Staff → Férias.
        children: [
          { href: '/dashboard/facilities/staff/vacations', key: 'vacations.title', module: 'vacations' },
          /*
           * Salários — POOLSE-58. Owner and Admin, like its parent.
           *
           * The absence of a link is a shape, not a permission: every endpoint
           * behind it refuses anybody else, and an Admin is refused the Owner's
           * own rate specifically. Hiding a control was never the control.
           */
          { href: '/dashboard/facilities/staff/salaries', key: 'salaries.title', module: 'salaries' },
          // Qualificações — POOLSE-27, 7b.2. Owner and admin, like its parent.
          {
            href: '/dashboard/facilities/staff/qualifications',
            key: 'qualifications.title',
            module: 'qualifications',
          },
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
    module: 'energy',
  },
  {
    href: '/dashboard/classes',
    key: 'classes.title',
    icon: 'class',
    roles: STAFF,
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
      // Aulas de reposição came back here from Alunos in POOLSE-103 (Rui,
      // 22-10-2026): the route lives under /classes, and a make-up is a class.
      { href: '/dashboard/classes/reposicoes', key: 'reposicao.title', roles: OFFICE },
    ],
  },
  {
    href: '/dashboard/calendar',
    key: 'calendar.title',
    icon: 'calendar',
    badge: 'calendar',
    roles: STAFF,
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
  /*
   * Receção — POOLSE-68. Free swim: sell an entry or a pack, check somebody in,
   * see who is in the water. Owner and admin, because there is no reception
   * role and the endpoints refuse everybody else.
   */
  {
    href: '/dashboard/rececao',
    key: 'reception.title',
    icon: 'reception',
    roles: ['owner', 'admin'],
    kinds: ['business'],
    module: 'reception',
  },
  {
    href: '/dashboard/faturacao',
    key: 'invoices.title',
    icon: 'invoice',
    roles: ['owner', 'admin'],
    kinds: ['business'],
    module: 'invoicing',
  },
  {
    href: '/dashboard/students',
    key: 'students.title',
    icon: 'student',
    roles: TEACHING,
    kinds: ['business'],
    // Ordered by how close each one sits to a student — round 6. Encarregados
    // first, directly under Alunos, because a guardian is a person attached to a
    // student and the two lists are read together; Níveis next, being what a
    // student is in. Reposições moved to Turmas in POOLSE-103.
    children: [
      // Encarregados de educação belong with the families, not with the staff —
      // POOLSE-35.
      { href: '/dashboard/students/guardians', key: 'students.guardiansTitle' },
      // Pedidos de inscrição — POOLSE-69. Second, under Encarregados: a request
      // is a family that is not a student yet, and in September it is the list
      // reception works first. The roles are the endpoint's own.
      { href: '/dashboard/students/pedidos', key: 'leads.title', roles: OFFICE, badge: 'leads' },
      // Mensagens sit with the families they are written to — POOLSE-67. The
      // roles are the endpoint's own; an instructor writes to their own turmas.
      {
        href: '/dashboard/students/messages',
        key: 'messages.title',
        roles: ['owner', 'admin', 'instructor'],
        module: 'messages',
      },
      /*
        Competição — POOLSE-81 and 85, its own branch since 20-10-2026 (Rui):
        the meets, the qualifying times and the FPN's escalões, which make
        sense only to a club that competes, so the whole branch follows the
        competition module. The endpoint's own roles. Each part is a route, so
        the entry that lights up is the one being read.
      */
      {
        href: '/dashboard/students/provas',
        key: 'competition.title',
        roles: TEACHING,
        module: 'competition',
        badge: 'meetInbox',
        children: [
          { href: '/dashboard/students/provas', key: 'qualifying.section.meets' },
          { href: '/dashboard/students/provas/minimos', key: 'qualifying.section.minimos' },
          { href: '/dashboard/students/provas/escaloes', key: 'qualifying.section.escaloes' },
        ],
      },
      { href: '/dashboard/students/levels', key: 'students.levels' },
      /*
       * The advancement queue — POOLSE-19. It shipped on 28 August with no way
       * in: nothing linked to it, so a proposal waited for somebody to type the
       * URL. The roles are the endpoint's own (owner, admin, instructor).
       */
      {
        href: '/dashboard/students/advancement',
        key: 'advancement.title',
        roles: ['owner', 'admin', 'instructor'],
      },
      /*
       * Categorias is **not** here any more — round 19.
       *
       * It sat beside Níveis while a category was a label, on the reasoning that
       * both are lists a club sets up once. A category now carries what it is
       * worth, which makes it part of the price list rather than part of the
       * register — so it is a panel on the site's page, under Preços, and the
       * old route redirects to Instalações.
       */
    ],
  },
  /*
   * A family's own way in — 15 October 2026 (Rui). A guardian opens their
   * children, a student their own record; the page goes straight to the record
   * when there is one. The API decides whose records those are
   * (`requireActsForStudent`), not this list.
   */
  {
    href: '/dashboard/family',
    key: 'family.navGuardian',
    icon: 'student',
    roles: ['guardian'],
    kinds: ['business'],
  },
  {
    href: '/dashboard/family',
    key: 'family.navStudent',
    icon: 'student',
    roles: ['student'],
    unlessRoles: ['guardian'],
    kinds: ['business'],
  },
  /*
   * Subscrição is deliberately **not** here — 13 September 2026.
   *
   * It was a top-level item for half a day. What Poolse charges the club is the
   * owner's own business, like their card and their renewal date, so it lives
   * under *O meu perfil* — a fact about the account rather than about the club's
   * work — and the endpoint refuses everybody but the owner besides. A menu
   * entry for a screen one person in the club may open is a menu entry the other
   * fifteen read as something missing.
   */
];

/** The sections this viewer may see, pruned at every depth. */
export function visibleSections(viewer: Viewer): Item[] {
  return SECTIONS.map((section) => prune(section, viewer)).filter(
    (section): section is Item => section !== null,
  );
}

/** Every destination this viewer may open, children included, in menu order — the palette's list. */
export function visibleDestinations(viewer: Viewer): Item[] {
  const flat: Item[] = [];
  const walk = (items: Item[]): void => {
    for (const item of items) {
      flat.push(item);
      walk(item.children ?? []);
    }
  };
  walk(visibleSections(viewer));
  return flat;
}

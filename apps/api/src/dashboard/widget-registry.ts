import type { MemberRole } from '../tenant/roles.js';
import { MEMBER_ROLES } from '../tenant/roles.js';
import { energySpend, myTasks, setupChecklist, subscriptionState, trialIsClosing } from './resolvers.js';

/**
 * The dashboard, as one declaration per widget — POOLSE-66, slice 1.
 *
 * **The page is a union of bands, never a layout chosen by a role.** A person
 * holds several roles — that is the whole reason `membership_role` is a table —
 * and a club owner who also teaches on Tuesdays is the ordinary case here, not
 * the edge one. So an owner who teaches sees the management band *and* their
 * next class, and a maintenance-only user sees the operational band at the top,
 * which reads as "the maintenance dashboard" without one existing.
 *
 * **Nothing here decides a permission.** `roles` says which band a widget
 * belongs to the reader in, and it is applied *before* a resolver runs, so a
 * widget the reader may not see is absent from the payload rather than hidden in
 * a browser. The resolver still scopes its own query to the organization, as
 * every query in this product does: this is composition, and the isolation is
 * structural and lives in the database.
 */

/**
 * The three bands, in the order they render. **One array constant**, so
 * reordering the page is this line and nothing else.
 */
export const BANDS = ['management', 'operational', 'personal'] as const;

export type Band = (typeof BANDS)[number];

/**
 * What a widget's data is *about* — which is not the same as who may see it.
 *
 * - `tenant`   the club, or the one site the reader selected
 * - `facility` restricted to the reader's own sites, whatever the selector says
 * - `self`     this person, or their dependents
 */
export type WidgetScope = 'tenant' | 'facility' | 'self';

/** `empty` is a rendered state, not a failure. See `compose.ts`. */
export type WidgetState = 'ok' | 'empty' | 'error';

/**
 * What a resolver is handed.
 *
 * `facilityIds` is **the reader's own sites**, which is not the same as the
 * club's: for an owner or an admin it is every site, and for an instructor it is
 * the sites behind the turmas they teach. See `ROLES_WITH_DERIVED_FACILITIES`
 * below for why that distinction is enforced rather than trusted.
 */
export interface ResolverContext {
  organizationId: string;
  membershipId: string;
  roles: readonly string[];
  facilityIds: readonly string[];
  /** The selector: every site, or the one that was asked for. */
  scope: { mode: 'all' | 'facility'; facilityId: string | null };
  locale: string;
}

/**
 * A resolver answers with its data, or with `null` meaning **there is nothing
 * here** — which becomes `state: 'empty'` and a card that says so.
 *
 * It must not answer `null` to mean "that went wrong". A failure is a throw, and
 * the difference is the whole point: a club with no overdue cleaning and a
 * broken query must not look the same on the page.
 */
export type WidgetResolver = (ctx: ResolverContext) => Promise<unknown | null>;

export interface WidgetDefinition {
  /** Dotted and stable: it is what the client keys its rendering on. */
  id: string;
  band: Band;
  /** Absent from the payload for anybody holding none of these. Never empty. */
  roles: readonly MemberRole[];
  /**
   * Which kinds of tenant this makes sense in, spelled exactly as
   * `app-sidebar.tsx` spells it. Omitted means every kind.
   *
   * A personal tenant has no students, no turmas and no mensalidades, so the
   * management band there is simply the widgets that make sense — which is what
   * keeps `organization.kind` read in two places rather than branching the band
   * model for one tenant shape. `docs/features/personal.md`.
   */
  kinds?: readonly ('business' | 'personal')[];
  scope: WidgetScope;
  /** Columns, 1 to 3. */
  size: 1 | 2 | 3;
  /** Higher wins when a band is capped. */
  priority: number;
  /**
   * A predicate on the *resolved* data that lifts this widget to
   * `escalatedPriority` — "a trial with four days left belongs at the top".
   *
   * It is a function of the data rather than a second number in the declaration
   * because nothing about a declaration can know how many days are left. It runs
   * **after** the resolvers and **before** the cap, so an escalation can still
   * change which four widgets a band keeps; that is also why every allowed
   * widget is resolved rather than only the four that would have survived.
   */
  escalate?: (data: unknown) => boolean;
  escalatedPriority?: number;
  /**
   * An environment variable that must read `true` for this widget to exist.
   *
   * Every flag in this product is an environment variable at the API —
   * `WEATHER_HISTORY_ENABLED`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY` — and a
   * per-tenant flag table is roadmap P.4, still waiting for a reason. Decided
   * 22 September 2026.
   */
  featureFlag?: string;
  resolver: WidgetResolver;
}

/**
 * At most four widgets per band, chosen by priority.
 *
 * The dashboard is a launcher, not a replacement for the pages: every card
 * carries a link to the real screen, and a fifth card is a page somebody scrolls
 * instead of a page somebody reads.
 */
export const BAND_CAP = 4;

/**
 * The roles whose `facilityIds` are genuinely derived today.
 *
 * Slice 1 resolves a manager's sites — every site in the club — and leaves the
 * instructor and maintenance derivations to the bands that need them (slices 3
 * and 4), where `assignment.ts` and `maintenance_task.assigned_to` are already
 * the answer. Until then an instructor's `facilityIds` is empty, and an empty
 * list is exactly the input that makes a facility-scoped query return nothing
 * while looking like it worked.
 *
 * So the gap is asserted rather than remembered: `assertRegistryIsSound` refuses
 * a `scope: 'facility'` widget offered to a role not on this list. Slice 3 adds
 * `instructor` here and to `readFacilityIds`, in the same change, or its widgets
 * do not register.
 */
export const ROLES_WITH_DERIVED_FACILITIES: readonly MemberRole[] = ['owner', 'admin'];

/**
 * Every widget, in one place.
 *
 * Slice 1 registers three, and they are three that already have their data:
 * nothing here is a placeholder waiting for a resolver, because a slice that
 * ends in stubs has not ended. The catalogue in
 * `docs/backlog/POOLSE-66-role-aware-dashboard.md` is the rest, and each arrives
 * with the band it belongs to.
 */
export const WIDGETS: readonly WidgetDefinition[] = [
  /*
   * The trial, the renewal and the card are the **owner's own** — POOLSE-60
   * settled that when it moved Subscrição under *O meu perfil* and out of the
   * menu, on the same reasoning that keeps the owner's salary from an admin. The
   * ticket's catalogue files this under "owner, admin"; the narrower rule wins,
   * and an admin is not left uninformed by it: the standing banner about a trial
   * running out or a club going read-only comes from `/me` and reaches everyone.
   */
  {
    id: 'mgmt.subscription',
    band: 'management',
    roles: ['owner'],
    scope: 'tenant',
    size: 1,
    priority: 40,
    // A trial with four days left is the most important thing on the page.
    escalate: trialIsClosing,
    escalatedPriority: 90,
    resolver: subscriptionState,
  },

  /*
   * What is mine — slice 4.3's panel, now a widget, resolving through the same
   * repository function the `/maintenance/tasks/mine` endpoint uses. Every
   * management login sees it, which is the endpoint's own rule: a job nobody has
   * been given still has to be visible to somebody.
   *
   * It sits in the operational band although an owner may hold it. That is the
   * band model working rather than a mistake: a task is "my work today", and an
   * owner who fixes the showers sees it under their management figures.
   */
  {
    id: 'maint.mytasks',
    band: 'operational',
    roles: ['owner', 'admin', 'maintenance', 'instructor'],
    scope: 'self',
    size: 2,
    priority: 30,
    resolver: myTasks,
  },

  /*
   * What electricity costs — slice 2a.
   *
   * It was a bespoke panel on the dashboard, drawn outside the registry, which
   * is the drift the registry exists to end: a card nobody declared is a card no
   * role check governs. Owner and admin, which is narrower than `/energy/costs`
   * itself — maintenance may read what the site costs on the Energia screen, and
   * the *dashboard's* management band is not where they read it.
   *
   * Tenant scope, not facility: the figure is the club's electricity bill, and
   * an owner with two sites wants the total on the home page. The per-site
   * breakdown is Energia's job and the link goes there.
   */
  {
    id: 'mgmt.energy.costs',
    band: 'management',
    roles: ['owner', 'admin'],
    scope: 'tenant',
    size: 2,
    priority: 20,
    resolver: energySpend,
  },

  /*
   * A club with no sites — see `compose.ts`, where this one suppresses every
   * other widget on the page. Owner and admin only, because it is a list of
   * things only they can do; nobody else should be handed a checklist they
   * cannot act on.
   */
  {
    id: 'setup.checklist',
    band: 'management',
    roles: ['owner', 'admin'],
    scope: 'tenant',
    size: 3,
    priority: 100,
    resolver: setupChecklist,
  },
];

/**
 * The widgets this reader may see at all.
 *
 * **Gating only** — no ordering and no cap, because both of those need the
 * resolved data (`escalate`) and this has to stay a pure function of the
 * registry and the reader. That split is what makes role gating testable without
 * a database, and it is what keeps "a widget you may not see is absent from the
 * payload" a property of one function rather than of the endpoint.
 */
export function widgetsFor(
  ctx: { roles: readonly string[]; kind: 'business' | 'personal' },
  registry: readonly WidgetDefinition[] = WIDGETS,
  env: NodeJS.ProcessEnv = process.env,
): WidgetDefinition[] {
  const held = new Set(ctx.roles);

  return registry.filter((widget) => {
    if (!widget.roles.some((role) => held.has(role))) return false;
    if (widget.kinds !== undefined && !widget.kinds.includes(ctx.kind)) return false;
    if (widget.featureFlag !== undefined && (env[widget.featureFlag] ?? '').trim() !== 'true') {
      return false;
    }
    return true;
  });
}

/**
 * The registry's own rules, asserted rather than remembered.
 *
 * Every one of these is a mistake that produces *nothing on screen* rather than
 * an error: a duplicate id renders one card twice, an empty `roles` list makes a
 * widget nobody ever sees, and a facility-scoped widget offered to a role whose
 * sites are not derived yet resolves against an empty list and reports "nothing
 * here" for ever. `widget-registry.test.ts` runs this against the real registry.
 */
export function assertRegistryIsSound(registry: readonly WidgetDefinition[] = WIDGETS): void {
  const seen = new Set<string>();

  for (const widget of registry) {
    if (seen.has(widget.id)) throw new Error(`Two widgets share the id "${widget.id}"`);
    seen.add(widget.id);

    if (!BANDS.includes(widget.band)) {
      throw new Error(`Widget "${widget.id}" names an unknown band "${widget.band}"`);
    }

    if (widget.roles.length === 0) {
      throw new Error(`Widget "${widget.id}" lists no roles, so nobody would ever see it`);
    }

    for (const role of widget.roles) {
      if (!(MEMBER_ROLES as readonly string[]).includes(role)) {
        throw new Error(`Widget "${widget.id}" names an unknown role "${role}"`);
      }
    }

    if (widget.size < 1 || widget.size > 3) {
      throw new Error(`Widget "${widget.id}" is ${widget.size} columns wide; 1 to 3`);
    }

    if (widget.scope === 'facility') {
      const undrivable = widget.roles.filter(
        (role) => !ROLES_WITH_DERIVED_FACILITIES.includes(role),
      );
      if (undrivable.length > 0) {
        throw new Error(
          `Widget "${widget.id}" is facility-scoped but ${undrivable.join(', ')} ` +
            'have no derived facilityIds yet — see ROLES_WITH_DERIVED_FACILITIES',
        );
      }
    }
  }
}

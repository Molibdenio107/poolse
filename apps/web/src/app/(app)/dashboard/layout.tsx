import * as Sentry from '@sentry/nextjs';
import { ApiError, apiFetch, type Me, type OrganizationKind } from '@/lib/api';
import type { PoolseModule } from '@poolse/rules';
import { AppSidebar, MobileMenu, type Badges } from '../app-sidebar';
import type { SubscriptionAlertView } from '@/lib/subscription-alert';
import { modulesOf } from '@/lib/modules';
import { PreferenceControls } from '../preference-controls';
import { UserMenu } from '../user-menu';
import { CommandPalette } from '@/components/command-palette';
import { readAttention } from '@/lib/attention';
import { SuspendedNotice } from './suspended-notice';
import { ClubSupportStrip, SupportEndedNotice, SupportSessionBanner } from './support-strip';
import { loadSupportStatus } from './support.actions';

/**
 * The backoffice shell.
 *
 * Everything under `/dashboard` renders inside it, which is what finally made
 * good on the note left on `PreferenceControls`: the language and theme controls
 * were copied into fifteen page headers waiting for a shell to move into. This is
 * the shell. Each page is now just its own content — a heading and the work —
 * and the furniture lives in one file.
 *
 * Navigation down the left, account across the top. The account row moved out of
 * the sidebar's foot in backlog round 2, story 10: sign-out belongs at the top
 * right because that is where every user has learned to look for it, and it
 * belongs inside the avatar menu rather than beside it, because a one-click
 * sign-out sitting in a corner is a control people hit by accident.
 */

/**
 * Which roles the person signed in holds, in the organization they are acting
 * as — and which kind of organization that is, since 4.5.
 *
 * `memberships[0]` mirrors TenantMiddleware, which picks the first membership
 * when no organization is named — so the navigation is filtered against the same
 * organization the API will answer for. The day an organization switcher exists,
 * both sides read it, and this comment is the reminder that there are two.
 *
 * Fails closed. If `/me` cannot be reached, no role-restricted section renders:
 * the pages behind them refuse independently, so the worst this costs is a menu
 * item missing during an outage, and the alternative failure is the wrong way
 * round. The kind falls back to `business`, which is the fuller menu — a
 * personal user seeing Turmas during an outage is a nuisance, not a leak.
 */
interface Viewer {
  roles: string[];
  /**
   * This browser is acting as Poolse support in the club — POOLSE-79. The
   * banner says so and ends it; null for everybody else.
   */
  support: { organizationId: string; organizationName: string; expiresAt: string } | null;
  /** The club this browser chose is gone — a window that ended. */
  clubGone: boolean;
  kind: OrganizationKind;
  /** POOLSE-87: what this club has on. Empty when `/me` failed — closed, like roles. */
  modules: readonly PoolseModule[];
  /** The club's name, for the brand slot. Null when there is no membership. */
  organizationName: string | null;
  /**
   * The tenant is closed — slice 3.
   *
   * Null for the ordinary case. When set, the shell renders the notice *instead
   * of* the page, because every tenant-scoped call below this point answers 403
   * `tenant_suspended` and the alternative is a wall of "could not load" boxes
   * with no explanation among them.
   */
  suspended: { name: string; reason: string | null; at: string } | null;
}

async function currentViewer(): Promise<Viewer> {
  try {
    const me = await apiFetch<Me>('/me');
    const membership = me.memberships[0];

    /*
     * Which tenant an error belongs to — slice 2.
     *
     * Here because this is the one place the web app learns which organization
     * it is rendering, and every screen in the product is below this layout. The
     * *id*, never the name: a Sentry issue titled with a club's name is the
     * club's data in a third-party service, and the operator can look an id up
     * in /admin. No-op with no DSN.
     */
    if (membership !== undefined) {
      Sentry.setTag('tenant_id', membership.organizationId);
    }

    return {
      roles: membership?.roles ?? [],
      support:
        membership?.supportExpiresAt != null
          ? {
              organizationId: membership.organizationId,
              organizationName: membership.organizationName,
              expiresAt: membership.supportExpiresAt,
            }
          : null,
      clubGone: me.requestedOrganizationMissing === true,
      kind: membership?.organizationKind ?? 'business',
      // No membership: nothing to show. A membership from an API that predates
      // the field: everything on (`modulesOf`).
      modules: membership === undefined ? [] : modulesOf(membership),
      organizationName: membership?.organizationName ?? null,
      suspended:
        membership?.suspendedAt != null
          ? {
              name: membership.organizationName,
              reason: membership.suspensionReason,
              at: membership.suspendedAt,
            }
          : null,
    };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    /*
     * Fails open on suspension, closed on roles — and the asymmetry is
     * deliberate. A role-restricted section missing during an outage costs a
     * menu item, and the pages behind it refuse independently. Showing the
     * suspension notice because `/me` was briefly unreachable would tell a
     * paying club its account is closed when it is not, which is a telephone
     * call we would deserve.
     */
    return {
      roles: [],
      support: null,
      clubGone: false,
      kind: 'business',
      modules: [],
      organizationName: null,
      suspended: null,
    };
  }
}

/**
 * The club's logo for the brand slot, read beside `/me` rather than inside
 * it: `/me` comes from a SECURITY DEFINER function and one image id is not
 * worth changing its shape. A failure is no logo — a corner, not a page.
 */
async function brandLogo(): Promise<string | null> {
  try {
    return (await apiFetch<{ fileId: string | null }>('/settings/logo')).fileId;
  } catch {
    return null;
  }
}

/**
 * What the menu's entries count — POOLSE-114's files waiting in *Recebidos por
 * email*, for the people who import a meet in a club with the competition
 * module. One indexed count; a failure is no badge, never a broken menu.
 */
async function menuBadges(roles: readonly string[], modules: readonly string[]): Promise<Badges> {
  // POOLSE-120: what needs doing, already narrowed by the API to who can act.
  const attention = (await readAttention()).menu;
  if (!modules.includes('competition') || !['owner', 'admin', 'instructor'].some((role) => roles.includes(role))) {
    return attention;
  }
  try {
    return { ...attention, meetInbox: (await apiFetch<{ pending: number }>('/meet-inbox/count')).pending };
  } catch {
    return attention;
  }
}

/**
 * The subscription warning on the avatar — Rui, 28-10-2026. Owner and admin
 * only; the API decides whether there is one. It replaced the read-only banner
 * every member saw, so a read-only club is told through its owner and admins.
 * A failure is no icon, never a broken header.
 */
async function subscriptionWarning(roles: readonly string[]): Promise<SubscriptionAlertView | null> {
  if (!roles.includes('owner') && !roles.includes('admin')) return null;
  try {
    return await apiFetch<SubscriptionAlertView>('/subscription/alert');
  } catch {
    return null;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const [{ roles, support, clubGone, kind, modules, organizationName, suspended }, logoFileId] =
    await Promise.all([currentViewer(), brandLogo()]);

  // A support window that ended, with this browser still pointed at its club.
  if (clubGone) return <SupportEndedNotice />;

  const [badges, subscription] =
    suspended === null ? await Promise.all([menuBadges(roles, modules), subscriptionWarning(roles)]) : [{}, null];

  // The club's own strip — the Owner and the Admins, never support itself.
  const clubManager = support === null && (roles.includes('owner') || roles.includes('admin'));
  const supportStatus = clubManager ? await loadSupportStatus() : null;

  /*
   * Instead of the shell, not inside it.
   *
   * The sidebar's links would all lead to refusals, and the header's brand slot
   * belongs to a customer whose account we have just closed. One page, one
   * sentence, and a way to reach us.
   */
  if (suspended !== null) {
    return (
      <SuspendedNotice
        organizationName={suspended.name}
        reason={suspended.reason}
        suspendedAt={suspended.at}
      />
    );
  }

  return (
    // POOLSE-88: clear of a landscape phone's rounded corners and notch.
    <div className="flex min-h-dvh flex-col pl-safe-left pr-safe-right md:flex-row">
      {/*
        Hidden on paper - round 4. The water-quality report is a real document
        an operator sends to the camara, and a printout with the navigation and
        the avatar menu down the side is not one. Nothing else in the app is
        printed today; when something is, it inherits this for free.
      */}
      <div className="contents print:hidden">
        <AppSidebar roles={roles} kind={kind} modules={modules} badges={badges} />
      </div>

      {/*
        `min-w-0` is not decoration. Without it a flex child refuses to shrink
        below its content, and one wide table anywhere in the app pushes the
        whole page sideways instead of scrolling inside its own container.
      */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          `h-app-bar` includes the notch and `pt-safe-top` pads the bar clear of
          it, so the bar's own content is always 3.5rem tall — POOLSE-88.
        */}
        <header className="sticky top-0 z-20 flex h-app-bar items-center justify-between gap-3 border-b border-border bg-surface px-4 pt-safe-top md:px-6 print:hidden">
          {/*
            The brand slot — the club's logo and name, never Poolse's own mark,
            because this corner belongs to the customer. The logo is set under
            Faturação → Definições (12 October 2026).
          */}
          <div className="flex min-w-0 items-center gap-2">
            <MobileMenu roles={roles} kind={kind} modules={modules} badges={badges} />
            {logoFileId !== null && (
              // eslint-disable-next-line @next/next/no-img-element -- streamed through /files/:id
              <img src={`/files/${logoFileId}`} alt="" className="h-8 w-auto max-w-32 object-contain" />
            )}
            {organizationName !== null && (
              <span className="truncate text-sm font-medium">{organizationName}</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* POOLSE-118: Ctrl+K, or this button, to go anywhere the menu goes. */}
            <CommandPalette roles={roles} kind={kind} modules={modules} />
            <PreferenceControls />
            <UserMenu canArchive={roles.includes('owner') || roles.includes('admin')} subscription={subscription} />
          </div>
        </header>

        {/*
          Above the page, below the app bar — a standing condition rather than
          something that just happened, and it must not scroll away with the
          content. Inside the shell, deliberately: unlike a suspension the
          navigation still works and every screen behind it still reads.
        */}
        {support !== null && (
          <SupportSessionBanner
            organizationId={support.organizationId}
            organizationName={support.organizationName}
            expiresAt={support.expiresAt}
          />
        )}
        {supportStatus !== null && (
          <ClubSupportStrip
            isOwner={roles.includes('owner')}
            liveUntil={supportStatus.live?.expiresAt ?? null}
            pendingRequests={supportStatus.pendingRequests}
          />
        )}

        {/* Nothing under the home bar — POOLSE-88. */}
        <div className="min-w-0 flex-1 pb-safe-bottom">{children}</div>
      </div>
    </div>
  );
}

import * as Sentry from '@sentry/nextjs';
import { ApiError, apiFetch, type Me, type OrganizationKind } from '@/lib/api';
import { AppSidebar } from '../app-sidebar';
import { PreferenceControls } from '../preference-controls';
import { UserMenu } from '../user-menu';
import { SuspendedNotice } from './suspended-notice';
import { ReadOnlyNotice } from './read-only-notice';

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
  kind: OrganizationKind;
  /**
   * The tenant is closed — slice 3.
   *
   * Null for the ordinary case. When set, the shell renders the notice *instead
   * of* the page, because every tenant-scoped call below this point answers 403
   * `tenant_suspended` and the alternative is a wall of "could not load" boxes
   * with no explanation among them.
   */
  suspended: { name: string; reason: string | null; at: string } | null;
  /**
   * The trial ran out — POOLSE-61.
   *
   * Unlike `suspended` this does **not** replace the page. The club reads
   * everything it built, exports it and pays; the banner sits above the app
   * saying so. Null for the ordinary case.
   */
  readOnly: { at: string; keptUntil: string | null; isOwner: boolean } | null;
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
      kind: membership?.organizationKind ?? 'business',
      readOnly:
        membership?.readOnlyAt != null
          ? {
              at: membership.readOnlyAt,
              keptUntil: membership.pendingDeleteAt,
              // Only the owner can pay; anybody else is told who to ask rather
              // than sent to a screen that will refuse them.
              isOwner: membership.roles.includes('owner'),
            }
          : null,
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
    return { roles: [], kind: 'business', suspended: null, readOnly: null };
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const { roles, kind, suspended, readOnly } = await currentViewer();

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
    <div className="flex min-h-screen flex-col md:flex-row">
      {/*
        Hidden on paper - round 4. The water-quality report is a real document
        an operator sends to the camara, and a printout with the navigation and
        the avatar menu down the side is not one. Nothing else in the app is
        printed today; when something is, it inherits this for free.
      */}
      <div className="contents print:hidden">
        <AppSidebar roles={roles} kind={kind} />
      </div>

      {/*
        `min-w-0` is not decoration. Without it a flex child refuses to shrink
        below its content, and one wide table anywhere in the app pushes the
        whole page sideways instead of scrolling inside its own container.
      */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-app-bar items-center justify-between gap-3 border-b border-border bg-surface px-6 print:hidden">
          {/*
            The brand slot. Empty until stories 5 and 7 land, which put the
            organization's logo and name here — deliberately left as a slot
            rather than filled with Poolse's own mark, because the whole point of
            those stories is that this corner belongs to the customer.
          */}
          <div />

          <div className="flex items-center gap-3">
            <PreferenceControls />
            <UserMenu />
          </div>
        </header>

        {/*
          Above the page, below the app bar — a standing condition rather than
          something that just happened, and it must not scroll away with the
          content. Inside the shell, deliberately: unlike a suspension the
          navigation still works and every screen behind it still reads.
        */}
        {readOnly !== null && (
          <ReadOnlyNotice
            readOnlyAt={readOnly.at}
            dataKeptUntil={readOnly.keptUntil}
            isOwner={readOnly.isOwner}
          />
        )}

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

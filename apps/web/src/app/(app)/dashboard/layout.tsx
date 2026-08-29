import { ApiError, apiFetch, type Me } from '@/lib/api';
import { AppSidebar } from '../app-sidebar';
import { PreferenceControls } from '../preference-controls';
import { UserMenu } from '../user-menu';

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
 * Which roles the person signed in holds, in the organization they are acting as.
 *
 * `memberships[0]` mirrors TenantMiddleware, which picks the first membership
 * when no organization is named — so the navigation is filtered against the same
 * organization the API will answer for. The day an organization switcher exists,
 * both sides read it, and this comment is the reminder that there are two.
 *
 * Fails closed. If `/me` cannot be reached, no role-restricted section renders:
 * the pages behind them refuse independently, so the worst this costs is a menu
 * item missing during an outage, and the alternative failure is the wrong way
 * round.
 */
async function currentRoles(): Promise<string[]> {
  try {
    const me = await apiFetch<Me>('/me');
    return me.memberships[0]?.roles ?? [];
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return [];
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const roles = await currentRoles();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/*
        Hidden on paper - round 4. The water-quality report is a real document
        an operator sends to the camara, and a printout with the navigation and
        the avatar menu down the side is not one. Nothing else in the app is
        printed today; when something is, it inherits this for free.
      */}
      <div className="contents print:hidden">
        <AppSidebar roles={roles} />
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

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
